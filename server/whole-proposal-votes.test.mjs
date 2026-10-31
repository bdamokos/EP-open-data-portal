import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectMemberDecision,projectMemberSitting} from './member-votes-model.mjs';
import {deriveVoteEvidence} from './vote-evidence.mjs';
import {voteScope,topicVotes,finalVotePatterns} from './insights-legislation-model.mjs';
import {explanationVoteContext} from './member-vote-explanations-model.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/whole-proposal-votes.json',import.meta.url)));
const snapshot=fixture.snapshot;
const raw=snapshot.decisions.find(row=>row.activity_id.endsWith('-199470'));
const referral=snapshot.decisions.find(row=>row.activity_id.endsWith('-199471'));
const partial=snapshot.decisions.find(row=>row.activity_id.endsWith('-199472'));
const member=raw.had_voter_favor[0].split('/').at(-1);
const project=(decision,state=snapshot)=>projectMemberDecision(decision,state,member);
const changed=patch=>({...snapshot,decisions:snapshot.decisions.map(row=>row===raw?{...raw,...patch}:row)});
const changedVote=state=>state.decisions.find(row=>row.activity_id===raw.activity_id);
const general=(decision,state=snapshot)=>voteScope(decision,deriveVoteEvidence(state));

test('native 199470 covers the whole Commission proposal at this reading with its exact complete parent',()=>{
  const before=structuredClone(snapshot),vote=project(raw),sitting=projectMemberSitting(snapshot,member);
  assert.deepEqual(vote.scope,{kind:'whole-text',basis:'english-proposal-label'});
  assert.equal(general(raw),'final-text');
  assert.equal(voteScope(raw),'unclassified','labels alone do not establish the new family without the graph');
  assert.equal(vote.referenceTexts.en,'Commission proposal');
  assert.equal(raw.headingLabel.en,'Draft legislative act ');
  assert.deepEqual(vote.resultRelationship,{binding:'consistent',inverseResultIds:['MTG-PL-2026-10-22-VOT-ITM-993335'],forwardResultIds:['MTG-PL-2026-10-22-VOT-ITM-993335']});
  assert(vote.context.documentIds.includes('A-10-2026-0276'));
  assert.deepEqual(vote.context.procedureIds,['2026-0211']);
  assert.deepEqual(vote.actualPosition,{status:'recorded',position:'for'});
  assert.deepEqual(vote.totals,{for:474,against:82,abstaining:28});
  assert.equal(vote.namedVoters.totalsMatch,true);
  assert.equal(vote.outcome,'ADOPTED');assert.equal(vote.ballotStatus,'conducted');
  const subject=sitting.subjects.find(row=>row.id===vote.subjectId);
  assert.equal(subject.declaredDecisionIds.length,17);
  assert.equal(subject.observedDecisionIds.length,17);
  assert.deepEqual(subject.gaps,[]);
  assert.deepEqual(subject.wholeTextDecisions.map(row=>row.id),[raw.activity_id]);
  assert.deepEqual(snapshot,before,'projection preserves retained labels, positions, intentions and source records');
  assert.deepEqual(project(referral).scope,{kind:'procedural',basis:'english-reference-label'});
  assert.equal(general(referral),'procedural');
});

test('native agenda projection recognises the proposal while missing agenda coverage withholds the explanation anchor',()=>{
  const result=snapshot.results[0],topic={id:result.executed[0].split('/').at(-1),uri:result.executed[0]};
  const records={url:'https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-10-22/decisions',fetchedAt:null,payload:{data:snapshot.decisions}};
  const votes=topicVotes(topic,{payload:{data:snapshot.results}},records,new Map(),new Map(),'2026-10-22');
  const proposal=votes.find(vote=>vote.id===raw.activity_id);
  assert.equal(proposal.scope,'final-text');
  assert.deepEqual(proposal.associations[0].documentIds,['A-10-2026-0276']);
  assert.deepEqual(proposal.associations[0].procedureIds,['2026-0211']);
  assert.deepEqual(finalVotePatterns(votes,new Map(),new Map()).finalTextVoteIds,[raw.activity_id]);
  const context=explanationVoteContext(snapshot,member,referral.activity_id,'en');
  assert.equal(context.anchor,null);
  assert(context.gaps.some(gap=>gap.code==='vote-agenda-incomplete'));
});

