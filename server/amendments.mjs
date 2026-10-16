import { array, tail, procedureIds } from './activity-index-model.mjs';
import { odpLanguage } from './odp.mjs';
import { HttpError } from './http-utils.mjs';

export const AMENDMENTS_VERSION = 1;
export const AMENDMENT_SITTING_PROJECTION_VERSION = 2;
export const AMENDMENT_LIMITS = Object.freeze({ listsPerTarget:64, sittingsPerTarget:64, amendmentsPerList:500, text:60000, failures:20000, upgradeTargets:100, page:50 });
export const PROPOSER_DATE_BASES = Object.freeze(['individual-amendment-document','amendment-list-document','amendment-list-metadata']);
export function validAmendmentDate(value) {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
// Indexed presentation dates may fall back to a report date. Only documentary
// amendment/list dates, or an explicitly preserved proposer basis, support links.
export function amendmentProposerDate(record,{documentDate=record?.documentDate,listDate=record?.listDocumentDate}={}) {
  const documented=validAmendmentDate(documentDate)?documentDate:null,listed=validAmendmentDate(listDate)?listDate:null;
  const documentBasis=record?.dateBasis==='amendment-list-document'?'amendment-list-document':'individual-amendment-document';
  if(record?.proposerDate!=null) {
    const date=record.proposerDate;if(!validAmendmentDate(date))return null;
    if(PROPOSER_DATE_BASES.includes(record.proposerDateBasis))return {date,basis:record.proposerDateBasis};
    if(date===documented)return {date,basis:documentBasis};
    if(date===listed)return {date,basis:'amendment-list-metadata'};
    return null;
  }
  if(record?.proposerRetained)return null;
  return documented?{date:documented,basis:documentBasis}:listed?{date:listed,basis:'amendment-list-metadata'}:null;
}
const textLossCodes=new Set(['comparison-header','comparison-columns','comparison-structure','symbol-text-loss','non-text-content','vertical-text-loss','inline-content-loss','nested-table','text-unavailable','numbering-warning','wording-too-large']);
export function amendmentTextLosses(extraction,amendment) {
  const oversized=['originalText','proposedText'].some(field=>typeof amendment?.[field]==='string'&&amendment[field].length>AMENDMENT_LIMITS.text);
  return [...array(extraction?.gaps),...array(amendment?.gaps),...(oversized?[{code:'wording-too-large',number:amendment.number,message:'Amendment wording exceeds the 60,000-character column limit; both columns are unavailable.'}]:[])].filter(gap=>textLossCodes.has(gap?.code) &&
    (gap.number!=null?String(gap.number)===String(amendment.number):gap.code==='numbering-warning'||gap.scope==='document'));
}
export function canonicalEPReference(value) {
  const ref=String(value?.id || value || '').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
  return /^eli\/dl\/(?:doc|event)\/[A-Z0-9-]+$/.test(ref)?ref:null;
}
export const amendmentTarget = id => /^(?:A|B|RC)-10-\d{4}-\d{4,6}$/.test(String(id || ''));
export const amendmentDocumentId = value => {
  const id=tail(value);return amendmentTarget(id)?id:null;
};
export function amendmentReference(value) {
  const canonical=canonicalEPReference(value);if(!canonical?.startsWith('eli/dl/doc/'))return null;
  const id=tail(canonical), match=id.match(/^((?:A|B|RC)-10-\d{4}-\d{4,6})-AM-(\d{1,5})$/);
  return match && Number(match[2])>0 ? { id, targetDocumentId:match[1], number:Number(match[2]) } : null;
}
export function hasDecisionReferenceSet(decision) {
  // An absent/empty relationship or a split fragment alone cannot contradict
  // an accepted amendment binding. Require a recognized whole text or exact
  // individual amendment reference before replacing that decision's subjects.
  return array(decision.decided_on_a_realization_of).some(value=>{
    const ref=canonicalEPReference(value);if(!ref?.startsWith('eli/dl/doc/'))return false;
    return Boolean(amendmentReference(ref)||amendmentTarget(tail(ref))||/^TA-10-\d{4}-\d{4,6}$/.test(tail(ref)));
  });
}
export function amendmentLists(work) {
  const id=work?.identifier || tail(work?.id);
  return array(work?.inverse_foresees_change_of).filter(item=>item && typeof item==='object' && tail(item.work_type)==='AMENDMENT_LIST' && array(item.foresees_change_of).some(ref=>canonicalEPReference(ref)==='eli/dl/doc/'+id));
}
export function amendmentSittings(work) {
  return [...new Set([...array(work?.inverse_based_on_a_realization_of),...array(work?.inverse_decided_on_a_realization_of)].flatMap(ref=>{
    const canonical=canonicalEPReference(ref);if(!canonical?.startsWith('eli/dl/event/'))return [];
    const match=tail(canonical).match(/^(MTG-PL-\d{4}-\d{2}-\d{2})-(?:VOT|OJ|PVCRE)-/);return match?[match[1]]:[];
  }))];
}
const refs=value=>[...new Set(array(value).map(canonicalEPReference).filter(Boolean))];
const labels=(value,max=5000)=>value && typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([language,text])=>/^[a-z]{2,3}$/.test(language)&&typeof text==='string').map(([language,text])=>[language,text.slice(0,max)])):{};
export function projectAmendmentDecisions(nodes,sittingId) {
  return nodes.filter(node=>tail(node.had_activity_type)==='PLENARY_OUTCOME' && canonicalEPReference(node.id)?.startsWith('eli/dl/event/'+sittingId+'-DEC-')).map(node=>({
    id:refs(node.id)[0], decided_on_a_realization_of:refs(node.decided_on_a_realization_of), referenceText:labels(node.referenceText),
    activity_label:labels(node.activity_label), responsible_organization_label:labels(node.responsible_organization_label),
  }));
}
export function projectAmendmentSplits(nodes,sittingId) {
  return nodes.flatMap((node,observationIndex)=>tail(node.had_activity_type)==='REQUEST_VOTE_SPLIT' && (node.id==null||node.id===''||canonicalEPReference(node.id)?.startsWith('eli/dl/event/'+sittingId+'-VOT-ITM-'))?[{
    id:refs(node.id)[0] || null,...(!node.id?{observationIndex}:{}),activity_id:node.activity_id,activity_label:labels(node.activity_label),had_activity_type:node.had_activity_type,
    created_a_realization_of:array(node.created_a_realization_of).filter(part=>part && typeof part==='object').slice(0,257).map(part=>({
      id:refs(part.id)[0],number:part.number,numbering:part.numbering,expressionContent:labels(part.expressionContent,65537),
    })),
  }]:[]);
}
export function amendmentDecision(node,sittingId,source) {
  const outcome=tail(node.decision_outcome), number=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
  const amendmentIds=array(node.decided_on_a_realization_of).map(amendmentReference).filter(Boolean).map(ref=>ref.id);
  return {id:tail(node.id),amendmentIds,collective:amendmentIds.length>1,sittingId,date:node.activity_date || sittingId.slice(7),outcome:['ADOPTED','REJECTED','LAPSED','WITHDRAWN'].includes(outcome)?outcome:'unavailable',method:tail(node.decision_method)||null,
    reference:node.referenceText?.en || node.activity_label?.en || null,
    totals:[node.number_of_votes_favor,node.number_of_votes_against,node.number_of_votes_abstention].every(value=>value==null)?null:{for:node.number_of_votes_favor==null?null:number(node.number_of_votes_favor),against:node.number_of_votes_against==null?null:number(node.number_of_votes_against),abstaining:node.number_of_votes_abstention==null?null:number(node.number_of_votes_abstention)},source};
}
export function amendmentOutcome(decisions) {
  const outcomes=[...new Set(decisions.map(decision=>decision.outcome))];
  if(!outcomes.length || outcomes.includes('unavailable'))return 'unavailable';
  return outcomes.length===1?outcomes[0]:'mixed';
}
export function amendmentQuery(params,{failures=false}={}) {
  const allowed=failures?['limit','offset','lang','status']:['document','procedure','member','outcome','limit','offset','lang'];
  for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated amendment query parameter.');
  const number=(key,fallback,max,min=0)=>{const text=params.get(key)??String(fallback),n=Number(text);if(!/^(0|[1-9]\d*)$/.test(text)||!Number.isSafeInteger(n)||n<min||n>max)throw new HttpError(400,'invalid_query',`Invalid ${key}.`);return n;};
  const result={limit:number('limit',20,AMENDMENT_LIMITS.page,1),offset:number('offset',0,1000000),language:odpLanguage(params.get('lang') || 'en')};
  if(failures){const status=params.get('status');if(status!==null&&!['unresolved','resolved','all'].includes(status))throw new HttpError(400,'invalid_status','Choose unresolved, resolved or all.');return {...result,status:status || 'all'};}
  const document=params.get('document'),procedure=params.get('procedure'),member=params.get('member'),outcome=params.get('outcome');
  if(document!==null && !amendmentTarget(document))throw new HttpError(400,'invalid_document','Use an exact plenary report or motion identifier.');
  if(procedure!==null && !/^\d{4}-\d{4}[A-Z]?$/.test(procedure))throw new HttpError(400,'invalid_procedure','Use an exact procedure identifier.');
  if(member!==null && (!/^[1-9]\d*$/.test(member)||!Number.isSafeInteger(Number(member))))throw new HttpError(400,'invalid_member','Use a positive MEP identifier.');
  if(outcome!==null&&!['ADOPTED','REJECTED','LAPSED','WITHDRAWN','mixed','unavailable'].includes(outcome))throw new HttpError(400,'invalid_outcome','Unknown amendment outcome.');
  return {...result,document,procedure,member,outcome};
}
export function targetMetadata(work,fetchedAt,endpoint) {
  return {id:work.identifier || tail(work.id),date:work.document_date || null,titles:work.title_dcterms || {},procedureIds:procedureIds(work),sittingIds:amendmentSittings(work),
    // Subject codes remain exact public codes. No semantic topic inference is made.
    topics:array(work.isAboutSubjectMatter).map(id=>({id:String(id),label:tail(id),basis:'dossier'})),
    sources:[{url:'https://data.europarl.europa.eu/api/v2'+endpoint+'?format=application%2Fld%2Bjson',fetchedAt,language:null}]};
}
