import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readdir, rm, stat, utimes, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CacheDiskBudget} from './cache-disk-budget.mjs';
import {documentNeedsRefresh, documentText} from './document-text.mjs';
import {DOCX_FORMATTING_VERSION} from './docx-formatting.mjs';

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

test('cache-only author enrichment never starts a download and returns saved text when available',async t=>{
  const directory=await fixture(t),url=`https://data.europarl.europa.eu/distribution/doc/cache-only-${Date.now()}.docx`,item=work(url);
  let calls=0;const download=async()=>{calls++;return {paragraphs:['Saved text'],authorBylineParagraphs:['Zoë Member, Alex Common'],formattingVersion:DOCX_FORMATTING_VERSION};};
  const empty=await documentText(item,'en',{directory,download,cacheOnly:true});
  assert.equal(empty.status,'unavailable');assert.equal(calls,0);
  await documentText(item,'en',{directory,download});
  const saved=await documentText(item,'en',{directory,download,cacheOnly:true,clock:()=>Date.now()+365*DAY});
  assert.deepEqual(saved.paragraphs,['Saved text']);assert.deepEqual(saved.authorBylineParagraphs,['Zoë Member, Alex Common']);assert.equal(calls,1);
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
  let calls = 0; const download = async () => ({paragraphs: [`version ${++calls}`], formattingVersion: DOCX_FORMATTING_VERSION, paragraphFormats: [{}], tables: []});
  const clock = () => Date.parse('2026-06-01T00:00:00Z');
  assert.deepEqual((await documentText(work(url), 'en', {directory, download, clock})).paragraphs, ['version 1']);
  const unchanged = await documentText(work(url), 'en', {directory, download, clock});
  assert.equal(unchanged.stale, false); assert.equal(calls, 1);
  const changed = await documentText(work(url, {byteSize: 2000}), 'en', {directory, download, clock});
  assert.equal(changed.stale, true); assert.deepEqual(changed.paragraphs, ['version 1']);
  // A download start does not prove that its cache publication has completed.
  let refreshed=changed;const deadline=performance.now()+5000;
  while(refreshed.refreshInProgress&&performance.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,20));
    refreshed=await documentText(work(url,{byteSize:2000}),'en',{directory,download,clock});
  }
  assert.equal(calls, 2);
  assert.equal(refreshed.refreshInProgress,false);
  assert.deepEqual(refreshed.paragraphs, ['version 2']);
});

test('the disk budget evicts the least recently read records and leaves other files alone', async t => {
  const root = await fixture(t), directory = path.join(root, 'document-text-v1'); await mkdir(directory);
  let now = Date.parse('2026-06-01T00:00:00Z');
  const name = letter => letter.repeat(64) + '.json', uuid = n => `00000000-0000-4000-8000-00000000000${n}`;
  const put = async (file, age, size = 100) => {
    await writeFile(path.join(directory, file), 'x'.repeat(size));
    const time = new Date(now - age * DAY); await utimes(path.join(directory, file), time, time);
  };
  await put(name('a'), 3); await put(name('b'), 2); await put(name('c'), 1);
  await put('notes.json', 9, 500); await put('notes.json.' + uuid(2) + '.tmp', 9);
  await put(name('d') + '.' + uuid(0) + '.tmp', 1); await put(name('e') + '.' + uuid(1) + '.tmp', 0);
  const listing = async () => (await readdir(directory)).sort();
  const budget = new CacheDiskBudget(directory, {maxBytes: 300, maxEntries: 10, pattern: /^[0-9a-f]{64}\.json$/, clock: () => now});
  await budget.initialize();
  // Only this cache's interrupted writes are removed, and only once they are old.
  assert.deepEqual(await listing(), [name('a'), name('b'), name('c'), name('e') + '.' + uuid(1) + '.tmp', 'notes.json', 'notes.json.' + uuid(2) + '.tmp'].sort());
  budget.used(name('a'));
  await put(name('f'), 0); await budget.saved(name('f'), 100);
  // b is now the least recently read; a was read today. Unrelated JSON is never counted or removed.
  assert.deepEqual((await listing()).filter(file => /^[0-9a-f]{64}\.json$/.test(file)), [name('a'), name('c'), name('f')]);
  assert.equal(budget.bytes, 300); assert((await listing()).includes('notes.json'));
  // Read recency survives a restart through the file time.
  assert((await stat(path.join(directory, name('a')))).mtimeMs >= now - 1000);
  now += DAY;
  const restarted = new CacheDiskBudget(directory, {maxBytes: 200, maxEntries: 10, pattern: /^[0-9a-f]{64}\.json$/, clock: () => now});
  await restarted.initialize();
  assert.deepEqual((await listing()).filter(file => /^[0-9a-f]{64}\.json$/.test(file)), [name('a'), name('f')]);
  // A record larger than the whole budget is not kept on disk.
  await put(name('9'), 0, 250); await restarted.saved(name('9'), 250);
  assert(!(await listing()).includes(name('9'))); assert.equal(restarted.bytes, 200);
});

test('a missing file size is not recorded as zero', async t => {
  const directory = await fixture(t), url = `https://data.europarl.europa.eu/distribution/doc/no-size-${Date.now()}.docx`;
  let calls = 0; const download = async () => ({paragraphs: [`version ${++calls}`], formattingVersion: DOCX_FORMATTING_VERSION, paragraphFormats: [{}], tables: []});
  const clock = () => Date.parse('2026-06-01T00:00:00Z');
  await documentText(work(url, {byteSize: null}), 'en', {directory, download, clock});
  const later = await documentText(work(url, {byteSize: 1000}), 'en', {directory, download, clock});
  assert.equal(later.stale, false); assert.equal(calls, 1);
});

test('a failed cache scan is retried on the next use', async t => {
  const root = await fixture(t), directory = path.join(root, 'document-text-v1');
  await writeFile(directory, 'not a directory');
  const budget = new CacheDiskBudget(directory, {maxBytes: 100, maxEntries: 10, pattern: /^[0-9a-f]{64}\.json$/});
  await assert.rejects(budget.initialize(), {code: 'ENOTDIR'});
  await rm(directory); await mkdir(directory); await writeFile(path.join(directory, 'a'.repeat(64) + '.json'), 'x'.repeat(10));
  await budget.initialize(); assert.equal(budget.bytes, 10);
});

test('a text saved before formatting stays readable and is re-read once in the background', async t => {
  const directory = await fixture(t), url = `https://data.europarl.europa.eu/distribution/doc/unformatted-${Date.now()}.docx`;
  const clock = () => Date.parse('2026-06-01T00:00:00Z');
  let calls = 0; const download = async () => ++calls === 1 ? {paragraphs: ['saved text']} : {paragraphs: ['saved text'], formattingVersion: DOCX_FORMATTING_VERSION, paragraphFormats: [{align: 'center'}], tables: []};
  assert.equal((await documentText(work(url), 'en', {directory, download, clock})).formatStatus, 'not-extracted');
  const upgrading = await documentText(work(url), 'en', {directory, download, clock});
  assert.deepEqual(upgrading.paragraphs, ['saved text']); assert.equal(upgrading.stale, false); assert.equal(upgrading.refreshInProgress, true);
  let upgraded;
  for (let attempt = 0; attempt < 200; attempt++) {
    upgraded = await documentText(work(url), 'en', {directory, download, clock});
    if (!upgraded.refreshInProgress) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(upgraded.formatStatus, 'extracted'); assert.deepEqual(upgraded.paragraphFormats, [{align: 'center'}]);
  assert.equal(calls, 2);
});
