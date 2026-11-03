import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverviewWarmup} from './topics-overview-warmup.mjs';
function fixture(){
 const calls=[],tasks=[];let busy=false,finish;
 const notice=createOverviewWarmup({busy:()=>busy,schedule:fn=>{tasks.push(fn);return {};},read:async(filename,params)=>{calls.push([filename,Object.fromEntries(params)]);await new Promise(resolve=>finish=resolve);}});
 const turn=async()=>{tasks.shift()?.();await Promise.resolve();};
 const settle=async()=>{finish?.();await Promise.resolve();await Promise.resolve();};
 return {calls,tasks,notice,turn,settle,setBusy:value=>busy=value};
}
const ready=token=>({token,ready:true});
test('one changed token warms exactly three UI combinations, sequentially, then stays idle',async()=>{
 const f=fixture();f.notice('index',ready('one'));f.notice('index',ready('one'));
 assert.equal(f.tasks.length,1);await f.turn();assert.equal(f.calls.length,1);assert.equal(f.tasks.length,0);
 f.notice('index',ready('one'));await f.settle();assert.equal(f.tasks.length,1);
 await f.turn();await f.settle();await f.turn();await f.settle();
 assert.deepEqual(f.calls.map(([,params])=>params),[{role:'place',askers:'all',lang:'en'},{role:'place',askers:'not-home',lang:'en'},{role:'topic',askers:'all',lang:'en'}]);
 for(let i=0;i<20;i++)f.notice('index',ready('one'));
 assert.equal(f.tasks.length,0);assert.equal(f.calls.length,3);
});
test('unreadable startup waits for a publication and busy readers skip without idle retries',async()=>{
 const f=fixture();f.notice('index',{token:'unready',ready:false});assert.equal(f.tasks.length,0);
 f.notice('index',ready('published'));f.setBusy(true);await f.turn();assert.equal(f.calls.length,0);
 f.setBusy(false);f.notice('index',ready('published'));assert.equal(f.tasks.length,0);
 f.notice('index',ready('next'));await f.turn();f.setBusy(true);await f.settle();await f.turn();
 assert.equal(f.calls.length,1);assert.equal(f.tasks.length,0);
 f.notice('other',ready('other'));assert.equal(f.tasks.length,0,'busy at notification also skips');
});
test('a token change replaces remaining work and a failed read stops its pass',async()=>{
 const calls=[],tasks=[];let finish,occupied=false;
 const notice=createOverviewWarmup({busy:()=>occupied,schedule:fn=>{tasks.push(fn);return {};},read:()=>{calls.push(1);return new Promise((resolve,reject)=>finish={resolve,reject});}});
 notice('index',ready('one'));tasks.shift()();occupied=true;notice('index',ready('two'));notice('index',ready('two'));occupied=false;
 assert.equal(calls.length,1);finish.resolve();await Promise.resolve();await Promise.resolve();
 tasks.shift()();assert.equal(calls.length,2);finish.reject(Error('unavailable'));await Promise.resolve();await Promise.resolve();
 assert.equal(tasks.length,0);notice('index',ready('two'));assert.equal(tasks.length,0);
});
