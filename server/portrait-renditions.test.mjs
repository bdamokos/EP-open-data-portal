import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {PortraitRenditions, portraitCard} from './portrait-renditions.mjs';
import {runWithRequestSignal} from './request-budget.mjs';

const image = (body = Buffer.from('original'), fetchedAt = 1000) => ({body, fetchedAt, memberId: 43,
  sourceUrl: 'https://www.europarl.europa.eu/mepphoto/43.jpg', contentType: 'image/jpeg'});
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};

test('card conversion reduces dimensions without cropping, retains provenance and never changes original bytes', async () => {
  const body = await sharp({create: {width: 1200, height: 1600, channels: 3, background: '#888'}}).jpeg().toBuffer();
  const original = image(body), saved = Buffer.from(body);
  const card = await new PortraitRenditions().get(original);
  const metadata = await sharp(card.body).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 480); assert.equal(metadata.height, 640);
  assert.equal(card.sourceUrl, original.sourceUrl); assert.equal(card.fetchedAt, original.fetchedAt);
  assert.equal(card.originalSha256.length, 64); assert.equal(card.rendition, 'card-v2');
  assert(card.body.length < body.length); assert.deepEqual(original.body, saved);
  const small = await sharp({create: {width: 60, height: 80, channels: 3, background: '#888'}}).jpeg().toBuffer();
  assert.equal((await sharp(await portraitCard(small)).metadata()).width, 60, 'small originals are never enlarged');
});

test('identical originals share conversion; source revalidation advances freshness and changed bytes invalidate it', async () => {
  const gate = deferred(), started = deferred(); let calls = 0;
  const cache = new PortraitRenditions({transform: async () => {calls++; started.resolve(); await gate.promise; return Buffer.from('webp');}});
  const jobs = Array.from({length: 10}, () => cache.get(image()));
  await started.promise; assert.equal(calls, 1); gate.resolve();
  const cards = await Promise.all(jobs);
  assert(cards.every(card => card.body === cards[0].body));
  const confirmed = await cache.get(image(undefined, 2000));
  assert.equal(calls, 1); assert.equal(confirmed.fetchedAt, 2000);
  await cache.get(image(Buffer.from('new original'))); assert.equal(calls, 2);
});

test('conversion admission is bounded and sequential; one cancelled reader does not cancel other readers', async () => {
  const gate = deferred(), started = deferred(); let active = 0, peak = 0;
  const cache = new PortraitRenditions({maxPending: 2, maxPendingBytes: 8, transform: async body => {
    peak = Math.max(peak, ++active); started.resolve(); await gate.promise; active--; return body;
  }});
  const controller = new AbortController();
  const cancelled = runWithRequestSignal(controller.signal, () => cache.get(image(Buffer.from('one'))));
  const survivor = cache.get(image(Buffer.from('one')));
  const second = cache.get(image(Buffer.from('two')));
  await started.promise;
  await assert.rejects(cache.get(image(Buffer.from('three'))), {status: 503, code: 'upstream_busy', retryAfter: 1});
  controller.abort(new Error('reader closed'));
  await assert.rejects(cancelled, /reader closed/);
  gate.resolve(); await Promise.all([survivor, second]);
  assert.equal(peak, 1); assert.equal(cache.pending.size, 0); assert.equal(cache.pendingBytes, 0);
  const bytes = new PortraitRenditions({maxPendingBytes: 2});
  await assert.rejects(bytes.get(image(Buffer.from('big'))), {code: 'upstream_busy'});
});

test('LRU bounds retained bytes and failures release the queue for a later request', async () => {
  let calls = 0;
  const cache = new PortraitRenditions({maxBytes: 5, maxEntries: 2, transform: async body => {calls++; return body;}});
  for (const text of ['aa', 'bb', 'aa', 'cc', 'aa']) await cache.get(image(Buffer.from(text)));
  assert.equal(calls, 3); assert.equal(cache.bytes, 4); assert.equal(cache.cache.size, 2);
  await cache.get(image(Buffer.from('bb'))); assert.equal(calls, 4);
  let fail = true;
  const recovery = new PortraitRenditions({transform: async () => {if (fail) throw new Error('invalid JPEG'); return Buffer.from('ok');}});
  await assert.rejects(recovery.get(image()), {status: 502, code: 'portrait_unavailable'});
  fail = false; assert.equal((await recovery.get(image())).body.toString(), 'ok');
  assert.equal(recovery.pendingBytes, 0);
});
