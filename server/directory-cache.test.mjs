import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

async function fixture(age) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'mep-directory-cache-'));
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
function run(directory,script) {
  return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,ODP_CACHE_DIR:directory},encoding:'utf8',timeout:8000}));
}
const moduleUrl=JSON.stringify(new URL('./odp.mjs',import.meta.url).href);
test('a cold process serves the expired saved directory without waiting for Parliament refresh',async()=>{
  const f=await fixture(7*3600000);
  try {
    const out=run(f.directory,`let requests=0;globalThis.fetch=()=>{requests++;return new Promise(()=>{});};const {odpDirectory}=await import(${moduleUrl});const start=performance.now();const result=await Promise.race([odpDirectory().then(data=>({ready:true,data})),new Promise(resolve=>setTimeout(()=>resolve({ready:false}),250))]);let second=null;if(result.ready)for(let i=0;i<25;i++){second=await odpDirectory();if(second.index.complete)break;await new Promise(r=>setTimeout(r,10));}console.log(JSON.stringify({result,second,requests,elapsed:performance.now()-start}));process.exit(0);`);
    assert(out.result.ready,'saved names must not wait behind expired source refresh');
    assert.equal(out.result.data.members.length,1);assert.equal(out.result.data.committees[0].code,'EMPL');
    assert.equal(Date.parse(out.result.data.fetchedAt),f.fetchedAt,'serving saved data must retain its source date');
    assert(out.result.data.directoryCache.stale);assert(out.result.data.directoryCache.refreshInProgress);
    assert.equal(out.second.index.loaded,1);assert.equal(out.second.index.complete,true);
    assert.equal(out.requests,1,'one bounded shared-queue refresh starts; no roster/profile fan-out');
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('expiry keeps a loaded directory and memberships available while refresh is pending or fails',async()=>{
  const f=await fixture(0);
  try {
    const out=run(f.directory,`let requests=0;globalThis.fetch=async()=>{requests++;return new Response('{}',{status:500,headers:{'content-type':'application/json'}});};const {odpDirectory}=await import(${moduleUrl});await odpDirectory();let warm;for(let i=0;i<25;i++){warm=await odpDirectory();if(warm.index.complete)break;await new Promise(r=>setTimeout(r,10));}const now=Date.now();Date.now=()=>now+7*3600000;const result=await Promise.race([odpDirectory().then(data=>({ready:true,data})),new Promise(resolve=>setTimeout(()=>resolve({ready:false}),250))]);await new Promise(r=>setTimeout(r,100));const after=result.ready?await odpDirectory():null;console.log(JSON.stringify({warm,result,after,requests}));process.exit(0);`);
    assert(out.warm.index.complete);assert(out.result.ready,'expiry must not block an already loaded wall');
    assert.equal(out.result.data.members[0].memberships[0].role,'MEMBER');
    assert(out.after.index.complete,'refresh must not clear the loaded membership map');
    assert.equal(out.after.members.length,1);assert(out.after.directoryCache.stale);
    assert.match(out.after.directoryCache.refreshError,/500/);
    assert.equal(out.requests,1,'failure is backed off instead of restarting on every wall request');
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('a completed source refresh replaces saved names without clearing loaded memberships',async()=>{
  const f=await fixture(7*3600000);
  try {
    const fresh={...f.records[0].payload.data[0],givenName:'Updated'};
    const out=run(f.directory,`
      globalThis.fetch=async url=>new URL(url).pathname.endsWith('/meps/show-current')
        ?new Response(JSON.stringify({data:[${JSON.stringify(fresh)}]}),{headers:{'content-type':'application/json'}})
        :new Response(JSON.stringify({data:${JSON.stringify(f.records[1].payload.data)}}),{headers:{'content-type':'application/json'}});
      const {odpDirectory,odp}=await import(${moduleUrl});
      const first=await odpDirectory();
      let loaded;
      for(let i=0;i<25;i++){
        loaded=await odpDirectory();if(loaded.index.complete)break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      // Join the actual source refresh before triggering a new projection.
      // Either parallel disk read can enter the shared queue first. Allow its
      // 2.1-second spacing, and complete the other source instead of holding its slot.
      let refreshDeadline;
      try {
        await Promise.race([
          odp('/meps/show-current',{limit:1000,offset:0}),
          new Promise((_,reject)=>{refreshDeadline=setTimeout(()=>reject(new Error('Source refresh did not finish')),4500);}),
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
