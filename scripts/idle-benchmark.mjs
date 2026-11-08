#!/usr/bin/env node
// Measures one running explorer: memory of the whole process tree, wake latency,
// warm request latency, memory after idle exit and idle CPU. Linux only (/proc).
// Run it next to the server (same PID namespace), for example inside the container:
//   docker exec CONTAINER node /bench/idle-benchmark.mjs --url http://127.0.0.1:8790 --pid 1 --mode split
// It makes requests to the explorer only; the explorer decides what reaches upstream.
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

const options={url:'http://127.0.0.1:8790',pid:1,mode:'single',label:'',out:'',settleS:30,cpuWindowS:300,rounds:5,idleWaitS:0,sitting:'',lang:'en',wakeTimeoutS:90,cycles:0,cycleWaitS:75};
const flags=new Map([['--url','url'],['--pid','pid'],['--mode','mode'],['--label','label'],['--out','out'],['--settle-s','settleS'],['--cpu-window-s','cpuWindowS'],['--rounds','rounds'],['--idle-wait-s','idleWaitS'],['--sitting','sitting'],['--lang','lang'],['--wake-timeout-s','wakeTimeoutS'],['--cycles','cycles'],['--cycle-wait-s','cycleWaitS']]);
const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log(`Usage: node scripts/idle-benchmark.mjs [options]
  --url URL            explorer base URL (default ${options.url})
  --pid PID            root of the process tree to measure (default 1, the container's main process)
  --mode single|split  label for the report
  --label NAME         run label
  --settle-s N         wait before the first sample (default ${options.settleS})
  --cpu-window-s N     idle CPU window (default ${options.cpuWindowS})
  --rounds N           warm tour repetitions (default ${options.rounds})
  --idle-wait-s N      time to wait for the API process to exit after the tour (default 0: skip)
  --sitting ID         sitting for upcoming-votes (default: first upcoming sitting from vote-periods)
  --cycles N           after the tour, N times: wait --cycle-wait-s, then wake again and time it (repeated idle-exit and wake)
  --cycle-wait-s N     wait before each cycle (default ${options.cycleWaitS}; use more than the idle time to include an exit)
  --wake-timeout-s N   give up on a home API call after N seconds (default ${options.wakeTimeoutS})
  --out FILE           also write the JSON result here`);
  process.exit(0);
}
for(let i=0;i<args.length;i+=2){
  const key=flags.get(args[i]);
  if(!key||args[i+1]===undefined)throw new Error(`Unknown or incomplete option ${args[i]}`);
  options[key]=typeof options[key]==='number'?Number(args[i+1]):args[i+1];
}
const base=options.url.replace(/\/$/,'');

