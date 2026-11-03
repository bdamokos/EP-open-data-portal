import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, readdir, readFile} from 'node:fs/promises';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
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
  assert.throws(() => contractDigest(root), /must resolve to a string or number literal response version constant/);
});

test('empty endpoint inventory is rejected', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'api-contract-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  await mkdir(path.join(root, 'server'));
  assert.throws(() => contractDigest(root), /must not be empty/);
});

// Execute endpoint modules only in this parity test, never in the digest path.
test('static inventory exactly matches the original import-based inventory', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url)), versions = [];
  for (const name of (await readdir(path.join(root, 'server'))).sort()) {
    if (!name.endsWith('.mjs') || name.endsWith('.test.mjs') || name === 'api-version.mjs') continue;
    const url = pathToFileURL(path.join(root, 'server', name));
    if (!/\bexport\s+(?:const|let|var)\s+\w+_VERSION\b/.test(await readFile(url, 'utf8'))) continue;
    const exports = await import(url.href);
    for (const key of Object.keys(exports).filter(key => key.endsWith('_VERSION')).sort()) versions.push([name, key, exports[key]]);
  }
  assert.deepEqual(contractDigest(root), {versions, digest:createHash('sha256').update(JSON.stringify(versions)).digest('hex')});
});

test('literal declarations, local aliases and re-exports resolve without executing modules', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'api-contract-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const server = path.join(root, 'server');
  await mkdir(server);
  await writeFile(path.join(server, 'source.mjs'), "export const SOURCE_VERSION = 'v\\u0032'; throw Error('must not execute');");
  await writeFile(path.join(server, 'bridge.mjs'), "export {SOURCE_VERSION} from './source.mjs';");
  await writeFile(path.join(server, 'endpoint.mjs'), `
    import {API_VERSION} from './api-version.mjs';
    export let ENDPOINT_VERSION = 0x10, OTHER_VERSION = -2;
    const local = 'value'; export {local as LOCAL_VERSION};
    export {SOURCE_VERSION as REEXPORTED_VERSION} from './bridge.mjs';
  `);
  assert.deepEqual(contractDigest(root).versions, [
    ['endpoint.mjs','ENDPOINT_VERSION',16], ['endpoint.mjs','LOCAL_VERSION','value'],
    ['endpoint.mjs','OTHER_VERSION',-2], ['endpoint.mjs','REEXPORTED_VERSION','v2'],
    ['source.mjs','SOURCE_VERSION','v2'],
  ]);
});

for (const expression of ['1 + 1', 'getVersion()', '`template`', 'null', 'true', '{}', 'undefined', 'Infinity']) {
  test(`nonliteral version ${expression} fails closed with file and key`, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'api-contract-'));
    t.after(() => rm(root, {recursive:true, force:true}));
    await mkdir(path.join(root, 'server'));
    await writeFile(path.join(root, 'server/endpoint.mjs'), `export const BAD_VERSION = ${expression};`);
    assert.throws(() => contractDigest(root), /endpoint.mjs:BAD_VERSION.*literal/);
  });
}

test('cyclic and unresolved re-exports fail closed', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'api-contract-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  await mkdir(path.join(root, 'server'));
  await writeFile(path.join(root, 'server/a.mjs'), "export const A_VERSION=1;export {B_VERSION} from './b.mjs';");
  await writeFile(path.join(root, 'server/b.mjs'), "export {B_VERSION} from './a.mjs';");
  assert.throws(() => contractDigest(root), /B_VERSION.*literal/);
  await writeFile(path.join(root, 'server/b.mjs'), "export const OTHER = 1;");
  assert.throws(() => contractDigest(root), /B_VERSION.*literal/);
});
