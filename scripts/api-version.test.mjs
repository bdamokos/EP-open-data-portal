import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertBranchHistory, assertRecordedHistory, contractDigest, parseRegistry, reconcileRegistry, registrySides, renderRegistry} from './api-contract.mjs';

const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64), d = 'd'.repeat(64);
const registry = (...digests) => ({version: digests.length, entries: digests.map((digest, i) => [i + 1, digest])});
const template = `// Keep this comment.\nexport const API_VERSION = 1;\nexport const API_CONTRACT_DIGESTS = Object.freeze({\n  1: '${a}',\n});\nexport function versionedApiUrl(url) { return url; }\n`;
const source = (...digests) => renderRegistry(template, registry(...digests));

test('next version starts after main and unchanged contracts are idempotent', () => {
  const main = registry(a, b);
  assert.deepEqual(reconcileRegistry(main, [main], b), main);
  const next = reconcileRegistry(main, [main], c);
  assert.deepEqual(next, registry(a, b, c));
  assert.deepEqual(reconcileRegistry(main, [next], c), next);
});

test('parallel branches and a combined contract retain every digest after main', () => {
  const main = registry(a, b);
  const next = reconcileRegistry(main, [registry(a, c)], d);
  assert.deepEqual(next, registry(a, b, c, d));
  assertRecordedHistory(main, next);
  assert.deepEqual(reconcileRegistry(main, [next], d), next);
});

test('merged stack keeps independent collisions and semantic-only duplicate digests', () => {
  const next = reconcileRegistry(registry(a, b), [registry(a, c, c), registry(a, d)], d);
  assert.deepEqual(next, registry(a, b, c, d, c, d));
  assert.deepEqual(reconcileRegistry(registry(a, b), [next], d), next);
  assert.deepEqual(reconcileRegistry(registry(a), [registry(a)], a, true), registry(a, a));
  assert.deepEqual(reconcileRegistry(registry(a), [registry(a, a)], a), registry(a, a));
});

test('advancing main renumbers branch entries and restores removed or changed history', () => {
  assert.deepEqual(reconcileRegistry(registry(a, b, c), [registry(a, d)], d), registry(a, b, c, d));
  assert.deepEqual(reconcileRegistry(registry(a, b), [registry(c)], c), registry(a, b, c));
  assert.throws(() => assertRecordedHistory(registry(a, b), registry(a, c)), /removed or replaced/);
  assert.throws(() => assertRecordedHistory(registry(a, b), registry(a)), /removed or replaced/);
});

test('stack checks allow parent renumbering while preserving main and every parent digest occurrence', () => {
  const main = registry(a, c), parent = registry(a, b), child = registry(a, b, d);
  const bumped = reconcileRegistry(main, [child], d);
  assert.deepEqual(bumped, registry(a, c, b, d));
  assert.doesNotThrow(() => assertBranchHistory(main, parent, bumped));
  assert.throws(() => assertBranchHistory(main, parent, registry(a, c, d)), /discarded/);
  assert.throws(() => assertBranchHistory(main, parent, registry(a, b, d)), /removed or replaced/);
  assert.throws(() => assertBranchHistory(main, registry(a, b, b), bumped), /discarded/);
  assert.doesNotThrow(() => assertBranchHistory(main, registry(a, b, b), registry(a, c, b, b, d)));
});

test('strict registry parser rejects duplicate, missing, unsafe and malformed versions', () => {
  assert.deepEqual(parseRegistry(source(a, b)), registry(a, b));
  for (const text of [source(a, b).replace('2:', '1:'), source(a, b).replace('2:', '3:'),
    source(a).replace('= 1;', '= 9007199254740992;'), source(a).replace(a, 'bad'),
    source(a) + '\nexport const API_VERSION = 1;', source(a).replace('= 1;', '= 2;')]) {
    assert.throws(() => parseRegistry(text));
  }
});

test('ordinary, diff3 and zdiff3 conflicts retain both sides without discarding other edits', () => {
  for (const base of ['', `||||||| base\n${source(a)}`]) {
    const conflict = `// User edit outside the conflict.\n<<<<<<< HEAD\n${source(a, b)}${base}=======\n${source(a, c)}>>>>>>> branch\n`;
    const sides = registrySides(conflict);
    assert.deepEqual(sides.registries, [registry(a, b), registry(a, c)]);
    const result = renderRegistry(sides.source, reconcileRegistry(registry(a, b), sides.registries, d));
    assert(result.startsWith('// User edit outside the conflict.'));
    assert.deepEqual(parseRegistry(result), registry(a, b, c, d));
    assert(!result.includes('<<<<<<<'));
  }
  // Git often conflicts only on the new entry, with shared context outside it.
  const hunk = source(a, b).replace(`  2: '${b}',`, `<<<<<<< HEAD\n  2: '${b}',\n=======\n  2: '${c}',\n>>>>>>> branch`);
  assert.deepEqual(registrySides(hunk).registries, [registry(a, b), registry(a, c)]);
});

test('malformed conflicts and conflicting helper code fail without selecting a side', () => {
  assert.throws(() => registrySides(`<<<<<<< HEAD\n${source(a)}`), /Unterminated/);
  assert.throws(() => registrySides(`=======\n${source(a)}`), /Malformed/);
  const conflict = `<<<<<<< HEAD\n${source(a)}=======\n${source(b).replace('return url;', 'return url + "changed";')}>>>>>>> branch\n`;
  assert.throws(() => registrySides(conflict), /outside the API version declarations/);
});

