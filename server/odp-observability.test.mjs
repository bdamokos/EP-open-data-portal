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
  assert.equal(monitor.snapshot().networkErrors,1);assert.deepEqual(monitor.snapshot().failureKinds,{other:1});
  now=60*60_000;const expired=monitor.snapshot();assert.equal(expired.starts,0);assert.equal(expired.networkErrors,0);
  assert.deepEqual(expired.failureKinds,{});assert.deepEqual(expired.routeFailures,{});assert.equal(monitor.buckets.size,1);
});

test('failed header waits retain sanitized runtime causes and elapsed time, preserving the original rejection',async t=>{
  let now=0;const monitor=new OdpObservations({clock:()=>now,log:()=>{}});
  const failures=[
    [new DOMException('PRIVATE-ID deadline','TimeoutError'),'transport-timeout',null],
    [Object.assign(new TypeError('fetch PRIVATE-ID'),{cause:Object.assign(new Error('PRIVATE-ID host'),{code:'UND_ERR_CONNECT_TIMEOUT'})}),'transport-timeout','UND_ERR_CONNECT_TIMEOUT'],
    [Object.assign(new TypeError('PRIVATE-ID'),{cause:{cause:{code:'ENOTFOUND',message:'PRIVATE-ID'}}}),'dns','ENOTFOUND'],
    [Object.assign(new Error('PRIVATE-ID'),{code:'ECONNRESET'}),'connection','ECONNRESET'],
    [Object.assign(new Error('PRIVATE-ID'),{code:'ERR_TLS_CERT_ALTNAME_INVALID'}),'tls','ERR_TLS_CERT_ALTNAME_INVALID'],
    [new DOMException('PRIVATE-ID','AbortError'),'aborted',null],
    [Object.assign(new Error('PRIVATE-ID'),{code:'PRIVATE-ID'}),'other',null],
  ];
  for(const [error,kind,code] of failures){
    t.mock.method(globalThis,'fetch',async()=>{now+=45_000;throw error;});
    await assert.rejects(monitor.fetch('https://data.europarl.europa.eu/api/v2/adopted-texts/PRIVATE-ID?secret=PRIVATE-ID'),e=>e===error);
    const snapshot=monitor.snapshot();assert.equal(snapshot.lastFailure.kind,kind);assert.equal(snapshot.lastFailure.code,code);
    assert.equal(snapshot.lastFailure.elapsedMs,45_000);assert.equal(snapshot.lastFailure.route,'/adopted-texts/{id}');
    assert.equal(snapshot.pendingHeaders.length,0);assert(!JSON.stringify(snapshot).includes('PRIVATE-ID'));
  }
  const saved=monitor.snapshot();assert.equal(saved.networkErrors,7);assert.equal(saved.meanFailureLatencyMs,45_000);assert.equal(saved.maxFailureLatencyMs,45_000);
  assert.equal(saved.routeFailures['/adopted-texts/{id}'].count,7);assert.equal(saved.routeFailures['/adopted-texts/{id}'].latencyMs,315_000);
  assert.equal(saved.failureKinds['transport-timeout'],2);assert.equal(saved.responses,0);assert.equal(saved.meanHeaderLatencyMs,null);
});

test('a combined signal distinguishes local reader deadlines and cancellation from a transport timeout',async t=>{
  let now=0;const monitor=new OdpObservations({clock:()=>now,log:()=>{}});
  for(const [reason,kind] of [[{code:'request_timeout'},'request-timeout'],[{code:'request_cancelled'},'request-cancelled'],[new DOMException('PRIVATE','TimeoutError'),'transport-timeout'],[{message:'PRIVATE'},'aborted']]) {
    const controller=new AbortController(),error=new TypeError('PRIVATE fetch rejection');
    t.mock.method(globalThis,'fetch',async(_url,options)=>{assert.equal(options.signal,controller.signal);now+=8000;controller.abort(reason);throw error;});
    await assert.rejects(monitor.fetch('https://data.europarl.europa.eu/api/v2/external-documents/PRIVATE',{signal:controller.signal}),e=>e===error);
    const saved=monitor.snapshot();assert.equal(saved.lastFailure.kind,kind);assert.equal(saved.lastFailure.signalAborted,true);
    assert(!JSON.stringify(saved).includes('PRIVATE'));
  }
  assert.deepEqual(monitor.snapshot().failureKinds,{'request-timeout':1,'request-cancelled':1,'transport-timeout':1,aborted:1});
});

test('pending header diagnostics are bounded and end at headers without reading or replacing the body',async t=>{
  let now=1000;const monitor=new OdpObservations({clock:()=>now,log:()=>{}}),releases=[];
  t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>releases.push(resolve)));
  const reads=Array.from({length:20},(_,i)=>monitor.fetch('https://data.europarl.europa.eu/api/v2/plenary-documents/PRIVATE-'+i));
  now+=8000;const pending=monitor.headerSnapshot();assert.equal(pending.pendingHeaders.length,16);assert.equal(pending.untrackedHeaders,4);
  assert(pending.pendingHeaders.every(wait=>wait.route==='/plenary-documents/{id}'&&wait.ageMs===8000));
  pending.pendingHeaders[0].route='mutated';assert.equal(monitor.headerSnapshot().pendingHeaders[0].route,'/plenary-documents/{id}');
  const response=new Response('retained body');for(const release of releases)release(response);
  const responses=await Promise.all(reads);assert(responses.every(value=>value===response));assert.equal(response.bodyUsed,false);
  assert.equal(await response.text(),'retained body');assert.deepEqual(monitor.headerSnapshot(),{pendingHeaders:[],untrackedHeaders:0,lastFailure:null});
  assert.equal(monitor.snapshot().responses,20);assert.equal(monitor.snapshot().meanHeaderLatencyMs,8000);
});

test('header failures are attributed at completion and remain separate from HTTP responses and body errors',async t=>{
  let now=59_000,rejectFetch;const monitor=new OdpObservations({clock:()=>now,log:()=>{}});
  t.mock.method(globalThis,'fetch',()=>new Promise((_resolve,reject)=>rejectFetch=reject));
  const failed=assert.rejects(monitor.fetch('https://data.europarl.europa.eu/api/v2/adopted-texts/PRIVATE'),/offline/);
  now=104_000;rejectFetch(Object.assign(new Error('offline'),{code:'UND_ERR_HEADERS_TIMEOUT'}));await failed;
  const bodyError=new Error('body failed');const response=new Response(new ReadableStream({start(controller){controller.error(bodyError);}}),{status:500});
  t.mock.method(globalThis,'fetch',async()=>{now+=100;return response;});
  assert.equal(await monitor.fetch('https://data.europarl.europa.eu/api/v2/meps'),response);await assert.rejects(response.text(),e=>e===bodyError);
  const saved=monitor.snapshot();assert.equal(saved.networkErrors,1);assert.equal(saved.statuses[500],1);assert.equal(saved.meanHeaderLatencyMs,100);
  assert.equal(saved.minutes[0].networkErrors,0);assert.equal(saved.minutes[1].networkErrors,1);assert.equal(saved.minutes[1].failureLatencyMs,45_000);
  saved.routeFailures['/adopted-texts/{id}'].kinds['transport-timeout']=100;assert.equal(monitor.snapshot().routeFailures['/adopted-texts/{id}'].kinds['transport-timeout'],1);
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
