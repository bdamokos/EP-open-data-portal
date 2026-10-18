import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CorpusStore} from './corpus-store.mjs';
import {CorpusWorker} from './corpus-worker.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';
import {unthrottledUpstream} from './test-support/upstream.mjs';

const clock=()=>Date.parse('2026-10-16T10:00:00Z');
const body={sourceId:'E-10-2026-000001',kind:'question',parentId:null,date:'2026-05-01',originalLanguages:['en'],language:'en',translationType:'original',url:'https://data.europarl.europa.eu/distribution/example/question_en.docx'};
const deferred=()=>Promise.withResolvers();
function fixture(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'corpus-cancellation-'));
  const store=new CorpusStore(directory,{clock});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  assert(store.acquire());store.enqueue('docx:'+body.url,'docx',body,100);store.release();
  return {store,directory,key:'docx:'+body.url};
}
function worker(store,options={}) {
  const instance=new CorpusWorker(store,{clock,interval:0,budget:1,runUpstream:unthrottledUpstream,fetchRecord:async()=>{throw new Error('Cancellation fixtures must not retrieve sources.');},...options});
  instance.discover=async()=>{};
  return instance;
}
function unfinished(store,key,before) {
  assert.deepEqual(store.task(key),before,'cancellation preserves the durable task and its retry state');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM documents').get().n,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM texts').get().n,0);
}
async function restart(store,key) {
  const resumed=worker(store,{download:async(_url,{signal})=>{assert.equal(signal,resumed.controller.signal);return {paragraphs:['Restarted question text.']};}});
  await resumed.run();
  assert.equal(store.task(key).done,1);
  assert.equal(store.search({query:'Restarted'}).total,1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM lease').get().n,0);
}

test('stopping an in-flight DOCX forwards cancellation, rejects late publication and retains restart work',async t=>{
  for(const outcome of ['late success','late failure','signal-aware'])await t.test(outcome,async t=>{
    const {store,key}=fixture(t),before=store.task(key),started=deferred(),reply=deferred();
    const instance=worker(store,{download:async(url,{signal})=>{
      assert.equal(url,body.url);assert.equal(signal,instance.controller.signal);
      if(outcome==='signal-aware')signal.addEventListener('abort',()=>reply.reject(signal.reason),{once:true});
      started.resolve();return reply.promise;
    }});
    const running=instance.run();await started.promise;
    instance.stop();assert.equal(instance.controller.signal.aborted,true);
    if(outcome==='late success')reply.resolve({paragraphs:['Cancelled text must not be stored.']});
    if(outcome==='late failure')reply.reject(new Error('Late failed download.'));
    await running;
    assert.equal(instance.running,false);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM lease').get().n,0);
    unfinished(store,key,before);await restart(store,key);
  });
});

test('stopping before DOCX admission removes the queued job without downloading or marking it complete',async t=>{
  const {store,key}=fixture(t),before=store.task(key),queue=new UpstreamQueue({interval:0}),queued=deferred();
  const release=await queue.acquire('background');let downloads=0;
  const instance=worker(store,{download:async()=>{downloads++;return {paragraphs:['Unexpected text']};},runUpstream:async(operation,{priority,signal})=>{
    assert.equal(priority,'background');assert.equal(signal,instance.controller.signal);
    const admission=queue.acquire(priority,{signal});queued.resolve();
    const release=await admission;
    try {signal.throwIfAborted();return await operation(signal);}finally {release();}
  }});
  const running=instance.run();await queued.promise;
  try {
    assert.equal(queue.snapshot().queued,1);instance.stop();await running;
    assert.equal(queue.snapshot().queued,0);assert.equal(downloads,0);
    unfinished(store,key,before);
  }finally {release();}
  await restart(store,key);
});

test('a completed DOCX download still requires the corpus writer lease before publication',async t=>{
  const {store,directory,key}=fixture(t),before=store.task(key),started=deferred(),reply=deferred();
  const other=new CorpusStore(directory,{clock});t.after(()=>other.close());
  const instance=worker(store,{download:async()=>{started.resolve();return reply.promise;}});
  assert(store.acquire());
  const pending=instance.task(store.task(key));await started.promise;
  store.db.prepare('UPDATE lease SET expires=0').run();assert(other.acquire());
  reply.resolve({paragraphs:['Late text after ownership changed.']});
  await assert.rejects(pending,/lease was lost/);
  unfinished(store,key,before);other.assertWriter();other.release();await restart(store,key);
});
