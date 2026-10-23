import {loopback} from './test-support/loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {plenaryLive} from './plenary-live.mjs';
import {server} from './index.mjs';
import {API_VERSION} from './api-version.mjs';

test('live HTTP reads are no-store and reject caller-selected source queries',loopback,async t=>{
  let calls=0;
  t.mock.method(plenaryLive,'snapshot',async()=>{calls++;return {status:'unavailable',current:null,broadcast:null,agenda:{state:'unavailable',items:[]},sources:[]};});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:'+server.address().port+'/api/plenary-live';
  for(const method of ['GET','HEAD']){const response=await fetch(base+'?v='+API_VERSION,{method});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('cdn-cache-control'),'no-store');if(method==='HEAD')assert.equal(await response.text(),'');else assert.equal((await response.json()).status,'unavailable');}
  assert.equal(calls,2);
  for(const query of ['?url=https://example.com','?date=2026-10-19','?lang=en&lang=hu'])assert.equal((await fetch(base+query)).status,400);
  assert.equal((await fetch(base,{method:'POST'})).status,405);assert.equal(calls,2);
});
