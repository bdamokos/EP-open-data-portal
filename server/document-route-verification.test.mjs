import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {scheduleGapRecovery,recordTaskGap} from './refresh-policy.mjs';
import {auditIndex} from './data-gap-audit.mjs';
import {acquisitionMode} from './availability-history.mjs';
import {amendmentDocumentRouteVerificationPending,scheduleAmendmentDocumentRouteVerification} from './document-route-recovery.mjs';

const now=Date.parse('2026-10-29T14:00:00Z'),failedAt='2026-10-29T12:29:00.000Z',target='A-10-2025-0128',id=target+'-AM-001-139';
const legacy='/plenary-documents/'+id,canonical='/documents/'+id;
const metadata=(identifier=id)=>({id:'eli/dl/doc/'+identifier,identifier,work_type:'def/ep-document-types/AMENDMENT_LIST',parliamentary_term:'org/ep-10',foresees_change_of:['eli/dl/doc/'+identifier.split('-AM-')[0]],document_date:null});
function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'route-verification-')),time={now};
  const store=new ActivityStore(directory,{clock:()=>time.now});assert(store.acquire());const {generation}=store.beginCycle();
  const worker=new ActivityWorker(store,{clock:()=>time.now,recoveryMode:'backfill',fetchRecord:async()=>assert.fail('unexpected upstream request')});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});return {directory,store,worker,generation,time};
}
function gap(store,generation,identifier=id,{body={},error,failed=failedAt}={}) {
  const key='/plenary-documents/'+identifier,payload={endpoint:key,feedDiscovery:true,...body};
  store.enqueue(generation,key,'document',payload,85);store.finishTask({generation,key,kind:'document',body:payload});
  store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,key,'document',JSON.stringify(payload),85,error||`EP API returned 404 at ${key}.`,4,failed,now+86400000,null);
  return key;
}
const gapRows=(store,generation)=>store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=? ORDER BY key').all(generation);
const snapshot=(store,generation)=>JSON.stringify({gaps:gapRows(store,generation),tasks:store.db.prepare('SELECT * FROM tasks WHERE generation=? ORDER BY key').all(generation),amendments:store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? ORDER BY key').all(generation)});

test('a future wrong-route404 gets one owned corrected-route check without retiring or rescheduling its gap',async t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);const before=gapRows(store,generation);
  store.putSource(generation,'amendment:list:'+id,'amendment-list',metadata(),'2026-10-26T00:00:00Z');const list=store.source(generation,'amendment:list:'+id);
  assert.equal(scheduleGapRecovery(worker,generation),0,'control: ordinary retry waits until tomorrow');
  assert.equal(scheduleAmendmentDocumentRouteVerification(worker,generation),1);
  assert.deepEqual(gapRows(store,generation),before);assert.equal(store.source(generation,canonical),undefined);assert.equal(worker.requests,0);
  const task=store.nextTask(generation);assert.equal(task.key,legacy);assert.equal(task.retry_at,0);assert.equal(task.attempts,0);
  assert.equal(acquisitionMode(store,task),'recovery');
  assert.deepEqual(task.body.amendmentRouteVerification.previousFailure,{endpoint:legacy,status:404,failedAt,retryAt:now+86400000,attempts:4});
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gap_admissions WHERE generation=?').get(generation).n,1);
  assert.equal(scheduleAmendmentDocumentRouteVerification(new ActivityWorker(store,{clock:()=>now,recoveryMode:'backfill'}),generation),0);
  worker.fetchRecord=async route=>{assert.equal(route,canonical);return {fetchedAt:new Date(now).toISOString(),payload:{data:[metadata()]}};};
  await worker.task(task);
  assert.equal(worker.requests,1);assert.equal(gapRows(store,generation).length,0);assert.equal(store.source(generation,canonical).work.identifier,id);
  assert.equal(store.source(generation,canonical).fetchedAt,new Date(now).toISOString());assert.deepEqual(store.source(generation,'amendment:list:'+id),list);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items').get().n,0);
});

