import {sittingSnapshots} from './sitting-snapshot-store.mjs';
import {createHash} from 'node:crypto';
import {HttpError} from './http-utils.mjs';
import {odp,odpLanguage} from './odp.mjs';
import {CURRENT_TERM_START,brusselsDay} from './analysis-period.mjs';
import {calendarDate,identifiedPlenarySitting,isPlenarySitting} from './plenary-calendar.mjs';
import {requestSignal,sharedRequest,waitForRequest,isLocalRequestFailure} from './request-budget.mjs';

export const MEMBER_ATTENDANCE_VERSION=1;
export const MEMBER_ATTENDANCE_LIMITS=Object.freeze({maxSittings:5,sourceMs:15*60_000,sourceBytes:1024*1024,cacheEntries:32,cacheBytes:2*1024*1024,timeoutMs:50_000});
const relative=value=>typeof value==='string'?value.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''):typeof value?.id==='string'?relative(value.id):'';
const list=value=>Array.isArray(value)?value:value==null?[]:[value];
const positiveId=value=>typeof value==='string'&&/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value));
const documentId=sittingId=>'PV-10-'+sittingId.slice(7)+'-ATT';
const empty=()=>({status:'unavailable',excusedSupplied:false,presentIds:[],excusedIds:[],conflictingIds:[],counts:{present:null,excused:null,duplicatePresent:0,duplicateExcused:0,malformedReferences:0},identityValid:false,registerLinked:false});

