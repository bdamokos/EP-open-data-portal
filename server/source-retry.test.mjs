import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {CorpusStore} from './corpus-store.mjs';

for(const Store of [ActivityStore,CorpusStore])test(Store.name+' defers missing sources until due and keeps recovery possible',t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'source-retry-'));let now=Date.parse('2026-10-22T10:00:00Z');
  const store=new Store(directory,{clock:()=>now});assert(store.acquire());
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const activity=Store===ActivityStore,generation=activity?store.beginCycle().generation:null;
  if(activity)store.enqueue(generation,'missing','document',{endpoint:'/missing'},90);
  else store.enqueue('missing','speech',{id:'missing'},90);
  const next=()=>activity?store.nextTask(generation):store.nextTask();
  for(let i=0;i<12;i++) {
    const task=next();assert.equal(task.attempts,i);
    store.failTask(task,Object.assign(new Error('Missing source'),{status:i%2?410:404}));
    const saved=store.db.prepare('SELECT * FROM tasks WHERE key=?').get('missing');
    const delay=Math.min(7*86400000,3600000*2**i);
    assert.equal(saved.retry_at,now+delay);
    assert.equal(next(),undefined);store.release();now+=delay-1;assert(store.acquire());
    assert.equal(next(),undefined);now++;
  }
  const task=next();store.finishTask(task);assert.equal(next(),undefined);
  if(activity)store.enqueue(generation,'transient','document',{},90);else store.enqueue('transient','speech',{},90);
  store.failTask(next(),Object.assign(new Error('Busy'),{status:503,retryAfter:7200}));
  assert.equal(store.db.prepare('SELECT retry_at FROM tasks WHERE key=?').get('transient').retry_at,now+7200000);
});
