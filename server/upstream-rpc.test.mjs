import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker,MessageChannel} from 'node:worker_threads';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {UpstreamQueue} from './upstream-queue.mjs';
import {upstreamPortServices} from './odp.mjs';
import {OdpObservations} from './odp-observability.mjs';
import {serveUpstreamPort,UpstreamRpcClient} from './upstream-rpc.mjs';

function reply(worker,id,type='done') {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{worker.off('message',receive);reject(new Error(`Missing ${type} ${id}`));},15000);
    const receive=message=>{if(message.id!==id||![type,'failed'].includes(message.type))return;clearTimeout(timer);worker.off('message',receive);message.type==='failed'?reject(new Error(message.error)):resolve(message);};
    worker.on('message',receive);
  });
}
async function fixture(t,options={},services) {
  const queue=services?.queueFor('https://oeil.europarl.europa.eu')||new UpstreamQueue(options),observations=new OdpObservations({onResponse:status=>queue.recordResponse(status),log:()=>{}});
  const {port1,port2}=new MessageChannel();
  const close=serveUpstreamPort(port1,{queueFor:services?.queueFor||(()=>queue),observations});
  const worker=new Worker(new URL('./test-support/source-writer-fixture.mjs',import.meta.url),{workerData:{upstreamPort:port2},transferList:[port2]});
  t.after(async()=>{close();await worker.terminate();});await once(worker,'message');
  let sequence=0;
  return {queue,observations,worker,command(type,values={},expected='done') {
    const id=++sequence,result=reply(worker,id,expected);worker.postMessage({type,id,...values});return result;
  }};
}
const tick=()=>delay(20);

test('thread admissions share the foreground reserve and operation/background caps',async t=>{
  const f=await fixture(t,{rateLimit:{maximum:5,windowMs:5000,foregroundReserve:2}});
  const first=await f.command('acquire',{},'grant');
  const second=f.command('acquire',{},'grant');await tick();
  assert.equal(f.queue.active,1);assert.equal(f.queue.background,1);
  const foreground=await f.queue.acquire();assert.equal(f.queue.active,2);
  const another=f.queue.acquire();await tick();assert.equal(f.queue.active,2);
  foreground();const fg2=await another;fg2();
  // Three starts have spent the background allowance. Releasing its connection
  // must leave the second writer queued while readers retain two more starts.
  await f.command('release',{grant:first.grant});await tick();
  assert.equal(f.queue.background,0);assert.equal(f.queue.starts.length,3);
  const reserve=await f.queue.acquire();reserve();assert.equal(f.queue.starts.length,4);
  await f.command('cancel',{target:2});await assert.rejects(second,/abort/i);
  assert.equal(f.queue.waiters.length,0);
});

test('cancellation, admission races and a disconnected worker release grants',async t=>{
  const f=await fixture(t);
  const granted=await f.command('acquire',{},'grant');assert.equal(f.queue.active,1);
  const queued=f.command('acquire',{},'grant');await tick();
  await f.command('cancel',{target:2});await assert.rejects(queued,/abort/i);
  assert.equal(f.queue.waiters.length,0);
  await f.command('release',{grant:granted.grant});await tick();assert.equal(f.queue.active,0);
  await f.command('acquire',{},'grant');await f.worker.terminate();await tick();assert.equal(f.queue.active,0);
  // A grant already in the port's receive queue is also cancelled safely.
  const {port1,port2}=new MessageChannel(),close=serveUpstreamPort(port1,{queueFor:()=>f.queue,observations:f.observations}),client=new UpstreamRpcClient(port2);
  try {
    const controller=new AbortController(),pending=client.acquire('background','/other',{signal:controller.signal});controller.abort();
    await assert.rejects(pending);await tick();assert.equal(f.queue.active,0);assert.equal(f.queue.waiters.length,0);
  }finally{client.close();close();}
});

