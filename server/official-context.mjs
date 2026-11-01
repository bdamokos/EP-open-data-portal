import {integerFromEnvironment} from './config.mjs';
import {boundedUpstream,backoffUpstream} from './odp.mjs';
import {hintOfficialContext} from './official-context-hints.mjs';
import {XMLParser} from 'fast-xml-parser';
import path from 'node:path';
import {UpstreamQueue,retryAfterSeconds} from './upstream-queue.mjs';
import {HttpError} from './http-utils.mjs';
import {InsightViewCache} from './insights-view-cache.mjs';
import {requestSignal,runWithRequestSignal,waitForRequest} from './request-budget.mjs';
import {userAgent} from './user-agent.mjs';
import {doceoDocument} from './press-releases-model.mjs';

export function officialSourceUrl(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw new HttpError(400,'invalid_source','Unsupported official source.');
  if(url.hostname==='oeil.europarl.europa.eu'&&/^\/oeil\/(en|fr)\/(procedure-file|document-summary)$/.test(url.pathname))return url;
  if(url.hostname==='publications.europa.eu'&&url.pathname==='/webapi/rdf/sparql')return url;
  throw new HttpError(400,'invalid_source','Unsupported official source.');
}
async function limitedText(response,maximum) {
  const reader=response.body?.getReader();if(!reader)return '';
  const parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum)throw new HttpError(502,'official_source_size','The official source is too large.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(parts).toString('utf8');
}
export class OfficialContextSources {
  constructor({clock=Date.now,fetchSource=fetch,directory=process.env.ODP_CACHE_DIR&&path.join(process.env.ODP_CACHE_DIR,'official-context-v1'),run,writable=false,beforeFetch,maxDiskBytes=integerFromEnvironment('OFFICIAL_CONTEXT_MAX_DISK_MIB',32768,1,1048576)*1024*1024}={}) {
    Object.assign(this,{clock,fetchSource,writable,beforeFetch});this.queues=new Map();
    this.run=run||((operation,options)=>this.schedule(operation,options));
    // Keep memory bounded separately from the retained historical source pages.
    this.cache=new InsightViewCache({clock,directory,writable,freshMs:6*60*60_000,maxEntries:512,maxBytes:24*1024*1024,maxDiskEntries:1000000,maxDiskBytes,retainDisk:true});
  }
  async schedule(operation,{origin,priority='interactive',signal}) {
    let queue=this.queues.get(origin);
    // OEIL and Publications Office have no ODP quota. These are local resource
    // caps per origin; their own Retry-After pauses still apply.
    if(!queue){queue=new UpstreamQueue(origin==='https://oeil.europarl.europa.eu'?{maximum:1}:{});this.queues.set(origin,queue);}
    let release;
    try{release=await queue.acquire(priority,{signal});}
    catch(error){
      if(error?.code==='upstream_busy')throw Object.assign(new HttpError(503,'upstream_busy','The official source is busy. Please try again after the pause.'),{retryAfter:error.retryAfter,retryAt:error.retryAt});
      throw error;
    }
    try{signal?.throwIfAborted();return await waitForRequest(operation(),signal);}finally{release();}
  }
  async get(input,{freshMs=this.cache.freshMs,validate,cacheScope,includeRetryAt=false,priority='interactive',waitForFresh=false}={}) {
    requestSignal()?.throwIfAborted();
    const source=officialSourceUrl(input),url=source.href;
    const key=['official-context-v1',url];if(cacheScope)key.push(cacheScope);
    if(priority!=='background') {
      const saved=await this.cache.stored(this.cache.key(key));
      if(!saved||this.clock()-saved.at>(typeof freshMs==='function'?freshMs(saved.value):freshMs))hintOfficialContext(url);
    }
    const record=await waitForRequest(this.cache.get(key,()=>runWithRequestSignal(undefined,()=>{
      // The cache owns one budget across admission, redirects and body reads.
      const signal=AbortSignal.timeout(20_000);
      return this.run(async()=>{
        let target=url;
        for(let attempt=0;attempt<3;attempt++) {
          // Each redirect is a new HTTP start on the shared origin queue. Hold
          // its grant through body consumption; never nest origin admissions.
          const result=await boundedUpstream(async()=>{
            await this.beforeFetch?.(source.origin);
            const response=await this.fetchSource(target,{headers:{Accept:target.includes('/webapi/')?'application/sparql-results+json':'text/html','User-Agent':userAgent('legislative context')},redirect:'manual',signal});
            if([301,302,303,307,308].includes(response.status)){
              const next=response.headers.get('location');await response.body?.cancel();if(!next)throw new HttpError(502,'official_redirect','The source redirect is incomplete.');
              const redirected=officialSourceUrl(new URL(next,target));
              if(redirected.origin!==source.origin)throw new HttpError(502,'official_redirect','The source redirected to a different origin.');
              return {redirect:redirected.href};
            }
            if(response.status===429||response.status>=500){
              const retryAfter=retryAfterSeconds(response.headers.get('retry-after'));
              this.queues.get(source.origin)?.backoff(retryAfter);backoffUpstream(retryAfter,{source:source.origin});await response.body?.cancel();
              throw Object.assign(new HttpError(503,'official_source_limited','The official source is temporarily limiting requests. Please try again after the pause.'),{retryAfter,retryAt:this.clock()+retryAfter*1000});
            }
            if(!response.ok||response.status===202)throw new HttpError(502,'official_source_unavailable','The official source is temporarily unavailable.');
            const json=url.includes('/webapi/'),type=response.headers.get('content-type')||'';
            if(json?!type.includes('json'):!type.includes('html'))throw new HttpError(502,'official_source_type','The source returned an unexpected document.');
            const text=await limitedText(response,json?3*1024*1024:1024*1024);
            return {url,fetchedAt:new Date(this.clock()).toISOString(),...(json?{data:JSON.parse(text)}:{html:text})};
          },{source:source.origin,priority,signal});
          if(!result.redirect)return result;
          target=result.redirect;
        }
        throw new HttpError(502,'official_redirect','The source redirected too many times.');
      },{priority,origin:source.origin,signal});
    }),{freshMs,includeRetryAt,background:priority==='background',validate:record=>{
      if(record.url!==url||!Number.isFinite(Date.parse(record.fetchedAt)))throw new HttpError(502,'official_source_identity','The saved official source could not be verified.');
      validate?.(record);
    }}));
    if(waitForFresh&&record.viewCache?.stale){const pending=this.cache.pending.get(this.cache.key(key));if(!pending)throw new HttpError(503,'official_source_unavailable','The official source is temporarily unavailable.');const fresh=await waitForRequest(pending);return {...fresh.value,viewCache:{stale:false}};}
    if(priority==='background') {
      const pending=this.cache.pending.get(this.cache.key(key));
      if(pending)return (await waitForRequest(pending)).value;
    }
    return record;
  }
}

