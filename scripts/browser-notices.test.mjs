import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserNotices} from './browser-notices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('dependency upgrades refresh notice versions and texts without a source edit', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'browser-notices-'));
  const directory = path.join(temporary, 'node_modules', 'example');
  mkdirSync(directory, {recursive: true});
  const manifest = (version, license = 'MIT') => writeFileSync(path.join(directory, 'package.json'), JSON.stringify({name: 'example', version, license}));
  const generate = () => browserNotices([path.join(directory, 'index.js')], root);
  try {
    manifest('1.0.0');
    writeFileSync(path.join(directory, 'LICENSE'), 'Original copyright and terms');
    assert.match(generate(), /example@1\.0\.0\n\nOriginal copyright and terms/);
    manifest('1.1.0');
    writeFileSync(path.join(directory, 'LICENSE'), 'Updated copyright and terms */');
    const updated = generate();
    assert.match(updated, /example@1\.1\.0\n\nUpdated copyright and terms \* \//);
    assert(!updated.includes('example@1.0.0'));
    manifest('1.1.0', 'unexpected');
    assert.throws(generate, /Review unexpected licence/);
    manifest('1.1.0');
    rmSync(path.join(directory, 'LICENSE'));
    assert.throws(generate, /Missing licence text/);
    writeFileSync(path.join(directory, 'LICENSE'), '');
    assert.throws(generate, /Empty licence text/);
  } finally { rmSync(temporary, {recursive: true, force: true}); }
});
