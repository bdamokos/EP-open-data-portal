import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertBranchHistory, assertRecordedHistory, contractDigest, parseRegistry, reconcileRegistry, registrySides, renderRegistry} from './api-contract.mjs';

const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64), d = 'd'.repeat(64);
const registry = (...digests) => ({version: (digests.length - 1) % 999 + 1, revision: digests.length, entries: digests.map((digest, i) => [i + 1, digest])});
const template = `// Keep this comment.\nexport const API_VERSION = 1;\nexport const API_CONTRACT_DIGESTS = Object.freeze({\n  1: '${a}',\n});\nexport function versionedApiUrl(url) { return url; }\n`;
const source = (...digests) => renderRegistry(template, registry(...digests));

test('repair provenance parses as data, preserves order and rejects ambiguous records', () => {
  const repair = {base: '1'.repeat(40), tip: '2'.repeat(40)};
  const value = {...registry(a), repairs: [repair]};
  const text = renderRegistry(template, value);
  assert.deepEqual(parseRegistry(text), value);
  assert.deepEqual(reconcileRegistry(value, [registry(a, b)], b).repairs, [repair]);
  assert.throws(() => assertBranchHistory(value, value, registry(a)), /provenance/);
  for (const replacement of ['[]', '[{"base":"bad","tip":"bad"}]', JSON.stringify([repair, repair]),
    '[{"base":"' + repair.base + '","base":"' + repair.base + '","tip":"' + repair.tip + '"}]']) {
    assert.throws(() => parseRegistry(text.replace(/Object.freeze\(\[[\s\S]*?\]\);/, 'Object.freeze(' + replacement + ');')));
  }
});

test('revision history crosses 998, 999 and 1 without reusing keys', () => {
  let current = registry(...Array(998).fill(a));
  for (const [revision, version, digest] of [[999, 999, b], [1000, 1, c], [1001, 2, d]]) {
    const next = reconcileRegistry(current, [current], digest);
    assert.equal(next.revision, revision);
    assert.equal(next.version, version);
    assertRecordedHistory(current, next);
    assert.deepEqual(parseRegistry(renderRegistry(template, next)), next);
    assert.deepEqual(reconcileRegistry(current, [next], digest), next);
    current = next;
  }
  const second = reconcileRegistry(registry(...Array(1998).fill(a)), [], b);
  assert.equal(second.revision, 1999);
  assert.equal(second.version, 1);
  assert.equal(second.entries[0][1], a);
  assert.equal(second.entries[1998][1], b);
});

test('legacy and wrapped declarations normalize together while invalid revisions fail closed', () => {
  assert.deepEqual(parseRegistry(template), registry(a));
  const modern = source(a);
  const conflict = `<<<<<<< HEAD\n${template}=======\n${modern}>>>>>>> branch\n`;
  assert.deepEqual(registrySides(conflict).registries, [registry(a), registry(a)]);
  const staleSelection = source(a, b).replace('REVISION = 2;', 'REVISION = 1;').replace('VERSION = 2;', 'VERSION = 1;');
  assert.throws(() => parseRegistry(staleSelection));
  assert.throws(() => registrySides(staleSelection), 'unconflicted files stay strict');
  for (const text of [modern.replace('REVISION = 1;', 'REVISION = 0;'),
    modern.replace('REVISION = 1;', 'REVISION = 9007199254740992;'),
    modern.replace('REVISION = 1;', 'REVISION = 2;'),
    modern + '\nexport const API_CONTRACT_REVISION = 0;',
    modern + '\nexport const API_VERSION = 0;',
    source(...Array(1000).fill(a)).replace('API_VERSION = 1;', 'API_VERSION = 1000;')]) {
    assert.throws(() => parseRegistry(text));
  }
});

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
  const wrappedMain = registry(...Array(999).fill(a), b);
  const wrappedParent = registry(...Array(998).fill(a), b, b);
  assert.throws(() => assertBranchHistory(wrappedMain, wrappedParent, wrappedMain), /discarded/);
  assert.doesNotThrow(() => assertBranchHistory(wrappedMain, wrappedParent, registry(...Array(999).fill(a), b, b)));
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

async function corruptMain(t, separate = false) {
  const f = await fixture(t);
  git(f.root, 'switch', 'main');
  await f.write(separate ? source(f.digest, b, f.digest, f.digest) : source(f.digest, b, f.digest));
  git(f.root, 'add', 'server/api-version.mjs'); git(f.root, 'commit', '-m', 'Recorded main history');
  const good = git(f.root, 'rev-parse', 'HEAD');
  const bad = separate ? [registry(f.digest, c, f.digest, f.digest), registry(f.digest, b, c, f.digest)]
    : [registry(f.digest, c, c, f.digest), registry(f.digest, d, c, f.digest)];
  const refs = [];
  for (const value of bad) {
    await f.write(renderRegistry(template, value));
    git(f.root, 'add', 'server/api-version.mjs'); git(f.root, 'commit', '-m', 'Conflicting published history');
    refs.push(git(f.root, 'rev-parse', 'HEAD'));
  }
  git(f.root, 'switch', 'feature'); git(f.root, 'merge', '--ff-only', 'main');
  git(f.root, 'fetch', 'origin', 'main:refs/remotes/origin/main');
  return {...f, good, bad, refs};
}

