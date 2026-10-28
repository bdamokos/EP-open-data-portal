import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {Worker} from 'node:worker_threads';
import {setTimeout as delay} from 'node:timers/promises';
import {ActivityStore} from './activity-index-store.mjs';
import {activityGenerationTask} from './activity-generation-task.mjs';
import {loopback} from './test-support/loopback.mjs';
import {execFileAsync,registerSubprocesses} from './test-support/subprocess.mjs';

const pending=new WeakMap();
beforeEach(t=>{
  registerSubprocesses(t);const tasks=[];pending.set(t,tasks);
  t.after(async()=>{for(const task of tasks)task.controller.abort();await Promise.allSettled(tasks.map(task=>task.promise));});
});
function fixture(t,options={}) {
  const directory=mkdtempSync(path.join(tmpdir(),'activity-generation-')),store=new ActivityStore(directory,options);
  assert(store.acquire());
  for(let i=0;i<2;i++){const cycle=store.beginCycle();store.setMembers([{id:'101',name:'Member'}]);store.publish(cycle.generation);}
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return {directory,store};
}
function run(t,store,operation,options={}) {
  const controller=new AbortController(),promise=activityGenerationTask(store,operation,{...options,signal:controller.signal});
  pending.get(t).push({controller,promise});return {controller,promise};
}

test('long locked generation preparation renews only its qualified owner, without increasing the lease duration',t=>{
  let now=Date.now();const {directory,store}=fixture(t,{clock:()=>now}),other=new ActivityStore(directory,{clock:()=>now});
  other.db.exec('PRAGMA busy_timeout=0');t.after(()=>other.close());
  const prune=store.pruneGenerations.bind(store);
  store.pruneGenerations=(...args)=>{
    now+=120_000;
    assert.throws(()=>other.acquire(),/locked|busy/i,'expired wall time cannot transfer an unbroken SQLite write lock');
    prune(...args);
  };
  const cycle=store.beginCycle();assert.equal(cycle.generation,3);
  assert.equal(store.db.prepare('SELECT expires FROM lease').get().expires,now+90_000);
  assert.equal(other.acquire(),false);store.assertWriter();
  store.publish(cycle.generation);assert.equal(store.get('active'),3);
  assert.equal(store.db.prepare('SELECT expires FROM lease').get().expires,now+90_000);
  now+=91_000;assert(other.acquire());assert.throws(()=>store.beginCycle(),/lease/);
});

test('owner mismatch inside generation preparation rolls back the whole rotation',t=>{
  const {store}=fixture(t),prune=store.pruneGenerations.bind(store);
  store.pruneGenerations=(...args)=>{prune(...args);store.db.prepare("UPDATE lease SET owner='different-owner'").run();};
  assert.throws(()=>store.beginCycle(),/lease/);
  assert.equal(store.get('active'),2);assert.equal(store.get('previous'),1);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),2);store.assertWriter();
});

test('off-thread preparation and publication preserve frozen snapshots and reject a stale caller',async t=>{
  const {directory,store}=fixture(t),epoch=store.get('marksEpoch');
  const cycle=await run(t,store,'begin').promise;
  assert.equal(store.get('active'),2);assert.equal(store.get('working').generation,cycle.generation);assert.equal(store.get('marksEpoch'),epoch);
  assert.equal(store.db.prepare('SELECT generation FROM follow_generations WHERE generation=2').get().generation,2);
  await run(t,store,'publish',{generation:cycle.generation}).promise;
  assert.equal(store.get('active'),3);assert.equal(store.get('previous'),2);assert.equal(store.get('working'),null);assert.equal(store.get('marksEpoch'),epoch);
  assert.deepEqual(store.db.prepare('SELECT generation FROM follow_generations ORDER BY generation').all().map(row=>row.generation),[2,3]);
  const other=new ActivityStore(directory);t.after(()=>other.close());
  store.release();assert(other.acquire());
  await assert.rejects(run(t,store,'begin').promise,/lease/);
  assert.equal(store.get('sequence'),3);
});

test('a failure in off-thread publication leaves the accepted generation and working cursor intact',async t=>{
  const {store}=fixture(t),cycle=await run(t,store,'begin').promise;
  store.enqueue(cycle.generation,'saved','document',{endpoint:'/plenary-documents/B-10-2026-0001',offset:750},101);
  await assert.rejects(run(t,store,'publish',{generation:cycle.generation}).promise,/incomplete/);
  assert.equal(store.get('active'),2);assert.equal(store.get('working').generation,3);
  assert.equal(JSON.parse(store.db.prepare("SELECT body FROM tasks WHERE generation=3 AND key='saved'").get().body).offset,750);store.assertWriter();
});

test('lease takeover after dispatch still fences the preparation thread and preserves the new owner',async t=>{
  const {directory,store}=fixture(t),other=new ActivityStore(directory);t.after(()=>other.close());
  const createWorker=(url,options)=>{store.release();assert(other.acquire());return new Worker(url,options);};
  await assert.rejects(run(t,store,'begin',{createWorker}).promise,/lease/);
  assert.equal(store.get('active'),2);assert.equal(store.get('previous'),1);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),2);
  assert.equal(store.db.prepare('SELECT owner FROM lease').get().owner,other.owner);other.assertWriter();
});

test('HTTP starts and stays responsive while generation rotation holds the writer lock; shutdown rolls it back',loopback,async t=>{
  const {directory,store}=fixture(t);store.release();
  const preload=path.join(directory,'delay.mjs');
  writeFileSync(preload,`import {isMainThread} from 'node:worker_threads';
    import {ActivityStore} from ${JSON.stringify(new URL('./activity-index-store.mjs',import.meta.url).href)};
    if(isMainThread){const original=globalThis.setInterval;globalThis.setInterval=(fn,ms,...args)=>original(fn,ms===20000?25:ms,...args);}
    else {const prune=ActivityStore.prototype.pruneGenerations;ActivityStore.prototype.pruneGenerations=function(...args){console.log('GENERATION_LOCK_HELD');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000);return prune.apply(this,args);};}`);
  const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
  const execution=execFileAsync(t,process.execPath,['--import',preload,new URL('./index.mjs',import.meta.url).pathname],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),ACTIVITY_INDEX_DIR:directory,ACTIVITY_INDEX_ENABLED:'true',ACTIVITY_INDEX_RECOVERY_MODE:'backfill',CORPUS_ENABLED:'false',ODP_CACHE_DIR:'',EXPLORER_SERVE_STATIC:'false'}});
  const child=execution.child;let output='';
  const locked=new Promise((resolve,reject)=>{
    child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('GENERATION_LOCK_HELD'))resolve();});
    child.once('exit',()=>reject(new Error('Server exited before preparation: '+output)));
  });
  const finished=execution.then(value=>({value}),error=>({error}));
  await locked;assert.match(output,/listening on/);
  await delay(100); // Several real heartbeat ticks occur while SQLite is locked.
  const health=await fetch(`http://127.0.0.1:${port}/healthz`,{signal:AbortSignal.timeout(1500)});assert.equal(health.status,200);
  const response=await fetch(`http://127.0.0.1:${port}/api/activity-index/status`,{signal:AbortSignal.timeout(1500)});assert.equal(response.status,200);
  const status=await response.json();assert.equal(status.servingGeneration,2);assert.equal(store.get('active'),2);assert.equal(store.get('working'),null);
  child.kill('SIGTERM');const result=await finished;if(result.error)assert.equal(result.error.signal,'SIGTERM');
  assert.equal(store.get('active'),2);assert.equal(store.get('previous'),1);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),2);
  assert(store.acquire(),'the preparation thread exited before the logical lease was released');
});
