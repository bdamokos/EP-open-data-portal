import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CorpusStore} from './corpus-store.mjs';
import {CorpusWorker} from './corpus-worker.mjs';
import {unthrottledUpstream} from './test-support/upstream.mjs';

function fixture(t) {
  let now=Date.parse('2026-10-29T19:00:00Z');
  const directory=mkdtempSync(path.join(os.tmpdir(),'corpus-lease-'));
  const store=new CorpusStore(directory,{clock:()=>now});
  const body={sourceId:'E-10-2026-000001',kind:'question',parentId:null,date:'2026-10-01',originalLanguages:['en'],language:'en',translationType:'original',url:'https://data.europarl.europa.eu/distribution/fixture/lease-question.docx',offset:250};
  const key='docx:'+body.url,futureKey='docx:https://data.europarl.europa.eu/distribution/fixture/future-question.docx';
  assert(store.acquire());store.enqueue(key,'docx',body,100);
  store.enqueue(futureKey,'docx',{...body,sourceId:'E-10-2026-000002',url:futureKey.slice(5)},50);
  store.failTask(store.task(futureKey),new Error('Retained source failure'),3600);
  const future=store.task(futureKey);store.release();
  const other=new CorpusStore(directory,{clock:()=>now}),lastRunBefore=store.get('lastRunAt');
  const worker=new CorpusWorker(store,{clock:()=>now,budget:1,interval:0,runUpstream:unthrottledUpstream,fetchRecord:async()=>assert.fail('No source request is allowed')});
  worker.discoveryDue=()=>false;worker.discover=async()=>assert.fail('No discovery is needed');
  t.mock.timers.enable({apis:['setInterval']});
  t.after(()=>{worker.stop();other.close();store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,other,worker,key,body,futureKey,future,lastRunBefore,advance:ms=>{now+=ms;}};
}

for(const loss of ['expiry','takeover'])test('corpus heartbeat '+loss+' fences one iteration and a later tick resumes its saved cursor',async t=>{
  const {store,other,worker,key,futureKey,future,lastRunBefore,advance}=fixture(t);
  const before=store.task(key);let calls=0;
  worker.task=async task=>{
    calls++;
    if(calls===1){advance(91_000);if(loss==='takeover')assert(other.acquire());t.mock.timers.tick(20_000);throw worker.controller.signal.reason;}
    assert.equal(task.body.offset,250);store.taskProgress(task,{...task.body,offset:500});
  };
  let failure;try{await worker.run();}catch(error){failure=error;}
  assert.equal(worker.stopped,false,'lease loss must not become permanent shutdown');
  assert.match(failure?.message||'',/lease was lost/);assert.equal(worker.running,false);
  assert.deepEqual(store.task(key),before);assert.deepEqual(store.task(futureKey),future);
  assert.equal(store.get('lastRunAt'),lastRunBefore,'a lost owner cannot record a completed run');
  const oldController=worker.controller;
  if(loss==='takeover') {
    const owner=other.db.prepare('SELECT * FROM lease').get();
    await worker.run();assert.equal(calls,1);assert.equal(worker.controller,oldController);
    assert.deepEqual(other.db.prepare('SELECT * FROM lease').get(),owner);other.release();
  }
  await worker.run();assert.equal(calls,2);assert.notEqual(worker.controller,oldController);assert.equal(worker.controller.signal.aborted,false);
  const after=store.task(key);assert.equal(after.body.offset,500);assert.equal(after.attempts,before.attempts);assert.equal(after.retry_at,before.retry_at);
  assert.deepEqual(store.task(futureKey),future);
});

test('a late DOCX after corpus lease loss stays pending and the same worker can subsequently retain it',async t=>{
  const {store,other,worker,key,futureKey,future,lastRunBefore,advance}=fixture(t),started=Promise.withResolvers(),reply=Promise.withResolvers();
  let downloads=0;
  worker.download=async(_url,{signal})=>{assert.equal(signal,worker.controller.signal);if(++downloads===1){started.resolve();return reply.promise;}return {paragraphs:['Recovered question text.']};};
  const before=store.task(key),running=worker.run();const result=running.then(()=>null,error=>error);
  await started.promise;advance(91_000);assert(other.acquire());t.mock.timers.tick(20_000);
  reply.resolve({paragraphs:['Late unowned text must not be retained.']});
  const failure=await result;assert.match(failure?.message||'',/lease was lost/);
  assert.equal(worker.stopped,false);assert.deepEqual(store.task(key),before);assert.deepEqual(store.task(futureKey),future);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM texts').get().n,0);assert.equal(store.get('lastRunAt'),lastRunBefore);
  other.release();await worker.run();assert.equal(downloads,2);assert.equal(store.task(key).done,1);
  assert.equal(store.search({query:'Recovered'}).total,1);assert.deepEqual(store.task(futureKey),future);
});

test('ordinary and direct corpus iteration calls cannot overlap an active dispatch',async t=>{
  const {store,worker,key}=fixture(t),started=Promise.withResolvers(),reply=Promise.withResolvers();let calls=0;
  worker.task=async task=>{if(++calls===1){started.resolve();await reply.promise;store.taskProgress(task,{...task.body,offset:500});}else store.finishTask(task);};
  const running=worker.run();const result=running.then(()=>null,error=>error);
  try {
    await started.promise;const owner=store.db.prepare('SELECT * FROM lease').get(),controller=worker.controller;
    await worker.run();await worker.runIteration();
    assert.equal(calls,1);assert.equal(worker.running,true);assert.equal(worker.controller,controller);
    assert.deepEqual(store.db.prepare('SELECT * FROM lease').get(),owner);
  }finally{reply.resolve();await result;}
  assert.equal(store.task(key).body.offset,500);assert.equal(store.task(key).done,0);
});

test('explicit corpus shutdown is permanent for ordinary and direct iteration entry points',async t=>{
  const {store,worker,key,lastRunBefore}=fixture(t),before=store.task(key);
  worker.task=async()=>assert.fail('A shutdown worker cannot dispatch');worker.stop();
  await worker.run();await worker.runIteration();
  assert.equal(worker.stopped,true);assert.equal(worker.running,false);assert.equal(store.get('lastRunAt'),lastRunBefore);
  assert.equal(store.db.prepare('SELECT * FROM lease').get(),undefined);assert.deepEqual(store.task(key),before);
});

test('ordinary source errors preserve retry backoff and do not become corpus shutdown',async t=>{
  const {store,worker,key,futureKey,future}=fixture(t);let calls=0;
  worker.task=async()=>{calls++;throw Object.assign(new Error('EP source returned 500'),{retryAfter:600});};
  await worker.run();const failed=store.task(key),controller=worker.controller;
  assert.equal(failed.attempts,1);assert.equal(failed.retry_at,store.clock()+600_000);assert.equal(failed.done,0);
  assert.equal(worker.stopped,false);assert.equal(controller.signal.aborted,false);
  await worker.run();assert.equal(calls,1);assert.equal(worker.controller,controller);
  assert.deepEqual(store.task(key),failed);assert.deepEqual(store.task(futureKey),future);
});

test('a throwing corpus heartbeat cancels safely and remains recoverable',async t=>{
  const {store,worker,key,futureKey,future,lastRunBefore}=fixture(t),started=Promise.withResolvers(),reply=Promise.withResolvers();
  worker.task=async()=>{started.resolve();await reply.promise;throw worker.controller.signal.reason;};
  const renewal=t.mock.method(store,'renew',()=>{throw Error('Fixture renewal failed');});
  const running=worker.run();const result=running.then(()=>null,error=>error);
  try {
    await started.promise;assert.doesNotThrow(()=>t.mock.timers.tick(20_000));assert.equal(worker.controller.signal.aborted,true);
  }finally{reply.resolve();}
  const failure=await result;assert.equal(failure.message,'Fixture renewal failed');assert.equal(worker.stopped,false);
  assert.equal(store.task(key).attempts,0);assert.equal(store.get('lastRunAt'),lastRunBefore);assert.deepEqual(store.task(futureKey),future);
  renewal.mock.restore();worker.task=async task=>store.finishTask(task);await worker.run();assert.equal(store.task(key).done,1);
});

test('corpus disk-check completion cannot dispatch after a lease takeover',async t=>{
  const {store,other,worker,key,futureKey,future,lastRunBefore,advance}=fixture(t),before=store.task(key);let dispatched=0;
  store.diskBytes=async()=>{advance(91_000);assert(other.acquire());return 0;};
  worker.task=async()=>{dispatched++;};
  await assert.rejects(worker.run(),/lease was lost/);
  assert.equal(dispatched,0);assert.equal(worker.stopped,false);assert.equal(worker.running,false);
  assert.equal(store.get('lastRunAt'),lastRunBefore);assert.deepEqual(store.task(key),before);assert.deepEqual(store.task(futureKey),future);
  other.assertWriter();
});

test('a failed corpus lease release does not block a later tick from resuming saved work',async t=>{
  const {store,worker,key,futureKey,future}=fixture(t),release=store.release.bind(store);
  let releases=0,calls=0;
  t.mock.method(store,'release',()=>{if(++releases===1)throw Error('Fixture release failed');release();});
  worker.task=async task=>{
    if(++calls===1)store.taskProgress(task,{...task.body,offset:500});
    else {assert.equal(task.body.offset,500);store.finishTask(task);}
  };
  await assert.rejects(worker.run(),/Fixture release failed/);
  assert.equal(worker.running,false);assert.equal(worker.stopped,false);
  assert.equal(store.task(key).body.offset,500);assert.equal(store.task(key).done,0);
  assert.deepEqual(store.task(futureKey),future);
  await worker.run();assert.equal(calls,2);assert.equal(store.task(key).done,1);
  assert.deepEqual(store.task(futureKey),future);
});