test('large recorded registries stay readable during checks, bumps and history recovery', async t => {
  const f = await fixture(t);
  const values = Array(15_000).fill(f.digest);
  git(f.root, 'switch', 'main');
  const large = source(...values);
  assert(Buffer.byteLength(large) > 1024 * 1024);
  await f.write(large);
  git(f.root, 'add', 'server/api-version.mjs'); git(f.root, 'commit', '-m', 'Large recorded history');
  const good = git(f.root, 'rev-parse', 'HEAD');
  git(f.root, 'fetch', 'origin', 'main:refs/remotes/origin/main');
  git(f.root, 'switch', 'feature'); git(f.root, 'merge', '--ff-only', 'main');
  const checked = f.run('--check');
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(await f.read(), large, 'read-only validation must preserve the registry');
  const bumped = f.run();
  assert.equal(bumped.status, 0, bumped.stderr);
  assert.equal(await f.read(), large, 'unchanged large registries stay idempotent');

  git(f.root, 'switch', 'main');
  values[7500] = b;
  await f.write(source(...values));
  git(f.root, 'add', 'server/api-version.mjs'); git(f.root, 'commit', '-m', 'Conflicting large history');
  git(f.root, 'fetch', 'origin', 'main:refs/remotes/origin/main');
  git(f.root, 'switch', 'feature'); git(f.root, 'merge', '--ff-only', 'main');
  const recovered = f.run('--repair-history', good);
  assert.equal(recovered.status, 0, recovered.stderr);
  const result = parseRegistry(await f.read());
  assert(result.entries.slice(0, 15_000).every(([, digest]) => digest === f.digest));
  assert(result.entries.slice(15_000).some(([, digest]) => digest === b));
  const verified = f.run('--check');
  assert.equal(verified.status, 0, verified.stderr);
});

test('explicit history recovery restores recorded keys and retains all displaced occurrences', async t => {
  const f = await corruptMain(t);
  const result = f.run('--repair-history', f.good);
  assert.equal(result.status, 0, result.stderr);
  const after = await f.read(), recovered = parseRegistry(after);
  assert.deepEqual(recovered.entries, registry(f.digest, b, f.digest, f.digest, c, d, c, f.digest).entries);
  assert.deepEqual(recovered.repairs, [{base: f.good, tip: f.refs.at(-1)}]);
  git(f.root, 'remote', 'set-url', 'origin', path.join(f.root, 'missing-origin'));
  assert.equal(f.run('--check').status, 0);
  assert.equal(await f.read(), after, 'check is read-only');
  git(f.root, 'remote', 'set-url', 'origin', f.root);
  assert.equal(f.run().status, 0);
  assert.equal(await f.read(), after, 'ordinary regeneration is idempotent');
  const missing = {...registry(f.digest, b, f.digest, f.digest, c, d, f.digest), repairs: recovered.repairs};
  await f.write(renderRegistry(template, missing));
  const failure = f.run('--check');
  assert.equal(failure.status, 1); assert.match(failure.stderr, /discarded/);
  assert.deepEqual(parseRegistry(await f.read()), missing);
  await f.write(after);
  git(f.root, 'add', 'server/api-version.mjs'); git(f.root, 'commit', '-m', 'Repair published history');
  git(f.root, 'switch', 'main'); git(f.root, 'merge', '--ff-only', 'feature');
  git(f.root, 'switch', 'feature');
  await f.write(source(f.digest, c)); // An old branch without recovery metadata.
  assert.equal(f.run().status, 0);
  const inherited = parseRegistry(await f.read());
  assert.deepEqual(inherited.repairs, recovered.repairs);
  assertRecordedHistory(recovered, inherited);
  assert.equal(f.run('--check').status, 0);
});

