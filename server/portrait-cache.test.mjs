import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {PortraitCache} from './portrait-cache.mjs';
import {UpstreamQueue} from './upstream-queue.mjs';
import {createPortraitLoader} from '../src/portraitLoader.mjs';

const source = id => `https://www.europarl.europa.eu/mepphoto/${id}.jpg`;
const jpeg = (body = 'test image') => new Response(body, {headers: {'content-type': 'image/jpeg'}});
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'portrait-cache-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}
async function diskBytes(directory) {
  let total = 0;
  for (const name of await readdir(directory)) total += (await stat(path.join(directory, name))).size;
  return total;
}

test('a restarted portrait endpoint uses the saved binary without profile or image upstream requests', async t => {
  const directory = await fixture(t);
  const moduleUrl = JSON.stringify(new URL('./odp.mjs', import.meta.url).href);
  const script = `let profiles=0,images=0;globalThis.fetch=async url=>{if(String(url).includes('/api/v2/')){profiles++;return new Response(JSON.stringify({data:[{identifier:'257043',givenName:'Test',familyName:'Member'}]}),{headers:{'content-type':'application/ld+json'}});}images++;return new Response('saved image',{headers:{'content-type':'image/jpeg'}});};const {odpPortrait}=await import(${moduleUrl});const image=await odpPortrait(257043);console.log(JSON.stringify({profiles,images,body:image.body.toString(),sourceUrl:image.sourceUrl,fetchedAt:image.fetchedAt}));`;
  const run = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: {...process.env, ODP_CACHE_DIR: directory}, encoding: 'utf8', timeout: 5000,
  }));
  const first = run(), restarted = run();
  assert.equal(first.profiles, 1); assert.equal(first.images, 1);
  assert.equal(restarted.profiles, 0); assert.equal(restarted.images, 0);
  assert.equal(restarted.body, 'saved image'); assert.equal(restarted.fetchedAt, first.fetchedAt);
  assert.equal(restarted.sourceUrl, source(257043));
  const file = await readFile(path.join(directory, 'portraits-v1', '257043.portrait'));
  const metadata = JSON.parse(file.subarray(4, 4 + file.readUInt32BE(0)).toString());
  assert.equal(metadata.memberId, 257043); assert.equal(metadata.contentType, 'image/jpeg');
  assert.equal(metadata.sha256.length, 64);
});

test('memory eviction reuses disk and concurrent callers share the profile lookup and download', async t => {
  const directory = await fixture(t); let sources = 0, downloads = 0;
  const cache = new PortraitCache({directory, maxMemoryEntries: 1, fetchImpl: async () => {downloads++; return jpeg();}});
  const lookup = id => {sources++; return source(id);};
  const images = await Promise.all(Array.from({length: 12}, () => cache.get(1, lookup)));
  assert(images.every(image => image === images[0])); assert.equal(sources, 1); assert.equal(downloads, 1);
  await cache.get(2, lookup); assert.equal(cache.memory.size, 1);
  await cache.get(1, lookup); assert.equal(sources, 2); assert.equal(downloads, 2);
  assert.equal(cache.memory.size, 1); assert.equal(cache.pending.size, 0); assert.equal(cache.refreshes.size, 0);
});

test('expired saved portraits return promptly and share one background refresh with original provenance', async t => {
  const directory = await fixture(t); let now = 1000, calls = 0;
  const delayed = deferred();
  const cache = new PortraitCache({directory, clock: () => now, freshMs: 100, fetchImpl: async () => ++calls === 1 ? jpeg('old') : delayed.promise});
  await cache.get(1, source); now = 1100;
  const saved = await cache.get(1, source);
  assert.equal(saved.body.toString(), 'old'); assert.equal(saved.fetchedAt, 1000);
  await Promise.all(Array.from({length: 10}, () => cache.get(1, source)));
  assert.equal(calls, 2); assert.equal(cache.refreshes.size, 1);
  const refresh = cache.refreshes.get(1); delayed.resolve(jpeg('new')); await refresh;
  const updated = await cache.get(1, source);
  assert.equal(updated.body.toString(), 'new'); assert.equal(updated.fetchedAt, 1100);
  assert.equal((await new PortraitCache({directory, clock: () => now}).get(1, () => assert.fail('fresh disk must avoid upstream'))).body.toString(), 'new');
});

