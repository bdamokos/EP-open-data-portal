import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {execFileAsync,registerSubprocesses} from './test-support/subprocess.mjs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

beforeEach(registerSubprocesses);

const moduleUrl=JSON.stringify(new URL('./odp.mjs',import.meta.url).href);
const queueUrl=JSON.stringify(new URL('./upstream-queue.mjs',import.meta.url).href);
async function run(t,script) {
  const directory=await mkdtemp(path.join(tmpdir(),'directory-loading-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(path.join(directory,'sync-state.json'),JSON.stringify({lastSuccess:new Date().toISOString(),lastAttempt:new Date(Date.now()+86400_000).toISOString()}));
  return JSON.parse((await execFileAsync(t,process.execPath,['--input-type=module','-e',`
    // Exercise projection and recovery independently of upstream admission; the
    // source queue has its own rolling-limit and concurrency regression suite.
    const {UpstreamQueue}=await import(${queueUrl});
    UpstreamQueue.prototype.acquire=async()=>()=>{};
    UpstreamQueue.prototype.run=async operation=>operation();
    UpstreamQueue.prototype.runHeld=async operation=>operation(()=>{});
    const classification='def/ep-entities/COMMITTEE_PARLIAMENTARY_STANDING';
    const body={identifier:'6572',label:'EMPL',classification,temporal:{startDate:'2024-07-16'}};
    const person=id=>({identifier:String(id),givenName:'Public',familyName:'Member '+id,hasMembership:[{organization:'org/6572',role:'def/ep-roles/MEMBER',membershipClassification:classification,memberDuring:{startDate:'2024-07-16'}}]});
    const save=async(endpoint,params,data,age=0)=>{
      const {writeFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
      const url=new URL('https://data.europarl.europa.eu/api/v2'+endpoint);
      for(const [key,value] of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(key,String(value));
      await writeFile(process.env.ODP_CACHE_DIR+'/'+createHash('sha256').update(url.href).digest('hex')+'.json',JSON.stringify({url:url.href,fetchedAt:Date.now()-age,payload:{data}}));
    };
    const until=async predicate=>{for(let i=0;i<100;i++){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Fixture did not settle');};
    ${script}
  `],{env:{...process.env,ODP_CACHE_DIR:directory},encoding:'utf8'})).stdout);
}

test('a cold directory yields roster and exact committee IDs before optional details or profiles finish',async t=>{
  const out=await run(t,`
    let finishDetail,finishProfile,detailCalls=0,profileCalls=0;
    globalThis.fetch=async url=>{
      const endpoint=new URL(url).pathname;
      if(endpoint.endsWith('/meps/show-current'))return Response.json({data:[person(43)]});
      if(endpoint.endsWith('/corporate-bodies/show-current'))return Response.json({data:[body]});
      if(endpoint.endsWith('/corporate-bodies/6572')){detailCalls++;return new Promise(resolve=>finishDetail=()=>resolve(Response.json({data:[{...body,prefLabel:{fr:'Emploi'}}]})));}
      if(endpoint.endsWith('/meps/43')){profileCalls++;return new Promise(resolve=>finishProfile=()=>resolve(Response.json({data:[person(43)]})));}
      throw Error('Unexpected fixture source '+url);
    };
    const {odpDirectory}=await import(${moduleUrl});
    // Optional sources stay unresolved until after the directory returns. The
    // child-process timeout detects blocking without a host-speed threshold.
    const first=await odpDirectory();
    await until(()=>finishDetail&&finishProfile);
    const pending=await odpDirectory();
    finishDetail();finishProfile();
    const complete=await until(async()=>{const value=await odpDirectory();return value.committeeDetails.complete&&value.index.complete&&value;});
    console.log(JSON.stringify({first,pending,complete,detailCalls,profileCalls}));process.exit(0);
  `);
  assert.equal(out.first.members[0].id,43);
  assert.equal(out.first.members[0].memberships,null,'unknown memberships stay unavailable, not empty');
  assert.equal(out.first.committees[0].id,'6572');assert.equal(out.first.committees[0].code,'EMPL');
  assert.deepEqual(out.first.committees[0].names,{});assert.equal(out.first.committeeDetails.complete,false);
  assert.equal(out.pending.directoryCache.refreshInProgress,true);
  assert.deepEqual(out.complete.committees[0].names,{fr:'Emploi'});
  assert.equal(out.complete.index.complete,true);assert.equal(out.complete.members[0].memberships[0].id,'6572');
  assert.equal(out.detailCalls,1);assert.equal(out.profileCalls,1,'polling must join the existing owners');
});

test('unavailable and mismatched committee details keep exact catalogue codes and recover on retry',async t=>{
  const out=await run(t,`
    let calls=0,allowRecovery=false;
    globalThis.fetch=async url=>{
      const endpoint=new URL(url).pathname;
      if(endpoint.endsWith('/meps/show-current'))return Response.json({data:[]});
      if(endpoint.endsWith('/corporate-bodies/show-current'))return Response.json({data:[body]});
      if(endpoint.endsWith('/corporate-bodies/6572')){
        calls++;if(calls===1)return new Response('{}',{status:500});
        if(!allowRecovery)return Response.json({data:[{...body,identifier:'9999',prefLabel:{en:'Unrelated'}}]});
        return Response.json({data:[{...body,prefLabel:{en:'Employment'}}]});
      }
      throw Error('Unexpected fixture source '+url);
    };
    const {odpDirectory}=await import(${moduleUrl});
    const first=await odpDirectory();
    const failed=await until(async()=>{const value=await odpDirectory();return value.committeeDetails.error&&value;});
    // A mismatched cached ID must remain unavailable and be refreshable by
    // another directory read through the same background source writer.
    await until(async()=>{await odpDirectory({retryCommitteeDetails:true});return calls>=2;});
    await new Promise(resolve=>setTimeout(resolve,20));
    const mismatch=await odpDirectory();allowRecovery=true;
    const recovered=await until(async()=>{const value=await odpDirectory({retryCommitteeDetails:true});return value.committeeDetails.complete&&value;});
    console.log(JSON.stringify({first,failed,mismatch,recovered}));process.exit(0);
  `);
  for(const value of [out.first,out.failed,out.mismatch]) {
    assert.equal(value.committees[0].id,'6572');assert.equal(value.committees[0].code,'EMPL');
    assert.deepEqual(value.committees[0].names,{});assert.equal(value.committeeDetails.complete,false);
  }
  assert.match(out.failed.committeeDetails.error,/unavailable/);assert.equal(out.failed.committeeDetails.failed,1);
  assert.equal(out.recovered.committeeDetails.complete,true);assert.equal(out.recovered.committeeDetails.error,null);
  assert.deepEqual(out.recovered.committees[0].names,{en:'Employment'});
});

test('a partial membership retry retains successful profiles and requests only missing IDs',async t=>{
  const out=await run(t,`
    const calls={};let recover=false;
    globalThis.fetch=async url=>{
      const endpoint=new URL(url).pathname;
      if(endpoint.endsWith('/meps/show-current'))return Response.json({data:[person(43),person(44)]});
      if(endpoint.endsWith('/corporate-bodies/show-current'))return Response.json({data:[]});
      const id=endpoint.split('/').at(-1);calls[id]=(calls[id]||0)+1;
      if(id==='44'&&!recover)return new Response('{}',{status:500});
      if(id==='43'||id==='44')return Response.json({data:[person(id)]});
      throw Error('Unexpected fixture source '+url);
    };
    const {odpDirectory}=await import(${moduleUrl});await odpDirectory();
    const partial=await until(async()=>{const value=await odpDirectory();return value.index.error&&value;});
    const before={...calls};recover=true;
    const now=Date.now();Date.now=()=>now+8*86400_000;
    const complete=await until(async()=>{const value=await odpDirectory();return value.index.complete&&value;});
    console.log(JSON.stringify({partial,before,complete,calls}));process.exit(0);
  `);
  assert.equal(out.partial.index.loaded,1);assert.equal(out.partial.index.complete,false);
  assert.equal(out.partial.members[0].memberships[0].id,'6572');assert.equal(out.partial.members[1].memberships,null);
  assert.equal(out.complete.index.complete,true);assert.equal(out.complete.index.loaded,2);
  assert.equal(out.complete.index.error,null);assert.equal(out.complete.index.failed,0);
  assert.equal(out.calls['43'],1,'a failed peer must not restart successful profile reads');
  assert(out.calls['44']>out.before['44']);
});


test('automatic directory polling respects failed detail refresh deadlines while explicit retry recovers',async t=>{
  const out=await run(t,`
    await save('/meps/show-current',{limit:1000,offset:0},[]);
    await save('/corporate-bodies/show-current',{limit:1000,offset:0},[body]);
    await save('/corporate-bodies/6572',{},[{...body,prefLabel:{fr:'Nom retenu'}}],8*24*3600_000);
    let calls=0,recover=false;
    globalThis.fetch=async url=>{
      if(!new URL(url).pathname.endsWith('/corporate-bodies/6572'))throw Error('Unexpected fixture source '+url);
      calls++;return recover?Response.json({data:[{...body,prefLabel:{fr:'Nom actualisé'}}]}):new Response('{}',{status:500});
    };
    const {odpDirectory}=await import(${moduleUrl});const first=await odpDirectory();
    const failed=await until(async()=>{const value=await odpDirectory();return value.committeeDetails.error&&value;});
    for(let i=0;i<5;i++){await odpDirectory();await new Promise(resolve=>setTimeout(resolve,5));}
    const automaticCalls=calls;recover=true;await odpDirectory({retryCommitteeDetails:true});
    const complete=await until(async()=>{const value=await odpDirectory();return !value.committeeDetails.error&&!value.directoryCache.stale&&value;});
    console.log(JSON.stringify({first,failed,automaticCalls,calls,complete}));process.exit(0);
  `);
  assert.deepEqual(out.first.committees[0].names,{fr:'Nom retenu'});assert.equal(out.first.directoryCache.stale,true);
  assert.deepEqual(out.failed.committees[0].names,{fr:'Nom retenu'});assert.equal(out.automaticCalls,1);
  assert.equal(out.calls,2);assert.deepEqual(out.complete.committees[0].names,{fr:'Nom actualisé'});
  assert.equal(out.complete.committeeDetails.error,null);assert.equal(out.complete.committeeDetails.complete,true);
});

test('completion of another committee detail cannot revert a newer exact-ID feed update',async t=>{
  const out=await run(t,`
    const other={...body,identifier:'6573',label:'ENVI'};
    await save('/meps/show-current',{limit:1000,offset:0},[]);
    await save('/corporate-bodies/show-current',{limit:1000,offset:0},[body,other]);
    await save('/corporate-bodies/6572',{},[{...body,prefLabel:{en:'Old A'}}],60_000);
    let finishOther;
    globalThis.fetch=async url=>{
      const endpoint=new URL(url).pathname;
      if(endpoint.endsWith('/corporate-bodies/6573'))return new Promise(resolve=>finishOther=()=>resolve(Response.json({data:[{...other,prefLabel:{en:'Committee B'}}]})));
      if(endpoint.endsWith('/corporate-bodies/6572'))return Response.json({data:[{...body,prefLabel:{en:'New A'}}]});
      if(endpoint.endsWith('/meps/feed'))return new Response('<feed/>');
      if(endpoint.endsWith('/corporate-bodies/feed'))return new Response('<feed><entry><id>https://data.europarl.europa.eu/org/6572</id><updated>'+new Date(Date.now()+1000).toISOString()+'</updated></entry></feed>');
      throw Error('Unexpected fixture source '+url);
    };
    const {odpDirectory,syncOdpFeeds}=await import(${moduleUrl});await odpDirectory();await until(()=>finishOther);
    const sync=await syncOdpFeeds({force:true});const updated=await odpDirectory();finishOther();
    const complete=await until(async()=>{const value=await odpDirectory();return value.committeeDetails.complete&&value;});
    console.log(JSON.stringify({sync,updated,complete}));process.exit(0);
  `);
  assert.equal(out.sync.error,null);assert.equal(out.sync.changedCommittees,1);
  assert.deepEqual(out.updated.committees.find(body=>body.id==='6572').names,{en:'New A'});
  assert.deepEqual(out.complete.committees.find(body=>body.id==='6572').names,{en:'New A'});
  assert.deepEqual(out.complete.committees.find(body=>body.id==='6573').names,{en:'Committee B'});
});

test('a profile body observation applies exact ended bounds to the existing directory without extra reads',async t=>{
 const out=await run(t,`
  const party={id:'org/6831',identifier:'6831',classification:'def/ep-entities/NATIONAL_POLITICAL_GROUP',prefLabel:{en:'Example party'},temporal:{startDate:'2024-07-16',endDate:'2025-01-01'}};
  const p={...person(43),hasMembership:[{id:'membership/43',organization:{id:'org/6831'},role:'def/ep-roles/MEMBER',membershipClassification:party.classification,memberDuring:{startDate:'2024-09-01'}}]};
  let reads=0;
  globalThis.fetch=async url=>{
   reads++;const endpoint=new URL(url).pathname;
   if(endpoint.endsWith('/meps/show-current'))return Response.json({data:[p]});
   if(endpoint.endsWith('/corporate-bodies/show-current'))return Response.json({data:[]});
   if(endpoint.endsWith('/meps/43'))return Response.json({data:[p]});
   if(endpoint.endsWith('/corporate-bodies/6831'))return Response.json({data:[party]});
   throw Error('Unexpected fixture '+url);
  };
  const {odpDirectory,odpProfileWithMemberships}=await import(${moduleUrl});
  await odpDirectory();const before=await until(async()=>{const d=await odpDirectory();return d.index.complete&&d;});
  await odpProfileWithMemberships(43);const readCount=reads;
  const after=await odpDirectory();console.log(JSON.stringify({before,after,readCount,reads}));process.exit(0);
 `);
 assert.equal(out.before.members[0].organizationMemberships[0].id,'6831');
 assert.equal(out.before.members[0].organizationMemberships[0].current,true);
 assert.equal(out.after.members[0].organizationMemberships[0].current,false);
 assert.equal(out.reads,out.readCount,'directory applies known metadata without fetching bodies');
});

test('directory completeness follows newly uncertain body bounds and preserves missing observations',async t=>{
 const out=await run(t,`
  const party={id:'org/6831',identifier:'6831',classification:'def/ep-entities/NATIONAL_POLITICAL_GROUP',temporal:{startDate:'2026-02-30'}};
  const p={...person(43),hasMembership:[{organization:'org/6831',memberDuring:{startDate:'2024-09-01'}}]};
  globalThis.fetch=async url=>{
   const endpoint=new URL(url).pathname;
   if(endpoint.endsWith('/meps/show-current'))return Response.json({data:[p,{...person(44),hasMembership:[null]}]});
   if(endpoint.endsWith('/corporate-bodies/show-current'))return Response.json({data:[]});
   if(endpoint.endsWith('/meps/43'))return Response.json({data:[p]});
   if(endpoint.endsWith('/meps/44'))return Response.json({data:[{...person(44),hasMembership:[null]}]});
   if(endpoint.endsWith('/corporate-bodies/6831'))return Response.json({data:[party]});
   throw Error('Unexpected fixture '+url);
  };
  const {odpDirectory,odp}=await import(${moduleUrl});
  await odpDirectory();const before=await until(async()=>{const d=await odpDirectory();return d.index.complete&&d;});
  await odp('/corporate-bodies/6831');
  const after=await odpDirectory();console.log(JSON.stringify({before,after}));process.exit(0);
 `);
 const original=out.before.members.find(m=>m.id===43),updated=out.after.members.find(m=>m.id===43);
 assert.equal(original.organizationMemberships[0].current,true);assert.equal(original.organizationMembershipsComplete,true);
 assert.equal(updated.organizationMemberships[0].current,null);
 assert.equal(updated.organizationMembershipsComplete,false,'new uncertainty changes aggregate completeness');
 const {organizationCoverageComplete}=await import('../src/memberFilters.mjs');
 assert.equal(organizationCoverageComplete(updated,'9999'),false,'another organisation filter cannot report definitive coverage');
 assert.equal(out.after.members.find(m=>m.id===44).organizationMembershipsComplete,false,'malformed original observations remain incomplete');
});

test('cold profiles project membership status and completeness after body enrichment',async t=>{
 const out=await run(t,`
  const partyClass='def/ep-entities/NATIONAL_POLITICAL_GROUP';
  const bodies=['6831','6832'].map((id,i)=>({id:'org/'+id,identifier:id,classification:partyClass,prefLabel:{en:'Example party '+id},temporal:{startDate:'2024-07-16',endDate:i?'2026-02-30':'2025-01-01'}}));
  const persons=bodies.map((b,i)=>({...person(43+i),hasMembership:[{organization:b.id,role:'def/ep-roles/MEMBER',membershipClassification:partyClass,memberDuring:{startDate:'2024-09-01'}}]}));
  globalThis.fetch=async url=>{
   const endpoint=new URL(url).pathname;
   if(endpoint.endsWith('/meps/show-current'))return Response.json({data:persons});
   const p=persons.find(p=>endpoint.endsWith('/meps/'+p.identifier));if(p)return Response.json({data:[p]});
   const b=bodies.find(b=>endpoint.endsWith('/corporate-bodies/'+b.identifier));if(b)return Response.json({data:[b]});
   throw Error('Unexpected fixture '+url);
  };
  const {odpProfileWithMemberships}=await import(${moduleUrl});
  const ended=await odpProfileWithMemberships(43),uncertain=await odpProfileWithMemberships(44);
  console.log(JSON.stringify({ended,uncertain}));process.exit(0);
 `);
 assert.equal(out.ended.membershipHistory.items[0].body.temporal.endDate,'2025-01-01');
 assert.equal(out.ended.organizationMemberships[0].current,false,'returned status reflects its own enriched body record');
 assert.equal(out.ended.organizationMembershipsComplete,true);
 assert.equal(out.uncertain.organizationMemberships[0].current,null,'invalid enriched bounds remain uncertain');
 assert.equal(out.uncertain.organizationMembershipsComplete,false);
});
