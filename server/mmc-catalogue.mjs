import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {boundedUpstream,upstreamResponseError} from './odp.mjs';
import {writeCacheFile} from './cache-publication.mjs';
import {requestSignal,sharedRequest,waitForRequest,isLocalRequestFailure} from './request-budget.mjs';
import {browserCompatibleUserAgent} from './user-agent.mjs';

export const MMC_BASE='https://api.multimedia.europarl.europa.eu/o/epmp-frontend-rest/v1.0';
const HOUR=3600000, MAX_BYTES=2*1024*1024, PAGE_SIZE=100, MAX_PAGES=10;
const idPattern=/^\d{8}-[A-Z0-9-]{1,80}$/;
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const validTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(value)&&validDate(value.slice(0,10));

export function validateCatalogue(value) {
  // Legacy catalogues used variable page sizes. The ten-page acquisition limit
  // belongs to fetchCatalogue, not to a previously retained complete snapshot.
  if(value?.schemaVersion!==1||value.term!==10||!validDate(value.dateFrom)||!validDate(value.dateTo)||value.dateFrom>value.dateTo||!Number.isFinite(Date.parse(value.fetchedAt))||!Array.isArray(value.records)||value.records.length>1000||value.records.length!==value.total||!Array.isArray(value.sourcePages))throw Error('Invalid catalogue.');
  const ids=new Set();
  for(const row of value.records) {
    if(!idPattern.test(row.id)||ids.has(row.id)||!validTime(row.start)||!validTime(row.end)||row.end<=row.start||row.start.slice(0,10)<value.dateFrom||row.start.slice(0,10)>value.dateTo||typeof row.status!=='string')throw Error('Invalid catalogue record.');
    ids.add(row.id);
  }
  for(const page of value.sourcePages) {
    const url=new URL(page.url);
    if(url.origin!==new URL(MMC_BASE).origin||url.pathname!==new URL(MMC_BASE+'/search').pathname||url.username||url.password||url.hash||page.status!==200)throw Error('Invalid catalogue source.');
  }
  return value;
}