export function memberAttendanceQuery(search,{now=Date.now()}={}) {
  for(const key of search.keys())if(!['sittings','lang'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated attendance parameter.');
  const sittings=(search.get('sittings')||'').split(','),today=brusselsDay(now);
  if(sittings.length<1||sittings.length>MEMBER_ATTENDANCE_LIMITS.maxSittings||new Set(sittings).size!==sittings.length||sittings.some(id=>!/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(id)||!calendarDate(id.slice(7))||id.slice(7)<CURRENT_TERM_START||id.slice(7)>today))throw new HttpError(400,'invalid_sittings','Choose one to five unique held current-term sitting identifiers.');
  return {sittings:sittings.sort(),language:odpLanguage(search.get('lang')??'en')};
}

// Extraction is member-independent. Incomplete lists never establish a negative.
export function extractAttendance(payload,sittingId) {
  const result=empty(),data=payload?.data;
  if(!Array.isArray(data))return result;
  const matches=data.filter(node=>relative(node?.id)==='eli/dl/event/'+sittingId);
  if(matches.length!==1||!identifiedPlenarySitting(matches[0])||!isPlenarySitting(matches[0]))return result;
  const node=matches[0];result.identityValid=true;
  result.registerLinked=list(node.recorded_in_a_realization_of).some(ref=>relative(ref)==='eli/dl/doc/'+documentId(sittingId));
  const supplied=Object.hasOwn(node,'had_participant_person');
  result.excusedSupplied=Object.hasOwn(node,'had_excused_person');
  if(!supplied){result.status=result.registerLinked?'unavailable':'not-published';return result;}
  function ids(field,duplicateKey) {
    const values=node[field],found=new Set();
    if(!Array.isArray(values)){result.counts.malformedReferences++;return [];}
    for(const value of values){const match=/^person\/([1-9]\d*)$/.exec(relative(value));if(!match||!positiveId(match[1])){result.counts.malformedReferences++;continue;}if(found.has(match[1]))result.counts[duplicateKey]++;found.add(match[1]);}
    return [...found].sort((a,b)=>Number(a)-Number(b));
  }
  result.presentIds=ids('had_participant_person','duplicatePresent');
  if(result.excusedSupplied)result.excusedIds=ids('had_excused_person','duplicateExcused');
  result.counts.present=result.presentIds.length;
  result.counts.excused=result.excusedSupplied?result.excusedIds.length:null;
  result.conflictingIds=result.presentIds.filter(id=>result.excusedIds.includes(id));
  result.status=Array.isArray(node.had_participant_person)&&node.had_participant_person.length===0?'unavailable':result.counts.malformedReferences?'partial':'observed';
  return result;
}

function pdfUrl(value) {
  if(typeof value!=='string')return null;
  try {const url=new URL(value,'https://data.europarl.europa.eu/');return url.protocol==='https:'&&url.hostname==='data.europarl.europa.eu'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/distribution\/.+\.pdf$/i.test(url.pathname)?url.href:null;}catch{return null;}
}
export function attendanceRegister(payload,sittingId,language='en') {
  const id=documentId(sittingId),uri='eli/dl/doc/'+id;
  const matches=Array.isArray(payload?.data)?payload.data.filter(node=>relative(node?.id)===uri):[];
  if(matches.length!==1)return null;
  const node=matches[0],links=list(node.inverse_recorded_in_a_realization_of).map(relative);
  if(node.identifier!==id||relative(node.work_type).split('/').at(-1)!=='LIST_ATTEND_PLENARY'||node.document_date!==sittingId.slice(7)||links.length!==1||links[0]!=='eli/dl/event/'+sittingId)return null;
  const candidates=[];
  for(const expression of list(node.is_realized_by)) {
    const expressionId=relative(expression?.id),code=expressionId.slice(uri.length+1);
    if(!expressionId.startsWith(uri+'/')||!(/^[a-z]{2}$/).test(code))continue;
    for(const manifestation of list(expression.is_embodied_by)) {
      if(relative(manifestation?.id)!==expressionId+'/pdf'||String(manifestation.format).split('/').at(-1)!=='PDF')continue;
      const url=pdfUrl(manifestation.is_exemplified_by);
      if(url)candidates.push({pdf:{url,language:code},issued:typeof manifestation.issued==='string'&&Number.isFinite(Date.parse(manifestation.issued))?manifestation.issued:null});
    }
  }
  const preferred=candidates.filter(candidate=>candidate.pdf.language===language),english=candidates.filter(candidate=>candidate.pdf.language==='en');
  const chosen=preferred.length===1?preferred[0]:english.length===1?english[0]:null;
  return {documentId:id,pdf:chosen?.pdf||null,issued:chosen?.issued||null,status:'available'};
}

function sourceEvidence(record,sourceBytes) {
  const serialized=JSON.stringify(record.payload);
  if(Buffer.byteLength(serialized)>sourceBytes)throw new HttpError(502,'attendance_source_size','The attendance source exceeds the bounded size.');
  const fetchedAt=typeof record.fetchedAt==='number'?new Date(record.fetchedAt).toISOString():record.fetchedAt;
  if(typeof record.url!=='string'||!Number.isFinite(Date.parse(fetchedAt)))throw new HttpError(502,'attendance_source_provenance','The attendance source has no valid retrieval date.');
  return {url:record.url,fetchedAt,contentHash:createHash('sha256').update(serialized).digest('hex'),stale:record.stale===true,refreshInProgress:record.refreshInProgress===true,refreshError:record.refreshError||null};
}

export class MemberAttendance {
  constructor({request=odp,limits={},snapshots=request===odp?sittingSnapshots:null}={}){this.diskSnapshots=snapshots;this.request=request;this.limits={...MEMBER_ATTENDANCE_LIMITS,...limits};this.extractions=new Map();this.cacheBytes=0;this.pending=new Map();}
  extraction(payload,sittingId,hash) {
    const key=sittingId+':'+hash,old=this.extractions.get(key);if(old)return old.value;
    const value=extractAttendance(payload,sittingId),bytes=Buffer.byteLength(JSON.stringify(value));
    // Retain only the current content for a sitting, without a historical-settling assumption.
    for(const [cached,entry] of this.extractions)if(cached.startsWith(sittingId+':')){this.extractions.delete(cached);this.cacheBytes-=entry.bytes;}
    if(bytes<=this.limits.cacheBytes){this.extractions.set(key,{value,bytes});this.cacheBytes+=bytes;}
    while(this.extractions.size>this.limits.cacheEntries||this.cacheBytes>this.limits.cacheBytes){const oldest=this.extractions.keys().next().value;this.cacheBytes-=this.extractions.get(oldest).bytes;this.extractions.delete(oldest);}
    return value;
  }
  async loadInputs(sittingId) {
    let extracted=empty(),source=null;
    const registers={},register={documentId:documentId(sittingId),pdf:null,issued:null,status:'unavailable',source:null};
    try {
      const record=await this.request('/meetings/'+sittingId,{}, {priority:'interactive',staleWhileRevalidate:true,ttl:this.limits.sourceMs});
      requestSignal()?.throwIfAborted();source=sourceEvidence(record,this.limits.sourceBytes);
      extracted=this.extraction(record.payload,sittingId,source.contentHash);
    }catch(error){if(isLocalRequestFailure(error)||requestSignal()?.aborted)throw error;}
    if(extracted.status==='not-published')register.status='not-published';
    if(extracted.identityValid&&extracted.registerLinked)try {
      const record=await this.request('/plenary-session-documents/'+register.documentId,{}, {priority:'interactive',staleWhileRevalidate:true,ttl:this.limits.sourceMs});
      requestSignal()?.throwIfAborted();const evidence=sourceEvidence(record,this.limits.sourceBytes),metadata=attendanceRegister(record.payload,sittingId,'en');
      if(metadata){
        Object.assign(register,metadata,{source:evidence});
        const codes=new Set(list(record.payload.data).flatMap(node=>list(node?.is_realized_by).map(expression=>relative(expression?.id).split('/').at(-1))).filter(code=>/^[a-z]{2}$/.test(code)));
        for(const code of codes)registers[code]={...attendanceRegister(record.payload,sittingId,code),source:evidence};
      }
    }catch(error){if(requestSignal()?.aborted)throw error;/* Optional metadata cannot revoke the meeting observation. */}
    return {extracted,source,register,registers};
  }
  async load(sittingId,language) {
    let inputs=this.diskSnapshots?.read('attendance',MEMBER_ATTENDANCE_VERSION,sittingId);
    if(!inputs){this.diskSnapshots?.enqueue('attendance',MEMBER_ATTENDANCE_VERSION,sittingId);inputs=await this.loadInputs(sittingId);}
    const {extracted,source,register,registers}=inputs;
    return {extracted,source,register:registers[language]||register};
  }
  async sitting(sittingId,language) {
    const key=sittingId+':'+language;
    if(!this.pending.has(key)){const job=sharedRequest(()=>this.load(sittingId,language),this.limits.timeoutMs).finally(()=>this.pending.delete(key));this.pending.set(key,job);}
    return waitForRequest(this.pending.get(key));
  }
  async query(memberId,query) {
    const id=String(memberId);if(!positiveId(id))throw new HttpError(400,'invalid_id','Use a positive person identifier.');
    const sittings=[];
    for(const sittingId of query.sittings){
      requestSignal()?.throwIfAborted();
      const {extracted,source,register}=await this.sitting(sittingId,query.language);requestSignal()?.throwIfAborted();
      const {status,excusedSupplied,counts,conflictingIds}=extracted;
      const memberStatus=status!=='observed'?null:conflictingIds.includes(id)?'conflicting':extracted.presentIds.includes(id)?'listed-present':extracted.excusedIds.includes(id)?'listed-excused':'not-listed';
      sittings.push({sittingId,date:sittingId.slice(7),status,memberStatus,excusedSupplied,counts,conflictingIds,source,register});
    }
    return {version:MEMBER_ATTENDANCE_VERSION,member:{id,mandateStatus:'not-assessed'},sittings,attribution:'European Parliament Open Data API v2, CC BY 4.0'};
  }
}
export const memberAttendance=new MemberAttendance();
