import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {contractDigest} from '../scripts/api-contract.mjs';
import {API_VERSION, versionedApiUrl} from './api-version.mjs';

test('API version is the endpoint inventory digest prefix', async () => {
  const {digest, versions} = await contractDigest(fileURLToPath(new URL('../', import.meta.url)));
  assert(versions.length > 0);
  for (const [, , version] of versions) assert(['string', 'number'].includes(typeof version));
  assert.match(API_VERSION, /^[a-f0-9]{12}$/);
  assert.equal(API_VERSION, digest.slice(0, 12));
  assert.equal(versionedApiUrl('/api/directory'), `/api/directory?v=${API_VERSION}`);
  assert.equal(versionedApiUrl('/api/profile/43?lang=hu'), `/api/profile/43?lang=hu&v=${API_VERSION}`);
});

test('the client reports legacy and digest version mismatches', async () => {
  const {reportApiVersionMismatch, subscribeApiVersionMismatch, apiVersionMismatch} = await import('../src/apiVersionMismatch.mjs?digest');
  let notices = 0;
  const unsubscribe = subscribeApiVersionMismatch(() => notices++);
  try {
    assert.equal(reportApiVersionMismatch(409, {error: {code: 'generation_changed'}}), false);
    for (const apiVersion of ['296', 'ffffffffffff']) {
      assert.equal(reportApiVersionMismatch(409, {error: {code: 'api_version_mismatch', apiVersion}}), true);
      assert.equal(apiVersionMismatch(), true);
    }
    assert.equal(notices, 1);
  } finally { unsubscribe(); }
});
