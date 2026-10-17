import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readdir, rm, stat, utimes, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CacheDiskBudget} from './cache-disk-budget.mjs';
import {documentNeedsRefresh, documentText} from './document-text.mjs';

const DAY = 86400_000;
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'document-retention-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}
const work = (url, {date = '2026-01-10', byteSize = 1000, issued = '2026-01-10T10:00:00+01:00'} = {}) => ({
  identifier: 'TA-10-2026-0001', document_date: date,
  is_realized_by: [{language: 'language/ENG', is_embodied_by: [{format: 'file-type/DOCX', is_exemplified_by: url, byteSize, issued}]}],
});

test('settled texts are never re-read, recent ones weekly, and a changed file listing at once', () => {
  const source = {byteSize: 1000, issued: '2026-01-10T10:00:00+01:00'}, item = work('https://data.europarl.europa.eu/distribution/doc/a.docx');
  const at = days => new Date(Date.parse('2026-01-10') + days * DAY).toISOString();
  // Retrieved 60 days after publication: settled, however long ago.
  assert.equal(documentNeedsRefresh({fetchedAt: at(60), source}, item, source, Date.parse(at(900))), false);
  // Retrieved soon after publication: re-read only after a week.
  assert.equal(documentNeedsRefresh({fetchedAt: at(5), source}, item, source, Date.parse(at(11))), false);
  assert.equal(documentNeedsRefresh({fetchedAt: at(5), source}, item, source, Date.parse(at(12))), true);
  // A different size or issue time is a re-publication, even for a settled text.
  assert.equal(documentNeedsRefresh({fetchedAt: at(90), source}, item, {...source, byteSize: 1001}, Date.parse(at(91))), true);
  assert.equal(documentNeedsRefresh({fetchedAt: at(90), source}, item, {...source, issued: '2026-03-01T10:00:00+01:00'}, Date.parse(at(91))), true);
  // Records saved before descriptors existed, or listings without them, use the age rule.
  assert.equal(documentNeedsRefresh({fetchedAt: at(90)}, item, {...source, byteSize: 5}, Date.parse(at(91))), false);
  // Without any publication date the text is never treated as settled.
  assert.equal(documentNeedsRefresh({fetchedAt: at(90)}, {...item, document_date: undefined}, {byteSize: null, issued: null}, Date.parse(at(97))), true);
});

test('a changed file listing refreshes a saved text in the background', async t => {
  const directory = await fixture(t), url = `https://data.europarl.europa.eu/distribution/doc/changed-${Date.now()}.docx`;
  let calls = 0; const download = async () => ({paragraphs: [`version ${++calls}`]});
  const clock = () => Date.parse('2026-06-01T00:00:00Z');
  assert.deepEqual((await documentText(work(url), 'en', {directory, download, clock})).paragraphs, ['version 1']);
  const unchanged = await documentText(work(url), 'en', {directory, download, clock});
  assert.equal(unchanged.stale, false); assert.equal(calls, 1);
  const changed = await documentText(work(url, {byteSize: 2000}), 'en', {directory, download, clock});
  assert.equal(changed.stale, true); assert.deepEqual(changed.paragraphs, ['version 1']);
  // The shared upstream queue spaces requests, so the refresh starts a little later.
  for (let waited = 0; calls < 2 && waited < 5000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(calls, 2);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual((await documentText(work(url, {byteSize: 2000}), 'en', {directory, download, clock})).paragraphs, ['version 2']);
});

test('the disk budget evicts the least recently read records and leaves other files alone', async t => {
  const root = await fixture(t), directory = path.join(root, 'document-text-v1'); await mkdir(directory);
  let now = Date.parse('2026-06-01T00:00:00Z');
  const put = async (name, age) => {
    const file = path.join(directory, name); await writeFile(file, 'x'.repeat(100));
    const time = new Date(now - age * DAY); await utimes(file, time, time);
  };
  await put('a.json', 3); await put('b.json', 2); await put('c.json', 1);
  await writeFile(path.join(directory, 'notes.txt'), 'unrelated');
  await put('d.json.00000000-0000-4000-8000-000000000000.tmp', 1);
  await put('e.json.00000000-0000-4000-8000-000000000001.tmp', 0);
  const budget = new CacheDiskBudget(directory, {maxBytes: 300, maxEntries: 10, clock: () => now});
  await budget.initialize();
  // An interrupted write from an earlier process is removed; a fresh one may still be in flight.
  assert.deepEqual((await readdir(directory)).sort(), ['a.json', 'b.json', 'c.json', 'e.json.00000000-0000-4000-8000-000000000001.tmp', 'notes.txt']);
  budget.used('a.json');
  await writeFile(path.join(directory, 'f.json'), 'x'.repeat(100)); await budget.saved('f.json', 100);
  // b is now the least recently read; a was read today.
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.json')).sort(), ['a.json', 'c.json', 'f.json']);
  assert.equal(budget.bytes, 300);
  // Read recency survives a restart through the file time.
  assert((await stat(path.join(directory, 'a.json'))).mtimeMs >= now - 1000);
  now += DAY;
  const restarted = new CacheDiskBudget(directory, {maxBytes: 200, maxEntries: 10, clock: () => now});
  await restarted.initialize();
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.json')).sort(), ['a.json', 'f.json']);
});