async function boundedText(stream) {
  const chunks=[];let bytes=0;
  for await(const chunk of stream) {
    requestSignal()?.throwIfAborted();
    bytes+=chunk.byteLength;
    if(bytes>MAX_BYTES)throw Error('Recording catalogue exceeded size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function readCatalogue(file) {
  return validateCatalogue(JSON.parse(await boundedText(createReadStream(file,{end:MAX_BYTES,signal:requestSignal()}))));
}

// Each request covers one sitting date. Page metadata must prove a complete,
// consistent walk before any snapshot is published, including an empty result.
export async function fetchCatalogue(date,{fetchImpl=fetch,clock=Date.now}={}) {
  if(!validDate(date))throw Error('Invalid recording date.');
  const records=[],sourcePages=[],ids=new Set();let total,pages;
  for(let page=1;page<=(pages??1);page++) {
    const url=new URL(MMC_BASE+'/search');
    url.search=new URLSearchParams({type:'105',subtype:'2',df:date,dt:date,pagesize:String(PAGE_SIZE),page:String(page)}).toString();
    const {payload,fetchedAt}=await boundedUpstream(async()=>{
      const response=await fetchImpl(url.href,{headers:{Accept:'application/json','User-Agent':browserCompatibleUserAgent('recording catalogue')},credentials:'omit',redirect:'error',signal:AbortSignal.any([requestSignal()??new AbortController().signal,AbortSignal.timeout(25000)])});
      const limited=upstreamResponseError(response,{source:'multimedia'});
      if(limited||response.status!==200){
        await response.body?.cancel();
        throw Object.assign(limited||Error(`Recording search unavailable (${response.status}).`),{catalogueSourceStatus:response.status});
      }
      const payload=JSON.parse(await boundedText(response.body));
      return {payload,fetchedAt:new Date(clock()).toISOString()};
    },{source:'multimedia'});
    const meta=payload?.resultJSON?.response,content=payload?.resultJSON?.content;
    if(String(meta?.code)!=='0'||!Array.isArray(content))throw Error('Invalid recording search response.');
    // The public search omits ALL pagination fields for a successful empty
    // result. Accept that envelope only on the first page, never mid-walk.
    const emptyEnvelope=page===1&&content.length===0&&['totalElements','totalPages','page','pageSize','first','last'].every(key=>!Object.hasOwn(meta,key));
    const count=emptyEnvelope?0:typeof meta.totalElements==='string'&&/^\d+$/.test(meta.totalElements)?Number(meta.totalElements):meta.totalElements;
    const validPageCount=emptyEnvelope||Number.isInteger(meta.totalPages)&&(meta.totalPages===Math.ceil(count/PAGE_SIZE)||count===0&&meta.totalPages===1);
    if(!Number.isSafeInteger(count)||count<0||count>PAGE_SIZE*MAX_PAGES||!validPageCount||!emptyEnvelope&&(meta.page!==page||meta.pageSize!==PAGE_SIZE||meta.first!==(page===1)))throw Error('Invalid recording search pagination.');
    const pageCount=emptyEnvelope?1:Math.max(1,meta.totalPages);
    if(pageCount>MAX_PAGES||total!==undefined&&(count!==total||pageCount!==pages)||!emptyEnvelope&&meta.last!==(page===pageCount)||content.length!==Math.min(PAGE_SIZE,Math.max(0,count-(page-1)*PAGE_SIZE)))throw Error('Incomplete recording search.');
    total=count;pages=pageCount;
    for(const row of content) {
      if(String(row.mediaTypeId)!=='105'||row.categoryName!=='PLENARY'||ids.has(row.mediaBusinessID))throw Error('Invalid recording search identity.');
      ids.add(row.mediaBusinessID);
      records.push({id:row.mediaBusinessID,start:row.EventDateStart,end:row.EventDateEnd,status:row.statusName});
    }
    sourcePages.push({url:url.href,status:200,fetchedAt,normalizedJsonSha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')});
  }
  return validateCatalogue({schemaVersion:1,term:10,dateFrom:date,dateTo:date,fetchedAt:sourcePages.at(-1).fetchedAt,acquisition:'Automatic public Multimedia Centre JSON search; no credentials or HTML scraping.',total,sourcePages,records});
}

export function createCatalogueReader({fetchImpl=fetch,clock=Date.now}={}) {
  const states=new Map();
  let sourceFailure;
  function stateFor(key) {
    let state=states.get(key);
    if(!state){
      if(states.size>=128){const oldest=[...states].find(([,value])=>!value.pending&&!value.loading);if(!oldest)throw Error('Recording catalogue busy.');states.delete(oldest[0]);}
      state={};states.set(key,state);
    }
    return state;
  }
  const ttl=snapshot=>snapshot.records.some(row=>row.status==='RECORDED')?6*HOUR:HOUR;
  const view=state=>({...state.saved,stale:state.legacy===true||clock()-Date.parse(state.saved.fetchedAt)>=ttl(state.saved),refreshInProgress:Boolean(state.pending),refreshError:state.failure?.message??null});
  function refresh(date,directory,state) {
    if(state.pending)return waitForRequest(state.pending);
    const operation=sharedRequest(async signal=>{
      const snapshot=await fetchCatalogue(date,{fetchImpl,clock});
      signal.throwIfAborted();
      if(directory)await writeCacheFile(path.join(directory,'catalogue-dates-v1',date+'.json'),JSON.stringify(snapshot),{signal});
      signal.throwIfAborted();state.saved=snapshot;state.legacy=false;state.failure=null;
    });
    state.pending=operation.catch(error=>{
      // The local queue also reports upstream_busy before a fetch starts.
      // Only an actual HTTP response can impose a source-wide cooldown.
      if(!isLocalRequestFailure(error)||error.catalogueSourceStatus)state.failure={retryAt:Math.max(clock()+HOUR,error.retryAt??0),message:String(error.message).slice(0,200)};
      if([401,403,429,503].includes(error.catalogueSourceStatus))sourceFailure=state.failure;
      throw error;
    }).finally(()=>{state.pending=null;});
    return waitForRequest(state.pending);
  }
  return async(date,directory)=>{
    requestSignal()?.throwIfAborted();
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock());
    if(!validDate(date)||date<'2024-07-16'||date>today)throw Error('Invalid recording date.');
    const state=stateFor((directory??'')+'\0'+date);
    if(!state.loaded) {
      state.loading=true;
      state.loaded=sharedRequest(async()=>{
        if(!directory)return;
        try {
          const saved=await readCatalogue(path.join(directory,'catalogue-dates-v1',date+'.json'));
          if(saved.dateFrom===date&&saved.dateTo===date&&Date.parse(saved.fetchedAt)<=clock()+300000)state.saved=saved;
        } catch { /* Invalid and missing caches both require a new search. */ }
        if(!state.saved)try {
          const legacy=await readCatalogue(path.join(directory,'catalogue-v1.json'));
          if(legacy.records.some(row=>row.start.slice(0,10)===date&&row.status==='RECORDED')){state.saved=legacy;state.legacy=true;}
        } catch { /* The optional legacy snapshot is never overwritten. */ }
      }).catch(error=>{state.loaded=null;throw error;}).finally(()=>{state.loading=false;});
    }
    await waitForRequest(state.loaded);
    const expired=!state.saved||view(state).stale;
    if(expired&&sourceFailure?.retryAt>clock())state.failure=sourceFailure;
    if(expired&&(!state.failure||state.failure.retryAt<=clock())) {
      if(state.saved)void refresh(date,directory,state).catch(()=>{});
      else await refresh(date,directory,state);
    }
    if(!state.saved)throw Error(state.failure?.message??'Recording search unavailable.');
    return view(state);
  };
}

// Resolve fetch at call time so test network isolation and source instrumentation
// apply equally to this loader and existing exact-ID recording reads.
export const recordingCatalogue=createCatalogueReader({fetchImpl:(...args)=>fetch(...args)});
