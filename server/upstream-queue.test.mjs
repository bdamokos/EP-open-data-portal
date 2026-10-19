import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UpstreamQueue,retryAfterSeconds} from './upstream-queue.mjs';
import {odp,boundedUpstream,ODP_RATE_LIMIT,backoffUpstream} from './odp.mjs';
import {sendError} from './http-utils.mjs';

test('ODP quota counts real starts in an inclusive rolling five-minute window',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const q=new UpstreamQueue({rateLimit:ODP_RATE_LIMIT,interactiveWaitMs:400_000});
  let calls=0;
  for(let i=0;i<500;i++)await q.run(()=>{calls++;});
  const next=q.run(()=>{calls++;});
  await Promise.resolve();assert.equal(calls,500);
  t.mock.timers.tick(300_000);await Promise.resolve();assert.equal(calls,500,'the exact window boundary is still counted');
  t.mock.timers.tick(1);await next;assert.equal(calls,501);
});

test('rolling expiry follows each start rather than resetting a fixed window',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const q=new UpstreamQueue({rateLimit:{maximum:2,windowMs:100},interactiveWaitMs:1000});
  await q.run(()=>{});t.mock.timers.tick(50);await q.run(()=>{});
  let calls=0;const third=q.run(()=>{calls++;});
  t.mock.timers.tick(51);await third;
  const fourth=q.run(()=>{calls++;});
  t.mock.timers.tick(49);await Promise.resolve();assert.equal(calls,1);
  t.mock.timers.tick(1);await fourth;assert.equal(calls,2);
});

test('background respects a foreground quota reserve and readers pass queued background jobs',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const q=new UpstreamQueue({rateLimit:{maximum:3,windowMs:100,foregroundReserve:1}}),order=[];
  await q.run(()=>{}, {priority:'background'});await q.run(()=>{}, {priority:'background'});
  const background=q.run(()=>{order.push('background');},{priority:'background'});
  await q.run(()=>{order.push('reader');});assert.deepEqual(order,['reader']);
  t.mock.timers.tick(101);await background;assert.deepEqual(order,['reader','background']);
});

test('quota waiting and cancellation consume neither a connection nor a request start',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const q=new UpstreamQueue({rateLimit:{maximum:1,windowMs:100},interactiveWaitMs:1000});
  await q.run(()=>{});await Promise.resolve();
  const controller=new AbortController();let calls=0;
  const cancelled=assert.rejects(q.run(()=>{calls++;},{signal:controller.signal}));
  assert.equal(q.active,0);controller.abort();await cancelled;
  assert.equal(q.starts.length,1);assert.equal(q.waiters.length,0);
  t.mock.timers.tick(101);assert.equal(calls,0);
});

test('independent sources do not spend ODP quota or inherit its cooldown',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  backoffUpstream(100);let calls=0;
  for(const source of ['website','documents','multimedia','player'])await boundedUpstream(()=>{calls++;},{source});
  assert.equal(calls,4);
  await assert.rejects(boundedUpstream(()=>{}),e=>e.retryAfter===100);
  t.mock.timers.tick(100_000);
});

test('long server cooldowns remain valid beyond the timer range and never shorten an existing pause',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const q=new UpstreamQueue();q.backoff(3_000_000);q.backoff(1);
  await assert.rejects(q.run(()=>{}),e=>e.retryAfter===3_000_000);
  let calls=0;const work=q.run(()=>{calls++;},{priority:'background'});
  t.mock.timers.tick(2**31-1);await Promise.resolve();assert.equal(calls,0);
  t.mock.timers.tick(3_000_000_000-(2**31-1));await work;assert.equal(calls,1);
});

test('a zero-second hint preserves queued readers, shared joins and any existing longer pause',async()=>{
  const q=new UpstreamQueue({maximum:1}),release=await q.acquire();
  let complete;const shared=new Promise(resolve=>complete=resolve),joined=q.joinBackground(shared),next=q.acquire();
  q.backoff(0);assert.equal(q.waiters.length,1);assert.equal(q.joiners.size,1);
  release();(await next)();complete('saved');assert.equal(await joined,'saved');
  q.backoff(300);const until=q.cooldownUntil;q.backoff(0);assert.equal(q.cooldownUntil,until);
});

