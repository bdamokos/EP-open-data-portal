import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('cold HTTP reference readers share a bounded source while cancellation leaves health and surviving readers intact',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'reference-http-'));
  await writeFile(path.join(directory,'index.html'),'<h1>Explorer</h1>');process.env.EXPLORER_DIST_DIR=directory;
  const {server}=await import('./index.mjs');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,budgets=[];
  t.after(async()=>{for(const c of budgets)c.abort(new Error('cleanup'));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});delete process.env.EXPLORER_DIST_DIR;});
  t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,20_000);const c=new AbortController();budgets.push(c);return c.signal;});
  let finish,calls=0;
  t.mock.method(globalThis,'fetch',async(url,{signal})=>{
    assert(String(url).startsWith('https://publications.europa.eu/webapi/rdf/sparql'));calls++;
    return new Promise((resolve,reject)=>{finish=()=>resolve(Response.json({results:{bindings:[]}}));signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  });
  const read=route=>{
    let request;const response=new Promise((resolve,reject)=>{request=http.get(base+route,r=>{const chunks=[];r.on('data',chunk=>chunks.push(chunk));r.on('end',()=>resolve({status:r.statusCode,body:Buffer.concat(chunks).toString()}));});request.on('error',reject);});
    return {response,close:()=>request.destroy()};
  };
  const until=async condition=>{for(let i=0;i<1000&&!condition();i++)await new Promise(resolve=>setImmediate(resolve));assert(condition());};
  const route='/api/poc/references?lang=en&keys=com%3A2024%2F225';
  const a=read(route),closed=a.response.catch(()=>{});await until(()=>calls===1);
  const b=read(route);await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await read('/api/healthz').response).status,200);assert.equal((await read('/').response).status,200);
  a.close();await closed;assert.equal(budgets[0].signal.aborted,false,'the source cache retains its own budget');
  finish();const survivor=await b.response;assert.equal(survivor.status,200);assert.equal(calls,1);assert.equal(JSON.parse(survivor.body).references[0].status,'not-found');
  const c=read('/api/poc/references?lang=en&keys=celex%3A32021R2116');await until(()=>budgets.length===2);
  budgets[1].abort(new Error('source deadline ended'));
  const expired=await c.response;assert.equal(expired.status,200);assert.equal(JSON.parse(expired.body).references[0].status,'unavailable');
  assert.equal((await read('/api/healthz').response).status,200);
});