test('history recovery rejects a corrupt anchor, unrelated ancestry and check-mode mutation', async t => {
  const f = await corruptMain(t), before = await f.read();
  for (const ref of [f.refs[0], f.refs[1]]) {
    assert.equal(f.run('--repair-history', ref).status, 1);
    assert.equal(await f.read(), before);
  }
  git(f.root, 'switch', '-c', 'side', f.good);
  await f.write(source(f.digest, b, f.digest, c));
  git(f.root, 'add', 'server/api-version.mjs'); git(f.root, 'commit', '-m', 'Unpublished side registry');
  const side = git(f.root, 'rev-parse', 'HEAD');
  git(f.root, 'switch', 'main'); git(f.root, 'merge', '-s', 'ours', '--no-ff', 'side', '-m', 'Side ancestry only');
  git(f.root, 'switch', 'feature'); git(f.root, 'merge', '--ff-only', 'main');
  assert.equal(f.run('--repair-history', side).status, 1, 'second-parent ancestry is not published authority');
  const unchanged = await f.read();
  assert.equal(f.run('--check', '--repair-history', f.good).status, 1);
  assert.equal(await f.read(), unchanged);
});

test('history recovery is not a waiver for an already valid registry', async t => {
  const f = await fixture(t), before = await f.read(), good = git(f.root, 'rev-parse', 'main');
  git(f.root, 'switch', 'main');
  await f.write(source(f.digest, b, f.digest));
  git(f.root, 'add', 'server/api-version.mjs'); git(f.root, 'commit', '-m', 'Valid append-only main');
  git(f.root, 'switch', 'feature'); git(f.root, 'merge', '--ff-only', 'main');
  assert.equal(f.run('--repair-history', good).status, 1);
  assert.deepEqual(parseRegistry(await f.read()), registry(f.digest, b, f.digest));
  assert.notEqual(await f.read(), before);
});

test('a later recovery preserves prior provenance and all previously repaired mappings', async t => {
  const f = await corruptMain(t);
  assert.equal(f.run('--repair-history', f.good).status, 0);
  const first = parseRegistry(await f.read());
  git(f.root, 'add', 'server/api-version.mjs'); git(f.root, 'commit', '-m', 'First verified repair');
  git(f.root, 'switch', 'main'); git(f.root, 'merge', '--ff-only', 'feature');
  const green = git(f.root, 'rev-parse', 'HEAD');
  const nextBad = {...first, entries: first.entries.map(entry => [...entry])};
  nextBad.entries[1][1] = d;
  await f.write(renderRegistry(template, nextBad));
  git(f.root, 'add', 'server/api-version.mjs'); git(f.root, 'commit', '-m', 'Later conflicting history');
  git(f.root, 'switch', 'feature'); git(f.root, 'merge', '--ff-only', 'main');
  const repaired = f.run('--repair-history', green);
  assert.equal(repaired.status, 0, repaired.stderr);
  const second = parseRegistry(await f.read());
  assertRecordedHistory(first, second);
  assert.deepEqual(second.repairs.slice(0, 1), first.repairs);
  assert.equal(second.repairs.length, 2);
  assert.equal(f.run('--check').status, 0);
  const tampered = {...second, repairs: second.repairs.slice(1)};
  await f.write(renderRegistry(template, tampered));
  assert.equal(f.run('--check').status, 1, 'prior recovery provenance cannot be replaced');
});

test('a declared recovery cannot hide a later undeclared main collision', async t => {
  const f = await corruptMain(t);
  assert.equal(f.run('--repair-history', f.good).status, 0);
  const pending = await f.read();
  git(f.root, 'checkout', '--', 'server/api-version.mjs');
  git(f.root, 'switch', 'main');
  await f.write(source(f.digest, d, c, d));
  git(f.root, 'add', 'server/api-version.mjs'); git(f.root, 'commit', '-m', 'Undeclared later collision');
  git(f.root, 'switch', 'feature'); git(f.root, 'merge', '--ff-only', 'main');
  git(f.root, 'fetch', 'origin', 'main:refs/remotes/origin/main');
  await f.write(pending);
  const checked = f.run('--check');
  assert.equal(checked.status, 1); assert.match(checked.stderr, /removed or replaced/);
  assert.equal(await f.read(), pending);
});

test('historical pair union cannot reuse one alias for records in different snapshots', async t => {
  const f = await corruptMain(t, true);
  assert.equal(f.run('--repair-history', f.good).status, 0);
  const full = parseRegistry(await f.read());
  assert.equal(full.entries.slice(4).filter(([, digest]) => digest === c).length, 2);
  const values = full.entries.map(([, digest]) => digest); values.splice(4, 1);
  const incomplete = {...registry(...values), repairs: full.repairs};
  await f.write(renderRegistry(template, incomplete));
  const before = await f.read(), failed = f.run('--check');
  assert.equal(failed.status, 1); assert.match(failed.stderr, /discarded/);
  assert.equal(await f.read(), before);
  assert.equal(f.run().status, 0);
  assert.notEqual(await f.read(), before, 'regeneration must restore the missing occurrence');
  assert.equal(f.run('--check').status, 0);
});

