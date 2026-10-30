import {defaultUi} from './uiDefault.mjs';
const outcomes = {ADOPTED:'Adopted',REJECTED:'Rejected',LAPSED:'Lapsed',WITHDRAWN:'Withdrawn',mixed:'Mixed outcomes',unavailable:'Outcome unavailable'};
export const outcomesUi = (ui = defaultUi) => ({ADOPTED:ui.t("membervotespresentation.adopted"),REJECTED:ui.t("membervotespresentation.rejected"),LAPSED:ui.t("membervotespresentation.lapsed"),WITHDRAWN:ui.t("membervotespresentation.withdrawn"),mixed:ui.t("amendmentmodel.mjs.mixed.outcomes"),unavailable:ui.t("membervotespresentation.outcome_unavailable")});

export const amendmentOutcomeLabel = (value,ui=defaultUi) => outcomesUi(ui)[value] || outcomesUi(ui).unavailable;
export const supportedAmendmentTarget = value => typeof value==='string'&&/^(?:A|B|RC)-10-\d{4}-\d{4,6}$/.test(value);
export const amendmentStages=['all','committee','plenary'];
export const validCommitteeCode=value=>typeof value==='string'&&/^(?:[A-Z]{3,5}|CJ\d{2})$/.test(value);
export const committeeAmendmentList=value=>typeof value==='string'&&/^(?:[A-Z]{3,5}|CJ\d{2})-AM-\d{4,9}(?:-\d+)*$/.test(value);
export const committeeAmendmentTarget=value=>typeof value==='string'&&/^(?:[A-Z]{3,5}|CJ\d{2})-(?:PR|PA|AD|AL)-\d{4,9}(?:-\d+)*$/.test(value);
export function committeeAmendmentIdentity(value) {
  if(typeof value!=='string')return null;
  const match=value.match(/^committee:([^:]+):([1-9]\d{0,6}[a-z]?)$/);
  return match&&committeeAmendmentList(match[1])?{listId:match[1],number:match[2]}:null;
}
export function amendmentContextSelection(item) {
  if(item.conflicted||!item.listId)return null;
  if(item.scope==='committee'){
    const identity=committeeAmendmentIdentity(item.id);
    if(!identity||identity.listId!==item.listId||String(item.number)!==identity.number||item.targetRelationship?.status!=='verified'||!committeeAmendmentTarget(item.targetDocumentId))return null;
  }else if(!supportedAmendmentTarget(item.targetDocumentId)||!item.id.startsWith(item.targetDocumentId+'-AM-')||!/^\d+(?:-\d+)?$/.test(item.id.slice(item.targetDocumentId.length+4)))return null;
  return {documentId:item.targetDocumentId,amendmentId:item.id,listId:item.listId,scope:item.scope||'plenary',wordingLanguage:Object.hasOwn(item,'wordingSource')?item.wordingSource?.language??null:item.language??null,view:'document'};
}
export function amendmentFailureKey(failure) {
  const component=failure.registryPartKey??failure.partId??[failure.recordKind??failure.scope??'unknown',failure.componentIndex??null,failure.description??null,failure.rawDescription??null,failure.sourceDescriptions??null];
  return JSON.stringify([failure.registryRequestKey??failure.requestId??failure.observationKey??null,component,failure.language??null]);
}
export function amendmentFailureLabel(failure, ui = defaultUi) {
  if(failure.partId)return failure.partId;
  if(failure.recordKind==='request'||failure.scope==='request')return ui.t("amendmentmodel.mjs.split.request.failure");
  return (Number.isInteger(failure.componentIndex)&&failure.componentIndex>=0)?ui.t("amendmentmodel.mjs.unidentified.split.component.number", {number: String(failure.componentIndex+1)}):(ui.t("amendmentmodel.mjs.unidentified.split.component"));
}
export function amendmentProcedure(value) {
  let reference=String(value||'').trim();
  if(/^https?:\/\//i.test(reference)){try{reference=new URL(reference).searchParams.get('reference')||reference;}catch{/* Keep invalid input for the API's explicit validation. */}}
  const match=reference.match(/^(\d{4})[/-](\d{4})([A-Z]?)(?:\([A-Z]{2,8}\))?$/i);
  return match ? `${match[1]}-${match[2]}${match[3].toUpperCase()}` : reference;
}
export function amendmentRoute({document,procedure,member,outcome,scope,list,committee,offset=0,language='en',limit=20}={}) {
  const params=new URLSearchParams({lang:language,limit:String(limit),offset:String(Math.max(0,Number.isSafeInteger(offset)?offset:0))});
  if(scope==='committee')params.set('scope','committee');
  if(scope==='committee'&&list)params.set('list',list);
  if(scope==='committee'&&committee)params.set('committee',committee);
  if(document)params.set('document',document);
  if(procedure)params.set('procedure',amendmentProcedure(procedure));
  if(member&&/^[1-9]\d*$/.test(String(member)))params.set('member',String(member));
  if(Object.hasOwn(outcomes,outcome)&&outcome!=='')params.set('outcome',outcome);
  return 'amendments?'+params;
}
export function amendmentHref(path,{document,procedure,member,scope,list,committee,language='en'}={}) {
  const params=new URLSearchParams({lang:language,view:'amendments'});
  if(scope==='committee')params.set('am-scope','committee');
  if(scope==='committee'&&committeeAmendmentList(list))params.set('am-list',list);
  if(scope==='committee'&&validCommitteeCode(committee))params.set('am-committee',committee);
  if(document)params.set('am-document',document);
  if(procedure)params.set('am-procedure',procedure);
  if(member)params.set('am-member',String(member));
  return path+'?'+params;
}
export function amendmentGroups(items,by='dossier', ui = defaultUi) {
  const groups=new Map();
  for(const item of items) {
    let key,label,basis;
    if(by==='target'){key=JSON.stringify([item.targetDocumentId||null,item.targetLabel||null]);label=[item.targetDocumentId,item.targetLabel||ui.t("amendmentmodel.mjs.target.provision.unavailable")].filter(Boolean).join(' · ');basis=ui.t("amendmentmodel.mjs.target.provision.in.the.amendment.document");}
    else if(by==='topic') {const topic=item.topics?.[0];key=topic?JSON.stringify([topic.basis,topic.id,topic.basis==='target'?item.targetDocumentId||null:null]):'unknown';label=topic?.basis==='target'?[item.targetDocumentId,topic.label].filter(Boolean).join(' · '):topic?.label||ui.t("amendmentmodel.mjs.topic.unavailable");basis=(topic?.basis==='dossier')?ui.t("amendmentmodel.mjs.dossier.subject.classification"):(!(topic?.basis==='dossier') && (topic?.basis==='target')?ui.t("amendmentmodel.mjs.target.provision"):(ui.t("amendmentmodel.mjs.no.topic.classification.recorded")));}
    else {const procedure=item.procedureIds?.[0];key=procedure||item.targetDocumentId||'unknown';label=procedure||item.targetDocumentId||ui.t("amendmentmodel.mjs.dossier.unavailable");basis=(procedure)?ui.t("amendmentmodel.mjs.exact.procedure.reference"):(ui.t("amendmentmodel.mjs.target.document"));}
    if(!groups.has(key))groups.set(key,{id:key,label,basis,items:[]});
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}
export function amendmentDecisionScope(item,decision, ui = defaultUi) {
  if(decision.partId||decision.partNumber!==undefined&&decision.partNumber!==null)return (decision.partNumber!==undefined&&decision.partNumber!==null)?ui.t("amendmentmodel.mjs.split.part.number", {number: String(decision.partNumber)}):(ui.t("amendmentmodel.mjs.split.part"));
  if(decision.collective||decision.amendmentIds?.length>1)return ui.t("amendmentmodel.mjs.collective.decision");
  if(item.splitParts?.length)return ui.t("amendmentmodel.mjs.amendment.decision");
  return ui.t("amendmentmodel.mjs.whole.amendment");
}
export function amendmentDecisionKey(decision) {
  const key=[decision.id,decision.partId??null,decision.partId?null:decision.partNumber??null],stage=decision.stage??(['committee','plenary'].includes(decision.scope)?decision.scope:null);
  return JSON.stringify(stage?[...key,stage]:key);
}
export function amendmentDecisionPart(parts,decision) {
  // An explicit ID always takes precedence, including when that ID is not indexed.
  if(decision.partId)return parts.find(part=>part.id===decision.partId)||null;
  if(decision.partNumber===undefined||decision.partNumber===null)return null;
  const candidates=parts.filter(part=>part.id&&part.number!==undefined&&part.number!==null&&String(part.number)===String(decision.partNumber));
  return candidates.length===1?candidates[0]:null;
}
export function publicAmendmentSource(value) {
  try {const url=new URL(typeof value==='string'?value:value?.url);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
const quoted=value=>typeof value==='string'&&value?`“${value}”`:'';
// Summarise supported, explicitly typed plans; never manufacture a text selection.
export function amendmentPlanSummary(plan, ui = defaultUi) {
  if(!plan||typeof plan!=='object')return [];
  const describe=(node,depth=0)=>{
    if(!node||typeof node!=='object'||depth>8)return null;
    let text;
    if(node.type==='all')text=ui.t("amendmentmodel.mjs.the.whole.amendment.text");
    else if(node.type==='text'&&quoted(node.quote))text='The text '+quoted(node.quote);
    else if(node.type==='delete_operation'&&quoted(node.quote))text='The amendment’s deletion of '+quoted(node.quote)+' (an edit operation)';
    else if(node.type==='character'&&quoted(node.character)&&quoted(node.within)&&Number.isInteger(node.characterOccurrence))text='Occurrence '+node.characterOccurrence+' of '+quoted(node.character)+' within '+quoted(node.within);
    else if(node.type==='difference'){
      const base=describe(node.base,depth+1),except=describe(node.except,depth+1);
      if(!base||!except)return null;
      text=(node.except?.type==='union')?ui.t("batch2.amendmentmodel.mjs.base.excluding.exception", {base: String(base), exception: String(except)}):(ui.t("amendmentmodel.mjs.base.excluding.exception", {base: String(base), exception: String(except)}));
    }
    else if(node.type==='union'){
      if(!Array.isArray(node.items)||!node.items.length)return null;
      const items=node.items.map(item=>describe(item,depth+1));
      if(items.some(item=>!item))return null;
      text=items.join('; together with ');
    }
    else return null;
    if(Array.isArray(node.occurrences)&&node.occurrences.length)text+=' · occurrence'+(node.occurrences.length===1?' ':'s ')+node.occurrences.join(', ');
    else if(Number.isInteger(node.expectedCount))text+=' · '+node.expectedCount+' expected occurrence'+(node.expectedCount===1?'':'s');
    if(node.scope){const scope=describe(node.scope,depth+1);if(!scope)return null;text+=' · within '+scope;}
    return text;
  };
  const description=describe(plan, undefined);
  return description?[description]:[];
}
