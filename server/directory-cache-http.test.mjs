import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {versionedApiUrl} from './api-version.mjs';

test('directory polling and conditional reads cannot retain a loading membership snapshot', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'directory-cache-http-'));
  const originalFetch = globalThis.fetch;
  const previousDirectory = process.env.ODP_CACHE_DIR;
  process.env.ODP_CACHE_DIR = directory;
  const person = {identifier: '43', givenName: 'Public', familyName: 'Member', hasMembership: []};
  for (const [endpoint, data] of [['/meps/show-current', [person]], ['/corporate-bodies/show-current', []]]) {
    const url = new URL('https://data.europarl.europa.eu/api/v2' + endpoint);
    for (const [key, value] of Object.entries({limit: 1000, offset: 0, format: 'application/ld+json'})) url.searchParams.set(key, value);
    await writeFile(path.join(directory, createHash('sha256').update(url.href).digest('hex') + '.json'), JSON.stringify({url: url.href, fetchedAt: Date.now(), payload: {data}}));
  }
  await writeFile(path.join(directory, 'sync-state.json'), JSON.stringify({lastAttempt: new Date(Date.now() + 86400_000).toISOString()}));
  let finishProfile;
  const profileReady = new Promise(resolve => {finishProfile = resolve;});
  globalThis.fetch = async value => {
    assert.equal(String(value), 'https://data.europarl.europa.eu/api/v2/meps/43?format=application%2Fld%2Bjson');
    await profileReady;
    return Response.json({data: [person]});
  };
  const {server} = await import('./index.mjs');
  t.after(async () => {
    finishProfile();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    if (previousDirectory === undefined) delete process.env.ODP_CACHE_DIR;
    else process.env.ODP_CACHE_DIR = previousDirectory;
    await rm(directory, {recursive: true, force: true});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}` + versionedApiUrl('/api/directory');
  const first = await originalFetch(url);
  assert.equal(first.status, 200);
  const initial = await first.json();
  assert.equal(initial.index.complete, false);
  assert.equal(initial.index.loaded, 0);
  assert.equal(initial.members[0].memberships, null);
  const etag = first.headers.get('etag');
  for (const [response, status] of [[first, 200], [await originalFetch(url, {method: 'HEAD'}), 200], [await originalFetch(url, {headers: {'If-None-Match': etag}}), 304]]) {
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
    if (response !== first) await response.arrayBuffer();
  }
  finishProfile();
  let loaded, response;
  const deadline = Date.now() + 3000;
  do {
    response = await originalFetch(url);
    loaded = await response.json();
    if (loaded.index.complete) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.equal(loaded.index.complete, true);
  assert.equal(loaded.index.loaded, 1);
  assert.deepEqual(loaded.members[0].memberships, []);
  assert.equal(response.headers.get('cdn-cache-control'), 'public, max-age=21600, stale-if-error=0');
});
