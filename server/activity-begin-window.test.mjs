import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';

function fixture(t,instant='2026-11-02T02:00:00Z') {
  const directory=mkdtempSync(path.join(os.tmpdir(),'begin-window-'));
  let now=Date.parse(instant),store=new ActivityStore(directory,{clock:()=>now});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  store.acquire();const cycle=store.beginCycle();store.publish(cycle.generation);store.release();
  return {
    get store(){return store;},
    at(value){now=Date.parse(value);},
    restart(){store.close();store=new ActivityStore(directory,{clock:()=>now});},
    async tick(options={}) {
      const worker=new ActivityWorker(store,{clock:()=>now,budget:0,recoveryMode:'backfill',...options,fetchRecord:()=>{throw new Error('No network expected');}});
      let begun;
      worker.generationExecutor=async operation=>{
        if(operation!=='begin')return;begun=store.beginCycle();worker.stopped=true;return begun;
      };
      await worker.run();return begun;
    },
    publish(){store.acquire();const cycle=store.get('working');store.publish(cycle.generation);store.release();},
    recovery(kind='gap') {
      store.acquire();const generation=store.get('active');
      store.db.exec('DELETE FROM refresh_gaps; DELETE FROM mutable_documents');
      if(kind==='gap'||kind==='route')store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,'/parliamentary-questions/E-10-2026-000001','document',JSON.stringify({endpoint:'/parliamentary-questions/E-10-2026-000001'}),100,'Unavailable',1,new Date(now).toISOString(),0,null);
      else if(kind==='mutable')store.db.prepare('INSERT INTO mutable_documents VALUES (?,?,?)').run(generation,'/parliamentary-questions/E-10-2026-000002',0);
      if(kind==='route')store.db.prepare("UPDATE refresh_gaps SET key=?,body=?,error=?,retry_at=? WHERE generation=?").run('/plenary-documents/A-10-2026-0001-AM-001-001',JSON.stringify({endpoint:'/plenary-documents/A-10-2026-0001-AM-001-001'}),'EP API returned 404 at /plenary-documents/A-10-2026-0001-AM-001-001.',Number.MAX_SAFE_INTEGER,generation);
      if(kind==='debate')store.putSource(generation,'/procedures/2026-0001','procedure',{id:'eli/dl/proc/2026-0001'},new Date(now).toISOString());
      store.release();
    },
  };
}

