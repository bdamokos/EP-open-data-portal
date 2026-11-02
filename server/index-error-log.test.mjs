import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {createErrorLog} from './error-log.mjs';
import {indexErrorEvent} from './index-error-log.mjs';

const id='MTG-PL-2026-03-11-OTH-12345';
test('speech indexing events retain bounded public context without arbitrary task or error text',()=>{
  const error=Object.assign(new Error('private message https://example.org/?token=secret'),{status:503,code:'upstream_busy'});
  const event=indexErrorEvent({kind:'speeches',generation:12,attempts:2,body:{recoveryId:id,token:'secret'}},error);
  assert.equal(event.category,'speech-record');assert.equal(event.sourceId,id);assert.equal(event.start,'2026-03-11');assert.equal(event.end,event.start);
  assert.equal(event.attempt,3);assert.equal(event.generation,12);assert.equal(event.status,503);assert.equal(event.code,'upstream_busy');
  assert(!JSON.stringify(event).includes('secret'));assert(!JSON.stringify(event).includes('private'));
  assert.equal(indexErrorEvent({kind:'document'},error),null);
  assert.equal(indexErrorEvent({kind:'speeches'},new DOMException('Cancelled','AbortError')),null);
  const invalid=indexErrorEvent({kind:'outside-detail',body:{id:'secret?token=secret',date:'invalid',language:'secret value'}},error);
  assert.equal(invalid.sourceId,undefined);assert.equal(invalid.start,undefined);assert.equal(invalid.language,undefined);
});

test('worker logs each failed list/roster/detail attempt and preserves retries and retained gaps',async()=>{
  for(const [kind,body,category] of [
    ['speeches',{params:{'sitting-date':'2026-10-22','sitting-date-end':'2026-10-26'},offset:250},'speech-list'],
    ['outside-roster',{date:'2026-09-14',offset:0,ids:[],sources:[]},'speaker-list'],
    ['outside-detail',{id},'speech-record'],
  ]) {
    const directory=await mkdtemp(path.join(os.tmpdir(),'index-errors-'));
    let now=Date.parse('2026-11-02T10:00:00Z');
    const clock=()=>now,store=new ActivityStore(directory,{clock});
    const log=createErrorLog({directory:path.join(directory,'logs')});
    try {
      store.acquire();const {generation}=store.beginCycle();
      store.updateCycle({initialized:true,membershipScheduled:true,groupHistoryScheduled:true});
      store.enqueue(generation,'diagnostic-test',kind,body,9999);
      store.release();
      const worker=new ActivityWorker(store,{clock,budget:1,diagnostics:log,fetchRecord:async()=>{throw Object.assign(new Error('source unavailable'),{status:503});}});
      for(let attempt=1;attempt<=3;attempt++){
        await worker.run();
        const row=store.db.prepare('SELECT retry_at FROM tasks WHERE key=?').get('diagnostic-test');
        now=Math.max(now+1,row.retry_at+1);
      }
      const lines=(await readFile(path.join(directory,'logs','errors.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(lines.length,3);assert(lines.every(event=>event.category===category));assert.deepEqual(lines.map(event=>event.attempt),[1,2,3]);assert.equal(lines[0].status,503);
      const task=store.db.prepare('SELECT * FROM tasks WHERE key=?').get('diagnostic-test');
      if(kind==='speeches')assert.equal(task.attempts,3);
      else {assert.equal(task.done,1);assert.equal(store.source(generation,'outside:gap:diagnostic-test').work.attempts,3);}
    }finally{store.close();await rm(directory,{recursive:true,force:true});}
  }
});

test('diagnostic write/flush failure cannot stop retry handling; cancellation produces no event',async()=>{
  for(const cancelled of [false,true]) {
    const directory=await mkdtemp(path.join(os.tmpdir(),'index-log-failure-'));
    const clock=()=>Date.parse('2026-11-02T10:00:00Z'),store=new ActivityStore(directory,{clock});
    let writes=0;
    try {
      store.acquire();const {generation}=store.beginCycle();
      store.updateCycle({initialized:true,membershipScheduled:true,groupHistoryScheduled:true});
      store.enqueue(generation,'diagnostic-test','outside-detail',{id},9999);store.release();
      const worker=new ActivityWorker(store,{clock,budget:1,
        diagnostics:{write(){writes++;throw new Error('disk failure');},flush(){throw new Error('flush failure');}},
        fetchRecord:async()=>{throw cancelled?new DOMException('Cancelled','AbortError'):new Error('Source failed');},
      });
      await worker.run();
      assert.equal(writes,cancelled?0:1);
      assert.equal(store.db.prepare('SELECT attempts FROM tasks WHERE key=?').get('diagnostic-test').attempts,1);
    }finally{store.close();await rm(directory,{recursive:true,force:true});}
  }
});
