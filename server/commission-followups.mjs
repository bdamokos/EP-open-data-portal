import {createHash} from 'node:crypto';
import {odp,ODP_BASE,odpLanguage} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {languageCode} from './ep-links.mjs';
import {sharedRequest,waitForRequest,requestSignal,createRequestBudget,runWithRequestSignal,isLocalRequestFailure} from './request-budget.mjs';

export const COMMISSION_FOLLOWUPS_VERSION=2;
export const COMMISSION_FOLLOWUPS_LIMITS=Object.freeze({reads:4,timeout:8000,metadataBytes:1024*1024,responseBytes:256*1024,entries:32,ttl:60_000});
import {spId,validateTA,validateReply,followupReaderLink,adoptedTextProjectionVersion} from './commission-followups-model.mjs';
import {retainedCommissionFollowups} from './commission-followups-index.mjs';
export {followupReaderLink} from './commission-followups-model.mjs';
const array=value=>Array.isArray(value)?value:value==null?[]:[value];
const invalid=()=>new HttpError(502,'invalid_followup_source','Commission follow-up could not be checked.');
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;

export function commissionFollowupsQuery(id,params) {
  if(!/^TA-10-\d{4}-\d{4,6}$/.test(id))throw new HttpError(400,'invalid_document','Choose an adopted text.');
  for(const key of params.keys())if(key!=='lang'||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated query parameter.');
  return {id,language:odpLanguage(params.get('lang')||'en')};
}

export class CommissionFollowups {
  constructor({request=odp,readCached=request===odp?odp:null,clock=Date.now,limits={}}={}){Object.assign(this,{request,readCached,clock});this.limits={...COMMISSION_FOLLOWUPS_LIMITS,...limits};this.pending=new Map();this.cache=new Map();}
  async query(query,{store=null}={}) {
    requestSignal()?.throwIfAborted();
    const retained=retainedCommissionFollowups(store,query,this.limits);
    const key=createHash('sha256').update(JSON.stringify({query,retained})).digest('hex'),saved=this.cache.get(key);
    if(saved?.until>this.clock())return saved.value;
    this.cache.delete(key);
    let job=this.pending.get(key);
    if(!job){
      job=sharedRequest(async signal=>{
        const budget=createRequestBudget(this.limits.timeout);
        let value;
        try {value=await runWithRequestSignal(budget.signal,()=>this.collect(query,retained));}finally{budget.dispose();}
        signal.throwIfAborted();
        if(!value.gaps.length&&!value.sources.some(source=>source.stale||source.refreshInProgress||source.refreshError)){
          while(this.cache.size>=this.limits.entries)this.cache.delete(this.cache.keys().next().value);
          this.cache.set(key,{value,until:this.clock()+this.limits.ttl});
        }
        return value;
      },this.limits.timeout+250).finally(()=>{if(this.pending.get(key)===job)this.pending.delete(key);});
      this.pending.set(key,job);
    }
    return waitForRequest(job);
  }
  async collect({id,language},retained=null) {
    const result={version:COMMISSION_FOLLOWUPS_VERSION,documentId:id,requestedLanguage:language,status:'unavailable',relationshipObservation:'unobserved',declaredCount:null,checkedCount:0,truncated:false,items:[],gaps:[],sources:[]};
    let bytes=0;
    const gap=(reason,reply=null)=>{if(!result.gaps.some(g=>g.reason===reason&&g.id===reply))result.gaps.push({id:reply,reason});};
    const read=async(endpoint,validate)=>{
      requestSignal()?.throwIfAborted();
      if(retained?.budgetEndpoint===endpoint)throw Object.assign(invalid(),{code:'followup_metadata_budget'});
      const saved=retained?.records.find(record=>record.endpoint===endpoint),root=endpoint==='/adopted-texts/'+id;
      let record=saved?.record,projection=Boolean(saved),rejected=null;
      if(record)try{validate(record.payload);}catch(error){rejected=error;}
      const lossyRoot=root&&record&&(record.payload.data[0].adoptionProjectionVersion!==adoptedTextProjectionVersion||!Array.isArray(record.payload.data[0].followupRelationships));
      // A richer already-retained raw record must not be suppressed by a lossy
      // index projection. cachedOnly never refreshes or joins an upstream job.
      if(retained&&this.readCached&&(!record||rejected||lossyRoot))try {
        const cached=await waitForRequest(this.readCached(endpoint,{}, {cachedOnly:true,validate}));
        requestSignal()?.throwIfAborted();const work=validate(cached.payload),at=new Date(cached.fetchedAt).valueOf();
        const older=Boolean(saved)&&at<new Date(saved.record.fetchedAt).valueOf();
        if(Number.isFinite(at)&&(!root||Array.isArray(work.inverse_answers_to)&&(!older||work.inverse_answers_to.length))) {
          if(saved){bytes+=Buffer.byteLength(JSON.stringify(saved.record.payload));result.sources.push(saved.source);}
          if(rejected)gap('record-unverified',root?null:endpoint.slice('/external-documents/'.length));
          if(root&&older)gap('relationship-observation-stale');
          record=cached;projection=false;rejected=null;
        }
      }catch(error){requestSignal()?.throwIfAborted();if(isLocalRequestFailure(error))throw error;}
      if(rejected)throw rejected;
      if(retained&&!record)throw new HttpError(503,'followup_pending','Commission follow-up could not be checked.');
      if(!record)record=await waitForRequest(this.request(endpoint,{}, {staleWhileRevalidate:true,validate}));
      requestSignal()?.throwIfAborted();
      const raw=JSON.stringify(record.payload);bytes+=Buffer.byteLength(raw);
      if(bytes>this.limits.metadataBytes)throw Object.assign(invalid(),{code:'followup_metadata_budget'});
      const source=projection?saved.source:{url:record.url||ODP_BASE+endpoint+'?format=application%2Fld%2Bjson',fetchedAt:new Date(record.fetchedAt).toISOString(),stale:Boolean(record.stale),refreshInProgress:Boolean(record.refreshInProgress),refreshError:record.refreshError||null,contentHash:createHash('sha256').update(raw).digest('hex'),...(retained?{representation:'retained-odp-cache-record'}:{})};
      result.sources.push(source);
      return {work:validate(record.payload),source,projection};
    };
    if(retained?.metadataBudget){result.truncated=true;result.status='partial';gap('metadata-budget');return result;}
    let work,projection;
    try {({work,projection}=await read('/adopted-texts/'+id,payload=>validateTA(payload,id)));}
    catch(error){requestSignal()?.throwIfAborted();if(error.code!=='followup_metadata_budget')throw error;result.truncated=true;result.status='partial';gap('metadata-budget');return result;}
    const inverse=projection?(work.adoptionProjectionVersion===adoptedTextProjectionVersion?work.followupRelationships:undefined):work.inverse_answers_to;
    if(retained&&inverse==null)gap('lookup-failed');
    if(inverse==null)return result;
    if(!Array.isArray(inverse)){gap('malformed-relationships');return result;}
    result.relationshipObservation='observed';result.declaredCount=inverse.length;
    if(!inverse.length){result.status='none-listed';return result;}
    const ids=new Set();
    for(const value of inverse){const reply=spId(value);if(reply)ids.add(reply);else gap('unrecognised-relationship');}
    for(const reply of ids){
      if(result.checkedCount>=this.limits.reads){result.truncated=true;gap('document-budget');break;}
      result.checkedCount++;
      try {
        const {work,source}=await read('/external-documents/'+reply,payload=>validateReply(payload,reply,id));
        const files=[];let declaredFiles=0;
        for(const expression of array(work.is_realized_by)){
          const languageUri=typeof expression?.language==='string'?expression.language:null,code=languageCode(languageUri);
          for(const manifestation of array(expression?.is_embodied_by)){
            declaredFiles++;const link=followupReaderLink(manifestation);
            if(!link||!code||typeof expression?.id!=='string'||typeof manifestation?.id!=='string'){gap(!link?'file-rejected':!code?'file-language-unavailable':'file-identity-unavailable',reply);continue;}
            const size=manifestation.byteSize;
            files.push({expressionId:expression.id,manifestationId:manifestation.id,language:code,languageUri,...link,issued:typeof manifestation.issued==='string'?manifestation.issued:null,byteSize:(typeof size==='number'||typeof size==='string'&&/^\d+$/.test(size))&&Number.isSafeInteger(Number(size))&&Number(size)>=0?Number(size):null});
          }
        }
        if(!files.length&&!declaredFiles)gap('file-unavailable',reply);
        const item={id:reply,documentDate:date(work.document_date),relationship:{from:reply,field:'answers_to',to:id},files,source};
        result.items.push(item);
        if(Buffer.byteLength(JSON.stringify(result))>this.limits.responseBytes){result.items.pop();result.truncated=true;gap('response-budget',reply);break;}
      }catch(error){
        if(error.code==='request_timeout'){result.truncated=true;gap('time-budget',reply);break;}
        requestSignal()?.throwIfAborted();
        if(error.code==='followup_metadata_budget'){result.truncated=true;gap('metadata-budget',reply);break;}
        gap(error.code==='invalid_followup_source'?'record-unverified':'lookup-failed',reply);
      }
    }
    result.items.sort((a,b)=>(a.documentDate||'9999').localeCompare(b.documentDate||'9999')||a.id.localeCompare(b.id));
    result.status=result.gaps.length?'partial':result.items.length?'available':'unavailable';
    return result;
  }
}
export const commissionFollowups=new CommissionFollowups();
