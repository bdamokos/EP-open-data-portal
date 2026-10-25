import {deriveVoteEvidence,eventUri} from './vote-evidence.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionVotes,decisionVotesQuery} from './decision-votes.mjs';
import {voteFixture,contradictoryVoteFixture,splitBindingFixture,decisionId,amendmentId} from './test-support/decision-votes.mjs';
import {apiCachePolicy} from './response-cache.mjs';

const now={now:Date.parse('2026-10-24')};
test('decision query pins a held sitting and permits only language and snapshot',()=>{
 const query=decisionVotesQuery(decisionId,new URLSearchParams('lang=hu&snapshot='+'b'.repeat(64)),now);
 assert.equal(query.sitting,'MTG-PL-2026-10-07');assert.equal(query.decision,decisionId);assert.equal(query.language,'hu');assert.equal(query.snapshot,'b'.repeat(64));
 for(const id of ['MTG-PL-2026-02-30-DEC-1','MTG-PL-2027-01-01-DEC-1','https://other.test/'+decisionId])assert.throws(()=>decisionVotesQuery(id,new URLSearchParams(),now));
 for(const params of ['member=1','lang=en&lang=fr','snapshot=bad'])assert.throws(()=>decisionVotesQuery(decisionId,new URLSearchParams(params),now));
});
test('selected decision reuses the member snapshot and keeps actual positions separate from intentions',async()=>{
 const f=voteFixture(),before=structuredClone(f.day),data=await f.read();
 assert.equal(f.reads(),1);assert.equal(data.integrity,'complete');assert.equal(data.snapshotId,'a'.repeat(64));
 assert.deepEqual(data.decision.amendmentIds,[amendmentId]);assert.equal(data.voters.find(v=>v.personId==='197591').position,'for');
 assert.equal(data.groupHistory.generation,7);assert.equal(data.groupHistory.epoch,'fixture-epoch');assert.deepEqual(f.day,before);
 assert(data.decision.sources.decisions.every(s=>s.url&&s.fetchedAt&&s.contentHash));
 assert.equal(apiCachePolicy({method:'GET'},new URL('http://localhost/api/decision-votes/'+decisionId),data).cacheControl,'no-store');
});
test('malformed, conflicting and mismatched ballots retain observations but never a complete matrix',async()=>{
 for(const change of [f=>f.raw.had_voter_against.push('person/197591'),f=>f.raw.had_voter_favor.push('https://other.test/person/99'),f=>f.raw.number_of_votes_favor=99]) {
  const f=voteFixture();change(f);const data=await f.read();assert.equal(data.integrity,'partial');
  assert.equal(data.voters.filter(v=>v.personId==='197591').length,1);
 }
 const f=voteFixture();f.raw.had_voter_against.push('person/197591');const data=await f.read();
 assert.equal(data.voters.find(v=>v.personId==='197591').status,'conflicting');assert.equal(data.voters.find(v=>v.personId==='197591').position,null);
 f.raw._conflictingSourceObservations={fields:['decision_method']};assert.equal((await f.read()).integrity,'conflicting');assert.deepEqual((await f.read()).voters,[]);
});
test('non-conducted, non-named and omitted arrays never expose named positions',async()=>{
 for(const change of [f=>f.raw.decision_outcome='def/ep-statuses/LAPSED',f=>f.raw.decision_method='def/ep-decision-methods/VOTE_HAND',f=>delete f.raw.had_voter_favor]) {
  const f=voteFixture();change(f);const data=await f.read();assert.equal(data.integrity,'unavailable');assert.deepEqual(data.voters,[]);
 }
 const f=voteFixture();f.day.decisions=[];const data=await f.read();assert.equal(data.status,'unavailable');assert.equal(data.decision,null);
});
test('dated groups preserve switches, explicit NI, missing and ambiguous history',async()=>{
 const f=voteFixture();f.history.members['197591'].groups=[{code:'PPE',org:'org/7018',groupId:'org/PPE',start:'2024-07-16',end:'2026-10-07'},{code:'Renew',org:'org/7035',groupId:'org/RENEW',start:'2026-10-08',end:null}];
 f.history.members['124846'].ambiguous=[{start:'2026-10-07',end:'2026-10-07'}];delete f.history.members['197481'];
 const data=await f.read(),by=id=>data.voters.find(v=>v.personId===id);
 assert.equal(by('197591').group.code,'PPE');assert.equal(by('124846').group,null);assert.equal(by('124846').groupStatus,'ambiguous');assert.equal(by('197481').group,null);assert.equal(by('256852').group.code,'NI');
 const missing=await decisionVotes(f.query,{reader:f.reader});assert.equal(missing.groupHistory,null);assert(missing.voters.every(v=>v.group===null));assert.equal(missing.integrity,'complete');
});
test('invalid exact references remain explicit even when another reference is valid',async()=>{
 const f=voteFixture();f.raw.decided_on_a_realization_of.push('https://other.test/eli/dl/doc/'+amendmentId);
 assert.equal((await f.read()).decision.referencesValid,false);
});

test('contradictory result and component ownership withhold every named join',async()=>{
 for(const scenario of ['ambiguous-result-binding','conflicting-result-source','component-outside-result']) {
  const f=contradictoryVoteFixture(scenario),data=await f.read();
  assert(data.decision.evidenceGaps.some(gap=>gap.code===scenario),scenario);assert.equal(data.integrity,'conflicting',scenario);assert.deepEqual(data.voters,[],scenario);
  assert(data.decision.resultRelationship);assert.equal(data.decision.outcome,'ADOPTED');
 }
});

test('component ownership and definitions remain independent of wording and parent availability',async()=>{
 for(const ownership of ['single','shared','outside','unknown'])for(const wording of ['valid','missing','unreadable'])for(const definitions of ['consistent','conflicting'])for(const context of ['present','missing']) {
  const scenario={ownership,wording,definitions,context},f=splitBindingFixture(scenario),data=await f.read(),blocked=ownership==='shared'||ownership==='outside'||definitions==='conflicting';
  assert.equal(data.integrity,blocked?'conflicting':'complete',JSON.stringify(scenario));assert.equal(data.voters.length,blocked?0:4,JSON.stringify(scenario));
  assert.equal(data.decision.bindingConflicts.length>0,blocked,JSON.stringify(scenario));
  // The optional graph observation must not change the member reader contract.
  const legacy=deriveVoteEvidence(f.day).decisions.get(eventUri(f.raw));assert.equal(Object.hasOwn(legacy,'bindingConflicts'),false);
 }
});
test('an omitted request type is unknown; a supplied different type contradicts a split binding',async()=>{
 for(const type of [undefined,'def/ep-activities/REQUEST_VOTE_SEPARATE']) {
  const f=splitBindingFixture({context:'missing',wording:'missing'});f.day.requests[0].had_activity_type=type;
  const data=await f.read();assert.equal(data.integrity,type?'conflicting':'complete');
 }
});

test('each supplied tally is checked even when another tally is missing',async()=>{
 const fields=['number_of_votes_favor','number_of_votes_against','number_of_votes_abstention'];
 for(const missing of fields){
  const matching=voteFixture();delete matching.raw[missing];assert.equal((await matching.read()).integrity,'complete');
  for(const mismatched of fields.filter(field=>field!==missing)){
   const f=voteFixture();delete f.raw[missing];f.raw[mismatched]=99;const data=await f.read();
   assert.equal(data.integrity,'partial');assert.equal(data.decision.namedVoters.totalsMatch,false);assert.equal(data.voters.length,4);
  }
 }
});
