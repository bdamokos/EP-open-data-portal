import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker,MessageChannel} from 'node:worker_threads';
import {once} from 'node:events';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {startSourceWriters} from './source-writers.mjs';
import {retainBaseObservation} from './base-source-store.mjs';
import http from 'node:http';
import {loopback} from './test-support/loopback.mjs';
import {retentionClient} from './base-source-rpc.mjs';
const observation={url:'https://example.test/fixture',fetchedAt:'2026-11-01T12:00:00Z'};
for(const viaHttp of [false,true])test(`Cellar captures (HTTP=${viaHttp}) publish in the existing source worker, and stop declines safely`,viaHttp?loopback:{},async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'retention-worker-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let worker;
 const stop=startSourceWriters({enabled:true,workerUrl:new URL('./test-support/base-retention-writer.mjs',import.meta.url),
  createWorker:(url,options)=>worker=new Worker(url,{...options,env:{...process.env,ACTIVITY_INDEX_ENABLED:'false',CORPUS_ENABLED:'false'}})});
 t.after(stop);
 const notice=async type=>{for(;;){const [value]=await once(worker,'message');if(value.type===type)return value;}};
 await notice('ready');
 const published=notice('retention-test');
 const {CellarDocuments}=await import('./cellar-documents.mjs');
 const documents=new CellarDocuments({directory:path.join(directory,'commission-proposals-v1'),sources:{schedule:fn=>fn()},fetchSource:async()=>new Response('fixture',{headers:{'content-type':'application/rdf+xml'}})});
 const read=async()=>{assert.equal((await documents.request('https://publications.europa.eu/resource/celex/52026PC0001',{accept:'application/rdf+xml'})).buffer.toString(),'fixture');};
 if(viaHttp){
  const server=http.createServer(async(_request,response)=>{try{await read();response.end('captured');}catch(error){response.statusCode=500;response.end(error.message);}});
  t.after(()=>new Promise(resolve=>server.close(resolve)));server.listen(0,'127.0.0.1');await once(server,'listening');
  const response=await fetch(`http://127.0.0.1:${server.address().port}`);assert.equal(await response.text(),'captured');
 }else await read();
 const event=await published;assert.equal(event.isMainThread,false);assert.equal(event.threadId,worker.threadId);assert.equal(event.value,true);
 const files=await readdir(path.join(directory,'base-sources-v1'));assert(files.some(n=>n.endsWith('.blob')));
 await stop();assert.equal(await retainBaseObservation(observation,Buffer.from('late'),{directory}),false);
});
test('disabled writers decline retention without creating a store',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'retention-disabled-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const stop=startSourceWriters({enabled:false});
 assert.equal(await retainBaseObservation(observation,Buffer.from('no'),{directory}),false);await stop();assert.deepEqual(await readdir(directory),[]);
});
test('capture transport bounds pending bytes and resolves on close without upstream RPC',async()=>{
 const {port1,port2}=new MessageChannel(),client=retentionClient(port1);
 const pending=client.send({observation,body:Buffer.alloc(12*1024*1024)});
 assert.equal(await client.send({observation,body:Buffer.alloc(5*1024*1024)}),false);
 client.close();port2.close();assert.equal(await pending,false);
});
test('publication uses asynchronous filesystem operations without fsync',async()=>{
 for(const file of ['base-source-store.mjs','cache-publication.mjs']){
  const code=await readFile(new URL(file,import.meta.url),'utf8');assert(!/fsync|fdatasync|Sync\(/.test(code));assert(code.includes("'node:fs/promises'"));
 }
});
