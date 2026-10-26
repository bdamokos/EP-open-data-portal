import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('a cold profile reads its bodies in one batch and later views read locally',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'corporate-body-batch-'));
  const previous=process.env.ODP_CACHE_DIR;process.env.ODP_CACHE_DIR=dir;
  t.after(async()=>{if(previous===undefined)delete process.env.ODP_CACHE_DIR;else process.env.ODP_CACHE_DIR=previous;await rm(dir,{recursive:true,force:true});});
  const committee=id=>({id:'org/'+id,identifier:id,isVersionOf:'org/C'+id,classification:'def/ep-entities/COMMITTEE_PARLIAMENTARY_STANDING',label:'C'+id,prefLabel:{en:'Committee '+id}});
  const bodies=new Map([['6363',committee('6363')],['6364',committee('6364')],['5177',{id:'org/5177',identifier:'5177',classification:'def/ep-entities/NATIONAL_POLITICAL_GROUP',prefLabel:{fr:'Parti'}}],['ep-9',{id:'org/ep-9',identifier:'ep-9',classification:'def/ep-entities/EU_INSTITUTION',prefLabel:{en:'Parliament'}}]]);
  const row=(organization,membershipClassification,startDate,endDate)=>({id:'membership/'+organization,organization:'org/'+organization,role:'def/ep-roles/MEMBER',membershipClassification:'def/ep-entities/'+membershipClassification,memberDuring:{startDate,...(endDate?{endDate}:{})}});
  // 9999 is absent upstream: the batch omits it and its single read still decides.
  const person={identifier:'124936',givenName:'Maria',familyName:'Arena',hasMembership:[row('6363','COMMITTEE_PARLIAMENTARY_STANDING','2024-07-16'),row('6364','COMMITTEE_PARLIAMENTARY_STANDING','2019-07-02','2024-07-15'),row('9999','COMMITTEE_PARLIAMENTARY_STANDING','2014-07-01','2019-07-01'),row('5177','NATIONAL_POLITICAL_GROUP','2019-07-02','2024-07-15')]};
  const requests=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);requests.push(url.pathname);
    if(url.pathname==='/api/v2/meps/124936')return Response.json({data:[person]});
    if(url.pathname==='/api/v2/meps/show-current')return Response.json({data:[]});
    const ids=url.pathname.match(/^\/api\/v2\/corporate-bodies\/([\w,-]+)$/)?.[1].split(',');
    if(ids){const data=ids.flatMap(id=>bodies.get(id)||[]);return data.length?Response.json({data,'@context':['ctx']}):Response.json({error:'Not found'},{status:404});}
    assert.fail('Unexpected upstream read '+url.pathname);
  });
  const {odpProfileWithMemberships,odp}=await import('./odp.mjs');
  const first=await odpProfileWithMemberships('124936');
  const bodyReads=requests.filter(url=>url.startsWith('/api/v2/corporate-bodies/'));
  assert.deepEqual(bodyReads,['/api/v2/corporate-bodies/5177,6363,6364,9999','/api/v2/corporate-bodies/9999']);
  assert.deepEqual(first.committeeMemberships.items.map(card=>card.code),['C6363']);
  assert.equal(first.committeeMemberships.complete,false,'the unavailable body still reports incomplete history');
  assert.equal(first.membershipHistory.items.find(item=>item.bodyId==='org/5177').body.prefLabel.fr,'Parti');
  // Seeded records keep the exact single-read URL and payload shape.
  const seeded=await odp('/corporate-bodies/6363',{},{cachedOnly:true});
  assert.equal(seeded.url,'https://data.europarl.europa.eu/api/v2/corporate-bodies/6363?format=application%2Fld%2Bjson');
  assert.deepEqual(seeded.payload,{data:[bodies.get('6363')],'@context':['ctx']});
  assert.equal(seeded.stale,false);
  assert.equal(seeded.retrievedFrom,'https://data.europarl.europa.eu/api/v2/corporate-bodies/5177,6363,6364,9999?format=application%2Fld%2Bjson');
  const committeeSource=first.committeeMemberships.sources.find(source=>source.url===seeded.url);
  assert.equal(committeeSource.retrievedFrom,seeded.retrievedFrom,'readers name the request that returned the body');
  assert.equal(first.membershipHistory.items.find(item=>item.bodyId==='org/5177').body.source.retrievedFrom,seeded.retrievedFrom);
  requests.length=0;
  await odpProfileWithMemberships('124936');
  assert.deepEqual(requests.filter(url=>url.startsWith('/api/v2/corporate-bodies/')).filter(url=>!url.endsWith('/9999')),[],'retained bodies are never read again');
});

