import test from 'node:test';
import assert from 'node:assert/strict';
import {renderReadBenchmarkReport,readBenchmarkRows,reportMarker} from './read-benchmark-report.mjs';

const profile={sqliteVersion:'pinned',nodeVersion:'v26.12.1',nodeSqliteVersion:'pinned'};
const row=(name,overrides={})=>({name,pageFetches:100,plan:['SEARCH items USING INDEX lookup (mep=?)'],fullScanTables:[],...overrides});
const baseline=scenarios=>({...profile,scenarios});
const result=scenarios=>({...profile,scenarios:scenarios.map(scenario=>({wallClockMs:12.5,...scenario}))});

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
