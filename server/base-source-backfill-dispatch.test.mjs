import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchBaseBackfill} from './base-source-backfill-dispatch.mjs';
import {dispatchCollector,ordinaryCollectorTurn} from './collector-dispatch.mjs';
function fixture(){const values=new Map();let calls=0;const worker={store:{get:k=>values.get(k),set:(k,v)=>values.set(k,v)},baseBackfill:{due:()=>true,step:async()=>{calls++;return true;}},requests:0,budget:1000,stopped:false,controller:new AbortController(),monotonic:()=>0,runDeadline:1000};return {worker,values,calls:()=>calls};}
test('backfill, topic and story share one optional dispatch in six across restarts',async()=>{
 const f=fixture(),seen=[];let core=0;
 const options={busy:true,topic:async()=>{seen.push('topic');return true;},story:async()=>{seen.push('story');return true;}};
 for(let i=0;i<600;i++){
  const worker={...f.worker}; // Only durable store state survives a restart.
  if(!await dispatchCollector(worker,options)){core++;ordinaryCollectorTurn(worker);}
  assert(core*6>=5*(i+1),'core must keep five sixths of all dispatches, including the first busy iteration');
 }
 assert.equal(core,500);assert.equal(seen.length+f.calls(),100);
 assert.equal(seen.filter(x=>x==='topic').length,34);assert.equal(seen.filter(x=>x==='story').length,33);assert.equal(f.calls(),33);
});
test('a completed backfill leaves the optional share to topic and story',async()=>{
 const f=fixture();f.worker.baseBackfill.due=()=>false;let core=0,optional=0;
 for(let i=0;i<60;i++){
  if(!await dispatchCollector(f.worker,{busy:true,topic:async()=>{optional++;return true;},story:async()=>{optional++;return true;}})){core++;ordinaryCollectorTurn(f.worker);}
 }
 assert.equal(core,50);assert.equal(optional,10);assert.equal(f.calls(),0);
});
test('idle work drains while budget, deadline, cancellation, completion and full stops stay authoritative',async()=>{
 const f=fixture();for(let n=0;n<20;n++)assert.equal(await dispatchBaseBackfill(f.worker),true);assert.equal(f.calls(),20);
 for(const changed of [{requests:1000},{runDeadline:0},{stopped:true},{controller:{signal:AbortSignal.abort() }},{baseBackfill:{due:()=>false}}])assert.equal(await dispatchBaseBackfill({...f.worker,...changed}),false);
 assert.equal(f.calls(),20);
});
