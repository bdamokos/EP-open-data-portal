import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import {API_VERSION, API_CONTRACT_DIGESTS} from './api-version.mjs';

test('endpoint response versions match the deliberately recorded API contract', async () => {
  const versions = [];
  for (const name of (await readdir(new URL('./', import.meta.url))).sort()) {
    if (!name.endsWith('.mjs') || name.endsWith('.test.mjs') || name === 'api-version.mjs') continue;
    const url = new URL(name, import.meta.url);
    const source = await readFile(url, 'utf8');
    if (!/\bexport\s+(?:const|let|var)\s+\w+_VERSION\b/.test(source)) continue;
    const exports = await import(url.href);
    for (const key of Object.keys(exports).filter(key => key.endsWith('_VERSION')).sort()) {
      assert(['string', 'number'].includes(typeof exports[key]), `${name}:${key} must be a response version constant`);
      versions.push([name, key, exports[key]]);
    }
  }
  assert(versions.length > 0, 'The endpoint version inventory must not be empty');
  assert(Number.isSafeInteger(API_VERSION) && API_VERSION > 0);
  assert.equal(API_VERSION, Math.max(...Object.keys(API_CONTRACT_DIGESTS).map(Number)), 'API_VERSION must select the newest recorded contract');
  const digest = createHash('sha256').update(JSON.stringify(versions)).digest('hex');
  assert.equal(digest, API_CONTRACT_DIGESTS[API_VERSION],
    `Endpoint response versions changed. For an API contract change, bump API_VERSION and append its digest to API_CONTRACT_DIGESTS; never replace a recorded digest. Do not bump for commits or deploys alone. Expected digest: ${digest}\nVersions: ${JSON.stringify(versions)}`);
});
