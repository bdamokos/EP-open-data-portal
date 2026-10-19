import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.ODP_CACHE_DIR='';
const {odp,odpProfile}=await import('./odp.mjs');
const {UpstreamQueue}=await import('./upstream-queue.mjs');
const {LegislationInsights}=await import('./insights-legislation.mjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));

for(const [index,mode] of ['admission','cooldown'].entries())test(`ODP local ${mode} does not suppress stale insight refresh after recovery`,async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
  const queue=new UpstreamQueue({interval:0,maximum:1}),acquire=queue.acquire.bind(queue);
  t.mock.method(UpstreamQueue.prototype,'runHeld',queue.runHeld.bind(queue));
  const id=987650+index,endpoint='/meps/'+id;let calls=0,phase='seed',finish,reached;
  const started=new Promise(resolve=>reached=resolve);
  const response=label=>Response.json({data:[{identifier:String(id),givenName:label,familyName:'Member'}]});
  t.mock.method(globalThis,'fetch',async()=>{
    calls++;
    if(phase==='recovery')return new Promise(resolve=>{finish=()=>resolve(response('refreshed'));reached();});
    return phase==='failure'?new Response(null,{status:500}):response('saved');
  });
  await odpProfile(id);t.mock.timers.tick(7*86400_000+1);
  let release;if(mode==='admission')release=await acquire();else queue.backoff(30);
  const rejected=assert.rejects(odpProfile(id),error=>error.code==='upstream_busy');await turn();
  if(release){assert.equal(queue.waiters.length,1);t.mock.timers.tick(10_000);}
  await rejected;assert.equal(calls,1);
  if(release)release();else t.mock.timers.tick(30_000);
  phase='recovery';const service=new LegislationInsights(null,{clock:()=>Date.now()});
  const stale=await service.record(endpoint);
  assert.equal(stale.payload.data[0].givenName,'saved');assert.equal(stale.stale,true);
  assert.equal(stale.refreshError,null);assert.equal(stale.refreshInProgress,true);
  await started;const fresh=odp(endpoint);finish();
  assert.equal((await fresh).payload.data[0].givenName,'refreshed');assert.equal(calls,2);
  t.mock.timers.tick(7*86400_000+1);phase='failure';
  await assert.rejects(odpProfile(id),error=>error.code==='odp_unavailable');
  const failed=await odp(endpoint,{}, {staleWhileRevalidate:true});
  assert.equal(failed.payload.data[0].givenName,'refreshed');assert.equal(failed.refreshInProgress,false);
  assert.match(failed.refreshError,/500/);assert.equal(calls,3);
  t.mock.timers.tick(3_600_001);phase='seed';
  assert.equal((await odp(endpoint,{}, {staleWhileRevalidate:true})).refreshInProgress,true);
  await odp(endpoint);assert.equal(calls,4,'genuine failure caching still expires');
});
