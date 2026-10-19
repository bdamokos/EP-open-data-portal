import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UpstreamQueue} from './upstream-queue.mjs';

process.env.ODP_CACHE_DIR='';
const {odp,syncOdpFeeds}=await import('./odp.mjs');
const {apiFetch}=await import('./activity-index-worker.mjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function sharedAdmission(t,queue) {
  for(const method of ['enqueue','reprioritize','backoff','joinBackground'])t.mock.method(UpstreamQueue.prototype,method,queue[method].bind(queue));
}

test('foreground, directory, feeds and worker metadata share starts across IDs, queries and joined reads',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const queue=new UpstreamQueue({rateLimit:{maximum:4,windowMs:100},interactiveWaitMs:1000}),calls=[];
  t.mock.method(UpstreamQueue.prototype,'enqueue',queue.enqueue.bind(queue));
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push(String(url));assert.equal(options.redirect,'error');
    return String(url).includes('/feed?')?new Response('<feed/>',{headers:{'content-type':'application/atom+xml'}}):Response.json({data:[]});
  });
  await syncOdpFeeds({force:true});assert.equal(calls.length,4);
  const worker=apiFetch('/speeches',{offset:0});await turn();assert.equal(calls.length,4);
  assert.equal(queue.active,0,'quota waits hold no connection');
  t.mock.timers.tick(101);await worker;assert.equal(calls.length,5);
  const [one,two]=await Promise.all([odp('/meps/900001'),odp('/meps/900001')]);
  assert.equal(one,two);assert.equal(calls.length,6,'a joined source is one actual start');
  await odp('/meps/900002');await odp('/meps/900002',{language:'fr'});
  const next=odp('/meps/900003',{language:'de'});await turn();assert.equal(calls.length,8);
  t.mock.timers.tick(100);await turn();assert.equal(calls.length,8);
  t.mock.timers.tick(1);await next;assert.equal(calls.length,9,'IDs and queries do not shard quota');
});

test('each background retry spends a start and yields its connection while quota is exhausted',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:2000});
  const queue=new UpstreamQueue({rateLimit:{maximum:2,windowMs:100}});let calls=0;
  t.mock.method(UpstreamQueue.prototype,'enqueue',queue.enqueue.bind(queue));
  t.mock.method(globalThis,'fetch',async()=>++calls<3?new Response(null,{status:429,headers:{'Retry-After':'0'}}):Response.json({data:[]}));
  const result=odp('/quota-retry',{}, {priority:'background'});await turn();
  assert.equal(calls,2);assert.equal(queue.active,0);assert.equal(queue.starts.length,2);
  t.mock.timers.tick(101);await result;assert.equal(calls,3);assert.equal(queue.waiters.length,0);
});

test('a foreground reader promotes its shared queued background source into reserved quota',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:3000});
  const queue=new UpstreamQueue({rateLimit:{maximum:3,windowMs:100,foregroundReserve:1}});let calls=0;
  t.mock.method(UpstreamQueue.prototype,'enqueue',queue.enqueue.bind(queue));
  t.mock.method(UpstreamQueue.prototype,'reprioritize',queue.reprioritize.bind(queue));
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({data:[]});});
  await odp('/quota-seed-1',{}, {priority:'background'});await odp('/quota-seed-2',{}, {priority:'background'});
  const background=odp('/quota-shared',{}, {priority:'background'});await turn();
  assert.equal(calls,2);assert.equal(queue.active,0);
  const reader=odp('/quota-shared');const [saved,joined]=await Promise.all([background,reader]);
  assert.equal(saved,joined);assert.equal(calls,3);assert.equal(queue.starts.length,3);assert.equal(queue.waiters.length,0);
});

test('departing shared foreground reader restores queued background priority without abandoning its owner',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:4000});
  const queue=new UpstreamQueue({maximum:1,rateLimit:{maximum:3,windowMs:100,foregroundReserve:1}});
  t.mock.method(UpstreamQueue.prototype,'enqueue',queue.enqueue.bind(queue));
  t.mock.method(UpstreamQueue.prototype,'reprioritize',queue.reprioritize.bind(queue));
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({data:[]});});
  const release=await queue.acquire();
  const background=odp('/quota-detached',{}, {priority:'background'});await turn();
  const controller=new AbortController(),reader=assert.rejects(odp('/quota-detached',{}, {signal:controller.signal}));
  assert.equal(queue.waiters[0].priority,'interactive');controller.abort();await reader;
  assert.equal(queue.waiters[0].priority,'background');assert.equal(calls,0);
  release();await background;assert.equal(calls,1);assert.equal(queue.waiters.length,0);
});

