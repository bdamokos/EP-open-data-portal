import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ApiSupervisor} from './api-supervisor.mjs';
import {ipcPort} from './ipc-port.mjs';
import {memoryLink} from './test-support/memory-link.mjs';

// A fake API process: the supervisor's end of an IPC link plus exit and kill.
function fakeApi() {
  const spawned=[];
  const spawn=()=>{
    const [parent,remote]=memoryLink(),child=parent;
    child.pid=1000+spawned.length;
    child.kill=signal=>{queueMicrotask(()=>child.emit('exit',null,signal));return true;};
    const control=ipcPort(remote,'control');
    const api={child,control,ready:(port=4000)=>control.postMessage({type:'listening',port}),
      exit:(code=1)=>child.emit('exit',code,null),shutdowns:0};
    control.on('message',message=>{if(message.type==='shutdown'){api.shutdowns++;queueMicrotask(()=>child.emit('exit',0,null));}});
    spawned.push(api);return child;
  };
  return {spawn,spawned};
}
const supervisor=(options={})=>{
  const api=fakeApi(),instance=new ApiSupervisor({spawn:api.spawn,log:()=>{},...options});
  return {api,instance};
};

test('requests that arrive while the API process starts wait and then all proceed',async t=>{
  const {api,instance}=supervisor();t.after(()=>instance.close());
  const requests=[instance.acquire(),instance.acquire(),instance.acquire()];
  await delay(10);
  assert.equal(api.spawned.length,1,'one process serves every waiting request');
  assert.equal(instance.snapshot().waiting,3);
  api.spawned[0].ready(4321);
  const leases=await Promise.all(requests);
  assert.deepEqual(leases.map(lease=>lease.port),[4321,4321,4321]);
  assert.equal(instance.snapshot().active,3);
  leases.forEach(lease=>lease.release());
  assert.equal(instance.snapshot().active,0);
});

test('the wait is bounded by count and by the request budget',async t=>{
  const {api,instance}=supervisor({maxWaiters:2});t.after(()=>instance.close());
  const first=instance.acquire({budgetMs:60}),second=instance.acquire({budgetMs:60});
  await assert.rejects(instance.acquire({budgetMs:60}),error=>error.status===503&&error.code==='api_busy'&&error.retryAfter>=1);
  await assert.rejects(first,error=>error.status===503&&error.code==='api_starting'&&error.retryAfter>=1);
  await assert.rejects(second,/starting/);
  assert.equal(instance.snapshot().waiting,0);
  api.spawned[0].ready();
});

test('a client that leaves while waiting frees its place',async t=>{
  const {instance}=supervisor();t.after(()=>instance.close());
  const controller=new AbortController(),waiting=instance.acquire({signal:controller.signal});
  controller.abort(new Error('gone'));
  await assert.rejects(waiting,/gone/);
  assert.equal(instance.snapshot().waiting,0);
});

test('the API process exits after the idle time and health-style touches are not requests',async t=>{
  const {api,instance}=supervisor({idleMs:120});t.after(()=>instance.close());
  const pending=instance.acquire();api.spawned[0].ready();
  (await pending).release();
  assert.equal(instance.snapshot().state,'ready');
  // Nothing calls acquire or wake: the front answers probes and static files itself.
  await delay(250);
  assert.equal(instance.snapshot().state,'idle');
  assert.equal(api.spawned[0].shutdowns,1);
  assert.equal(instance.snapshot().idleExits,1);
  assert.equal(instance.snapshot().crashes,0);
});

test('requests keep the API process alive, including a long one in flight',async t=>{
  const {api,instance}=supervisor({idleMs:150});t.after(()=>instance.close());
  const pending=instance.acquire();api.spawned[0].ready();
  const long=await pending;
  for(let i=0;i<3;i++){await delay(80);(await instance.acquire()).release();}
  assert.equal(instance.snapshot().state,'ready');
  await delay(300);
  assert.equal(instance.snapshot().state,'ready','an open request holds the process');
  long.release();
  await delay(350);
  assert.equal(instance.snapshot().state,'idle');
});

test('a page load wakes the process without a request and counts as activity',async t=>{
  const {api,instance}=supervisor({idleMs:200});t.after(()=>instance.close());
  instance.wake();
  assert.equal(api.spawned.length,1);
  api.spawned[0].ready();
  await delay(10);
  instance.wake();
  assert.equal(api.spawned.length,1);
  assert.equal((await instance.acquire()).port,4000);
});

test('a request during shutdown waits for the exit and starts a new process',async t=>{
  const {api,instance}=supervisor({idleMs:60});t.after(()=>instance.close());
  const first=instance.acquire();api.spawned[0].ready();(await first).release();
  await delay(20);
  // Hold the exit so the supervisor is in the stopping state.
  api.spawned[0].control.removeAllListeners('message');
  await delay(120);
  assert.equal(instance.snapshot().state,'stopping');
  const next=instance.acquire({budgetMs:2000});
  api.spawned[0].exit(0);
  await delay(10);
  assert.equal(api.spawned.length,2);
  api.spawned[1].ready(5555);
  assert.equal((await next).port,5555);
});