for(const owner of ['canonical-gap','canonical-task','amendment-task','legacy-task','deferred','admission'])test('one-time verification preserves '+owner+' ownership and future clocks',t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);const future=now+3600000;
  if(owner==='canonical-gap')store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,canonical,'document',JSON.stringify({endpoint:canonical}),85,'EP API returned 500 at '+canonical+'.',4,failedAt,future,null);
  if(owner==='canonical-task'||owner==='legacy-task') {
    const key=owner==='canonical-task'?canonical:legacy;store.enqueue(generation,key,'document',{endpoint:key,offset:150},100,true);
    // The legacy gap refuses ordinary enqueue, so model its already-admitted owner.
    if(key===legacy)store.db.prepare('UPDATE tasks SET done=0,body=? WHERE generation=? AND key=?').run(JSON.stringify({endpoint:key,offset:150}),generation,key);
    store.db.prepare('UPDATE tasks SET attempts=3,retry_at=?,error=? WHERE generation=? AND key=?').run(future,'saved failure',generation,key);
  }
  if(owner==='amendment-task')store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(generation,'amendment:discover:'+target+':'+id,'amendment-list-detail',JSON.stringify({listId:id,targetDocumentId:target,offset:150}),115,0,3,future,'saved failure');
  if(owner==='deferred')store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[{key:canonical,kind:'document',body:JSON.stringify({endpoint:canonical,offset:150}),done:0,attempts:3,retry_at:future}],discovery:[],completed:[]},failedAt);
  if(owner==='admission')store.db.prepare('INSERT INTO refresh_gap_admissions VALUES (?,?)').run(generation,legacy);
  const before=snapshot(store,generation),deferred=store.source(generation,'amendment:continuations');
  assert.equal(scheduleAmendmentDocumentRouteVerification(worker,generation),0);
  assert.equal(snapshot(store,generation),before);assert.deepEqual(store.source(generation,'amendment:continuations'),deferred);
});

test('execution rechecks a canonical retry owner that appears after probe admission',async t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);scheduleAmendmentDocumentRouteVerification(worker,generation);
  store.enqueue(generation,canonical,'document',{endpoint:canonical,offset:250},110);
  store.db.prepare('UPDATE tasks SET attempts=3,retry_at=?,error=? WHERE generation=? AND key=?').run(now+3600000,'saved canonical failure',generation,canonical);
  const owner=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,canonical),gaps=gapRows(store,generation);
  await worker.task(store.nextTask(generation));
  assert.equal(worker.requests,0);assert.deepEqual(gapRows(store,generation),gaps);
  assert.deepEqual(store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,canonical),owner);
  const probe=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,legacy);assert.equal(probe.retry_at,owner.retry_at);assert.equal(probe.attempts,0);
});

for(const mode of ['stale','old-date','future-date','wrong-id','wrong-type'])test('probe leaves the gap and source untouched after '+mode+' metadata',async t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);scheduleAmendmentDocumentRouteVerification(worker,generation);const before=gapRows(store,generation);
  const work=mode==='wrong-id'?metadata(target+'-AM-002-002'):metadata();if(mode==='wrong-type')work.work_type='def/ep-document-types/REPORT_PLENARY';
  worker.fetchRecord=async()=>({payload:{data:[work]},stale:mode==='stale',fetchedAt:mode==='old-date'?failedAt:mode==='future-date'?new Date(now+1).toISOString():new Date(now).toISOString()});
  await assert.rejects(worker.task(store.nextTask(generation)),/fresh exact|Invalid or conflicting/);
  assert.deepEqual(gapRows(store,generation),before);assert.equal(store.source(generation,canonical),undefined);
});

test('a failed correct-route request keeps its own Retry-After and is never readmitted by the one-time scan',async t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);scheduleAmendmentDocumentRouteVerification(worker,generation);const before=gapRows(store,generation),task=store.nextTask(generation);
  worker.fetchRecord=async()=>{throw Object.assign(new Error('EP API returned 429 at '+canonical+'.'),{retryAfter:7200,status:429});};
  await assert.rejects(worker.task(task),error=>{assert.equal(recordTaskGap(worker,task,error),false);store.failTask(task,error);return true;});
  const after=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,legacy);
  assert.equal(after.retry_at,now+7200000);assert.equal(after.attempts,1);assert.deepEqual(gapRows(store,generation),before);
  assert.equal(scheduleAmendmentDocumentRouteVerification(worker,generation),0);assert.deepEqual(store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,legacy),after);
});

test('a correct-route404 replaces the wrong-route observation with its own backoff and keeps the original history',async t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);scheduleAmendmentDocumentRouteVerification(worker,generation);const task=store.nextTask(generation);
  worker.fetchRecord=async()=>{throw Object.assign(new Error('EP API returned 404 at '+canonical+'.'),{status:404,retryAfter:3600});};
  await assert.rejects(worker.task(task),error=>{assert.equal(recordTaskGap(worker,task,error),true);return true;});
  const row=gapRows(store,generation)[0];assert.equal(row.error,'EP API returned 404 at '+canonical+'.');assert.equal(row.attempts,1);assert(row.retry_at>=now+3600000);
  assert.equal(JSON.parse(row.body).amendmentRouteVerification.previousFailure.attempts,4);
  assert.equal(scheduleAmendmentDocumentRouteVerification(worker,generation),0);assert.equal(store.source(generation,canonical),undefined);
});

