import test from 'node:test';
import assert from 'node:assert/strict';
import {latestResults,latestResultsQuery,referenceLine,sittingResults} from './recent-results.mjs';
import {voteFixture} from './test-support/decision-votes.mjs';

// Small attributed fixtures: reduced from the retained public member-votes fixture
// (server/fixtures/member-votes.json, 2026-10-07 sitting). Voters, totals and
// titles are invented test inputs, not published results.
function wholeTextFixture() {
  const f=voteFixture();
  delete f.raw.decided_on_a_realization_of;
  f.raw.referenceText={en:'Motion for a resolution (as a whole)'};
  f.raw.activity_label={en:'Fixture vote label'};
  f.day.agenda.find(node=>node.activity_id==='MTG-PL-2026-10-07-OJ-ITM-V-48').activity_label={en:'Fixture agenda item title'};
  return f;
}
const sitting=day=>({id:'eli/dl/event/'+day.sittingId,activity_id:day.sittingId,activity_date:day.date||day.sittingId.slice(7),had_activity_type:'def/ep-activities/PLENARY_SITTING'});

test('query accepts only one language',()=>{
  assert.equal(latestResultsQuery(new URLSearchParams('lang=hu')).language,'hu');
  assert.throws(()=>latestResultsQuery(new URLSearchParams('week=2026-10-05')));
  assert.throws(()=>latestResultsQuery(new URLSearchParams('lang=en&lang=fr')));
});

test('references use only exact single ids',()=>{
  assert.equal(referenceLine(['2025-0385'],[]),'2025/0385');
  assert.equal(referenceLine(['2025-0385','2025-0386'],['A-10-2026-0237']),'A10-0237/2026');
  assert.equal(referenceLine([],['A-10-2026-0237','PV-10-2026-10-07-VOT-ITM-007','B-10-2026-0424-AM-114']),'A10-0237/2026');
  assert.equal(referenceLine([],['A-10-2026-0237','B-10-2026-0001']),null);
  assert.equal(referenceLine([],[]),null);
});

test('only whole-text roll calls with totals and an exact agenda item are listed, with the group split',()=>{
  const f=wholeTextFixture();
  const [vote]=sittingResults(f.day,{language:'en',store:f.store});
  assert.equal(vote.id,'MTG-PL-2026-10-07-DEC-197457');
  assert.equal(vote.title,'Fixture agenda item title');assert.equal(vote.topicId,'MTG-PL-2026-10-07-OJ-ITM-V-48');
  assert.equal(vote.outcome,'ADOPTED');assert.deepEqual(vote.totals,{for:2,against:1,abstaining:1});
  assert.equal(vote.reference,'2025/2117');
  assert.equal(typeof vote.differing,'number');
  // Amendments, hand votes, missing totals, missing agenda link and missing title are all left out.
  const amendment=voteFixture();assert.deepEqual(sittingResults(amendment.day,{language:'en',store:amendment.store}),[]);
  for(const change of [x=>x.raw.decision_method='def/ep-decision-methods/VOTE_HAND',x=>delete x.raw.number_of_votes_favor,x=>x.day.agenda=[],x=>x.day.agenda.forEach(n=>{n.activity_label={}}),x=>x.raw.decision_outcome='def/ep-statuses/LAPSED']) {
    const g=wholeTextFixture();change(g);assert.deepEqual(sittingResults(g.day,{language:'en',store:g.store}),[]);
  }
});

test('without group history the split is unknown, not zero',()=>{
  const f=wholeTextFixture();
  const [vote]=sittingResults(f.day,{language:'en',store:null});
  assert.equal(vote.differing,null);
});

test('the split is unknown when the group history places none of the voters',()=>{
  const f=wholeTextFixture();
  const [vote]=sittingResults(f.day,{language:'en',store:f.store,sharedHistory:{members:{},catalogue:null}});
  assert.equal(vote.differing,null);
});

