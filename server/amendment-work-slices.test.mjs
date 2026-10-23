import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import os from 'node:os';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {ActivityStore} from './activity-index-store.mjs';
import {enqueueAmendment} from './amendments-store.mjs';
import {runAmendmentWorkSlice} from './amendment-work-slices.mjs';

function fixture(t,{body={stage:'rebuild-targets',afterTarget:null,scope:{kind:'sitting'},revision:'accepted'},working=true}={}) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-work-slice-'));
  let now=Date.now();const clock=()=>now,store=new ActivityStore(directory,{clock});assert(store.acquire());
  const {generation}=store.beginCycle();
  if(!working)store.publish(generation);
  const task={generation,key:'slice:targets',kind:'amendment-rebuild-targets',body,priority:110,attempts:0,amendmentJob:true};
  enqueueAmendment(store,generation,task.key,task.kind,body,task.priority);
  const worker={store,clock,controller:new AbortController(),stopped:false,diskLimit:Infinity};
  t.after(()=>{store.release();store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,task,worker,directory,advance:milliseconds=>{now+=milliseconds;},saved:()=>JSON.parse(store.db.prepare('SELECT body FROM amendment_jobs WHERE generation=? AND key=?').get(generation,task.key).body)};
}
const lexical=keys=>body=>keys.find(key=>body.afterTarget==null||key>body.afterTarget) ?? null;
const afterTarget=item=>({afterTarget:item});

test('lexical slices yield between actions and preserve arbitrary body fields with target-first cursor saves',async t=>{
  const {store,task,worker,saved}=fixture(t),events=[];
  const progress=store.taskProgress.bind(store);store.taskProgress=(current,body)=>{events.push('cursor:'+body.afterTarget);progress(current,body);};
  const keys=['A','B','C'],action=async item=>{events.push('target:'+item);setImmediate(()=>events.push('yield:'+item));};
  assert.equal(await runAmendmentWorkSlice(worker,task,{select:lexical(keys),action,advance:afterTarget,maxActions:2}),false);
  assert.deepEqual(events,['target:A','cursor:A','yield:A','target:B','cursor:B','yield:B']);
  assert.deepEqual(saved(),{stage:'rebuild-targets',afterTarget:'B',scope:{kind:'sitting'},revision:'accepted'});
  assert.equal(await runAmendmentWorkSlice(worker,task,{select:lexical(keys),action,advance:afterTarget,maxActions:2}),true);
  assert.equal(saved().afterTarget,'C');assert.equal(store.db.prepare('SELECT done,attempts,retry_at FROM amendment_jobs WHERE generation=? AND key=?').get(task.generation,task.key).done,0);
});

test('numeric profile offsets resume without refetching or skipping newly appended targets',async t=>{
  const {task,worker,saved}=fixture(t,{body:{stage:'rebuild-targets',targets:['Z','B'],rebuildOffset:0,source:{id:'7'},revision:'v2'}}),visited=[];
  const select=body=>body.rebuildOffset<body.targets.length?body.targets[body.rebuildOffset]:null,advance=(_,body)=>({rebuildOffset:body.rebuildOffset+1});
  const action=item=>{visited.push(item);};
  assert.equal(await runAmendmentWorkSlice(worker,task,{select,action,advance,maxActions:1}),false);
  worker.store.taskProgress(task,{...saved(),targets:[...saved().targets,'A']});
  assert.equal(await runAmendmentWorkSlice(worker,task,{select,action,advance,maxActions:3}),true);
  assert.deepEqual(visited,['Z','B','A']);assert.equal(saved().rebuildOffset,3);assert.deepEqual(saved().source,{id:'7'});
});

