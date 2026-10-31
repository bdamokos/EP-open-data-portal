import {versionedPortraitUrl} from './portrait-version.mjs';
import {loopback} from './test-support/loopback.mjs';
import test from 'node:test';
import {API_VERSION, versionedApiUrl} from './api-version.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

test('HTTP reads, conditional responses and failures preserve the intended browser/CDN policy',loopback, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'response-cache-http-'));
  const originalFetch = globalThis.fetch;
  const previousDirectory = process.env.ODP_CACHE_DIR;
  process.env.ODP_CACHE_DIR = directory;
  let profileLoads = 0, rosterLoads = 0, imageLoads = 0;
  const originalPortrait = await sharp({create: {width: 900, height: 1200, channels: 3, background: '#ccc'}}).jpeg().toBuffer();
  globalThis.fetch = async value => {
    const url = new URL(value);
    if (url.origin === 'https://data.europarl.europa.eu' && url.pathname === '/api/v2/meps/show-current') {
      rosterLoads++;
      return Response.json({data:[{identifier:'43','api:country-of-representation':'FI','api:political-group':'PPE'}]});
    }
    if (url.origin === 'https://data.europarl.europa.eu' && url.pathname === '/api/v2/meps/43') {
      profileLoads++;
      return new Response(JSON.stringify({data: [{identifier: '43', givenName: 'Public', familyName: 'Member',hasMembership:[{id:'membership/43-m-10',organization:'org/ep-10',role:'def/ep-roles/MEMBER_PARLIAMENT',memberDuring:{startDate:'2024-07-16'}}]}]}), {headers: {'content-type': 'application/ld+json'}});
    }
    if (url.href === 'https://www.europarl.europa.eu/mepphoto/43.jpg') {
      imageLoads++;
      return new Response(originalPortrait, {headers: {'content-type': 'image/jpeg'}});
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
  const get = (url, options) => originalFetch(base + versionedApiUrl(url), options);
  const assertNoStore = response => {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  };

  const first = await get('/api/profile/43?lang=en');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'public, max-age=0');
  assert.equal(first.headers.get('cdn-cache-control'), 'public, max-age=21600, stale-if-error=0');
  assert.equal(first.headers.get('vary'), 'Origin');
  const body = await first.json();
  assert.equal(body.id, 43);
  assert.equal(body.countryCode,'FI');
  assert.equal(body.groupCode,'PPE');
  assert(body.fetchedAt);
  assert.equal(body.parliamentaryService.currentSince,'2024-07-16');
  const unchanged = await get('/api/profile/43?lang=en', {headers: {'If-None-Match': first.headers.get('etag')}});
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.headers.get('cdn-cache-control'), first.headers.get('cdn-cache-control'));
  assert.equal(await unchanged.text(), '');
  const head = await get('/api/profile/43?lang=hu', {method: 'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('cdn-cache-control'), first.headers.get('cdn-cache-control'));
  assert.equal(await head.text(), '');
  assert.equal(profileLoads, 1);
  assert.equal(rosterLoads, 1);

  for (const resource of ['/api/profile/43?lang=en', '/api/portrait/43']) {
    const current = await get(resource);
    const etag = current.headers.get('etag');
    await current.arrayBuffer();
    for (const method of ['GET', 'HEAD']) {
      for (const conditional of [false, true]) {
        const unversioned = await originalFetch(base + resource, {method, headers: conditional ? {'If-None-Match': etag} : {}});
        assert.equal(unversioned.status, conditional ? 304 : 200);
        assert.equal(unversioned.headers.get('cdn-cache-control'), 'no-store');
        assert.equal(unversioned.headers.get('cache-control'), current.headers.get('cache-control'));
        await unversioned.arrayBuffer();
        const mismatched = await originalFetch(base + resource + (resource.includes('?') ? '&' : '?') + 'v=' + (API_VERSION + 1), {method, headers: conditional ? {'If-None-Match': etag} : {}});
        assert.equal(mismatched.status, 409);
        assertNoStore(mismatched);
        if (method === 'HEAD') assert.equal(await mismatched.text(), '');
        else assert.deepEqual(await mismatched.json(), {error: {code: 'api_version_mismatch', message: 'A new version of the explorer is available.', apiVersion: API_VERSION}});
      }
    }
  }
  for (const version of ['', '0', '-1', '1.5', '1e2', '01', 'NaN', '9007199254740992', API_VERSION + '&v=' + API_VERSION]) {
    const invalid = await originalFetch(base + '/api/healthz?v=' + version);
    assert.equal(invalid.status, 400, version);
    assertNoStore(invalid);
    assert.equal((await invalid.json()).error.code, 'invalid_api_version');
  }
  for (const route of ['/api/healthz', '/healthz', '/api']) {
    for (const versioned of [false, true]) {
      const health = await originalFetch(base + (versioned ? versionedApiUrl(route) : route));
      assert.equal(health.status, 200);
      assertNoStore(health);
      assert.equal((await health.json()).apiVersion, API_VERSION);
    }
  }

  const independent = await originalFetch(base + versionedPortraitUrl('/api/portrait/43'));
  assert.equal(independent.status,200);
  assert.equal(independent.headers.get('content-type'),'image/webp');
  assert(independent.headers.get('cdn-cache-control').startsWith('public,'));
  const independentTag=independent.headers.get('etag');
  const derived = Buffer.from(await independent.arrayBuffer());
  assert.equal((await sharp(derived).metadata()).width,480);
  assert(derived.length < originalPortrait.length);
  const legacy = await originalFetch(base + '/api/portrait/43?v=1');
  assert.equal(legacy.status,200);
  assert.equal(legacy.headers.get('content-type'),'image/jpeg');
  assert.deepEqual(Buffer.from(await legacy.arrayBuffer()),originalPortrait);
  assert.notEqual(legacy.headers.get('etag'),independentTag);
  const independentHead=await originalFetch(base + versionedPortraitUrl('/api/portrait/43'),{method:'HEAD',headers:{'If-None-Match':independentTag}});
  assert.equal(independentHead.status,304);
  assert(independentHead.headers.get('cdn-cache-control').startsWith('public,'));
  const portrait = await get('/api/portrait/43');
  assert.equal(portrait.status, 200);
  assert.equal(portrait.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(portrait.headers.get('vary'), 'Origin');
  assert.match(portrait.headers.get('cdn-cache-control'), /^public, max-age=604\d{3}, stale-if-error=0$/);
  assert.deepEqual(Buffer.from(await portrait.arrayBuffer()), originalPortrait);
  const sameImage = await get('/api/portrait/43', {headers: {'If-None-Match': portrait.headers.get('etag')}});
  assert.equal(sameImage.status, 304);
  assert.equal(sameImage.headers.get('vary'), 'Origin');
  assert(sameImage.headers.get('cdn-cache-control').startsWith('public,'));
  assert.equal(await sameImage.text(), '');
  for (const [method, conditional, status] of [['GET', false, 200], ['HEAD', false, 200], ['GET', true, 304], ['HEAD', true, 304]]) {
    const authenticated = await get('/api/portrait/43', {method, headers: {Authorization: 'Bearer synthetic-test', ...(conditional ? {'If-None-Match': portrait.headers.get('etag')} : {})}});
    assert.equal(authenticated.status, status);
    assertNoStore(authenticated);
    assert.equal(authenticated.headers.get('vary'), 'Origin');
    assert.deepEqual(Buffer.from(await authenticated.arrayBuffer()), method === 'GET' && !conditional ? originalPortrait : Buffer.alloc(0));
  }
  assert.equal(imageLoads, 1);

  const bad = await get('/api/profile/43?unknown=1');
  assert.equal(bad.status, 400);
  assertNoStore(bad);
  await bad.text();
  const repeatedBad = await get('/api/profile/43?unknown=1', {headers: {'If-None-Match': bad.headers.get('etag')}});
  assert.equal(repeatedBad.status, 400, 'conditional requests must not turn an error into a 304');
  assertNoStore(repeatedBad);
  await repeatedBad.text();
  for (const [url, options, status] of [['/healthz', {}, 200], ['/api/corpus/search', {method: 'OPTIONS'}, 204], ['/api/profile/43', {method: 'POST'}, 405], ['/api/profile/43', {headers: {Origin: 'https://foreign.example'}}, 403]]) {
    const response = await get(url, options);
    assert.equal(response.status, status);
    assertNoStore(response);
    await response.text();
  }
});
