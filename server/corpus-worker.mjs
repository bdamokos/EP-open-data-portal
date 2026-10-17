import path from 'node:path';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ODP_BASE, boundedUpstream } from './odp.mjs';
import { apiFetch, speechWindows } from './activity-index-worker.mjs';
import { array, tail, documentFiles } from './activity-index-model.mjs';
import { languageCode } from './ep-links.mjs';
import { allowedDownload, downloadDocx } from './document-text.mjs';
import { CorpusStore, CORPUS_LIMITS, corpusQuery } from './corpus-store.mjs';
import { HttpError } from './http-utils.mjs';
import { CorpusReader } from './corpus-reader.mjs';
import { countryCode } from './insights-countries.mjs';
import { savedMetadata } from './insights-store.mjs';
import { config } from './config.mjs';
import { corpusSearchResponse } from './corpus-search-response.mjs';

const DAY=24*60*60_000;
const day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const SPEECH_ID=/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/;
const SPEECH_TYPES='PLENARY_DEBATE_SPEECH,PLENARY_DEBATE_WRITTEN_STATEMENT';
// Verbatim translations are added for weeks after a sitting; recheck recent months.
const RECHECK_WINDOW=120*DAY, RECHECK_EVERY=7*DAY, DISCOVER_EVERY=6*60*60_000;
const PRIORITY={speeches:60,speech:61,primaryDocument:50,otherDocument:10};
const FRAGMENT_LIMIT=2*1024*1024;

// Retain only language attributes. Returning false from updateTag discards
// each parsed node instead of attaching its body/children to an XML tree.
// Oversized bodies still supply provenance for other, bounded fragments.
function fragmentLanguages(xml) {
  if(!xml || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true)return {tags:[],machine:false};
  const tags=new Set();
  new XMLParser({ignoreAttributes:false,parseTagValue:false,tagValueProcessor:()=>'',updateTag:(_tag,_path,attributes)=>{
    const value=attributes?.['@_xml:lang'];
    if(typeof value==='string' && value)tags.add(value.toLowerCase());
    return false;
  }}).parse(xml);
  return {tags:[...tags],machine:[...tags].some(tag=>/(?:^|-)mtec(?:-|$)/.test(tag))};
}

// Paragraph text of a transcript fragment, one paragraph per line. The XML
// itself is retained (compressed) so headers can be re-derived later.
export function fragmentText(xml) {
  if(typeof xml!=='string' || Buffer.byteLength(xml)>FRAGMENT_LIMIT || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true)return '';
  // Order-preserving parse: spoken transcripts wrap each word in a timed element
  // and keep the separating spaces as text between elements.
  const tree=new XMLParser({preserveOrder:true,ignoreAttributes:true,removeNSPrefix:true,parseTagValue:false,trimValues:false}).parse(xml),paragraphs=[];
  const text=nodes=>array(nodes).map(node=>Object.entries(node).map(([key,value])=>key==='#text'?String(value):key===':@'?'':text(value)).join('')).join('');
  const visit=nodes=>{for(const node of array(nodes))for(const [key,value] of Object.entries(node)){if(key==='p'){const line=text(value).replace(/\s+/g,' ').trim();if(line)paragraphs.push(line);}else if(key!=='#text'&&key!==':@')visit(value);}};
  visit(tree);return paragraphs.join('\n');
}
// Every language fragment of one speech. The supplied fragment key is kept
// exactly; `mul` resolves to the single language its XML declares, if any.
function* speechTextSteps(activity,sourceUrl,fetchedAt) {
  const docs=array(activity.recorded_in_a_realization_of).filter(doc=>doc && typeof doc==='object');
  const fragments=Object.entries(Object.assign({},...docs.map(doc=>doc['api:xmlFragment']||{}))).filter(([,xml])=>typeof xml==='string' && xml);
  const declared=docs.flatMap(doc=>array(doc.originalLanguage||doc.originalLanguageURI)).map(languageCode).filter(Boolean);
  const infos=[];
  for(const [key,xml] of fragments) {
    infos.push([key,xml,fragmentLanguages(xml)]);
    yield;
  }
  const originals=declared.length?declared:[...new Set(infos.flatMap(([, ,info])=>info.tags.filter(tag=>tag.includes('-t-')).map(tag=>tag.split('-t-')[0].slice(0,2))))];
  const texts=[];
  for(const [key,xml,info] of infos) {
    const tags=[...new Set(info.tags.filter(tag=>!tag.includes('-t-')).map(tag=>tag.slice(0,2)))];
    const language=key==='mul'&&tags.length===1?tags[0]:key;
    const body=fragmentText(xml);
    if(body)texts.push({sourceKey:key,language,translationType:info.machine?'machine':originals.includes(language)?'original':'unspecified',sourceFormat:'xml-fragment',sourceUrl,fetchedAt,body,raw:xml});
    yield;
  }
  return {document:{sourceId:activity.activity_id,kind:'speech',date:activity.activity_date||null,term:10,originalLanguages:[...new Set(declared)]},texts};
}
export function speechTexts(activity,sourceUrl,fetchedAt) {
  const steps=speechTextSteps(activity,sourceUrl,fetchedAt);
  for(;;){const step=steps.next();if(step.done)return step.value;}
}
// Question and answer DOCX files listed by a saved index record.
export function questionFiles(work,policy='all') {
  const id=work.identifier||tail(work.id);
  const entries=[{sourceId:id,kind:'question',parentId:null,work},...array(work.inverse_answers_to).filter(answer=>answer&&typeof answer==='object').map(answer=>({sourceId:answer.identifier||tail(answer.id),kind:'answer',parentId:id,work:answer}))];
  return entries.flatMap(entry=>{
    if(!/^[A-Z0-9-]{1,100}$/.test(entry.sourceId||''))return [];
    const originals=array(entry.work.originalLanguage).map(languageCode).filter(Boolean);
    const files=documentFiles(entry.work).filter(file=>file.format==='DOCX' && file.language && allowedDownload(file.url));
    return files.flatMap(file=>{
      const primary=originals.includes(file.language)||file.language==='en';
      if(policy==='primary' && !primary)return [];
      return [{sourceId:entry.sourceId,kind:entry.kind,parentId:entry.parentId,date:entry.work.document_date||null,originalLanguages:originals,language:file.language,translationType:file.translationType,url:file.url,primary}];
    });
  });
}

