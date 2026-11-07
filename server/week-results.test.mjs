import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectWeekResults,weekResults,weekResultsQuery} from './week-results.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/member-votes.json',import.meta.url),'utf8'));
const days=structuredClone(fixture.snapshots).map(day=>({...day,coverage:{state:'complete'}}));
const calendar=location=>({weeks:[{week:'2026-10-05',sittings:[{sittingId:'MTG-PL-2026-10-05',location},{sittingId:'MTG-PL-2026-10-07',location}]}]});

test('counts conducted, roll-call and not-conducted decisions per sitting, and joins items to subjects by exact identifier',()=>{
  const result=projectWeekResults({week:'2026-10-05'},{days},'Strasbourg');
  assert.deepEqual(result.days,[
    {sittingId:'MTG-PL-2026-10-07',complete:true,voteCount:4,rollCallCount:4,notConducted:1},
    {sittingId:'MTG-PL-2026-10-05',complete:true,voteCount:1,rollCallCount:1,notConducted:0},
  ]);
  assert.deepEqual(result.items.map(item=>[item.agendaItemId,item.voteCount]),[['MTG-PL-2026-10-07-OJ-ITM-V-45',1],['MTG-PL-2026-10-07-OJ-ITM-V-48',4]]);
});

test('an item reads a main vote only when the stream 0 rule finds exactly one',()=>{
  const result=projectWeekResults({week:'2026-10-05'},{days},'Strasbourg');
  assert.equal(result.items[0].main,null);
  assert.deepEqual(result.items[1].main,{id:'MTG-PL-2026-10-07-DEC-197457',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:454,against:86,abstaining:110}});
});

test('the response stays small and keeps the sitting order of the snapshot',()=>{
  const result=projectWeekResults({week:'2026-10-05'},{days},null);
  assert.equal(result.location,null);
  assert(Buffer.byteLength(JSON.stringify(result))<4_000);
});

test('a week with no snapshot has a place and no results',async()=>{
  const reads=[];
  const result=await weekResults({week:'2026-11-09'},{clock:()=>Date.parse('2026-11-06T10:00:00Z'),periods:{collect:async()=>({weeks:[{week:'2026-11-09',sittings:[{location:'Brussels'},{location:'Brussels'}]}]})},votes:{snapshot:async query=>{reads.push(query);}}});
  assert.deepEqual(result,{version:3,week:'2026-11-09',location:'Brussels',days:[],items:[],unlinked:[]});
  assert.deepEqual(reads,[]);
});

test('a week reads the same period snapshot as the member records',async()=>{
  const reads=[];
  const result=await weekResults({week:'2026-10-05'},{clock:()=>Date.parse('2026-11-06T10:00:00Z'),periods:{collect:async()=>calendar('Strasbourg')},votes:{snapshot:async query=>{reads.push(query);return {id:'a'.repeat(64),days,coverage:{status:'complete'}};}}});
  assert.equal(result.location,'Strasbourg');
  assert.equal(reads.length,1);
  assert.equal(reads[0].week,'2026-10-05');
  assert.equal(reads[0].sitting,null);
});

test('a place shared by no single listed location is not named',async()=>{
  const clock=()=>Date.parse('2026-11-06T10:00:00Z'),votes={snapshot:async()=>({days:[],coverage:{status:'complete'}})};
  const mixed={weeks:[{week:'2026-10-05',sittings:[{location:'Strasbourg'},{location:'Brussels'}]}]};
  assert.equal((await weekResults({week:'2026-10-05'},{clock,votes,periods:{collect:async()=>mixed}})).location,null);
  assert.equal((await weekResults({week:'2026-10-05'},{clock,votes,periods:{collect:async()=>calendar(null)}})).location,null);
  assert.equal((await weekResults({week:'2026-09-28'},{clock,votes,periods:{collect:async()=>calendar('Brussels')}})).location,null);
});

test('an unavailable period is an error, not an empty week',async()=>{
  await assert.rejects(weekResults({week:'2026-10-05'},{clock:()=>Date.parse('2026-11-06T10:00:00Z'),periods:{collect:async()=>calendar('Strasbourg')},votes:{snapshot:async()=>({days:[],coverage:{status:'unavailable'}})}}),{code:'week_results_unavailable'});
});

