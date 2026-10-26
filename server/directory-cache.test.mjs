import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileAsync,registerSubprocesses} from './test-support/subprocess.mjs';
import os from 'node:os';
import path from 'node:path';

beforeEach(registerSubprocesses);

async function fixture(t,age) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'mep-directory-cache-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const fetchedAt=Date.now()-age,classification='def/ep-entities/COMMITTEE_PARLIAMENTARY_STANDING';
  const person={identifier:'257043',givenName:'Maravillas',familyName:'Abadía Jover',sortLabel:'Abadía Jover',hasMembership:[{organization:'org/6572',role:'def/ep-roles/MEMBER',membershipClassification:classification,memberDuring:{startDate:'2024-07-16'}}]};
  const body={identifier:'6572',label:'EMPL',prefLabel:{en:'Employment and Social Affairs'},classification,temporal:{startDate:'2024-07-16'}};
  const records=[];
  for(const [endpoint,params,data] of [['/meps/show-current',{limit:1000,offset:0},[person]],['/corporate-bodies/show-current',{limit:1000,offset:0},[body]],['/corporate-bodies/6572',{},[body]],['/meps/257043',{},[person]]]) {
    const url=new URL('https://data.europarl.europa.eu/api/v2'+endpoint);
    for(const [key,value] of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(key,String(value));
    const record={url:url.href,fetchedAt,payload:{data}};records.push(record);
    await writeFile(path.join(directory,createHash('sha256').update(url.href).digest('hex')+'.json'),JSON.stringify(record));
  }
  // Isolate directory refresh from the independent daily feed scheduler while
  // tests advance their clock offset by seven hours (without freezing time).
  await writeFile(path.join(directory,'sync-state.json'),JSON.stringify({lastSuccess:new Date().toISOString(),lastAttempt:new Date(Date.now()+86400000).toISOString()}));
  return {directory,fetchedAt,records};
}
async function run(t,directory,script) {
  return JSON.parse((await execFileAsync(t,process.execPath,['--input-type=module','-e',readiness+script],{env:{...process.env,ODP_CACHE_DIR:directory},encoding:'utf8'})).stdout);
}
// Projection work has no public completion promise. Yield to I/O until the
// observable state arrives; this watchdog catches hangs, not host startup speed.
const readiness=`
  async function bounded(operation,label) {
    let timer;
    try {return await Promise.race([operation(),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('Readiness watchdog: '+label)),60_000);
    })]);}finally{clearTimeout(timer);}
  }
  async function observe(read,ready,label) {
    return bounded(async()=>{
      for(;;){const state=await read();if(ready(state))return state;await new Promise(resolve=>setImmediate(resolve));}
    },label);
  }
`;
const moduleUrl=JSON.stringify(new URL('./odp.mjs',import.meta.url).href);
test('a cold directory load retains its independent owner after its first reader leaves',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'directory-readers-'));
  try {
    await writeFile(path.join(directory,'sync-state.json'),JSON.stringify({lastSuccess:new Date().toISOString(),lastAttempt:new Date(Date.now()+86400000).toISOString()}));
    const out=await run(t,directory,`
      const {odpDirectory}=await import(${moduleUrl});
      const {runWithRequestSignal}=await import(${JSON.stringify(new URL('./request-budget.mjs',import.meta.url).href)});
      let ready,finish,sourceSignal,calls=0;const started=new Promise(resolve=>ready=resolve);
      globalThis.fetch=async(url,{signal})=>{calls++;if(new URL(url).pathname.endsWith('/meps/show-current')){sourceSignal=signal;ready();return new Promise(resolve=>finish=()=>resolve(Response.json({data:[]})));}return Response.json({data:[]});};
      const a=new AbortController(),b=new AbortController();
      const first=runWithRequestSignal(a.signal,()=>odpDirectory()).then(()=>null,error=>error.message);
      await started;const second=runWithRequestSignal(b.signal,()=>odpDirectory());a.abort(new Error('reader closed'));
      const rejected=await first,sourceAborted=sourceSignal.aborted;finish();const result=await second;
      console.log(JSON.stringify({rejected,sourceAborted,members:result.members.length,calls}));process.exit(0);
    `);
    assert.equal(out.rejected,'reader closed');assert.equal(out.sourceAborted,false);assert.equal(out.members,0);assert.equal(out.calls,2);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('a cold process serves the expired saved directory without waiting for Parliament refresh',async t=>{
  const f=await fixture(t,7*3600000);
  try {
    const out=await run(t,f.directory,`
      let requests=0,responses=0;
      globalThis.fetch=()=>{requests++;return new Promise(()=>{}).then(value=>{responses++;return value;});};
      const {odpDirectory,odpProfile,syncOdpFeeds}=await import(${moduleUrl});
      await syncOdpFeeds();
      const data=await bounded(()=>odpDirectory(),'saved directory while source unresolved');
      // Join saved membership work without waiting for the held roster refresh.
      await bounded(()=>odpProfile('257043'),'saved profile');
      const second=await observe(()=>odpDirectory(),state=>state.index.complete,'membership projection');
      await observe(async()=>requests,count=>count===1,'shared refresh request entry');
      console.log(JSON.stringify({data,second,requests,responses}));process.exit(0);
    `);
    assert.equal(out.data.members.length,1);assert.equal(out.data.committees[0].code,'EMPL');
    assert.equal(Date.parse(out.data.fetchedAt),f.fetchedAt,'serving saved data must retain its source date');
    assert(out.data.directoryCache.stale);assert(out.data.directoryCache.refreshInProgress);
    assert.equal(out.second.index.loaded,1);assert.equal(out.second.index.complete,true);
    assert.equal(out.responses,0,'cached directory and memberships return while the upstream gate remains unresolved');
    assert.equal(out.second.members[0].memberships[0].role,'MEMBER');
    assert.equal(out.data.members[0].firstName,'Maravillas');assert.equal(out.data.members[0].lastName,'Abadía Jover');
    assert.equal(out.requests,1,'one bounded shared-queue refresh starts; no roster/profile fan-out');
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('expiry keeps a loaded directory and memberships available while refresh is pending or fails',async t=>{
  const f=await fixture(t,0);
  try {
    const out=await run(t,f.directory,`
      let requests=0,responses=0,fail=false;const requestUrls=[],gates=[];
      globalThis.fetch=async url=>{
        requests++;requestUrls.push(String(url));
        if(!fail)await new Promise(resolve=>gates.push(resolve));
        responses++;return new Response('{}',{status:500,headers:{'content-type':'application/json'}});
      };
      const {odpDirectory,odpProfile,odp,syncOdpFeeds}=await import(${moduleUrl});
      await syncOdpFeeds();
      await odpDirectory();await odpProfile('257043');
      const warm=await observe(()=>odpDirectory(),state=>state.index.complete,'warm memberships');
      const realNow=Date.now;Date.now=()=>realNow()+7*3600000;
      const data=await bounded(()=>odpDirectory(),'loaded directory during expiry');
      const pending=await observe(()=>odpDirectory(),state=>state.directoryCache.refreshInProgress,'pending refresh projection');
      await observe(async()=>requests,count=>count===1,'shared refresh request entry');
      for(let i=0;i<5;i++)await odpDirectory();
      const pendingRequests=requests,pendingResponses=responses;
      // Public source reads join the actual jobs (including queued catalogue
      // work). Request entry alone does not prove that failure has completed.
      const failures=Promise.allSettled([
        odp('/meps/show-current',{limit:1000,offset:0},{force:true,priority:'background'}),
        odp('/corporate-bodies/show-current',{limit:1000,offset:0},{force:true,priority:'background'}),
      ]);
      fail=true;for(const release of gates)release();
      const settled=await bounded(()=>failures,'source failures');
      const after=await observe(()=>odpDirectory(),state=>state.directoryCache.refreshError&&!state.directoryCache.refreshInProgress,'completed failure projection');
      const settledRequests=requests;
      for(let i=0;i<5;i++){await odpDirectory();await new Promise(resolve=>setImmediate(resolve));}
      console.log(JSON.stringify({warm,data,pending,pendingRequests,pendingResponses,after,settled: settled.map(result=>result.status),requests,settledRequests,requestUrls}));process.exit(0);
    `);
    assert(out.warm.index.complete);
    assert.equal(out.pendingResponses,0,'cached reads complete before held sources fail');
    assert.equal(out.pendingRequests,1,'pending reads retain one shared background queue owner');
    assert(out.pending.directoryCache.stale);assert(out.pending.directoryCache.refreshInProgress);
    assert.equal(out.pending.index.loaded,1);assert(out.pending.index.complete);
    assert.equal(out.pending.members[0].firstName,'Maravillas');assert.equal(out.pending.members[0].lastName,'Abadía Jover');
    assert.equal(Date.parse(out.data.fetchedAt),f.fetchedAt);
    assert.deepEqual(out.settled,['rejected','rejected']);
    assert.equal(out.data.members[0].memberships[0].role,'MEMBER');
    assert(out.after.index.complete,'refresh must not clear the loaded membership map');
    assert.equal(out.after.members.length,1);assert(out.after.directoryCache.stale);
    assert.equal(out.after.members[0].firstName,'Maravillas');assert.equal(out.after.members[0].lastName,'Abadía Jover');
    assert.equal(Date.parse(out.after.fetchedAt),f.fetchedAt);assert.equal(out.after.index.loaded,1);
    assert.equal(out.after.members[0].memberships[0].role,'MEMBER');
    assert.equal(out.after.directoryCache.refreshInProgress,false);
    assert.match(out.after.directoryCache.refreshError,/500/);
    assert.equal(out.requests,out.settledRequests,'polling does not restart failed sources: '+JSON.stringify(out.requestUrls));
    const counts=Object.values(out.requestUrls.reduce((all,url)=>({...all,[url]:(all[url]||0)+1}),{}));
    // A seven-hour-old committee detail is within the body age limit; only the listings refresh.
    assert.deepEqual([...new Set(out.requestUrls)].sort(),f.records.slice(0,2).map(record=>record.url).sort(),'only the stale roster and committee listings refresh; no detail, profile or feed fan-out');
    assert(counts.length>=2,'independent stale roster and committee sources can refresh without fixed spacing');
    assert(counts.every(count=>count===1),'each failed source is fetched only once before its retry deadline');
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('a completed source refresh replaces saved names without clearing loaded memberships',async t=>{
  const f=await fixture(t,7*3600000);
  try {
    const fresh={...f.records[0].payload.data[0],givenName:'Updated'};
    const out=await run(t,f.directory,`
      const payloads=new Map(${JSON.stringify(f.records.map(record=>[record.url,record.payload]))});
      let completeRoster;
      const rosterReady=new Promise(resolve=>{completeRoster=resolve;});
      globalThis.fetch=async url=>{
        const payload=payloads.get(String(url));
        if(!payload)throw new Error('Unexpected fixture request: '+url);
        if(new URL(url).pathname.endsWith('/meps/show-current')){
          await rosterReady;
          return new Response(JSON.stringify({data:[${JSON.stringify(fresh)}]}),{headers:{'content-type':'application/json'}});
        }
        // Either saved catalogue may finish reading first. Committee refreshes
        // must release the shared background slot for the roster refresh.
        return new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});
      };
      const {odpDirectory,odp,syncOdpFeeds}=await import(${moduleUrl});
      await syncOdpFeeds();
      const first=await odpDirectory();
      const loaded=await observe(()=>odpDirectory(),state=>state.index.complete,'saved membership projection');
      completeRoster();
      // odp joins the source writer; it does not join the directory projection.
      await bounded(()=>odp('/meps/show-current',{limit:1000,offset:0}),'completed source refresh');
      const realNow=Date.now;Date.now=()=>realNow()+61000;
      const during=await odpDirectory();
      const after=await observe(()=>odpDirectory(),state=>state.members[0].firstName==='Updated','replacement directory projection');
      console.log(JSON.stringify({first,loaded,during,after}));process.exit(0);
    `);
    assert.equal(out.first.members[0].firstName,'Maravillas');assert(out.loaded.index.complete);
    assert.equal(out.during.members[0].firstName,'Maravillas','last good projection remains visible during replacement');
    assert.equal(out.after.members[0].firstName,'Updated');
    assert(out.after.index.complete);assert.equal(out.after.members[0].memberships[0].role,'MEMBER');
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