test('a crash answers waiters with a retry hint and the next request starts a new process after the backoff',async t=>{
  const {api,instance}=supervisor({backoffBaseMs:60,backoffMaxMs:200});t.after(()=>instance.close());
  const waiting=instance.acquire();
  api.spawned[0].exit(1);
  await assert.rejects(waiting,error=>error.status===503&&error.code==='api_unavailable'&&error.retryAfter>=1);
  assert.equal(instance.snapshot().crashes,1);
  await assert.rejects(instance.acquire(),error=>error.status===503&&error.retryAfter>=1,'inside the backoff no process starts');
  assert.equal(api.spawned.length,1);
  await delay(80);
  const again=instance.acquire();
  assert.equal(api.spawned.length,2);
  api.spawned[1].ready(6000);
  assert.equal((await again).port,6000);
  // A ready process that dies mid-service is replaced by the next request.
  api.spawned[1].exit(137);
  assert.equal(instance.snapshot().state,'idle');
  await assert.rejects(instance.acquire(),error=>error.status===503);
});

test('backoff grows with repeated failures and resets after a stable run',async t=>{
  const {api,instance}=supervisor({backoffBaseMs:20,backoffMaxMs:1000,stableMs:30});t.after(()=>instance.close());
  for(let i=0;i<3;i++){
    await delay(i===0?0:i*40+25);
    const request=instance.acquire().catch(()=>{});
    api.spawned.at(-1).exit(1);await request;
  }
  assert.equal(instance.snapshot().failures,3);
  await delay(100);
  const up=instance.acquire();api.spawned.at(-1).ready();(await up).release();
  await delay(50);api.spawned.at(-1).exit(1);
  assert.equal(instance.snapshot().failures,1);
});

test('publications reach a running process only, and close stops it',async t=>{
  const {api,instance}=supervisor();
  instance.publish({source:'activity'});
  const pending=instance.acquire();api.spawned[0].ready();(await pending).release();
  const received=[];api.spawned[0].control.on('message',message=>received.push(message));
  instance.publish({source:'activity',revision:{active:3}});
  await delay(10);
  assert.deepEqual(received,[{type:'publication',message:{source:'activity',revision:{active:3}}}]);
  await instance.close();
  assert.equal(api.spawned[0].shutdowns,1);
  await assert.rejects(instance.acquire(),error=>error.status===503);
});

test('a wake while the process is stopping starts it again once it has gone',async t=>{
  const {api,instance}=supervisor();t.after(()=>instance.close());
  const lease=instance.acquire();api.spawned[0].ready();(await lease).release();
  // The process was told to stop but has not gone yet.
  instance.state='stopping';
  instance.wake();
  assert.equal(instance.ready,false);
  api.spawned[0].exit(0);
  await delay(10);
  assert.equal(api.spawned.length,2,'the wake restarted the process after the exit');
});

test('a starting process receives the latest publication of each source once it listens',async t=>{
  const {api,instance}=supervisor();t.after(()=>instance.close());
  const pending=instance.acquire();
  const received=[];api.spawned[0].control.on('message',message=>received.push(message));
  instance.publish({source:'activity',revision:{active:1}});
  instance.publish({source:'corpus',revision:{speechReadRevision:4}});
  instance.publish({source:'activity',revision:{active:2}});
  api.spawned[0].ready();(await pending).release();
  await delay(10);
  assert.deepEqual(received.map(message=>message.message),[{source:'activity',revision:{active:2}},{source:'corpus',revision:{speechReadRevision:4}}]);
});

test('closing while the process starts is not counted as a crash',async()=>{
  const {api,instance}=supervisor();
  instance.wake();
  assert.equal(api.spawned.length,1);
  await instance.close();
  assert.equal(instance.snapshot().crashes,0);
  assert.equal(instance.snapshot().failures,0);
});

test('a process that fails to start backs off and the next request starts another',async t=>{
  let attempts=0;
  const {api,instance}=supervisor({backoffBaseMs:20,spawn:()=>{
    attempts++;
    if(attempts>1)return api.spawn();
    const [child]=memoryLink();child.kill=()=>false;
    queueMicrotask(()=>child.emit('error',Object.assign(new Error('spawn ENOMEM'),{code:'ENOMEM'})));
    return child;
  }});
  t.after(()=>instance.close());
  await assert.rejects(instance.acquire({budgetMs:300}),error=>error.status===503&&error.code==='api_unavailable');
  assert.equal(instance.state,'idle');assert.equal(instance.snapshot().crashes,1);
  await delay(30);
  const next=instance.acquire();await delay(5);
  api.spawned[0].ready();(await next).release();
  assert.equal(attempts,2);
});

test('closing while a wedged process starts kills it after the grace period',async()=>{
  const signals=[];
  const {instance}=supervisor({stopGraceMs:30,spawn:()=>{
    const [child]=memoryLink();child.pid=4242;
    child.kill=signal=>{signals.push(signal);if(signal==='SIGKILL')queueMicrotask(()=>child.emit('exit',null,signal));return true;};
    return child;
  }});
  instance.wake();
  await instance.close();
  assert.deepEqual(signals,['SIGTERM','SIGKILL']);
  assert.equal(instance.snapshot().crashes,0);
});
