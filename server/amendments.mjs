import { array, tail, procedureIds, documentFiles } from './activity-index-model.mjs';
import { odpLanguage } from './odp.mjs';
import { HttpError } from './http-utils.mjs';

export const AMENDMENTS_VERSION = 5;
export const AMENDMENT_SITTING_PROJECTION_VERSION = 4;
export const AMENDMENT_OUTCOME_PROOF_VERSION = 3;
export const AMENDMENT_DISTRIBUTION_PROOF_VERSION = 2;
export const AMENDMENT_EMPTY_OBSERVATION_VERSION = 1;
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
// `issued` is the manifestation's published issue time, kept as published.
// Older observations did not record it, so it is compared only when both
// descriptors have one.
export function normalizedDocxDescriptor(file) {
  if(typeof file?.url!=='string'||!file.url)return null;
  const issued=typeof file.issued==='string'&&Number.isFinite(Date.parse(file.issued))?file.issued:null;
  return {url:file.url,language:typeof file.language==='string'?file.language:null,byteSize:file.byteSize!=null&&Number.isSafeInteger(Number(file.byteSize))&&Number(file.byteSize)>=0?Number(file.byteSize):null,...(issued?{issued}:{})};
}
export function sameDocxDescriptor(a,b) {
  const left=normalizedDocxDescriptor(a),right=normalizedDocxDescriptor(b);
  return Boolean(left&&right&&left.url===right.url&&left.language===right.language&&left.byteSize===right.byteSize&&
    (!left.issued||!right.issued||Date.parse(left.issued)===Date.parse(right.issued)));
}
export function distributionEvidenceFor(work,source) {
  const descriptors=array(work?.is_realized_by).flatMap(expression=>array(expression?.is_embodied_by).flatMap(manifestation=>
    documentFiles({is_realized_by:[{...expression,is_embodied_by:[manifestation]}]}).filter(file=>file.format==='DOCX').map(file=>normalizedDocxDescriptor({...file,byteSize:manifestation?.byteSize,issued:manifestation?.issued})))).filter(Boolean);
  const available=typeof work?.amendmentDistributionDeclared==='boolean'?work.amendmentDistributionDeclared:Object.hasOwn(work || {},'is_realized_by')&&work.is_realized_by!=null;
  return {version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,state:descriptors.length?'available':available?'empty':'unavailable',descriptors,source:source || null};
}
export function currentDocxDescriptor(list) {
  const own=list?.distributionEvidence;
  const evidence=own?.version===AMENDMENT_DISTRIBUTION_PROOF_VERSION&&own.state!=='available'&&list?.reportWording?.reportId===list?.targetDocumentId?list.reportWording.distributionEvidence:own;
  if(evidence?.version!==AMENDMENT_DISTRIBUTION_PROOF_VERSION||evidence.state!=='available')return null;
  const descriptors=array(evidence.descriptors).map(normalizedDocxDescriptor).filter(Boolean);
  return descriptors.find(file=>file.language==='en') || descriptors[0] || null;
}
export function listWordingFreshness(list,{parserVersion}={}) {
  const descriptor=currentDocxDescriptor(list),proof=list?.extraction?.sourceDescriptor,sourceDescriptor=proof&&Object.hasOwn(proof,'byteSize')?normalizedDocxDescriptor(proof):null,failure=list?.wordingRefreshFailure;
  const distributionState=list?.distributionEvidence?.version===AMENDMENT_DISTRIBUTION_PROOF_VERSION?list.distributionEvidence.state:'unknown';
  const failed=failure&&(sameDocxDescriptor(descriptor,failure.descriptor)||(!descriptor&&!failure.descriptor));
  const status=failed?'failed':!descriptor||!sourceDescriptor||list?.extraction?.parserVersion!==parserVersion?'unverified':sameDocxDescriptor(descriptor,sourceDescriptor)?'fresh':'pending';
  return {version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,status,distributionState,descriptor,sourceDescriptor,...(failed?{failedAt:failure.failedAt,retryAfter:failure.retryAfter,error:failure.error}:{})};
}
export function resolvedAmendmentAuthorId(author) {
  const id=String(author?.personId ?? '').replace(/^person\//,'');
  return author?.status==='resolved'&&/^[1-9]\d*$/.test(id)&&Number.isSafeInteger(Number(id))?id:null;
}
export function checkedAggregateAttribution(record) {
  if(!record.conflicted)return record;
  // A decision reference belongs to the target's recorded vote, independently
  // of competing list variants. Retain it only with matching field evidence.
  const decisionLabel=record.targetLabelLanguage==='en'&&(record.decisions || []).some(decision=>decision.reference===record.targetLabel&&
    (!record.targetLabelSource||(decision.source&&decision.source.url===record.targetLabelSource.url&&decision.source.fetchedAt===record.targetLabelSource.fetchedAt)));
  return {...record,baseline:'unknown',baselineSource:null,documentReferences:[],targetPath:null,listId:null,authors:[],committeeProposer:null,onBehalfOf:null,date:null,documentDate:null,listDocumentDate:null,dateBasis:null,proposerDate:null,proposerDateBasis:null,
    originalText:null,proposedText:null,originalFormatting:[],proposedFormatting:[],language:null,justification:null,textParserVersion:null,textIntegrity:'unavailable',wordingSource:null,metadataSource:null,proposerSource:null,sourceFreshness:null,
    targetLabel:decisionLabel?record.targetLabel:null,targetLabelLanguage:decisionLabel?'en':null,targetLabelSource:decisionLabel?record.targetLabelSource ?? null:null,
    wordingRetained:false,proposerRetained:false,recordRetained:false,fieldSources:{}};
}
const textLossCodes=new Set(['comparison-header','comparison-columns','comparison-structure','comparison-grid','structural-revision','symbol-text-loss','non-text-content','vertical-text-loss','vertical-formatting-loss','inline-content-loss','nested-table','text-unavailable','numbering-warning','wording-too-large']);
export function validAmendmentFormatting(amendment) {
  return !['original','proposed'].some(side=>{
    const marks=amendment?.[side+'Formatting'],text=amendment?.[side+'Text'];
    return marks!=null&&(!Array.isArray(marks)||marks.some((mark,index)=>!['superscript','subscript'].includes(mark?.kind)||!Number.isInteger(mark.start)||!Number.isInteger(mark.end)||mark.start<0||mark.end<=mark.start||typeof text!=='string'||mark.end>text.length||index>0&&mark.start<marks[index-1].end));
  });
}
export function amendmentTextLosses(extraction,amendment) {
  const oversized=['originalText','proposedText'].some(field=>typeof amendment?.[field]==='string'&&amendment[field].length>AMENDMENT_LIMITS.text);
  const invalidFormatting=!validAmendmentFormatting(amendment);
  return [...(invalidFormatting?[{code:'vertical-formatting-loss',number:amendment.number,message:'Vertical formatting cannot be tied to exact wording offsets; its wording is withheld.'}]:[]),...array(extraction?.gaps),...array(amendment?.gaps),...(oversized?[{code:'wording-too-large',number:amendment.number,message:'Amendment wording exceeds the 60,000-character column limit; both columns are unavailable.'}]:[])].filter(gap=>textLossCodes.has(gap?.code) &&
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
    id:refs(node.id)[0] || null,...(!node.id?{observationIndex}:{}),amendmentProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION,activity_id:node.activity_id,activity_label:labels(node.activity_label),had_activity_type:node.had_activity_type,
    created_a_realization_of:array(node.created_a_realization_of).slice(0,257).map(part=>{
      const object=part && typeof part==='object',reference=object?part.id:typeof part==='string'?part:null;
      return {id:refs(reference)[0] || null,number:object?part.number:undefined,numbering:object?part.numbering:undefined,expressionContent:labels(object?part.expressionContent:null,65537),
        ...(!object?{sourceComponentObservation:part}:reference&&!canonicalEPReference(reference)?{sourceComponentObservation:{id:reference}}:{})};
    }),
  }]:[]);
}
export function amendmentDecision(node,sittingId,source) {
  const outcome=tail(node.decision_outcome), number=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
  const amendmentIds=[...new Set(array(node.decided_on_a_realization_of).map(amendmentReference).filter(Boolean).map(ref=>ref.id))];
  return {id:tail(node.id),amendmentIds,collective:amendmentIds.length>1,sittingId,date:node.activity_date || sittingId.slice(7),outcome:['ADOPTED','REJECTED','LAPSED','WITHDRAWN'].includes(outcome)?outcome:'unavailable',method:tail(node.decision_method)||null,
    reference:node.referenceText?.en || node.activity_label?.en || null,
    totals:[node.number_of_votes_favor,node.number_of_votes_against,node.number_of_votes_abstention].every(value=>value==null)?null:{for:node.number_of_votes_favor==null?null:number(node.number_of_votes_favor),against:node.number_of_votes_against==null?null:number(node.number_of_votes_against),abstaining:node.number_of_votes_abstention==null?null:number(node.number_of_votes_abstention)},source};
}
export function amendmentOutcome(decisions) {
  const outcomes=[...new Set(decisions.map(decision=>decision.outcome))];
  if(!outcomes.length || outcomes.includes('unavailable'))return 'unavailable';
  return outcomes.length===1?outcomes[0]:'mixed';
}
export const SPLIT_BINDING_GAP='Some recorded split components have incomplete request coverage or amendment bindings; the aggregate amendment outcome is unavailable.';
const exactComponent=value=>{const ref=canonicalEPReference(value);return ref&&/-SPLIT-\d+-\d+$/.test(tail(ref))?ref:null;};
const decisionAmendmentIds=decision=>[...new Set(array(decision.amendmentIds).map(value=>amendmentReference(String(value).startsWith('eli/')||/^https?:/.test(String(value))?value:'eli/dl/doc/'+value)?.id).filter(Boolean))];
// Request component counts describe the source request, not inferred ownership
// of its siblings. Only a decision naming exactly one amendment binds a part.
export function checkedAmendmentBindings(record) {
  const groups=new Map();
  for(const original of record.decisions || []) {
    const componentReferences=[...new Set([...array(original.componentReferences),original.partId].filter(Boolean).map(value=>exactComponent(value)||String(value)))];
    const amendmentIds=decisionAmendmentIds(original),collective=amendmentIds.length>1 || Boolean(original.collective&&amendmentIds.length!==1);
    let decision={...original,amendmentIds,collective};
    if(componentReferences.length || original.partNumber!=null || original.componentBinding) {
      const part=exactComponent(original.partId),single=!collective&&amendmentIds.length===1&&amendmentIds[0]===record.id&&Boolean(part);
      decision={...decision,componentReferences,componentBinding:collective?'unresolved-collective':single?'single-amendment':'unverified',partId:single?part:null,partNumber:single?original.partNumber ?? null:null};
    }
    const key=decision.id+':'+(decision.partId || '');
    const previous=groups.get(key);
    groups.set(key,previous?{...decision,componentReferences:[...new Set([...(previous.componentReferences || []),...(decision.componentReferences || [])])],requestCoverages:[...(previous.requestCoverages || []),...(decision.requestCoverages || [])]}:decision);
  }
  const decisions=[...groups.values()],owned=new Set(decisions.filter(vote=>vote.componentBinding==='single-amendment').map(vote=>vote.partId));
  const splitParts=(record.splitParts || []).filter(part=>owned.has(part.id));
  const recorded=new Set(decisions.flatMap(vote=>vote.componentReferences || [])),proofs=new Map();
  for(const proof of [...decisions.flatMap(vote=>vote.requestCoverages || []),...splitParts.map(part=>part.requestCoverage)].filter(Boolean)) {
    const key=proof.requestId || proof.registryRequestKey;
    if(key)proofs.set(key,proof);
  }
  const covered=new Set(),splitCoverage=[];
  for(const proof of proofs.values()) {
    const componentIds=[...new Set(array(proof.componentIds).map(exactComponent).filter(Boolean))];
    const recordedComponentIds=componentIds.filter(id=>recorded.has(id));
    if(!recordedComponentIds.length)continue;
    recordedComponentIds.forEach(id=>covered.add(id));
    const boundComponentIds=componentIds.filter(id=>owned.has(id));
    const componentCount=Number.isSafeInteger(proof.componentCount)&&proof.componentCount>=0?proof.componentCount:null;
    const complete=proof.version===AMENDMENT_OUTCOME_PROOF_VERSION&&Boolean(proof.sourceComplete&&proof.requestId)&&componentCount>0&&componentCount===componentIds.length&&boundComponentIds.length===componentCount;
    splitCoverage.push({requestId:proof.requestId || null,registryRequestKey:proof.registryRequestKey || proof.requestId || null,componentCount,componentIds,recordedComponentCount:recordedComponentIds.length,recordedComponentIds,boundComponentCount:boundComponentIds.length,boundComponentIds,unboundComponentCount:componentCount===null?null:Math.max(0,componentCount-boundComponentIds.length),complete});
  }
  for(const id of recorded)if(!covered.has(id))splitCoverage.push({requestId:null,registryRequestKey:null,componentCount:null,componentIds:[],recordedComponentCount:1,recordedComponentIds:[id],boundComponentCount:owned.has(id)?1:0,boundComponentIds:owned.has(id)?[id]:[],unboundComponentCount:null,complete:false});
  const splitCoverageComplete=splitCoverage.every(proof=>proof.complete)&&!decisions.some(vote=>vote.componentBinding==='unresolved-collective'||vote.componentBinding==='unverified');
  return {...record,decisions,splitParts,outcomeProofVersion:AMENDMENT_OUTCOME_PROOF_VERSION,splitCoverageComplete,splitCoverage,
    gaps:[...new Set([...(record.gaps || []).filter(gap=>gap!==SPLIT_BINDING_GAP),...(!splitCoverageComplete?[SPLIT_BINDING_GAP]:[])])]};
}
export function amendmentRowOutcome(row) {
  const split=(row.decisions || []).some(vote=>vote.partId||vote.partNumber!=null||vote.componentBinding||(vote.componentReferences || []).length);
  if(split&&(row.outcomeProofVersion!==AMENDMENT_OUTCOME_PROOF_VERSION||!row.splitCoverageComplete))return 'unavailable';
  return amendmentOutcome(row.decisions || []);
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
