import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {docxParts} from './document-text.mjs';
import {HttpError} from './http-utils.mjs';
import {createRequestBudget,sharedRequest,waitForRequest,requestSignal} from './request-budget.mjs';
import {retryAfterSeconds,UpstreamQueue} from './upstream-queue.mjs';
import {writeCacheFile} from './cache-publication.mjs';
import {CacheDiskBudget} from './cache-disk-budget.mjs';
import {userAgent} from './user-agent.mjs';
import {getSharedOfficialContextSources} from './official-context.mjs';
import {parsePublicLegalXhtml} from './public-legal-xhtml.mjs';
import {languageCode} from './ep-links.mjs';

export const CELLAR_DOCX_MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
// This is a transport compatibility type, not support for Akoma Ntoso.
export const CELLAR_DECLARED_DOCX_MIME='application/zip;type=akn4eu';
const negotiationBytes=16*1024;
export function declaredDocxRepresentation(buffer,url) {
  if(buffer.length>negotiationBytes)return null;
  const xml=buffer.toString('utf8');
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)return null;
  const error=new XMLParser({parseTagValue:false}).parse(xml)?.error;
  const manifestation=new URL(url).pathname.match(/\/resource\/cellar\/([^/]+)\/DOC_[1-9]\d{0,3}$/)?.[1];
  if(!manifestation||error?.id!=='406'||typeof error.message!=='string')return null;
  const type=error.message.match(/resource mimetype \[([^\]]+)\]/u)?.[1];
  const advertisedId=error.message.match(/corresponding to this identifier : cellar:([a-f0-9.-]+)\s*$/u)?.[1];
  return type===CELLAR_DECLARED_DOCX_MIME&&advertisedId===manifestation?type:null;
}
function packageRoot(xml,name,namespace) {
  if(!xml)throw new Error('Missing OPC metadata.');
  const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false}).parse(xml),keys=Object.keys(parsed).filter(k=>!k.startsWith('?'));
  const key=keys[0],prefix=key?.includes(':')?key.split(':')[0]+':':'';
  if(keys.length!==1||key!==prefix+name||parsed[key]?.['@_xmlns'+(prefix?':'+prefix.slice(0,-1):'')]!==namespace)throw new Error('Unexpected OPC namespace.');
  return {node:parsed[key],prefix};
}
function validateNegotiatedDocx(buffer) {
  const parts=docxParts(buffer,{packageMetadata:true});
  const types=packageRoot(parts.get('[Content_Types].xml'),'Types','http://schemas.openxmlformats.org/package/2006/content-types');
  const main=array(types.node[types.prefix+'Override']).filter(n=>n['@_PartName']==='/word/document.xml');
  if(main.length!==1||main[0]['@_ContentType']!==CELLAR_DOCX_MIME)throw new Error('Not a Word main document.');
  const rels=packageRoot(parts.get('_rels/.rels'),'Relationships','http://schemas.openxmlformats.org/package/2006/relationships');
  const office=array(rels.node[rels.prefix+'Relationship']).filter(n=>n['@_Type']==='http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument');
  if(office.length!==1||!['word/document.xml','/word/document.xml'].includes(office[0]['@_Target'])||office[0]['@_TargetMode']&&office[0]['@_TargetMode']!=='Internal')throw new Error('Not an internal Word document.');
  const document=packageRoot(parts.get('word/document.xml'),'document','http://schemas.openxmlformats.org/wordprocessingml/2006/main');
  if(!document.node[document.prefix+'body'])throw new Error('Missing Word body.');
}
const mediaType=value=>String(value||'').toLowerCase().split(';').map(p=>p.trim()).filter(Boolean);
function matchesRepresentation(value,accept) {
  const [type,...parameters]=mediaType(value);
  if(accept===CELLAR_DECLARED_DOCX_MIME)return type==='application/zip'&&parameters.filter(p=>p.startsWith('type=')).length===1&&parameters.includes('type=akn4eu');
  return type===accept.split(';')[0];
}

