import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {memberAttendance,MemberAttendance} from './member-attendance.mjs';
import {API_VERSION} from './api-version.mjs';
import {requestSignal} from './request-budget.mjs';
import {loopback} from './test-support/loopback.mjs';
const SITTING='MTG-PL-2026-10-22';

test('attendance route admits bounded queries with versioning, no-store and independent source errors',loopback,async t=>{
  const enabled={activity:process.env.ACTIVITY_INDEX_ENABLED,corpus:process.env.CORPUS_ENABLED};
  process.env.ACTIVITY_INDEX_ENABLED='false';process.env.CORPUS_ENABLED='false';
  const original=memberAttendance.query;
  const service=new MemberAttendance({request:async endpoint=>({url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.parse('2026-10-23T12:00:00Z'),payload:{data:[{id:'eli/dl/event/'+SITTING,activity_id:SITTING,activity_date:SITTING.slice(7),had_activity_type:'def/ep-activities/PLENARY_SITTING',had_participant_person:['person/42']}]}})});
  memberAttendance.query=service.query.bind(service);
  const {server}=await import('./index.mjs?attendance-http-test');
  t.after(async()=>{memberAttendance.query=original;if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));for(const [key,value] of [['ACTIVITY_INDEX_ENABLED',enabled.activity],['CORPUS_ENABLED',enabled.corpus]])if(value===undefined)delete process.env[key];else process.env[key]=value;});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const root='http://127.0.0.1:'+server.address().port,route=root+'/api/member-attendance/42?sittings='+SITTING+'&v='+API_VERSION;
  const result=await fetch(route);assert.equal(result.status,200);const body=await result.json();assert.equal(body.version,1);assert.equal(body.sittings[0].memberStatus,'listed-present');assert.equal(body.member.mandateStatus,'not-assessed');
  for(const key of ['cache-control','cdn-cache-control'])assert.equal(result.headers.get(key),'no-store');
  const etag=result.headers.get('etag');assert(etag);const conditional=await fetch(route,{headers:{'if-none-match':etag}});assert.equal(conditional.status,304);assert.equal(conditional.headers.get('cdn-cache-control'),'no-store');
  const head=await fetch(route,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await fetch(route,{method:'POST'})).status,405);
  assert.equal((await fetch(route,{headers:{Origin:'https://example.invalid'}})).status,403);
  const invalidVersion=await fetch(route.replace('v='+API_VERSION,'v='+(API_VERSION-1)));assert.equal(invalidVersion.status,409);assert.equal((await invalidVersion.json()).error.code,'api_version_mismatch');
  for(const query of ['', 'sittings=', 'sittings='+SITTING+'&lang=xx','sittings='+SITTING+'&sittings='+SITTING,'sittings='+SITTING+'&unknown=1'])assert.equal((await fetch(root+'/api/member-attendance/42?'+query)).status,400,query);
  assert.equal((await fetch(route.replace('/42?','/0?'))).status,400);
  const health=await (await fetch(root+'/api/')).json();assert(health.endpoints.includes('member-attendance'));
  await t.test('disconnecting one HTTP reader cancels its wait while another receives the shared load',loopback,async tt=>{
    let started,release,secondEntered,cancelled,sharedSignal,sourceReads=0,readers=0;
    const callerSignals=[],previousQuery=memberAttendance.query;
    const entered=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;}),
      secondStarted=new Promise(resolve=>{secondEntered=resolve;}),firstCancelled=new Promise(resolve=>{cancelled=resolve;});
    tt.after(()=>{release();memberAttendance.query=previousQuery;});
    const shared=new MemberAttendance({request:async endpoint=>{
      sourceReads++;sharedSignal=requestSignal();started();await gate;
      return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.parse('2026-10-23T12:00:00Z'),payload:{data:[{id:'eli/dl/event/'+SITTING,activity_id:SITTING,activity_date:SITTING.slice(7),had_activity_type:'def/ep-activities/PLENARY_SITTING',had_participant_person:['person/42']}]}};
    }});
    memberAttendance.query=async(...args)=>{
      const reader=++readers;
      callerSignals.push(requestSignal());
      if(reader===2)secondEntered();
      try{return await shared.query(...args);}catch(error){if(reader===1)cancelled(error);throw error;}
    };
    const abandoned=http.request(route);
    tt.after(()=>abandoned.destroy());
    const closed=new Promise(resolve=>{abandoned.on('error',()=>{});abandoned.once('close',resolve);});
    abandoned.end();await entered;
    const survivor=fetch(route);await secondStarted;
    abandoned.destroy();await closed;
    assert.equal((await firstCancelled).code,'request_cancelled');
    assert.equal(callerSignals[0].aborted,true);assert.equal(callerSignals[0].reason.code,'request_cancelled');assert.equal(callerSignals[1].aborted,false);
    assert.equal(sharedSignal.aborted,false);assert.equal(sourceReads,1);assert.equal(shared.pending.size,1);
    release();const response=await survivor;
    assert.equal(response.status,200);assert.equal((await response.json()).sittings[0].memberStatus,'listed-present');
    assert.equal(sourceReads,1);assert.equal(sharedSignal.aborted,false);assert.equal(shared.pending.size,0);
  });
  memberAttendance.query=async()=>({version:1,member:{id:'42',mandateStatus:'not-assessed'},sittings:[{sittingId:SITTING,status:'unavailable',memberStatus:null}]});
  const failed=await fetch(route);assert.equal(failed.status,200);assert.equal((await failed.json()).sittings[0].status,'unavailable');assert.equal(failed.headers.get('cdn-cache-control'),'no-store');
});
