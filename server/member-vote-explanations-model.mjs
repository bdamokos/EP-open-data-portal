import {list,exactReference,references,eventUri,identifier,term} from './vote-evidence.mjs';
import {interventionMetadata,speechPeople} from './speech-interventions.mjs';
import {speechSummary} from './odp.mjs';
import {projectMemberSitting} from './member-votes-model.mjs';

const validRefs=(value,kind='event')=>list(value).every(value=>exactReference(value,kind));
const sameDay=(node,day)=>eventUri(node)&&node.activity_id===identifier(eventUri(node))&&node.activity_date===day.date&&node.activity_id.startsWith(day.sittingId+'-');
const whole=vote=>vote.ballotStatus==='conducted'&&!vote.sourceConflicts&&vote.scope.basis!=='invalid-component-reference'&&!['amendment','split-part','procedural'].includes(vote.scope.kind)&&
  !vote.context.amendmentIds.length&&!vote.context.componentIds.length&&
  (vote.scope.kind==='whole-text'||vote.referenceTexts.en?.trim()==='Text as a whole');

export function explanationVoteContext(day,memberId,decisionId,language='en') {
  const projected=projectMemberSitting(day,memberId,language),vote=projected.items.find(item=>item.id===decisionId);
  const subject=projected.subjects.find(subject=>subject.id===vote?.subjectId);
  const result=list(day.results).find(result=>eventUri(result)===subject?.uri);
  if(!vote||!subject||!result||vote.sourceConflicts||!['consistent','single-direction'].includes(vote.resultRelationship.binding)||
    subject.gaps.some(gap=>['conflicting-result-source','invalid-reference','ambiguous-decision-result-binding','conflicting-declared-decision'].includes(gap.code)))return {vote:vote||null,subject:null,anchor:null};
  const members=projected.items.filter(item=>item.subjectId===subject.id);
  const complete=day.coverage?.decisions?.state==='complete'&&subject.declaredDecisionIds.length>0&&
    subject.declaredDecisionIds.every(id=>members.some(item=>item.id===id&&!item.sourceConflicts))&&
    !subject.gaps.some(gap=>gap.code==='missing-declared-decision');
  const finals=members.filter(whole);
  return {vote,subject,result,anchor:complete&&finals.length===1?finals[0].id:null};
}

// The graph establishes a subject relationship. A final ballot is a display
// anchor only; it never turns that relationship into an amendment-level claim.
export function matchVoteExplanation(activity,parent,day,context,memberId) {
  const {subject,result}=context;
  if(day.coverage?.agenda?.state!=='complete'||day.coverage?.results?.state!=='complete')return {item:null,gap:'vote-context-incomplete'};
  if(!subject||!sameDay(activity,day)||!sameDay(parent,day)||term(activity.had_activity_type)!=='PLENARY_DEBATE_SPEECH'||
    term(parent.had_activity_type)!=='PLENARY_VOTE_EXPLANATIONS')return {item:null,gap:null};
  const people=speechPeople(activity),participations=list(activity.had_participation);
  if(people.length!==1||people[0]!==String(memberId)||!participations.some(p=>term(p.participation_role)==='SPEAKER'&&list(p.had_participant_person).some(p=>String(p?.id||p).match(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?person\/([1-9]\d*)$/)?.[1]===String(memberId))))return {item:null,gap:'speaker-unresolved'};
  const parents=references(activity.inverse_consists_of);
  if(!validRefs(activity.inverse_consists_of)||parents.length!==1||parents[0]!==eventUri(parent)||
    !validRefs(parent.consists_of)||!references(parent.consists_of).includes(eventUri(activity)))return {item:null,gap:'explanation-parent-conflict'};
  const meta=interventionMetadata(activity);
  if(!['speech','oral-explanation-of-vote'].includes(meta.type))return {item:null,gap:meta.type==='unclassified'?'classification-unavailable':null};
  const documents=references(parent.based_on_a_realization_of,'doc');
  if(!documents.length||!validRefs(parent.based_on_a_realization_of,'doc'))return {item:null,gap:'explanation-document-unavailable'};
  const candidates=list(day.agenda).filter(node=>sameDay(node,day)&&term(node.had_activity_type)==='PLENARY_VOTE'&&
    references(node.based_on_a_realization_of,'doc').some(id=>documents.includes(id)));
  if(candidates.length!==1)return {item:null,gap:'explanation-agenda-unresolved'};
  const agenda=candidates[0],agendaUri=eventUri(agenda);
  if(!validRefs(agenda.based_on_a_realization_of,'doc')||!documents.every(id=>references(agenda.based_on_a_realization_of,'doc').includes(id)))return {item:null,gap:'explanation-document-conflict'};
  if(!subject.agendaItemIds.includes(agenda.activity_id))return {item:null,gap:null};
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
