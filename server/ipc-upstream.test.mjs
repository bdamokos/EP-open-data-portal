import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {UpstreamQueue} from './upstream-queue.mjs';
import {OdpObservations} from './odp-observability.mjs';
import {serveUpstreamPort,UpstreamRpcClient} from './upstream-rpc.mjs';
import {ipcPort} from './ipc-port.mjs';
import {memoryLink} from './test-support/memory-link.mjs';

const tick=()=>delay(20);
function fixture(options={rateLimit:{maximum:5,windowMs:5000,foregroundReserve:2}}) {
  const queue=new UpstreamQueue(options),observations=new OdpObservations({onResponse:status=>queue.recordResponse(status),log:()=>{}});
  const services={queueFor:()=>queue,observations};
  const connect=({foreground,defaultPriority})=>{
    const [front,child]=memoryLink();
    const close=serveUpstreamPort(ipcPort(front,'upstream'),services,{foreground});
    const client=new UpstreamRpcClient(ipcPort(child,'upstream'),{defaultPriority});
    return {front,child,close,client};
  };
  return {queue,connect};
}

test('one rate budget serves the API process and the writer over separate links',async t=>{
  const {queue,connect}=fixture();
  const api=connect({foreground:true,defaultPriority:'interactive'}),writer=connect({foreground:false,defaultPriority:'background'});
  t.after(()=>{api.client.close();writer.client.close();});
  // Background work on either link may spend only the allowance outside the foreground reserve (5 - 2 = 3).
  for(let i=0;i<3;i++)writer.client.release(await writer.client.acquire());
  assert.equal(queue.starts.length,3);
  const blocked=writer.client.acquire();let granted=false;blocked.then(()=>{granted=true;},()=>{});
  await tick();assert.equal(granted,false,'background work cannot take the reserve');
  // Visitor requests from the API process still have the reserve, and the writer's request keeps waiting.
  api.client.release(await api.client.acquire());api.client.release(await api.client.acquire());
  assert.equal(queue.starts.length,5);
  const over=api.client.acquire();let overGranted=false;over.then(()=>{overGranted=true;},()=>{});
  await tick();assert.equal(overGranted,false,'the window is exhausted for everyone');
  assert.equal(queue.waiters.length,2);
});

test('the API link keeps request priority while the writer link is background only',async t=>{
  const {queue,connect}=fixture({maximum:5,backgroundMaximum:5});
  const api=connect({foreground:true,defaultPriority:'interactive'}),writer=connect({foreground:false,defaultPriority:'background'});
  t.after(()=>{api.client.close();writer.client.close();});
  const visitor=await api.client.acquire(),warm=await api.client.acquire('background');
  const forced=await writer.client.acquire('interactive');
  assert.deepEqual([...queue.admitted].map(waiter=>waiter.priority).sort(),['background','background','interactive']);
  for(const id of [visitor,warm])api.client.release(id);writer.client.release(forced);
});

test('an owner is reprioritized while queued and told to yield',async t=>{
  const {queue,connect}=fixture({maximum:1,backgroundMaximum:1});
  const api=connect({foreground:true,defaultPriority:'interactive'});
  t.after(()=>api.client.close());
  const blocker=await api.client.acquire('interactive');
  const owner={backgroundOwner:true};let yielded=0,release;
  const held=api.client.queue('odp').runHeld(slot=>{release=slot;return new Promise(()=>{});},{priority:'background',owner,backgroundOwner:true,yieldBackground:()=>{yielded++;}});
  held.catch(()=>{});
  await tick();assert.equal(queue.waiters.length,1);
  assert.equal(queue.waiters[0].priority,'background');
  api.client.reprioritize(owner,'interactive');await tick();
  assert.equal(queue.waiters[0].priority,'interactive');
  api.client.release(blocker);await tick();
  assert.equal(queue.admitted.size,1);
  [...queue.admitted][0].yieldBackground();await tick();
  assert.equal(yielded,1);
  release();
});

