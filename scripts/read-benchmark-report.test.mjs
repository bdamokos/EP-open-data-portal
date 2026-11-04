import test from 'node:test';
import assert from 'node:assert/strict';
import {renderReadBenchmarkReport,readBenchmarkRows,reportMarker,readBenchmarkHasFindings,main} from './read-benchmark-report.mjs';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

const profile={sqliteVersion:'pinned',nodeVersion:'v26.12.1',nodeSqliteVersion:'pinned'};
const row=(name,overrides={})=>({name,pageFetches:100,plan:['SEARCH items USING INDEX lookup (mep=?)'],fullScanTables:[],...overrides});
const baseline=scenarios=>({...profile,scenarios});
const result=scenarios=>({...profile,scenarios:scenarios.map(scenario=>({wallClockMs:12.5,...scenario}))});

test('only benchmark gate failures trigger comments; neutral changes and missing comparisons do not',()=>{
  const before=baseline([row('query')]);
  for(const pageFetches of [80,100,130])assert.equal(readBenchmarkHasFindings(before,result([row('query',{pageFetches})])),'false');
  assert.equal(readBenchmarkHasFindings(before,result([row('query',{pageFetches:131})])),'true');
  assert.equal(readBenchmarkHasFindings(before,result([row('query',{fullScanTables:['items']})])),'true');
  assert.equal(readBenchmarkHasFindings(before,result([row('query',{plan:['SEARCH items USING INDEX other']}),row('new')])),'false');
  assert.equal(readBenchmarkHasFindings(undefined,result([row('query')])),'unavailable');
  assert.equal(readBenchmarkHasFindings(before,undefined),'unavailable');
});

