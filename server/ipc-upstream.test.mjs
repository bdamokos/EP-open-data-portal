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
