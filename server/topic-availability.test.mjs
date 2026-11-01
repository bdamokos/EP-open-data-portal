import {DatabaseSync} from 'node:sqlite';
import {prepareFastReads} from './fast-read-projections.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {savedProcedureEvents,topicTimeline} from './topic-trends.mjs';
import {sourceAvailability} from './source-availability.mjs';

const event=(day,n)=>({id:`eli/dl/event/MTG-PL-${day}-PVCRE-ITM-${n}`,had_activity_type:'def/ep-activities/PLENARY_DEBATE',activity_date:day});
const row=(n,day)=>({key:'/procedures/2026-'+String(n).padStart(4,'0'),body:JSON.stringify({id:'eli/dl/proc/2026-'+String(n).padStart(4,'0'),consists_of:[event(day,n)]}),fetched_at:'2026-10-22T12:00:00Z'});
const store=rows=>{
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sources(generation,key,kind,body,fetched_at); CREATE TABLE amendments(generation,date,target,body,id,outcome); CREATE TABLE outside_contributions(generation,date,speech,person,body); CREATE TABLE amendment_targets(generation,id,body);');
  const put=db.prepare("INSERT INTO sources VALUES (1,?,'procedure',?,?)");
  for(const row of rows)put.run(row.key,row.body,row.fetched_at);
  prepareFastReads(db);return {status:()=>({servingGeneration:1}),db};
};

test('procedure event frontiers ignore the selected end date and the dossier cap favours recent events',()=>{
  const rows=Array.from({length:601},(_,i)=>row(i+1,i===600?'2026-10-20':'2026-10-09'));
  const recent=savedProcedureEvents(store(rows),{start:'2026-10-01',end:'2026-10-24'});
  assert.equal(recent.truncated,true);assert.equal(recent.procedures.length,600);
  assert.equal(recent.procedures[0].id,'2026-0601');
  const older=savedProcedureEvents(store(rows),{start:'2026-10-01',end:'2026-10-15'});
  assert.equal(older.procedures.length,600);
  assert.equal(older.frontiers.debates.map(e=>e.date).sort().at(-1),'2026-10-20');
});

test('unmapped dossiers and unrelated archive gaps do not qualify an already mapped topic',()=>{
  const start='2026-10-01',end='2026-10-24';
  const procedures=savedProcedureEvents(store([row(1,'2026-10-16')]),{start,end}).procedures;
  const mappings=new Map([['2026-0001',{state:'mapped',reference:'2026/0001(COD)',concepts:[{id:'topic',label:'Climate',language:'en'}]}]]);
  const evidence=sourceAvailability({sourceKey:'procedure-debates',start,end,latestObservedDate:'2026-10-16',gaps:[{start:'2026-10-05',end:'2026-10-11'}],limited:true});
  const result=topicTimeline(procedures,mappings,{start,end},{debates:evidence,votes:evidence,committee:evidence});
  const bins=result.topics[0].series;
  assert.equal(bins.find(b=>b.week==='2026-10-05').debates,0);
  assert.equal(bins.find(b=>b.week==='2026-10-12').debates,1);
  assert.equal(bins.find(b=>b.week==='2026-10-12').availability.debates,'observed');
  assert.equal(bins.find(b=>b.week==='2026-10-19').debates,0);
  const capped=topicTimeline(procedures,mappings,{start,end},{debates:evidence,votes:evidence,committee:evidence},{truncated:true}).topics[0].series;
  assert.equal(capped.find(b=>b.week==='2026-10-12').availability.debates,'partial','a real procedure cap still limits positive topic counts');
  assert.equal(capped.find(b=>b.week==='2026-10-19').debates,null,'a capped empty bin is not an observed zero');
});
