import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataClient } from './client.mjs';

test('deduplicates pending reads while preserving each route', async () => {
  const calls = [];
  const client = createDataClient(async route => { calls.push(route); await new Promise(r => setTimeout(r, 5)); return { route }; });
  const [a, b, c] = await Promise.all([client.get('latest/1?lang=en'), client.get('latest/1?lang=en'), client.get('latest/2?lang=en')]);
  assert.deepEqual(calls, ['latest/1?lang=en', 'latest/2?lang=en']);
  assert.equal(a, b); assert.notEqual(a, c);
});

test('retains saved rows during refresh and after a failed refresh', async () => {
  let fail = false;
  const client = createDataClient(async () => { if (fail) throw new Error('Unavailable'); return { items: ['saved'] }; });
  const saved = await client.get('activities'); fail = true;
  const refresh = client.get('activities', { force: true });
  assert.equal(client.peek('activities'), saved);
  await assert.rejects(refresh, /Unavailable/);
  assert.equal(client.peek('activities'), saved);
});

test('bounds a stalled request even when the loader ignores abort', async () => {
  const client = createDataClient(() => new Promise(() => {}), { timeoutFor: () => 10 });
  await assert.rejects(client.get('speech'), /took too long/);
  assert.equal(client.peek('speech'), null);
});

test('bounds the cache and clears data when access expires', async () => {
  let expired = false;
  const client = createDataClient(async route => { if (expired) throw Object.assign(new Error('Sign in'), { status: 401 }); return route; }, { maxEntries: 2 });
  await client.get('one'); await client.get('two'); await client.get('three');
  assert.equal(client.peek('one'), null);
  expired = true;
  await assert.rejects(client.get('three', { force: true }), /Sign in/);
  assert.equal(client.peek('three'), null);
});

test('a Following check can expire activity reads while retaining their visible content and unrelated reads',async()=>{
  let revision=1;const client=createDataClient(async()=>({revision}));
  const old=await client.get('latest-activities/1');await client.get('document/question');const speech=await client.get('speech/1');
  revision=2;client.expireMatching(route=>/^(document\/|latest-activities\/)/.test(route));
  assert.equal(client.peek('latest-activities/1'),old);assert.equal((await client.get('latest-activities/1')).revision,2);assert.equal((await client.get('document/question')).revision,2);assert.equal(await client.get('speech/1'),speech);
});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
test('invalidating an in-flight answer read replaces it for both existing and new callers',async()=>{
  const requests=[];
  const client=createDataClient((route,signal)=>{const request=deferred();requests.push({...request,signal});return request.promise;});
  const old=client.get('document/question');await Promise.resolve();
  client.expireMatching(route=>route.startsWith('document/'));
  const fresh=client.get('document/question');await Promise.resolve();assert.equal(requests.length,2);assert(requests[0].signal.aborted);
  requests[0].resolve({answers:[]});await Promise.resolve();
  assert.equal(client.get('document/question'),fresh,'the superseded completion must not remove its replacement');
  requests[1].resolve({answers:['new-answer']});
  assert.deepEqual(await old,{answers:['new-answer']});assert.deepEqual(await fresh,{answers:['new-answer']});assert.deepEqual(client.peek('document/question'),{answers:['new-answer']});
});
test('a superseded loader cannot overwrite fresh cached answers or clear them with a late access error',async()=>{
  const requests=[];const client=createDataClient(()=>{const request=deferred();requests.push(request);return request.promise;});
  const old=client.get('document/question');await Promise.resolve();client.expireMatching(()=>true);
  const fresh=client.get('document/question');await Promise.resolve();requests[1].resolve({answers:['fresh']});await fresh;await old;
  requests[0].reject(Object.assign(new Error('Expired'),{status:401}));await Promise.resolve();await Promise.resolve();
  assert.deepEqual(await client.get('document/question'),{answers:['fresh']});assert.equal(requests.length,2);
});