test('25-key admission batches resume after restart without resetting pending retries',t=>{
  const {store,worker,generation}=setup(t);
  for(let n=1;n<=26;n++)gap(store,generation,target+'-AM-'+String(n).padStart(3,'0')+'-'+String(n).padStart(3,'0'));
  const before=gapRows(store,generation);assert.equal(scheduleAmendmentDocumentRouteVerification(worker,generation),25);
  const task=store.nextTask(generation);store.db.prepare('UPDATE tasks SET attempts=2,retry_at=?,error=? WHERE generation=? AND key=?').run(now+7200000,'saved retry',generation,task.key);
  const saved=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,task.key);
  const restarted=new ActivityWorker(store,{clock:()=>now,recoveryMode:'backfill'});
  assert.equal(scheduleAmendmentDocumentRouteVerification(restarted,generation),1);assert.equal(amendmentDocumentRouteVerificationPending(store,generation),false);
  assert.deepEqual(store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,task.key),saved);assert.deepEqual(gapRows(store,generation),before);
  const total=store.db.prepare('SELECT total_changes() n').get().n,audit=auditIndex(store.db,now);
  assert.equal(audit.amendmentDocumentRouteVerification.admitted,26);assert.equal(store.db.prepare('SELECT total_changes() n').get().n,total);
});

test('admission and its persisted cursor roll back together on failure',t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);const before=snapshot(store,generation);
  store.db.exec("CREATE TRIGGER reject_verification BEFORE INSERT ON refresh_gap_admissions BEGIN SELECT RAISE(ABORT,'injected admission failure');END");
  assert.throws(()=>scheduleAmendmentDocumentRouteVerification(worker,generation),/injected/);
  assert.equal(snapshot(store,generation),before);assert.equal(store.get('amendmentDocumentRouteVerification'),null);
});

for(const mode of ['backfill','normal'])test(mode+' actual worker handles a future wrong-route gap through ordinary generation publication',async t=>{
  const {store,worker,generation:serving}=setup(t);gap(store,serving);store.setMembers([{id:'101',name:'Member'}]);store.publish(serving);
  const frozen=gapRows(store,serving);worker.recoveryMode=mode;
  assert.equal(worker.coreDue(),false,'today is already published');
  const realTask=worker.task.bind(worker),routes=[];
  worker.fetchRecord=async route=>{routes.push(route);assert.equal(route,canonical);return {fetchedAt:new Date(now).toISOString(),payload:{data:[metadata()]}};};
  worker.task=async task=>task.key===legacy?realTask(task):store.finishTask(task);
  store.release();await worker.runIteration();
  assert.deepEqual(gapRows(store,serving),frozen);
  assert.equal(store.source(serving,canonical),undefined);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items').get().n,0);
  if(mode==='normal'){assert.deepEqual(routes,[]);assert.equal(store.get('active'),serving);return;}
  assert.deepEqual(routes,[canonical]);assert.equal(worker.requests,1);assert.equal(store.get('active'),serving+1);assert.equal(store.get('working'),null);
  assert.equal(gapRows(store,serving+1).length,0);assert.equal(store.source(serving+1,canonical).work.identifier,id);
});

for(const bound of ['disk','deadline'])test('actual worker admits no route probes after its '+bound+' bound',async t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);const before=gapRows(store,generation);
  worker.task=async task=>store.finishTask(task);
  if(bound==='disk')worker.diskLimit=1;
  else {let ticks=0;worker.monotonic=()=>1000*ticks++;worker.maxDuration=1;}
  store.release();await worker.runIteration();
  assert.equal(store.get('amendmentDocumentRouteVerification'),null);assert.deepEqual(gapRows(store,generation),before);assert.equal(worker.requests,0);
});

for(const mode of ['normal','serving','lease','wrong-error','progressed','oversized','future-failure'])test('one-time verification rejects '+mode+' state',t=>{
  const {store,worker,generation}=setup(t);
  gap(store,generation,id,{error:mode==='wrong-error'?'EP API returned 500 at '+legacy+'.':undefined,failed:mode==='future-failure'?new Date(now+1).toISOString():failedAt,body:mode==='progressed'?{offset:150}:mode==='oversized'?{padding:'x'.repeat(16384)}:{}});
  if(mode==='normal')worker.recoveryMode='normal';if(mode==='serving')store.publish(generation);
  const before=snapshot(store,generation);
  if(mode==='lease'){store.release();assert.throws(()=>scheduleAmendmentDocumentRouteVerification(worker,generation),/lease/i);}
  else assert.equal(scheduleAmendmentDocumentRouteVerification(worker,generation),0);
  assert.equal(snapshot(store,generation),before);
});
