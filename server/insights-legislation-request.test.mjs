import {test} from 'node:test';
import assert from 'node:assert/strict';

// Exercise the real ODP transport with deferred fetches and no persistent cache.
process.env.ODP_CACHE_DIR='';
const {LegislationInsights}=await import('./insights-legislation.mjs');
const {sharedRequest,requestSignal}=await import('./request-budget.mjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('staggered legislation view owners share a source after the first view expires',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()+60_000});
  let finish,sourceSignal,secondOwner,calls=0;
  t.mock.method(globalThis,'fetch',async(url,{signal})=>{
    calls++;sourceSignal=signal;
    return new Promise((resolve,reject)=>{
      finish=()=>resolve(Response.json({data:[{id:'retained-record'}]}));
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    });
  });
  const service=new LegislationInsights(null);
  const first=assert.rejects(sharedRequest(()=>service.record('/legislation-two-view-owners'),1000),e=>e.code==='request_timeout');
  await turn();assert.equal(calls,1);
  t.mock.timers.tick(500);
  const second=sharedRequest(()=>{secondOwner=requestSignal();return service.record('/legislation-two-view-owners');},10_000);
  await turn();t.mock.timers.tick(500);await first;
  assert.equal(secondOwner.aborted,false);assert.equal(sourceSignal.aborted,false);
  assert.equal(service.failures.size,0,'a detached view must not become a cached source failure');
  finish();const result=await second;
  assert.equal(result.payload.data[0].id,'retained-record');assert.equal(calls,1);
  assert.equal(await service.record('/legislation-two-view-owners'),result);
  assert.equal(service.pending.size,0);assert.equal(service.failures.size,0);
});

test('an expired legislation record owner cannot overwrite a later successful record',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  let finish,calls=0;
  const record=id=>({payload:{data:[{id}]}});
  const service=new LegislationInsights(null,{request:()=>++calls===1?new Promise(resolve=>finish=resolve):Promise.resolve(record('replacement'))});
  const first=assert.rejects(service.record('/legislation-owner-expiry'),e=>e.code==='request_timeout');
  await turn();t.mock.timers.tick(50_000);await first;
  assert.equal(service.pending.size,0);
  t.mock.timers.tick(60_001);
  assert.equal((await service.record('/legislation-owner-expiry')).payload.data[0].id,'replacement');
  finish(record('expired'));await turn();
  assert.equal((await service.record('/legislation-owner-expiry')).payload.data[0].id,'replacement');
  assert.equal(service.failures.size,0);assert.equal(calls,2);
});
