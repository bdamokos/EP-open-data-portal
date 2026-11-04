import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {compareCatalogues, renderReport, markdown, annotation, readRevision, diffBase, run, LANGUAGES, MARKER} from './translation-coverage-report.mjs';

function snapshot(english = {label: 'Old'}) {
  return {english, locales: Object.fromEntries(LANGUAGES.map(language => [language, Object.fromEntries(Object.keys(english).map(key => [key, 'Native']))])), pairs: [], forms: {}};
}
const clone = value => structuredClone(value);

test('a stale feature branch does not report unrelated English changes added later on main',t=>{
  const dir=mkdtempSync(join(process.env.TEST_TMPDIR||tmpdir(),'translation-branches-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const commit=()=>{git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);return git(['rev-parse','HEAD']);};
  git(['init']);mkdirSync(join(dir,'src/ui-locales'),{recursive:true});const file=join(dir,'src/ui-locales/en.json');
  writeFileSync(file,JSON.stringify({label:'Original'}));const common=commit();
  writeFileSync(file,JSON.stringify({label:'Changed only on main'}));const main=commit();
  git(['checkout','-b','feature',common]);writeFileSync(join(dir,'unrelated.txt'),'Feature');const head=commit();
  assert.equal(diffBase(main,head,dir),common);
  assert(compareCatalogues(readRevision(main,dir),readRevision(head,dir)).length>0);
  assert.deepEqual(compareCatalogues(readRevision(diffBase(main,head,dir),dir),readRevision(head,dir)),[]);
});

test('added English keys name selected missing locales, including Topics and vote groups', () => {
  const base = snapshot({}), head = snapshot({'topics.new': 'New', 'votegroups.new': 'New'});
  delete head.locales.hu['topics.new']; delete head.locales.fr['topics.new']; delete head.locales.ro['votegroups.new'];
  const rows = compareCatalogues(base, head);
  assert.deepEqual(rows[0].missing, ['fr', 'hu']); assert.deepEqual(rows[1].missing, ['ro']);
  assert.deepEqual(rows[0].drift, []);
});
test('empty native values count as missing; equality with English is valid', () => {
  const base = snapshot({}), head = snapshot({label: 'Native'});
  head.locales.hu.label = '  '; head.locales.fr.label = '';
  assert.deepEqual(compareCatalogues(base, head)[0].missing, ['fr', 'hu']);
});
test('changed English with unchanged target values gives prominent drift warnings', () => {
  const base = snapshot(), head = clone(base); head.english.label = 'New';
  const rows = compareCatalogues(base, head);
  assert.deepEqual(rows[0].drift, LANGUAGES);
  assert.match(renderReport(rows), /\*\*Potential translation drift — verify before merging\*\*/);
  assert.match(renderReport(rows), /Verification before merge is required/);
});
test('relevant target updates count, even if updated text equals English', () => {
  const base = snapshot(), head = clone(base); head.english.label = 'New'; head.locales.hu.label = 'New';
  assert(!compareCatalogues(base, head)[0].drift.includes('hu'));
});
test('unrelated target updates do not hide drift', () => {
  const base = snapshot(), head = clone(base); head.english.label = 'New'; head.locales.hu.unrelated = 'New';
  assert(compareCatalogues(base, head)[0].drift.includes('hu'));
});
test('changed English with missing or empty targets reports drift and missing scope', () => {
  const base = snapshot(), head = clone(base); head.english.label = 'New'; delete head.locales.hu.label; head.locales.fr.label = ' ';
  const row = compareCatalogues(base, head)[0];
  assert.deepEqual(row.missing, ['fr', 'hu']); assert(row.drift.includes('hu')); assert(row.drift.includes('fr'));
});
test('pair siblings and unrelated native categories cannot clear an untouched English branch', () => {
  const base = snapshot({one: 'One', other: 'Many'}); base.pairs = [{one: 'one', other: 'other', count: 'count'}];
  base.forms.pl = {other: {few: 'Few'}};
  const head = clone(base); head.english.one = 'Changed one'; head.locales.hu.other = 'Changed many'; head.forms.pl.other.few = 'Changed few';
  const row = compareCatalogues(base, head)[0];
  assert(row.drift.includes('hu')); assert(row.drift.includes('pl')); assert(row.drift.includes('fr'));
});
test('unrelated plural-family changes do not hide drift', () => {
  const base = snapshot(), head = clone(base); head.english.label = 'New'; head.forms.pl = {unrelated: {few: 'New'}};
  assert(compareCatalogues(base, head)[0].drift.includes('pl'));
});
test('partial supplemental updates for a directly counted message retain drift', () => {
  const base = snapshot(), head = clone(base); head.english.label = 'New'; head.forms.pl = {label: {few: 'New'}};
  assert(compareCatalogues(base, head)[0].drift.includes('pl'));
});
test('effective override precedence prevents dictionary edits from hiding unchanged runtime text', () => {
  const base = snapshot({one:'One',other:'Many'}); base.pairs=[{one:'one',other:'other',count:'count'}];
  base.forms.hu={other:{one:'Retained'}};
  const head=clone(base); head.english.one='New one'; head.locales.hu.one='New native one';
  assert(compareCatalogues(base,head)[0].drift.includes('hu'));
  head.forms.hu.other.one='Updated native one';
  assert(!compareCatalogues(base,head)[0].drift.includes('hu'));
});
test('override-only native translations are available but unchanged values still warn of drift', () => {
  const base=snapshot({one:'One',other:'Many'});base.pairs=[{one:'one',other:'other',count:'count'}];
  const head=clone(base);head.english.other='Changed many';delete head.locales.pl.other;
  head.forms.pl={other:{other:'Native'}};
  const row=compareCatalogues(base,head)[0];assert(!row.missing.includes('pl'));assert(row.drift.includes('pl'));
  head.forms.pl.other.other='';assert(compareCatalogues(base,head)[0].missing.includes('pl'));
});
test('English other changes include native one when zero or 21 selects it',()=>{
  const base=snapshot({one:'One',other:'Many'});base.pairs=[{one:'one',other:'other',count:'count'}];
  const head=clone(base);head.english.other='Changed many';head.locales.fr.other='Updated plural';head.locales.lt.other='Updated plural';head.locales.hu.other='Updated plural';
  const row=compareCatalogues(base,head)[0];assert(row.drift.includes('fr'));assert(row.drift.includes('lt'));assert(!row.drift.includes('hu'));
});
for (const mode of ['added','removed']) test(`pair metadata ${mode} uses the actual scalar output in the unpaired revision`,()=>{
  const base=snapshot({one:'One',other:'Many'});
  for(const language of LANGUAGES)base.locales[language]={one:'Native one',other:'Native other'};
  const head=clone(base);head.english.other='Changed many';
  (mode==='added'?head:base).pairs=[{one:'one',other:'other',count:'count'}];
  for(const language of LANGUAGES)head.locales[language].other='Updated native other';
  assert.deepEqual(compareCatalogues(base,head),[]);
});
test('reports identify GitHub Actions execution without model attribution',()=>{
  const row={key:'key',value:'Changed',missing:['hu'],drift:['fr']};
  for(const report of [renderReport([]),renderReport([row]),run({TRANSLATION_BASE:'invalid',TRANSLATION_HEAD:'invalid'})]){
    assert.match(report,/Deterministic catalogue comparison; no linguistic verification/);
    assert(report.endsWith('Automated report generated by GitHub Actions.\n'));
    assert.doesNotMatch(report, /gpt-|claude-|coding agent|independent review:/i);
  }
});
test('removed and renamed keys do not report missing translations for removed IDs', () => {
  const base = snapshot(), head = snapshot({renamed: 'Old'});
  assert.deepEqual(compareCatalogues(base, snapshot({})), []);
  delete head.locales.hu.renamed;
  assert.deepEqual(compareCatalogues(base, head).map(row => row.key), ['renamed']);
});
test('only narrow Romanian and Lithuanian grammatical branches are excluded', () => {
  const base = snapshot({}), head = snapshot({'MotionComparison.contextStage.test': 'Stage', 'membervotesummary.fullPosition.test': 'Position', 'membervotes.summary.recorded.test': 'Recorded'});
  head.locales = {};
  assert.deepEqual(compareCatalogues(base, head).map(row => row.missing), [['ro'], ['lt', 'ro'], ['lt', 'ro']]);
});
test('Markdown and annotation escaping prevents raw markup, mentions and commands', () => {
  const hostile = '<script>@all [x](url) `code`\n::warning::x%\r|';
  const escaped = markdown(hostile);
  assert(!/[<>@`\n\r|]/.test(escaped)); assert(!escaped.includes('::warning::')); assert(!escaped.includes('[x]'));
  assert.equal(annotation('x%\r\n::error::oops'), 'x%25%0D%0A::error::oops');
});
test('large reports and annotations stay bounded without dropping language totals', () => {
  const row = {key: '🔥'.repeat(1000), value: '<'.repeat(1000), missing: ['hu'], drift: ['fr']};
  const report = renderReport(Array.from({length: 300}, () => row));
  assert(Buffer.byteLength(report) < 48000); assert.match(report, /additional messages omitted/); assert.match(report, /Missing translation languages: hu/);
  assert(annotation('a'.repeat(3000)).length <= 1800);
});
test('a clean report uses the same marker and explicitly clears stale findings', () => {
  assert.deepEqual(compareCatalogues(snapshot(), snapshot()), []);
  assert(renderReport([]).startsWith(MARKER)); assert.match(renderReport([]), /Previous findings are cleared/);
});
test('git reader uses exact revisions and rejects malformed refs/JSON; CLI fails advisory', t => {
  const dir = mkdtempSync(join(process.env.TEST_TMPDIR || tmpdir(), 'translation-git-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const git = args => execFileSync('git', args, {cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git(['init']); mkdirSync(join(dir, 'src/ui-locales'), {recursive: true});
  const file = join(dir, 'src/ui-locales/en.json'); writeFileSync(file, '{"a":"A"}');
  git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  const sha = git(['rev-parse', 'HEAD']); assert.deepEqual(readRevision(sha, dir).english, {a: 'A'});
  for (const ref of ['HEAD', '--help', 'a'.repeat(40), sha + ':x']) assert.throws(() => readRevision(ref, dir));
  writeFileSync(file, '{"a":"Changed"}'); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'changed']);
  const changed = git(['rev-parse', 'HEAD']);
  const statusOutput = join(dir, 'status-output'), statusSummary = join(dir, 'status-summary');
  for (const [head, expected] of [[sha, 'false'], [changed, 'true']]) {
    writeFileSync(statusOutput, ''); writeFileSync(statusSummary, '');
    execFileSync(process.execPath, [fileURLToPath(new URL('./translation-coverage-report.mjs', import.meta.url))], {
      cwd: dir, env: {...process.env, TRANSLATION_BASE: sha, TRANSLATION_HEAD: head, GITHUB_OUTPUT: statusOutput, GITHUB_STEP_SUMMARY: statusSummary},
    });
    assert(readFileSync(statusOutput, 'utf8').startsWith(`has_findings=${expected}\n`));
    assert(readFileSync(statusSummary, 'utf8').startsWith(MARKER));
  }
  writeFileSync(file, '{bad'); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'malformed']);
  assert.throws(() => readRevision(git(['rev-parse', 'HEAD']), dir));
  const output = join(dir, 'output'), summary = join(dir, 'summary');
  const report = run({TRANSLATION_BASE: '--help', TRANSLATION_HEAD: sha, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary});
  assert.match(report, /comparison unavailable/); assert.equal(readFileSync(summary, 'utf8'), report);
  const lines = readFileSync(output, 'utf8').trimEnd().split('\n');
  assert.equal(lines[0], 'has_findings=unavailable');
  assert.equal(lines[1].slice('report<<'.length), lines.at(-1));
});
test('comment job has no checkout/PR execution and preserves the existing workflow', () => {
  const workflow = readFileSync(new URL('../.github/workflows/checks.yml', import.meta.url), 'utf8');
  const comment = workflow.split('\n  translation-coverage-comment:')[1];
  assert(!/uses:|checkout|pull_request_target/.test(comment)); assert.match(comment, /pull-requests: write/);
  assert.match(comment, /head.repo.full_name == github.repository/); assert.match(comment, /dependabot/);
  assert.match(comment, /comment.user\?\.login === 'github-actions\[bot\]'/); assert.match(comment, /pr.head.sha !== EXPECTED_HEAD/);
  assert.match(comment, /catch \{/); assert.match(comment, /existing \? 'PATCH' : 'POST'/);
  for (const job of ['test-and-build', 'runtime-image', 'read-benchmarks', 'read-benchmark-comment']) assert(workflow.includes(`  ${job}:`));
});

async function commentHarness(report, {comments = [], deny = false, stale = false, hasFindings = 'true'} = {}) {
  const workflow = readFileSync(new URL('../.github/workflows/checks.yml', import.meta.url), 'utf8');
  const source = workflow.split('  translation-coverage-comment:')[1].split("node --input-type=module <<'JS'\n")[1].split('\n          JS')[0];
  const calls = [], warnings = [];
  const fakeProcess = {env: {GH_TOKEN: 'fixture', REPO: 'owner/repo', PR: '1', EXPECTED_HEAD: 'abc', REPORT: report, HAS_FINDINGS: hasFindings}, exit() { throw new Error('exit'); }};
  const fetch = async (url, options) => {
    calls.push({url, ...options});
    return {ok: !deny, status: options.method === 'DELETE' ? 204 : 200, json: async () => {
      assert.notEqual(options.method, 'DELETE', '204 responses have no JSON body');
      return url.includes('/pulls/') ? {state: 'open', head: {sha: stale ? 'other' : 'abc'}} : options.method === 'GET' ? comments : {id: 1};
    }};
  };
  await new (Object.getPrototypeOf(async function() {}).constructor)('process', 'fetch', 'console', 'AbortSignal', source)(fakeProcess, fetch, {log: message => warnings.push(message)}, {timeout: () => undefined});
  return {calls, warnings};
}

test('a clean comparison deletes stale findings without posting a neutral comment', async () => {
  const report = renderReport([]);
  const {calls, warnings} = await commentHarness(report, {hasFindings: 'false', comments: [
    {id: 7, user: {login: 'human', type: 'User'}, body: MARKER},
    {id: 8, user: {login: 'github-actions[bot]', type: 'Bot'}, body: MARKER + '\nold findings'},
  ]});
  const writes = calls.filter(call => call.method !== 'GET');
  assert.equal(writes.length, 1); assert.equal(writes[0].method, 'DELETE'); assert(writes[0].url.endsWith('/issues/comments/8'));
  assert.deepEqual(warnings, []);
  const clean = await commentHarness(report, {hasFindings: 'false'});
  assert(!clean.calls.some(call => call.method !== 'GET'));
});
test('unavailable or missing findings status leaves existing comments untouched', async () => {
  for (const hasFindings of ['unavailable', undefined, '']) {
    const {calls} = await commentHarness(renderReport([]), {hasFindings: hasFindings ?? ''});
    assert.deepEqual(calls, []);
  }
});
test('comment updater creates once when absent and leaves permission failures advisory', async () => {
  const report = renderReport([{key: 'label', value: 'New', missing: ['hu'], drift: []}]);
  const {calls} = await commentHarness(report);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  const updated = await commentHarness(report, {comments: [{id: 8, user: {login: 'github-actions[bot]', type: 'Bot'}, body: MARKER}]});
  const patch = updated.calls.find(call => call.method === 'PATCH');
  assert(patch.url.endsWith('/issues/comments/8')); assert.equal(JSON.parse(patch.body).body, report);
  const denied = await commentHarness(report, {deny: true});
  assert.equal(denied.calls.length, 1); assert.match(denied.warnings[0], /comment unavailable/);
  const stale = await commentHarness(report, {stale: true});
  assert(!stale.calls.some(call => call.method !== 'GET'));
});

test('empty relevant supplemental forms cannot suppress drift with an apparent family update', () => {
  const base = snapshot(), head = clone(base); head.english.label = 'New'; head.forms.pl = {label: {few: ' '}};
  const row = compareCatalogues(base, head)[0]; assert(row.missing.includes('pl')); assert(row.drift.includes('pl'));
});
