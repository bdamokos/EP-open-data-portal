import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mainVote} from './main-vote.mjs';
const {votes}=JSON.parse(readFileSync(new URL('./fixtures/reader-first-helpers.json',import.meta.url)));

test('held Erasmus+ main vote is DEC-198405 despite unclassified scope and no whole-text decisions',()=>{
  const subject=votes.subjects[0];assert.equal(subject.wholeTextDecisions.length,0);
  const decision=mainVote(votes.decisions,subject);
  assert.equal(decision.id,'MTG-PL-2026-10-22-DEC-198405');assert.equal(decision.scope.kind,'unclassified');
});
test('held procedural-only and amendment-only subjects have no main vote',()=>{
  assert.equal(votes.subjects.length,3);
  for(const subject of votes.subjects.slice(1))assert.equal(mainVote(votes.decisions,subject),null);
});
test('last non-lapsed whole-text vote has priority over English fallback',()=>{
  const a={id:'a',outcome:'ADOPTED'},b={id:'b',outcome:'REJECTED'},c={id:'c',outcome:'LAPSED'};
  assert.equal(mainVote([],{id:'s',wholeTextDecisions:[a,b,c]}),b);
});
test('fallback requires exact subject, conducted ballot and exact trimmed English text',()=>{
  const good={id:'a',subjectId:'s',ballotStatus:'conducted',referenceTexts:{en:' Commission proposal '}};
  const subject={id:'s',wholeTextDecisions:[]};
  assert.equal(mainVote([good],subject),good);
  for(const patch of [{subjectId:'other'},{ballotStatus:'unknown'},{outcome:'LAPSED'},{referenceTexts:{en:'Request for referral back to committee'}},{referenceTexts:{en:'Commission proposal (part 1)'}},{referenceTexts:{fr:'Commission proposal'}},{referenceTexts:{en:'commission proposal'}}])assert.equal(mainVote([{...good,...patch}],subject),null);
  const last={...good,id:'b'};assert.equal(mainVote([good,last],subject),last);
  assert.equal(mainVote([good],null),null);
});
