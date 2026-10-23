import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {contractDigest} from '../scripts/api-contract.mjs';
import {API_VERSION, API_CONTRACT_DIGESTS} from './api-version.mjs';

test('endpoint response versions match the deliberately recorded API contract', async () => {
  const {digest, versions} = await contractDigest(fileURLToPath(new URL('../', import.meta.url)));
  assert(Number.isSafeInteger(API_VERSION) && API_VERSION > 0);
  assert.equal(API_VERSION, Math.max(...Object.keys(API_CONTRACT_DIGESTS).map(Number)), 'API_VERSION must select the newest recorded contract');
  assert.equal(digest, API_CONTRACT_DIGESTS[API_VERSION],
    `Endpoint response versions changed. Run npm run api:bump and commit the appended API contract digest; never replace a recorded digest. Do not bump for commits or deploys alone. Expected digest: ${digest}\nVersions: ${JSON.stringify(versions)}`);
});
