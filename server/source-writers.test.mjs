import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {startSourceWriters} from './source-writers.mjs';
import {ActivityStore} from './activity-index-store.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {prepareIndexes} from './migrate-indexes.mjs';
import {followingStatus} from './insights-following.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';
import {OdpObservations} from './odp-observability.mjs';
import {loopback} from './test-support/loopback.mjs';

const workerUrl=new URL('./test-support/source-writer-fixture.mjs',import.meta.url);
const services=()=>({queueFor:()=>new UpstreamQueue(),observations:new OdpObservations({log:()=>{}})});
test('disabled source writers allocate no worker',async()=>{
  const stop=startSourceWriters({enabled:false,createWorker:()=>{throw new Error('Unexpected worker.');}});await stop();
});
function messages(worker,type) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{worker.off('message',receive);reject(new Error('Missing '+type));},15000);
    const receive=message=>{if(message.type!==type)return;clearTimeout(timer);worker.off('message',receive);resolve(message);};
    worker.on('message',receive);
  });
}
async function fixture(t,options={}) {
  let worker;
  const stop=startSourceWriters({enabled:true,workerUrl,services:services(),log:()=>{},...options,
    createWorker:(url,settings)=>{worker=new Worker(url,settings);return worker;},
  });
  t.after(stop);await messages(worker,'ready');return {worker,stop};
}

test('committed publication notices reach readers with Following marks, availability and amendment readiness',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'source-publications-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const prepared=new ActivityStore(directory);assert(prepared.acquire());prepared.close();
  const reader=new ActivityStore(directory,{readOnly:true});t.after(()=>reader.close());
  assert.throws(()=>reader.set('unexpected',true),/readonly|read.only/i);
  let published;const publication=new Promise(resolve=>published=resolve);
  const {worker}=await fixture(t,{workerData:{directory},onPublication:message=>{if(message.revision.active)published(message);}});
  worker.postMessage({type:'publish',id:1});
  const message=await publication;
  assert.equal(message.source,'activity');assert.equal(message.revision.active,reader.get('active'));
  assert.equal(message.revision.availabilityRevision,17);assert.equal(reader.get('availabilityRevision'),17);
  assert.equal(message.revision.amendmentMutationRevision,23);assert.equal(reader.get('amendmentMutationRevision'),23);
  assert.equal(followingStatus(reader).marksReady,true);assert.equal(reader.status().currentMeps,1);
  assert.equal(message.revision.marksEpoch,followingStatus(reader).epoch);
});

test('a crash restarts with backoff; stopping prevents further restarts and drains its port',async t=>{
  const queue=new UpstreamQueue(),logs=[],workers=[],started=[];
  let next;const second=new Promise(resolve=>next=resolve);
  const stop=startSourceWriters({enabled:true,workerUrl,services:{queueFor:()=>queue,observations:new OdpObservations()},restartMs:60,
    log:(...args)=>logs.push(args),createWorker:(url,options)=>{
      const worker=new Worker(url,options);workers.push(worker);started.push(Date.now());
      worker.on('message',message=>{if(message.type==='ready'&&workers.length===2)next(worker);});return worker;
    },
  });t.after(stop);
  await messages(workers[0],'ready');
  const grant=messages(workers[0],'grant');workers[0].postMessage({type:'acquire',id:1});await grant;
  assert.equal(queue.active,1);workers[0].postMessage({type:'crash'});
  const replacement=await second;assert.equal(queue.active,0);assert(started[1]-started[0]>=60);
  assert(logs.some(args=>args.join(' ').includes('restarting')));
  const exited=once(replacement,'exit');await stop();assert.equal((await exited)[0],0);
  await delay(100);assert.equal(workers.length,2);
});

test('the real activity and corpus loops drain queued admission and release both leases',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'source-drain-')),activityDirectory=path.join(directory,'activity'),corpusDirectory=path.join(directory,'corpus');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  prepareIndexes({activityDirectory,corpusDirectory,log:()=>{}});
  const queue=new UpstreamQueue({maximum:0}),enqueue=queue.enqueue.bind(queue);let starts=0,ready;
  const waiting=new Promise(resolve=>ready=resolve);
  queue.enqueue=(...args)=>{if(++starts===2)ready();return enqueue(...args);};
  let worker;
  const stop=startSourceWriters({enabled:true,services:{queueFor:()=>queue,observations:new OdpObservations()},
    createWorker:(url,options)=>{worker=new Worker(url,{...options,env:{...process.env,ACTIVITY_INDEX_ENABLED:'true',ACTIVITY_INDEX_DIR:activityDirectory,CORPUS_ENABLED:'true',CORPUS_DIR:corpusDirectory}});return worker;},
  });t.after(stop);
  await waiting;
  const exited=once(worker,'exit');await stop();assert.equal((await exited)[0],0);
  assert.equal(queue.waiters.length,0);assert.equal(queue.active,0);
  for(const [Store,dir] of [[ActivityStore,activityDirectory],[CorpusStore,corpusDirectory]]) {
    const store=new Store(dir,{readOnly:true});
    try{assert.equal(store.db.prepare('SELECT COUNT(*) n FROM lease').get().n,0);}finally{store.close();}
  }
});

test('a two-second synchronous writer loop leaves main-thread timers responsive',async t=>{
  const {worker}=await fixture(t),busy=messages(worker,'busy-start'),finished=messages(worker,'done');
  worker.postMessage({type:'busy',id:1});await busy;
  const started=performance.now();await delay(10);assert(performance.now()-started<100);
  await finished;
});

test('a two-second synchronous writer loop adds at most 100 ms to an HTTP request',loopback,async t=>{
  const {worker}=await fixture(t),server=http.createServer((_request,response)=>response.end('ready'));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const request=()=>new Promise((resolve,reject)=>{
    const started=performance.now();http.get({host:'127.0.0.1',port:server.address().port},response=>{response.resume();response.once('end',()=>resolve(performance.now()-started));}).once('error',reject);
  });
  await request();const baseline=await request();
  const busy=messages(worker,'busy-start'),finished=messages(worker,'done');worker.postMessage({type:'busy',id:1});await busy;
  const elapsed=await request();t.diagnostic(`HTTP baseline ${baseline.toFixed(1)} ms; busy worker ${elapsed.toFixed(1)} ms`);
  // Shared runners can have nontrivial loopback scheduling overhead. Bound the
  // additional writer delay and still reject a two-second event-loop stall.
  assert(elapsed<1000&&elapsed-baseline<100,`HTTP baseline ${baseline} ms, busy worker ${elapsed} ms`);await finished;
});
