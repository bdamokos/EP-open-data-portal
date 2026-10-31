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
    assert.equal(dependency.identifier, dependency.name==='pdfjs-dist'?'Apache-2.0':'MIT', `review the licence for ${dependency.name}`);
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
    // Rolldown generates source-free re-export facades for shared lazy modules.
    // They have no original positions; every chunk containing source still needs a map.
    if (!chunk.map) {
      assert.equal(Object.keys(chunk.modules).length, 0, `missing source map for ${chunk.fileName}`);
      assert.match(chunk.code.slice(bannerOffset + banner.length).trim(), /^export\{[^}]+\}from["'][^"']+["'];?$/);
      continue;
    }
    // JSON data has no generated-code mappings. Code maps retain their offsets.
    if (!chunk.map.mappings) {
      assert(chunk.map.sources.every(source=>source.endsWith('.json')));
      continue;
    }
    const noticeLines = chunk.code.slice(0, bannerOffset + banner.length).split('\n').length;
    assert.ok(chunk.map.mappings.startsWith(';'.repeat(noticeLines)), 'source maps must account for the notice banner and preload helper');
  }

  const manifest = JSON.parse(result.output.find(file => file.fileName === '.vite/manifest.json').source);
  const emitted = new Set(Object.values(manifest).map(entry => entry.file));
  for (const chunk of chunks) assert(emitted.has(chunk.fileName), `chunk missing from immutable-asset manifest: ${chunk.fileName}`);
  const secondary = ['GroupVoices', 'Legislation', 'QuestionTopics', 'OutsideVoices', 'Saved', 'Amendments', 'MemberVotes', 'DocumentContextReader', 'MemberMotionReader', 'DossierVoteText'].map(name => `src/${name}.tsx`);
  const dynamic = manifest['index.html'].dynamicImports;
  assert.deepEqual(dynamic.filter(key=>!key.startsWith('src/ui-locales/')).sort(), [...secondary,'node_modules/pdfjs-dist/build/pdf.mjs'].sort());
  const languages='bg cs da de el es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' ');

  // Shared runtime chunks may own nested dynamic imports; the vote text and PDF
  // readers must retain lazy boundaries regardless of the emitted owner.
  assert(Object.values(manifest).some(entry=>entry.dynamicImports?.includes('src/DossierVoteText.tsx')), 'vote text reader must retain its own lazy boundary');
  const initial = new Set();
  function visit(key) {
    if (initial.has(key)) return;
    initial.add(key);
    for (const imported of manifest[key].imports || []) visit(imported);
  }
  visit('index.html');
  const localeImports=[...new Set([...initial].flatMap(key=>manifest[key].dynamicImports??[]))].filter(key=>key.startsWith('src/ui-locales/'));
  assert.deepEqual(localeImports.sort(),languages.map(language=>`src/ui-locales/${language}.json`).sort());
  for (const key of [...secondary,...languages.map(language=>`src/ui-locales/${language}.json`)]) assert(!initial.has(key), `${key} was pulled into the initial load`);
  const initialFiles = new Set([...initial].map(key => manifest[key].file));
  const initialSources = chunks.filter(chunk => initialFiles.has(chunk.fileName)).flatMap(chunk => chunk.map.sources);
  for (const name of ['Saved.tsx', 'Amendments.tsx', 'MemberVotes.tsx', 'DocumentContextReader.tsx', 'MemberMotionReader.tsx', 'DossierVoteText.tsx', 'MotionAmendments.tsx', 'europeMap.ts', 'TopicTrends.tsx', 'pdf.mjs']) {
    assert(!initialSources.some(source => source.endsWith('/' + name)), `${name} remains eager through another export`);
  }
});
