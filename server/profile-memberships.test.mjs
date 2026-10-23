import test from 'node:test';
import assert from 'node:assert/strict';
import {profileMemberships,createProfileMembershipReader} from './profile-memberships.mjs';
import {createCommitteeMembershipReader} from './committee-memberships.mjs';
import {apiCachePolicy} from './response-cache.mjs';

const stamp=Date.parse('2026-10-23T12:00:00Z');
const record={url:'https://data.europarl.europa.eu/api/v2/meps/124936',fetchedAt:stamp};
const classification='def/ep-entities/NATIONAL_POLITICAL_GROUP';
const row=(id,start='2019-07-02',end='2024-07-15',extra={})=>({id:'membership/'+id,organization:'org/'+id,role:'def/ep-roles/MEMBER',membershipClassification:classification,memberDuring:{startDate:start,endDate:end},...extra});
const history=rows=>profileMemberships({hasMembership:rows},record);
const body=id=>({id:'org/'+id,identifier:id,classification,prefLabel:{fr:'Parti Socialiste'},isVersionOf:'org/SAME',temporal:{endDate:'2024-07-15'}});
const response=value=>({...record,url:record.url.replace('/meps/124936','/corporate-bodies/'+value.identifier),payload:{data:[value]}});
const read=(request)=>createProfileMembershipReader({request});
const policy=value=>apiCachePolicy({method:'GET'},new URL('https://example.test/api/profile/124936'),{membershipHistory:value}).cdnCacheControl;

test('missing observations, explicit empty observations, date issues and label gaps remain independent',async()=>{
  for(const person of [{},{hasMembership:null}]) {
    const value=profileMemberships(person,record);assert.equal(value.observations,null);assert.equal(value.observationComplete,false);assert.equal(value.complete,false);
    assert.equal(policy(value),'no-store');
  }
  const empty=await read(()=>assert.fail('No body read for empty observations'))(history([]));
  assert.equal(empty.observationComplete,true);assert.equal(empty.labelsComplete,true);assert.equal(empty.complete,true);
  const invalid=history([row('5177',null,null),row('5154','2024-02-30','2023-01-01'),row('5142','2024-07-15','2019-07-02')]);
  assert.deepEqual(invalid.items[0].dateIssues,['missing-start','missing-end']);assert(invalid.items[1].dateIssues.includes('invalid-start'));assert(invalid.items[2].dateIssues.includes('reversed-period'));
  assert.equal(invalid.observationComplete,true);assert.equal(invalid.dateIssues,true);
});

test('exact identities and classifications resolve labels without combining equal names, versions, roles or periods',async()=>{
  // Observation shapes: public /meps/124936, retrieved 23 October 2026.
  const delegation='def/ep-entities/DELEGATION_PARLIAMENTARY_ASSEMBLY';
  const rows=[row('5177'),row('5154'),row('5142','2019-07-02','2021-05-18',{membershipClassification:delegation}),row('5142','2021-05-19','2023-12-31',{role:'def/ep-roles/CHAIR_VICE',membershipClassification:delegation}),row('5142','2024-01-02','2024-07-15',{membershipClassification:delegation})];
  const value=await read(async endpoint=>{const id=endpoint.split('/').at(-1);return response({...body(id),...(id==='5142'?{classification:delegation}:{})});})(history(rows));
  assert.equal(value.items.length,5);assert.equal(value.items.filter(item=>item.bodyId==='org/5142').length,3);
  assert.deepEqual(value.observations,rows);assert.equal(value.items[0].start,'2024-01-02');assert.equal(value.complete,true);
  assert(value.items.every(item=>item.body.prefLabel.fr==='Parti Socialiste'));
  assert.equal(value.items.find(item=>item.bodyId==='org/5177').body.temporal.endDate,'2024-07-15');
  for(const wrong of [{...body('5177'),id:'org/999'},{...body('5177'),identifier:'999'},{...body('5177'),classification:'def/ep-entities/EU_POLITICAL_GROUP'}]) {
    const result=await read(async()=>response(wrong))(history([row('5177')]));assert.equal(result.items[0].body,null);assert.equal(result.items[0].bodyId,'org/5177');assert.equal(result.labelsComplete,false);assert.equal(policy(result),'no-store');
  }
});

