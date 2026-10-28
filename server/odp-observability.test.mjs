import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OdpObservations,odpRouteFamily,odpPacing} from './odp-observability.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';

test('quota observations retain route families, statuses and numeric hints without request identifiers',async t=>{
  let now=1000;const logs=[],statuses=[];
  const monitor=new OdpObservations({clock:()=>now,log:(...args)=>logs.push(args),queue:()=>({startsInWindow:12}),onResponse:s=>statuses.push(s)});
  t.mock.method(globalThis,'fetch',async()=>{now+=25;return new Response(null,{status:429,headers:{'Retry-After':'120','X-RateLimit-Remaining':'0','RateLimit-Limit':'secret','Set-Cookie':'secret'}});});
  await monitor.fetch('https://data.europarl.europa.eu/api/v2/speeches/PRIVATE-ID?lang=secret',{});
  const saved=monitor.snapshot();
  assert.equal(saved.starts,1);assert.equal(saved.statuses[429],1);assert.equal(saved.meanHeaderLatencyMs,25);
  assert.equal(saved.lastThrottle.retryAfterSeconds,120);assert.deepEqual(saved.lastThrottle.hints,{'x-ratelimit-remaining':0});
  assert.deepEqual(statuses,[429]);assert.equal(logs.length,1);
  assert(!JSON.stringify([saved,logs]).match(/PRIVATE-ID|secret|Set-Cookie/));
  assert.equal(odpRouteFamily('https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-10-20/decisions?offset=50'),'/meetings/{id}/decisions');
  assert.equal(odpRouteFamily('https://data.europarl.europa.eu/api/v2/unknown/secret'),'/other');
});

test('monitor records network failures and expires bounded minute buckets, without changing fetch errors',async t=>{
  let now=0;const monitor=new OdpObservations({clock:()=>now,log:()=>{}}),error=new Error('offline');
  t.mock.method(globalThis,'fetch',async()=>{throw error;});
  await assert.rejects(monitor.fetch('https://data.europarl.europa.eu/api/v2/meps'),e=>e===error);
  assert.equal(monitor.snapshot().networkErrors,1);
  now=60*60_000;assert.equal(monitor.snapshot().starts,0);assert.equal(monitor.buckets.size,1);
});

test('backfill smooths admission and adapts after throttling without raising the rolling ceiling',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const queue=new UpstreamQueue({...odpPacing('backfill'),rateLimit:{maximum:3,windowMs:5000,foregroundReserve:1}});
  const calls=[];await queue.run(()=>calls.push(Date.now()),{priority:'background'});
  const second=queue.run(()=>calls.push(Date.now()),{priority:'background'});
  t.mock.timers.tick(666);assert.equal(calls.length,1);t.mock.timers.tick(1);await second;
  queue.recordResponse(429);assert.equal(queue.interval,1001);
  queue.backoff(10);const third=queue.run(()=>calls.push(Date.now()),{priority:'background'});
  t.mock.timers.tick(9999);assert.equal(calls.length,2);t.mock.timers.tick(1);await third;
  assert.equal(calls.length,3);assert(queue.quotaSnapshot().startsInWindow<=3);
  for(let i=0;i<5000;i++)queue.recordResponse(200);
  assert.equal(queue.interval,667);
  assert.throws(()=>odpPacing('unlimited'));
  assert.equal(odpPacing('steady').interval,1500);
});
