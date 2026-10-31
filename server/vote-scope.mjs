import {list,exactReference,references,eventUri,identifier,term} from './vote-evidence.mjs';

const componentFields=['decided_on_a_realization_of','decided_on_a_part_of_a_realization_of'];

// A part-of edge identifies its containing realization, not the part's extent
// or a decision on the complete amendment. Keep those identities separate.
export function explicitVoteScope(raw) {
  if(componentFields.some(field=>list(raw[field]).some(value=>!exactReference(value,'doc'))))return {kind:'unclassified',basis:'invalid-component-reference'};
  const components=references(raw.decided_on_a_realization_of,'doc');
  if(components.some(id=>/-SPLIT-\d+-\d+$/.test(id)))return {kind:'split-part',basis:'exact-component-reference'};
  if(references(raw.decided_on_a_part_of_a_realization_of,'doc').length)return {kind:'partial-text',basis:'exact-part-reference'};
  if(components.some(id=>/-AM-\d+(?:-\d+)?$/.test(id)))return {kind:'amendment',basis:'exact-component-reference'};
  return null;
}

// This exact English label family means the whole proposal at this reading.
// Labels supply scope only; identity and context require the retained graph.
export function isWholeProposalVote(raw,derived) {
  if(typeof raw.referenceText?.en!=='string'||raw.referenceText.en.trim()!=='Commission proposal'||typeof raw.headingLabel?.en!=='string'||raw.headingLabel.en.trim()!=='Draft legislative act')return false;
  if(componentFields.some(field=>list(raw[field]).length)||['decisionAboutId','decisionAboutId_XMLLiteral','decisionAboutId_Lang'].some(field=>list(raw[field]).length)||raw._conflictingSourceObservations)return false;
  if(term(raw.type||raw['@type'])!=='Vote'||!['ADOPTED','REJECTED'].includes(term(raw.decision_outcome)))return false;
  const namedArrays=['had_voter_favor','had_voter_against','had_voter_abstention'].every(field=>Array.isArray(raw[field]));
  if(!namedArrays&&!['VOTE_HAND','VOTE_ELECTRONIC','VOTE_ELECTRONIC_SECRET','VOTE_SECRET','VOTE_SECRET_BALLOT'].includes(term(raw.decision_method)))return false;
  const evidence=derived?.decisions.get(eventUri(raw));
  if(!evidence?.subjectId||!['consistent','single-direction'].includes(evidence.resultRelationship.binding))return false;
  if(evidence.evidenceGaps.some(gap=>!['roll-call-requester-not-established','missing-request'].includes(gap.code)))return false;
  const subject=derived.subjects.find(subject=>subject.id===evidence.subjectId);
  return Boolean(subject&&!subject.gaps.length&&subject.observedDecisionIds.includes(identifier(eventUri(raw))));
}
