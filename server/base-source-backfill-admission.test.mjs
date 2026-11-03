import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {serveUpstreamPort,UpstreamRpcClient} from './upstream-rpc.mjs';
import {odp,setUpstreamBridge,upstreamPortServices,boundedUpstream} from './odp.mjs';
import {CellarDocuments} from './cellar-documents.mjs';
import {runBaseBackfill} from './base-source-backfill-context.mjs';
function bridge(t){
 const {port1,port2}=new MessageChannel(),service=upstreamPortServices(),admissions=[];
 const stop=serveUpstreamPort(port1,{...service,queueFor:(source,options)=>{if(options)admissions.push({source,...options});setUpstreamBridge(null);try{return service.queueFor(source,options);}finally{setUpstreamBridge(client);}}}),client=new UpstreamRpcClient(port2);
 setUpstreamBridge(client);
 t.after(()=>{setUpstreamBridge(null);client.close();stop();for(const source of ['odp','https://publications.europa.eu']){const q=service.queueFor(source);clearTimeout(q.timer);q.cooldownUntil=0;q.nextStart=0;}});
 return {port:port1,service,client,admissions};
}
test('ODP metadata and native-file admissions activate adaptive mode on the HTTP-owned queue via RPC',async t=>{
 const f=bridge(t);let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({data:[]});});
 const result=await runBaseBackfill({},()=>odp('/plenary-documents/A-10-2026-0202',{}, {priority:'background'}));
 assert.deepEqual(result.payload,{data:[]});assert.equal(calls,1);
 // Read parent-side queues directly after temporarily detaching the proxy.
 setUpstreamBridge(null);const q=f.service.queueFor('odp');setUpstreamBridge(f.client);
 assert.equal(q.adaptive,true);assert(q.interval>0);assert(f.admissions.some(a=>a.source==='odp'&&a.backgroundRank===1));
 await runBaseBackfill({},()=>boundedUpstream(()=>{}, {source:'odp',priority:'background'}));
 assert.equal(f.admissions.filter(a=>a.source==='odp'&&a.backgroundRank===1).length,2);
});
test('Cellar 429 slows shared HTTP-owned admission and preserves Retry-After through RPC',async t=>{
 const f=bridge(t);let calls=0;
 const pause=new Promise(resolve=>f.port.on('message',m=>{if(m.type==='backoff'&&m.source==='https://publications.europa.eu')resolve();}));
 const documents=new CellarDocuments({directory:null,sources:{schedule:fn=>fn(),queues:new Map()},fetchSource:async()=>{calls++;return new Response(null,{status:429,headers:{'retry-after':'120'}});}});
 await assert.rejects(runBaseBackfill({},()=>documents.request('https://publications.europa.eu/resource/celex/52025PC0990',{accept:'application/rdf+xml;notice=tree'})),e=>e.code==='cellar_limited');
 await pause;
 setUpstreamBridge(null);const q=f.service.queueFor('https://publications.europa.eu');setUpstreamBridge(f.client);
 assert.equal(calls,1);assert(q.minimumInterval>0);assert(q.interval>q.minimumInterval);assert(q.cooldownUntil>=Date.now()+119_000);
 assert.equal(q.quotaSnapshot().backgroundRemaining,399);
});

test('adaptive backfill intervals delay background starts while visitors retain immediate shared quota access',async t=>{
 const {UpstreamQueue}=await import('./upstream-queue.mjs');
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const q=new UpstreamQueue({interval:750,adaptive:true,backgroundPacing:true,rateLimit:{maximum:500,windowMs:300000,foregroundReserve:100}});
 const release=await q.acquire('background');release();
 let backgroundStarted=false;
 const background=q.acquire('background').then(release=>{backgroundStarted=true;return release;});
 const visitorRelease=await q.acquire('interactive');
 assert.equal(backgroundStarted,false);assert.equal(q.nextStart,1750);
 visitorRelease();t.mock.timers.tick(749);await Promise.resolve();assert.equal(backgroundStarted,false);
 t.mock.timers.tick(1);const finishBackground=await background;finishBackground();
 q.recordResponse(429);assert.equal(q.interval,1125);
 let lowStarted=false;
 const low=q.run(()=>{lowStarted=true;},{priority:'interactive',backgroundRank:1});
 const secondVisitor=await q.acquire('interactive');assert.equal(lowStarted,false);secondVisitor();
 t.mock.timers.tick(1125);await low;assert.equal(lowStarted,true);
 q.backoff(120);
 await assert.rejects(q.acquire('interactive'),error=>error.code==='upstream_busy'&&error.retryAfter>=120);
 assert(q.quotaSnapshot().startsInWindow<=400);
});

test('a visitor joining queued background work can promote its start without borrowing another background slot',async t=>{
 const {UpstreamQueue}=await import('./upstream-queue.mjs');
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const q=new UpstreamQueue({interval:750,adaptive:true,backgroundPacing:true});
 const release=await q.acquire('background');release();
 const owner={},pending=q.runHeld(release=>{release();return 'visited';},{priority:'background',backgroundRank:1,owner});
 assert.equal(q.waiters.length,1);q.reprioritize(owner,'interactive');
 assert.equal(await pending,'visited');assert.equal(q.nextStart,1750);assert.equal(q.background,0);
});