const pause=()=>new Promise(resolve=>setTimeout(resolve,15));
test('prefetch yields to foreground work, serializes batches and shares pending and cached reads',async()=>{
  const requests=[];
  const client=createDataClient((route,signal,options)=>{const request=deferred();requests.push({route,...request,...options});return request.promise;},{prefetchDelay:1});
  const foreground=client.get('current');
  const cancel=client.prefetch(['next','next','later']);
  const cancelOther=client.prefetch(['other']);
  await pause();assert.deepEqual(requests.map(r=>r.route),['current']);
  requests[0].resolve('current text');await foreground;
  await pause();assert.deepEqual(requests.map(r=>r.route),['current','next']);assert.equal(requests[1].priority,'low');
  const opened=client.get('next');await pause();assert.equal(requests.length,2,'opening a pending preload reuses the request');
  requests[1].resolve('next text');assert.equal(await opened,'next text');
  await pause();assert.equal(requests[2].route,'later');
  cancel();requests[2].resolve('later text');await pause();assert.equal(requests[3].route,'other');
  requests[3].resolve('other text');cancelOther();await pause();
  assert.equal(await client.get('next'),'next text');assert.equal(requests.length,4);
});
test('cancelled prefetches stop scheduling, and failed speculation leaves a real read retryable',async()=>{
  const requests=[];const client=createDataClient((route)=>{const request=deferred();requests.push({route,...request});return request.promise;},{prefetchDelay:1});
  const cancel=client.prefetch(['old-language','never']);await pause();cancel();
  requests[0].resolve('saved');await pause();assert.equal(requests.length,1);
  const cancelFailed=client.prefetch(['busy','also-never']);await pause();requests[1].reject(new Error('Busy'));
  await pause();assert.equal(requests.length,2);assert.equal(client.peek('busy'),null);
  const opened=client.get('busy');await Promise.resolve();requests[2].resolve('recovered');assert.equal(await opened,'recovered');
  cancelFailed();
});

// These transport tests exercise the same GET reader used by api(), including
// shared-client loading, deadlines and invalidation, without upstream traffic.
const {readJson,dataTimeoutFor}=await import('./client.mjs');
const response=(status,code='upstream_busy',retryAt=Date.now()+1000,header=null)=>({ok:status===200,status,headers:new Headers(header?{'Retry-After':header}:{}),json:async()=>status===200?{items:['ready']}:{error:{code,message:'Parliament requests are busy. Please try again.',retryAt}}});
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const clock=t=>{t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});return async ms=>{t.mock.timers.tick(ms);await flush();};};

test('route budgets distinguish upstream reads, extended routes and local projections',()=>{
  for(const route of ['document-context/A-10-2026-0237?lang=en','member-votes/197591?week=2026-10-05','decision-votes/MTG-PL-2026-10-07-DEC-197457?lang=en','member-attendance/197591?sittings=MTG-PL-2026-10-05'])assert.equal(dataTimeoutFor(route),35000,route);
  for(const route of ['directory?lang=en','speeches/1','activities/1','speech-statistics/1','speech/MTG','document/X','speech-media/X','references?ids=X','reference-summary?x=1','source-record?url=x','insights/speech-cloud?x=1','insights/procedure-context','insights/topic-trends','insights/legislation','insights/participation'])assert.equal(dataTimeoutFor(route),35000,route);
  for(const route of ['latest-activities/1','activity-index/status','corpus/status','corpus/search?q=x','corpus/text','speech-transcript/X','insights/speech-words','insights/saved','insights/following-status','insights/following-manifest','insights/following-member','insights/group-voices','outside/directory','amendments?x=1','motion-amendments/X'])assert.equal(dataTimeoutFor(route),8000,route);
  assert.equal(dataTimeoutFor('profile/1'),40000);assert.equal(dataTimeoutFor('speech-context/X'),60000);assert.equal(dataTimeoutFor('motion-comparison/X'),90000);
});

test('a shared GET stays pending through busy backoff then caches recovered data',async t=>{
  const tick=clock(t);let calls=0,settled=false;
  const client=createDataClient((route,signal)=>readJson(route,{signal,timeoutMs:35000,fetchImpl:async()=>response(++calls===1?503:200)}),{timeoutFor:()=>35000});
  const pending=client.get('speeches/1');pending.then(()=>{settled=true;});assert.equal(client.get('speeches/1'),pending);
  await flush();assert.equal(calls,1);assert.equal(client.peek('speeches/1'),null);
  await tick(999);assert.equal(calls,1);assert.equal(settled,false);
  await tick(1);assert.deepEqual(await pending,{items:['ready']});assert.equal(calls,2);assert(settled);
});

