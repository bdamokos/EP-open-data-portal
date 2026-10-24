import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {contractDigest} from '../scripts/api-contract.mjs';
import {API_VERSION, API_CONTRACT_REVISION, API_CONTRACT_DIGESTS} from './api-version.mjs';

test('endpoint response versions match the deliberately recorded API contract', async () => {
  const {digest, versions} = await contractDigest(fileURLToPath(new URL('../', import.meta.url)));
  assert(Number.isSafeInteger(API_VERSION) && API_VERSION > 0);
  assert.equal(API_CONTRACT_REVISION, Math.max(...Object.keys(API_CONTRACT_DIGESTS).map(Number)), 'API_CONTRACT_REVISION must select the newest recorded contract');
  assert.equal(API_VERSION, (API_CONTRACT_REVISION - 1) % 999 + 1);
  assert.equal(digest, API_CONTRACT_DIGESTS[API_CONTRACT_REVISION],
    `Endpoint response versions changed. Run npm run api:bump and commit the appended API contract digest; never replace a recorded digest. Do not bump for commits or deploys alone. Expected digest: ${digest}\nVersions: ${JSON.stringify(versions)}`);
});

test('transport exposes the wrapped number at both boundaries', async () => {
  const {readFile} = await import('node:fs/promises');
  const {renderRegistry} = await import('../scripts/api-contract.mjs');
  const source = await readFile(new URL('./api-version.mjs', import.meta.url), 'utf8');
  for (const revision of [998, 999, 1000, 1998, 1999]) {
    const version = (revision - 1) % 999 + 1;
    const moduleSource = renderRegistry(source, {revision, version, entries: Array.from({length: revision}, (_, i) => [i + 1, 'a'.repeat(64)])});
    const api = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
    assert.equal(api.API_VERSION, version);
    assert.equal(api.versionedApiUrl('/api/directory'), `/api/directory?v=${version}`);
    assert.equal(api.versionedApiUrl('/api/profile/43?lang=hu'), `/api/profile/43?lang=hu&v=${version}`);
  }
});

test('the client reports version mismatches on either side of the wrap', async () => {
  const {reportApiVersionMismatch, subscribeApiVersionMismatch, apiVersionMismatch} = await import('../src/apiVersionMismatch.mjs?wrap');
  let notices = 0;
  const unsubscribe = subscribeApiVersionMismatch(() => notices++);
  try {
    assert.equal(reportApiVersionMismatch(409, {error: {code: 'generation_changed'}}), false);
    for (const apiVersion of [1, 999]) {
      assert.equal(reportApiVersionMismatch(409, {error: {code: 'api_version_mismatch', apiVersion}}), true);
      assert.equal(apiVersionMismatch(), true);
    }
    assert.equal(notices, 1);
  } finally { unsubscribe(); }
});