let sharedSources;
export function getSharedOfficialContextSources(){return sharedSources??=new OfficialContextSources();}

const htmlParser=new XMLParser({ignoreAttributes:false,preserveOrder:true,parseTagValue:false,trimValues:false,processEntities:true,htmlEntities:true,allowBooleanAttributes:true,unpairedTags:['br','hr','img','input','meta','link','source','wbr']});
const classHas=(node,name)=>String(node.attrs?.['@_class']||'').split(/\s+/).includes(name);
function tree(entries) {
  return entries.flatMap(entry=>Object.entries(entry).filter(([tag])=>tag!==':@'&&tag!=='#comment').map(([tag,value])=>tag==='#text'?{tag,text:String(value),children:[],attrs:{}}:{tag,attrs:entry[':@']||{},children:Array.isArray(value)?tree(value):[]}));
}
function nodes(node){return [node,...(node.children||[]).flatMap(nodes)];}
function rawText(node){return node.tag==='#text'?node.text:node.tag==='br'?'\n':['script','style','svg'].includes(node.tag)?'':(node.children||[]).map(rawText).join('');}
const text=node=>rawText(node).replace(/\u0091/g,'‘').replace(/\u0092/g,'’').replace(/[\t\r\n ]+/g,' ').replace(/\u00a0/g,' ').trim();
function mainTree(html) {
  if(typeof html!=='string'||Buffer.byteLength(html)>1024*1024||/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(html))throw new HttpError(502,'official_document_invalid','The official document is unreadable.');
  const main=html.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1];
  if(!main)throw new HttpError(502,'official_document_invalid','The official document has no readable content.');
  return {tag:'root',attrs:{},children:tree(htmlParser.parse(main))};
}
export function procedureReference(value) {
  if(!/^\d{4}\/\d{4}[A-Z]?\([A-Z]{2,8}\)$/.test(value||''))throw new HttpError(400,'invalid_reference','Choose an official procedure reference.');
  return value;
}
export function visibleDate(value) {
  const match=String(value||'').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);if(!match)return null;
  const iso=match[3]+'-'+match[2]+'-'+match[1];return Number.isFinite(Date.parse(iso))&&new Date(iso).toISOString().slice(0,10)===iso?iso:null;
}
const summaryStage=value=>/1st reading|first reading|1[eè]re lecture|premi[eè]re lecture/i.test(value)?'first-reading':/proposal|proposition/i.test(value)?'proposal':/Parliament|Parlement/i.test(value)?'parliament-decision':'document';
const summaryId=node=>node.tag==='a'?String(node.attrs?.['@_href']||'').match(/^\/oeil\/(?:en|fr)\/document-summary\?id=(\d{1,12})$/)?.[1]:null;

