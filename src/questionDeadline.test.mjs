import test from 'node:test';
import assert from 'node:assert/strict';
import {createDataClient,dataTimeoutFor,readJson} from './client.mjs';

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const clock=t=>{t.mock.timers.enable({apis:['setTimeout','Date'],now:10_000});return async ms=>{t.mock.timers.tick(ms);await flush();};};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const result={questions:[{id:'E-10-2026-003031',titleLanguage:'en'}],counts:{totalQuestions:null,analyzedQuestions:5000},coverage:{indexComplete:false,truncated:true}};
const ready=data=>({ok:true,status:200,headers:new Headers(),json:async()=>data});
const questionsClient=fetchImpl=>createDataClient((route,signal)=>readJson('/api/'+route,{signal,timeoutMs:dataTimeoutFor(route),fetchImpl}),{timeoutFor:dataTimeoutFor});

for(const route of ['insights/questions?lang=en&days=term&limit=25&offset=0','insights/questions?lang=en&days=365&limit=25&offset=0&end=2026-10-18']) {
  test(`Questions allows preparation and body reading beyond eight seconds: ${route}`,async t=>{
    const tick=clock(t),headers=deferred(),body=deferred();let signal,calls=0,settled=false;
    assert.equal(dataTimeoutFor(route),35_000);
    const client=questionsClient(async(url,options)=>{calls++;signal=options.signal;assert.match(url,/\/api\/insights\/questions\?/);return headers.promise;});
    const pending=client.get(route);pending.then(()=>{settled=true;});await flush();
    await tick(8_001);assert.equal(signal.aborted,false);assert.equal(settled,false);assert.equal(calls,1);
    await tick(20_999);headers.resolve({...ready(result),json:()=>body.promise});await flush();
    await tick(2_000);assert.equal(signal.aborted,false);assert.equal(settled,false);
    body.resolve(result);assert.deepEqual(await pending,result);assert.equal(client.peek(route),result);
    assert.equal(result.counts.totalQuestions,null);assert.deepEqual(result.coverage,{indexComplete:false,truncated:true});
  });
}

test('Questions keeps one deadline across a server timeout, busy backoff and a stalled retry body, then permits explicit recovery',async t=>{
  const tick=clock(t),route='insights/questions?lang=en&days=term',timeout=deferred();let calls=0,retrySignal;
  const client=questionsClient(async(url,options)=>{
    calls++;
    if(calls===2)return timeout.promise;
    if(calls===3){retrySignal=options.signal;return {...ready(result),json:()=>new Promise(()=>{})};}
    return ready(result);
  });
  const saved=await client.get(route),refresh=client.get(route,{force:true});
  const rejected=assert.rejects(refresh,/took too long/);await flush();
  assert.equal(client.peek(route),saved);
  await tick(30_000);
  timeout.resolve({ok:false,status:503,headers:new Headers({'Retry-After':'1'}),json:async()=>({error:{code:'request_timeout',message:'This data request took too long. Please try again.',retryAfter:1}})});
  await flush();await tick(999);assert.equal(calls,2);
  await tick(1);assert.equal(calls,3);assert.equal(retrySignal.aborted,false);
  await tick(3_999);assert.equal(retrySignal.aborted,false);
  await tick(1);await rejected;assert.equal(retrySignal.aborted,true);
  assert.equal(client.peek(route),saved);assert.deepEqual(saved.coverage,{indexComplete:false,truncated:true});assert.equal(saved.counts.totalQuestions,null);
  await tick(60_000);assert.equal(calls,3,'exhausting the deadline never schedules an unbounded retry');
  assert.deepEqual(await client.get(route,{force:true}),result);assert.equal(calls,4);
});

test('direct Questions reads bound a stalled response body at the route deadline',async t=>{
  const tick=clock(t),route='insights/questions?days=365';let signal;
  const pending=readJson('/api/'+route,{timeoutMs:dataTimeoutFor(route),fetchImpl:async(url,options)=>{
    signal=options.signal;
    return {...ready(result),json:()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))};
  }});
  const rejected=assert.rejects(pending,/took too long/);await flush();
  await tick(34_999);assert.equal(signal.aborted,false);
  await tick(1);await rejected;assert.equal(signal.aborted,true);
});
