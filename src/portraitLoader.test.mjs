import test from 'node:test';
import {versionedApiUrl} from '../server/api-version.mjs';
import assert from 'node:assert/strict';
import {createPortraitLoader, isManagedPortrait} from './portraitLoader.mjs';

const fetchedPath = id => versionedApiUrl(path(id));
const path = id => `/api/portrait/${id}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
const image = () => new Response(new Blob(['portrait'], {type: 'image/jpeg'}));
const flush = async () => {for (let i = 0; i < 10; i++) await tick();};

function clock() {
  let time = 0;
  const timers = [];
  return {
    now: () => time,
    wait: ms => new Promise(resolve => timers.push({at: time + ms, resolve})),
    async advance(ms, afterWake) {
      const end = time + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > end) break;
        time = timers[0].at;
        const due = timers.filter(timer => timer.at <= time);
        for (const timer of due) {timers.splice(timers.indexOf(timer), 1); timer.resolve();}
        afterWake?.(); afterWake = null;
        await flush();
      }
      time = end;
      await flush();
    },
  };
}

test('an eager batch leaves room for a profile read when cached portraits respond immediately', async () => {
  const time = clock(), calls = [];
  // A small synthetic shared admission bucket; this is not a deployed limit.
  let tokens = 8, refreshed = 0;
  const gateway = async url => {
    tokens = Math.min(8, tokens + (time.now() - refreshed) * 0.006); refreshed = time.now();
    calls.push({url, at: time.now()});
    if (tokens < 1) return new Response('limited', {status: 429, headers: {'Retry-After': '2'}});
    tokens--;
    return image();
  };
  const loader = createPortraitLoader({...time, fetchImpl: gateway});
  const pending = Array.from({length: 18}, (_, i) => loader.load(path(i + 1)));
  await flush();
  assert.equal(calls.length, 3, 'fast cached bodies must not drain the whole eager batch at once');
  assert.equal((await gateway('/api/profile/1')).status, 200);
  await time.advance(5_000);
  await Promise.all(pending);
  assert.equal(calls.filter(call => call.url.includes('/portrait/')).length, 18);
});

test('paces starts after the initial three without accumulating an unlimited idle burst', async () => {
  const time = clock(), calls = [];
  const loader = createPortraitLoader({...time, fetchImpl: async url => {calls.push({url, at: time.now()}); return image();}});
  const pending = Array.from({length: 6}, (_, i) => loader.load(path(i + 1)));
  await flush(); assert.equal(calls.length, 3);
  await time.advance(249); assert.equal(calls.length, 3);
  await time.advance(1); assert.equal(calls.length, 4);
  await time.advance(500); await Promise.all(pending);
  assert.deepEqual(calls.map(call => call.at), [0, 0, 0, 250, 500, 750]);
  await time.advance(60_000);
  const later = Array.from({length: 4}, (_, i) => loader.load(path(i + 10)));
  await flush(); assert.equal(calls.length, 9, 'idle credit is capped at three starts');
  await time.advance(250); await Promise.all(later);
});

test('one rate response pauses all portrait starts and resumes them without a retry burst', async () => {
  const time = clock(), calls = [], busy = deferred();
  const loader = createPortraitLoader({...time, fetchImpl: async url => {
    calls.push({url, at: time.now()});
    return url === fetchedPath(1) && calls.filter(call => call.url === fetchedPath(1)).length === 1 ? busy.promise : image();
  }});
  const pending = Array.from({length: 8}, (_, i) => loader.load(path(i + 1)));
  busy.resolve(new Response('limited', {status: 429, headers: {'Retry-After': '4'}}));
  await flush();
  await time.advance(3_999); assert.equal(calls.length, 3, 'other portraits must respect the shared cooldown');
  await time.advance(1); assert.equal(calls.length, 4, 'only one start is admitted when the cooldown ends');
  await time.advance(2_000); await Promise.all(pending);
  const resumed = calls.slice(3).map(call => call.at);
  assert.equal(resumed[0], 4_000);
  assert(resumed.every((at, index) => !index || at - resumed[index - 1] >= 250));
});

test('a pacing wake cannot start a request after a simultaneous response establishes cooldown', async () => {
  const time = clock(), first = deferred(), events = [];
  let firstAttempt = true;
  const loader = createPortraitLoader({...time, fetchImpl: url => {
    events.push({kind: 'fetch', url, at: time.now()});
    if (url === fetchedPath(1) && firstAttempt) {firstAttempt = false; return first.promise;}
    return Promise.resolve(image());
  }});
  const pending = Array.from({length: 5}, (_, i) => loader.load(path(i + 1)));
  await flush();
  // Resolve a pacing timer and an active response in the same turn, before
  // their promise continuations run. Admission and dispatch must stay atomic.
  await time.advance(250, () => first.resolve({ok: false, status: 429,
    headers: {get: () => {events.push({kind: 'cooldown', at: time.now()}); return '2';}},
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
  const limitedAt = events.findIndex(event => event.kind === 'cooldown');
  assert(limitedAt >= 0);
  assert(events.slice(limitedAt + 1).every(event => event.kind !== 'fetch'), 'no fetch may follow the rate response before its deadline');
  await time.advance(3_000); await Promise.all(pending);
  assert(events.slice(limitedAt + 1).filter(event => event.kind === 'fetch').every(event => event.at >= 2_250));
});

test('a detached response still protects the queue and honours an HTTP-date cooldown', async () => {
  const time = clock(), response = deferred(), controller = new AbortController(), calls = [];
  const loader = createPortraitLoader({...time, concurrency: 1, fetchImpl: async url => {calls.push({url, at: time.now()}); return url === fetchedPath(1) ? response.promise : image();}});
  const abandoned = loader.load(path(1), {signal: controller.signal});
  const rejection = assert.rejects(abandoned, {name: 'AbortError'});
  controller.abort(); await rejection;
  response.resolve(new Response('busy', {status: 503, headers: {'Retry-After': new Date(5_000).toUTCString()}}));
  const next = loader.load(path(2)); await flush();
  await time.advance(4_999); assert.equal(calls.length, 1);
  await time.advance(1); await next;
  assert.deepEqual(calls.map(call => call.at), [0, 5_000]);
});

test('cancelled paced work never fetches and does not block the remaining portrait', async () => {
  const time = clock(), calls = [], controllers = Array.from({length: 6}, () => new AbortController());
  const loader = createPortraitLoader({...time, fetchImpl: async url => {calls.push(url); return image();}});
  const pending = controllers.map((controller, i) => loader.load(path(i + 1), {signal: controller.signal}));
  const settled = Promise.allSettled(pending);
  await flush(); assert.equal(calls.length, 3);
  controllers[3].abort(); controllers[4].abort();
  await time.advance(1_000);
  const results = await settled;
  assert.deepEqual(calls, [fetchedPath(1), fetchedPath(2), fetchedPath(3), fetchedPath(6)]);
  assert.equal(results[3].reason.name, 'AbortError');
  assert.equal(results[4].reason.name, 'AbortError');
  assert.equal(results[5].status, 'fulfilled');
});

test('exhausting one portrait retry budget does not release the queue before its last cooldown', async () => {
  const time = clock(), calls = [];
  const loader = createPortraitLoader({...time, concurrency: 1, fetchImpl: async url => {
    calls.push({url, at: time.now()});
    return url === fetchedPath(1) ? new Response('limited', {status: 429, headers: {'Retry-After': '2'}}) : image();
  }});
  const rejection = assert.rejects(loader.load(path(1)), /429/);
  await flush(); await time.advance(4_000); await rejection;
  const next = loader.load(path(2));
  await time.advance(1_999); assert.equal(calls.length, 3);
  await time.advance(1); await next;
  assert.deepEqual(calls.map(call => call.at), [0, 2_000, 4_000, 6_000]);
});

test('only same-origin portrait paths enter the queue, including relative build URLs', async () => {
  const calls = [];
  const loader = createPortraitLoader({startInterval: 0, fetchImpl: async (url, options) => {calls.push({url, options}); return image();}});
  for (const url of [path(1), './api/portrait/2', '././api/portrait/3']) {
    assert.equal(isManagedPortrait(url), true);
    assert.equal((await loader.load(url)).type, 'image/jpeg');
  }
  for (const url of ['https://example.test/api/portrait/1', '//example.test/api/portrait/1', '/api/document/E-1', '/api/poc/portrait/1', '/api/portrait/0', '/api/portrait/1?url=other', '../api/portrait/1']) {
    assert.equal(isManagedPortrait(url), false);
    await assert.rejects(loader.load(url), /Invalid portrait path/);
  }
  assert.deepEqual(calls.map(call => call.url), [fetchedPath(1), fetchedPath(2), fetchedPath(3)]);
  assert.ok(calls.every(call => call.options.credentials === 'omit' && call.options.redirect === 'error'));
});

test('limits active portrait responses to three and consumes the body before releasing a slot', async () => {
  const reads = [], bodies = [];
  const loader = createPortraitLoader({startInterval: 0, fetchImpl: async url => {
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
  const loader = createPortraitLoader({startInterval: 0, fetchImpl: () => {calls++; return response.promise;}});
  const first = loader.load('./api/portrait/1', {signal: cancelled.signal});
  const second = loader.load(path(1));
  const rejected = assert.rejects(first, {name: 'AbortError'});
  cancelled.abort(); await rejected;
  response.resolve(image());
  assert.equal((await second).type, 'image/jpeg');
  assert.equal(calls, 1);
});

test('cancelled queued work never fetches and detached active work retains its slot', async () => {
  const response = deferred(), calls = [], active = new AbortController(), queued = new AbortController();
  const loader = createPortraitLoader({startInterval: 0, concurrency: 1, fetchImpl: url => {calls.push(url); return calls.length === 1 ? response.promise : Promise.resolve(image());}});
  const first = loader.load(path(1), {signal: active.signal});
  const second = loader.load(path(2), {signal: queued.signal});
  const firstRejection = assert.rejects(first, {name: 'AbortError'});
  const secondRejection = assert.rejects(second, {name: 'AbortError'});
  active.abort(); queued.abort();
  await Promise.all([firstRejection, secondRejection]);
  const third = loader.load(path(3));
  await tick(); assert.deepEqual(calls, [fetchedPath(1)]);
  response.resolve(image()); await third;
  assert.deepEqual(calls, [fetchedPath(1), fetchedPath(3)]);
});

test('retries only temporary admission responses, honours Retry-After, and bounds attempts', async () => {
  const time = clock();
  const delays = [], statuses = [503, 429, 200];
  const loader = createPortraitLoader({...time, startInterval: 0, fetchImpl: async () => new Response('body', {status: statuses.shift(), headers: {'Retry-After': '4'}}), wait: ms => {delays.push(ms); return time.wait(ms);}});
  const pending = loader.load(path(1));
  await flush(); await time.advance(8_000); await pending;
  assert.deepEqual(delays, [4000, 4000]);
  const long = clock(), chunks = [];
  let calls = 0;
  const exhausted = createPortraitLoader({...long, startInterval: 0, fetchImpl: async () => {calls++; return new Response('busy', {status: 503, headers: {'Retry-After': '500'}});}, wait: ms => {chunks.push(ms); return long.wait(ms);}});
  const rejection = assert.rejects(exhausted.load(path(1)), /503/);
  await flush(); await long.advance(1_000_000); await rejection;
  assert.equal(calls, 3);
  assert(chunks.every(ms => ms <= 30_000));
  assert.equal(chunks.reduce((sum, ms) => sum + ms, 0), 1_000_000, 'bounded waits must not shorten Retry-After');
  let upstreamCalls = 0;
  const upstream = createPortraitLoader({fetchImpl: async () => {upstreamCalls++; return new Response('too large', {status: 502});}});
  await assert.rejects(upstream.load(path(1)), /502/);
  assert.equal(upstreamCalls, 1);
});

test('does not retry detached consumers and recovers capacity after a network failure', async () => {
  const time = clock(), controller = new AbortController();
  let calls = 0;
  const loader = createPortraitLoader({...time, concurrency: 1, fetchImpl: async () => {calls++; return calls === 1 ? new Response('busy', {status: 503}) : image();}});
  const abandoned = loader.load(path(1), {signal: controller.signal});
  const rejection = assert.rejects(abandoned, {name: 'AbortError'});
  await flush(); controller.abort(); await rejection;
  const next = loader.load(path(2)); await time.advance(2000); await next;
  assert.equal(calls, 2);
  const failed = createPortraitLoader({concurrency: 1, fetchImpl: async url => {if (url === fetchedPath(1)) throw new Error('network'); return image();}});
  await assert.rejects(failed.load(path(1)), /network/);
  assert.equal((await failed.load(path(2))).type, 'image/jpeg');
});

test('bounds queued work and removes an aborted pending job from that bound', async () => {
  const response = deferred(), controller = new AbortController();
  const loader = createPortraitLoader({startInterval: 0, concurrency: 1, maxQueued: 1, fetchImpl: () => response.promise.then(value => value.clone())});
  const active = loader.load(path(1));
  const queued = loader.load(path(2), {signal: controller.signal});
  await assert.rejects(loader.load(path(3)), /queue is full/);
  const rejection = assert.rejects(queued, {name: 'AbortError'});
  controller.abort(); await rejection;
  const replacement = loader.load(path(3));
  response.resolve(image()); await Promise.all([active, replacement]);
});