test('the query accepts a Monday in the current term and nothing else',()=>{
  assert.deepEqual(weekResultsQuery(new URLSearchParams({week:'2026-10-19',lang:'fr'})),{week:'2026-10-19'});
  for(const search of ['','week=2026-10-20','week=2026-02-30','week=latest','week=2020-01-06','week=2026-10-19&week=2026-10-12','week=2026-10-19&sitting=MTG-PL-2026-10-19'])
    assert.throws(()=>weekResultsQuery(new URLSearchParams(search)),{status:400});
});

test('the insights route serves the view through the response cache',async()=>{
  const {createInsights}=await import('./insights.mjs');
  let reads=0;
  const clock=()=>Date.parse('2026-11-06T10:00:00Z');
  const insights=createInsights({status:()=>({}),get:()=>0},{clock,viewCache:{directory:null},
    votePeriods:{collect:async()=>calendar('Strasbourg')},
    memberVotes:{snapshot:async()=>{reads++;return {id:'a'.repeat(64),days,coverage:{status:'complete'}};}}});
  const search=new URLSearchParams({week:'2026-10-05',lang:'en'});
  const first=await insights.query('week-results',search),second=await insights.query('week-results',search);
  assert.equal(first.items.length,2);
  assert.deepEqual(second.items,first.items);
  assert.equal(reads,1);
  await assert.rejects(insights.query('week-results',new URLSearchParams()),{status:400});
});

test('a sitting with partial records has unknown counts and contributes no items',()=>{
  const partial=days.map((day,index)=>index?day:{...day,coverage:{state:'partial'}});
  const result=projectWeekResults({week:'2026-10-05'},{days:partial},null);
  assert.deepEqual(result.days[0],{sittingId:'MTG-PL-2026-10-07',complete:false,voteCount:null,rollCallCount:null,notConducted:null});
  assert.equal(result.days[1].complete,true);
  assert.deepEqual(result.items,[]);
});
test('the reply exposes single-vote summaries and unlinked decisions without losing lapsed counts',()=>{
 const result=projectWeekResults({week:'2026-10-05'},{days},null);
 assert.equal(result.version,3);
 const single=result.items.find(item=>!item.main&&item.voteCount===1);assert.equal(single.summary.kind,'single');assert.equal(typeof single.summary.vote.id,'string');
 assert(result.unlinked.some(item=>item.sittingId==='MTG-PL-2026-10-05'));
 const multiple=structuredClone(days),singleDay=multiple[0];
 // Clone the single-vote item's decision to four non-main decisions, forcing
 // outcome counts regardless of the one-counted-sibling exception.
 const decision=singleDay.decisions.find(row=>row.activity_id===single.summary.vote.id);
 assert(decision);
 for(let i=1;i<=3;i++) {
  const raw=structuredClone(decision);raw.activity_id+='-fixture'+i;
  raw.id=raw.id.replace(/[^/]+$/,raw.activity_id);raw.decision_outcome='def/ep-statuses/LAPSED';
  singleDay.decisions.push(raw);
 }
 const counts=projectWeekResults({week:'2026-10-05'},{days:multiple},null).items.find(item=>item.agendaItemId===single.agendaItemId);
 assert.equal(counts.summary.kind,'counts');
 assert.equal(counts.summary.lapsed,4);
 assert.equal(counts.summary.adopted+counts.summary.rejected+counts.summary.lapsed+counts.summary.unknown,counts.voteCount);
});
test('an unlinked decision with no label keeps its published reference text as its title',()=>{
 const copy=structuredClone(days),{id}=projectWeekResults({week:'2026-10-05'},{days},null).unlinked[0],target=copy.flatMap(day=>day.decisions).find(row=>row.activity_id===id);
 assert(target);
 delete target.activity_label;delete target.headingLabel;target.referenceText={en:'Request for an urgent decision'};
 const row=projectWeekResults({week:'2026-10-05'},{days:copy},null).unlinked.find(item=>item.id===id);
 assert.deepEqual(row.titles,{en:'Request for an urgent decision'});
});