test('an unchanged portrait is revalidated without a download and a changed one is replaced', async t => {
  const directory = await fixture(t); let now = 1000; const requests = [];
  const validators = {etag: '"6698ce1a-1e9e2"', 'last-modified': 'Thu, 18 Jul 2024 08:11:06 GMT'};
  const replies = [
    () => new Response('original', {headers: {'content-type': 'image/jpeg', ...validators}}),
    () => new Response(null, {status: 304, headers: validators}),
    () => new Response('changed', {headers: {'content-type': 'image/jpeg', etag: '"new"'}}),
  ];
  const fetchImpl = async (url, {headers}) => {requests.push(headers); return replies.shift()();};
  const cache = new PortraitCache({directory, clock: () => now, freshMs: 100, fetchImpl});
  await cache.get(1, source);
  assert.equal(requests[0]['If-None-Match'], undefined);
  now = 1100; await cache.get(1, source); await cache.refreshes.get(1);
  assert.equal(requests[1]['If-None-Match'], validators.etag);
  assert.equal(requests[1]['If-Modified-Since'], validators['last-modified']);
  // A restart keeps the confirmed copy, its validators and the confirmation time.
  const restarted = new PortraitCache({directory, clock: () => now, freshMs: 100, fetchImpl});
  const confirmed = await restarted.get(1, source);
  assert.equal(confirmed.body.toString(), 'original'); assert.equal(confirmed.fetchedAt, 1100);
  assert.equal(confirmed.etag, validators.etag);
  now = 1200; await restarted.get(1, source); await restarted.refreshes.get(1);
  const replaced = await restarted.get(1, source);
  assert.equal(replaced.body.toString(), 'changed'); assert.equal(replaced.etag, '"new"');
  assert.equal(replaced.lastModified, null); assert.equal(requests.length, 3);
});

test('a 304 naming a different entity tag is not taken as confirmation of the saved image', async t => {
  const directory = await fixture(t); let now = 1000; const requests = [];
  const replies = [
    () => new Response('original', {headers: {'content-type': 'image/jpeg', etag: '"a"'}}),
    () => new Response(null, {status: 304, headers: {etag: '"b"'}}),
    () => new Response('current', {headers: {'content-type': 'image/jpeg', etag: '"b"'}}),
  ];
  const cache = new PortraitCache({directory, clock: () => now, freshMs: 100,
    fetchImpl: async (url, {headers}) => {requests.push(headers); return replies.shift()();}});
  await cache.get(1, source); now = 1100; await cache.get(1, source); await cache.refreshes.get(1);
  const image = await cache.get(1, source);
  assert.equal(image.body.toString(), 'current'); assert.equal(image.etag, '"b"');
  assert.equal(requests[2]['If-None-Match'], undefined); assert.equal(requests.length, 3);
});

test('saved validators outside the HTTP grammar are dropped instead of being sent', async t => {
  const directory = await fixture(t);
  await new PortraitCache({directory, fetchImpl: async () => jpeg()}).get(1, source);
  const name = path.join(directory, '1.portrait'), file = await readFile(name), length = file.readUInt32BE(0);
  const header = {...JSON.parse(file.subarray(4, 4 + length).toString()), etag: '"a\u0000b"', lastModified: 'not a date'};
  const encoded = Buffer.from(JSON.stringify(header)), prefix = Buffer.alloc(4); prefix.writeUInt32BE(encoded.length);
  await writeFile(name, Buffer.concat([prefix, encoded, file.subarray(4 + length)]));
  const image = await new PortraitCache({directory, fetchImpl: () => assert.fail('saved image is fresh')}).get(1, source);
  assert.equal(image.etag, null); assert.equal(image.lastModified, null);
});

test('a 304 without a saved validated copy is not treated as an image', async t => {
  const directory = await fixture(t); let calls = 0;
  const cache = new PortraitCache({directory, fetchImpl: async () => {calls++; return new Response(null, {status: 304});}});
  await assert.rejects(cache.get(1, source), {code: 'portrait_unavailable'});
  assert.equal(calls, 1); assert.deepEqual(await readdir(directory), []);
});

