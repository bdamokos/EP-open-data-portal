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
  // Isolate directory refresh from the independent hourly feed scheduler while
  // the second test advances its synthetic clock by seven hours.
  await writeFile(path.join(directory,'sync-state.json'),JSON.stringify({lastSuccess:new Date().toISOString(),lastAttempt:new Date(Date.now()+86400000).toISOString()}));
  return {directory,fetchedAt,records};
}
async function run(t,directory,script) {
  return JSON.parse((await execFileAsync(t,process.execPath,['--input-type=module','-e',script],{env:{...process.env,ODP_CACHE_DIR:directory},encoding:'utf8'})).stdout);
}
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
    const out=await run(t,f.directory,`let requests=0;globalThis.fetch=()=>{requests++;return new Promise(()=>{});};const {odpDirectory}=await import(${moduleUrl});const start=performance.now();const result=await Promise.race([odpDirectory().then(data=>({ready:true,data})),new Promise(resolve=>setTimeout(()=>resolve({ready:false}),250))]);let second=null;if(result.ready)for(let i=0;i<25;i++){second=await odpDirectory();if(second.index.complete)break;await new Promise(r=>setTimeout(r,10));}console.log(JSON.stringify({result,second,requests,elapsed:performance.now()-start}));process.exit(0);`);
    assert(out.result.ready,'saved names must not wait behind expired source refresh');
    assert.equal(out.result.data.members.length,1);assert.equal(out.result.data.committees[0].code,'EMPL');
    assert.equal(Date.parse(out.result.data.fetchedAt),f.fetchedAt,'serving saved data must retain its source date');
    assert(out.result.data.directoryCache.stale);assert(out.result.data.directoryCache.refreshInProgress);
    assert.equal(out.second.index.loaded,1);assert.equal(out.second.index.complete,true);
    assert.equal(out.requests,1,'one bounded shared-queue refresh starts; no roster/profile fan-out');
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('expiry keeps a loaded directory and memberships available while refresh is pending or fails',async t=>{
  const f=await fixture(t,0);
  try {
    const out=await run(t,f.directory,`let requests=0;const requestUrls=[];globalThis.fetch=async url=>{requests++;requestUrls.push(String(url));return new Response('{}',{status:500,headers:{'content-type':'application/json'}});};const {odpDirectory}=await import(${moduleUrl});await odpDirectory();let warm;for(let i=0;i<25;i++){warm=await odpDirectory();if(warm.index.complete)break;await new Promise(r=>setTimeout(r,10));}const now=Date.now();Date.now=()=>now+7*3600000;const result=await Promise.race([odpDirectory().then(data=>({ready:true,data})),new Promise(resolve=>setTimeout(()=>resolve({ready:false}),250))]);await new Promise(r=>setTimeout(r,100));const after=result.ready?await odpDirectory():null;const settledRequests=requests;for(let i=0;i<5;i++)await odpDirectory();await new Promise(r=>setTimeout(r,50));console.log(JSON.stringify({warm,result,after,requests,settledRequests,requestUrls}));process.exit(0);`);
    assert(out.warm.index.complete);assert(out.result.ready,'expiry must not block an already loaded wall');
    assert.equal(out.result.data.members[0].memberships[0].role,'MEMBER');
    assert(out.after.index.complete,'refresh must not clear the loaded membership map');
    assert.equal(out.after.members.length,1);assert(out.after.directoryCache.stale);
    assert.match(out.after.directoryCache.refreshError,/500/);
    assert.equal(out.requests,out.settledRequests,'polling does not restart failed sources');
    const counts=Object.values(out.requestUrls.reduce((all,url)=>({...all,[url]:(all[url]||0)+1}),{}));
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
      const {odpDirectory,odp}=await import(${moduleUrl});
      const first=await odpDirectory();
      let loaded;
      for(let i=0;i<25;i++){
        loaded=await odpDirectory();if(loaded.index.complete)break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      completeRoster();
      // Join the actual source refresh before triggering a new projection.
      // Keep this serverless child alive until the shared refresh settles.
      let refreshDeadline;
      try {
        await Promise.race([
          odp('/meps/show-current',{limit:1000,offset:0}),
          // Bound a failed shared source refresh without assuming fixed request spacing.
          new Promise((_,reject)=>{refreshDeadline=setTimeout(()=>reject(new Error('Source refresh did not finish')),4000);}),
        ]);
      }finally{clearTimeout(refreshDeadline);}
      const now=Date.now();Date.now=()=>now+61000;
      const during=await odpDirectory();
      let after;
      const deadline=performance.now()+2000;
      do {
        after=await odpDirectory();
        if(after.members[0].firstName==='Updated')break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }while(performance.now()<deadline);
      console.log(JSON.stringify({first,during,after}));process.exit(0);
    `);
    assert.equal(out.first.members[0].firstName,'Maravillas');
    assert.equal(out.during.members[0].firstName,'Maravillas','last good projection remains visible during replacement');
    assert.equal(out.after.members[0].firstName,'Updated');
    assert(out.after.index.complete);assert.equal(out.after.members[0].memberships[0].role,'MEMBER');
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
