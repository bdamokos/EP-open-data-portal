import test from 'node:test';
import assert from 'node:assert/strict';
import {createDataClient,readJson} from './client.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function harness(options) {
  const requests=[];
  const client=createDataClient((route,signal,options)=>{const read=deferred();requests.push({route,signal,...options,...read});return read.promise;},options);
  return {client,requests};
}
const consumer=(client,route,options={})=>{const controller=new AbortController();const promise=client.get(route,{...options,signal:controller.signal});return {controller,promise};};

test('joined consumers release independently and the final release aborts an uncooperative loader',async()=>{
  const {client,requests}=harness();
  const a=consumer(client,'profile/43'),b=consumer(client,'profile/43');
  const cancelledA=assert.rejects(a.promise,{name:'AbortError'}),cancelledB=assert.rejects(b.promise,{name:'AbortError'});
  await flush();assert.equal(requests.length,1);
  a.controller.abort();await cancelledA;assert.equal(requests[0].signal.aborted,false);
  b.controller.abort();await cancelledB;await flush();assert.equal(requests[0].signal.aborted,true);
  const fresh=consumer(client,'profile/43');await flush();assert.equal(requests.length,2);
  requests[1].resolve({id:43,revision:'fresh'});await fresh.promise;
  requests[0].resolve({id:43,revision:'obsolete'});await flush();
  assert.deepEqual(client.peek('profile/43'),{id:43,revision:'fresh'});
});

test('StrictMode-style immediate release and rejoin keeps the shared transport alive',async()=>{
  const {client,requests}=harness();const a=consumer(client,'profile/43');
  const cancelled=assert.rejects(a.promise,{name:'AbortError'});
  a.controller.abort();const b=consumer(client,'profile/43');
  await cancelled;await flush();assert.equal(requests.length,1);assert.equal(requests[0].signal.aborted,false);
  requests[0].resolve({id:43});assert.deepEqual(await b.promise,{id:43});
});

test('an aborted subscriber cannot start a fetch and a deliberate signal-less caller retains shared work',async()=>{
  const {client,requests}=harness();const signal=AbortSignal.abort();
  await assert.rejects(client.get('never',{signal}),{name:'AbortError'});assert.equal(requests.length,0);
  const mounted=consumer(client,'retained'),retained=client.get('retained');
  const cancelled=assert.rejects(mounted.promise,{name:'AbortError'});await flush();mounted.controller.abort();await cancelled;await flush();
  assert.equal(requests[0].signal.aborted,false);requests[0].resolve('cached');assert.equal(await retained,'cached');assert.equal(client.peek('retained'),'cached');
});

test('an abandoned refresh preserves saved data even if its late loader rejects with an access error',async()=>{
  const {client,requests}=harness();const saved=client.get('speech/X');await flush();requests[0].resolve({id:'X',text:'saved'});await saved;
  const refresh=consumer(client,'speech/X',{force:true}),cancelled=assert.rejects(refresh.promise,{name:'AbortError'});
  await flush();refresh.controller.abort();await cancelled;await flush();assert.equal(requests[1].signal.aborted,true);
  requests[1].reject(Object.assign(new Error('expired'),{status:401}));await flush();assert.deepEqual(client.peek('speech/X'),{id:'X',text:'saved'});
});

test('invalidation transfers live subscriptions and their releases to each replacement',async()=>{
  const {client,requests}=harness();const a=consumer(client,'document/Q'),b=consumer(client,'document/Q');
  const cancelledA=assert.rejects(a.promise,{name:'AbortError'}),cancelledB=assert.rejects(b.promise,{name:'AbortError'});
  await flush();client.expireMatching(()=>true);await flush();client.expireMatching(()=>true);await flush();
  assert.equal(requests.length,3);assert(requests[0].signal.aborted);assert(requests[1].signal.aborted);
  a.controller.abort();await cancelledA;assert.equal(requests[2].signal.aborted,false);
  b.controller.abort();await cancelledB;await flush();assert(requests[2].signal.aborted);
  requests.forEach(request=>request.resolve('obsolete'));await flush();assert.equal(requests.length,3);assert.equal(client.peek('document/Q'),null);
});

test('invalidation still forwards replacement data to surviving joined subscribers',async()=>{
  const {client,requests}=harness();const a=consumer(client,'document/Q'),b=consumer(client,'document/Q');
  const cancelled=assert.rejects(a.promise,{name:'AbortError'});await flush();client.expireMatching(()=>true);a.controller.abort();await cancelled;await flush();
  assert.equal(requests.length,2);assert.equal(requests[1].signal.aborted,false);
  requests[1].resolve({answers:['new']});assert.deepEqual(await b.promise,{answers:['new']});
});

test('a retained prefetch survives foreground release, demotes priority and keeps useful cache data',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {client,requests}=harness({prefetchDelay:1});const stop=client.prefetch(['speech/X','never']);
  t.mock.timers.tick(1);await flush();assert.equal(requests[0].getPriority(),'low');
  const mounted=consumer(client,'speech/X');const cancelled=assert.rejects(mounted.promise,{name:'AbortError'});
  assert.equal(requests[0].getPriority(),'auto');stop();mounted.controller.abort();await cancelled;await flush();
  assert.equal(requests[0].signal.aborted,false);assert.equal(requests[0].getPriority(),'low');
  requests[0].resolve({id:'X'});await flush();t.mock.timers.tick(10);await flush();
  assert.equal(requests.length,1);assert.deepEqual(await client.get('speech/X'),{id:'X'});
});

test('last-consumer release cancels busy backoff and foreground capacity is freed for prefetch',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});
  const calls=[],signals=[];
  const client=createDataClient((route,signal,options)=>{signals.push(signal);return readJson(route,{signal,...options,fetchImpl:async()=>{
    calls.push(route);return route==='old'?Response.json({error:{code:'upstream_busy',retryAt:Date.now()+1000}},{status:503}):Response.json({id:'next'});
  }});},{prefetchDelay:1});
  const old=consumer(client,'old'),cancelled=assert.rejects(old.promise,{name:'AbortError'});const stop=client.prefetch(['next']);
  await flush();t.mock.timers.tick(1);await flush();assert.deepEqual(calls,['old']);
  old.controller.abort();await cancelled;await flush();assert(signals[0].aborted);
  t.mock.timers.tick(1);await flush();assert.deepEqual(calls,['old','next']);
  t.mock.timers.tick(2000);await flush();assert.deepEqual(calls,['old','next']);assert.deepEqual(client.peek('next'),{id:'next'});stop();
});
