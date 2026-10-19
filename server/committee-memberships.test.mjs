import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {committeeMemberships,createCommitteeMembershipReader} from './committee-memberships.mjs';
import {memberships,odp} from './odp.mjs';

const fixture=JSON.parse(await readFile(new URL('./fixtures/committee-roles.json',import.meta.url)));
const bodies=fixture.bodies.map(x=>x.data);
const person=id=>fixture.people.find(x=>x.data.identifier===id).data;
const rows=id=>memberships(person(id),'2022-02-01');
const cards=id=>committeeMemberships(rows(id),bodies,'2022-02-01');
const card=(id,code)=>cards(id).find(x=>x.code===code);

test('term 9 FEMM and EMPL handovers retain the outgoing chair as an ordinary member',()=>{
  for(const [id,code,end,start] of [['96998','FEMM','2022-01-24','2022-01-25'],['197766','EMPL','2022-01-23','2022-01-24']]) {
    const value=card(id,code);
    assert.equal(value.periods[0].role,'MEMBER');assert.equal(value.periods[0].start,start);assert.equal(value.periods[0].current,true);
    const chair=value.periods.find(x=>x.role==='CHAIR');assert.equal(chair.end,end);assert.equal(chair.current,false);
    assert(chair.observations.length>=2,'touching chair observations are combined without losing their IDs');
  }
  assert.equal(card('197498','FEMM').periods[0].start,'2022-01-25');
  assert.equal(card('197498','FEMM').periods[0].role,'CHAIR');
  assert.equal(card('197663','EMPL').periods[0].start,'2022-01-24');
  assert.equal(card('197663','EMPL').periods[1].role,'MEMBER');
});

test('touching chairmanships merge across exact temporal versions in TRAN, AFET, REGI, AGRI and ECON',()=>{
  for(const [id,code,start] of [['96868','TRAN','2019-07-10'],['124806','AFET','2019-07-10'],['30482','REGI','2019-07-10'],['124808','AGRI','2019-07-10'],['197591','ECON','2019-09-16']]) {
    const value=card(id,code),chair=value.periods.filter(x=>x.role==='CHAIR');
    assert.equal(chair.length,1,code);assert.equal(chair[0].start,start);assert.equal(chair[0].end,'2024-07-15');
    assert.equal(chair[0].observations.length,2);assert.equal(new Set(chair[0].observations.map(x=>x.bodyId)).size,2);
    assert(chair[0].observations.every(x=>x.membershipId));
  }
});

