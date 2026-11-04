import test from 'node:test';
import assert from 'node:assert/strict';
import {loopback} from './test-support/loopback.mjs';

process.env.API_READ_ORIGIN='https://kiosk.example';
const {server}=await import('./index.mjs?api-read-origin-test');

const routes=async t=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api`;
};

test('one configured origin may read the API and nothing else changes',loopback,async t=>{
  const base=await routes(t);
  const allowed=await fetch(base+'/healthz',{headers:{Origin:'https://kiosk.example'}});
  assert.equal(allowed.status,200);
  assert.equal(allowed.headers.get('access-control-allow-origin'),'https://kiosk.example');

  // A cache that keeps one copy per URL must not store a copy without the header.
  const plain=await fetch(base+'/healthz');
  assert.equal(plain.status,200);
  assert.equal(plain.headers.get('access-control-allow-origin'),'https://kiosk.example');

  assert.equal((await fetch(base+'/healthz',{headers:{Origin:'https://evil.example'}})).status,403);

  const preflight=await fetch(base+'/healthz',{method:'OPTIONS',headers:{Origin:'https://kiosk.example'}});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),'https://kiosk.example');
  assert.equal(preflight.headers.get('access-control-allow-methods'),'GET, HEAD, OPTIONS');

  const write=await fetch(base+'/client-errors',{method:'POST',headers:{Origin:'https://kiosk.example','Content-Type':'application/json'},body:'{}'});
  assert.equal(write.status,403);
  assert.equal(write.headers.get('access-control-allow-origin'),null);
});
