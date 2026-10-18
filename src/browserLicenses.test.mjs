import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const normalize = text => text.replace(/\s+/g, ' ').trim();

test('production JavaScript retains full notices for every bundled dependency', async () => {
  const result = await build({
    root,
    logLevel: 'silent',
    build: {write: false, license: {fileName: 'licenses.json'}},
  });
  const inventory = JSON.parse(result.output.find(file => file.fileName === 'licenses.json').source);
  const notices = await readFile(new URL('../THIRD_PARTY_JAVASCRIPT_LICENSES.txt', import.meta.url), 'utf8');
  assert.ok(!notices.includes('*/'), 'notice text must not terminate the JavaScript comment');
  const banner = `/*!\n${notices.trim()}\n*/`;
  const normalizedBanner = normalize(banner);
  assert.ok(inventory.length > 0);
  for (const dependency of inventory) {
    assert.equal(dependency.identifier, 'MIT', `review the licence for ${dependency.name}`);
    assert.ok(notices.includes(`${dependency.name}@${dependency.version}`), `update notices for ${dependency.name}@${dependency.version}`);
    let text = dependency.text;
    if (!text) {
      // This release omits LICENSE in npm; the pinned upstream text is documented in THIRD_PARTY_NOTICES.md.
      assert.equal(`${dependency.name}@${dependency.version}`, '@nodable/entities@3.1.0');
      const reactLicense = await readFile(new URL('../node_modules/react/LICENSE', import.meta.url), 'utf8');
      text = `Copyright (c) 2026 Nodable\n\n${reactLicense.slice(reactLicense.indexOf('Permission is hereby granted'))}`;
    }
    assert.ok(normalizedBanner.includes(normalize(text)), `missing full licence text for ${dependency.name}`);
  }
  // Vite's injected modulepreload polyfill is not part of its package inventory.
  const viteLicense = await readFile(new URL('../node_modules/vite/LICENSE.md', import.meta.url), 'utf8');
  const coreLicense = viteLicense.split('# Licenses of bundled dependencies')[0].split('MIT License')[1];
  assert.ok(coreLicense?.includes('Copyright'), 'review Vite core licence extraction after an upgrade');
  assert.ok(normalizedBanner.includes(normalize(coreLicense)), 'missing Vite runtime licence');

  const chunks = result.output.filter(file => file.type === 'chunk');
  assert.ok(chunks.length > 0);
  for (const chunk of chunks) {
    // Vite may prepend its dynamic-import dependency helper after bundling.
    const bannerOffset = chunk.code.indexOf(banner);
    assert.ok(bannerOffset >= 0, `notices stripped from ${chunk.fileName}`);
    assert.ok(chunk.map, `missing source map for ${chunk.fileName}`);
    const noticeLines = chunk.code.slice(0, bannerOffset + banner.length).split('\n').length;
    assert.ok(chunk.map.mappings.startsWith(';'.repeat(noticeLines)), 'source maps must account for the notice banner and preload helper');
  }

  const manifest = JSON.parse(result.output.find(file => file.fileName === '.vite/manifest.json').source);
  const emitted = new Set(Object.values(manifest).map(entry => entry.file));
  for (const chunk of chunks) assert(emitted.has(chunk.fileName), `chunk missing from immutable-asset manifest: ${chunk.fileName}`);
  const secondary = ['GroupVoices', 'Legislation', 'QuestionTopics', 'OutsideVoices', 'Saved', 'Amendments'].map(name => `src/${name}.tsx`);
  assert.deepEqual([...manifest['index.html'].dynamicImports].sort(), secondary.sort());
  const initial = new Set();
  function visit(key) {
    if (initial.has(key)) return;
    initial.add(key);
    for (const imported of manifest[key].imports || []) visit(imported);
  }
  visit('index.html');
  for (const key of secondary) assert(!initial.has(key), `${key} was pulled into the initial load`);
  const initialFiles = new Set([...initial].map(key => manifest[key].file));
  const initialSources = chunks.filter(chunk => initialFiles.has(chunk.fileName)).flatMap(chunk => chunk.map.sources);
  for (const name of ['Saved.tsx', 'Amendments.tsx', 'europeMap.ts', 'TopicTrends.tsx']) {
    assert(!initialSources.some(source => source.endsWith('/' + name)), `${name} remains eager through another export`);
  }
});
