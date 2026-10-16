import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequestBudget,requestSignal,runWithRequestSignal,waitForRequest} from './request-budget.mjs';

test('one absolute request budget follows async work while detached shared work keeps its owner',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  const reader=createRequestBudget(100),owner=new AbortController();let finish;
  const shared=new Promise(resolve=>finish=resolve);
  const expired=runWithRequestSignal(reader.signal,async()=>{
    await Promise.resolve();assert.equal(requestSignal(),reader.signal);
    assert.equal(runWithRequestSignal(undefined,requestSignal),undefined);
    return assert.rejects(waitForRequest(shared),e=>e.status===503&&e.code==='request_timeout');
  });
  const survivor=runWithRequestSignal(reader.signal,()=>waitForRequest(shared,owner.signal));
  await Promise.resolve();t.mock.timers.tick(100);await expired;
  assert.equal(owner.signal.aborted,false);finish('last good');assert.equal(await survivor,'last good');reader.dispose();
});

const read=(base,route)=>new Promise((resolve,reject)=>{
  const request=http.get(base+route,response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks).toString()}));});
  request.on('error',reject);
});

test('HTTP deadline releases the reader, aborts its unshared cold source and keeps health responsive',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'request-budget-'));
  await writeFile(path.join(directory,'index.html'),'<h1>Explorer</h1>');process.env.EXPLORER_DIST_DIR=directory;
  const {server}=await import('./index.mjs');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});delete process.env.EXPLORER_DIST_DIR;});
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
  let started,sourceSignal,calls=0,aborted;
  const admitted=new Promise(resolve=>started=resolve);
  t.mock.method(globalThis,'fetch',async(url,{signal})=>{
    calls++;sourceSignal=signal;started();
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted?.();reject(signal.reason);},{once:true}));
  });
  const slow=read(base,'/api/poc/profile/99988');await admitted;
  assert.equal((await read(base,'/api/healthz')).status,200);assert.equal((await read(base,'/')).status,200);
  t.mock.timers.tick(30000);
  const result=await slow;assert.equal(result.status,503);assert.equal(JSON.parse(result.body).error.code,'request_timeout');assert(sourceSignal.aborted);assert.equal(calls,1);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await read(base,'/healthz')).status,200);
  const nextAdmitted=new Promise(resolve=>started=resolve),sourceAborted=new Promise(resolve=>aborted=resolve);
  let client;
  const disconnected=new Promise(resolve=>{client=http.get(base+'/api/poc/profile/99989');client.on('error',resolve);});
  await nextAdmitted;client.destroy();await disconnected;await sourceAborted;assert(sourceSignal.aborted);
  assert.equal((await read(base,'/api/healthz')).status,200);
});

test('a cold source body shares the admission deadline and is cancelled when its reader expires',async t=>{
  const {odp}=await import('./odp.mjs');
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()+120000});
  const reader=createRequestBudget(500);let bodyFailed=false,started;
  const headersReady=new Promise(resolve=>started=resolve);
  t.mock.method(globalThis,'fetch',async(url,{signal})=>{
    const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"data":['));signal.addEventListener('abort',()=>{bodyFailed=true;controller.error(signal.reason);},{once:true});}});
    started();return new Response(body,{headers:{'content-type':'application/json'}});
  });
  const failed=runWithRequestSignal(reader.signal,()=>assert.rejects(odp('/body-reader-source'),e=>e.code==='request_timeout'));
  await headersReady;t.mock.timers.tick(500);await failed;await new Promise(resolve=>setImmediate(resolve));
  assert(bodyFailed);reader.dispose();
});

test('ODP shared cold jobs survive one detached reader and cancel when the last reader leaves',async t=>{
  const {odp}=await import('./odp.mjs');
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()+180000});
  let calls=0,finish,sourceSignal;
  t.mock.method(globalThis,'fetch',async(url,{signal})=>{
    calls++;sourceSignal=signal;
    return new Promise((resolve,reject)=>{finish=()=>resolve(Response.json({data:[{id:'source'}]}));signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  });
  const one=new AbortController(),two=new AbortController(),reason=new Error('reader closed');
  const first=assert.rejects(odp('/shared-reader-source',{}, {signal:one.signal}),e=>e===reason);
  const second=odp('/shared-reader-source',{}, {signal:two.signal});
  await new Promise(resolve=>setImmediate(resolve));one.abort(reason);await first;
  assert.equal(sourceSignal.aborted,false);finish();const saved=await second;
  assert.equal(await odp('/shared-reader-source'),saved);assert.equal(calls,1);
  const last=new AbortController(),abandoned=assert.rejects(odp('/abandoned-reader-source',{}, {signal:last.signal}),e=>e===reason);
  t.mock.timers.tick(2100);await new Promise(resolve=>setImmediate(resolve));last.abort(reason);await abandoned;
  assert(sourceSignal.aborted);await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(2100);const replacement=odp('/abandoned-reader-source');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,3,'cancelled jobs must not poison or evict a later replacement');finish();await replacement;
});