test('a closed link releases its grants and cancels its waiters',async t=>{
  const {queue,connect}=fixture({maximum:1});
  const api=connect({foreground:true,defaultPriority:'interactive'});
  await api.client.acquire();
  const waiting=api.client.acquire();waiting.catch(()=>{});
  await tick();assert.equal(queue.active,1);assert.equal(queue.waiters.length,1);
  // The API process exits: the front sees the link disconnect.
  api.front.disconnect();await tick();
  assert.equal(queue.active,0);assert.equal(queue.waiters.length,0);
  api.client.close();
});

test('ports ignore other channels and close with the link',async()=>{
  const [a,b]=memoryLink(),one=ipcPort(a,'one'),other=ipcPort(b,'two'),seen=[];
  other.on('message',message=>seen.push(message));
  one.postMessage({x:1});await tick();assert.deepEqual(seen,[]);
  let closed=0;one.once('close',()=>closed++);
  a.disconnect();await tick();assert.equal(closed,1);
  one.postMessage({x:2});
});

test('a busy queue answers the API process with the same 503 and retry hint as in-process',async t=>{
  const {HttpError}=await import('./http-utils.mjs');
  const {queue,connect}=fixture();
  const api=connect({foreground:true,defaultPriority:'interactive'});t.after(()=>api.client.close());
  queue.backoff(5);
  await assert.rejects(api.client.acquire(),error=>error instanceof HttpError&&error.status===503&&error.code==='upstream_busy'&&error.retryAfter>=1);
});

test('a reader joining a background fetch over the link stops at a pause or after the wait, as in-process',async t=>{
  const {queue,connect}=fixture({maximum:5,interactiveWaitMs:60});
  const api=connect({foreground:true,defaultPriority:'interactive'}),writer=connect({foreground:false,defaultPriority:'background'});
  t.after(()=>{api.client.close();writer.client.close();});
  const never=new Promise(()=>{});
  // The wait is bounded.
  await assert.rejects(api.client.queue('odp').joinBackground(never),error=>error.status===503&&error.code==='upstream_busy');
  // A pause that starts while the reader waits ends its wait.
  const joined=api.client.queue('odp').joinBackground(never);
  await tick();queue.interactiveWaitMs=10_000;queue.backoff(5);
  await assert.rejects(joined,error=>error.status===503);
  // During a pause a reader does not wait at all, and its own signal still ends the wait.
  await assert.rejects(api.client.queue('odp').joinBackground(never),error=>error.status===503);
  // A finished background fetch reaches the reader; the writer link keeps the promise as it is.
  const fresh=fixture({maximum:5}),other=fresh.connect({foreground:true,defaultPriority:'interactive'});t.after(()=>other.client.close());
  assert.equal(await other.client.queue('odp').joinBackground(Promise.resolve('body')),'body');
  const controller=new AbortController(),cancelled=other.client.queue('odp').joinBackground(never,{signal:controller.signal});
  controller.abort(new Error('gone'));await assert.rejects(cancelled,/gone/);
  assert.equal(writer.client.queue('odp').joinBackground(never),never);
});

test('a join for an unknown source is refused over the link instead of throwing in the front',async t=>{
  const queue=new UpstreamQueue({maximum:5}),observations=new OdpObservations({onResponse:()=>{},log:()=>{}});
  const services={queueFor:source=>{if(source!=='odp')throw new Error('Unknown upstream source.');return queue;},observations};
  const [front,child]=memoryLink();
  const close=serveUpstreamPort(ipcPort(front,'upstream'),services,{foreground:true});
  const client=new UpstreamRpcClient(ipcPort(child,'upstream'),{defaultPriority:'interactive'});
  t.after(()=>{client.close();close();});
  await assert.rejects(client.joinBackground('elsewhere',new Promise(()=>{})),/Unknown upstream source/);
});