const cli = fileURLToPath(new URL('./api-version.mjs', import.meta.url));
function git(root, ...args) {
  return execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'api-version-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'server'));
  await writeFile(path.join(root, 'server/endpoint.mjs'), 'export const ENDPOINT_VERSION = 1;\n');
  const {digest} = await contractDigest(root);
  await writeFile(path.join(root, 'server/api-version.mjs'), source(digest));
  git(root, 'init', '-b', 'main');
  // Fixture commits use the same identity as real commits and need no global configuration.
  git(root, 'config', 'user.name', 'bdamokos');
  git(root, 'config', 'user.email', '163609735+bdamokos@users.noreply.github.com');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'add', 'server');
  git(root, 'commit', '-m', 'Initial fixture');
  git(root, 'remote', 'add', 'origin', root);
  git(root, 'fetch', 'origin', 'main:refs/remotes/origin/main');
  git(root, 'switch', '-c', 'feature');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], {cwd: root, encoding: 'utf8', env: {...process.env, API_VERSION_BASE: '', API_VERSION_MAIN_BASE: ''}});
  const read = () => readFile(path.join(root, 'server/api-version.mjs'), 'utf8');
  const write = text => writeFile(path.join(root, 'server/api-version.mjs'), text);
  return {root, digest, run, read, write};
}

test('CLI check fails unbumped changes without writing; bump fetches and is idempotent', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'server/endpoint.mjs'), 'export const ENDPOINT_VERSION = 2;\n');
  const before = await f.read();
  const failed = f.run('--check');
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Unbumped API contract change/);
  assert.equal(await f.read(), before);
  const bumped = f.run();
  assert.equal(bumped.status, 0, bumped.stderr);
  const updated = await f.read();
  assert.equal(parseRegistry(updated).version, 2);
  assert.equal(f.run('--check').status, 0);
  assert.equal(f.run().status, 0);
  assert.equal(await f.read(), updated);
  assert.equal(git(f.root, 'diff', '--cached'), '');
  assert.equal(git(f.root, 'branch', '--show-current'), 'feature');
});

test('CLI refreshes a stale origin/main then resolves a real merge conflict', async t => {
  const f = await fixture(t);
  await f.write(source(f.digest, b));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Branch contract');
  git(f.root, 'switch', 'main');
  await f.write(source(f.digest, c));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Parallel main contract');
  const mainSha = git(f.root, 'rev-parse', 'HEAD');
  git(f.root, 'switch', 'feature');
  assert.notEqual(git(f.root, 'rev-parse', 'origin/main'), mainSha);
  assert.throws(() => git(f.root, 'merge', 'main'));
  assert.match(await f.read(), /<<<<<<< HEAD/);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(f.root, 'rev-parse', 'origin/main'), mainSha);
  assert.deepEqual(parseRegistry(await f.read()), registry(f.digest, c, b, f.digest));
  assert.equal(f.run('--check').status, 0);
  // Resolution is left for the caller to inspect and stage.
  assert.match(git(f.root, 'ls-files', '--unmerged'), /server\/api-version.mjs/);
});

test('CLI resolves a real rebase collision, preserving main and branch histories', async t => {
  const f = await fixture(t);
  await f.write(source(f.digest, b));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Branch contract');
  git(f.root, 'switch', 'main');
  await f.write(source(f.digest, c));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Main contract');
  git(f.root, 'switch', 'feature');
  assert.throws(() => git(f.root, '-c', 'merge.conflictStyle=diff3', 'rebase', 'main'));
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseRegistry(await f.read()), registry(f.digest, c, b, f.digest));
});

test('CLI never writes on failed fetch, malformed input or history check failures', async t => {
  const f = await fixture(t);
  await f.write(source(b));
  const before = await f.read();
  assert.equal(f.run('--check').status, 1);
  assert.equal(await f.read(), before);
  assert.equal(f.run('--check', '--base', 'missing-ref').status, 1);
  assert.equal(f.run('--check', '--force').status, 1);
  await f.write('malformed registry\n');
  assert.equal(f.run().status, 1);
  assert.equal(await f.read(), 'malformed registry\n');
  git(f.root, 'remote', 'set-url', 'origin', path.join(f.root, 'missing-origin'));
  await f.write(before);
  assert.equal(f.run().status, 1);
  assert.equal(await f.read(), before);
});

test('CLI --force records semantic-only changes and normal reruns leave them intact', async t => {
  const f = await fixture(t);
  assert.equal(f.run('--force').status, 0);
  assert.deepEqual(parseRegistry(await f.read()), registry(f.digest, f.digest));
  assert.equal(f.run().status, 0);
  assert.deepEqual(parseRegistry(await f.read()), registry(f.digest, f.digest));
});

test('stacked PR check accepts the bump after main advances, and rejects losing parent history', async t => {
  const f = await fixture(t);
  await f.write(source(f.digest, b));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Parent contract');
  git(f.root, 'branch', 'parent');
  await f.write(source(f.digest, b, d));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Child contract');
  git(f.root, 'switch', 'main');
  await f.write(source(f.digest, c));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Main advances');
  git(f.root, 'switch', 'feature');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseRegistry(await f.read()), registry(f.digest, c, b, d, f.digest));
  assert.equal(f.run('--check', '--base', 'parent').status, 0);
  await f.write(source(f.digest, c, d, f.digest));
  const missing = f.run('--check', '--base', 'parent');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /discarded/);
  await f.write(source(f.digest, b, f.digest));
  assert.match(f.run('--check', '--base', 'parent').stderr, /removed or replaced/);
});