test('failed refresh retains the saved image and timestamp and backs off upstream retries', async t => {
  const directory = await fixture(t); let now = 1000, calls = 0;
  const cache = new PortraitCache({directory, clock: () => now, freshMs: 100, retryMs: 500,
    fetchImpl: async () => ++calls === 1 ? jpeg('retained') : new Response('unavailable', {status: 503})});
  const first = await cache.get(1, source); now = 1100;
  assert.equal((await cache.get(1, source)).fetchedAt, first.fetchedAt);
  await cache.refreshes.get(1)?.catch(() => {});
  for (let i = 0; i < 10; i++) assert.equal((await cache.get(1, source)).body.toString(), 'retained');
  assert.equal(calls, 2);
  now = 1600; await cache.get(1, source); await cache.refreshes.get(1)?.catch(() => {});
  assert.equal(calls, 3);
  const restarted = new PortraitCache({directory, clock: () => 1050, fetchImpl: () => assert.fail('retained file is intact')});
  assert.equal((await restarted.get(1, source)).fetchedAt, first.fetchedAt);
});

test('a stale wall burst bounds background work and leaves an upstream slot for interactive text', async () => {
  let now = 1000;
  const cache = new PortraitCache({directory: null, clock: () => now, freshMs: 100,
    maxBackground: 2, maxBackgroundQueued: 4, fetchImpl: async () => jpeg('saved')});
  const ids = Array.from({length: 24}, (_, i) => i + 1);
  await Promise.all(ids.map(id => cache.get(id, source)));
  now = 1100;
  const upstream = new UpstreamQueue({interval: 0}), delayed = deferred(), priorities = [];
  const resolveSource = async (id, {priority}) => {
    priorities.push(priority);
    const release = await upstream.acquire(priority);
    try { await delayed.promise; return source(id); } finally { release(); }
  };
  const loader = createPortraitLoader({concurrency: 3, fetchImpl: async url => {
    const image = await cache.get(Number(url.split('/').at(-1)), resolveSource);
    return new Response(image.body, {headers: {'content-type': image.contentType}});
  }});
  const images = await Promise.all(ids.map(id => loader.load(`/api/portrait/${id}`)));
  assert(images.every(image => image.size === 5), 'all stale images return while refreshes are blocked');
  assert.equal(cache.refreshes.size, 2); assert.equal(cache.backgroundQueue.size, 4);
  assert.deepEqual(priorities, ['background', 'background']);
  assert.equal(upstream.background, 1);
  const releaseText = await upstream.acquire('interactive');
  assert.equal(upstream.active, 2, 'text starts beside the one active background profile read');
  releaseText(); delayed.resolve();
  while (cache.backgroundActive || cache.backgroundQueue.size) {
    await Promise.all([...cache.refreshes.values()]);
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(priorities.length, 6, 'overflow is retained without unbounded refresh fan-out');
  assert(priorities.every(priority => priority === 'background'));
  assert.equal((await cache.get(24, resolveSource)).fetchedAt, 1000);
  await cache.refreshes.get(24);
  assert.equal((await cache.get(24, resolveSource)).fetchedAt, 1100, 'a later visit can schedule overflow');
  assert.equal(cache.backgroundActive, 0); assert.equal(upstream.active, 0);
});

test('cold failures are not saved and repeated requests respect the bounded retry delay', async t => {
  const directory = await fixture(t); let calls = 0, now = 1000;
  const cache = new PortraitCache({directory, clock: () => now, retryMs: 100, fetchImpl: async () => {calls++; return new Response('', {status: 404});}});
  for (let i = 0; i < 3; i++) await assert.rejects(cache.get(1, source), {code: 'portrait_unavailable'});
  assert.equal(calls, 1); assert.equal(await diskBytes(directory), 0);
  now = 1100; await assert.rejects(cache.get(1, source)); assert.equal(calls, 2);
  assert.equal(cache.pending.size, 0); assert.equal(cache.refreshes.size, 0);
});

test('parallel writes enforce disk byte and entry budgets and startup prunes an oversized old cache', async t => {
  const directory = await fixture(t); let now = 1000;
  const cache = new PortraitCache({directory, clock: () => now++, maxDiskBytes: 1050, maxDiskEntries: 2,
    maxMemoryBytes: 30, fetchImpl: async () => jpeg('x'.repeat(100))});
  await Promise.all([1, 2, 3, 4, 5].map(id => cache.get(id, source)));
  assert(await diskBytes(directory) <= 1050); assert(cache.files.size <= 2); assert(cache.memoryBytes <= 30);
  assert(!(await readdir(directory)).some(name => name.endsWith('.tmp')));
  const restarted = new PortraitCache({directory, maxDiskBytes: 400, maxDiskEntries: 1, fetchImpl: async () => jpeg('small')});
  await restarted.initialize();
  assert(await diskBytes(directory) <= 400); assert(restarted.files.size <= 1);
});

test('unrelated files survive cache pruning and abandoned writes are removed', async t => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, 'keep.json'), 'unrelated');
  await writeFile(path.join(directory, '.1.00000000-0000-0000-0000-000000000000.tmp'), 'interrupted');
  const cache = new PortraitCache({directory, maxDiskBytes: 0, fetchImpl: async () => jpeg()});
  await cache.get(1, source);
  assert.deepEqual(await readdir(directory), ['keep.json']);
});

