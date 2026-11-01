import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CorpusStore} from './corpus-store.mjs';
import {PressStore} from './press-releases.mjs';
import {auditCorpus} from './data-gap-audit.mjs';
import {permanentSourceIssue,transientSourceDelay,SOURCE_RECHECK_MS} from './source-retry.mjs';
import {DOCX_EXTRACTION_VERSION} from './docx-source-structure.mjs';
const DAY=86_400_000;
function fixture(t,Type,options={}) {
 const dir=mkdtempSync(path.join(tmpdir(),'source-retry-')),store=new Type(dir,options);
 if(Type===PressStore)store.initialize();else store.acquire();
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return store;
}
test('only classified data-quality failures are permanent; persistent transport failures slow to daily',()=>{
 for(const code of ['invalid_docx','empty_document','unexpected_document_format','source_parser_rejection'])assert.equal(permanentSourceIssue({code}),true);
 for(const error of [{status:500},{status:503},{status:429},Error('timeout'),Error('network')])assert.equal(permanentSourceIssue(error),false);
 assert.equal(transientSourceDelay(370),DAY);assert.equal(transientSourceDelay(0),60_000);
});
test('corpus terminal issues preserve evidence, allow other work and recheck sparsely',t=>{
 let now=Date.now();const store=fixture(t,CorpusStore,{clock:()=>now}),body={url:'https://example.test/a.docx',edition:{byteSize:10}};
 store.enqueue('bad','docx',body,50);store.enqueue('other','speech',{},10);
 store.failTask(store.task('bad'),Object.assign(Error('bad archive'),{code:'invalid_docx',sourceHash:'abc'}));
 assert.equal(store.task('bad').done,1);assert.equal(store.nextTask().key,'other');store.finishTask(store.task('other'));
 store.reopen('bad',body,50);assert.equal(store.task('bad').done,1);
 assert.equal(auditCorpus(store.db,now).sourceFailures[0].contentHash,'abc');
 now+=SOURCE_RECHECK_MS;store.acquire();assert.equal(store.nextTask().key,'bad');
 store.failTask(store.task('bad'),Object.assign(Error('same bytes'),{code:'invalid_docx',sourceHash:'abc'}));
 store.reopen('bad',{...body,edition:{byteSize:11}},50);assert.equal(store.task('bad').done,0);assert.equal(store.task('bad').attempts,0);
});
test('parser upgrades reopen terminal tasks and successful replacement clears evidence',t=>{
 const store=fixture(t,CorpusStore);store.enqueue('bad','docx',{url:'x'},50);
 store.failTask(store.task('bad'),Object.assign(Error('empty'),{code:'empty_document'}));
 store.db.prepare('UPDATE source_failures SET parser_version=?').run(DOCX_EXTRACTION_VERSION-1);
 assert.equal(store.hasDueTask(),true);const task=store.nextTask();assert.equal(task.key,'bad');store.finishTask(task);
 assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM source_failures').get().n,0);
});
test('press transport failures never exhaust and respect Retry-After',t=>{
 const store=fixture(t,PressStore),id='a';let now=Date.now();store.discover({id,url:'https://example.test/a'},{feed:'feed',now});
 for(let i=0;i<20;i++){store.fail(id,{status:503,message:'unavailable'},{now});assert(store.release(id).next_check>now);now=store.release(id).next_check;}
 store.fail(id,{status:429,message:'limited',retryAfter:172800},{now});assert.equal(store.release(id).next_check,now+2*DAY);
 assert.equal(store.release(id).failure_state,'transient');
});
test('press repeated missing sources settle sparsely and RSS announcements reopen them',t=>{
 const store=fixture(t,PressStore),id='a',now=Date.now(),item={id,url:'https://example.test/a'};store.discover(item,{feed:'feed',now});
 store.fail(id,{status:404,message:'missing'},{now});assert.equal(store.release(id).failure_state,'transient');
 store.fail(id,{status:410,message:'gone'},{now:now+8*DAY});assert.equal(store.release(id).failure_state,'permanent-source-issue');assert.equal(store.release(id).next_check,now+8*DAY+SOURCE_RECHECK_MS);
 assert.equal(store.discover(item,{feed:'feed',now:now+9*DAY}),true);assert.equal(store.release(id).next_check,now+9*DAY);assert.equal(store.release(id).attempts,0);
 store.fail(id,{status:500,message:'server'},{now:now+9*DAY});assert.equal(store.release(id).failure_state,'transient');assert.equal(store.release(id).missing_since,null);
});

test('amendment, outside roster and group voice queues retain daily retries after sustained transport failure',async t=>{
 const {ActivityStore}=await import('./activity-index-store.mjs');
 const now=Date.now(),store=fixture(t,ActivityStore,{clock:()=>now});store.acquire();
 for(const [table,kind,flags] of [['tasks','outside-roster',{}],['amendment_jobs','amendment-roster',{amendmentJob:true}],['group_voice_jobs','group-voice',{groupVoiceJob:true}]]) {
   store.db.prepare(`INSERT INTO ${table}(generation,key,kind,body,priority,done,attempts,retry_at) VALUES (1,?,?,?,1,0,370,0)`).run(kind,kind,'{}');
   store.failTask({generation:1,key:kind,kind,attempts:370,...flags},{message:'EP API returned 500',status:500});
   const row=store.db.prepare(`SELECT * FROM ${table} WHERE key=?`).get(kind);assert.equal(row.done,0);assert.equal(row.retry_at,now+DAY);assert.equal(row.attempts,371);
 }
});
