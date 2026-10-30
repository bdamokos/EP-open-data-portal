import {array,tail} from './activity-index-model.mjs';

export const COMMITTEE_AMENDMENTS_VERSION=1;
export const COMMITTEE_DOCUMENT_TYPES=Object.freeze({
  REPORT_PARLIAMENTARY_COMMITTEE_DRAFT:'draft-report',
  OPINION_PARLIAMENTARY_COMMITTEE_DRAFT:'draft-opinion',
});
export const committeeCode=value=>typeof value==='string'&&/^[A-Z][A-Z0-9]{2,5}$/.test(value);
export const committeeListId=value=>typeof value==='string'&&/^[A-Z][A-Z0-9]{2,5}-AM-\d{4,9}(?:-\d{1,4})*$/.test(value);
export const committeeDraftId=value=>typeof value==='string'&&/^[A-Z][A-Z0-9]{2,5}-(?:PR|PA)-\d{4,9}(?:-\d{1,4})*$/.test(value);
export const committeeScopeKey=listId=>committeeListId(listId)?'committee:'+listId:null;
export function committeeAmendmentReference(value) {
  const match=typeof value==='string'&&value.match(/^committee:([^:]+):([1-9]\d{0,4})$/);
  return match&&committeeListId(match[1])?{id:value,listId:match[1],number:Number(match[2]),scope:'committee'}:null;
}
export const committeeDocumentEndpoint=id=>(committeeListId(id)?'/documents/':committeeDraftId(id)?'/committee-documents/':null)?.concat(id)||null;
const relative=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
export const committeeProcedureIds=work=>[...new Set(array(work?.inverse_created_a_realization_of).map(relative).filter(ref=>/^eli\/dl\/proc\/\d{4}-\d{4}[A-Z]?$/.test(ref)).map(tail))];
export const exactCommitteeDocument=value=>{
  const ref=relative(value),id=tail(ref);
  return ref==='eli/dl/doc/'+id&&(committeeListId(id)||committeeDraftId(id))?id:null;
};
export function validCommitteeWork(work) {
  const id=work?.identifier,type=tail(work?.work_type),terms=array(work?.parliamentary_term);
  return relative(work?.id)==='eli/dl/doc/'+id&&terms.length>0&&terms.every(value=>relative(value)==='org/ep-10')&&
    (committeeListId(id)&&type==='AMENDMENT_LIST'||committeeDraftId(id)&&COMMITTEE_DOCUMENT_TYPES[type]=== (id.includes('-PR-')?'draft-report':'draft-opinion'));
}
export function committeeDocumentKind(work) {return COMMITTEE_DOCUMENT_TYPES[tail(work?.work_type)]||null;}
export function committeeRevisionLists(work) {
  return [...new Set(['isVersionOf','hasVersion','is_replaced_by','replaces'].flatMap(field=>array(work?.[field]).map(exactCommitteeDocument)).filter(id=>committeeListId(id)&&id!==work.identifier))];
}
// The published source code is retained as one code. CJ identifiers do not
// establish constituent committees or their membership.
export function sourceCommittees(work) {
  if(!validCommitteeWork(work))return [];
  return [{code:work.identifier.split('-')[0]}];
}
export function committeeDiscoveryReferences(work) {
  const result=[];
  const add=(value,relationship,event=null)=>{
    const id=exactCommitteeDocument(value);if(id)result.push({id,relationship,...(event?{eventId:relative(event.id)||null,date:event.activity_date||null,activityType:tail(event.had_activity_type)}:{})});
  };
  if(relative(work?.id).startsWith('eli/dl/proc/')) {
    for(const event of array(work.consists_of))if(['COMMITTEE_TABLING_REPORT','COMMITTEE_TABLING_OPINION','COMMITTEE_TABLING_AMENDMENT'].includes(tail(event.had_activity_type)))
      for(const value of array(event.based_on_a_realization_of))add(value,'consists_of.based_on_a_realization_of',event);
    for(const value of array(work.created_a_realization_of))add(value,'created_a_realization_of');
  } else if(validCommitteeWork(work)) {
    for(const value of array(work.inverse_foresees_change_of))if(committeeListId(exactCommitteeDocument(value)))add(value,'inverse_foresees_change_of');
    for(const value of array(work.foresees_change_of))if(committeeDraftId(exactCommitteeDocument(value)))add(value,'foresees_change_of');
  }
  return [...new Map(result.map(value=>[JSON.stringify(value),value])).values()];
}

export function committeeTargetRelationship(list,claims=[]) {
  const declared=Object.hasOwn(list,'foresees_change_of')&&list.foresees_change_of!=null;
  const forward=array(list.foresees_change_of),targets=forward.map(exactCommitteeDocument);
  const candidates=[...new Set([...targets.filter(committeeDraftId),...claims.filter(committeeDraftId)])];
  const conflicting=targets.some(id=>!committeeDraftId(id))||candidates.length>1;
  return {status:conflicting?'conflicting':candidates.length===1?'verified':'unavailable',targetDocumentId:!conflicting&&candidates.length===1?candidates[0]:null,
    evidence:[...(declared?[{relationship:'foresees_change_of',references:forward}]:[]),...claims.map(id=>({relationship:'inverse_foresees_change_of',documentId:id}))]};
}
