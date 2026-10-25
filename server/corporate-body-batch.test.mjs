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
  requests.length=0;
  await odpProfileWithMemberships('124936');
  assert.deepEqual(requests.filter(url=>url.startsWith('/api/v2/corporate-bodies/')).filter(url=>!url.endsWith('/9999')),[],'retained bodies are never read again');
});
