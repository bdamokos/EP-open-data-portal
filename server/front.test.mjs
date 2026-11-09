import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loopback} from './test-support/loopback.mjs';
import {moduleClosure} from './test-support/module-closure.mjs';

const root=mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'front-test-'));
mkdirSync(path.join(root,'dist','assets'),{recursive:true});
writeFileSync(path.join(root,'dist','index.html'),'<!doctype html><title>Explorer</title>');
writeFileSync(path.join(root,'dist','assets','app.js'),'export {};');
process.env.EXPLORER_DIST_DIR=path.join(root,'dist');
process.env.ERROR_LOG_DIR=path.join(root,'diagnostics');
// The config module reads the environment once, so load the server modules after setting it.
const {createFront,stopFrontServices}=await import('./front.mjs');
const {HttpError}=await import('./http-utils.mjs');
test.after(()=>rmSync(root,{recursive:true,force:true}));

// Counts what reaches the API process; the front must answer everything else itself.
function fakeSupervisor(port) {
  const calls={acquire:0,wake:0,release:0};
  return {calls,
    acquire:async()=>{calls.acquire++;return {port,release:()=>{calls.release++;}};},
    wake:()=>{calls.wake++;}};
}
async function start(t,supervisor) {
  const {server,agent}=createFront({supervisor});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{agent.destroy();server.closeAllConnections();server.close();});
  return server.address().port;
}
const get=(port,path,headers={},method='GET')=>new Promise((resolve,reject)=>{
  const request=http.request({host:'127.0.0.1',port,path,method,headers,agent:false},response=>{
    const chunks=[];response.on('data',chunk=>chunks.push(chunk));
    response.on('end',()=>resolve({response,body:Buffer.concat(chunks).toString()}));
  });
  request.on('error',reject);request.end();
});

test('health checks and static files never reach the API process',loopback,async t=>{
  const supervisor=fakeSupervisor(1);const port=await start(t,supervisor);
  for(const route of ['/healthz','/api/healthz']) {
    const {response,body}=await get(port,route);
    assert.equal(response.statusCode,200,route);
    assert.equal(JSON.parse(body).service,'parliament-explorer');
    assert.match(response.headers['x-request-id'],/^[a-f0-9-]{36}$/);
  }
  assert.equal((await get(port,'/healthz',{},'HEAD')).response.statusCode,200);
  assert.equal((await get(port,'/assets/app.js')).response.statusCode,200);
  assert.equal((await get(port,'/missing')).response.statusCode,404);
  assert.equal((await get(port,'/')).response.statusCode,200);
  assert.deepEqual(supervisor.calls,{acquire:0,wake:0,release:0});
});

test('a browser page load wakes the API process; other requests for the root do not',loopback,async t=>{
  const supervisor=fakeSupervisor(1);const port=await start(t,supervisor);
  assert.equal((await get(port,'/',{Accept:'*/*'})).response.statusCode,200);
  assert.equal((await get(port,'/',{},'HEAD')).response.statusCode,200);
  assert.equal(supervisor.calls.wake,0,'a tool without a browser Accept header does not warm the API');
  const page=await get(port,'/?mep=1',{Accept:'text/html,application/xhtml+xml'});
  assert.equal(page.response.statusCode,200);assert.match(page.body,/Explorer/);
  assert.equal(supervisor.calls.wake,1);assert.equal(supervisor.calls.acquire,0,'the page itself needs no API');
});

test('a health probe with an origin or a query takes the API checks instead',loopback,async t=>{
  const seen=[];
  const api=http.createServer((request,response)=>{seen.push(request.url);response.end('api');});
  api.listen(0,'127.0.0.1');await once(api,'listening');t.after(()=>{api.closeAllConnections();api.close();});
  const supervisor=fakeSupervisor(api.address().port);const port=await start(t,supervisor);
  const withQuery=await get(port,'/api/healthz?v=abc');
  assert.equal(withQuery.body,'api');assert.equal(supervisor.calls.acquire,1);assert.equal(supervisor.calls.release,1);
  assert.deepEqual(seen,['/api/healthz?v=abc']);
  assert.equal((await get(port,'/api/healthz',{Origin:'http://elsewhere.test'})).body,'api');
  // As in single mode, /healthz stands for the API's health check.
  assert.equal((await get(port,'/healthz?v=abc')).body,'api');
  assert.equal(seen.at(-1),'/api/healthz?v=abc');
});

test('API routes answer 503 with Retry-After while the process is unavailable',loopback,async t=>{
  const supervisor={acquire:async()=>{throw Object.assign(new HttpError(503,'api_starting','The service is starting.'),{retryAfter:2});},wake(){}};
  const port=await start(t,supervisor);
  const {response,body}=await get(port,'/api/directory');
  assert.equal(response.statusCode,503);assert.equal(response.headers['retry-after'],'2');
  assert.match(response.headers['x-request-id'],/^[a-f0-9-]{36}$/);
  assert.equal(JSON.parse(body).error.code,'api_starting');
});

test('invalid request targets are rejected by the front',loopback,async t=>{
  const supervisor=fakeSupervisor(1);const port=await start(t,supervisor);
  const socket=(await import('node:net')).connect(port,'127.0.0.1');
  socket.write('GET //evil.test/api/x HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
  const [data]=await once(socket,'data');
  assert.match(String(data),/^HTTP\/1.1 400/);
  assert.equal(supervisor.calls.acquire,0);
});

test('the front does not load the API module graph',loopback,() => {
  const entry=fileURLToPath(new URL('./front.mjs',import.meta.url));
  const {files,packages}=moduleClosure(entry);
  const names=files.map(file=>path.relative(path.dirname(entry),file).split(path.sep).join('/'));
  // Everything the HTTP API and its readers load comes through these.
  for(const forbidden of ['index.mjs','odp.mjs','activity-index-worker.mjs','corpus-worker.mjs','activities.mjs','insights.mjs','mmc.mjs','sitting-snapshot-store.mjs','activity-index-store.mjs','corpus-store.mjs','plenary-live.mjs'])
    assert.ok(!names.includes(forbidden),`front.mjs must not load ${forbidden}`);
  for(const forbidden of ['sharp','pdfjs-dist','pdf-lib','fast-xml-parser','@nodable/entities'])
    assert.ok(!packages.includes(forbidden),`front.mjs must not load ${forbidden}`);
  // The full server closure is over 300 modules; the front is a small fraction of it.
  assert.ok(names.length<40,`front.mjs loads ${names.length} modules`);
  const api=moduleClosure(fileURLToPath(new URL('./index.mjs',import.meta.url))).files.length;
  assert.ok(api>200,'the comparison needs the API closure to stay large');
  assert.ok(names.length*5<api);
});

test('at shutdown the writer starts draining before the API process has stopped',async()=>{
  const steps=[];
  await stopFrontServices({
    supervisor:{close:()=>{steps.push('api-stop');return new Promise(resolve=>{setTimeout(()=>{steps.push('api-gone');resolve();},20);});}},
    agent:{destroy:()=>{}},snapshots:{close:async()=>{}},
    stopWriters:()=>{steps.push('writer-stop');return Promise.resolve();},
    errorLog:{flush:async()=>{steps.push('log');}},
  });
  assert.deepEqual(steps,['writer-stop','api-stop','api-gone','log']);
});