test('a batch never replaces a single read of the same body that is still in flight',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'corporate-body-race-'));
  const previous=process.env.ODP_CACHE_DIR;process.env.ODP_CACHE_DIR=dir;
  t.after(async()=>{if(previous===undefined)delete process.env.ODP_CACHE_DIR;else process.env.ODP_CACHE_DIR=previous;await rm(dir,{recursive:true,force:true});});
  const body=label=>({id:'org/6363',identifier:'6363',classification:'def/ep-entities/COMMITTEE_PARLIAMENTARY_STANDING',label});
  let releaseSingle,singleStarted;const started=new Promise(resolve=>singleStarted=resolve);
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);
    if(url.pathname==='/api/v2/corporate-bodies/6363'){singleStarted();await new Promise(resolve=>releaseSingle=resolve);return Response.json({data:[body('single')]});}
    if(url.pathname==='/api/v2/corporate-bodies/6363,6364')return Response.json({data:[body('batch'),{...body('other'),id:'org/6364',identifier:'6364'}]});
    assert.fail('Unexpected upstream read '+url.pathname);
  });
  const {odp,prefetchCorporateBodies}=await import('./odp.mjs?race');
  const single=odp('/corporate-bodies/6363',{},{priority:'background'});
  await started;
  await prefetchCorporateBodies(['6363','6364'],{signal:undefined});
  assert.equal((await odp('/corporate-bodies/6364',{},{cachedOnly:true})).payload.data[0].label,'other');
  releaseSingle();await single;
  const kept=await odp('/corporate-bodies/6363',{},{cachedOnly:true});
  assert.equal(kept.payload.data[0].label,'single');assert.equal(kept.retrievedFrom,undefined);
  const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
  const onDisk=JSON.parse(await readFile(path.join(dir,createHash('sha256').update(kept.url).digest('hex')+'.json'),'utf8'));
  assert.equal(onDisk.payload.data[0].label,'single');
});

test('retained bodies stay fresh for days and refresh when the feed republishes them',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'corporate-body-feed-'));
  const previous=process.env.ODP_CACHE_DIR;process.env.ODP_CACHE_DIR=dir;
  t.after(async()=>{if(previous===undefined)delete process.env.ODP_CACHE_DIR;else process.env.ODP_CACHE_DIR=previous;await rm(dir,{recursive:true,force:true});});
  let label='first';const requests=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);requests.push(url.pathname);
    const ids=url.pathname.match(/^\/api\/v2\/corporate-bodies\/([\d,]+)$/)?.[1].split(',');
    if(ids)return Response.json({data:ids.map(id=>({id:'org/'+id,identifier:id,label}))});
    assert.fail('Unexpected upstream read '+url.pathname);
  });
  const {odp,prefetchCorporateBodies}=await import('./odp.mjs?feed');
  await prefetchCorporateBodies(['1','2'],{signal:undefined});
  const fetchedAt=(await odp('/corporate-bodies/1',{},{cachedOnly:true})).fetchedAt;
  label='early';requests.length=0;
  t.mock.timers.enable({apis:['Date'],now:fetchedAt+60*60*1000});
  await prefetchCorporateBodies(['1'],{signal:undefined,updates:new Map([['1',fetchedAt+1000]])});
  assert.deepEqual(requests,['/api/v2/corporate-bodies/1'],'a single republished body is read again within the general source age');
  assert.equal((await odp('/corporate-bodies/1',{},{cachedOnly:true})).payload.data[0].label,'early');
  t.mock.timers.reset();
  const refreshedAt=(await odp('/corporate-bodies/1',{},{cachedOnly:true})).fetchedAt;
  label='second';requests.length=0;
  t.mock.timers.enable({apis:['Date'],now:fetchedAt+3*24*60*60*1000});
  await prefetchCorporateBodies(['1','2'],{signal:undefined});
  assert.deepEqual(requests,[],'a three-day-old body is still fresh');
  await prefetchCorporateBodies(['1','2'],{signal:undefined,updates:new Map([['1',refreshedAt+1000],['2',fetchedAt-1000]])});
  assert.deepEqual(requests,['/api/v2/corporate-bodies/1'],'only the body republished after its read is refreshed');
  assert.equal((await odp('/corporate-bodies/1',{},{cachedOnly:true})).payload.data[0].label,'second');
  t.mock.timers.setTime(fetchedAt+8*24*60*60*1000);requests.length=0;
  await prefetchCorporateBodies(['2'],{signal:undefined});
  assert.deepEqual(requests,['/api/v2/corporate-bodies/2'],'the age limit is a backstop');
});