export const CELLAR_LIMITS=Object.freeze({metadataBytes:3*1024*1024,itemBytes:8*1024*1024,bundleBytes:24*1024*1024,items:32,redirects:3,diskBytes:256*1024*1024,memoryBytes:24*1024*1024,freshMs:7*86400_000,metadataFreshMs:6*3600_000});
const uuid='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
export const CELLAR_WORK_PATTERN=new RegExp('^http://publications\\.europa\\.eu/resource/cellar/'+uuid+'$');
const cellarPath=new RegExp('^/resource/cellar/'+uuid+'(?:\\.\\d{4,8}(?:\\.\\d{2,8})?)?(?:/DOC_[1-9]\\d{0,3}|/rdf/tree/full)?$');
const hash=value=>createHash('sha256').update(value).digest('hex');
const failure=(code,message)=>new HttpError(502,code,message);
export function proposalCelex(value) {
  if(typeof value!=='string'||!/^5(?:19|20)\d{2}PC\d{4}$/.test(value))throw new HttpError(400,'invalid_proposal_celex','Choose an exact Commission proposal CELEX identifier.');
  return value;
}
export function councilCelex(value) {
  if(typeof value!=='string'||!/^5(?:19|20)\d{2}AG\d{4}\(01\)$/.test(value))throw new HttpError(400,'invalid_council_celex','Choose an exact Council position CELEX identifier.');
  return value;
}
export function existingLawCelex(value) {
  if(typeof value!=='string'||!/^(?:3(?:19|20)\d{2}[RLD]\d{4}|0(?:19|20)\d{2}[RLD]\d{4}-\d{8})$/.test(value))throw failure('invalid_existing_law_celex','Invalid existing act identifier.');
  return value;
}
// RDF identifiers retain HTTP spelling. Only transport URLs are upgraded.
export function cellarTransportUrl(value,{redirect=false}={}) {
  let url;try{url=new URL(value);}catch{throw failure('cellar_url','Unsupported CELLAR URL.');}
  if(!['https:',...(redirect?['http:']:[])].includes(url.protocol)||url.hostname!=='publications.europa.eu'||url.username||url.password||url.port||url.search||url.hash||!(/^\/resource\/celex\/(?:5(?:19|20)\d{2}(?:PC\d{4}|AG\d{4}%2801%29)|3(?:19|20)\d{2}[RLD]\d{4}|0(?:19|20)\d{2}[RLD]\d{4}-\d{8})$/.test(url.pathname)||cellarPath.test(url.pathname)))throw failure('cellar_url','Unsupported CELLAR URL.');
  url.protocol='https:';return url.href;
}
export async function limitedCellarBody(response,maximum) {
  if(Number(response.headers.get('content-length'))>maximum){await response.body?.cancel();throw failure('cellar_size','The CELLAR item exceeds the supported size.');}
  const reader=response.body?.getReader(),chunks=[];let size=0;
  if(!reader)return Buffer.alloc(0);
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum)throw failure('cellar_size','The CELLAR item exceeds the supported size.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
export class CellarDocuments {
  constructor({sources=getSharedOfficialContextSources(),fetchSource=sources.fetchSource,clock=Date.now,directory=process.env.ODP_CACHE_DIR&&path.join(process.env.ODP_CACHE_DIR,'commission-proposals-v1'),freshMs=CELLAR_LIMITS.freshMs}={}) {
    Object.assign(this,{sources,fetchSource,clock,directory,freshMs});this.memory=new Map();this.pending=new Map();this.failures=new Map();this.bytes=0;
    this.structuredQueue=new UpstreamQueue({maximum:1});
    this.disk=directory?new CacheDiskBudget(directory,{clock,maxBytes:CELLAR_LIMITS.diskBytes,maxEntries:4096,pattern:/^[a-f0-9]{64}\.(?:json|blob)$/}):null;
  }
  async request(input,{accept,language,validators={},maximum=CELLAR_LIMITS.metadataBytes}={}) {
    const initial=cellarTransportUrl(input),owner=requestSignal();owner?.throwIfAborted();
    const budget=createRequestBudget(20_000),signal=owner?AbortSignal.any([owner,budget.signal]):budget.signal;
    let target=initial,selectedAccept=accept,selectedValidators=validators,redirects=0,negotiation=null;
    const contentRequest=[CELLAR_DOCX_MIME,CELLAR_DECLARED_DOCX_MIME,'application/xhtml+xml'].includes(accept);
    try {
      while(true) {
        // Each hop/negotiation reacquires admission and any origin pause, within
        // the same deadline. No retry follows throttling or a multipart reply.
        const result=await this.sources.schedule(async()=>{
          signal.throwIfAborted();
          const response=await this.fetchSource(target,{headers:{Accept:selectedAccept,'User-Agent':userAgent('Commission proposal context'),...(language?{'Accept-Language':language}:{}),...(selectedValidators.etag?{'If-None-Match':selectedValidators.etag}:{}),...(selectedValidators.lastModified?{'If-Modified-Since':selectedValidators.lastModified}:{})},redirect:'manual',signal});
          if([301,302,303,307,308].includes(response.status)) {
            const location=response.headers.get('location');await response.body?.cancel();
            if(!location||redirects===CELLAR_LIMITS.redirects)throw failure('cellar_redirect','The CELLAR redirect chain is incomplete or too long.');
            const next=cellarTransportUrl(new URL(location,target),{redirect:true});
            if(contentRequest&&new URL(next).pathname!==new URL(initial).pathname)throw failure('cellar_redirect_identity','The content redirect changed the discovered item identity.');
            return {redirect:next};
          }
          if([429,503].includes(response.status)) {
            const retryAfter=retryAfterSeconds(response.headers.get('retry-after'));this.sources.queues.get(new URL(initial).origin)?.backoff(retryAfter);await response.body?.cancel();
            throw Object.assign(failure('cellar_limited','CELLAR is temporarily limiting requests.'),{retryAfter});
          }
          const contentType=response.headers.get('content-type')||null;
          if(response.status===406&&selectedAccept===CELLAR_DOCX_MIME&&!negotiation&&/\/DOC_[1-9]\d{0,3}$/.test(new URL(initial).pathname)) {
            const buffer=await limitedCellarBody(response,negotiationBytes);signal.throwIfAborted();
            const advertisedAccept=declaredDocxRepresentation(buffer,initial);
            if(advertisedAccept)return {advertisement:{url:target,status:406,request:{accept:selectedAccept,...(language?{language}:{})},contentType,sha256:hash(buffer),bytes:buffer.length,fetchedAt:new Date(this.clock()).toISOString(),advertisedAccept}};
          } else if(response.status===304) {
            await response.body?.cancel();return {status:304,url:target,accept:selectedAccept,contentType,etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified')};
          } else if(response.status===200) {
            if(!matchesRepresentation(contentType,selectedAccept)){await response.body?.cancel();throw failure('cellar_type','CELLAR returned an unexpected representation.');}
            const buffer=await limitedCellarBody(response,maximum);signal.throwIfAborted();
            return {status:200,url:target,accept:selectedAccept,contentType,buffer,etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified')};
          } else await response.body?.cancel();
          throw failure(response.status===300?'cellar_multipart':response.status===404||response.status===406?'cellar_unavailable':'cellar_http','The requested CELLAR representation is unavailable.');
        },{origin:new URL(initial).origin,priority:'interactive',signal});
        if(result.redirect){target=result.redirect;redirects++;continue;}
        if(result.advertisement){negotiation=result.advertisement;selectedAccept=negotiation.advertisedAccept;selectedValidators={};continue;}
        return {...result,...(negotiation?{negotiation}:{})};
      }
    }catch(error){if(negotiation)error.negotiation=negotiation;throw error;}finally{budget.dispose();}
  }
  async candidates(celex) {
    const query=proposalCandidatesSparql(celex),url=new URL('https://publications.europa.eu/webapi/rdf/sparql');
    url.searchParams.set('query',query);url.searchParams.set('format','application/sparql-results+json');
    return this.sources.get(url.href,{freshMs:CELLAR_LIMITS.metadataFreshMs,validate:record=>{
      if(!Array.isArray(record.data?.results?.bindings)||record.data.results.bindings.length>65||record.data.results.bindings.some(row=>!row||row.work?.type!=='uri'||!CELLAR_WORK_PATTERN.test(row.work.value)||['celex','version'].some(key=>row[key]&&(row[key].type!=='literal'||typeof row[key].value!=='string'))))throw failure('cellar_candidates','Invalid proposal candidate metadata.');
    }});
  }
  async metadata(celex) {
    if(/^[03]/.test(celex))existingLawCelex(celex);else if(celex?.includes('AG'))councilCelex(celex);else proposalCelex(celex);
    const encoded=encodeURIComponent(celex).replaceAll('(','%28').replaceAll(')','%29'),url=`https://publications.europa.eu/resource/celex/${encoded}`;
    return waitForRequest(this.sources.cache.get(['proposal-tree-v1',celex],async()=>{
      const result=await this.request(url,{accept:'application/rdf+xml;notice=tree'});
      if(result.status!==200)throw failure('cellar_metadata','The proposal metadata is unavailable.');
      const xml=result.buffer.toString('utf8');validateTree(xml,celex);
      return {url,resolvedSourceUrl:result.url,fetchedAt:new Date(this.clock()).toISOString(),xml};
    },{freshMs:CELLAR_LIMITS.metadataFreshMs,validate:record=>{if(record.url!==url||!Number.isFinite(Date.parse(record.fetchedAt)))throw failure('cellar_metadata','Invalid saved proposal metadata.');validateTree(record.xml,celex);}}));
  }
  remember(key,record) {
    if(this.memory.has(key))this.bytes-=this.memory.get(key).buffer.length;
    this.memory.delete(key);this.memory.set(key,record);this.bytes+=record.buffer.length;
    while(this.memory.size>32||this.bytes>CELLAR_LIMITS.memoryBytes){const first=this.memory.keys().next().value;this.bytes-=this.memory.get(first).buffer.length;this.memory.delete(first);}
  }
  async stored(key,identity) {
    if(this.memory.has(key)){const value=this.memory.get(key);this.memory.delete(key);this.memory.set(key,value);this.disk?.used(key+'.json');this.disk?.used(value.source.sha256+'.blob');return value;}
    if(!this.directory)return null;
    try {
      const file=path.join(this.directory,key+'.json');if((await stat(file)).size>8192)return null;
      const source=JSON.parse(await readFile(file,'utf8')),[celex,language,itemId,format]=JSON.parse(identity);
      if(source.schemaVersion!==1||source.key!==key||source.identity!==identity||source.celex!==celex||source.language!==language||source.itemId!==itemId||source.url!==cellarTransportUrl(itemId,{redirect:true})||cellarTransportUrl(source.resolvedSourceUrl)!==source.url||source.format!==format.toUpperCase()||!/^[a-f0-9]{64}$/.test(source.sha256)||!Number.isFinite(Date.parse(source.checkedAt))||!Number.isFinite(Date.parse(source.fetchedAt)))return null;
      if(source.accept!=null&&(![format==='docx'?CELLAR_DOCX_MIME:'application/xhtml+xml',...(format==='docx'?[CELLAR_DECLARED_DOCX_MIME]:[])].includes(source.accept)||!matchesRepresentation(source.contentType,source.accept)))return null;
      if(source.accept===CELLAR_DECLARED_DOCX_MIME&&(!source.negotiation||source.negotiation.url!==source.url||source.negotiation.status!==406||source.negotiation.request?.accept!==CELLAR_DOCX_MIME||source.negotiation.advertisedAccept!==CELLAR_DECLARED_DOCX_MIME||source.negotiation.request?.language!==language.split('/').at(-1).toLowerCase()||!/^[a-f0-9]{64}$/.test(source.negotiation.sha256)))return null;
      const blob=source.sha256+'.blob';if((await stat(path.join(this.directory,blob))).size>CELLAR_LIMITS.itemBytes)return null;
      const buffer=await readFile(path.join(this.directory,blob));if(hash(buffer)!==source.sha256)return null;
      this.disk.used(key+'.json');this.disk.used(blob);const record={source,buffer};this.remember(key,record);return record;
    }catch{return null;}
  }
  async save(key,record) {
    requestSignal()?.throwIfAborted();this.remember(key,record);
    if(this.directory)try {
      const blob=record.source.sha256+'.blob';await writeCacheFile(path.join(this.directory,blob),record.buffer);await this.disk.saved(blob,record.buffer.length);
      const json=JSON.stringify(record.source);await writeCacheFile(path.join(this.directory,key+'.json'),json);await this.disk.saved(key+'.json',Buffer.byteLength(json));
    }catch{/* Reproducible disk cache failures do not discard valid in-memory content. */}
    return record;
  }
  async docx({celex,language,itemId,expressionId,manifestationId}) {
    return this.content({celex,language,itemId,expressionId,manifestationId,format:'DOCX'});
  }
  async content({celex,language,itemId,expressionId,manifestationId,format='DOCX'}) {
    const mime=format==='DOCX'?CELLAR_DOCX_MIME:format==='XHTML'?'application/xhtml+xml':null;
    if(!mime)throw failure('cellar_format','Unsupported CELLAR format.');
    if(format==='DOCX')proposalCelex(celex);else if(/^[03]/.test(celex))existingLawCelex(celex);else councilCelex(celex);
    const url=cellarTransportUrl(itemId,{redirect:true});
    if(!/\/DOC_\d+$/.test(url)||!/^http:\/\/publications\.europa\.eu\/resource\/authority\/language\/[A-Z]{3}$/.test(language))throw failure('cellar_item','Invalid proposal item identity.');
    const identity=JSON.stringify([celex,language,itemId,format.toLowerCase()]),key=hash(identity);requestSignal()?.throwIfAborted();
    if(this.pending.has(key))return waitForRequest(this.pending.get(key));
    const task=sharedRequest(async owner=>{
      const old=await this.stored(key,identity),age=old?this.clock()-Date.parse(old.source.checkedAt):Infinity;
      if(old&&age>=0&&age<=this.freshMs)return {...old,source:{...old.source,stale:false,refreshError:null}};
      const failureAt=this.failures.get(key);
      if(old&&failureAt&&this.clock()-failureAt.at<60_000)return {...old,source:{...old.source,stale:true,refreshError:failureAt.code}};
      try {
        const acquire=()=>this.request(url,{accept:old?.source.accept||mime,language:language.split('/').at(-1).toLowerCase(),validators:old?.source,maximum:CELLAR_LIMITS.itemBytes});
        const result=format==='XHTML'?await this.structuredQueue.run(acquire,{signal:owner}):await acquire();
        if(result.status===304&&(!old||(old.source.accept||mime)!==result.accept))throw failure('cellar_validator','CELLAR returned a validator without matching saved content.');
        const buffer=result.status===304?old.buffer:result.buffer;
        try{if(format==='DOCX'){if(result.accept===CELLAR_DECLARED_DOCX_MIME)validateNegotiatedDocx(buffer);else docxParts(buffer);}else parsePublicLegalXhtml(buffer,{language:languageCode(language),sourceUrl:url});}catch{throw failure(format==='DOCX'?'cellar_docx':'cellar_content','The source is not a supported legal document.');}
        const now=new Date(this.clock()).toISOString(),source={schemaVersion:1,key,identity,url,resolvedSourceUrl:result.url,celex,language,itemId,expressionId,manifestationId,format,accept:result.accept,contentType:result.contentType??(result.status===304?old?.source.contentType:null)??null,...(result.negotiation||old?.source.negotiation?{negotiation:result.negotiation||old.source.negotiation}:{}),sha256:hash(buffer),etag:result.etag??(result.status===304?old?.source.etag:null)??null,lastModified:result.lastModified??(result.status===304?old?.source.lastModified:null)??null,fetchedAt:result.status===304?old.source.fetchedAt:now,checkedAt:now,stale:false,refreshError:null};
        const record=await this.save(key,{source,buffer});this.failures.delete(key);return record;
      }catch(error) {
        owner.throwIfAborted();
        if(error?.code==='request_cancelled')throw error;
        this.failures.delete(key);this.failures.set(key,{at:this.clock(),code:error.code||'cellar_error'});while(this.failures.size>32)this.failures.delete(this.failures.keys().next().value);
        if(old)return {...old,source:{...old.source,stale:true,refreshError:error.code||'cellar_error'}};
        throw error;
      }
    },45_000).finally(()=>this.pending.delete(key));
    this.pending.set(key,task);return waitForRequest(task);
  }
}

const array=value=>value==null?[]:Array.isArray(value)?value:[value];
// Tree notices spread properties across owl:sameAs descriptions. Preserve RDF
// identities and merge only explicit aliases; never infer suffixes or title joins.
export function cellarGraph(xml) {
  if(typeof xml!=='string'||Buffer.byteLength(xml)>CELLAR_LIMITS.metadataBytes||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw failure('cellar_metadata','Invalid CELLAR metadata tree.');
  const parsed=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,trimValues:true}).parse(xml);
  const descriptions=array(parsed.RDF?.Description);if(!descriptions.length||descriptions.length>12000)throw failure('cellar_metadata','Unsupported CELLAR metadata tree.');
  const graph=new Map();
  for(const description of descriptions) {
    const id=description['@_about'];if(description['@_nodeID']!=null)continue;if(typeof id!=='string')throw failure('cellar_metadata','A CELLAR description has no identity.');
    const record=graph.get(id)||new Map();graph.set(id,record);
    for(const [name,values] of Object.entries(description))if(!name.startsWith('@_'))for(const v of array(values)) {
      const value=typeof v==='object'?v['@_resource']??v['#text']:v;
      if(typeof value!=='string')continue;
      if(!record.has(name))record.set(name,new Set());record.get(name).add(value);
    }
  }
  const aliases=new Map([...graph.keys()].map(id=>[id,new Set([id])]));
  for(const [id,record] of graph)for(const other of record.get('sameAs')||[]) {
    const group=new Set([...(aliases.get(id)||[id]),...(aliases.get(other)||[other])]);for(const alias of group)aliases.set(alias,group);
  }
  return {graph,values(id,name){return [...new Set([...(aliases.get(id)||[id])].flatMap(alias=>[...(graph.get(alias)?.get(name)||[])]))];},aliases(id){return [...(aliases.get(id)||[id])];}};
}

function validateTree(xml,celex) {
  const graph=cellarGraph(xml);
  if(![...graph.graph.keys()].some(id=>CELLAR_WORK_PATTERN.test(id)&&graph.values(id,'resource_legal_id_celex').includes(celex)))throw failure('cellar_metadata','The metadata tree does not identify the requested proposal.');
}

export function proposalCandidatesSparql(celex) {
  proposalCelex(celex);const year=celex.slice(1,5),number=String(Number(celex.slice(7)));
  return `PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
PREFIX xsd:<http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?work ?celex ?version WHERE {
 { ?work cdm:resource_legal_id_celex "${celex}"^^xsd:string }
 UNION { ?work cdm:resource_legal_internal_number_prefix ?prefix; cdm:resource_legal_internal_number_year ?year; cdm:resource_legal_internal_number_sequential_number ?number.
 FILTER(str(?prefix)="COM" && str(?year)="${year}" && str(?number)="${number}") }
 FILTER(regex(str(?work),"^http://publications[.]europa[.]eu/resource/cellar/[a-f0-9-]{36}$"))
 OPTIONAL { ?work cdm:resource_legal_id_celex ?celex }
 OPTIONAL { ?work cdm:work_version ?version }
} LIMIT 65`;
}