test('Retry-After accepts seconds and HTTP dates without shortening valid server hints',()=>{
  const now=Date.parse('2026-10-16T16:00:00Z');
  assert.equal(retryAfterSeconds('300',now),300);
  assert.equal(retryAfterSeconds('Fri, 16 Oct 2026 16:05:00 GMT',now),300);
  for(const value of ['0','Fri, 16 Oct 2026 15:00:00 GMT'])assert.equal(retryAfterSeconds(value,now),0);
  for(const value of [null,'garbage','-1'])assert.equal(retryAfterSeconds(value,now),60);
  assert.equal(retryAfterSeconds('999999',now),999999);
  assert.equal(retryAfterSeconds('0.1',now),1);
  assert.equal(retryAfterSeconds('Friday, 16-Oct-26 16:05:00 GMT',now),300);
  assert.equal(retryAfterSeconds('Fri Oct 16 16:05:00 2026',now),300);
});

test('concurrent speech reads stay spaced, coalesce nothing at the queue, and reserve background capacity',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const q=new UpstreamQueue({interval:100,interactiveWaitMs:1000}),started=[];
  const bg=await q.acquire('background');
  const reads=[1,2,3].map(id=>q.acquire().then(release=>{started.push([id,Date.now()]);return release;}));
  const background=q.acquire('background');
  t.mock.timers.tick(100);await Promise.resolve();
  assert.deepEqual(started,[[1,1100]]);assert.equal(q.active,2);assert.equal(q.background,1);
  (await reads[0])();t.mock.timers.tick(100);await Promise.resolve();
  (await reads[1])();t.mock.timers.tick(100);await Promise.resolve();
  assert.deepEqual(started,[[1,1100],[2,1200],[3,1300]]);
  (await reads[2])();bg();t.mock.timers.tick(100);(await background)();
  assert.equal(q.active,0);assert.equal(q.waiters.length,0);
});

test('cooldown rejects queued/new interactive work and releases slots while background waits',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const q=new UpstreamQueue({interval:100});
  const release=await q.acquire('background');
  const queued=assert.rejects(q.acquire(),e=>e.status===503&&e.retryAfter===300&&e.retryAt===301000);
  q.backoff(300);release();await queued;
  await assert.rejects(q.acquire(),e=>e.code==='upstream_busy'&&e.retryAfter===300);
  const next=q.acquire('background');assert.equal(q.active,0);
  t.mock.timers.tick(299999);assert.equal(q.active,0);
  t.mock.timers.tick(1);(await next)();assert.equal(q.active,0);
});

test('admission timeout removes abandoned interactive work before it can fetch',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const q=new UpstreamQueue({interval:0,maximum:1,interactiveWaitMs:100});
  const release=await q.acquire();
  const failed=assert.rejects(q.acquire(),e=>e.status===503&&e.code==='upstream_busy');
  t.mock.timers.tick(100);await failed;assert.equal(q.waiters.length,0);release();
  assert.equal(q.active,0);
});

test('joining background work has a bounded wait without cancelling the shared result',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const q=new UpstreamQueue({interactiveWaitMs:100});let finish;
  const shared=new Promise(resolve=>finish=resolve);
  const timedOut=assert.rejects(q.joinBackground(shared),e=>e.code==='upstream_busy');
  t.mock.timers.tick(100);await timedOut;assert.equal(q.joiners.size,0);
  const joined=q.joinBackground(shared);finish('saved');assert.equal(await joined,'saved');assert.equal(q.joiners.size,0);
});

