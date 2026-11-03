import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {contractDigest} from './api-contract.mjs';

test('inventory is deterministic and changes with endpoint versions', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'api-contract-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  await mkdir(path.join(root, 'server'));
  await writeFile(path.join(root, 'server/a.mjs'), 'export const A_VERSION = 1;');
  const first = await contractDigest(root);
  assert.deepEqual(await contractDigest(root), first);
  await writeFile(path.join(root, 'server/b.mjs'), "export const B_VERSION = 'v2';");
  const second = await contractDigest(root);
  assert.notEqual(second.digest.slice(0, 12), first.digest.slice(0, 12));
  assert.deepEqual(second.versions, [['a.mjs', 'A_VERSION', 1], ['b.mjs', 'B_VERSION', 'v2']]);
  await writeFile(path.join(root, 'server/invalid.mjs'), 'export const INVALID_VERSION = {};');
  await assert.rejects(contractDigest(root), /must be a response version constant/);
});

test('empty endpoint inventory is rejected', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'api-contract-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  await mkdir(path.join(root, 'server'));
  await assert.rejects(contractDigest(root), /must not be empty/);
});
