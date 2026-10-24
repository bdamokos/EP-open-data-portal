import {list,exactReference,references,eventUri,identifier,term} from './vote-evidence.mjs';
import {interventionMetadata,speechPeople} from './speech-interventions.mjs';
import {speechSummary} from './odp.mjs';
import {projectMemberSitting} from './member-votes-model.mjs';

const validRefs=(value,kind='event')=>list(value).every(value=>exactReference(value,kind));
const sameDay=(node,day)=>eventUri(node)&&node.activity_id===identifier(eventUri(node))&&node.activity_date===day.date&&node.activity_id.startsWith(day.sittingId+'-');
const whole=vote=>vote.ballotStatus==='conducted'&&!vote.sourceConflicts&&vote.scope.basis!=='invalid-component-reference'&&!['amendment','split-part','procedural'].includes(vote.scope.kind)&&
  !vote.context.amendmentIds.length&&!vote.context.componentIds.length&&
  (vote.scope.kind==='whole-text'||vote.referenceTexts.en?.trim()==='Text as a whole');

function graphGaps(day) {
  const gaps=[],complete=day.coverage?.completeness;
  for(const kind of ['agenda','results'])if(day.coverage?.[kind]?.state!=='complete')gaps.push({code:'vote-'+kind+'-incomplete'});
  // Missing results or agenda identities could conceal a second document or
  // agenda match, even when every retrieved page reached its normal end.
  for(const field of ['missingResultIds','invalidSourceIds']) {
    if(!Array.isArray(complete?.[field]))gaps.push({code:'vote-graph-unavailable',field});
    else if(complete[field].length)gaps.push({code:'vote-graph-incomplete',field,ids:complete[field]});
  }
  for(const kind of ['agenda','results'])for(const node of list(day[kind])) {
    if(!sameDay(node,day))gaps.push({code:'vote-identity-conflict',kind,details:{id:node.id,activity_id:node.activity_id,identifier:node.identifier}});
    for(const [field,type] of [['based_on_a_realization_of','doc'],...(kind==='results'?[['executed','event']]:[])]) {
      if(!validRefs(node[field],type))gaps.push({code:'vote-reference-conflict',kind,id:node.activity_id,field,references:node[field]});
    }
  }
  return gaps;
}

function conflictingTranscript(activity,parent) {
  const speech=activity.activity_id.match(/^MTG-PL-(\d{4}-\d{2}-\d{2})-OTH-(\d+)$/);
  const chapter=parent.activity_id.match(/-PVCRE-ITM-(\d+(?:-\d+)*)$/)?.[1];
  const item=value=>value.split('-').map(part=>String(Number(part))).join('-');
  return list(activity.recorded_in_a_realization_of).some(doc=>{
    const uri=exactReference(doc,'doc'),match=uri&&identifier(uri).match(/^CRE-(\d+)-(\d{4}-\d{2}-\d{2})-(?:OTH|INT)-(\d+)$/);
    if(!speech||!match||match[1]!=='10'||match[2]!==speech[1]||match[3]!==speech[2])return true;
    if(typeof doc!=='object')return false;
    if(doc.notation_speechId!=null&&String(doc.notation_speechId)!==speech[2])return true;
    return list(doc.is_part_of).some(value=>{
      const ref=exactReference(value,'doc'),part=ref&&identifier(ref).match(/^CRE-(\d+)-(\d{4}-\d{2}-\d{2})(?:-ITM-(\d+(?:-\d+)*))?$/);
      return !part||part[1]!==match[1]||part[2]!==speech[1]||part[3]&&(!chapter||item(part[3])!==item(chapter));
    });
  });
}

export function explanationVoteContext(day,memberId,decisionId,language='en') {
  const gaps=graphGaps(day);
  const projected=projectMemberSitting(day,memberId,language),vote=projected.items.find(item=>item.id===decisionId);
  const subject=projected.subjects.find(subject=>subject.id===vote?.subjectId);
  const result=list(day.results).find(result=>eventUri(result)===subject?.uri);
  if(!vote||!subject||!result||vote.sourceConflicts||!['consistent','single-direction'].includes(vote.resultRelationship.binding)||
    subject.gaps.some(gap=>['conflicting-result-source','invalid-reference','ambiguous-decision-result-binding','conflicting-declared-decision'].includes(gap.code)))return {vote:vote||null,subject:null,anchor:null,gaps};
  const members=projected.items.filter(item=>item.subjectId===subject.id);
  const complete=day.coverage?.decisions?.state==='complete'&&subject.declaredDecisionIds.length>0&&
    subject.declaredDecisionIds.every(id=>members.some(item=>item.id===id&&!item.sourceConflicts))&&
    !subject.gaps.some(gap=>gap.code==='missing-declared-decision');
  const finals=members.filter(whole);
  return {vote,subject,result,anchor:!gaps.length&&complete&&finals.length===1?finals[0].id:null,gaps};
}

