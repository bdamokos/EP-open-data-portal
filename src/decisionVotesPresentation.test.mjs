import test from 'node:test';
import assert from 'node:assert/strict';
import {voteFixture,contradictoryVoteFixture,decisionId,amendmentId} from '../server/test-support/decision-votes.mjs';
import {amendmentVoteBinding,authorVotePosition,decisionVotesRoute,validateDecisionVotes} from './decisionVotesPresentation.mjs';
const item={id:amendmentId};
test('response binding validates exact identity, dates, duplicate voters and complete counts',async()=>{
 const data=await voteFixture().read();assert(validateDecisionVotes(data,decisionId));
 for(const mutate of [d=>d.decisionId+='1',d=>d.sittingId+='1',d=>d.decision.date='2026-10-08',d=>d.voters.push(d.voters[0]),d=>d.decision.namedVoters.counts.for=99]){const value=structuredClone(data);mutate(value);assert.equal(validateDecisionVotes(value,decisionId),false);}
 assert.equal(decisionVotesRoute('MTG-PL-2026-02-30-DEC-1','en'),null);assert.equal(decisionVotesRoute(decisionId,'en'),'decision-votes/'+decisionId+'?lang=en');
});
test('only exact amendment and component sets corroborate the indexed decision',async()=>{
 const data=await voteFixture().read(),index={id:decisionId,outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:2,against:1,abstaining:1}};
 assert(amendmentVoteBinding(item,index,data));
 for(const mutate of [d=>d.decision.amendmentIds=['B-10-2026-0424-AM-115'],d=>d.decision.amendmentIds.push('B-10-2026-0424-AM-115'),d=>d.decision.referencesValid=false,d=>d.decision.decidedIds.push('B-10-2026-9999'),d=>d.decision.outcome='REJECTED',d=>d.decision.method='VOTE_HAND',d=>d.decision.totals.against=2,d=>d.decision.componentIds=['part-1']]){const value=structuredClone(data);mutate(value);assert.equal(amendmentVoteBinding(item,index,value),false);}
 const part='MTG-PL-2026-10-07-VOT-ITM-993151-SPLIT-1-2',split={...index,partId:'eli/dl/doc/'+part,partNumber:2,componentBinding:'single-amendment'};data.decision.componentIds=[part];assert(amendmentVoteBinding(item,split,data));
 assert.equal(amendmentVoteBinding(item,{...split,componentBinding:'unverified'},data),false);assert.equal(amendmentVoteBinding(item,{...split,partId:undefined},data),false);
 data.decision.componentIds=[part.replace(/2$/,'1')];assert.equal(amendmentVoteBinding(item,split,data),false);
});
test('authors use exact person IDs and distinguish unavailable, unrecorded and conflicting',async()=>{
 const f=voteFixture(),data=await f.read();assert.equal(authorVotePosition('197591',data),'For');assert.equal(authorVotePosition('999',data),'No recorded vote');assert.equal(authorVotePosition(null,data),'MEP unresolved');assert.equal(authorVotePosition('0197591',data),'MEP unresolved');
 f.raw.had_voter_against.push('person/197591');const partial=await f.read();assert.equal(authorVotePosition('197591',partial),'Conflicting record');assert.equal(authorVotePosition('999',partial),'Unavailable');
});

test('relationship contradictions cannot be relabelled as complete or bypass the client binding check',async()=>{
 for(const scenario of ['ambiguous-result-binding','conflicting-result-source','component-outside-result']) {
  const f=contradictoryVoteFixture(scenario),data=await f.read();assert(validateDecisionVotes(data,decisionId));assert.equal(amendmentVoteBinding(item,f.indexed,data),false);
  data.integrity='complete';assert.equal(validateDecisionVotes(data,decisionId),false);assert.equal(amendmentVoteBinding(item,f.indexed,data),false);
 }
});
test('missing context and split wording remain separate from contradictory bindings',async()=>{
 const data=await voteFixture().read();data.decision.resultRelationship={binding:'unlinked',inverseResultIds:[],forwardResultIds:[]};
 data.decision.evidenceGaps=[{code:'unlinked-result'},{code:'missing-component'},{code:'roll-call-requester-not-established'},{code:'ambiguous-component',details:[{code:'missing-component-wording'}]}];
 assert(validateDecisionVotes(data,decisionId));assert(amendmentVoteBinding(item,{id:decisionId},data));
 data.decision.evidenceGaps=[{code:'ambiguous-component',details:[{code:'conflicting-component-definition'}]}];assert.equal(validateDecisionVotes(data,decisionId),false);
});

test('a complete response cannot hide a known tally mismatch behind a missing total',async()=>{
 const fields=['for','against','abstaining'];
 for(const missing of fields)for(const mismatched of fields.filter(field=>field!==missing)){
  const data=await voteFixture().read();data.decision.totals[missing]=null;data.decision.totals[mismatched]=99;data.decision.namedVoters.totalsMatch=null;
  assert.equal(validateDecisionVotes(data,decisionId),false);
 }
});
