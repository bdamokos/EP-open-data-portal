import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {SCHEMA,hash,validDate,monday,outsideRepository,loadSnapshot,loadIndexStatus,summarize,compareBaseline} from './agenda-benchmark-model.mjs';
import {capture,captureIndexStatus} from './agenda-benchmark-capture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),execute=promisify(execFile);
export function options(args) {
  const opts={fetch:false,iterations:5,latency:'recorded',cap:80,delay:750,week:'latest',language:'en',regressionPercent:10,regressionMs:20,apiBase:process.env.AGENDA_BENCHMARK_API_BASE};
  const keys={'--cache-dir':'directory','--output-dir':'output','--iterations':'iterations','--latency':'latency','--index-status':'indexStatus','--api-base':'apiBase','--request-cap':'cap','--delay-ms':'delay','--week':'week','--sitting':'sitting','--lang':'language','--baseline':'baseline','--runtime-root':'runtimeRoot','--max-regression-percent':'regressionPercent','--max-regression-ms':'regressionMs'};
  for(let index=0;index<args.length;index++) {
    const arg=args[index];
    if(arg==='--help')return {help:true};
    if(arg==='--fetch'){opts.fetch=true;continue;}
    if(arg==='--session-cases'){opts.sessionCases=true;continue;}
    if(!keys[arg]||!args[index+1]||args[index+1].startsWith('--'))throw Error('Unknown option or missing value: '+arg);
    opts[keys[arg]]=args[++index];
  }
  for(const [key,min,max] of [['iterations',1,30],['cap',1,200],['delay',750,60000],['regressionPercent',0,1000],['regressionMs',0,60000]]) {
    if(!/^\d+$/.test(String(opts[key]))||Number(opts[key])<min||Number(opts[key])>max)throw Error('Invalid '+key);opts[key]=Number(opts[key]);
  }
  if(!['zero','recorded'].includes(opts.latency))throw Error('Latency must be zero or recorded.');
  if(opts.week!=='latest'&&(!validDate(opts.week)||monday(opts.week)!==opts.week))throw Error('Week must be latest or a Monday date.');
  if(opts.sitting&&(!/^MTG-PL-/.test(opts.sitting)||!validDate(opts.sitting.slice(7))||opts.week!=='latest'))throw Error('Choose one exact sitting or a week.');
  if(!'bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(' ').includes(opts.language))throw Error('Unsupported language.');
  opts.directory=path.resolve(opts.directory||path.join(process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache'),'ep-explorer','agenda-benchmark'));
  opts.indexStatus=path.resolve(opts.indexStatus||path.join(opts.directory,'index-status.json'));
  return opts;
}

async function identity(runtimeRoot=root) {
  const files=['scripts/agenda-benchmark.mjs','scripts/agenda-benchmark-worker.mjs','scripts/agenda-benchmark-capture.mjs','scripts/agenda-benchmark-model.mjs'];
  const harnessHash=hash(Buffer.concat(await Promise.all(files.map(file=>readFile(path.join(root,file))))));
  const git=args=>execFileSync('git',args,{cwd:runtimeRoot,encoding:'utf8'}).trim();
  const paths=git(['ls-files','--cached','--others','--exclude-standard','server','src','scripts','package.json','package-lock.json']).split('\n').filter(Boolean).sort();
  const workingTreeHash=hash(JSON.stringify(await Promise.all(paths.map(async file=>[file,await readFile(path.join(runtimeRoot,file)).then(hash,error=>error.code==='ENOENT'?'deleted':Promise.reject(error))]))));
  return {head:git(['rev-parse','HEAD']),dirty:Boolean(git(['status','--porcelain'])),diffHash:hash(execFileSync('git',['diff','HEAD'],{cwd:runtimeRoot,maxBuffer:16*1024*1024})),workingTreeHash,harnessHash};
}
export function markdown(report) {
  const summary=Object.entries(report.summary).map(([scenario,value])=>`| ${scenario} | ${value.samples} | ${value.elapsedMs.p50.toFixed(1)} | ${value.elapsedMs.p95.toFixed(1)} | ${value.cpuMs.p50.toFixed(1)} | ${value.transportRequests.min}–${value.transportRequests.max} |`).join('\n');
  const sessions=report.sessionCases?.length?'\nReal-input cache-age probes (one observation each; replies are held until the cached response returns or a 250 ms guard releases them). Probe timings include that guard when blocked.\n\n| Probe | Response ms | Returns while held | Recheck requests | Content retained | Policy gaps |\n| --- | ---: | --- | ---: | --- | --- |\n'+report.sessionCases.map(row=>`| ${row.case} | ${row.responseMs.toFixed(1)} | ${row.returnedWhileHeld} | ${row.recheckRequests} | ${row.retainedDataSame} | ${row.policyGaps.join(', ')||'none'} |`).join('\n')+`\n\nSnapshot session coverage: ${report.sessionCoverage.phase}. Changed observations: unavailable. Failed recheck observations: ${report.sessionCoverage.failedSourceObservation?'present':'unavailable'}. No source payload or HTTP status is fabricated. Cache clocks advance; source observations retain their actual provenance. Background and later verification work are outside response latency.\n`:'';
  return `# Plenary agenda benchmark\n\nSnapshot: ${report.snapshotId}. Checkout: ${report.code.head}${report.code.dirty?' (working changes)':''}.\n\nQuery: ${new URLSearchParams(report.sample.query)}; fixed clock: ${report.sample.asOf}. Sittings: ${report.sample.sittings.join(', ')}.\n\nLatency: ${report.protocol.latency}. Isolated processes; real ODP admission, source cache, legislation service and assembled-view cache. App readiness comes from the hashed anonymous status observation at ${report.indexObservation.retrievedAt}; generation ${report.indexObservation.servingGeneration}, ${report.indexObservation.currentMeps} members. No index database is generated or opened. OS page caches are not flushed.\n\nElapsed covers service query and response serialization. Imports, process wall time, nested inclusive spans, CPU, heap/RSS, event-loop delay, request URLs/counts/bytes and coverage are in JSON. Nested spans overlap and must not be added. Recorded latency replays one captured header/body observation; it excludes live variability and background competition. Index database queries, browser navigation, assets, directory bootstrap, HTTP/CDN and rendering are outside this measurement.\n\n| Cache state | Samples | Median ms | p95 ms | Median CPU ms | Transport requests |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${summary}\n${sessions}\nValidation: ${report.failed?'FAILED':'passed'}; ordinary cache-state response hashes must agree after removing retrieval/computation timestamps only. Coverage and gaps remain in the response and report. ${report.comparison?'Baseline comparison: '+(report.comparison.failed?'FAILED':'passed')+'.':''}\n`;
}
export async function main(args=process.argv.slice(2)) {
  const opts=options(args);
  if(opts.help){process.stdout.write('Usage: npm run bench:agenda -- --cache-dir PATH [--fetch --api-base HTTPS_ORIGIN] [--index-status PATH.json] [--week latest|YYYY-MM-DD | --sitting MTG-PL-YYYY-MM-DD] [--lang en] [--iterations 5] [--latency recorded|zero] [--session-cases] [--runtime-root CHECKOUT] [--output-dir PATH] [--baseline PATH.json]\nOffline by default. Acquisition requires a new directory. A real public app-status observation is required; no index data is generated. Inputs and reports stay outside Git.\n');return;}
  const directory=await outsideRepository(opts.directory),output=await outsideRepository(path.resolve(opts.output||directory+'-results'));
  const lock=directory+'.lock';
  try{await mkdir(lock);}catch(error){if(error.code==='EEXIST')throw Error('Another benchmark owns this snapshot. Verify it stopped before removing '+lock);throw error;}
  let temporary;
  try {
    const code=await identity(opts.runtimeRoot);
    if(opts.fetch){if(!opts.apiBase)await loadIndexStatus(opts.indexStatus);await capture(directory,{...opts,cap:opts.apiBase?opts.cap-1:opts.cap});if(opts.apiBase)await captureIndexStatus(opts.indexStatus,opts.apiBase);}
    const {snapshot}=await loadSnapshot(directory);
    const observed=await loadIndexStatus(opts.indexStatus),indexObservation={url:observed.url,retrievedAt:observed.retrievedAt,sha256:observed.sha256,observationHash:observed.observationHash,servingGeneration:observed.payload.servingGeneration,currentMeps:observed.payload.currentMeps,complete:observed.payload.complete};
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(new Date(snapshot.sample.asOf)),dates=snapshot.sample.sittings.map(id=>id.slice(7));
    const phase=dates.every(date=>date<day)?'historical':dates.includes(day)?'current-sitting-date':'upcoming';
    const sameDayAfterCurrentAge=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(new Date(Date.parse(snapshot.sample.asOf)+16*60_000))===day;
    const sessionCoverage={phase,sourceDay:day,currentProbeAvailable:phase==='current-sitting-date'&&sameDayAfterCurrentAge,changedObservations:false,failedSourceObservation:snapshot.sources.some(source=>source.status>=400)};
    if((args.includes('--week')||args.includes('--sitting')||args.includes('--lang'))&&JSON.stringify(snapshot.sample.query)!==JSON.stringify({lang:opts.language,...(opts.sitting?{sitting:opts.sitting}:{week:opts.week})}))throw Error('Selection differs from frozen snapshot; use a new directory.');
    temporary=await mkdtemp(path.join(os.tmpdir(),'agenda-benchmark-'));
    const runs=[],processes=[],sessionCases=[];let response;
    async function worker(iteration,name,scenarios,seedSources=false,sessionCase=null) {
      const config={snapshotDirectory:directory,directory:path.join(temporary,String(iteration),name),scenarios,seedSources,latency:opts.latency,indexStatus:opts.indexStatus,runtimeRoot:opts.runtimeRoot,sessionCase};
      const filename=path.join(temporary,randomUUID()+'.json');await writeFile(filename,JSON.stringify(config));
      const started=performance.now();
      const {stdout}=await execute(process.execPath,[fileURLToPath(new URL('./agenda-benchmark-worker.mjs',import.meta.url)),filename],{cwd:root,maxBuffer:16*1024*1024,timeout:120_000,killSignal:'SIGKILL'});
      const result=JSON.parse(stdout);processes.push({iteration,scenarios,wallMs:performance.now()-started,importsMs:result.importsMs,readinessLoadMs:result.readinessLoadMs});
      response ||= result.response;
      if(result.session)sessionCases.push(result.session);else runs.push(...result.results.map(run=>({...run,iteration})));
    }
    for(let iteration=0;iteration<opts.iterations;iteration++) {
      await worker(iteration,'cold',['empty-caches','warm-repeat']);
      await worker(iteration,'sources',['retained-sources'],true);
      await worker(iteration,'cold',['retained-view']);
      process.stderr.write(`Agenda benchmark ${iteration+1}/${opts.iterations} complete\n`);
    }
    if(opts.sessionCases)for(const name of phase==='historical'?['past-aged-view','past-next-day']:phase==='current-sitting-date'?(sameDayAfterCurrentAge?['current-aged-view']:[]):['upcoming-aged-view'])await worker(0,name,[],true,name);
    const semanticHash=runs[0]?.semanticHash,failed=runs.length!==opts.iterations*4||runs.some(run=>run.error||!run.semanticHash||run.semanticHash!==semanticHash)||sessionCases.some(row=>row.failed);
    if((await loadSnapshot(directory)).snapshot.snapshotId!==snapshot.snapshotId)throw Error('Snapshot changed during measurement.');
    if((await loadIndexStatus(opts.indexStatus)).observationHash!==observed.observationHash)throw Error('Observed app readiness changed during measurement.');
    const after=await identity(opts.runtimeRoot);if(JSON.stringify(code)!==JSON.stringify(after))throw Error('Checkout changed during measurement; rerun before using results.');
    const protocol={version:3,iterations:opts.iterations,latency:opts.latency,sessionCases:Boolean(opts.sessionCases),requestBudgetMs:30000,sourceAge:'freshly seeded from public snapshot',scope:'backend agenda service with observed app readiness; database/HTTP/browser excluded'},environment={node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,logicalCpus:os.availableParallelism(),nodeOptionsHash:hash(JSON.stringify([process.execArgv,process.env.NODE_OPTIONS||'']))};
    const report={schemaVersion:SCHEMA,createdAt:new Date().toISOString(),snapshotId:snapshot.snapshotId,sample:snapshot.sample,inputs:snapshot.sources,indexObservation,code,harnessHash:code.harnessHash,protocol,environment,semanticHash,response,failed,summary:summarize(runs),sessionCoverage,sessionCases,processes,runs};
    if(opts.baseline)report.comparison=compareBaseline(report,JSON.parse(await readFile(opts.baseline,'utf8')),{regressionPercent:opts.regressionPercent,regressionMs:opts.regressionMs});
    report.failed ||= report.comparison?.failed===true;
    const stem=path.join(output,'agenda-'+Date.now()+'-'+code.head.slice(0,8)),jsonPath=stem+'.json',markdownPath=stem+'.md';
    await writeFile(jsonPath,JSON.stringify(report,null,2)+'\n');await writeFile(markdownPath,markdown(report));
    process.stdout.write(JSON.stringify({jsonPath,markdownPath,snapshotId:report.snapshotId,failed:report.failed,summary:report.summary,comparison:report.comparison},null,2)+'\n');
    if(report.failed)process.exitCode=1;
    return report;
  }finally{if(temporary)await rm(temporary,{recursive:true,force:true});await rm(lock,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