test('a callback stage transition and a newer revision survive incomplete and completed actions',async t=>{
  const {store,task,worker,saved}=fixture(t);
  assert.equal(await runAmendmentWorkSlice(worker,task,{select:()=> 'A',action:()=>{store.taskProgress(task,{...saved(),stage:'waiting',requestedRevision:'v3'});return false;},advance:()=>{throw Error('Incomplete work must not advance');}}),false);
  assert.deepEqual(saved(),{stage:'waiting',afterTarget:null,scope:{kind:'sitting'},revision:'accepted',requestedRevision:'v3'});
  assert.equal(await runAmendmentWorkSlice(worker,task,{select:lexical(['A']),action:()=>store.taskProgress(task,{...saved(),stage:'rebuild-targets',requestedRevision:'v4'}),advance:afterTarget}),true);
  assert.equal(saved().requestedRevision,'v4');assert.equal(saved().afterTarget,'A');
});

test('stop, controller abort and the original run deadline leave unstarted work queued without retry',async t=>{
  for(const mode of ['stop','abort','deadline']) {
    const {store,task,worker,saved}=fixture(t);let actions=0;
    worker.runDeadline=performance.now()+10_000;
    if(mode==='stop')worker.stopped=true;
    if(mode==='abort')worker.controller.abort();
    if(mode==='deadline')worker.runDeadline=performance.now()-1;
    assert.equal(await runAmendmentWorkSlice(worker,task,{select:()=> 'A',action:()=>{actions++;},advance:afterTarget}),false);
    assert.equal(actions,0);assert.equal(saved().afterTarget,null);
    const row=store.db.prepare('SELECT done,attempts,retry_at,error FROM amendment_jobs WHERE generation=? AND key=?').get(task.generation,task.key);
    assert.deepEqual({...row},{done:0,attempts:0,retry_at:0,error:null});
  }
});

test('a deadline reached during a committed action preserves its cursor and stops before another target',async t=>{
  const {task,worker,saved}=fixture(t);let now=100;worker.monotonic=()=>now;worker.runDeadline=200;const visited=[];
  assert.equal(await runAmendmentWorkSlice(worker,task,{select:lexical(['A','B']),action:item=>{visited.push(item);now=worker.runDeadline;},advance:afterTarget}),false);
  assert.deepEqual(visited,['A']);assert.equal(saved().afterTarget,'A');
});

test('lease loss before or during a target propagates and never advances an unowned cursor',async t=>{
  for(const during of [false,true,'incomplete']) {
    const {store,task,worker,directory,advance,saved}=fixture(t),contender=new ActivityStore(directory,{clock:worker.clock});
    try {
      const steal=()=>{advance(91_000);assert(contender.acquire());};if(!during)steal();
      await assert.rejects(runAmendmentWorkSlice(worker,task,{select:()=> 'A',action:()=>{if(during)steal();if(during==='incomplete')return false;},advance:afterTarget}),/lease/);
      assert.equal(saved().afterTarget,null);
    } finally {contender.release();contender.close();}
    assert.equal(store.get('working').generation,task.generation);
  }
});

test('disk limits pause a genuine core cycle and leave active-only metadata unmanufactured',async t=>{
  for(const working of [true,false]) {
    const {store,task,worker,saved}=fixture(t,{working});worker.diskLimit=1;let actions=0;
    assert.equal(await runAmendmentWorkSlice(worker,task,{select:()=> 'A',action:()=>{actions++;},advance:afterTarget}),false);
    assert.equal(actions,0);assert.equal(saved().afterTarget,null);
    assert.equal(store.get('working')?.phase ?? null,working?'paused':null);
  }
});

test('the invocation has a hard action cap and yields no transaction across turns',async t=>{
  const {store,task,worker,saved}=fixture(t),keys=Array.from({length:11},(_,index)=>String(index).padStart(2,'0')),visited=[];
  assert.equal(await runAmendmentWorkSlice(worker,task,{select:lexical(keys),action:item=>visited.push(item),advance:afterTarget,maxActions:100}),false);
  assert.equal(visited.length,10);assert.equal(saved().afterTarget,'09');
  store.db.exec('BEGIN IMMEDIATE');
  try {await assert.rejects(runAmendmentWorkSlice(worker,task,{select:()=>null,action:()=>{},advance:afterTarget}),/transaction/);}finally{store.db.exec('ROLLBACK');}
  await yieldTurn();
});