test('aborted readers leave queued admission and shared joins without cancelling another reader',async()=>{
  const q=new UpstreamQueue({interval:0,maximum:1}),release=await q.acquire();
  const queuedController=new AbortController(),joinController=new AbortController(),reason=new Error('reader disconnected');
  const queued=assert.rejects(q.acquire('interactive',{signal:queuedController.signal}),e=>e===reason);
  queuedController.abort(reason);await queued;assert.equal(q.waiters.length,0);assert.equal(q.active,1);
  await assert.rejects(q.acquire('interactive',{signal:queuedController.signal}),e=>e===reason);
  let complete;const shared=new Promise(resolve=>complete=resolve),survivor=q.joinBackground(shared);
  const detached=assert.rejects(q.joinBackground(shared,{signal:joinController.signal}),e=>e===reason);
  joinController.abort(reason);await detached;assert.equal(q.joiners.size,1);
  complete('saved');assert.equal(await survivor,'saved');assert.equal(q.joiners.size,0);release();assert.equal(q.active,0);
});

test('ODP shares cold reads, exposes 429 cooldown, serves cached data and retries after it expires',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-16T16:00:00Z')});
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{
    calls++;
    if(calls===2)return new Response('limited',{status:429,headers:{'Retry-After':'Fri, 16 Oct 2026 16:05:03 GMT'}});
    if(calls===4||calls>=6)return new Response('limited',{status:503,headers:{'Retry-After':'30'}});
    return Response.json({data:[{id:'saved'}]});
  });
  const cached=await odp('/queue-test-cached');
  const failed=odp('/queue-test-limited');
  await assert.rejects(failed,e=>e.code==='odp_rate_limited'&&e.retryAfter===303&&e.retryAt>Date.now());
  assert.equal(await odp('/queue-test-cached'),cached);
  await assert.rejects(odp('/queue-test-other'),e=>e.code==='upstream_busy');assert.equal(calls,2);
  const headers={};let body;
  sendError({method:'GET',headers:{}},{setHeader:(key,value)=>headers[key]=value,end:value=>body=value},Object.assign(new Error('pause'),{retryAfter:300}));
  assert.equal(headers['Retry-After'],'300');assert.equal(JSON.parse(body).error.retryAfter,300);
  t.mock.timers.tick(303000);
  const [a,b]=await Promise.all([odp('/queue-test-limited'),odp('/queue-test-limited')]);
  assert.equal(a,b);assert.equal(calls,3);
  const background=odp('/queue-test-background',{}, {priority:'background'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,4);
  assert.equal(await odp('/queue-test-cached'),cached);
  await assert.rejects(odp('/queue-test-busy'),e=>e.code==='upstream_busy');assert.equal(calls,4);
  t.mock.timers.tick(30000);await background;assert.equal(calls,5);
  const exhausted=assert.rejects(odp('/queue-test-exhausted',{}, {priority:'background'}),e=>e.code==='odp_rate_limited');
  await new Promise(resolve=>setImmediate(resolve));
  for(let attempt=0;attempt<2;attempt++){t.mock.timers.tick(30000);await new Promise(resolve=>setImmediate(resolve));}
  await exhausted;assert.equal(calls,8,'background retry budget is three attempts');
});

test('an interactive profile joining a background retry receives cooldown immediately and later reuses its result',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-16T17:00:00Z')});
  let calls=0,finish;
  t.mock.method(globalThis,'fetch',async()=>{
    calls++;
    if(calls===1)return new Promise(resolve=>finish=resolve);
    return Response.json({data:[{identifier:'99999'}]});
  });
  const background=odp('/meps/99999',{}, {priority:'background'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  const joined=assert.rejects(odp('/meps/99999'),e=>e.status===503&&e.retryAfter===300);
  finish(new Response('limited',{status:429,headers:{'Retry-After':'300'}}));
  await joined;
  await assert.rejects(odp('/meps/99999'),e=>e.code==='upstream_busy'&&e.retryAfter===300);
  assert.equal(calls,1,'interactive readers must not start a duplicate request');
  t.mock.timers.tick(300000);const saved=await background;
  assert.equal(await odp('/meps/99999'),saved);assert.equal(calls,2);
});
