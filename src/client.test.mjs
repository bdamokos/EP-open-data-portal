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
