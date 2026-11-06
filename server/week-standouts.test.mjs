import test from 'node:test';
import assert from 'node:assert/strict';
import {finishedWeekSittings,sittingVotes,weekStandouts} from './week-standouts.mjs';
import {voteFixture} from './test-support/decision-votes.mjs';

// Small attributed fixtures: reduced from the retained public member-votes fixture
// (server/fixtures/member-votes.json, 2026-10-07 sitting). Voters, totals and
// titles are invented test inputs, not published results.
function wholeTextFixture() {
  const f=voteFixture();
  delete f.raw.decided_on_a_realization_of;
  f.raw.referenceText={en:'Motion for a resolution (as a whole)'};
  f.day.agenda.find(node=>node.activity_id==='MTG-PL-2026-10-07-OJ-ITM-V-48').activity_label={en:'Fixture agenda item title'};
  f.day.coverage={state:'complete'};
  return f;
}
// Two more PPE members vote in favour against their colleague, so one member differs from the group.
function withGroupSplit(f) {
  for(const id of ['1001','1002'])f.history.members[id]=structuredClone(f.history.members['197481']);
  f.raw.had_voter_favor=['person/197591','person/124846','person/1001','person/1002'];
  f.raw.number_of_votes_favor=4;
}
// The same stored day moved to another date.
const moved=(day,from,to)=>JSON.parse(JSON.stringify(day).replaceAll(from,to));
const store=snapshots=>({read:(kind,version,id)=>{const day=snapshots.get(id);return day?{day,bytes:1}:null;}});

test('only whole-text roll calls with totals and an exact agenda item are listed, with the group split',()=>{
  const f=wholeTextFixture();
  const [vote]=sittingVotes(f.day,{store:f.store});
  assert.equal(vote.id,'MTG-PL-2026-10-07-DEC-197457');
  assert.equal(vote.agendaItemId,'MTG-PL-2026-10-07-OJ-ITM-V-48');
  assert.equal(vote.outcome,'ADOPTED');assert.deepEqual(vote.totals,{for:2,against:1,abstaining:1});
  assert.equal(vote.differing,0);
  const amendment=voteFixture();amendment.day.coverage={state:'complete'};
  assert.deepEqual(sittingVotes(amendment.day,{store:amendment.store}),[]);
  for(const change of [x=>x.raw.decision_method='def/ep-decision-methods/VOTE_HAND',x=>delete x.raw.number_of_votes_favor,x=>x.day.agenda=[],x=>x.raw.decision_outcome='def/ep-statuses/LAPSED']) {
    const g=wholeTextFixture();change(g);assert.deepEqual(sittingVotes(g.day,{store:g.store}),[]);
  }
});

test('the group split counts members who left their group majority, and is unknown rather than zero without history',()=>{
  const f=wholeTextFixture();withGroupSplit(f);
  assert.equal(sittingVotes(f.day,{store:f.store})[0].differing,1);
  assert.equal(sittingVotes(f.day,{store:null})[0].differing,null);
  assert.equal(sittingVotes(f.day,{store:f.store,sharedHistory:{members:{},catalogue:null}})[0].differing,null);
});

test('a finished week names its closest vote and its biggest split, reading stored snapshots only',()=>{
  const a=wholeTextFixture(),b=wholeTextFixture();
  withGroupSplit(a);
  b.day=moved(a.day,'2026-10-07','2026-10-08');
  // Day a: 4 to 1. Day b: 3 to 1, so its tally no longer matches its named voters.
  b.day.decisions[0].number_of_votes_favor=3;
  const days=new Map([[a.day.sittingId,a.day],[b.day.sittingId,b.day]]),reads=[];
  const snapshots={read(kind,version,id,options){reads.push([kind,id,options.lastGood]);return store(days).read(kind,version,id);}};
  const result=weekStandouts([a.day.sittingId,b.day.sittingId],{snapshots,store:a.store});
  assert.deepEqual(reads,[['votes',a.day.sittingId,true],['votes',b.day.sittingId,true]]);
  assert.deepEqual(result.closest,{voteId:'MTG-PL-2026-10-08-DEC-197457',agendaItemId:'MTG-PL-2026-10-08-OJ-ITM-V-48',outcome:'ADOPTED',totals:{for:3,against:1,abstaining:1}});
  // Day b's tally no longer matches its named voters, so only day a has a known split.
  assert.deepEqual(result.split,{voteId:'MTG-PL-2026-10-07-DEC-197457',agendaItemId:'MTG-PL-2026-10-07-OJ-ITM-V-48',differing:1});
});

