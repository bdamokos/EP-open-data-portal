import {execFileSync} from 'node:child_process';
import {appendFileSync,copyFileSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repository=fileURLToPath(new URL('..',import.meta.url));
// The registered suites' transitive imports live in server/src/scripts. Include
// their data and fixtures, dependency manifests and CLI build inputs as well.
// Runtime fixtures are generated in TMPDIR; no docs or workflows are read.
const inputPaths=['server','src','scripts','package.json','package-lock.json','.github/actions/sqlite-cli'];
export function benchmarkIdentity(ref,{cwd=repository}={}) {
  const git=args=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
  const commit=git(['rev-parse','--verify',`${ref}^{commit}`]);
  const entries=execFileSync('git',['ls-tree','-rz',commit,'--',...inputPaths],{cwd});
  const inputHash=execFileSync('git',['hash-object','--stdin'],{cwd,input:entries,encoding:'utf8'}).trim();
  return {commit,tree:git(['rev-parse',`${commit}^{tree}`]),inputHash};
}

export function benchmarkCacheKey({os,nodeVersion,nodeSqliteVersion,sqliteVersion,inputHash,scope}) {
  return `read-bench-v2-${scope}-${os}-sqlite${sqliteVersion.split(/\s/)[0]}-node${nodeVersion}-nodesqlite${nodeSqliteVersion}-${inputHash}`;
}

export function readBenchmarkResult(file) {
  const result=JSON.parse(readFileSync(file,'utf8'));
  if(!result || !Array.isArray(result.scenarios) || result.scenarios.some(row=>
    !row || typeof row.name!=='string' || !Number.isSafeInteger(row.pageFetches) || row.pageFetches<0 ||
    !Array.isArray(row.plan) || !Array.isArray(row.fullScanTables)))
    throw new Error('Invalid benchmark result: expected complete scenarios');
  return result;
}

export function stageBenchmarkResult(source,destination) {
  rmSync(destination,{force:true});
  try {readBenchmarkResult(source);}catch {return false;}
  mkdirSync(path.dirname(destination),{recursive:true});
  copyFileSync(source,destination);
  return true;
}

export function main(args=process.argv.slice(2)) {
  const output=values=>{
    const text=Object.entries(values).map(([key,value])=>`${key}=${value}\n`).join('');
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,text);
    else process.stdout.write(text);
  };
  if(args.length===2 && args[0]==='--identity') {
    const base=benchmarkIdentity(args[1]),head=benchmarkIdentity('HEAD');
    const runtime={os:process.env.RUNNER_OS,nodeVersion:process.version,nodeSqliteVersion:process.versions.sqlite,
      sqliteVersion:execFileSync('sqlite3',['--version'],{encoding:'utf8'}).trim()};
    output({base:base.commit,
      base_key:benchmarkCacheKey({...runtime,inputHash:base.inputHash,scope:'main'}),
      head_main_key:benchmarkCacheKey({...runtime,inputHash:head.inputHash,scope:'main'}),
      head_pr_key:benchmarkCacheKey({...runtime,inputHash:head.inputHash,scope:`pr-${process.env.READ_BENCHMARK_PR}`})});
  } else if(args.length===3 && args[0]==='--stage') {
    const valid=stageBenchmarkResult(args[1],args[2]);
    console.log(`Benchmark result ${valid?'validated':'missing or invalid'}: ${args[1]}`);
    output({valid});
  } else throw new Error('Usage: read-benchmark-cache.mjs --identity REF | --stage SOURCE DESTINATION');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main();