// ---- process tree ----
const clockTicks=100; // getconf CLK_TCK is 100 on Linux builds Node supports
function readProcess(pid) {
  try {
    const stat=readFileSync(`/proc/${pid}/stat`,'utf8'),close=stat.lastIndexOf(')');
    const fields=stat.slice(close+2).split(' ');
    const status=readFileSync(`/proc/${pid}/status`,'utf8');
    const kib=name=>Number(status.match(new RegExp(`^${name}:\\s+(\\d+)`,'m'))?.[1]??0);
    let pss=null;
    try {pss=Number(readFileSync(`/proc/${pid}/smaps_rollup`,'utf8').match(/^Pss:\s+(\d+)/m)?.[1]??null);}catch{/* not permitted: report RSS only */}
    return {pid,ppid:Number(fields[1]),ticks:Number(fields[11])+Number(fields[12]),name:stat.slice(stat.indexOf('(')+1,close),
      rssKiB:kib('VmRSS'),pssKiB:pss,threads:kib('Threads'),cmd:readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').slice(0,3).join(' ').trim()};
  } catch {return null;}
}
function tree(root=options.pid) {
  const all=new Map();
  for(const name of readdirSync('/proc'))if(/^\d+$/.test(name)){const info=readProcess(Number(name));if(info)all.set(info.pid,info);}
  const members=[],queue=[root];
  while(queue.length){
    const pid=queue.shift(),info=all.get(pid);
    if(!info)continue;
    members.push(info);
    for(const other of all.values())if(other.ppid===pid)queue.push(other.pid);
  }
  const sum=key=>members.reduce((total,m)=>total+(m[key]??0),0);
  return {at:Date.now(),processes:members.map(({pid,cmd,rssKiB,pssKiB,threads})=>({pid,cmd,rssKiB,pssKiB,threads})),
    count:members.length,rssMiB:round(sum('rssKiB')/1024),pssMiB:members.every(m=>m.pssKiB!==null)?round(sum('pssKiB')/1024):null,ticks:sum('ticks')};
}
const round=(value,digits=1)=>Math.round(value*10**digits)/10**digits;
function percentile(sorted,fraction) {
  if(!sorted.length)return null;
  return sorted[Math.min(sorted.length-1,Math.ceil(fraction*sorted.length)-1)];
}
const summarize=values=>{const sorted=[...values].sort((a,b)=>a-b);return {n:sorted.length,p50:percentile(sorted,0.5),p95:percentile(sorted,0.95),max:sorted.at(-1)??null};};

// ---- HTTP ----
async function timed(path,{headers={},signal}={}) {
  const started=performance.now();
  const response=await fetch(base+path,{headers,signal,redirect:'manual'});
  const body=await response.text();
  return {status:response.status,ms:performance.now()-started,body,headers:response.headers};
}
let apiVersion;
const api=path=>`/api/${path}${path.includes('?')?'&':'?'}v=${apiVersion}`;
// A browser retries a busy API; the first 200 is the time the visitor sees data.
async function firstOk(path,t0,timeoutMs) {
  let attempts=0,last=null;
  for(;;){
    attempts++;
    try {
      const result=await timed(path,{headers:{Accept:'application/json'}});
      last=result.status;
      if(result.status===200)return {path:path.split('?')[0],firstOkMs:round(performance.now()-t0),attempts,body:result.body};
      const wait=Math.max(250,Number(result.headers.get('retry-after')||0)*1000);
      if(performance.now()-t0+wait>timeoutMs)return {path:path.split('?')[0],firstOkMs:null,attempts,lastStatus:last};
      await delay(wait);
    } catch(error) {
      last=error.cause?.code||error.message;
      if(performance.now()-t0>timeoutMs)return {path:path.split('?')[0],firstOkMs:null,attempts,lastStatus:last};
      await delay(250);
    }
  }
}

async function wake() {
  const before=tree(),t0=performance.now();
  const page=await timed('/',{headers:{Accept:'text/html,application/xhtml+xml'}});
  const htmlMs=performance.now()-t0;
  // The bundle a browser fetches before it can call the API.
  const assets=[...page.body.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(match=>match[1]);
  await Promise.all(assets.map(asset=>timed(asset)));
  const assetsMs=performance.now()-t0;
  const timeout=options.wakeTimeoutS*1000;
  const periods=firstOk(api('vote-periods'),t0,timeout);
  const calls=[firstOk(api(`directory?lang=${options.lang}`),t0,timeout),firstOk(api('plenary-live'),t0,timeout),periods];
  const sitting=options.sitting||await periods.then(result=>{
    // Ballots for a past sitting come from held snapshots; a future one needs the live source.
    try {const data=JSON.parse(result.body),week=data.weeks?.[0]?.sittings||[];return String(week[Math.min(1,week.length-1)]?.sittingId||'');}catch{return '';}
  });
  if(/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(sitting))calls.push(firstOk(api(`upcoming-votes?sitting=${sitting}&lang=${options.lang}`),t0,timeout));
  const results=(await Promise.all(calls)).map(({body,...rest})=>({...rest,bytes:body?.length??0}));
  const ok=results.map(result=>result.firstOkMs).filter(value=>value!==null);
  return {
    htmlMs:round(htmlMs),assetsMs:round(assetsMs),calls:results,
    allOkMs:ok.length===results.length?Math.max(...ok):null,
    // plenary-live reads three live sources; without network it waits on DNS, so the stored-data calls are also reported alone.
    storedOkMs:(()=>{const stored=results.filter(result=>result.path!=='/api/plenary-live');return stored.every(result=>result.firstOkMs!==null)?Math.max(...stored.map(result=>result.firstOkMs)):null;})(),sitting:sitting||null,treeBefore:{count:before.count,rssMiB:before.rssMiB,pssMiB:before.pssMiB},
  };
}

// ---- tour ----
async function tourTargets(sitting) {
  const directory=await timed(api(`directory?lang=${options.lang}`),{headers:{Accept:'application/json'}});
  let members=[];
  try {members=JSON.parse(directory.body).members?.map(member=>member.id).filter(Boolean)??[];}catch{/* the tour uses the fixed routes only */}
  const mep=(index)=>members[Math.min(index,members.length-1)];
  const routes=[`directory?lang=${options.lang}`,'plenary-live','vote-periods','activity-index/status?lang=en'];
  if(sitting)routes.push(`upcoming-votes?sitting=${sitting}&lang=${options.lang}`);
  for(const index of [0,Math.floor(members.length/3),Math.floor(members.length*2/3)])if(mep(index)){
    routes.push(`profile/${mep(index)}`,`latest-activities/${mep(index)}?lang=${options.lang}&limit=10`,`member-votes/${mep(index)}?lang=${options.lang}`);
  }
  routes.push(`insights/questions?lang=${options.lang}`,`topics/search?lang=${options.lang}`);
  return routes;
}
async function tour(sitting) {
  let routes=await tourTargets(sitting);
  const samples=[],byStatus={},failures={},memory=[],perRoute={};
  // Round 0 warms caches and drops routes the offline data cannot answer, so both modes tour the same set.
  const dropped=[];
  for(const route of [...routes]) {
    let status;
    try {status=(await timed(api(route),{headers:{Accept:'application/json'}})).status;}catch{status='error';}
    if(status!==200){dropped.push({route,status});routes=routes.filter(value=>value!==route);}
  }
  const sampler=setInterval(()=>{const now=tree();memory.push({rssMiB:now.rssMiB,pssMiB:now.pssMiB,count:now.count});},1000);
  const started=performance.now();
  for(let round=1;round<=options.rounds;round++)for(const route of routes) {
    try {
      const result=await timed(api(route),{headers:{Accept:'application/json'}});
      byStatus[result.status]=(byStatus[result.status]||0)+1;
      if(result.status!==200)failures[route]=result.status;
      // Only successful answers describe warm latency.
      if(result.status===200){samples.push(result.ms);(perRoute[route.split('?')[0]]??=[]).push(result.ms);}
    } catch {byStatus.error=(byStatus.error||0)+1;}
  }
  clearInterval(sampler);
  const peak=key=>memory.length?Math.max(...memory.map(m=>m[key]??0)):null;
  return {routes,droppedRoutes:dropped,rounds:options.rounds,wallS:round((performance.now()-started)/1000),status:byStatus,failedRoutes:failures,latencyMs:{...summarize(samples),n:samples.length},
    perRouteP50Ms:Object.fromEntries(Object.entries(perRoute).map(([route,values])=>[route,round(summarize(values).p50,2)])),
    peakRssMiB:peak('rssMiB'),peakPssMiB:peak('pssMiB'),
    meanRssMiB:memory.length?round(memory.reduce((total,m)=>total+m.rssMiB,0)/memory.length):null};
}

// ---- main ----
const result={label:options.label,mode:options.mode,startedAt:new Date().toISOString(),node:process.version,options:{...options}};
const health=await timed('/healthz');
apiVersion=JSON.parse(health.body).apiVersion;
await delay(options.settleS*1000);
result.idleAfterStart=tree();
if(options.cpuWindowS>0){
  const first=tree(),t0=performance.now();
  await delay(options.cpuWindowS*1000);
  const second=tree();
  const seconds=(second.ticks-first.ticks)/clockTicks,windowS=(performance.now()-t0)/1000;
  result.idleCpu={windowS:round(windowS),cpuSeconds:round(seconds,2),cpuSecondsPerHour:round(seconds/windowS*3600,1),processes:second.count};
}
result.wake=await wake();
await delay(3000);
result.afterWake=tree();
result.tour=await tour(result.wake.sitting);
await delay(5000);
result.afterTour=tree();
if(options.idleWaitS>0){
  const waitStarted=Date.now();
  let exitedAfterS=null;
  while(Date.now()-waitStarted<options.idleWaitS*1000){
    await delay(5000);
    const now=tree();
    if(options.mode==='split'&&now.count===1&&exitedAfterS===null){exitedAfterS=round((Date.now()-waitStarted)/1000);break;}
  }
  await delay(5000);
  result.afterIdleExit={...tree(),waitedS:round((Date.now()-waitStarted)/1000),apiExitedAfterS:exitedAfterS};
  // Opposite direction: the first request after the exit starts the API again.
  const again=await wake();
  result.rewake={htmlMs:again.htmlMs,allOkMs:again.allOkMs,storedOkMs:again.storedOkMs,calls:again.calls.map(({path,firstOkMs,attempts})=>({path,firstOkMs,attempts}))};
}
if(options.cycles>0){
  result.cycles=[];
  for(let i=0;i<options.cycles;i++) {
    await delay(options.cycleWaitS*1000);
    const before=tree(),again=await wake();
    result.cycles.push({processesBefore:before.count,rssMiBBefore:before.rssMiB,htmlMs:again.htmlMs,allOkMs:again.allOkMs,storedOkMs:again.storedOkMs,
      calls:again.calls.map(({path,firstOkMs,attempts})=>({path,firstOkMs,attempts}))});
  }
}
const text=JSON.stringify(result,null,1);
if(options.out)writeFileSync(options.out,text+'\n');
console.log(text);
