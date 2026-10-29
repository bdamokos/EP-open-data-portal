import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {nextBackfillTask} from './refresh-policy.mjs';

const now=Date.parse('2026-10-29T00:30:00Z'),stamp=new Date(now).toISOString();
const adopted='/adopted-texts/TA-10-2026-0001',recovery='/parliamentary-questions/E-10-2026-000001';
function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'backfill-scheduling-'));
  const store=new ActivityStore(directory,{clock:()=>now});store.acquire();const {generation}=store.beginCycle();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,generation,directory};
}
function gap(store,generation,key=recovery) {
  store.enqueue(generation,key,'document',{endpoint:key,offset:750},84);
  store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,key,'document',JSON.stringify({endpoint:key,offset:750}),84,'EP API returned 500',5,stamp,now-1,null);
  store.db.prepare('INSERT INTO refresh_gap_admissions VALUES (?,?)').run(generation,key);
}
function busy(store,generation) {
  store.enqueue(generation,'busy','document',{endpoint:'/busy'},120);
  return store.nextTask(generation);
}

test('backfill alternates due recovery and adoption behind a continuously ready higher-priority task',t=>{
  const {store,generation}=setup(t),ordinary=busy(store,generation);
  gap(store,generation);store.enqueue(generation,adopted,'document',{endpoint:adopted},101);
  const selected=Array.from({length:27},()=>nextBackfillTask(store,generation,ordinary));
  assert.deepEqual(selected.filter(task=>task.key!=='busy').map(task=>task.key),[recovery,adopted,recovery]);
  assert(selected.filter(task=>task.key==='busy').every(task=>task.priority===120));
  assert.equal(selected[8].body.offset,750);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps').get().n,1,'dispatch does not clear coverage');
});

test('a saved turn survives a new store, keeps future retries unchanged and does not create another owner',t=>{
  const {store,generation,directory}=setup(t),ordinary=busy(store,generation);
  gap(store,generation);store.enqueue(generation,adopted,'document',{endpoint:adopted,offset:250},101);
  store.db.prepare('UPDATE tasks SET attempts=3,retry_at=?,error=? WHERE key=?').run(now+60_000,'EP API returned 429',adopted);
  const before=store.db.prepare('SELECT * FROM tasks WHERE key=?').get(adopted);
  for(let i=0;i<8;i++)assert.equal(nextBackfillTask(store,generation,ordinary).key,'busy');
  store.release();
  const reopened=new ActivityStore(directory,{clock:()=>now});
  try {
    assert(reopened.acquire());
    assert.equal(nextBackfillTask(reopened,generation,reopened.nextTask(generation)).key,recovery);
    assert.deepEqual(reopened.db.prepare('SELECT * FROM tasks WHERE key=?').get(adopted),before);
    assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM amendment_jobs').get().n,0);
  } finally {reopened.close();}
});

test('catalogues and feeds share adoption service; empty lanes leave ordinary work available',t=>{
  const {store,generation}=setup(t),ordinary=busy(store,generation);
  store.enqueue(generation,'catalog:adopted','catalog',{endpoint:'/adopted-texts',offset:500},100);
  for(let i=0;i<8;i++)nextBackfillTask(store,generation,ordinary);
  const catalog=nextBackfillTask(store,generation,ordinary);assert.equal(catalog.key,'catalog:adopted');assert.equal(catalog.body.offset,500);store.finishTask(catalog);
  store.enqueue(generation,'feed:adopted','feed',{endpoint:'/adopted-texts',start:'2026-10-27'},105);
  for(let i=0;i<8;i++)nextBackfillTask(store,generation,ordinary);
  const feed=nextBackfillTask(store,generation,ordinary);assert.equal(feed.key,'feed:adopted');store.finishTask(feed);
  for(let i=0;i<20;i++)assert.equal(nextBackfillTask(store,generation,ordinary).key,'busy');
  assert.equal(nextBackfillTask(store,generation,undefined),undefined);
});

for(const mode of ['backfill','normal'])test(mode+' worker preserves its budget and frozen serving generation while exercising the real adoption and recovery paths',async t=>{
  const {store,generation}=setup(t);
  store.setMembers([{id:'101',name:'Member'}]);store.publish(generation);
  const cycle=store.beginCycle();
  for(let i=0;i<100;i++)store.enqueue(cycle.generation,'/busy/'+String(i).padStart(3,'0'),'document',{endpoint:'/busy/'+i},120);
  store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(cycle.generation,recovery,'document',JSON.stringify({endpoint:recovery}),84,'EP API returned 500',5,stamp,now-1,null);
  const calls=[],dispatches=[];
  const worker=new ActivityWorker(store,{clock:()=>now,recoveryMode:mode,budget:40,fetchRecord:async(endpoint,params)=>{
    calls.push(endpoint);
    if(endpoint==='/adopted-texts/feed')return {fetchedAt:stamp,xml:'<feed/>'};
    if(endpoint==='/adopted-texts')return {fetchedAt:stamp,payload:{data:params.offset?[]:[{identifier:adopted.split('/').at(-1)}]}};
    const id=endpoint.split('/').at(-1);
    return {fetchedAt:stamp,payload:{data:[{id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/'+(endpoint===adopted?'TEXT_ADOPTED':'QUESTION_WRITTEN'),parliamentary_term:'org/ep-10',document_date:endpoint===adopted?null:'2026-10-28',adopts:[]}]}};
  }});
  const realTask=worker.task.bind(worker);
  worker.task=async task=>{
    dispatches.push(task.key);
    if(task.key===adopted||task.key===recovery||['catalog','feed'].includes(task.kind)&&task.body.endpoint==='/adopted-texts')return realTask(task);
    if(task.key.startsWith('/busy/'))worker.requests++;
    store.finishTask(task);
  };
  store.release();await worker.runIteration();
  assert.equal(worker.requests,40);
  assert.equal(store.get('active'),generation);assert.equal(store.get('working').generation,cycle.generation);
  assert.equal(store.source(generation,adopted),undefined,'serving data stays frozen');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM tasks WHERE generation=? AND key LIKE ? AND done=0').get(cycle.generation,'/busy/%').n>0,true);
  if(mode==='backfill') {
    assert(calls.includes('/adopted-texts'),JSON.stringify({calls,dispatches,schedule:store.get('backfillSchedule')}));assert(calls.includes(recovery));assert(calls.includes(adopted));
    assert.equal(store.source(cycle.generation,adopted).work.adoptionProjectionVersion,1);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps WHERE generation=? AND key=?').get(cycle.generation,recovery).n,0);
    assert(!dispatches.includes('/busy/000'),'coverage runs before the higher-priority backlog drains');
    worker.budget=1000;await worker.runIteration();
    assert.equal(store.get('active'),cycle.generation);assert.equal(store.get('working'),null);
    assert.equal(store.source(cycle.generation,adopted).work.identifier,adopted.split('/').at(-1));
  } else {
    assert.deepEqual(calls,[]);assert.equal(store.get('backfillSchedule'),null,'normal scheduling remains unchanged');
  }
});