test('corrupt saved bytes are rejected and replaced using the validated source', async t => {
  const directory = await fixture(t);
  await new PortraitCache({directory, fetchImpl: async () => jpeg('first')}).get(1, source);
  const filename = path.join(directory, '1.portrait');
  const bytes = await readFile(filename); bytes[bytes.length - 1] ^= 1; await writeFile(filename, bytes);
  let calls = 0;
  const cache = new PortraitCache({directory, fetchImpl: async () => {calls++; return jpeg('replacement');}});
  assert.equal((await cache.get(1, source)).body.toString(), 'replacement'); assert.equal(calls, 1);
  assert.equal((await new PortraitCache({directory}).get(1, () => assert.fail('replacement is persisted'))).body.toString(), 'replacement');
});

test('an unavailable cache directory warns once and keeps bounded memory caching working', async t => {
  const root = await fixture(t), directory = path.join(root, 'file'); await writeFile(directory, 'not a directory');
  let calls = 0; const warnings = [];
  const cache = new PortraitCache({directory, warn: message => warnings.push(message), fetchImpl: async () => {calls++; return jpeg();}});
  await cache.get(1, source); await cache.get(1, source); await cache.get(2, source);
  assert.equal(calls, 2); assert.equal(warnings.length, 1); assert.equal(cache.memory.size, 2);
});

test('a failed atomic replacement preserves the previously saved file', async t => {
  if (process.getuid?.() === 0) return t.skip('root bypasses directory write permissions');
  const directory = await fixture(t); let now = 1000, calls = 0; const warnings = [];
  const cache = new PortraitCache({directory, clock: () => now, freshMs: 100, warn: message => warnings.push(message),
    fetchImpl: async () => jpeg(++calls === 1 ? 'original' : 'refreshed')});
  await cache.get(1, source);
  const before = await readFile(path.join(directory, '1.portrait'));
  await chmod(directory, 0o500);
  try {
    now = 1100; await cache.get(1, source); await cache.refreshes.get(1);
    assert.equal((await cache.get(1, source)).body.toString(), 'refreshed');
    assert.deepEqual(await readFile(path.join(directory, '1.portrait')), before);
    assert.equal(warnings.length, 1);
  } finally { await chmod(directory, 0o700); }
});

test('download rejects non-images, empty responses, declared and streamed oversized images without persisting them', async t => {
  const directory = await fixture(t), limit = 2 * 1024 * 1024;
  let cancelled = 0, pulled = 0;
  const responses = [
    new Response('<html>', {headers: {'content-type': 'text/html'}}), jpeg(''),
    new Response('small', {headers: {'content-type': 'image/jpeg', 'content-length': String(limit + 1)}}),
    new Response(new ReadableStream({pull(controller) {pulled++; controller.enqueue(new Uint8Array(1024 * 1024));}, cancel() {cancelled++;}}), {headers: {'content-type': 'image/jpeg'}}),
  ];
  const cache = new PortraitCache({directory, fetchImpl: async () => responses.shift()});
  for (const id of [1, 2]) await assert.rejects(cache.get(id, source), {code: 'portrait_unavailable'});
  for (const id of [3, 4]) await assert.rejects(cache.get(id, source), {code: 'portrait_size'});
  assert.equal(cancelled, 1); assert(pulled <= 4); assert.equal(cache.memory.size, 0); assert.equal(await diskBytes(directory), 0);
});

test('invalid member and upstream identities never make an upstream request', async () => {
  const cache = new PortraitCache({directory: null, fetchImpl: () => assert.fail('invalid source fetched')});
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '../1']) await assert.rejects(cache.get(id, source), {code: 'invalid_id'});
  for (const [i, url] of ['https://other.test/mepphoto/1.jpg', 'https://www.europarl.europa.eu/mepphoto/1.jpg?url=other', 'https://user@www.europarl.europa.eu/mepphoto/1.jpg', 'https://www.europarl.europa.eu/other/1.jpg'].entries())
    await assert.rejects(cache.get(i + 1, () => url), {code: 'portrait_unavailable'});
});
