import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('only the profile wrapper enriches bodies and reuses the exact primary person read',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'profile-enrichment-'));
  const previous=process.env.ODP_CACHE_DIR;process.env.ODP_CACHE_DIR=dir;
  t.after(async()=>{if(previous===undefined)delete process.env.ODP_CACHE_DIR;else process.env.ODP_CACHE_DIR=previous;await rm(dir,{recursive:true,force:true});});
  const membership={id:'membership/124936-f-153501',organization:'org/5177',role:'def/ep-roles/MEMBER',membershipClassification:'def/ep-entities/NATIONAL_POLITICAL_GROUP',memberDuring:{startDate:'2019-07-02',endDate:'2024-07-15'}};
  const person={identifier:'124936',givenName:'Maria',familyName:'Arena',hasMembership:[membership,{...membership,id:'membership/second',organization:'org/5154'},{id:'membership/124936-m-16006',organization:'org/ep-9',role:'def/ep-roles/MEMBER_PARLIAMENT',memberDuring:{startDate:'2019-07-02',endDate:'2024-07-15'}}]};
  const requests=[];let retriedLabel,failMember=false,invalidMember=false;
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);requests.push(url.pathname);
    if(url.pathname==='/api/v2/meps/124936'&&invalidMember)return Response.json({data:[]});
    if(url.pathname==='/api/v2/meps/124936')return failMember?Response.json({error:'Unavailable'},{status:404}):Response.json({data:[person]});
    if(url.pathname==='/api/v2/meps/show-current')return Response.json({data:[]});
    if(url.pathname==='/api/v2/corporate-bodies/5177')return Response.json({data:[{id:'org/5177',identifier:'5177',classification:membership.membershipClassification,prefLabel:{fr:'Parti Socialiste'}}]});
    if(url.pathname==='/api/v2/corporate-bodies/5154')return Response.json({data:[{id:'org/5154',identifier:'5154',classification:membership.membershipClassification,prefLabel:retriedLabel}]});
    assert.fail('Unexpected upstream read '+url.pathname);
  });
  const {odpProfile,odpProfileWithMemberships}=await import('./odp.mjs');
  const ordinary=await odpProfile('124936');
  assert.equal(ordinary.membershipHistory,undefined);assert.equal(ordinary.observations,undefined);
  assert.deepEqual(requests,['/api/v2/meps/124936','/api/v2/meps/show-current']);
  const enriched=await odpProfileWithMemberships('124936');
  assert.equal(requests.filter(url=>url==='/api/v2/meps/124936').length,1);
  assert.equal(enriched.membershipHistory.items.length,2);assert.equal(enriched.membershipHistory.items[0].body.prefLabel.fr,'Parti Socialiste');
  assert.equal(enriched.parliamentaryService.complete,true);assert.equal(enriched.currentAffiliation.status,'not-current');
  assert.equal(enriched.committeeMemberships.complete,true);assert.equal(enriched.committeeMemberships.items.length,0);
  assert.equal((await odpProfile('124936')).membershipHistory,undefined);
  assert.equal(enriched.membershipHistory.labelsComplete,false);
  assert.equal(enriched.membershipHistory.items.find(row=>row.bodyId==='org/5154').body.source.url,'https://data.europarl.europa.eu/api/v2/corporate-bodies/5154?format=application%2Fld%2Bjson');
  for(const label of [[],{en:'   '},{fr:'Parti rétabli'}]) {
    retriedLabel=label;
    const retried=await odpProfileWithMemberships('124936');
    assert.equal(retried.membershipHistory.labelsComplete,!Array.isArray(label)&&Boolean(label.fr));
  }
  const recovered=await odpProfileWithMemberships('124936');
  assert.equal(recovered.membershipHistory.labelsComplete,true);
  assert.equal(requests.filter(url=>url==='/api/v2/corporate-bodies/5154').length,4);
  assert.equal(requests.filter(url=>url==='/api/v2/corporate-bodies/5177').length,1);
  assert.equal(requests.filter(url=>url==='/api/v2/meps/124936').length,1);
  person.hasMembership.push({},'bad',null);
  await odpProfile('124936',true);
  const malformed=await odpProfileWithMemberships('124936');
  assert.equal(malformed.membershipHistory.observationAvailable,true);
  assert.equal(malformed.membershipHistory.observationComplete,false);
  assert.equal(malformed.membershipHistory.observationIssues.length,3);
  assert.equal(malformed.membershipHistory.items.length,2);
  assert.deepEqual(malformed.membershipHistory.observations.slice(-3),[{},'bad',null]);
  assert.equal(malformed.committeeMemberships.complete,false);
  assert.match(malformed.committeeMemberships.error,/incomplete/);
  failMember=true;
  const retained=await odpProfileWithMemberships('124936');
  assert.equal(retained.firstName,'Maria');assert.equal(retained.membershipHistory.items.length,2);
  assert.equal(retained.membershipHistory.sources[0].stale,true);
  failMember=false;invalidMember=true;
  for(let i=0;i<2;i++) {
    const invalidRefresh=await odpProfileWithMemberships('124936');
    assert.equal(invalidRefresh.firstName,'Maria');assert.equal(invalidRefresh.membershipHistory.items.length,2);
    assert.equal(invalidRefresh.membershipHistory.sources[0].stale,true);
  }
  invalidMember=false;person.hasMembership=[];failMember=false;
  const refreshed=await odpProfileWithMemberships('124936');
  assert.equal(refreshed.membershipHistory.observationComplete,true);assert.deepEqual(refreshed.membershipHistory.observations,[]);
  const reads=requests.filter(url=>url==='/api/v2/meps/124936').length;
  await odpProfileWithMemberships('124936');assert.equal(requests.filter(url=>url==='/api/v2/meps/124936').length,reads,'recovered records reuse their cache');
});
