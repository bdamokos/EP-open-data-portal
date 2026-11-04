import {createHash} from 'node:crypto';
import {limitedCellarBody} from './cellar-documents.mjs';
import {extractCouncilDraftPdf} from './council-draft-pdf.mjs';
import {requestSignal} from './request-budget.mjs';
import {upstreamResponseError} from './odp.mjs';
import {userAgent} from './user-agent.mjs';
const caches=new WeakMap();
// Raw acquisition uses the same official-source fetch/admission interface as
// Cellar. The URL is derived from a validated report reference, never supplied
// by an endpoint caller. Keep at most four editions (32 MB raw) per client.
export async function councilDraftSource(documents,identity){
 let cache=caches.get(documents);if(!cache){cache=new Map();caches.set(documents,cache);}
 const old=cache.get(identity.url),now=documents.clock?.()??Date.now();
 if(old&&now-old.time<6*3600_000)return old.value;
 const signal=AbortSignal.any([AbortSignal.timeout(25000),...(requestSignal()?[requestSignal()]:[])]);
 const value=await documents.sources.schedule(async()=>{
  const response=await documents.fetchSource(identity.url,{headers:{Accept:'application/pdf','User-Agent':userAgent('Council draft context')},redirect:'manual',signal});
  const limited=upstreamResponseError(response,{source:new URL(identity.url).origin});
  if(limited){documents.sources.queues?.get(new URL(identity.url).origin)?.backoff(limited.retryAfter);await response.body?.cancel();throw limited;}
  if(response.status!==200||response.headers.get('content-type')?.split(';')[0]!=='application/pdf'){await response.body?.cancel();throw Error('council-draft-pdf-unavailable');}
  const buffer=await limitedCellarBody(response,8*1024*1024),projection=await extractCouncilDraftPdf(buffer,{...identity,sourceUrl:identity.url,signal}),sha256=createHash('sha256').update(buffer).digest('hex');
  const source={url:identity.url,resolvedSourceUrl:identity.url,language:identity.language,format:'PDF',accept:'application/pdf',contentType:'application/pdf',sha256,bytes:buffer.length,fetchedAt:new Date(documents.clock?.()??Date.now()).toISOString(),stale:false};
  await documents.retainResponse?.({url:identity.url,status:200,fetchedAt:source.fetchedAt,request:{accept:'application/pdf'},headers:{'content-type':'application/pdf'}},buffer);
  return {status:'available',language:identity.language,celex:null,workId:identity.url.replace(/\/[a-z]{2}\/pdf$/u,''),gaps:[],evidence:[{kind:'report-council-draft',...identity},{kind:'council-draft-source',...source,decorationHash:projection.proof.decoration.hash,decorationTolerance:projection.proof.decoration.tolerance}],items:[{kind:'act',index:1,format:'PDF',itemId:identity.url,expressionId:null,manifestationId:null,buffer,projection,source}]};
 },{origin:new URL(identity.url).origin,signal});
 cache.set(identity.url,{time:documents.clock?.()??Date.now(),value});while(cache.size>4)cache.delete(cache.keys().next().value);return value;
}