const classification='COMMITTEE_PARLIAMENTARY_STANDING';
const body=(identifier,isVersionOf='org/TEST')=>({identifier,isVersionOf,label:'TEST',classification:'def/ep-entities/'+classification});
const row=(id,role,start,end=null)=>({id,role,start,end,classification,membershipId:'membership/'+id+'-'+role+'-'+start,current:false});
const project=(input,metadata=[body('1'),body('2')],day='2026-10-19')=>committeeMemberships(input,metadata,day);
test('history belongs only to currently active committees; future appointments remain hidden',()=>{
  const value=project([row('1','CHAIR','2025-01-01','2026-10-18'),row('1','MEMBER','2026-10-19'),row('3','CHAIR','2025-01-01','2026-01-01'),row('2','CHAIR','2026-11-01')]);
  assert.equal(value.length,1);assert.deepEqual(value[0].roles,['MEMBER']);assert.equal(value[0].periods.length,2);
});
test('matching codes do not connect bodies without the exact canonical relationship',()=>{
  const input=[row('1','CHAIR','2025-01-01','2025-12-31'),row('2','CHAIR','2026-01-01')];
  for(const metadata of [[body('1',undefined),body('2','org/OTHER')],[{...body('1'),isVersionOf:null},body('2')],[]]) {
    const value=project(input,metadata);assert.equal(value.length,1);assert.equal(value[0].periods.length,1);assert.equal(value[0].periods[0].start,'2026-01-01');
  }
});
test('gaps, overlaps, unknown dates, changed roles and conflicting observations never merge',()=>{
  const variants=[
    [row('1','CHAIR','2025-01-01','2025-12-30'),row('2','CHAIR','2026-01-01')],
    [row('1','CHAIR','2025-01-01','2026-01-01'),row('2','CHAIR','2026-01-01')],
    [row('1','CHAIR',null,'2025-12-31'),row('2','CHAIR','2026-01-01')],
    [row('1','CHAIR','2025-01-01','2025-12-31'),row('2','MEMBER','2026-01-01')],
    [row('1','CHAIR','2025-01-01','2025-12-31'),row('1','MEMBER','2025-12-31','2026-01-01'),row('2','CHAIR','2026-01-01')],
  ];
  for(const input of variants){const before=JSON.stringify(input);const value=project(input);assert.equal(value[0].periods.length,input.length);assert.equal(JSON.stringify(input),before);}
});
test('same-body consecutive chair periods merge regardless of input order, but classifications stay distinct',()=>{
  const input=[row('1','CHAIR','2026-01-01'),row('1','CHAIR','2025-01-01','2025-12-31')];
  assert.equal(project(input)[0].periods.length,1);
  const changed=structuredClone(input);changed[1].classification='COMMITTEE_PARLIAMENTARY_SUB';
  assert.equal(project(changed,[])[0].periods.length,2);
});
test('a missing exact body or timeout yields usable current roles and retryable incomplete history',async()=>{
  const profile={memberships:[row('2','MEMBER','2026-01-01'),row('1','CHAIR','2025-01-01','2025-12-31')]};
  let recover=false;
  const request=async endpoint=>{
    const id=endpoint.split('/').at(-1);if(id==='1'&&!recover)throw Error('Unavailable');
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.parse('2026-10-19'),payload:{data:[body(id)]}};
  };
  const read=createCommitteeMembershipReader({request});
  const partial=await read(profile,'2026-10-19');assert.equal(partial.complete,false);assert.match(partial.error,/unavailable/);assert.deepEqual(partial.items[0].roles,['MEMBER']);
  recover=true;const complete=await read(profile,'2026-10-19');assert.equal(complete.complete,true);assert.equal(complete.items[0].periods.length,2);assert.equal(complete.sources.length,2);
  const mismatch=await createCommitteeMembershipReader({request:async()=>({payload:{data:[body('999')]}})})(profile,'2026-10-19');assert.equal(mismatch.complete,false);
  const timed=await createCommitteeMembershipReader({budgetMs:5,request:async(_e,_p,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))})(profile,'2026-10-19');assert.equal(timed.complete,false);assert.equal(timed.items.length,1);
});
test('body enrichment caps downloads at 64 and retains every current membership',async()=>{
  let calls=0;
  const read=createCommitteeMembershipReader({request:async endpoint=>{calls++;return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.now(),payload:{data:[body(endpoint.split('/').at(-1))]}};}});
  const value=await read({memberships:Array.from({length:70},(_,i)=>row(String(i+1),'MEMBER','2026-01-01'))},'2026-10-19');
  assert.equal(calls,64);assert.equal(value.complete,false);assert.equal(value.items.flatMap(x=>x.periods).length,70);
});
test('profiles without active committee service perform no historical reads',async()=>{
  const read=createCommitteeMembershipReader({request:()=>{throw Error('Unexpected historical download');}});
  const value=await read({memberships:[row('1','CHAIR','2019-07-10','2024-07-15')]},'2026-10-19');assert.equal(value.complete,true);assert.deepEqual(value.items,[]);
});
test('leaving the profile aborts in-flight history reads and prevents additional requests',async()=>{
  const parent=new AbortController(),started=[],active=[];
  const read=createCommitteeMembershipReader({request:async(endpoint,_params,{signal})=>{
    started.push(endpoint);
    return new Promise((resolve,reject)=>{
      const abort=()=>{active.push(endpoint);reject(signal.reason);};
      if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
      if(started.length===2)parent.abort(new Error('Profile closed'));
    });
  }});
  await assert.rejects(read({memberships:Array.from({length:6},(_,i)=>row(String(i+1),'MEMBER','2026-01-01'))},'2026-10-19',{signal:parent.signal}),/Profile closed/);
  assert.equal(started.length,2);assert.equal(active.length,2);
});
test('retry revalidates an identity-invalid body retained by the real source cache',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({data:[body(calls===1?'999999':'981012')]});});
  const read=createCommitteeMembershipReader({request:odp});
  const profile={memberships:[row('981012','MEMBER','2026-01-01')]};
  const first=await read(profile,'2026-10-19');assert.equal(first.complete,false);assert.equal(calls,1);
  const second=await read(profile,'2026-10-19');assert.equal(second.complete,true);assert.equal(second.items[0].code,'TEST');assert.equal(calls,2);
});
test('excluded joint memberships neither download bodies nor make history incomplete',async()=>{
  const calls=[];
  const read=createCommitteeMembershipReader({request:async endpoint=>{calls.push(endpoint);return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.now(),payload:{data:[body('1')]}};}});
  const value=await read({memberships:[row('1','MEMBER','2026-01-01'),{...row('2','MEMBER','2020-01-01','2021-01-01'),classification:'COMMITTEE_PARLIAMENTARY_JOINT'}]},'2026-10-19');
  assert.equal(value.complete,true);assert.deepEqual(calls,['/corporate-bodies/1']);
});
test('unreadable committee IDs remain an explicit gap while valid current roles stay usable',async()=>{
  const calls=[];
  const read=createCommitteeMembershipReader({request:async endpoint=>{calls.push(endpoint);return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.now(),payload:{data:[body('1')]}};}});
  const value=await read({memberships:[row('1','MEMBER','2026-01-01'),row('not-numeric','CHAIR','2020-01-01','2021-01-01')]},'2026-10-19');
  assert.equal(value.complete,false);assert(value.error);assert.equal(value.items[0].roles[0],'MEMBER');assert.deepEqual(calls,['/corporate-bodies/1']);
});
