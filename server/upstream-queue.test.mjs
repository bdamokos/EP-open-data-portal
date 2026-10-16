import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UpstreamQueue,retryAfterSeconds} from './upstream-queue.mjs';
import {odp} from './odp.mjs';
import {sendError} from './http-utils.mjs';

test('Retry-After accepts seconds and HTTP dates, with bounded defaults',()=>{
  const now=Date.parse('2026-10-16T16:00:00Z');
  assert.equal(retryAfterSeconds('300',now),300);
  assert.equal(retryAfterSeconds('Fri, 16 Oct 2026 16:05:00 GMT',now),300);
  for(const value of ['0','-1','Fri, 16 Oct 2026 15:00:00 GMT'])assert.equal(retryAfterSeconds(value,now),30);
  for(const value of [null,'garbage'])assert.equal(retryAfterSeconds(value,now),60);
  assert.equal(retryAfterSeconds('999999',now),1800);
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
  const failed=odp('/queue-test-limited');t.mock.timers.tick(2100);
  await assert.rejects(failed,e=>e.code==='odp_rate_limited'&&e.retryAfter===301&&e.retryAt>Date.now());
  assert.equal(await odp('/queue-test-cached'),cached);
  await assert.rejects(odp('/queue-test-other'),e=>e.code==='upstream_busy');assert.equal(calls,2);
  const headers={};let body;
  sendError({method:'GET',headers:{}},{setHeader:(key,value)=>headers[key]=value,end:value=>body=value},Object.assign(new Error('pause'),{retryAfter:300}));
  assert.equal(headers['Retry-After'],'300');assert.equal(JSON.parse(body).error.retryAfter,300);
  t.mock.timers.tick(301000);
  const [a,b]=await Promise.all([odp('/queue-test-limited'),odp('/queue-test-limited')]);
  assert.equal(a,b);assert.equal(calls,3);
  const background=odp('/queue-test-background',{}, {priority:'background'});
  t.mock.timers.tick(2100);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,4);
  assert.equal(await odp('/queue-test-cached'),cached);
  await assert.rejects(odp('/queue-test-busy'),e=>e.code==='upstream_busy');assert.equal(calls,4);
  t.mock.timers.tick(30000);await background;assert.equal(calls,5);
  const exhausted=assert.rejects(odp('/queue-test-exhausted',{}, {priority:'background'}),e=>e.code==='odp_rate_limited');
  t.mock.timers.tick(2100);await new Promise(resolve=>setImmediate(resolve));
  for(let attempt=0;attempt<2;attempt++){t.mock.timers.tick(30000);await new Promise(resolve=>setImmediate(resolve));}
  await exhausted;assert.equal(calls,8,'background retry budget is three attempts');
});