export function parseProcedurePage(html,reference,language='en') {
  procedureReference(reference);
  const root=mainTree(html),all=nodes(root),heading=all.find(node=>classHas(node,'es_title-h1'));
  if(!heading||text(heading)!==reference)throw new HttpError(502,'procedure_identity','The source does not match this procedure.');
  const headings=all.filter(node=>node.tag==='h2'),title=text(headings[headings.indexOf(heading)+1]||heading),summaries=new Map();
  for(const row of all.filter(node=>node.tag==='tr')) {
    const cells=row.children.filter(node=>['td','th'].includes(node.tag));
    for(const anchor of nodes(row).filter(summaryId)) {
      const id=summaryId(anchor),description=cells.map(text).join(' '),old=summaries.get(id);
      const entry={id,stage:summaryStage(description),date:visibleDate(text(cells[0]||row)),documentReference:cells[2]?text(cells[2]):null,url:'https://oeil.europarl.europa.eu/oeil/'+language+'/document-summary?id='+id};
      if(!old||old.stage==='document')summaries.set(id,entry);
    }
  }
  let section='';
  for(const node of all) {
    if(['h1','h2','h3'].includes(node.tag))section=text(node);
    const id=summaryId(node);if(id&&!summaries.has(id))summaries.set(id,{id,stage:/final act|acte final/i.test(section)?'final-act':'document',date:null,documentReference:null,url:'https://oeil.europarl.europa.eu/oeil/'+language+'/document-summary?id='+id});
  }
  const subjectIndex=all.findIndex(node=>node.tag==='p'&&/^(?:Subject|Sujet|Subject matter)$/i.test(text(node)));
  const subjectParagraph=subjectIndex>=0?all.slice(subjectIndex+1).find(node=>node.tag==='p'):null;
  const subjects=subjectParagraph?rawText(subjectParagraph).split(/\n/).map(value=>value.trim()).map(value=>value.match(/^(\d(?:\.\d{2}){1,3})\s+(.+)$/)).filter(Boolean).map(match=>({code:match[1],label:match[2]})):[];
  // Single-subject Doceo documents the procedure file itself links.
  const documents=[...new Set(all.filter(node=>node.tag==='a').map(node=>doceoDocument(String(node.attrs?.['@_href']||''))).filter(Boolean))];
  return {reference,title,language,subjects,summaries:[...summaries.values()],documents};
}