test('busy exhaustion stops after three attempts and preserves the service message and code',async t=>{
  const tick=clock(t);let calls=0;
  const read=readJson('x',{fetchImpl:async()=>{calls++;return response(503);}});
  const check=assert.rejects(read,e=>e.status===503&&e.code==='upstream_busy'&&e.retryAt===13000&&/Parliament requests/.test(e.message));
  await flush();await tick(1000);await tick(1000);await check;assert.equal(calls,3);
});

test('Retry-After supports seconds and HTTP dates, and the latest hint wins',async t=>{
  const tick=clock(t);
  for(const kind of ['seconds','date']) {
    const header=kind==='seconds'?'2':new Date(Date.now()+2000).toUTCString();
    let calls=0;const read=readJson('x',{fetchImpl:async()=>response(++calls===1?503:200,'odp_rate_limited',Date.now()+1000,header)});
    await flush();await tick(1000);assert.equal(calls,1);await tick(1000);await read;assert.equal(calls,2);
  }
});

test('long cooldowns, missing hints, permanent failures and speculative reads do not retry',async()=>{
  for(const [status,code,at,header,priority] of [[503,'upstream_busy',Date.now()+30000],[503,'odp_rate_limited',Date.now()+1000,'30'],[503,'upstream_busy',null],[503,'other',Date.now()+1000],[401,'upstream_busy',Date.now()+1000],[500,'internal_error',Date.now()+1000],[503,'upstream_busy',Date.now()+1000,null,'low']]) {
    let calls=0;await assert.rejects(readJson('x',{priority,fetchImpl:async()=>{calls++;return response(status,code,at,header);}}),e=>e.status===status&&e.code===code);assert.equal(calls,1);
  }
});

test('body Retry-After retries a request timeout but never retries network errors',async t=>{
  const tick=clock(t);let calls=0;
  const read=readJson('x',{fetchImpl:async()=>++calls===1?{ok:false,status:503,headers:new Headers(),json:async()=>({error:{code:'request_timeout',retryAfter:1}})}:response(200)});
  await flush();await tick(1000);await read;assert.equal(calls,2);
  await assert.rejects(readJson('x',{fetchImpl:async()=>{throw new Error('offline');}}),/offline/);
});

test('abort and invalidation cancel backoff without allowing a stale retry',async t=>{
  const tick=clock(t);let calls=0;const controller=new AbortController();
  const read=readJson('x',{signal:controller.signal,fetchImpl:async()=>{calls++;return response(503);}});
  const check=assert.rejects(read,/cancelled/);await flush();controller.abort(new Error('cancelled'));await check;await tick(2000);assert.equal(calls,1);
  let requestCalls=0;
  const client=createDataClient((route,signal)=>readJson(route,{signal,fetchImpl:async()=>response(++requestCalls===1?503:200)}));
  const old=client.get('x');await flush();client.expireMatching(()=>true);
  assert.deepEqual(await client.get('x'),{items:['ready']});assert.deepEqual(await old,{items:['ready']});await tick(2000);assert.equal(requestCalls,2);
});

test('one deadline covers all attempts and backoff, including direct api reads',async t=>{
  const tick=clock(t);let calls=0;
  const read=readJson('x',{timeoutMs:1500,fetchImpl:async()=>{calls++;return response(503);}});
  const check=assert.rejects(read,/took too long/);await flush();await tick(1000);await tick(500);await check;await tick(3000);assert.equal(calls,2);
});

test('a foreground reader joining a prefetch promotes both retry admission and the next fetch',async t=>{
  const tick=clock(t),first=deferred();let calls=0;const priorities=[];
  const client=createDataClient((route,signal,options)=>readJson(route,{signal,...options,fetchImpl:async(url,request)=>{
    priorities.push(request.priority);return ++calls===1?first.promise:response(200);
  }}),{prefetchDelay:1});
  const cancel=client.prefetch(['speech/context']);await tick(1);
  assert.equal(calls,1);assert.deepEqual(priorities,['low']);
  const foreground=client.get('speech/context');first.resolve(response(503));await flush();
  await tick(999);assert.equal(calls,1);
  await tick(1);assert.deepEqual(await foreground,{items:['ready']});
  assert.equal(calls,2);assert.deepEqual(priorities,['low','auto']);cancel();
});