test('native lapsed 199472 retains its exact part-of edge without a whole-amendment or split extent',()=>{
  const vote=project(partial),target='A-10-2026-0104-AM-118';
  assert.deepEqual(vote.scope,{kind:'partial-text',basis:'exact-part-reference'});
  assert.equal(general(partial),'amendment');
  assert.deepEqual(vote.context.partialReferenceIds,[target]);
  assert(vote.context.documentIds.includes(target));
  assert(vote.context.relationships.some(edge=>edge.from===vote.uri&&edge.field==='decided_on_a_part_of_a_realization_of'&&edge.to==='https://data.europarl.europa.eu/eli/dl/doc/'+target));
  assert.deepEqual(vote.context.amendmentIds,[]);assert.deepEqual(vote.context.componentIds,[]);assert.deepEqual(vote.parts,[]);
  assert.equal(vote.outcome,'LAPSED');assert.equal(vote.ballotStatus,'not-conducted');
  assert.deepEqual(vote.actualPosition,{status:'not-conducted',position:null});
  assert.deepEqual(vote.totals,{for:null,against:null,abstaining:null});
  assert(!projectMemberSitting(snapshot,member).subjects.flatMap(row=>row.wholeTextDecisions).some(row=>row.id===partial.activity_id));
});

test('whole-proposal labels require the exact trimmed English reference and heading',()=>{
  for(const patch of [
    {referenceText:{en:' Commission proposal \t'},headingLabel:{en:' Draft legislative act \n'}},
  ])assert.equal(project(changedVote(changed(patch)),changed(patch)).scope.kind,'whole-text');
  for(const patch of [
    {referenceText:{fr:'Commission proposal'}},{referenceText:{en:42}},{referenceText:null},
    {referenceText:{en:'commission proposal'}},{referenceText:{en:'Commission proposal (as a whole)'}},
    {referenceText:{en:'Proposal of the Commission'}},{referenceText:{en:'Text as a whole'}},
    {headingLabel:{fr:'Draft legislative act'}},{headingLabel:null},{headingLabel:{en:42}},
    {headingLabel:{en:'Draft budget'}},{headingLabel:{en:'Draft decision'}},{headingLabel:{en:'draft legislative act'}},
    {headingLabel:{en:'Draft legislative act (first reading)'}},
  ]){
    const state=changed(patch),decision=changedVote(state);
    assert.equal(project(decision,state).scope.kind,'unclassified',JSON.stringify(patch));
    assert.equal(general(decision,state),'unclassified',JSON.stringify(patch));
  }
});

test('explicit components, partial references, split identifiers and provisional agreements precede proposal scope',()=>{
  for(const [patch,kind] of [
    [{decided_on_a_realization_of:['eli/dl/doc/A-10-2026-0276-AM-1']},'amendment'],
    [{decided_on_a_realization_of:['eli/dl/doc/MTG-PL-2026-10-22-VOT-ITM-993335-SPLIT-1-2']},'split-part'],
    [{decided_on_a_part_of_a_realization_of:'eli/dl/doc/A-10-2026-0276-AM-1'},'partial-text'],
    [{decisionAboutId:'1PC1'},'unclassified'],
    [{decisionAboutId_XMLLiteral:'<am><reference>1</reference></am>'},'unclassified'],
    [{decisionAboutId_Lang:{en:'1CP1'}},'unclassified'],
    [{decided_on_a_realization_of:['eli/dl/doc/A-10-2026-0276']},'unclassified'],
    [{referenceText:{en:'Provisional agreement'}},'amendment'],
    [{referenceText:{en:'Commission proposal – provisional agreement'}},'amendment'],
    [{referenceText:{en:'Commission proposal – separate vote'}},'unclassified'],
  ]){
    const state=changed(patch),decision=changedVote(state);
    assert.equal(project(decision,state).scope.kind,kind,JSON.stringify(patch));
    assert.notEqual(general(decision,state),'final-text',JSON.stringify(patch));
  }
});

