import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {slow, testDirectories} from '../scripts/test-manifest.mjs';
import {listenerIssues} from './test-support/test-manifest.mjs';

const root = new URL('../', import.meta.url);
const files = testDirectories.flatMap(dir => readdirSync(new URL(`${dir}/`, root))
  .filter(name => name.endsWith('.test.mjs')).map(name => `${dir}/${name}`));
const sources = files.map(file => [file, readFileSync(new URL(file, root), 'utf8')]);

test('slow manifest entries exist, are unique and explain their cost', () => {
  assert.equal(new Set(slow.map(entry => entry.file)).size, slow.length);
  for (const entry of slow) {
    assert.ok(files.includes(entry.file), `Missing slow file: ${entry.file}`);
    assert.ok(entry.reason.trim(), `Missing reason: ${entry.file}`);
  }
});

test('subprocess test files belong to the slow manifest', () => {
  for (const [file, source] of sources) {
    if (source.includes('node:' + 'child_process')) {
      assert.ok(slow.some(entry => entry.file === file), `Add ${file} to scripts/test-manifest.mjs with a reason`);
    }
  }
});

test('each listener receives loopback capability options', () => {
  for (const [file, source] of sources) assert.deepEqual(listenerIssues(source), [], file);
});

test('listener checks reject unused imports and unguarded shared setup', () => {
  const imported = "import {loopback} from './test-support/loopback.mjs';\n";
  const listener = 'server.' + 'listen(0)';
  const guarded = `test('guarded', loopback, () => {${listener}});`;
  assert.ok(listenerIssues(imported + `test('unguarded', () => {${listener}});`).length);
  assert.ok(listenerIssues(imported + guarded + `test('new unguarded test', () => {${listener}});`).length);
  assert.ok(listenerIssues(imported + `before(() => {${listener}}); test('unguarded', () => {});`).length);
  assert.deepEqual(listenerIssues(imported + guarded), []);
  assert.deepEqual(listenerIssues(imported + `test('merged', {...loopback, timeout: 300000}, () => {${listener}});`), []);
  assert.deepEqual(listenerIssues(imported + `before(() => {${listener}}); test('guarded', loopback, () => {});`), []);
  assert.deepEqual(listenerIssues(imported + `describe('guarded', loopback, () => {before(() => {${listener}}); test('child', () => {});});`), []);
  assert.deepEqual(listenerIssues(`// ${listener}\n test('example', () => {const fixture = '${listener}';});`), []);
});

test('listener checks treat server entry point subprocesses as listeners', () => {
  const imported = "import {loopback} from './test-support/loopback.mjs';\n";
  for (const launch of [
    "spawn(process.execPath, ['server/index.mjs'])",
    "execFileAsync(t, process.execPath, [new URL('./index.mjs', import.meta.url).pathname])",
    'childProcess.fork(`${root}/index.mjs`)',
    "exec('node server/index.mjs --port 12345')",
    `exec('node "server/index.mjs"; true')`,
  ]) {
    assert.ok(listenerIssues(imported + `test('unguarded', t => {${launch};});`).length, launch);
    assert.deepEqual(listenerIssues(imported + `test('guarded', loopback, t => {${launch};});`), [], launch);
  }
  assert.deepEqual(listenerIssues("test('in process', async () => {await import('./index.mjs'); files.includes('index.mjs');});"), []);
  assert.deepEqual(listenerIssues("test('other script', () => {spawn(process.execPath, ['server/document-context-index.mjs']);});"), []);
});
