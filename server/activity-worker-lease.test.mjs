import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';

function fixture(t) {
  let now=Date.parse('2026-10-29T14:55:10Z');
  const directory=mkdtempSync(path.join(os.tmpdir(),'activity-lease-'));
  const store=new ActivityStore(directory,{clock:()=>now});assert(store.acquire());
  const serving=store.beginCycle().generation;store.setMembers([{id:'101',name:'Member'}]);store.publish(serving);
  const generation=store.beginCycle().generation;
  store.updateCycle({initialized:true,membershipScheduled:true,groupHistoryScheduled:true,historyReadinessVersion:1,mutableScheduled:true,motionOutcomesDay:'2026-10-29',reportJoinsReady:true,procedureTitlesQueued:true,procedureTypesQueued:true});
  const key='/plenary-documents/B-10-2026-0001';
  store.enqueue(generation,key,'document',{endpoint:key,offset:250},1000);
  const worker=new ActivityWorker(store,{clock:()=>now,budget:1,fetchRecord:async()=>assert.fail('unexpected source request')});
  t.mock.timers.enable({apis:['setInterval']});
  t.after(()=>{worker.stop();store.close();rmSync(directory,{recursive:true,force:true});});
  store.release();
  return {directory,store,worker,key,serving,generation,advance:ms=>{now+=ms;}};
}

for(const loss of ['expiry','takeover'])test('heartbeat '+loss+' fences the iteration but a later ordinary tick resumes the same cursor',async t=>{
  const {directory,store,worker,key,generation,serving,advance}=fixture(t);
  const other=new ActivityStore(directory,{clock:store.clock});t.after(()=>other.close());
  const before=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key);
  const marks=store.db.prepare('SELECT * FROM follow_generations').all();let calls=0;
  worker.task=async task=>{
    calls++;
    if(calls===1) {
      advance(91_000);
      if(loss==='takeover')assert(other.acquire());
      t.mock.timers.tick(20_000);
      assert(worker.controller.signal.aborted);
      throw worker.controller.signal.reason;
    }
    assert.equal(task.key,key);assert.equal(task.body.offset,250);
    worker.requests++;store.taskProgress(task,{...task.body,offset:500});
  };
  await assert.rejects(worker.run(),/lease/);
  assert.equal(worker.stopped,false,'lease loss must not become permanent service shutdown');
  assert.equal(worker.running,false);assert.equal(store.get('active'),serving);
  assert.equal(store.get('working').generation,generation);
  assert.deepEqual(store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key),before);
  assert.deepEqual(store.db.prepare('SELECT * FROM follow_generations').all(),marks);
  if(loss==='takeover') {
    const owner=other.db.prepare('SELECT * FROM lease').get();
    await worker.run();assert.equal(calls,1,'a live competing owner must still block reacquisition');
    assert.deepEqual(other.db.prepare('SELECT * FROM lease').get(),owner);
    other.release();
  }
  const oldController=worker.controller;
  await worker.run();
  assert.equal(calls,2);assert.notEqual(worker.controller,oldController);assert.equal(worker.controller.signal.aborted,false);
  assert.equal(store.get('active'),serving);assert.equal(store.get('working').generation,generation);
  const after=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key);
  assert.equal(JSON.parse(after.body).offset,500);assert.equal(after.attempts,before.attempts);assert.equal(after.retry_at,before.retry_at);
  assert.deepEqual(store.db.prepare('SELECT * FROM follow_generations').all(),marks);
});

test('explicit shutdown remains permanent and cannot be revived by an ordinary tick',async t=>{
  const {store,worker,generation,key}=fixture(t);
  const before=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key);
  worker.task=async()=>assert.fail('shutdown worker must not dispatch');
  worker.stop();await worker.run();await worker.runIteration();
  assert.equal(worker.stopped,true);assert.equal(store.db.prepare('SELECT * FROM lease').get(),undefined);
  assert.deepEqual(store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key),before);
});

test('continuous bodies leave seven of eight one-request turns for core work',async t=>{
 const {store,worker}=fixture(t);let bodies=0,core=0,projections=0;
 worker.documentBodies={due:()=>true,step:async(w,options)=>{assert.equal(options.requestBudget,1);bodies++;w.requests++;}};
 worker.fillProjectionBatch=async()=>{projections++;};
 worker.task=async()=>{core++;worker.requests++;};
 for(let n=0;n<16;n++)await worker.run();
 assert.equal(bodies,2);assert.equal(core,14);assert(projections>=16);
});
