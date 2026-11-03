import {runTopicsReadBenchmark} from '../server/test-support/topics-read-benchmark.mjs';
import {benchmarkIdentity,readBenchmarkResult} from './read-benchmark-cache.mjs';
import {runWeekCloudReadBenchmark} from '../server/test-support/week-cloud-read-benchmark.mjs';
import {execFileSync} from 'node:child_process';
import {appendFileSync,writeFileSync,readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runRemainingReadBenchmark} from '../server/test-support/remaining-read-benchmark.mjs';

import {runMemberReadBenchmark} from '../server/test-support/member-read-benchmark.mjs';

import {runSlowReadBenchmark} from '../server/test-support/slow-read-benchmark.mjs';

// Add one line per offline suite returning {scenarios: [{name, ...metrics}]}.
const benchmarks=[
  runTopicsReadBenchmark,
  runWeekCloudReadBenchmark,
  runRemainingReadBenchmark,
  runSlowReadBenchmark,
  runMemberReadBenchmark,
];
export function compareReads(baseline,current) {
  const failures=[],lines=['| Scenario | Baseline pages | Current pages | Delta | Current ms (informational) | Plan change |','| --- | ---: | ---: | ---: | ---: | --- |'];
  const previous=new Map(baseline.scenarios.map(row=>[row.name,row]));
  const seen=new Set();
  for(const row of current.scenarios) {
    if(seen.has(row.name))throw new Error(`Duplicate scenario: ${row.name}`);
    seen.add(row.name);
    if(!Number.isSafeInteger(row.pageFetches)||row.pageFetches<0)throw new Error(`Invalid page fetches: ${row.name}`);
    const old=previous.get(row.name);
    if(!old){lines.push(`| ${row.name} | — | ${row.pageFetches} | — | ${row.wallClockMs} | new scenario |`);continue;}
    if(!Number.isSafeInteger(old.pageFetches)||old.pageFetches<0)throw new Error(`Invalid baseline: ${row.name}`);
    const delta=row.pageFetches-old.pageFetches;
    const newScan=row.fullScanTables.some(table=>!old.fullScanTables.includes(table));
    if(row.pageFetches>old.pageFetches*1.2+10)failures.push(`${row.name}: page fetches exceed baseline × 1.20 + 10`);
    if(newScan)failures.push(`${row.name}: new full scan of a large table`);
    const planChange=newScan?'NEW FULL SCAN':JSON.stringify(row.plan)===JSON.stringify(old.plan)?'unchanged':'changed';
    lines.push(`| ${row.name} | ${old.pageFetches} | ${row.pageFetches} | ${delta>0?'+':''}${delta} (${old.pageFetches?(delta/old.pageFetches*100).toFixed(1):'n/a'}%) | ${row.wallClockMs} | ${planChange} |`);
  }
  for(const [name,row] of previous)if(!seen.has(name)){
    lines.push(`| ${name} | ${row.pageFetches} | — | — | — | removed |`);
  }
  return {failures,markdown:lines.join('\n')+'\n'+failures.map(message=>`\n- ${message}`).join('')+'\n'};
}

// Run the reference's own suite registry, including older scripts that exit non-zero
// against their committed baseline. A missing or malformed result still fails.
export function measureReference(ref,{cwd=fileURLToPath(new URL('..',import.meta.url))}={}) {
  const revision=execFileSync('git',['rev-parse','--verify',`${ref}^{commit}`],{cwd,encoding:'utf8'}).trim();
  const directory=mkdtempSync(path.join(tmpdir(),'read-benchmark-'));
  const worktree=path.join(directory,'base'),baseTmp=path.join(directory,'tmp');
  let added=false;
  try {
    mkdirSync(baseTmp);
    execFileSync('git',['worktree','add','--detach',worktree,revision],{cwd,stdio:'inherit'});
    added=true;
    const env={...process.env,TMPDIR:baseTmp,TMP:baseTmp,TEMP:baseTmp};
    delete env.GITHUB_STEP_SUMMARY;
    execFileSync('npm',['ci','--no-audit','--no-fund'],{cwd:worktree,env,stdio:'inherit'});
    try {
      execFileSync(process.execPath,['scripts/read-benchmark.mjs'],{cwd:worktree,env,stdio:'inherit'});
    } catch(error) {
      if(!Number.isInteger(error.status))throw error;
    }
    return {revision,result:JSON.parse(readFileSync(path.join(baseTmp,'read-benchmark-result.json'),'utf8'))};
  } finally {
    try {
      if(added)execFileSync('git',['worktree','remove','--force',worktree],{cwd,stdio:'inherit'});
    } finally {
      rmSync(directory,{recursive:true,force:true});
    }
  }
}

export async function main(args=process.argv.slice(2)) {
  const options={};
  for(let index=0;index<args.length;index+=2) {
    if(!['--compare','--cached-base','--cached-head'].includes(args[index]) || !args[index+1])
      throw new Error('Usage: npm run bench:reads -- [--compare REF [--cached-base PATH] [--cached-head PATH]]');
    options[args[index]]=args[index+1];
  }
  if(!options['--compare'] && Object.keys(options).length)throw new Error('Cached inputs require --compare');
  const stamp=(result,ref,cached)=>{
    const id=benchmarkIdentity(ref);
    if(cached && result.inputHash!==id.inputHash)throw new Error('Cached benchmark inputs do not match revision');
    return {...result,...id,measuredCommit:result.measuredCommit??result.commit??id.commit,measuredTree:result.measuredTree??result.tree??id.tree};
  };
  const measuredBase=options['--compare'] && !options['--cached-base']?measureReference(options['--compare']):undefined;
  const reference=options['--compare']?{
    result:stamp(options['--cached-base']?readBenchmarkResult(options['--cached-base']):measuredBase.result,measuredBase?.revision??options['--compare'],!!options['--cached-base']),
  }:undefined;
  if(reference)writeFileSync(path.join(tmpdir(),'read-benchmark-base-result.json'),JSON.stringify(reference.result,null,2)+'\n');
  const result=stamp(options['--cached-head']?readBenchmarkResult(options['--cached-head']):{version:1,sqliteVersion:execFileSync('sqlite3',['--version'],{encoding:'utf8'}).trim(),nodeVersion:process.version,nodeSqliteVersion:process.versions.sqlite,scenarios:benchmarks.flatMap(run=>run({ci:true}).scenarios)},'HEAD',!!options['--cached-head']);
  const output=path.join(tmpdir(),'read-benchmark-result.json');
  writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(`Read benchmark result: ${output}`);
  if(!reference) {
    console.log(JSON.stringify(result,null,2));
    return;
  }
  const {renderReadBenchmarkReport}=await import('./read-benchmark-report.mjs');
  const report=renderReadBenchmarkReport({before:reference.result,after:result,beforeLabel:'Base',afterLabel:'Head',beforeSource:options['--cached-base']?'restored from cache':'measured',afterSource:options['--cached-head']?'restored from cache':'measured'});
  console.log(`Base revision: ${reference.result.commit}\n${report}`);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Base revision: ${reference.result.commit}\n\n${report}`);
  if(compareReads(reference.result,result).failures.length)process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error);process.exitCode=1;});