test('benchmark CLI exposes the findings verdict to Actions independently of the report',t=>{
  const directory=mkdtempSync(join(tmpdir(),'read-report-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const before=join(directory,'before.json'),after=join(directory,'after.json'),output=join(directory,'output');
  writeFileSync(before,JSON.stringify(baseline([row('query')])));
  for(const [pages,verdict] of [[100,'false'],[200,'true']]) {
    writeFileSync(after,JSON.stringify(result([row('query',{pageFetches:pages})])));
    writeFileSync(output,'');
    main(['--before',before,'--after',after],{GITHUB_OUTPUT:output});
    assert.equal(readFileSync(output,'utf8'),`has_findings=${verdict}\n`);
  }
});

test('benchmark comment job posts only findings and deletes resolved comments for the current head',t=>{
  const workflow=readFileSync(new URL('../.github/workflows/checks.yml',import.meta.url),'utf8');
  const job=workflow.split('\n  read-benchmark-comment:')[1].split('\n  translation-coverage:')[0];
  assert.match(job,/has_findings == 'true'[\s\S]*has_findings == 'false'/);
  const source=job.split('        run: |\n')[1].split('\n').map(line=>line.slice(10)).join('\n');
  const directory=mkdtempSync(join(tmpdir(),'read-comment-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const calls=join(directory,'calls');
  writeFileSync(join(directory,'gh'),`#!/bin/bash
printf '%s\\n' "$*" >> "$GH_CALLS"
if [[ "$*" == *"--method"* ]]; then exit 0; fi
if [[ "$2" == "repos/owner/repo/pulls/1" ]]; then
  printf '%s\\n' "$FIXTURE_PR"
else
  for filter in "$@"; do :; done
  printf '%s\\n' "$FIXTURE_COMMENTS" | jq -r "$filter"
fi
`,{mode:0o755});
  for(const [hasFindings,id,current,method] of [
    ['true','','open abc','POST'],['true','8','open abc','PATCH'],
    ['false','8','open abc','DELETE'],['false','','open abc',undefined],
    ['true','8','open stale',undefined],['false','8','closed abc',undefined],
  ]) {
    writeFileSync(calls,'');
    const comments=[
      {id:7,user:{login:'human'},body:reportMarker},
      ...(id?[{id:Number(id),user:{login:'github-actions[bot]'},body:reportMarker+'\nfindings'}]:[]),
      {id:9,user:{login:'github-actions[bot]'},body:'An unrelated bot comment'},
    ];
    execFileSync('bash',['-e','-o','pipefail','-c',source],{env:{...process.env,PATH:`${directory}:${process.env.PATH}`,GH_CALLS:calls,FIXTURE_PR:current,FIXTURE_COMMENTS:JSON.stringify(comments),REPO:'owner/repo',PR:'1',EXPECTED_HEAD:'abc',REPORT:reportMarker,RUNNER_TEMP:directory,HAS_FINDINGS:hasFindings}});
    const writes=readFileSync(calls,'utf8').split('\n').filter(line=>line.includes('--method'));
    assert.equal(writes.length,method?1:0);
    if(method) {
      assert(writes[0].includes(`--method ${method} `));
      assert(writes[0].includes(method==='POST'?'repos/owner/repo/issues/1/comments':`repos/owner/repo/issues/comments/${id}`));
    }
  }
});

test('report lists only changed scenarios up front and every scenario in the details',()=>{
  const before=baseline([row('same'),row('grew'),row('shrank'),row('gone')]);
  const after=result([row('same'),row('grew',{pageFetches:125}),row('shrank',{pageFetches:80}),row('added',{pageFetches:7})]);
  const markdown=renderReadBenchmarkReport({before,after,beforeLabel:'main',afterLabel:'PR'});
  const [summary,details]=markdown.split('<details>');
  assert.ok(markdown.startsWith(reportMarker));
  assert.match(summary,/4 changed/);
  assert.match(summary,/total pages 400 → 312 \(-22\.0%\)/);
  assert.match(summary,/\| main pages \| PR pages \| Δ pages \| PR ms \|/);
  assert.match(summary,/\| grew \| 100 \| 125 \| \+25 \(\+25\.0%\) \| 12\.5 \| unchanged \|/);
  assert.match(summary,/\| shrank \| 100 \| 80 \| -20 \(-20\.0%\) \|/);
  assert.match(summary,/\| added \| — \| 7 \| — \| 12\.5 \| new scenario \|/);
  assert.match(summary,/\| gone \| 100 \| — \| — \| — \| removed \|/);
  assert.doesNotMatch(summary,/\| same \|/);
  assert.match(details,/All 5 scenarios/);
  assert.match(details,/\| same \| 100 \| 100 \| 0 \|/);
});

test('plan changes and new full scans count as changes without page growth',()=>{
  const rows=readBenchmarkRows(baseline([row('plan'),row('scan')]),result([
    row('plan',{plan:['SEARCH items USING INDEX other (mep=?)']}),
    row('scan',{fullScanTables:['items']}),
  ]));
  assert.deepEqual(rows.map(({name,plan,changed})=>({name,plan,changed})),[
    {name:'plan',plan:'changed',changed:true},
    {name:'scan',plan:'**new full scan**',changed:true},
  ]);
});

test('gate verdict uses the measured base',()=>{
  const before=baseline([row('query')]);
  const after=result([row('query',{pageFetches:200})]);
  assert.match(renderReadBenchmarkReport({before,after}),/\*\*Gate failed\*\* \(1\)/);
  assert.match(renderReadBenchmarkReport({before,after:result([row('query',{pageFetches:130})])}),/\*\*Gate passed\*\*/);
});

test('missing inputs stay explicit',()=>{
  assert.match(renderReadBenchmarkReport({after:undefined,runUrl:'https://example.test/run'}),/did not produce results[\s\S]*\(https:\/\/example\.test\/run\)/);
  const noBefore=renderReadBenchmarkReport({after:result([row('query')]),beforeLabel:'main'});
  assert.match(noBefore,/No main baseline was available/);
  assert.doesNotMatch(noBefore,/total pages/);
  assert.match(renderReadBenchmarkReport({before:baseline([row('query')]),after:result([row('query')])}),/No page-count or query-plan changes/);
});

test('scenario names cannot break the table',()=>{
  assert.match(renderReadBenchmarkReport({before:baseline([row('a|b')]),after:result([row('a|b',{pageFetches:1})])}),/\| a\\\|b \|/);
});

test('new and removed scenarios pass and both toolchains are recorded',()=>{
  const before={...baseline([row('removed')]),sqliteVersion:'old-cli',nodeSqliteVersion:'old-node'};
  const after={...result([row('new')]),sqliteVersion:'new-cli',nodeSqliteVersion:'new-node'};
  const report=renderReadBenchmarkReport({before,after});
  assert.match(report,/Gate passed/);
  for(const value of ['old-cli','old-node','new-cli','new-node','removed','new scenario'])assert.ok(report.includes(value));
});

test('report identifies content and cache provenance for both sides',()=>{
  const before={...baseline([row('a')]),commit:'base-sha',tree:'base-tree'};
  const after={...result([row('a')]),commit:'head-sha',tree:'head-tree'};
  const report=renderReadBenchmarkReport({before,after,beforeSource:'restored from cache',afterSource:'measured'});
  assert.match(report,/Before: restored from cache; commit base-sha; tree base-tree/);
  assert.match(report,/After: measured; commit head-sha; tree head-tree/);
});
