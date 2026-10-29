import {HttpError} from './http-utils.mjs';

export const adoptedTextProjectionVersion=2;

const origin='https://data.europarl.europa.eu/';
const canonical=value=>{
  const text=typeof value==='string'?value:value?.id;
  return typeof text==='string'?text.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,''):null;
};
const array=value=>Array.isArray(value)?value:value==null?[]:[value];
export const spId=value=>{const ref=canonical(value);return /^eli\/dl\/doc\/SP-[A-Za-z0-9](?:[A-Za-z0-9-]{0,118}[A-Za-z0-9])?$/.test(ref||'')?ref.slice(11):null;};
const invalid=()=>new HttpError(502,'invalid_followup_source','Commission follow-up could not be checked.');
const exactWork=(payload,id)=>{
  const nodes=payload?.data;
  if(!Array.isArray(nodes)||nodes.length!==1||canonical(nodes[0]?.id)!=='eli/dl/doc/'+id||nodes[0]?.identifier!==id)throw invalid();
  return nodes[0];
};
export const validateTA=(payload,id)=>{const work=exactWork(payload,id);if(canonical(work.work_type)!=='def/ep-document-types/TEXT_ADOPTED'||array(work.parliamentary_term).some(term=>canonical(term)!=='org/ep-10'))throw invalid();return work;};
export const validateReply=(payload,id,ta)=>{
  const work=exactWork(payload,id);
  if(canonical(work.work_type)!=='def/ep-document-types/ACT_FOLLOWUP'||canonical(work.answers_to)!=='eli/dl/doc/'+ta||!array(work.creator).some(value=>canonical(value)==='org/EU_COMMISSION'))throw invalid();
  return work;
};
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


// File expression/manifestation IDs are needed by the follow-up reader.
export function projectFollowup(work,adoptedId) {
  const result=Object.fromEntries(['id','identifier','work_type','creator','answers_to','document_date'].filter(key=>Object.hasOwn(work,key)).map(key=>[key,work[key]]));
  result.followupOf=adoptedId;result.followupProjectionVersion=1;
  result.languageVersionsObserved=Object.hasOwn(work,'is_realized_by')&&work.is_realized_by!=null;
  if(Object.hasOwn(work,'is_realized_by'))result.is_realized_by=work.is_realized_by;
  return result;
}
