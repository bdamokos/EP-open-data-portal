import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {projectGroupHistory,groupHistorySnapshot} from './group-history.mjs';
import {groupHistoryRepairDue,scheduleGroupHistoryRepair} from './group-history-repair.mjs';
import {createGroupOn} from './group-attribution.mjs';
import {namedVote} from './insights-legislation-model.mjs';

const at='2026-10-27T12:00:00.000Z',old='2026-10-27T00:02:13.889Z',clock=()=>Date.parse(at);
// Reduced public membership identities; no production cache is used.
const id='197662',org='org/7018',mapping={[org]:{org,groupId:'org/PPE',code:'PPE'}};
const person={identifier:id,hasMembership:[
  {identifier:id+'-m-16848',organization:'org/ep-10',role:'def/ep-roles/MEMBER_PARLIAMENT',memberDuring:{startDate:'2024-07-16'}},
  {identifier:id+'-f-172361',organization:org,membershipClassification:'def/ep-entities/EU_POLITICAL_GROUP',memberDuring:{startDate:'2024-07-16'}},
]};
const incomplete={...person,hasMembership:person.hasMembership.slice(0,1)};
function fixture(t) {
  const directory=mkdtempSync(path.join(tmpdir(),'group-history-repair-'));
  const store=new ActivityStore(directory,{clock});assert(store.acquire());
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const serving=store.beginCycle().generation;
  store.setMembers([{id,name:'Vangelis MEIMARAKIS',groupCode:'PPE'}]);
  store.putSource(serving,'group-body:7018','group-body',mapping[org],old);
  store.putSource(serving,'group-history:'+id,'group-history',{...projectGroupHistory(incomplete,mapping),generation:serving,retrievedAt:old},old);
  store.publish(serving);
  return {store,directory,serving};
}
const repairTask=store=>{
  const row=store.db.prepare("SELECT * FROM tasks WHERE generation=? AND kind='group-history-repair'").get(store.get('working').generation);
  return {...row,body:JSON.parse(row.body)};
};

test('startup admits the repair once and fresh history moves the vote into EPP on publication',async t=>{
  const {store,serving}=fixture(t),before=groupHistorySnapshot(store,serving),calls=[];
  const worker=new ActivityWorker(store,{clock,fetchRecord:async endpoint=>{calls.push(endpoint);return {payload:{data:[person]},fetchedAt:at};}});
  assert.equal(worker.coreDue(),false);worker.repairOnStartup=true;assert.equal(worker.coreDue(),true);
  const generation=store.beginCycle().generation;
  store.updateCycle({groupHistoryRefetches:150});
  scheduleGroupHistoryRepair(store,generation);scheduleGroupHistoryRepair(store,generation);
  assert.equal(store.taskCounts(generation).total,1);assert.equal(groupHistoryRepairDue(store),false);
  worker.readCachedMepRecord=async()=>assert.fail('repair must bypass the incomplete raw cache');
  await worker.task(repairTask(store));
  assert.deepEqual(calls,['/meps/'+id]);assert.equal(store.get('working').groupHistoryRefetches,150);
  assert.equal(store.get('working').groupHistoryRepairRequests,1);
  assert.deepEqual(groupHistorySnapshot(store,serving),before);
  const fresh=store.source(generation,'group-history:'+id);
  assert.equal(fresh.work.groups[0].code,'PPE');assert.equal(fresh.work.groups[0].membershipIds[0],id+'-f-172361');
  // Later ordinary discovery must not restore the older incomplete cache.
  worker.readCachedMepRecord=async()=>({payload:{data:[incomplete]},fetchedAt:old});
  store.enqueue(generation,'ordinary','group-history-person',{id});await worker.task(store.nextTask(generation));
  assert.deepEqual(store.source(generation,'group-history:'+id),fresh);
  store.publish(generation);
  const snapshot=groupHistorySnapshot(store,generation);
  assert.equal(createGroupOn(snapshot)(id,'2026-10-20').code,'PPE');
  const raw={activity_id:'MTG-PL-2026-10-20-DEC-198425',activity_date:'2026-10-20',had_voter_favor:['person/'+id],had_voter_against:[],had_voter_abstention:[],number_of_votes_favor:1,number_of_votes_against:0,number_of_votes_abstention:0};
  const members=new Map([[id,{id,name:'Vangelis MEIMARAKIS'}]]),record={url:'https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-10-20/decisions',fetchedAt:at};
  const vote=namedVote(raw,record,members,new Map(),'2026-10-20',createGroupOn(snapshot));
  assert.deepEqual(vote.politicalGroups.map(row=>row.code),['PPE']);assert.equal(vote.politicalGroups[0].positions.for[0].id,id);
  assert.equal(vote.aggregateTotals.for,1);assert.equal(vote.totalsMatchNamed,true);
  assert.equal(worker.coreDue(),false);
  assert.deepEqual(groupHistorySnapshot(store,serving),before);
});

test('failed acquisition stays durable across reopening and keeps the previous observation',async t=>{
  const {store,directory,serving}=fixture(t),generation=store.beginCycle().generation;
  scheduleGroupHistoryRepair(store,generation);
  const before=store.source(generation,'group-history:'+id);
  const worker=new ActivityWorker(store,{clock,fetchRecord:async()=>{throw Error('offline');}}),task=repairTask(store);
  await assert.rejects(worker.task(task),/offline/);store.failTask(task,Error('offline'));
  assert.equal(repairTask(store).done,0);assert.equal(repairTask(store).attempts,1);
  assert.deepEqual(store.source(generation,'group-history:'+id),before);
  store.release();
  const restarted=new ActivityStore(directory,{clock});assert(restarted.acquire());
  try {
    scheduleGroupHistoryRepair(restarted,generation);assert.equal(restarted.taskCounts(generation).total,1);
    const recovery=new ActivityWorker(restarted,{clock,fetchRecord:async()=>({payload:{data:[person]},fetchedAt:at})});
    await recovery.task(repairTask(restarted));restarted.publish(generation);
    assert.equal(groupHistorySnapshot(restarted,generation).members[id].coverage,'complete');
    assert.equal(groupHistorySnapshot(restarted,serving).members[id].groups.length,0);
  }finally{restarted.close();}
});

test('admission is lease-fenced, atomic, and excludes complete histories and other partial shapes',t=>{
  const {store}=fixture(t),generation=store.beginCycle().generation;
  for(const [other,history] of [['42',projectGroupHistory(person,mapping)],['43',{coverage:'partial',mandates:[],groups:[]}],['44',{coverage:'partial',mandates:[{}],groups:[{}]}],['45',{coverage:'unavailable',mandates:[{}],groups:[]}]])store.putSource(generation,'group-history:'+other,'group-history',history,old);
  store.release();assert.throws(()=>scheduleGroupHistoryRepair(store,generation),/lease/);assert(store.acquire());
  store.db.exec("CREATE TRIGGER reject_repair BEFORE INSERT ON tasks WHEN NEW.kind='group-history-repair' BEGIN SELECT RAISE(ABORT,'rejected'); END");
  assert.throws(()=>scheduleGroupHistoryRepair(store,generation),/rejected/);assert.equal(groupHistoryRepairDue(store),true);
  store.db.exec('DROP TRIGGER reject_repair');scheduleGroupHistoryRepair(store,generation);
  assert.equal(store.taskCounts(generation).total,1);assert.equal(repairTask(store).body.id,id);
});