test('metadata work is capped at 16 unique bodies, two concurrent reads, affiliations before recent roles',async()=>{
  const seen=[];let running=0,maximum=0;
  const rows=[...Array.from({length:20},(_,i)=>row(String(i+1),'2020-01-01','2021-01-01',{membershipClassification:'def/ep-entities/WORKING_GROUP'})),row('5177'),row('5154')];
  const value=await read(async endpoint=>{
    const id=endpoint.split('/').at(-1);seen.push(id);maximum=Math.max(maximum,++running);await new Promise(resolve=>setTimeout(resolve,1));running--;
    return response({...body(id),classification:rows.find(row=>row.organization==='org/'+id).membershipClassification});
  })(history(rows));
  assert.equal(seen.length,16);assert.equal(maximum,2);assert.deepEqual(new Set(seen.slice(0,2)),new Set(['5177','5154']));
  assert.equal(value.items.length,22);assert.equal(value.labelsComplete,false);assert(value.items.some(item=>!item.body));
});

test('one optional deadline preserves successful labels and current committee rows; parent cancellation propagates',async()=>{
  const signal=AbortSignal.timeout(15);
  let calls=0;
  const value=await read(async endpoint=>{calls++;return endpoint.endsWith('/5177')?response(body('5177')):new Promise(()=>{});})(history([row('5177'),row('5154')]),{signal});
  assert.equal(calls,2);assert(value.items.find(item=>item.bodyId==='org/5177').body);assert.equal(value.labelsComplete,false);
  const committeeRead=createCommitteeMembershipReader({request:()=>assert.fail('Expired shared budget must not start another read')});
  const committees=await committeeRead({memberships:[{id:'1',role:'MEMBER',classification:'COMMITTEE_PARLIAMENTARY_STANDING',start:'2024-07-16',end:null}]},'2026-10-23',{optionalSignal:signal});
  assert.equal(committees.complete,false);assert.equal(committees.items.length,1);
  const controller=new AbortController();
  const pending=read(async()=>{controller.abort(Error('navigation'));return new Promise(()=>{});})(history([row('5177')]),{signal:controller.signal,parentSignal:controller.signal});
  await assert.rejects(pending,/navigation/);
});

test('stale labels and isolated failures retain source metadata and readable rows',async()=>{
  const value=await read(async endpoint=>{if(endpoint.endsWith('/5154'))throw Error('Unavailable');return {...response(body('5177')),stale:true};})(history([row('5177'),row('5154')]));
  assert.equal(value.items.length,2);assert.equal(value.sources.length,2);assert.equal(value.sources[1].stale,true);assert.equal(value.complete,false);assert.equal(policy(value),'no-store');
});

test('explicit retry refreshes a rejected body without forcing valid identities',async()=>{
  const forces=[];let recovered=false;
  const reader=read(async (_endpoint,_params,options)=>{forces.push(options.force);return response(recovered?body('5177'):{...body('5177'),id:'org/999'});});
  assert.equal((await reader(history([row('5177')]))).labelsComplete,false);
  recovered=true;assert.equal((await reader(history([row('5177')]))).labelsComplete,true);
  await reader(history([row('5177')]));assert.deepEqual(forces,[false,true,false]);
});


test('joint-committee delegations are included and unknown classifications remain in raw observations',()=>{
  const input=[row('42','2009-07-14','2014-06-30',{membershipClassification:'def/ep-entities/DELEGATION_JOINT_COMMITTEE'}),row('43',null,null,{membershipClassification:'def/ep-entities/UNKNOWN_BODY'})];
  const value=history(input);assert.equal(value.items.length,1);assert.equal(value.items[0].section,'delegations');assert.deepEqual(value.observations,input);
});

test('Parliament offices retain exact term bodies without repeating ordinary mandates',async()=>{
  const rows=['MEMBER','MEMBER_PARLIAMENT','PRESIDENT','PRESIDENT_VICE','QUAESTOR'].map((role,index)=>({id:'membership/office-'+index,organization:'org/ep-9',role:'def/ep-roles/'+role,membershipClassification:'def/ep-entities/EU_INSTITUTION',memberDuring:{startDate:'2020-01-01',endDate:'2024-07-15'}}));
  const history=profileMemberships({hasMembership:rows},{url:'https://data.europarl.europa.eu/api/v2/meps/118859',fetchedAt:0});
  assert.deepEqual(history.items.map(row=>row.role.split('/').at(-1)),['PRESIDENT','PRESIDENT_VICE','QUAESTOR']);
  let calls=0;
  const reader=createProfileMembershipReader({request:async endpoint=>{calls++;assert.equal(endpoint,'/corporate-bodies/ep-9');return {url:'https://data.europarl.europa.eu/api/v2/corporate-bodies/ep-9',fetchedAt:0,payload:{data:[{id:'org/ep-9',identifier:'ep-9',classification:'def/ep-entities/EU_INSTITUTION',prefLabel:{en:'European Parliament'}}]}};}});
  const result=await reader(history);assert.equal(calls,1);assert.equal(result.complete,true);
});
