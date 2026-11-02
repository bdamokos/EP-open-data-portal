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
