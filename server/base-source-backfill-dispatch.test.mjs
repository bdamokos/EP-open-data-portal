import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchBaseBackfill,ordinaryBaseBackfillTurn} from './base-source-backfill-dispatch.mjs';
function fixture(){const values=new Map();let calls=0;const worker={store:{get:k=>values.get(k),set:(k,v)=>values.set(k,v)},baseBackfill:{due:()=>true,step:async()=>{calls++;return true;}},requests:0,budget:1000,stopped:false,controller:new AbortController(),monotonic:()=>0,runDeadline:1000};return {worker,values,calls:()=>calls};}
test('backfill keeps one turn per six core dispatches across restarts',async()=>{
 const f=fixture();
 for(let i=0;i<60;i++){ordinaryBaseBackfillTurn(f.worker);await dispatchBaseBackfill({...f.worker},{busy:true});}
 assert.equal(f.calls(),10);
});
test('idle work drains while budget, deadline, cancellation, completion and full stops stay authoritative',async()=>{
 const f=fixture();for(let n=0;n<20;n++)assert.equal(await dispatchBaseBackfill(f.worker),true);assert.equal(f.calls(),20);
 for(const changed of [{requests:1000},{runDeadline:0},{stopped:true},{controller:{signal:AbortSignal.abort() }},{baseBackfill:{due:()=>false}}])assert.equal(await dispatchBaseBackfill({...f.worker,...changed}),false);
 assert.equal(f.calls(),20);
});