export class CorpusWorker {
  constructor(store,{fetchRecord=apiFetch,download=downloadDocx,clock=Date.now,budget=300,maxDuration=60*60_000,diskLimit=2*1024**3,interval=1000,languages='all',pageSize=25}={}) {
    Object.assign(this,{store,fetchRecord,download,clock,budget,maxDuration,diskLimit,interval,languages,pageSize});
    this.running=false;this.stopped=false;this.controller=new AbortController();this.lastRequest=0;
  }
  async pace() {
    const wait=this.lastRequest+this.interval-this.clock();
    if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
    this.lastRequest=this.clock();
  }
  // `primary` keeps originals and English; `all` also keeps every translation.
  keep(texts){return this.languages==='all'?texts:texts.filter(text=>text.translationType==='original'||text.language==='en');}
  async checkpoint() {
    await yieldToEventLoop();
    if(this.stopped)throw new Error('Corpus worker stopped.');
    this.store.assertWriter();
  }
  async extractSpeech(activity,sourceUrl,fetchedAt) {
    const steps=speechTextSteps(activity,sourceUrl,fetchedAt);
    for(;;){const step=steps.next();if(step.done)return step.value;await this.checkpoint();}
  }
  retainSpeechMetadata(activity,sourceUrl,fetchedAt) {
    try {this.store.putSpeechMetadata(activity,sourceUrl,fetchedAt);}
    catch(error) {
      // Losing ownership or stopping is never a recoverable metadata gap.
      this.store.assertWriter();
      if(this.stopped||this.controller.signal.aborted)throw error;
      const kind='speech-metadata-detail',key=kind+':'+activity.activity_id,body={id:activity.activity_id};
      if(!this.store.enqueue(key,kind,body,PRIORITY.speech))this.store.reopen(key,body,PRIORITY.speech);
      this.store.failTask(this.store.task(key),error,error.retryAfter||0);
    }
  }
  // Month windows for speeches; question and answer files from the saved index.
  async discover() {
    const now=this.clock(), today=day(now);
    // Build the queryable projection locally through this leased writer. No
    // speech metadata or transcript download is needed for older corpora.
    const projectionStarted=this.clock();
    catalog:for(;;) {
      if(this.clock()-projectionStarted>=Math.min(10_000,this.maxDuration)||await this.store.diskBytes()>=this.diskLimit)break;
      const rows=this.store.db.prepare('SELECT m.source_id FROM speech_metadata m LEFT JOIN speech_catalog c ON c.source_id=m.source_id WHERE c.source_id IS NULL ORDER BY m.source_id LIMIT 100').all();
      if(!rows.length)break;
      for(const row of rows) {
        try {const saved=this.store.speechMetadata(row.source_id);this.store.projectSpeechCatalog(saved.activity,saved.availableTextLanguages);}
        catch {this.store.assertWriter();this.store.db.prepare('INSERT OR IGNORE INTO speech_catalog(source_id) VALUES (?)').run(row.source_id);}
        await this.checkpoint();
        if(this.clock()-projectionStarted>=Math.min(10_000,this.maxDuration))break catalog;
      }
    }
    // Widening the language policy must revisit months already read under `primary`.
    const widened=this.languages==='all' && this.store.get('speechLanguages')==='primary';
    if(this.store.get('speechMetadataBackfill')) {
      const months=new Set(this.store.db.prepare("SELECT DISTINCT substr(date,1,7) month FROM documents WHERE kind='speech'").all().map(row=>row.month));
      for(const range of speechWindows(today))if(months.has(range.start.slice(0,7)))
        this.store.enqueue('speech-metadata:'+range.start.slice(0,7),'speech-metadata',{start:range.start,end:range.end,offset:0,limit:500},62);
      if(!this.store.db.prepare("SELECT 1 FROM tasks WHERE kind IN ('speech-metadata','speech-metadata-detail') AND done=0 LIMIT 1").get())this.store.set('speechMetadataBackfill',false);
    }
    if(widened){this.store.set('backfilledAt',null);this.store.set('phase','backfilling');}
    for(const range of speechWindows(today)) {
      const key='speeches:'+range.start.slice(0,7), body={start:range.start,end:range.end,offset:0,limit:this.pageSize};
      if(this.store.enqueue(key,'speeches',body,PRIORITY.speeches))continue;
      if(widened){this.store.resetTask(key,body,PRIORITY.speeches);continue;}
      const task=this.store.task(key);
      const recent=now-Date.parse(range.end)<RECHECK_WINDOW || range.end===today;
      if(task.done && recent && now-(task.done_at||0)>=(range.end>=day(now-7*DAY)?DAY:RECHECK_EVERY))this.store.reopen(key,body,PRIORITY.speeches);
    }
    this.store.set('speechLanguages',this.languages);
    const index=this.store.indexState();
    if(index.generation==null)return;
    const discovered=this.store.get('discoveredAt'), sameIndex=this.store.get('discoveredGeneration')===index.generation && this.store.get('discoveredPublished')===index.published;
    if(discovered && sameIndex && this.store.get('documentLanguages')===this.languages && now-Date.parse(discovered)<DISCOVER_EVERY)return;
    // Explicit binary bounds let the existing (generation,key) index seek
    // directly to question records instead of scanning unrelated source bodies.
    const sources=this.store.db.prepare(`SELECT body FROM idx.sources WHERE generation=? AND kind='document' AND key>='/parliamentary-questions/' AND key<'/parliamentary-questions0' AND key LIKE '/parliamentary-questions/%'`);
    for(const row of sources.iterate(index.generation)) {
      let files=0;
      for(const file of questionFiles(JSON.parse(row.body),this.languages)) {
        if(!this.store.hasText(file.url))this.store.enqueue('docx:'+file.url,'docx',file,file.primary?PRIORITY.primaryDocument:PRIORITY.otherDocument);
        if(++files%8===0)await this.checkpoint();
      }
      await this.checkpoint();
    }
    this.store.set('discoveredAt',new Date(now).toISOString());this.store.set('documentLanguages',this.languages);
    this.store.set('discoveredGeneration',index.generation);this.store.set('discoveredPublished',index.published);
  }
  async task(task) {
    const {body}=task;
    if(task.kind==='speeches'||task.kind==='speech-metadata') {
      const metadataOnly=task.kind==='speech-metadata';
      const params={'parliamentary-term':10,'activity-type':SPEECH_TYPES,'sort-by':'sitting-date:desc,numbering:desc','sitting-date':body.start,'sitting-date-end':body.end,...(!metadataOnly?{'include-output':'xml_fragment'}:{}),limit:body.limit,offset:body.offset};
      let record;
      await this.pace();
      try{record=await this.fetchRecord('/speeches',params,{signal:this.controller.signal});}
      catch(error){
        // A page of long debates can exceed the response bound; retry smaller pages.
        if(/exceeded/.test(error.message) && body.limit>1){this.store.taskProgress(task,{...body,limit:Math.max(1,Math.floor(body.limit/2))});return;}
        throw error;
      }
      if(body.offset===0 && Number(record.payload.meta?.total)>=10000)throw new Error('Speech window exceeds the search result limit.');
      const url=new URL(ODP_BASE+'/speeches');for(const [key,value] of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(key,String(value));
      const graph=new Map(record.payload.data.map(node=>[node.id,node]));
      const hits=record.payload.searchResults?.hits;
      const matched=hits?hits.map(hit=>({id:tail(hit.id),node:graph.get(hit.id)})):record.payload.data.filter(node=>node.activity_id).map(node=>({id:node.activity_id,node}));
      if(!matched.length){this.store.finishTask(task);return;}
      const signature=matched.map(item=>item.id).sort().join('|');
      if(signature===body.lastPage)throw new Error('EP speech pagination repeated a page.');
      for(const {id,node} of matched) {
        if(!SPEECH_ID.test(id))throw new Error('EP speech identifier was invalid.');
        // A search reference without its graph node becomes a durable detail fetch.
        if(!node?.activity_id){
          const kind=metadataOnly?'speech-metadata-detail':'speech',key=kind+':'+id;
          if(!this.store.enqueue(key,kind,{id},PRIORITY.speech))this.store.reopen(key,{id},PRIORITY.speech);
          continue;
        }
        if(node.activity_id!==id)throw new Error('Speech metadata does not match its exact search identifier.');
        if(metadataOnly) {
          this.retainSpeechMetadata(node,url.href,record.fetchedAt);
          await this.checkpoint();continue;
        }
        const {document,texts}=await this.extractSpeech(node,url.href,record.fetchedAt);
        this.store.putDocument(document,this.keep(texts));
        this.retainSpeechMetadata(node,url.href,record.fetchedAt);
        await this.checkpoint();
      }
      this.store.taskProgress(task,{...body,offset:body.offset+matched.length,lastPage:signature});
    } else if(task.kind==='speech'||task.kind==='speech-metadata-detail') {
      if(!SPEECH_ID.test(body.id))throw new Error('Invalid speech identifier.');
      const metadataOnly=task.kind==='speech-metadata-detail',params=metadataOnly?{}:{'include-output':'xml_fragment'};
      await this.pace();
      const record=await this.fetchRecord('/speeches/'+body.id,params,{signal:this.controller.signal});
      const activity=record.payload.data.find(node=>node.activity_id===body.id);
      if(!activity)throw new Error(`Speech ${body.id} has no matching detail record.`);
      const url=new URL(ODP_BASE+'/speeches/'+body.id);for(const [key,value] of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(key,value);
      if(!metadataOnly) {
        const {document,texts}=await this.extractSpeech(activity,url.href,record.fetchedAt);
        this.store.putDocument(document,this.keep(texts));
      }
      if(metadataOnly)this.store.putSpeechMetadata(activity,url.href,record.fetchedAt);
      else this.retainSpeechMetadata(activity,url.href,record.fetchedAt);
      this.store.finishTask(task);
    } else if(task.kind==='docx') {
      if(!allowedDownload(body.url))throw new Error('Unapproved official document download URL.');
      await this.pace();
      const result=await boundedUpstream(()=>this.download(body.url),{priority:'background'});
      this.store.putDocument({sourceId:body.sourceId,kind:body.kind,parentId:body.parentId,date:body.date,term:10,originalLanguages:body.originalLanguages},
        [{sourceKey:body.language,language:body.language,translationType:body.translationType,sourceFormat:'docx',sourceUrl:body.url,fetchedAt:new Date(this.clock()).toISOString(),body:result.paragraphs.join('\n'),raw:null}]);
      this.store.finishTask(task);
    } else throw new Error('Unknown corpus task.');
  }
  async run() {
    if(this.stopped || this.running || !this.store.acquire())return;
    this.running=true;const started=this.clock();let requests=0;
    const heartbeat=setInterval(()=>{if(!this.store.renew()){this.stopped=true;this.controller.abort();}},20_000);heartbeat.unref();
    try {
      this.store.set('phase',this.store.get('backfilledAt')?'refreshing':'backfilling');
      await this.discover();
      while(!this.stopped && requests<this.budget && this.clock()-started<this.maxDuration) {
        if(await this.store.diskBytes()>this.diskLimit){this.store.set('phase','paused: disk limit reached');break;}
        const task=this.store.nextTask();
        if(!task) {
          if(!this.store.db.prepare('SELECT 1 FROM tasks WHERE done=0 LIMIT 1').get()) {
            // Complete only after question files were discovered from a published
            // index generation; a partial initial index may still lack questions.
            if(this.store.get('discoveredPublished')) {
              if(!this.store.get('backfilledAt'))this.store.set('backfilledAt',new Date(this.clock()).toISOString());
              this.store.set('phase','ready');
            } else this.store.set('phase','waiting for activity index');
          }
          break;
        }
        requests++;
        try{await this.task(task);}
        catch(error){if(this.stopped)break;this.store.failTask(task,error,error.retryAfter||0);}
      }
      this.store.set('lastRunAt',new Date(this.clock()).toISOString());
    } catch(error) {if(!this.stopped)throw error;}
    finally {clearInterval(heartbeat);this.store.release();this.running=false;}
  }
  stop(){this.stopped=true;this.controller.abort();if(!this.running)this.store.release();}
}

let service;
const bounded=(name,fallback,min,max)=>{const value=Number(process.env[name]||fallback);if(!Number.isInteger(value)||value<min||value>max)throw new Error(`Invalid ${name}.`);return value;};
export function corpus() {
  if(service)return service;
  if(process.env.CORPUS_ENABLED!=='true')throw new HttpError(503,'corpus_disabled','The full-text corpus is not enabled.');
  const directory=process.env.CORPUS_DIR;
  if(!directory)throw new HttpError(503,'corpus_configuration','A dedicated corpus directory is required.');
  const languages=process.env.CORPUS_LANGUAGES||'all';
  if(!['all','primary'].includes(languages))throw new Error('Invalid CORPUS_LANGUAGES.');
  const indexFile=process.env.ACTIVITY_INDEX_DIR?path.join(process.env.ACTIVITY_INDEX_DIR,'activities-v1.sqlite'):null;
  const store=new CorpusStore(directory,{indexFile});
  const diskLimit=bounded('CORPUS_MAX_DISK_MIB',2048,64,131072)*1024*1024;
  const worker=new CorpusWorker(store,{
    budget:bounded('CORPUS_JOB_REQUEST_BUDGET',300,1,5000),
    interval:bounded('CORPUS_REQUEST_INTERVAL_MS',1000,250,60_000),
    languages,diskLimit,
  });
  service={store,worker,diskLimit,reader:new CorpusReader(directory,{indexFile})};return service;
}
export async function corpusStatus() {
  const {store,diskLimit,reader}=corpus();
  return reader.query('status',{diskBytes:await store.diskBytes(),diskLimit});
}
export async function corpusSearch(params) {
  const {reader}=corpus();
  // The activity roster currently saves IDs/names only. Reuse the exact cached
  // public roster metadata used by Questions; an empty members map avoids all
  // per-person cache reads, and this helper never fetches upstream.
  const metadata=params.country?await savedMetadata({members:new Map()}):null;
  const countryMemberIds=metadata?[...metadata].filter(([,person])=>countryCode(person['api:country-of-representation'])===params.country).map(([id])=>id):null;
  const countryMetadataIds=metadata?[...metadata].filter(([,person])=>countryCode(person['api:country-of-representation'])).map(([id])=>id):null;
  const result=await reader.query('search',{...params,countryMemberIds,countryMetadataIds});
  if(!result)throw new HttpError(400,'invalid_query',`Enter 1–${CORPUS_LIMITS.queryTerms} words or quoted phrases (at most ${CORPUS_LIMITS.queryLength} characters).`);
  if(result.unavailable)throw new HttpError(503,result.unavailableCode||'activity_index_loading',result.unavailable);
  return corpusSearchResponse(result,config.jsonResponseLimitBytes);
}
export async function corpusText(params) {
  const result=await corpus().reader.query('text',{...params,
    highlightBytes:Math.min(CORPUS_LIMITS.highlightBytes,Math.floor(config.jsonResponseLimitBytes/4)),
    highlightRangeLimit:Math.min(CORPUS_LIMITS.highlightRanges,Math.floor(config.jsonResponseLimitBytes/128))});
  if(!result)throw new HttpError(404,'corpus_text_unavailable','This exact text variant is not stored in the corpus.');
  if(Buffer.byteLength(JSON.stringify(result))+1>config.jsonResponseLimitBytes)throw new HttpError(413,'corpus_text_too_large','This stored text exceeds the supported reading response size. Open its official source.');
  return result;
}

// Shared validation for URL queries and the read-only POST search. Validate
// before opening a corpus, so malformed scopes cannot silently become global.
export function corpusSearchOptions(input) {
  const allowed=['query','kind','kinds','language','uiLanguage','member','country','from','to','limit','offset','group','dateBasis','sort','sourceIds'];
  if(!input || Array.isArray(input) || typeof input!=='object' || Object.keys(input).some(key=>!allowed.includes(key)))throw new HttpError(400,'invalid_query','Unsupported search options.');
  if(typeof input.query!=='string' || !corpusQuery(input.query))throw new HttpError(400,'invalid_query',`Enter 1–${CORPUS_LIMITS.queryTerms} words or quoted phrases (at most ${CORPUS_LIMITS.queryLength} characters).`);
  const value=name=>input[name]??null;
  const enumValue=(name,choices,fallback=null)=>{
    const selected=value(name)??fallback;
    if(selected!==null&&!choices.includes(selected))throw new HttpError(400,'invalid_query',`Invalid ${name}.`);
    return selected;
  };
  const kind=enumValue('kind',['speech','question','answer']);
  const kinds=value('kinds');
  if(kinds!==null && (!Array.isArray(kinds)||kinds.length>3||kinds.some(kind=>!['speech','question','answer'].includes(kind))||new Set(kinds).size!==kinds.length) || kind!==null&&kinds!==null)throw new HttpError(400,'invalid_kind','Choose either a corpus kind or a set of corpus kinds.');
  const sourceIds=value('sourceIds');
  if(sourceIds!==null && (!Array.isArray(sourceIds)||sourceIds.length>CORPUS_LIMITS.sourceIds||sourceIds.some(id=>typeof id!=='string'||!/^[A-Z0-9-]{1,100}$/.test(id))))throw new HttpError(400,'invalid_source_id',`Use at most ${CORPUS_LIMITS.sourceIds} exact source identifiers.`);
  const language=value('language'),uiLanguage=value('uiLanguage')??'en';
  if(language!==null&&(typeof language!=='string'||!/^[a-z]{2,3}$/.test(language)) || typeof uiLanguage!=='string'||!/^[a-z]{2,3}$/.test(uiLanguage))throw new HttpError(400,'invalid_language','Invalid text or interface language.');
  const date=name=>{
    const selected=value(name);
    if(selected!==null && (typeof selected!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(selected)||!Number.isFinite(Date.parse(selected))||new Date(selected).toISOString().slice(0,10)!==selected))throw new HttpError(400,'invalid_date','Use valid YYYY-MM-DD dates.');
    return selected;
  };
  const from=date('from'),to=date('to');
  if(from&&to&&from>to)throw new HttpError(400,'invalid_date','The start date must not be after the end date.');
  const integer=(name,fallback,min,max)=>{
    const selected=value(name)??fallback;
    if(typeof selected!=='number'||!Number.isSafeInteger(selected)||selected<min||selected>max)throw new HttpError(400,'invalid_query',`Invalid ${name}.`);
    return selected;
  };
  const member=value('member');
  if(member!==null && (typeof member!=='number'||!Number.isSafeInteger(member)||member<1))throw new HttpError(400,'invalid_id','member must be a positive integer.');
  const selectedCountry=value('country');
  if(selectedCountry!==null && (typeof selectedCountry!=='string'||!countryCode(selectedCountry)))throw new HttpError(400,'invalid_country','Choose a country of representation.');
  const group=enumValue('group',['document','question'],'document');
  return {query:input.query,kind,kinds,language,uiLanguage,member,country:selectedCountry===null?null:countryCode(selectedCountry),from,to,
    limit:integer('limit',20,1,CORPUS_LIMITS.searchLimit),offset:integer('offset',0,0,CORPUS_LIMITS.searchOffset),group,
    dateBasis:enumValue('dateBasis',['document','question'],group==='question'?'question':'document'),sort:enumValue('sort',['relevance','newest'],'relevance'),
    sourceIds:sourceIds===null?null:[...new Set(sourceIds)]};
}
export function startCorpus() {
  if(process.env.CORPUS_ENABLED!=='true')return ()=>{};
  const {worker}=corpus();
  const run=()=>worker.run().catch(error=>console.error('[corpus]',error.message));
  const timer=setInterval(run,60_000);timer.unref();void run();
  return ()=>{clearInterval(timer);worker.stop();};
}
