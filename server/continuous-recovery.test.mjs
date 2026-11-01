import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {scheduleMutable,scheduleGapRecovery,nextRefreshTask,nextBackfillTask,recordTaskGap,GAP_LIMIT,MUTABLE_LIMIT,DAY} from './refresh-policy.mjs';
import {enqueueGroupVoice,nextGroupVoiceTask} from './group-voices-store.mjs';

function fixture(t){
  const directory=mkdtempSync(path.join(os.tmpdir(),'continuous-recovery-'));
  let now=Date.parse('2026-11-01T10:00Z');
  const store=new ActivityStore(directory,{clock:()=>now});assert(store.acquire());
  const {generation}=store.beginCycle(),worker=new ActivityWorker(store,{clock:()=>now});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const advance=ms=>{store.release();now+=ms;assert(store.acquire());};
  const gap=(key,priority=84)=>store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,key,'document',JSON.stringify({endpoint:key}),priority,'Missing',5,new Date(now).toISOString(),now-1,null);
  return {store,generation,worker,gap,advance,clock:()=>now};
}

test('1000 due gaps drain within a fake shared request budget, with bounded queues and normal work progressing',t=>{
  const {store,generation,worker,gap,advance,clock}=fixture(t),start=clock();
  store.transaction(()=>{for(let i=0;i<1000;i++)gap('gap:'+i,200);for(let i=0;i<200;i++)store.enqueue(generation,'daily:'+i,'document',{},105);});
  store.set('slowGapAdmissions',{day:'2026-11-01',count:25});
  // Fake rolling admission: 450 background starts per 5 minutes, reserving 50.
  let used=0,recovered=0,daily=0,dispatches=0;
  while(recovered<1000){
    if(used===450){advance(300_000);used=0;}
    scheduleGapRecovery(worker,generation);
    assert(store.db.prepare('SELECT COUNT(*) n FROM refresh_gap_admissions WHERE generation=?').get(generation).n<=GAP_LIMIT);
    const task=nextRefreshTask(store,generation,store.nextTask(generation));assert(task);
    if(task.key.startsWith('daily:'))daily++;else recovered++;
    store.finishTask(task);used++;dispatches++;
    assert(dispatches<=1200);
    if(dispatches===100)assert(daily>0&&recovered>0);
  }
  assert.equal(daily,200);assert(clock()-start<DAY);assert.equal(store.get('slowGapAdmissions'),null);
});

for(const dispatch of [nextRefreshTask,nextBackfillTask])test(dispatch.name+' alternates mutable and gap lanes under constant core load and retains backoff',t=>{
  const {store,generation,worker,gap,advance,clock}=fixture(t);
  store.enqueue(generation,'daily','document',{},300);
  for(let i=0;i<105;i++)store.db.prepare('INSERT INTO mutable_documents VALUES (?,?,?)').run(generation,'mutable:'+i,clock()-1);
  gap('gap',250);scheduleMutable(worker,generation);
  store.enqueue(generation,'/adopted-texts/TA-10-2026-0001','document',{},101);
  const count=()=>store.db.prepare('SELECT COUNT(*) n FROM mutable_refresh_admissions WHERE generation=?').get(generation).n;
  assert.equal(count(),MUTABLE_LIMIT);assert.equal(scheduleMutable(worker,generation),0);
  const seen=[];
  for(let i=0;i<30;i++){
    const task=dispatch(store,generation,store.nextTask(generation));seen.push(task.key);
    if(task.key==='daily')continue;
    if(task.key==='gap')assert(recordTaskGap(worker,task,Object.assign(new Error('Missing'),{status:404})));
    else store.finishTask(task);
    scheduleMutable(worker,generation);assert(count()<=MUTABLE_LIMIT);
  }
  assert(seen.includes('daily')&&seen.includes('gap')&&seen.some(key=>key.startsWith('mutable:')));
  if(dispatch===nextBackfillTask)assert(seen.includes('/adopted-texts/TA-10-2026-0001'),'adoption retains its backfill share');
  const retry=store.db.prepare("SELECT retry_at FROM refresh_gaps WHERE key='gap'").get().retry_at;
  assert(retry>clock());assert.equal(scheduleGapRecovery(worker,generation),0);
  advance(retry-clock()-1);assert.equal(scheduleGapRecovery(worker,generation),0);
  advance(1);assert.equal(scheduleGapRecovery(worker,generation),1);
});

test('due group voices get a persisted turn under constant core load and idle probes use deadline indexes',t=>{
  const {store,generation,clock}=fixture(t);
  const core={key:'constant-core'};enqueueGroupVoice(store,generation,'voice',{});
  for(let i=0;i<8;i++)assert.equal(nextGroupVoiceTask(store,generation,core),core);
  const reopened=new ActivityStore(path.dirname(store.filename),{clock});t.after(()=>reopened.close());
  store.release();assert(reopened.acquire());
  assert.equal(nextGroupVoiceTask(reopened,generation,core).key,'voice');
  const plan=sql=>reopened.db.prepare('EXPLAIN QUERY PLAN '+sql).all(generation,clock()).map(row=>row.detail).join(' ');
  assert.match(plan('SELECT 1 FROM group_voice_jobs WHERE generation=? AND done=0 AND retry_at<=? LIMIT 1'),/group_voice_job_due.*retry_at/);
  assert.match(plan('SELECT 1 FROM refresh_gaps WHERE generation=? AND retry_at<=? LIMIT 1'),/refresh_gap_due.*retry_at/);
  assert.match(plan('SELECT 1 FROM mutable_documents WHERE generation=? AND next_check<=? LIMIT 1'),/mutable_document_due.*next_check/);
});

test('preparation adopts legacy queued mutable jobs and retires daily counters without resetting retries',t=>{
  const {store,generation,clock}=fixture(t);
  store.enqueue(generation,'legacy','document',{endpoint:'legacy',offset:250},84);
  store.db.prepare('INSERT INTO mutable_documents VALUES (?,?,?)').run(generation,'legacy',clock()+7*DAY);
  store.db.prepare("UPDATE tasks SET retry_at=?,attempts=3 WHERE key='legacy'").run(clock()+60_000);
  const before=store.db.prepare("SELECT * FROM tasks WHERE key='legacy'").get();
  store.set('slowGapAdmissions',{day:'2026-11-01',count:25});store.set('recoveryScheduleVersion',null);
  store.db.exec('DROP TABLE mutable_refresh_admissions');store.release();
  assert.throws(()=>new ActivityStore(path.dirname(store.filename),{clock}),/preparation/);
  const prepared=new ActivityStore(path.dirname(store.filename),{clock,initializeIndexes:true});t.after(()=>prepared.close());
  assert(prepared.acquire());assert.equal(prepared.get('slowGapAdmissions'),null);
  assert(prepared.db.prepare('SELECT 1 FROM mutable_refresh_admissions WHERE generation=? AND key=?').get(generation,'legacy'));
  assert.deepEqual(prepared.db.prepare("SELECT * FROM tasks WHERE key='legacy'").get(),before);
});


test('direct correction-period admissions share the global gap in-flight cap',t=>{
  const {store,generation,gap}=fixture(t);
  for(let i=0;i<GAP_LIMIT+1;i++){
    const key='correction:'+i;gap(key);
    assert.equal(store.enqueue(generation,key,'document',{},100,true,{retryGap:true}),i<GAP_LIMIT);
  }
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gap_admissions').get().n,GAP_LIMIT);
});