// OEIL's key-events table is separate from its document/summary tables. Read
// only this explicitly labelled section after verifying the printed reference.
export function parseProcedureProgressPage(html,reference,language='en',{limit=300}={}) {
  procedureReference(reference);
  const all=nodes(mainTree(html)),heading=all.find(node=>classHas(node,'es_title-h1'));
  if(!heading||text(heading)!==reference)throw new HttpError(502,'procedure_identity','The source does not match this procedure.');
  const printedLanguage=html.match(/<html\b[^>]*\slang\s*=\s*["'](en|fr)["']/i)?.[1]?.toLowerCase();
  if(!printedLanguage)throw new HttpError(502,'procedure_language','The procedure source language could not be verified.');
  language=printedLanguage;
  const sections=all.filter(node=>node.tag==='div'&&classHas(node,'oeil-spy-section'));
  const section=sections.find(node=>nodes(node).some(child=>child.tag==='h2'&&/^(Key events|[ÉE]v[ée]nements cl[ée]s)$/i.test(text(child))));
  const basic=sections.find(node=>nodes(node).some(child=>child.tag==='h2'&&/^(Basic information|Informations de base)$/i.test(text(child))));
  const statuses=new Set();
  for(const node of basic?nodes(basic):[]) {
    const children=(node.children||[]).filter(child=>child.tag!=='#text');
    for(let index=0;index<children.length;index++)if(children[index].tag==='p'&&/^(Status|[ÉE]tat|Statut)$/i.test(text(children[index]))) {
      if(children[index+1]?.tag==='p'&&text(children[index+1]))statuses.add(text(children[index+1]));
    }
  }
  const tables=section?nodes(section).filter(node=>node.tag==='table'):[];
  const table=tables.length===1?tables[0]:null,headers=table?nodes(table).filter(node=>node.tag==='th').map(text):[];
  const readable=Boolean(table&&headers[0]==='Date'&&/^(Event|[ÉE]v[ée]nement)$/.test(headers[1]||''));
  if(!readable&&!statuses.size)throw new HttpError(502,'procedure_progress_shape','The procedure status and timeline could not be read.');
  const rows=readable?nodes(table).filter(node=>node.tag==='tr'&&node.children.some(child=>child.tag==='td')):[];
  const coverage={limited:rows.length>limit,invalidRows:statuses.size>1?1:0,incompleteEvents:0,timeline:readable?'available':'unavailable',status:statuses.size===1?'available':statuses.size?'ambiguous':'unavailable'};
  const events=rows.slice(0,limit).map(row=>{
    const cells=row.children.filter(node=>node.tag==='td'),printedDate=cells[0]?text(cells[0]):'',label=cells[1]?text(cells[1]):'';
    const date=/^\d{2}\/\d{2}\/\d{4}$/.test(printedDate)?visibleDate(printedDate):null;
    const issues=[...(!date?['date']:[]),...(!label||label.length>1200?['label']:[])];
    if(cells.length!==4)coverage.invalidRows++;
    if(issues.length)coverage.incompleteEvents++;
    // The source supplies no event identifier or per-event status. Retain its
    // printed date/label; a future date never establishes a completed action.
    return {date,printedDate,label:label&&label.length<=1200?label:null,language,issues};
  });
  return {reference,language,status:statuses.size===1?{label:[...statuses][0],language}:null,events,coverage};
}
export function parseSummaryPage(html,reference) {
  const root=mainTree(html),all=nodes(root),subtitle=all.find(node=>classHas(node,'es_product-subtitle')),body=all.find(node=>classHas(node,'es_product-content'));
  if(!subtitle||!text(subtitle).startsWith(reference+' '))throw new HttpError(502,'summary_identity','The summary does not match this procedure.');
  const date=visibleDate(text(subtitle));
  if(!date||!body)throw new HttpError(502,'summary_content','The published summary could not be read.');
  // Use the printed date: the site's datetime attribute can contain a different year.
  const blocks=nodes(body).filter(node=>['p','h2','h3','h4','li'].includes(node.tag)&&!nodes(node).some(child=>child!==node&&['p','li'].includes(child.tag))&&!nodes(node).some(child=>child.tag==='a'&&/\/procedure-document-summary\/pdf\?id=/.test(child.attrs?.['@_href']||''))).map(node=>({kind:node.tag.startsWith('h')?'heading':'paragraph',text:text(node)})).filter(block=>block.text);
  // Older summaries are hard-wrapped text in a division. A line closing a sentence before a capital or list dash starts a paragraph.
  if(!blocks.length)for(const line of rawText(body).split('\n').map(value=>value.replace(/[\t\r\u00a0 ]+/g,' ').trim()).filter(Boolean)) {
    const last=blocks.at(-1);
    if(last&&!(/[.:;!?]$/.test(last.text)&&/^[-–•(A-Z0-9]/.test(line)))last.text+=' '+line;
    else if(blocks.length<=120)blocks.push({kind:'paragraph',text:line});
  }
  if(!blocks.length||blocks.length>120||Buffer.byteLength(JSON.stringify(blocks))>64*1024)throw new HttpError(502,'summary_content','The published summary could not be read.');
  return {reference,date,blocks,method:/AI-generated and human-reviewed/i.test(text(body))?'AI-generated and human-reviewed':null};
}
