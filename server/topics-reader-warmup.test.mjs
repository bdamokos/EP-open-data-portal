import {Worker} from 'node:worker_threads';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {projectRecordTopics} from './record-topics.mjs';
import {writeTopicProjection} from './topics-store.mjs';
import {readTopics,warmTopicOverviews} from './topics-reader.mjs';

test('startup warm-up fills the three canonical UI cache entries and unchanged publication stays idle',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topics-warmup-')),store=new ActivityStore(dir,{initializeIndexes:true});
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 store.acquire();store.set('active',1);writeTopicProjection(store,projectRecordTopics([{id:'E-10-2026-000001',kind:'question',date:'2026-10-07',titles:{en:'Greece'}}]));store.release();
 const sent=[],original=Worker.prototype.postMessage;
 let complete,target=3;let warmed=new Promise(resolve=>complete=resolve);
 t.mock.method(Worker.prototype,'postMessage',function(message,...args){
  if(message.filename===store.filename&&message.view==='overview'){
   sent.push(message);
   const receive=reply=>{if(reply.id!==message.id)return;this.off('message',receive);if(sent.length===target)complete();};
   this.on('message',receive);
  }
  return Reflect.apply(original,this,[message,...args]);
 });
 warmTopicOverviews(store);await warmed;
 assert.deepEqual(sent.map(m=>Object.fromEntries(m.params)),[{role:'place',askers:'all',lang:'en'},{role:'place',askers:'not-home',lang:'en'},{role:'topic',askers:'all',lang:'en'}]);
 warmTopicOverviews(store);await new Promise(setImmediate);assert.equal(sent.length,3);
 await readTopics(store.filename,'overview',new URLSearchParams('lang=en&role=place'));
 assert(sent.at(-1).cachedToken,'omitted all and parameter order share the warmed entry');
 await new Promise(setImmediate);assert.equal(sent.length,4,'unchanged real request does not start another pass');
 store.acquire();store.set('recordTopicCoverage',{generation:1,read:1});store.release();
 target=8;warmed=new Promise(resolve=>complete=resolve);
 await readTopics(store.filename,'overview',new URLSearchParams('lang=en&role=place'));await warmed;
 assert.equal(sent.length,8,'a changed token on a real request adds just three warm reads');
 warmTopicOverviews(store);await new Promise(setImmediate);assert.equal(sent.length,8);

});

test('an unavailable startup snapshot does not fail the server warm-up hook',()=>{
 assert.doesNotThrow(()=>warmTopicOverviews({filename:'unavailable',readSnapshot(){throw Error('Snapshot unavailable');}}));
});
