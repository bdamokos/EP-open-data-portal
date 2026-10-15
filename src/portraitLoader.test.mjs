import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortraitLoader, isManagedPortrait} from './portraitLoader.mjs';

const path = id => `/api/poc/portrait/${id}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
const image = () => new Response(new Blob(['portrait'], {type: 'image/jpeg'}));

test('only same-origin portrait paths enter the queue, including relative build URLs', async () => {
  const calls = [];
  const loader = createPortraitLoader({fetchImpl: async (url, options) => {calls.push({url, options}); return image();}});
  for (const url of [path(1), './api/poc/portrait/2', '././api/poc/portrait/3']) {
    assert.equal(isManagedPortrait(url), true);
    assert.equal((await loader.load(url)).type, 'image/jpeg');
  }
  for (const url of ['https://example.test/api/poc/portrait/1', '//example.test/api/poc/portrait/1', '/api/poc/document/E-1', '/api/poc/portrait/0', '/api/poc/portrait/1?url=other', '../api/poc/portrait/1']) {
    assert.equal(isManagedPortrait(url), false);
    await assert.rejects(loader.load(url), /Invalid portrait path/);
  }
  assert.deepEqual(calls.map(call => call.url), [path(1), path(2), path(3)]);
  assert.ok(calls.every(call => call.options.credentials === 'omit' && call.options.redirect === 'error'));
});

test('limits active portrait responses to three and consumes the body before releasing a slot', async () => {
  const reads = [], bodies = [];
  const loader = createPortraitLoader({fetchImpl: async url => {
    reads.push(url);
    const body = deferred(); bodies.push(body);
    return {ok: true, blob: () => body.promise};
  }});
  const pending = Array.from({length: 20}, (_, i) => loader.load(path(i + 1)));
  assert.equal(reads.length, 3);
  await tick(); assert.equal(reads.length, 3);
  for (let i = 0; i < pending.length; i++) {
    bodies[i].resolve(new Blob(['face']));
    await tick();
    assert.ok(reads.length <= i + 4);
  }
  assert.equal((await Promise.all(pending)).length, 20);
});

test('coalesces matching wall/author requests while allowing one consumer to cancel', async () => {
  const response = deferred(), cancelled = new AbortController();
  let calls = 0;
  const loader = createPortraitLoader({fetchImpl: () => {calls++; return response.promise;}});
  const first = loader.load('./api/poc/portrait/1', {signal: cancelled.signal});
  const second = loader.load(path(1));
  const rejected = assert.rejects(first, {name: 'AbortError'});
  cancelled.abort(); await rejected;
  response.resolve(image());
  assert.equal((await second).type, 'image/jpeg');
  assert.equal(calls, 1);
});

test('cancelled queued work never fetches and detached active work retains its slot', async () => {
  const response = deferred(), calls = [], active = new AbortController(), queued = new AbortController();
  const loader = createPortraitLoader({concurrency: 1, fetchImpl: url => {calls.push(url); return calls.length === 1 ? response.promise : Promise.resolve(image());}});
  const first = loader.load(path(1), {signal: active.signal});
  const second = loader.load(path(2), {signal: queued.signal});
  const firstRejection = assert.rejects(first, {name: 'AbortError'});
  const secondRejection = assert.rejects(second, {name: 'AbortError'});
  active.abort(); queued.abort();
  await Promise.all([firstRejection, secondRejection]);
  const third = loader.load(path(3));
  await tick(); assert.deepEqual(calls, [path(1)]);
  response.resolve(image()); await third;
  assert.deepEqual(calls, [path(1), path(3)]);
});

test('retries only temporary admission responses, honours Retry-After, and bounds attempts', async () => {
  const delays = [], statuses = [503, 429, 200];
  const loader = createPortraitLoader({fetchImpl: async () => new Response('body', {status: statuses.shift(), headers: {'Retry-After': '4'}}), wait: async ms => {delays.push(ms);}});
  await loader.load(path(1));
  assert.deepEqual(delays, [4000, 4000]);
  let calls = 0;
  const exhausted = createPortraitLoader({fetchImpl: async () => {calls++; return new Response('busy', {status: 503, headers: {'Retry-After': '500'}});}, wait: async ms => assert.equal(ms, 30000)});
  await assert.rejects(exhausted.load(path(1)), /503/);
  assert.equal(calls, 3);
  let upstreamCalls = 0;
  const upstream = createPortraitLoader({fetchImpl: async () => {upstreamCalls++; return new Response('too large', {status: 502});}});
  await assert.rejects(upstream.load(path(1)), /502/);
  assert.equal(upstreamCalls, 1);
});

test('does not retry detached consumers and recovers capacity after a network failure', async () => {
  const pause = deferred(), controller = new AbortController();
  let calls = 0;
  const loader = createPortraitLoader({concurrency: 1, fetchImpl: async () => {calls++; return calls === 1 ? new Response('busy', {status: 503}) : image();}, wait: () => pause.promise});
  const abandoned = loader.load(path(1), {signal: controller.signal});
  const rejection = assert.rejects(abandoned, {name: 'AbortError'});
  await tick(); controller.abort(); await rejection;
  const next = loader.load(path(2)); pause.resolve(); await next;
  assert.equal(calls, 2);
  const failed = createPortraitLoader({concurrency: 1, fetchImpl: async url => {if (url === path(1)) throw new Error('network'); return image();}});
  await assert.rejects(failed.load(path(1)), /network/);
  assert.equal((await failed.load(path(2))).type, 'image/jpeg');
});

test('bounds queued work and removes an aborted pending job from that bound', async () => {
  const response = deferred(), controller = new AbortController();
  const loader = createPortraitLoader({concurrency: 1, maxQueued: 1, fetchImpl: () => response.promise.then(value => value.clone())});
  const active = loader.load(path(1));
  const queued = loader.load(path(2), {signal: controller.signal});
  await assert.rejects(loader.load(path(3)), /queue is full/);
  const rejection = assert.rejects(queued, {name: 'AbortError'});
  controller.abort(); await rejection;
  const replacement = loader.load(path(3));
  response.resolve(image()); await Promise.all([active, replacement]);
});