test('a real old-branch merge retains recovery provenance through registry conflicts', async t => {
  const f = await corruptMain(t);
  assert.equal(f.run('--repair-history', f.good).status, 0);
  const repaired = parseRegistry(await f.read());
  git(f.root, 'add', 'server/api-version.mjs'); git(f.root, 'commit', '-m', 'Publish verified recovery');
  git(f.root, 'switch', 'main'); git(f.root, 'merge', '--ff-only', 'feature');
  git(f.root, 'switch', '-c', 'old-branch', f.good);
  await f.write(source(f.digest, b, f.digest, d, f.digest));
  git(f.root, 'add', 'server/api-version.mjs'); git(f.root, 'commit', '-m', 'Old independent contract');
  const old = git(f.root, 'rev-parse', 'HEAD');
  assert.throws(() => git(f.root, 'merge', 'main'));
  const bumped = f.run();
  assert.equal(bumped.status, 0, bumped.stderr);
  const result = parseRegistry(await f.read());
  assertRecordedHistory(repaired, result);
  assert.deepEqual(result.repairs, repaired.repairs);
  assert.equal(f.run('--check', '--base', old).status, 0);
});

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

test('CLI migrates a legacy branch when Git merges its new entry outside the declaration conflict', async t => {
  const f = await fixture(t);
  const legacy = text => text.replace(/^export const API_CONTRACT_REVISION = .*\n/m, '');
  // Both branches predate the new declaration; main adds it while the branch bumps.
  await f.write(legacy(source(f.digest)));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Legacy registry');
  git(f.root, 'switch', 'main');
  git(f.root, 'merge', '--ff-only', 'feature');
  await f.write(source(f.digest));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Introduce contract revision');
  git(f.root, 'switch', 'feature');
  await f.write(legacy(source(f.digest, b)));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Legacy branch contract');
  assert.throws(() => git(f.root, '-c', 'merge.conflictStyle=diff3', 'merge', 'main'));
  const conflict = await f.read();
  assert.match(conflict, /<<<<<<< HEAD/);
  assert(conflict.indexOf(`2: '${b}'`) > conflict.indexOf('>>>>>>>'), 'the new entry is shared context');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const updated = await f.read();
  assert.deepEqual(parseRegistry(updated), registry(f.digest, b, f.digest));
  assert.equal(f.run('--check').status, 0);
  assert.equal(f.run().status, 0);
  assert.equal(await f.read(), updated);
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

test('CLI --force wraps an unchanged digest from 998 through 999 to 1', async t => {
  const f = await fixture(t);
  await f.write(source(...Array(998).fill(f.digest)));
  for (const [revision, version] of [[999, 999], [1000, 1]]) {
    const result = f.run('--force');
    assert.equal(result.status, 0, result.stderr);
    const current = parseRegistry(await f.read());
    assert.equal(current.revision, revision);
    assert.equal(current.version, version);
    assert(current.entries.every(([, digest]) => digest === f.digest));
    const before = await f.read();
    assert.equal(f.run('--check').status, 0);
    assert.equal(f.run().status, 0);
    assert.equal(await f.read(), before);
  }
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

test('CLI reconciles a stacked merge across wrap, retains semantic bumps, and checks read-only', async t => {
  const f = await fixture(t);
  const common = Array(998).fill(f.digest);
  git(f.root, 'switch', 'main');
  await f.write(source(...common));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'History at 998');
  git(f.root, 'switch', 'feature');
  git(f.root, 'merge', '--ff-only', 'main');
  await f.write(source(...common, b));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Parent at 999');
  git(f.root, 'branch', 'parent');
  await f.write(source(...common, b, b));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Child semantic bump wraps to 1');
  git(f.root, 'switch', 'main');
  await f.write(source(...common, c));
  git(f.root, 'add', 'server/api-version.mjs');
  git(f.root, 'commit', '-m', 'Parallel main at 999');
  git(f.root, 'switch', 'feature');
  assert.throws(() => git(f.root, '-c', 'merge.conflictStyle=diff3', 'merge', 'main'));
  const bump = f.run();
  assert.equal(bump.status, 0, bump.stderr);
  const updated = await f.read();
  const next = parseRegistry(updated);
  assert.deepEqual(next, registry(...common, c, b, b, f.digest));
  assert.equal(next.version, 3);
  assert.equal(next.revision, 1002);
  assert.equal(f.run('--check', '--base', 'parent').status, 0);
  assert.equal(await f.read(), updated);
  assert.equal(f.run().status, 0);
  assert.equal(await f.read(), updated);
  // A second occurrence of b must survive even though its public version wrapped.
  git(f.root, 'branch', 'wrapped-child', 'HEAD');
  await f.write(source(...common, c, b, f.digest));
  const missing = f.run('--check', '--base', 'wrapped-child');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /discarded/);
});