const HOUR=60*60_000;
test('recurring gaps, mutable checks, route verification and debates share the recovery interval',async t=>{
  const f=fixture(t,'2026-11-03T00:00:00Z');f.at('2026-11-03T06:00:00Z');f.recovery();
  assert.equal((await f.tick()).generation,2);f.publish();
  for(const [time,kind] of [['2026-11-03T07:00:00Z','gap'],['2026-11-03T08:00:00Z','mutable'],['2026-11-03T09:00:00Z','route'],['2026-11-03T10:00:00Z','debate']]) {
    f.at(time);f.recovery(kind);assert.equal(await f.tick(),undefined);
  }
  f.at('2026-11-03T11:59:59Z');assert.equal(await f.tick(),undefined);
  f.at('2026-11-03T12:00:00Z');assert.equal((await f.tick()).generation,3);
});
for(const hours of [1,6,24])test(`recovery begins at the exact configured ${hours}-hour interval`,async t=>{
  const start='2026-11-03T04:00:00Z',f=fixture(t,start);f.recovery();
  const worker=new ActivityWorker(f.store,{clock:()=>Date.parse(start)+hours*HOUR-1,recoveryBeginIntervalHours:hours});
  assert.equal(worker.recoveryBeginAllowed(),false);
  worker.clock=()=>Date.parse(start)+hours*HOUR;assert.equal(worker.recoveryBeginAllowed(),true);
  // A fresh publication is not a new begin and must not reset the interval.
  f.store.set('lastSuccess',new Date(worker.clock()).toISOString());assert.equal(worker.recoveryBeginAllowed(),true);
});
for(const [name,start,before,after] of [
  ['spring','2026-03-28T23:00:00Z','2026-03-29T04:59:59Z','2026-03-29T05:00:00Z'],
  ['autumn','2026-10-24T23:00:00Z','2026-10-25T04:59:59Z','2026-10-25T05:00:00Z'],
])test(`recovery interval measures elapsed time across ${name} DST`,t=>{
  const f=fixture(t,start),worker=new ActivityWorker(f.store,{clock:()=>Date.parse(before)});
  assert.equal(worker.recoveryBeginAllowed(),false);worker.clock=()=>Date.parse(after);assert.equal(worker.recoveryBeginAllowed(),true);
});
test('daily Brussels 03:00 bypasses a still-closed recovery interval',async t=>{
  const f=fixture(t,'2026-11-02T22:00:00Z');
  f.at('2026-11-03T01:59:59Z');assert.equal(await f.tick(),undefined);
  f.at('2026-11-03T02:00:00Z');assert.equal((await f.tick()).generation,2);
});
for(const [name,start,before,slot] of [
  ['spring','2026-03-28T22:00:00Z','2026-03-29T00:59:59Z','2026-03-29T01:00:00Z'],
  ['autumn','2026-10-24T21:00:00Z','2026-10-25T01:59:59Z','2026-10-25T02:00:00Z'],
])test(`daily refresh keeps Brussels 03:00 across ${name} DST`,async t=>{
  const f=fixture(t,start);f.at(before);assert.equal(await f.tick(),undefined);
  f.at(slot);assert.equal((await f.tick()).generation,2);
});
test('missing and zero active generation bootstrap immediately and record the begin time',async t=>{
  const f=fixture(t,'2026-11-03T00:00:00Z');
  for(const active of [null,0]) {
    f.store.set('refreshPolicyGeneration',null);f.store.set('active',active);f.store.set('working',null);
    assert(await f.tick());assert.equal(f.store.get('lastBeginAt'),'2026-11-03T00:00:00.000Z');
  }
});
test('midday restart measures the interval from begin rather than lastSuccess',async t=>{
  const f=fixture(t,'2026-11-03T00:00:00Z');f.at('2026-11-03T06:00:00Z');f.recovery();assert(await f.tick());
  // A discarded working generation never advanced lastSuccess.
  f.store.set('working',null);f.restart();f.at('2026-11-03T08:00:00Z');f.recovery();
  assert.equal(await f.tick(),undefined);assert.equal(f.store.get('sequence'),2);
});
test('legacy metadata uses last publication until the first recorded begin',async t=>{
  const f=fixture(t,'2026-11-03T06:00:00Z');f.store.set('lastBeginAt',null);
  f.at('2026-11-03T08:00:00Z');f.recovery();assert.equal(await f.tick(),undefined);
  f.at('2026-11-03T12:00:00Z');assert.equal((await f.tick()).generation,2);
});
test('working-generation continuation preserves its original begin time',async t=>{
  const f=fixture(t,'2026-11-03T00:00:00Z');f.at('2026-11-03T06:00:00Z');f.recovery();const cycle=await f.tick();
  f.at('2026-11-03T07:00:00Z');f.restart();assert.equal((await f.tick()).generation,cycle.generation);
  assert.equal(f.store.get('lastBeginAt'),'2026-11-03T06:00:00.000Z');assert.equal(f.store.get('sequence'),2);
});
test('recovery interval setting defaults to six hours and validates the supported range',t=>{
  const key='ACTIVITY_INDEX_RECOVERY_BEGIN_INTERVAL_HOURS',saved=process.env[key];t.after(()=>{if(saved===undefined)delete process.env[key];else process.env[key]=saved;});
  const setIntervalEnv=value=>{process.env[key]=value;};
  const f=fixture(t);setIntervalEnv('');assert.equal(new ActivityWorker(f.store).recoveryBeginInterval,6*HOUR);
  for(const hours of ['1','24']) {setIntervalEnv(hours);assert.equal(new ActivityWorker(f.store).recoveryBeginInterval,Number(hours)*HOUR);}
  for(const value of ['0','25','1.5','invalid']) {setIntervalEnv(value);assert.throws(()=>new ActivityWorker(f.store),/between 1 and 24/);}
});
for(const trigger of ['motion','startup-group-history','startup-adopted-discovery','startup-adopted-repair','rule-version'])test(`${trigger} retains immediate rebuild outside daily slot`,async t=>{
  const f=fixture(t,'2026-11-03T00:00:00Z');
  if(trigger==='motion')t.mock.method(f.store,'motionClassificationPending',()=>true);
  if(trigger.startsWith('startup-')) {
    f.store.set('groupHistoryRepairVersion',trigger==='startup-group-history'?null:1);
    f.store.set('adoptedTextDiscovery',trigger==='startup-adopted-discovery'?null:{version:1,throughYear:2026});
    if(trigger==='startup-adopted-repair') {
      f.store.acquire();f.store.putSource(f.store.get('active'),'/adopted-texts/TA-10-2026-0001','document',{identifier:'TA-10-2026-0001'},'2026-11-03T00:00:00Z');f.store.release();
    }
  }
  if(trigger==='rule-version') {
    f.recovery();f.store.db.prepare("UPDATE refresh_gaps SET kind='coverage',body=?,retry_at=?").run(JSON.stringify({sourceTaskKind:'document',endpoint:'/parliamentary-questions/E-10-2026-000001',ruleRejection:{version:0}}),Number.MAX_SAFE_INTEGER);
  }
  // Startup repair is enabled only on the service's first worker.
  if(trigger.startsWith('startup-')) {
    const worker=new ActivityWorker(f.store,{clock:()=>Date.parse('2026-11-03T00:00:00Z'),budget:0});worker.repairOnStartup=true;
    worker.generationExecutor=async operation=>{if(operation!=='begin')return;worker.stopped=true;return f.store.beginCycle();};
    await worker.run();
  } else assert(await f.tick());
  assert.equal(f.store.get('sequence'),2);assert.equal(f.store.get('lastBeginAt'),'2026-11-03T00:00:00.000Z');
});
