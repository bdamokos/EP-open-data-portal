import {createHash} from 'node:crypto';
import {odp,ODP_BASE,odpLanguage} from './odp.mjs';
import {HttpError} from './http-utils.mjs';
import {languageCode} from './ep-links.mjs';
import {sharedRequest,waitForRequest,requestSignal,createRequestBudget,runWithRequestSignal} from './request-budget.mjs';

export const COMMISSION_FOLLOWUPS_VERSION=1;
export const COMMISSION_FOLLOWUPS_LIMITS=Object.freeze({reads:4,timeout:8000,metadataBytes:1024*1024,responseBytes:256*1024,entries:32,ttl:60_000});
const origin='https://data.europarl.europa.eu/';
const canonical=value=>{
  const text=typeof value==='string'?value:value?.id;
  return typeof text==='string'?text.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''):null;
};
const array=value=>Array.isArray(value)?value:value==null?[]:[value];
const spId=value=>{const ref=canonical(value);return /^eli\/dl\/doc\/SP-[A-Za-z0-9](?:[A-Za-z0-9-]{0,118}[A-Za-z0-9])?$/.test(ref||'')?ref.slice(11):null;};
const invalid=()=>new HttpError(502,'invalid_followup_source','Commission follow-up could not be checked.');
const exactWork=(payload,id)=>{
  const nodes=payload?.data;
  if(!Array.isArray(nodes)||nodes.length!==1||canonical(nodes[0]?.id)!=='eli/dl/doc/'+id||nodes[0]?.identifier!==id)throw invalid();
  return nodes[0];
};
const validateTA=(payload,id)=>{const work=exactWork(payload,id);if(canonical(work.work_type)!=='def/ep-document-types/TEXT_ADOPTED')throw invalid();return work;};
const validateReply=(payload,id,ta)=>{
  const work=exactWork(payload,id);
  if(canonical(work.work_type)!=='def/ep-document-types/ACT_FOLLOWUP'||canonical(work.answers_to)!=='eli/dl/doc/'+ta||!array(work.creator).some(value=>canonical(value)==='org/EU_COMMISSION'))throw invalid();
  return work;
};
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
const media={PDF:'application/pdf',HTML:'text/html',DOCX:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};

export function followupReaderLink(manifestation) {
  const value=manifestation?.is_exemplified_by;
  if(typeof value!=='string'||value.length>2048||/[\s\\%?#\u0000-\u001f\u007f]/.test(value))return null;
  const match=value.match(/^(?:https:\/\/data\.europarl\.europa\.eu\/|\/?)distribution\/doc\/([A-Za-z0-9][A-Za-z0-9_-]*\.(pdf|html|docx))$/);
  if(!match)return null;
  const format=match[2].toUpperCase();
  if(manifestation.format!=null&&!['http://publications.europa.eu/resource/authority/file-type/'+format,'https://publications.europa.eu/resource/authority/file-type/'+format].includes(manifestation.format))return null;
  if(manifestation.media_type!=null&&!['https://www.iana.org/assignments/media-types/'+media[format],'http://www.iana.org/assignments/media-types/'+media[format],media[format]].includes(manifestation.media_type))return null;
  return {url:origin+'distribution/doc/'+match[1],format};
}

export function commissionFollowupsQuery(id,params) {
  if(!/^TA-10-\d{4}-\d{4,6}$/.test(id))throw new HttpError(400,'invalid_document','Choose an adopted text.');
  for(const key of params.keys())if(key!=='lang'||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated query parameter.');
  return {id,language:odpLanguage(params.get('lang')||'en')};
}

export class CommissionFollowups {
  constructor({request=odp,clock=Date.now,limits={}}={}){Object.assign(this,{request,clock});this.limits={...COMMISSION_FOLLOWUPS_LIMITS,...limits};this.pending=new Map();this.cache=new Map();}
  async query(query) {
    requestSignal()?.throwIfAborted();
    const key=JSON.stringify(query),saved=this.cache.get(key);
    if(saved?.until>this.clock())return saved.value;
    this.cache.delete(key);
    let job=this.pending.get(key);
    if(!job){
      job=sharedRequest(async signal=>{
        const budget=createRequestBudget(this.limits.timeout);
        let value;
        try {value=await runWithRequestSignal(budget.signal,()=>this.collect(query));}finally{budget.dispose();}
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
  async collect({id,language}) {
    const result={version:COMMISSION_FOLLOWUPS_VERSION,documentId:id,requestedLanguage:language,status:'unavailable',relationshipObservation:'unobserved',declaredCount:null,checkedCount:0,truncated:false,items:[],gaps:[],sources:[]};
    let bytes=0;
    const gap=(reason,reply=null)=>{if(!result.gaps.some(g=>g.reason===reason&&g.id===reply))result.gaps.push({id:reply,reason});};
    const read=async(endpoint,validate)=>{
      requestSignal()?.throwIfAborted();
      const record=await waitForRequest(this.request(endpoint,{}, {staleWhileRevalidate:true,validate}));
      requestSignal()?.throwIfAborted();
      const raw=JSON.stringify(record.payload);bytes+=Buffer.byteLength(raw);
      if(bytes>this.limits.metadataBytes)throw Object.assign(invalid(),{code:'followup_metadata_budget'});
      const source={url:record.url||ODP_BASE+endpoint+'?format=application%2Fld%2Bjson',fetchedAt:new Date(record.fetchedAt).toISOString(),stale:Boolean(record.stale),refreshInProgress:Boolean(record.refreshInProgress),refreshError:record.refreshError||null,contentHash:createHash('sha256').update(raw).digest('hex')};
      result.sources.push(source);
      return {work:validate(record.payload),source};
    };
    let work;
    try {({work}=await read('/adopted-texts/'+id,payload=>validateTA(payload,id)));}
    catch(error){requestSignal()?.throwIfAborted();if(error.code!=='followup_metadata_budget')throw error;result.truncated=true;result.status='partial';gap('metadata-budget');return result;}
    const inverse=work.inverse_answers_to;
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