// The graph establishes a subject relationship. A final ballot is a display
// anchor only; it never turns that relationship into an amendment-level claim.
export function matchVoteExplanation(activity,parent,day,context,memberId) {
  const {subject,result}=context;
  if(graphGaps(day).length)return {item:null,gap:'vote-context-incomplete'};
  if(!subject||!sameDay(activity,day)||!sameDay(parent,day)||term(activity.had_activity_type)!=='PLENARY_DEBATE_SPEECH'||
    term(parent.had_activity_type)!=='PLENARY_VOTE_EXPLANATIONS')return {item:null,gap:null};
  const documents=references(parent.based_on_a_realization_of,'doc');
  if(!documents.length||!validRefs(parent.based_on_a_realization_of,'doc'))return {item:null,gap:'explanation-document-unavailable'};
  const subjectDocuments=references(result.based_on_a_realization_of,'doc');
  // A verified disjoint chapter cannot explain this text. Its classification
  // and transcript gaps belong to that other text, not every vote that day.
  if(subjectDocuments.length&&!documents.some(id=>subjectDocuments.includes(id)))return {item:null,gap:null};
  const people=speechPeople(activity),participations=list(activity.had_participation);
  if(people.length!==1||people[0]!==String(memberId)||!participations.some(p=>term(p.participation_role)==='SPEAKER'&&list(p.had_participant_person).some(p=>String(p?.id||p).match(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?person\/([1-9]\d*)$/)?.[1]===String(memberId))))return {item:null,gap:'speaker-unresolved'};
  const parents=references(activity.inverse_consists_of);
  if(!validRefs(activity.inverse_consists_of)||parents.length!==1||parents[0]!==eventUri(parent)||
    !validRefs(parent.consists_of)||!references(parent.consists_of).includes(eventUri(activity)))return {item:null,gap:'explanation-parent-conflict'};
  if(conflictingTranscript(activity,parent))return {item:null,gap:'explanation-transcript-conflict',details:{documents:list(activity.recorded_in_a_realization_of).map((doc,index)=>typeof doc==='object'&&doc?{index,id:doc.id,identifier:doc.identifier,notation_speechId:doc.notation_speechId,is_part_of:doc.is_part_of}:{index,id:doc})}};
  const meta=interventionMetadata(activity);
  if(!['speech','oral-explanation-of-vote'].includes(meta.type))return {item:null,gap:meta.type==='unclassified'?'classification-unavailable':null};
  const candidates=list(day.agenda).filter(node=>sameDay(node,day)&&term(node.had_activity_type)==='PLENARY_VOTE'&&
    references(node.based_on_a_realization_of,'doc').some(id=>documents.includes(id)));
  if(candidates.length!==1)return {item:null,gap:'explanation-agenda-unresolved'};
  const agenda=candidates[0],agendaUri=eventUri(agenda);
  if(!validRefs(agenda.based_on_a_realization_of,'doc')||!documents.every(id=>references(agenda.based_on_a_realization_of,'doc').includes(id)))return {item:null,gap:'explanation-document-conflict'};
  if(!subject.agendaItemIds.includes(agenda.activity_id))return {item:null,gap:null};
  // A result for the same document can also point to an agenda record missing
  // from the catalogue. Include it in the ambiguity check before following the
  // known agenda edge; unrelated missing agenda records do not hide this link.
  const documentResults=list(day.results).filter(node=>references(node.based_on_a_realization_of,'doc').some(id=>documents.includes(id)));
  if(documentResults.length!==1||eventUri(documentResults[0])!==subject.uri)return {item:null,gap:'explanation-result-unresolved'};
  for(const other of list(day.results).filter(node=>eventUri(node)!==subject.uri&&!references(node.based_on_a_realization_of,'doc').length)) {
    const agendas=references(other.executed);
    if(!agendas.length||agendas.some(uri=>{
      const node=list(day.agenda).find(node=>eventUri(node)===uri),docs=references(node?.based_on_a_realization_of,'doc');
      return !node||!docs.length||docs.some(id=>documents.includes(id));
    }))return {item:null,gap:'explanation-result-scope-unavailable'};
  }
  const results=list(day.results).filter(node=>references(node.executed).includes(agendaUri));
  if(results.length!==1||eventUri(results[0])!==subject.uri)return {item:null,gap:results.length===1?null:'explanation-result-unresolved'};
  if(!validRefs(result.executed)||references(result.executed).length!==1||!validRefs(result.based_on_a_realization_of,'doc')||
    !documents.every(id=>references(result.based_on_a_realization_of,'doc').includes(id)))return {item:null,gap:'explanation-result-conflict'};
  const speech=speechSummary(activity);
  return {item:{id:activity.activity_id,kind:'oral',matchScope:'subject',subjectId:subject.id,
    presentationAnchorDecisionId:context.anchor,anchorBasis:context.anchor?'english-reference-label':null,
    speech,parentId:parent.activity_id,documentIds:documents.map(identifier),agendaItemId:agenda.activity_id,
    classification:{basis:meta.type==='oral-explanation-of-vote'?meta.evidence:'speech-header-and-explanation-chapter',sources:meta.classificationSources||[]},
    relationships:[{from:eventUri(activity),field:'inverse_consists_of',to:eventUri(parent)},
      ...documents.map(to=>({from:eventUri(parent),field:'based_on_a_realization_of',to})),
      ...documents.map(to=>({from:agendaUri,field:'based_on_a_realization_of',to})),
      {from:subject.uri,field:'executed',to:agendaUri}],sources:[]},gap:null};
}
