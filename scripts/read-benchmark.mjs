import {execFileSync} from 'node:child_process';
import {appendFileSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {runRemainingReadBenchmark} from '../server/test-support/remaining-read-benchmark.mjs';

// Add one line per offline suite returning {scenarios: [{name, ...metrics}]}.
const benchmarks=[runRemainingReadBenchmark];
const baselineFile=new URL('../server/test-support/read-benchmark-baseline.json',import.meta.url);

export function compareReads(baseline,current) {
  const failures=[],lines=['| Scenario | Baseline pages | Current pages | Delta | Plan change |','| --- | ---: | ---: | ---: | --- |'];
  const previous=new Map(baseline.scenarios.map(row=>[row.name,row]));
  const seen=new Set();
  for(const row of current.scenarios) {
    if(seen.has(row.name))throw new Error(`Duplicate scenario: ${row.name}`);
    seen.add(row.name);
    if(!Number.isSafeInteger(row.pageFetches)||row.pageFetches<0)throw new Error(`Invalid page fetches: ${row.name}`);
    const old=previous.get(row.name);
    if(!old){failures.push(`${row.name}: missing baseline; review and update it`);lines.push(`| ${row.name} | — | ${row.pageFetches} | — | missing baseline |`);continue;}
    if(!Number.isSafeInteger(old.pageFetches)||old.pageFetches<0)throw new Error(`Invalid baseline: ${row.name}`);
    const delta=row.pageFetches-old.pageFetches;
    const newScan=row.fullScanTables.some(table=>!old.fullScanTables.includes(table));
    if(row.pageFetches>old.pageFetches*1.2+10)failures.push(`${row.name}: page fetches exceed baseline × 1.20 + 10`);
    if(newScan)failures.push(`${row.name}: new full scan of a large table`);
    const planChange=newScan?'NEW FULL SCAN':JSON.stringify(row.plan)===JSON.stringify(old.plan)?'unchanged':'changed';
    lines.push(`| ${row.name} | ${old.pageFetches} | ${row.pageFetches} | ${delta>0?'+':''}${delta} (${old.pageFetches?(delta/old.pageFetches*100).toFixed(1):'n/a'}%) | ${planChange} |`);
  }
  for(const [name,row] of previous)if(!seen.has(name)){
    failures.push(`${name}: scenario missing from current run`);
    lines.push(`| ${name} | ${row.pageFetches} | — | — | missing scenario |`);
  }
  return {failures,markdown:lines.join('\n')+'\n'+failures.map(message=>`\n- ${message}`).join('')+'\n'};
}

export function main(args=process.argv.slice(2)) {
  if(args.some(arg=>arg!=='--update-baseline'))throw new Error('Usage: npm run bench:reads -- [--update-baseline]');
  const result={version:1,sqliteVersion:execFileSync('sqlite3',['--version'],{encoding:'utf8'}).trim(),scenarios:benchmarks.flatMap(run=>run({ci:true}).scenarios)};
  const output=path.join(tmpdir(),'read-benchmark-result.json');
  writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(`Read benchmark result: ${output}`);
  if(args.includes('--update-baseline')) {
    const baseline={...result,scenarios:result.scenarios.map(({wallClockMs,...deterministic})=>deterministic)};
    writeFileSync(baselineFile,JSON.stringify(baseline,null,2)+'\n');
    console.log('Updated read benchmark baseline; review the diff.');
    return;
  }
  const comparison=compareReads(JSON.parse(readFileSync(baselineFile,'utf8')),result);
  console.log(comparison.markdown);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,comparison.markdown);
  if(comparison.failures.length)process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main();
