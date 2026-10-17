import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('HTTP reads, conditional responses and failures preserve the intended browser/CDN policy', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'response-cache-http-'));
  const originalFetch = globalThis.fetch;
  const previousDirectory = process.env.ODP_CACHE_DIR;
  process.env.ODP_CACHE_DIR = directory;
  let profileLoads = 0, imageLoads = 0;
  globalThis.fetch = async value => {
    const url = new URL(value);
    if (url.origin === 'https://data.europarl.europa.eu' && url.pathname === '/api/v2/meps/43') {
      profileLoads++;
      return new Response(JSON.stringify({data: [{identifier: '43', givenName: 'Public', familyName: 'Member'}]}), {headers: {'content-type': 'application/ld+json'}});
    }
    if (url.href === 'https://www.europarl.europa.eu/mepphoto/43.jpg') {
      imageLoads++;
      return new Response('fixture portrait', {headers: {'content-type': 'image/jpeg'}});
    }
    assert.fail(`Unexpected upstream request: ${url}`);
  };
  const {server} = await import('./index.mjs');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    if (previousDirectory === undefined) delete process.env.ODP_CACHE_DIR;
    else process.env.ODP_CACHE_DIR = previousDirectory;
    await rm(directory, {recursive: true, force: true});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (url, options) => originalFetch(base + url, options);
  const assertNoStore = response => {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  };

  const first = await get('/api/poc/profile/43?lang=en');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'public, max-age=0');
  assert.equal(first.headers.get('cdn-cache-control'), 'public, max-age=21600, stale-if-error=0');
  assert.equal(first.headers.get('vary'), 'Origin');
  const body = await first.json();
  assert.equal(body.id, 43);
  assert(body.fetchedAt);
  const unchanged = await get('/api/poc/profile/43?lang=en', {headers: {'If-None-Match': first.headers.get('etag')}});
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.headers.get('cdn-cache-control'), first.headers.get('cdn-cache-control'));
  assert.equal(await unchanged.text(), '');
  const head = await get('/api/poc/profile/43?lang=hu', {method: 'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('cdn-cache-control'), first.headers.get('cdn-cache-control'));
  assert.equal(await head.text(), '');
  assert.equal(profileLoads, 1);

  const portrait = await get('/api/poc/portrait/43');
  assert.equal(portrait.status, 200);
  assert.equal(portrait.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(portrait.headers.get('vary'), 'Origin');
  assert.match(portrait.headers.get('cdn-cache-control'), /^public, max-age=604\d{3}, stale-if-error=0$/);
  assert.equal(await portrait.text(), 'fixture portrait');
  const sameImage = await get('/api/poc/portrait/43', {headers: {'If-None-Match': portrait.headers.get('etag')}});
  assert.equal(sameImage.status, 304);
  assert.equal(sameImage.headers.get('vary'), 'Origin');
  assert(sameImage.headers.get('cdn-cache-control').startsWith('public,'));
  assert.equal(await sameImage.text(), '');
  assert.equal(imageLoads, 1);

  const bad = await get('/api/poc/profile/43?unknown=1');
  assert.equal(bad.status, 400);
  assertNoStore(bad);
  await bad.text();
  const repeatedBad = await get('/api/poc/profile/43?unknown=1', {headers: {'If-None-Match': bad.headers.get('etag')}});
  assert.equal(repeatedBad.status, 400, 'conditional requests must not turn an error into a 304');
  assertNoStore(repeatedBad);
  await repeatedBad.text();
  for (const [url, options, status] of [['/healthz', {}, 200], ['/api/poc/corpus/search', {method: 'OPTIONS'}, 204], ['/api/poc/profile/43', {method: 'POST'}, 405], ['/api/poc/profile/43', {headers: {Origin: 'https://foreign.example'}}, 403]]) {
    const response = await get(url, options);
    assert.equal(response.status, status);
    assertNoStore(response);
    await response.text();
  }
});
