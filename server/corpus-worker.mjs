import path from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ODP_BASE, boundedUpstream } from './odp.mjs';
import { apiFetch, speechWindows } from './activity-index-worker.mjs';
import { array, tail, documentFiles } from './activity-index-model.mjs';
import { languageCode } from './ep-links.mjs';
import { transcriptLanguage } from './transcript-language.mjs';
import { allowedDownload, downloadDocx } from './document-text.mjs';
import { CorpusStore, CORPUS_LIMITS } from './corpus-store.mjs';
import { HttpError } from './http-utils.mjs';

const DAY=24*60*60_000;
const day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const SPEECH_ID=/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/;
const SPEECH_TYPES='PLENARY_DEBATE_SPEECH,PLENARY_DEBATE_WRITTEN_STATEMENT';
// Verbatim translations are added for weeks after a sitting; recheck recent months.
const RECHECK_WINDOW=120*DAY, RECHECK_EVERY=7*DAY, DISCOVER_EVERY=6*60*60_000;
const PRIORITY={speeches:60,speech:61,primaryDocument:50,otherDocument:10};

// Paragraph text of a transcript fragment, one paragraph per line. The XML
// itself is retained (compressed) so headers can be re-derived later.
export function fragmentText(xml) {
  if(typeof xml!=='string' || Buffer.byteLength(xml)>2*1024*1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml)!==true)return '';
  // Order-preserving parse: spoken transcripts wrap each word in a timed element
  // and keep the separating spaces as text between elements.
  const tree=new XMLParser({preserveOrder:true,ignoreAttributes:true,removeNSPrefix:true,parseTagValue:false,trimValues:false}).parse(xml),paragraphs=[];
  const text=nodes=>array(nodes).map(node=>Object.entries(node).map(([key,value])=>key==='#text'?String(value):key===':@'?'':text(value)).join('')).join('');
  const visit=nodes=>{for(const node of array(nodes))for(const [key,value] of Object.entries(node)){if(key==='p'){const line=text(value).replace(/\s+/g,' ').trim();if(line)paragraphs.push(line);}else if(key!=='#text'&&key!==':@')visit(value);}};
  visit(tree);return paragraphs.join('\n');
}
// Every language fragment of one speech. The supplied fragment key is kept
// exactly; `mul` resolves to the single language its XML declares, if any.
export function speechTexts(activity,sourceUrl,fetchedAt) {
  const docs=array(activity.recorded_in_a_realization_of).filter(doc=>doc && typeof doc==='object');
  const fragments=Object.entries(Object.assign({},...docs.map(doc=>doc['api:xmlFragment']||{}))).filter(([,xml])=>typeof xml==='string' && xml);
  const declared=docs.flatMap(doc=>array(doc.originalLanguage||doc.originalLanguageURI)).map(languageCode).filter(Boolean);
  const infos=fragments.map(([key,xml])=>[key,xml,transcriptLanguage(xml)]);
  const originals=declared.length?declared:[...new Set(infos.flatMap(([, ,info])=>info.tags.filter(tag=>tag.includes('-t-')).map(tag=>tag.split('-t-')[0].slice(0,2))))];
  const texts=infos.flatMap(([key,xml,info])=>{
    const tags=[...new Set(info.tags.filter(tag=>!tag.includes('-t-')).map(tag=>tag.slice(0,2)))];
    const language=key==='mul'&&tags.length===1?tags[0]:key;
    const body=fragmentText(xml);
    if(!body)return [];
    return [{sourceKey:key,language,translationType:info.machine?'machine':originals.includes(language)?'original':'unspecified',sourceFormat:'xml-fragment',sourceUrl,fetchedAt,body,raw:xml}];
  });
  return {document:{sourceId:activity.activity_id,kind:'speech',date:activity.activity_date||null,term:10,originalLanguages:[...new Set(declared)]},texts};
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
  // Month windows for speeches; question and answer files from the saved index.
  discover() {
    const now=this.clock(), today=day(now);
    for(const range of speechWindows(today)) {
      const key='speeches:'+range.start.slice(0,7), body={start:range.start,end:range.end,offset:0,limit:this.pageSize};
      if(this.store.enqueue(key,'speeches',body,PRIORITY.speeches))continue;
      const task=this.store.task(key);
      const recent=now-Date.parse(range.end)<RECHECK_WINDOW || range.end===today;
      if(task.done && recent && now-(task.done_at||0)>=(range.end>=day(now-7*DAY)?DAY:RECHECK_EVERY))this.store.reopen(key,body,PRIORITY.speeches);
    }
    const discovered=this.store.get('discoveredAt');
    if(discovered && now-Date.parse(discovered)<DISCOVER_EVERY)return;
    const generation=this.store.indexGeneration();
    if(generation==null)return;
    const sources=this.store.db.prepare(`SELECT body FROM idx.sources WHERE generation=? AND kind='document' AND key LIKE '/parliamentary-questions/%'`);
    for(const row of sources.iterate(generation)) {
      for(const file of questionFiles(JSON.parse(row.body),this.languages)) {
        if(this.store.hasText(file.url))continue;
        this.store.enqueue('docx:'+file.url,'docx',file,file.primary?PRIORITY.primaryDocument:PRIORITY.otherDocument);
      }
    }
    this.store.set('discoveredAt',new Date(now).toISOString());this.store.set('languages',this.languages);
  }
  async task(task) {
    const {body}=task;
    if(task.kind==='speeches') {
      const params={'parliamentary-term':10,'activity-type':SPEECH_TYPES,'sort-by':'sitting-date:desc,numbering:desc','sitting-date':body.start,'sitting-date-end':body.end,'include-output':'xml_fragment',limit:body.limit,offset:body.offset};
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
        if(!node?.activity_id){this.store.enqueue('speech:'+id,'speech',{id},PRIORITY.speech);continue;}
        const {document,texts}=speechTexts(node,url.href,record.fetchedAt);
        this.store.putDocument(document,this.keep(texts));
      }
      this.store.taskProgress(task,{...body,offset:body.offset+matched.length,lastPage:signature});
    } else if(task.kind==='speech') {
      if(!SPEECH_ID.test(body.id))throw new Error('Invalid speech identifier.');
      const params={'include-output':'xml_fragment'};
      await this.pace();
      const record=await this.fetchRecord('/speeches/'+body.id,params,{signal:this.controller.signal});
      const activity=record.payload.data.find(node=>node.activity_id===body.id);
      if(!activity)throw new Error(`Speech ${body.id} has no matching detail record.`);
      const {document,texts}=speechTexts(activity,ODP_BASE+'/speeches/'+body.id+'?include-output=xml_fragment&format=application%2Fld%2Bjson',record.fetchedAt);
      this.store.putDocument(document,this.keep(texts));this.store.finishTask(task);
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
      this.discover();
      this.store.set('phase',this.store.get('backfilledAt')?'refreshing':'backfilling');
      while(!this.stopped && requests<this.budget && this.clock()-started<this.maxDuration) {
        if(await this.store.diskBytes()>this.diskLimit){this.store.set('phase','paused: disk limit reached');break;}
        const task=this.store.nextTask();
        if(!task) {
          if(!this.store.db.prepare('SELECT 1 FROM tasks WHERE done=0 LIMIT 1').get()) {
            // Complete only after question files were discovered from a loaded index.
            if(this.store.get('discoveredAt')) {
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
    } finally {clearInterval(heartbeat);this.store.release();this.running=false;}
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
  service={store,worker,diskLimit};return service;
}
export async function corpusStatus() {
  const {store,diskLimit}=corpus();
  return store.status({diskBytes:await store.diskBytes(),diskLimit});
}
export function corpusSearch(params) {
  const {store}=corpus();
  const result=store.search(params);
  if(!result)throw new HttpError(400,'invalid_query',`Enter 1–${CORPUS_LIMITS.queryTerms} words or quoted phrases (at most ${CORPUS_LIMITS.queryLength} characters).`);
  if(result.unavailable)throw new HttpError(503,'activity_index_loading',result.unavailable);
  const status=store.status();
  return {...result,coverage:{complete:status.complete,phase:status.phase,note:status.coverage,documents:status.documents}};
}
export function startCorpus() {
  if(process.env.CORPUS_ENABLED!=='true')return ()=>{};
  const {worker}=corpus();
  const run=()=>worker.run().catch(error=>console.error('[corpus]',error.message));
  const timer=setInterval(run,60_000);timer.unref();void run();
  return ()=>{clearInterval(timer);worker.stop();};
}