test('cooldown evicts foreground joins while preserving a promoted background owner for recovery',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:5000});
  const queue=new UpstreamQueue();sharedAdmission(t,queue);
  let limited,other;const calls=[];
  t.mock.method(globalThis,'fetch',url=>{
    calls.push(String(url));
    if(String(url).includes('/quota-active-limit?'))return new Promise(resolve=>limited=resolve);
    if(String(url).includes('/quota-active-other?'))return new Promise(resolve=>other=resolve);
    return Promise.resolve(Response.json({data:[]}));
  });
  const failed=assert.rejects(odp('/quota-active-limit'),e=>e.code==='odp_rate_limited');
  const active=odp('/quota-active-other');await turn();
  const background=odp('/quota-promoted-cooldown',{}, {priority:'background'});await turn();
  const joined=assert.rejects(odp('/quota-promoted-cooldown'),e=>e.code==='upstream_busy');
  assert.equal(queue.waiters[0].priority,'interactive');
  limited(new Response(null,{status:429,headers:{'Retry-After':'60'}}));
  await Promise.all([failed,joined]);other(Response.json({data:[]}));await active;
  assert.equal(queue.waiters.length,1);assert.equal(queue.waiters[0].priority,'background');assert.equal(calls.length,2);
  t.mock.timers.tick(60_000);await background;assert.equal(calls.length,3);
});

test('a joined background retry survives reader departure and the foreground admission deadline',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:7000});
  const queue=new UpstreamQueue({rateLimit:{maximum:1,windowMs:60_000}});sharedAdmission(t,queue);
  let reply,calls=0;
  t.mock.method(globalThis,'fetch',()=>++calls===1?new Promise(resolve=>reply=resolve):Promise.resolve(Response.json({data:[]})));
  const background=odp('/quota-owned-retry',{}, {priority:'background'});await turn();
  const controller=new AbortController(),reader=assert.rejects(odp('/quota-owned-retry',{}, {signal:controller.signal}));
  reply(new Response(null,{status:429,headers:{'Retry-After':'0'}}));await turn();
  assert.equal(queue.waiters[0].priority,'interactive');assert.equal(queue.waiters[0].timer,null);
  controller.abort();await reader;assert.equal(queue.waiters[0].priority,'background');
  t.mock.timers.tick(10_000);await turn();assert.equal(queue.waiters.length,1);assert.equal(calls,1);
  t.mock.timers.tick(50_001);await background;assert.equal(calls,2);
});

test('a late background owner survives admission and job deadlines after foreground departure',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:80_000});
  const queue=new UpstreamQueue({maximum:1});sharedAdmission(t,queue);
  const release=await queue.acquire();let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({data:[]});});
  const foreground=assert.rejects(odp('/late-background-deadlines'),e=>e.code==='upstream_busy');await turn();
  assert.notEqual(queue.waiters[0].timer,null);
  const background=odp('/late-background-deadlines',{}, {priority:'background'});await turn();
  assert.equal(queue.waiters[0].backgroundOwner,true);assert.equal(queue.waiters[0].timer,null);
  t.mock.timers.tick(10_000);await foreground;
  t.mock.timers.tick(20_001);await turn();
  assert.equal(queue.waiters.length,1);assert.equal(queue.waiters[0].priority,'background');assert.equal(calls,0);
  release();await background;assert.equal(calls,1);
});

test('a late background owner retains queued work through another source cooldown',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:120_000});
  const queue=new UpstreamQueue({maximum:1});sharedAdmission(t,queue);
  const release=await queue.acquire();let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({data:[]});});
  const foreground=assert.rejects(odp('/late-background-cooldown'),e=>e.code==='upstream_busy');await turn();
  const background=odp('/late-background-cooldown',{}, {priority:'background'});await turn();
  queue.backoff(60);await foreground;release();
  t.mock.timers.tick(30_001);await turn();assert.equal(calls,0);assert.equal(queue.waiters.length,1);
  t.mock.timers.tick(29_999);await background;assert.equal(calls,1);
});

test('a late background owner upgrades retries while the original foreground reader stays bounded',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:200_000});
  const queue=new UpstreamQueue();sharedAdmission(t,queue);
  let reply,calls=0;
  t.mock.method(globalThis,'fetch',()=>++calls===1?new Promise(resolve=>reply=resolve):Promise.resolve(Response.json({data:[]})));
  const foreground=assert.rejects(odp('/late-background-retry'),e=>e.code==='upstream_busy');await turn();
  const background=odp('/late-background-retry',{}, {priority:'background'});await turn();
  reply(new Response(null,{status:429,headers:{'Retry-After':'60'}}));await foreground;await turn();
  assert.equal(calls,1);assert.equal(queue.waiters.length,1);
  t.mock.timers.tick(60_000);await background;assert.equal(calls,2);
});
