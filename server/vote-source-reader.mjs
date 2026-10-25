import {createHash} from 'node:crypto';
import {HttpError} from './http-utils.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {requestSignal,isLocalRequestFailure} from './request-budget.mjs';
import {comparable,sourceNodeKey} from './vote-evidence.mjs';
const API='https://data.europarl.europa.eu/api/v2';
const relative=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const sourceError=error=>({code:error?.code||'vote_source_unavailable',message:error?.message||'Parliament source could not be read.'});
export function pageCoverage(){return {state:'unavailable',pages:0,rows:0,stopReason:'not-scanned',error:null,sources:[]};}
export function sourceEvidence(record,payload){
  const fetchedAt=typeof record.fetchedAt==='number'?new Date(record.fetchedAt).toISOString():record.fetchedAt;
  if(!Number.isFinite(Date.parse(fetchedAt)))throw new HttpError(502,'vote_source_provenance','Parliament source has no valid retrieval date.');
  return {url:record.url,fetchedAt,contentHash:digest(payload),stale:record.stale===true,refreshInProgress:record.refreshInProgress===true,refreshError:record.refreshError||null};
}

export class VoteSourceReader {
  async pages(endpoint,params,kind,budget,{heldSitting=false}={}) {
    const coverage=pageCoverage(),nodes=new Map(),evidence=Object.create(null),nodeEvidence=Object.create(null),conflicts=[],size=kind==='decisions'?this.limits.decisionPageSize:this.limits.pageSize;
    const maxPages=this.limits[kind==='catalogue'?'cataloguePages':kind==='decisions'?'decisionPages':kind==='results'?'resultsPages':'agendaPages'];
    let firstPageRows=null;
    for(let page=0;page<maxPages;page++){
      requestSignal()?.throwIfAborted();
      try {
        if(budget.bytes>=this.limits.periodBytes)throw new HttpError(502,'vote_period_budget','The selected period exceeds the bounded source budget.');
        const record=await this.request(endpoint,{...params,limit:size,offset:page*size},{priority:'interactive',staleWhileRevalidate:true,ttl:this.limits.sourceMs});
        requestSignal()?.throwIfAborted();
        const data=record.payload?.data;
        if(!Array.isArray(data)||data.some(node=>!node||typeof node!=='object'||Array.isArray(node)||typeof node.id!=='string'))throw new HttpError(502,'vote_source_shape','Parliament returned an unreadable vote source.');
        const bytes=Buffer.byteLength(JSON.stringify(record.payload));
        if(bytes>this.limits.sourceBytes||budget.bytes+bytes>this.limits.periodBytes)throw new HttpError(502,'vote_source_size','Parliament vote data exceeds the bounded source size.');
        budget.bytes+=bytes;
        // Duplicate rows cannot establish that a response exceeds its limit.
        if(page===0)firstPageRows=new Set(data.map(node=>relative(node.id))).size;
        const source=sourceEvidence(record,record.payload);coverage.sources.push(source);coverage.pages++;
        for(const [index,node] of data.entries()){const hash=sourceNodeKey(node),key=kind==='results'?hash:relative(node.id),path={sourceUrl:source.url,contentHash:source.contentHash,jsonPointer:'/data/'+index};(evidence[key]??=[]).push(path);(nodeEvidence[hash]??=[]).push(path);}
        let added=0;
        const pageNodes=new Map();let changed=false;
        for(const node of data){const key=relative(node.id),previous=pageNodes.get(key)||nodes.get(key);if(previous&&JSON.stringify(comparable(previous))!==JSON.stringify(comparable(node))){conflicts.push(previous,node);changed=true;}pageNodes.set(key,node);}
        if(changed)throw new HttpError(502,'vote_source_changed','Parliament changed a repeated source identity during pagination.');
        for(const [key,node] of pageNodes){if(!nodes.has(key)){if(nodes.size>=this.limits.maxRows){coverage.stopReason='row-budget';break;}nodes.set(key,node);added++;}}
        coverage.rows=nodes.size;
        if(coverage.stopReason==='row-budget'){coverage.state='partial';break;}
        if(data.length&&!added){coverage.state='partial';coverage.stopReason='repeated-page';break;}
        if(!data.length||data.length<size){coverage.state='complete';coverage.stopReason='end';break;}
        coverage.state='partial';coverage.stopReason='page-budget';
      } catch(error){
        if(isLocalRequestFailure(error))throw error;
        if(heldSitting&&page===0&&error.code==='odp_unavailable'&&error.upstreamStatus===404&&error.source?.httpStatus===404){
          const source=error.source,bytes=error.responseBytes;
          const expected=new URL(API+endpoint);for(const [key,value] of Object.entries({...params,limit:size,offset:0,format:'application/ld+json'}))expected.searchParams.set(key,String(value));
          const fetchedAt=typeof source.fetchedAt==='number'&&Number.isFinite(source.fetchedAt)?new Date(source.fetchedAt).toISOString():source.fetchedAt;
          if(source.url===expected.href&&Number.isFinite(Date.parse(fetchedAt))&&/^[a-f0-9]{64}$/.test(source.contentHash)&&Number.isSafeInteger(bytes)&&bytes>=0&&bytes<=this.limits.sourceBytes&&budget.bytes+bytes<=this.limits.periodBytes){
            budget.bytes+=bytes;coverage.state=heldSitting<brusselsDay(this.clock())?'complete':'partial';coverage.stopReason='not-found';coverage.pages=1;
            coverage.sources.push({...source,fetchedAt,stale:false,refreshInProgress:false,refreshError:null});break;
          }
        }
        if(error.code==='odp_no_content'&&coverage.pages){coverage.state='complete';coverage.stopReason='no-content';break;}
        coverage.state=coverage.pages?'partial':'unavailable';coverage.stopReason='error';coverage.error=sourceError(error);break;
      }
    }
    coverage.rows=nodes.size;
    return {nodes:[...nodes.values()],coverage,evidence,nodeEvidence,conflicts,firstPageRows};
  }

}