test('worker responses feed main telemetry, adaptive pacing and a shared 429 cooldown in both directions',async t=>{
  const f=await fixture(t,{adaptive:true});
  await f.command('fetch',{status:429,retryAfter:.15});
  const snapshot=f.observations.snapshot();assert.equal(snapshot.starts,1);assert.equal(snapshot.responses,1);assert.equal(snapshot.statuses[429],1);
  assert.equal(snapshot.lastThrottle.route,'/speeches/{id}');assert(!JSON.stringify(snapshot).includes('EXACT-ID'));
  assert(f.queue.cooldownUntil>Date.now());
  let admitted=false;const main=f.queue.acquire('background').then(release=>{admitted=true;release();});
  await tick();assert.equal(admitted,false);await main;
  f.queue.backoff(.15);
  const start=Date.now();await f.command('fetch',{status:200});assert(Date.now()-start>=100);
  assert.equal(f.observations.snapshot().responses,2);assert.equal(f.queue.active,0);
});

test('cancellation releases an admitted grant after transport cleanup, preserving the cap',async t=>{
  const queue=new UpstreamQueue(),observations=new OdpObservations(),{port1,port2}=new MessageChannel();
  const close=serveUpstreamPort(port1,{queueFor:()=>queue,observations}),client=new UpstreamRpcClient(port2),controller=new AbortController();
  t.after(()=>{client.close();close();});
  let finish,entered;const ready=new Promise(resolve=>entered=resolve);
  const operation=client.queue('odp').run(signal=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{finish=()=>reject(signal.reason);},{once:true});entered();
  }),{signal:controller.signal});
  await ready;assert.equal(queue.active,1);controller.abort();await tick();assert.equal(queue.active,1);
  const rejected=assert.rejects(operation);finish();await rejected;await tick();assert.equal(queue.active,0);
});

test('header telemetry preserves the body-held admission and sanitizes worker network failures',async t=>{
  const f=await fixture(t),headers=reply(f.worker,1,'headers'),fetching=f.command('fetch',{status:200,holdBody:true});
  await headers;assert.equal(f.observations.snapshot().responses,1);assert.equal(f.queue.active,1);
  let admitted=false;const background=f.queue.acquire('background').then(release=>{admitted=true;release();});
  await tick();assert.equal(admitted,false);await f.command('body-release',{target:1});await fetching;await background;
  await assert.rejects(f.command('fetch',{networkError:true}),/EXCLUDED/);
  const barrier=await f.queue.acquire('background');barrier();
  const snapshot=f.observations.snapshot();assert.equal(snapshot.networkErrors,1);assert.equal(snapshot.failureKinds.connection,1);
  assert(!JSON.stringify(snapshot).match(/EXCLUDED|EXACT-ID|secret/));assert.equal(f.queue.active,0);
});

 test('OEIL source workers and foreground readers share the same serial paced origin grants',async t=>{
 const services=upstreamPortServices(),one=await fixture(t,{},services),two=await fixture(t,{},services),source='https://oeil.europarl.europa.eu';
 const first=await one.command('acquire',{source},'grant'),started=Date.now();
 const next=two.command('acquire',{source},'grant');await tick();assert.equal(one.queue.active,1);
 let foregroundAt;const foreground=one.queue.acquire().then(release=>{foregroundAt=Date.now();release();});
 await one.command('release',{grant:first.grant});await foreground;assert(foregroundAt-started>=900);
 const second=await next;assert(Date.now()-foregroundAt>=900);assert.equal(one.queue.maximum,1);await two.command('release',{grant:second.grant});
 });

test('lowest background rank reaches shared admission and enables existing adaptive backfill policy',async t=>{
 const services=upstreamPortServices(),{port1,port2}=new MessageChannel(),close=serveUpstreamPort(port1,services),client=new UpstreamRpcClient(port2);t.after(()=>{client.close();close();});
 await client.queue('odp').run(async()=>{}, {priority:'background',backgroundRank:1});await tick();
 const queue=services.queueFor('odp');assert.equal(queue.adaptive,true);assert(queue.interval>0);assert.equal(queue.active,0);
});
