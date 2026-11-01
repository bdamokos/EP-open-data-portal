import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';

test('member profiles are parsed once per generation and refreshed by profile writes only',t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'member-profiles-'));
  const store=new ActivityStore(dir);store.acquire();
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const fetched='2026-10-20T09:00:00.000Z',profile=id=>({id,givenName:'Alex',familyName:'Member '+id});
  store.putSource(1,'amendment:member:101','amendment-member',profile('101'),fetched);
  const first=store.memberProfiles(1);
  assert.deepEqual(first.map(source=>source.work.id),['101']);
  assert.equal(store.memberProfiles(1),first,'repeated rebuilds reuse one parse');
  assert(Object.isFrozen(first[0].work),'shared profiles cannot be mutated by a rebuild');
  store.putSource(1,'amendment:roster:2026-10-20','amendment-roster',{members:[]},fetched);
  assert.equal(store.memberProfiles(1),first,'unrelated source writes keep the parse');
  assert.deepEqual(store.memberProfiles(2),[],'generations are cached separately');
  store.putSource(1,'amendment:member:102','amendment-member',profile('102'),fetched);
  assert.deepEqual(store.memberProfiles(1).map(source=>source.work.id).sort(),['101','102'],'a profile write invalidates the parse');
});

test('another writer between leases and generation lifecycle writes invalidate cached profiles',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'member-profiles-'));
  const a=new ActivityStore(dir,{initializeIndexes:true}),b=new ActivityStore(dir,{initializeIndexes:true});
  t.after(()=>{a.close();b.close();rmSync(dir,{recursive:true,force:true});});
  const fetched='2026-10-20T09:00:00.000Z',key='amendment:member:101';
  assert(a.acquire());
  a.putSource(1,key,'amendment-member',{id:'101',familyName:'Old'},fetched);
  assert.equal(a.memberProfiles(1)[0].work.familyName,'Old');
  a.release();
  assert(b.acquire());b.putSource(1,key,'amendment-member',{id:'101',familyName:'New'},fetched);b.release();
  assert(a.acquire());
  assert.equal(a.memberProfiles(1)[0].work.familyName,'New','a reacquired lease cannot reuse a parse from before another writer');
  assert.equal(a.memberProfiles(1).length,1);
  a.pruneGenerations(2);
  assert.deepEqual(a.memberProfiles(1),a.sources(1,'amendment-member'),'pruning invalidates cached generations');
  const {activityGenerationTask}=await import('./activity-generation-task.mjs');
  const {EventEmitter}=await import('node:events');
  a.putSource(3,key,'amendment-member',{id:'101',familyName:'Before'},fetched);
  assert.equal(a.memberProfiles(3)[0].work.familyName,'Before');
  const createWorker=()=>{const thread=new EventEmitter();thread.terminate=async()=>0;queueMicrotask(()=>{
    // A separate connection changes the generation, as the off-thread helper does.
    b.owner=a.owner;b.db.prepare('UPDATE sources SET body=? WHERE generation=3 AND key=?').run(JSON.stringify({id:'101',familyName:'After'}),key);
    thread.emit('message',{type:'complete',value:null});thread.emit('exit',0);});return thread;};
  await activityGenerationTask(a,'publish',{generation:3,createWorker});
  assert.equal(a.memberProfiles(3)[0].work.familyName,'After','off-thread generation work invalidates the parent cache');
});

test('cached sitting and alias sources follow source writes, leases and the size bound',t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'source-cache-'));
  const a=new ActivityStore(dir,{initializeIndexes:true}),b=new ActivityStore(dir,{initializeIndexes:true});
  t.after(()=>{a.close();b.close();rmSync(dir,{recursive:true,force:true});});
  const fetched='2026-10-20T09:00:00.000Z',key='amendment:aliases:MTG-PL-2026-10-20';
  assert(a.acquire());
  a.putSource(1,key,'amendment-aliases',{aliases:[],decisions:['old']},fetched);
  const first=a.cachedSource(1,key);
  assert.equal(a.cachedSource(1,key),first,'repeated target rebuilds reuse one parse');
  assert(Object.isFrozen(first.work));
  assert.equal(a.cachedSource(1,'amendment:aliases:missing'),null);
  a.putSource(1,key,'amendment-aliases',{aliases:[],decisions:['new']},fetched);
  assert.deepEqual(a.cachedSource(1,key).work.decisions,['new'],'a source write replaces the cached parse');
  a.release();assert(b.acquire());b.putSource(1,key,'amendment-aliases',{aliases:[],decisions:['other writer']},fetched);b.release();assert(a.acquire());
  assert.deepEqual(a.cachedSource(1,key).work.decisions,['other writer'],'a new lease cannot reuse an older parse');
  const large='x'.repeat(9*1024*1024);
  a.putSource(1,'amendment:aliases:A','amendment-aliases',{aliases:[],pad:large},fetched);
  a.putSource(1,'amendment:aliases:B','amendment-aliases',{aliases:[],pad:large},fetched);
  a.cachedSource(1,'amendment:aliases:A');a.cachedSource(1,'amendment:aliases:B');
  assert(a.sourceCacheChars<=16*1024*1024,'retained body length stays within the bound');
});
