import {XMLParser} from 'fast-xml-parser';
import path from 'node:path';
import {boundedUpstream} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {InsightViewCache} from './insights-view-cache.mjs';

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
  constructor({clock=Date.now,fetchSource=fetch,directory=process.env.ODP_CACHE_DIR&&path.join(process.env.ODP_CACHE_DIR,'official-context-v1'),run=boundedUpstream}={}) {
    Object.assign(this,{clock,fetchSource,run});this.cache=new InsightViewCache({clock,directory,freshMs:6*60*60_000,maxEntries:32,maxBytes:24*1024*1024});
  }
  async get(input) {
    const url=officialSourceUrl(input).href;
    const record=await this.cache.get(['official-context-v1',url],()=>this.run(async()=>{
      let target=url,response;
      for(let attempt=0;attempt<3;attempt++) {
        response=await this.fetchSource(target,{headers:{Accept:target.includes('/webapi/')?'application/sparql-results+json':'text/html','User-Agent':'MEP-Committee-Speeches-PoC/0.1 (official legislative context)'},redirect:'manual',signal:AbortSignal.timeout(20_000)});
        if(![301,302,303,307,308].includes(response.status))break;
        const next=response.headers.get('location');await response.body?.cancel();if(!next)throw new HttpError(502,'official_redirect','The source redirect is incomplete.');
        target=officialSourceUrl(new URL(next,target)).href;
      }
      if(!response?.ok||response.status===202)throw new HttpError(502,'official_source_unavailable','The official source is temporarily unavailable.');
      const json=url.includes('/webapi/'),type=response.headers.get('content-type')||'';
      if(json?!type.includes('json'):!type.includes('html'))throw new HttpError(502,'official_source_type','The source returned an unexpected document.');
      const text=await limitedText(response,json?3*1024*1024:1024*1024);
      return {url,fetchedAt:new Date(this.clock()).toISOString(),...(json?{data:JSON.parse(text)}:{html:text})};
    },{priority:'interactive'}));
    if(record.url!==url||!Number.isFinite(Date.parse(record.fetchedAt)))throw new HttpError(502,'official_source_identity','The saved official source could not be verified.');
    return record;
  }
}

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
  const subjects=subjectParagraph?rawText(subjectParagraph).split(/\n/).map(value=>value.trim()).map(value=>value.match(/^(\d(?:\.\d{2}){2,3})\s+(.+)$/)).filter(Boolean).map(match=>({code:match[1],label:match[2]})):[];
  return {reference,title,language,subjects,summaries:[...summaries.values()]};
}
export function parseSummaryPage(html,reference) {
  const root=mainTree(html),all=nodes(root),subtitle=all.find(node=>classHas(node,'es_product-subtitle')),body=all.find(node=>classHas(node,'es_product-content'));
  if(!subtitle||!text(subtitle).startsWith(reference+' '))throw new HttpError(502,'summary_identity','The summary does not match this procedure.');
  const date=visibleDate(text(subtitle));
  if(!date||!body)throw new HttpError(502,'summary_content','The published summary could not be read.');
  // Use the printed date: the site's datetime attribute can contain a different year.
  const blocks=nodes(body).filter(node=>['p','h2','h3','h4','li'].includes(node.tag)&&!nodes(node).some(child=>child!==node&&['p','li'].includes(child.tag))&&!nodes(node).some(child=>child.tag==='a'&&/\/procedure-document-summary\/pdf\?id=/.test(child.attrs?.['@_href']||''))).map(node=>({kind:node.tag.startsWith('h')?'heading':'paragraph',text:text(node)})).filter(block=>block.text);
  if(!blocks.length||blocks.length>120||Buffer.byteLength(JSON.stringify(blocks))>64*1024)throw new HttpError(502,'summary_content','The published summary could not be read.');
  return {reference,date,blocks,method:/AI-generated and human-reviewed/i.test(text(body))?'AI-generated and human-reviewed':null};
}