test('malformed references, conflicting projections and incomplete result graphs withhold new whole-text scope',()=>{
  const states=[
    {...snapshot,results:[]},
    {...snapshot,decisions:snapshot.decisions.filter(row=>row!==referral)},
    changed({inverse_consists_of:['https://example.com/eli/dl/event/MTG-PL-2026-10-22-VOT-ITM-993335']}),
    changed({_conflictingSourceObservations:{fields:['referenceText']}}),
    changed({type:'Decision'}),
    changed({had_voter_against:undefined}),
    changed({decided_on_a_realization_of:['https://example.com/eli/dl/doc/A-10-2026-0276-AM-1']}),
    changed({decided_on_a_part_of_a_realization_of:{id:'eli/dl/doc/A-10-2026-0276-AM-1',identifier:'OTHER'}}),
    {...snapshot,results:snapshot.results.map((row,i)=>i?row:{...row,consists_of:[...row.consists_of,'https://example.com/eli/dl/event/INVALID']})},
    {...snapshot,results:snapshot.results.map((row,i)=>i?row:{...row,based_on_a_realization_of:['https://example.com/eli/dl/doc/A-10-2026-0276']})},
    {...snapshot,results:snapshot.results.map((row,i)=>i?row:{...row,inverse_consists_of:[{id:'eli/dl/proc/2026-0211',identifier:'2026-9999'}]})},
    {...snapshot,conflictingResults:[{...snapshot.results[0],activity_label:{en:'Conflicting source'}}]},
    {...snapshot,results:snapshot.results.map((row,i)=>i?{...row,consists_of:[...row.consists_of,raw.id]}:row)},
  ];
  for(const state of states){
    const decision=changedVote(state);
    assert.notEqual(project(decision,state).scope.kind,'whole-text');
    assert.notEqual(general(decision,state),'final-text');
  }
  const malformed=states.find(state=>changedVote(state).decided_on_a_part_of_a_realization_of),vote=project(changedVote(malformed),malformed);
  assert.deepEqual(vote.context.partialReferenceIds,[]);
  assert(vote.evidenceGaps.some(gap=>gap.code==='invalid-reference'&&gap.field==='decided_on_a_part_of_a_realization_of'));
});

test('unheld proposal decisions retain outcome, null tallies and not-conducted status without a whole-text anchor',()=>{
  for(const outcome of ['LAPSED','WITHDRAWN','CANCELLED','NOT_HELD']){
    const state=changed({decision_outcome:'def/ep-statuses/'+outcome,number_of_votes_favor:null,number_of_votes_against:null,number_of_votes_abstention:null}),decision=changedVote(state),vote=project(decision,state);
    assert.equal(vote.outcome,outcome);assert.equal(vote.ballotStatus,'not-conducted');
    assert.deepEqual(vote.totals,{for:null,against:null,abstaining:null});
    assert.notEqual(vote.scope.kind,'whole-text');assert.notEqual(general(decision,state),'final-text');
  }
});


test('whole-proposal promotion requires exact nonempty declared and usable observed parent membership',()=>{
  const mutations=[
    s=>delete s.results[0].consists_of,
    s=>s.results[0].consists_of=[],
    s=>s.results[0].consists_of=s.results[0].consists_of.filter(id=>!String(id).endsWith('-199470')),
    s=>s.decisions.find(row=>row.activity_id===referral.activity_id).inverse_consists_of=['https://example.com/eli/dl/event/MTG-PL-2026-10-22-VOT-ITM-993335'],
    s=>s.decisions.find(row=>row.activity_id===referral.activity_id).decided_on_a_part_of_a_realization_of=['https://example.com/eli/dl/doc/A-10-2026-0276-AM-1'],
  ];
  for(const mutate of mutations){
    const state=structuredClone(snapshot);mutate(state);const decision=changedVote(state);
    assert.notEqual(project(decision,state).scope.kind,'whole-text');
    assert.notEqual(general(decision,state),'final-text');
    const subject=projectMemberSitting(state,member).subjects.find(row=>row.id.endsWith('-993335'));
    assert.equal(subject.wholeTextDecisions.length,0);
    assert(subject.gaps.some(gap=>gap.code==='whole-text-outcome-not-established'));
  }
  const unrelated=structuredClone(snapshot);delete unrelated.results[1].consists_of;
  assert.equal(project(changedVote(unrelated),unrelated).scope.kind,'whole-text','an unrelated incomplete parent does not block this complete graph');
});

test('exact split, separate, unresolved and untyped requests block proposal scope while roll-call requests remain eligible',()=>{
  for(const type of ['REQUEST_VOTE_SPLIT','REQUEST_VOTE_SEPARATE','REQUEST_VOTE_ROLLCALL',null,'unresolved']){
    const state=structuredClone(snapshot),decision=changedVote(state),parent=state.results[0];
    const request={id:parent.id+'-SPLIT-999',...(type&&type!=='unresolved'?{had_activity_type:'def/ep-activities/'+type}:{})};
    decision.was_motivated_by=[request.id];
    if(type!=='unresolved')parent.was_motivated_by.push(request);
    const expected=type==='REQUEST_VOTE_ROLLCALL';
    assert.equal(project(decision,state).scope.kind==='whole-text',expected,String(type));
    assert.equal(general(decision,state)==='final-text',expected,String(type));
    if(!expected){
      assert.deepEqual(project(decision,state).parts,[],'request identity alone does not establish a part extent');
      assert(!projectMemberSitting(state,member).subjects.flatMap(row=>row.wholeTextDecisions).some(row=>row.id===decision.activity_id));
    }
  }
});