test('equal results order by later date, then identifier',()=>{
  const a=wholeTextFixture(),b=wholeTextFixture();
  withGroupSplit(a);b.day=moved(a.day,'2026-10-07','2026-10-08');
  const days=new Map([[a.day.sittingId,a.day],[b.day.sittingId,b.day]]);
  const result=weekStandouts([a.day.sittingId,b.day.sittingId],{snapshots:store(days),store:a.store});
  assert.equal(result.closest.voteId,'MTG-PL-2026-10-08-DEC-197457');
  assert.equal(result.split.voteId,'MTG-PL-2026-10-08-DEC-197457');
  const reversed=weekStandouts([b.day.sittingId,a.day.sittingId],{snapshots:store(days),store:a.store});
  assert.deepEqual(reversed,result);
});

test('an unknown split leaves that fact out and keeps the closest vote',()=>{
  const f=wholeTextFixture();withGroupSplit(f);
  const result=weekStandouts([f.day.sittingId],{snapshots:store(new Map([[f.day.sittingId,f.day]])),store:null});
  assert.equal(result.split,null);assert.equal(result.closest.voteId,'MTG-PL-2026-10-07-DEC-197457');
});

test('incomplete week data names no winner',()=>{
  const a=wholeTextFixture(),b=wholeTextFixture();
  b.day=moved(a.day,'2026-10-07','2026-10-08');
  const none={closest:null,split:null};
  // A sitting with no stored snapshot.
  assert.deepEqual(weekStandouts([a.day.sittingId,b.day.sittingId],{snapshots:store(new Map([[a.day.sittingId,a.day]])),store:a.store}),none);
  // A stored sitting whose vote records are partial.
  b.day.coverage={state:'partial'};
  assert.deepEqual(weekStandouts([a.day.sittingId,b.day.sittingId],{snapshots:store(new Map([[a.day.sittingId,a.day],[b.day.sittingId,b.day]])),store:a.store}),none);
  // A snapshot with another sitting's day, and a week with no sittings.
  assert.deepEqual(weekStandouts([a.day.sittingId],{snapshots:store(new Map([[a.day.sittingId,b.day]])),store:a.store}),none);
  assert.deepEqual(weekStandouts([],{snapshots:store(new Map()),store:null}),none);
});

test('only a week with every sitting held and none ahead is finished',()=>{
  const sittings=[{sittingId:'MTG-PL-2026-10-05',date:'2026-10-05'},{sittingId:'MTG-PL-2026-10-07',date:'2026-10-07'}];
  const calendar={weeks:[{week:'2026-10-05',sittings}]};
  assert.deepEqual(finishedWeekSittings(calendar,'2026-10-05','2026-11-06'),['MTG-PL-2026-10-05','MTG-PL-2026-10-07']);
  assert.deepEqual(finishedWeekSittings(calendar,'2026-10-05','2026-10-07'),[],'a sitting today is not finished');
  assert.deepEqual(finishedWeekSittings({...calendar,upcoming:[{week:'2026-10-05',sittings:[]}]},'2026-10-05','2026-11-06'),[],'a sitting still ahead');
  assert.deepEqual(finishedWeekSittings(calendar,'2026-09-28','2026-11-06'),[],'an unknown week');
});