test('latest results reads only stored snapshots and answers an empty list when none are stored',async()=>{
  const f=wholeTextFixture(),node=sitting(f.day);
  const reads=[];
  const snapshots={read(kind,version,id){reads.push(kind+':'+id);return kind==='calendar'&&id==='2026'?{nodes:[node]}:kind==='votes'&&id===f.day.sittingId?{day:f.day,bytes:10}:null;}};
  const clock=()=>Date.parse('2026-10-09T10:00:00Z');
  const data=await latestResults({language:'en'},{snapshots,store:f.store,clock});
  assert.equal(data.version,1);assert.equal(data.week,'2026-10-05');assert.deepEqual(data.sittingIds,[f.day.sittingId]);assert.equal(data.votes.length,1);
  assert(Buffer.byteLength(JSON.stringify(data))<20*1024);
  const empty=await latestResults({language:'en'},{snapshots:{read:()=>null},store:f.store,clock});
  assert.deepEqual(empty.votes,[]);assert.deepEqual(empty.sittingIds,[]);
});

test('future sittings and unstored recent sittings do not hide the latest stored week',async()=>{
  const f=wholeTextFixture();
  const later={id:'eli/dl/event/MTG-PL-2026-10-21',activity_id:'MTG-PL-2026-10-21',activity_date:'2026-10-21',had_activity_type:'def/ep-activities/PLENARY_SITTING'};
  const snapshots={read(kind,version,id){return kind==='calendar'&&id==='2026'?{nodes:[sitting(f.day),later]}:id===f.day.sittingId?{day:f.day,bytes:1}:null;}};
  const data=await latestResults({language:'en'},{snapshots,store:f.store,clock:()=>Date.parse('2026-10-23T10:00:00Z')});
  assert.equal(data.week,'2026-10-05');assert.equal(data.votes.length,1);
});

test('snapshots overdue or failing their refresh still answer: past votes are final',async()=>{
  const f=wholeTextFixture();
  const snapshots={read(kind,version,id,{lastGood=false}={}){if(!lastGood)return null;return kind==='calendar'&&id==='2026'?{nodes:[sitting(f.day)]}:id===f.day.sittingId?{day:f.day,bytes:1}:null;}};
  const data=await latestResults({language:'en'},{snapshots,store:f.store,clock:()=>Date.parse('2026-10-23T10:00:00Z')});
  assert.equal(data.week,'2026-10-05');assert.equal(data.votes.length,1);
});

test('the week is returned whole, so picks compare every vote, not the newest day',async()=>{
  const a=wholeTextFixture(),b=wholeTextFixture();
  // A second sitting day: the same stored day with every 2026-10-07 id and date moved to 2026-10-08.
  b.day=JSON.parse(JSON.stringify(a.day).replaceAll('2026-10-07','2026-10-08'));
  const nodes=[a,b].map(x=>sitting(x.day));
  const days=new Map([[a.day.sittingId,a.day],[b.day.sittingId,b.day]]);
  const snapshots={read(kind,version,id){return kind==='calendar'&&id==='2026'?{nodes}:days.has(id)?{day:days.get(id),bytes:1}:null;}};
  const data=await latestResults({language:'en'},{snapshots,store:null,clock:()=>Date.parse('2026-10-09T10:00:00Z')});
  assert.equal(data.sittingIds.length,2);
  assert(new Set(data.votes.map(vote=>vote.sittingId)).size===2);
});

test('concurrent cold reads share one scan',async()=>{
  const f=wholeTextFixture();let reads=0;
  const snapshots={read(kind,version,id){if(kind==='votes')reads++;return kind==='calendar'&&id==='2026'?{nodes:[sitting(f.day)]}:id===f.day.sittingId?{day:f.day,bytes:1}:null;}};
  const options={snapshots,store:null,clock:()=>Date.parse('2026-10-09T10:00:00Z')};
  const {latestResultsCached}=await import('./recent-results.mjs');
  const [x,y]=await Promise.all([latestResultsCached({language:'zz'},options),latestResultsCached({language:'zz'},options)]);
  assert.equal(x,y);assert.equal(reads,1);
});
