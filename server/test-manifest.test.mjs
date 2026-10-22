import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {slow} from '../scripts/test-manifest.mjs';

const root = new URL('../', import.meta.url);
const files = ['src', 'server'].flatMap(dir => readdirSync(new URL(`${dir}/`, root))
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

test('listener test files import the loopback capability helper', () => {
  for (const [file, source] of sources) {
    if (/\.listen\s*\(/.test(source)) {
      assert.match(source, /import\s+\{\s*loopback\s*\}\s+from\s+['"]\.\/test-support\/loopback\.mjs['"]/, `${file} must import loopback test options`);
    }
  }
});
