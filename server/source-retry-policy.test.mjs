import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CorpusStore} from './corpus-store.mjs';
import {PressStore,PressFollower} from './press-releases.mjs';
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
 for(let i=0;i<3;i++){store.acquire();store.failTask(store.task('bad'),Object.assign(Error('bad archive'),{code:'invalid_docx',sourceHash:'a'.repeat(64)}));if(i<2)now+=DAY/2;}
 assert.equal(store.task('bad').done,1);assert.equal(store.nextTask().key,'other');store.finishTask(store.task('other'));
 store.reopen('bad',body,50);assert.equal(store.task('bad').done,1);
 assert.equal(auditCorpus(store.db,now).sourceFailures[0].contentHash,'a'.repeat(64));
 now+=SOURCE_RECHECK_MS;store.acquire();assert.equal(store.nextTask().key,'bad');
 store.failTask(store.task('bad'),Object.assign(Error('same bytes'),{code:'invalid_docx',sourceHash:'a'.repeat(64)}));
 store.reopen('bad',{...body,edition:{byteSize:11}},50);assert.equal(store.task('bad').done,0);assert.equal(store.task('bad').attempts,0);
});
test('parser upgrades reopen terminal tasks and successful replacement clears evidence',t=>{
 const store=fixture(t,CorpusStore);store.enqueue('bad','docx',{url:'x'},50);
 store.settleSourceFailure(store.task('bad'),Object.assign(Error('empty'),{code:'empty_document'}),'satisfied-by-alternative');
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
 store.fail(id,{status:410,message:'gone'},{now:now+8*DAY});assert.equal(store.release(id).failure_state,'transient');assert.equal(store.release(id).next_check,now+8*DAY+SOURCE_RECHECK_MS);
 assert.equal(store.discover({...item,title:'New announcement'},{feed:'feed',now:now+9*DAY}),true);assert.equal(store.release(id).next_check,now+9*DAY);assert.equal(store.release(id).attempts,0);
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

test('changed rejected bytes, parser or descriptor restart the evidence window',t=>{
 let now=Date.now();const store=fixture(t,CorpusStore,{clock:()=>now});store.enqueue('bad','docx',{url:'x'},1);
 const reject=hash=>{store.acquire();store.failTask(store.task('bad'),{message:'bad',code:'invalid_docx',sourceHash:hash.repeat(64)});};
 reject('a');now+=DAY;reject('b');assert.equal(store.task('bad').body.rejectedSource.count,1);reject('b');assert.equal(store.task('bad').done,0);
 now+=DAY;reject('b');assert.equal(store.task('bad').done,1);
 const status=store.status();assert.equal(status.sourceIssues.count,1);assert.equal(status.tasks.docx.done,0);assert.equal(store.coverage().sourceIssues.examples[0].key,'bad');
 store.enqueue('alternative','docx',{url:'y'},1);store.settleSourceFailure(store.task('alternative'),Error('bad'),'satisfied-by-alternative');
 assert.equal(store.status().satisfiedByAlternative.count,1);assert.equal(store.coverage().satisfiedByAlternative.count,1);assert.equal(store.status().tasks.docx.done,0);
});

test('ten unchanged RSS polls preserve missing history and long Retry-After deadlines',t=>{
 const store=fixture(t,PressStore),item={id:'a',url:'https://example.test/a',title:'Same',publishedAt:'2026-01-01'};let now=Date.now();
 store.discover(item,{feed:'feed',now});
 for(let i=0;i<10;i++) {
   const before=store.release(item.id);assert.equal(store.discover(item,{feed:'feed',now}),false);assert.deepEqual(store.release(item.id),before);
   if(store.release(item.id).next_check<=now)store.fail(item.id,{status:404,message:'missing'},{now});
   now+=DAY;
 }
 assert.equal(store.release(item.id).failure_state,'transient');assert(store.release(item.id).attempts>1);
 store.fail(item.id,{status:503,message:'busy',retryAfter:20*DAY/1000},{now});const before=store.release(item.id);
 for(let i=0;i<10;i++){now+=DAY;store.discover(item,{feed:'feed',now});assert.deepEqual(store.release(item.id),before);}
 store.db.prepare('UPDATE feed_observations SET present=0 WHERE feed=?').run('feed');assert.equal(store.discover(item,{feed:'feed',now}),true);assert.equal(store.release(item.id).attempts,0);
});


test('daily follower polls distinguish continued announcements, feed absence and changed GUIDs',async t=>{
 const store=fixture(t,PressStore),id='20261016IPR48238';let now=Date.now(),present=true,guid='first';
 const xml=()=>'<rss><channel><title>Feed</title>'+(present?`<item><link>https://www.europarl.europa.eu/news/en/press-room/${id}/</link><guid>${guid}</guid><title>Same title</title><pubDate>Mon, 19 Oct 2026 17:33:01 GMT</pubDate></item>`:'')+'</channel></rss>';
 const follower=new PressFollower(store,{clock:()=>now,fetchText:async url=>{if(url.endsWith('.xml'))return xml();throw Object.assign(Error('missing'),{status:404});}});
 for(let i=0;i<10;i++){await follower.run();now+=DAY;}
 assert.equal(store.release(id).failure_state,'transient');assert(store.release(id).attempts>1);
 const saved=store.release(id);await follower.poll(null,()=>true);assert.deepEqual(store.release(id),saved);
 present=false;await follower.poll(null,()=>true);present=true;await follower.poll(null,()=>true);assert.equal(store.release(id).attempts,0);
 store.fail(id,{message:'busy',status:503,retryAfter:30*DAY/1000},{now});guid='second';await follower.poll(null,()=>true);assert.equal(store.release(id).attempts,0);assert.equal(store.release(id).next_check,now);
});


test('three immediate rejections cannot settle and parser/descriptor changes reset confirmation',t=>{
 let now=Date.now();const store=fixture(t,CorpusStore,{clock:()=>now});store.enqueue('bad','docx',{url:'x'},1);
 const reject=()=>{store.acquire();store.failTask(store.task('bad'),{message:'bad',code:'invalid_docx',sourceHash:'a'.repeat(64)});};
 reject();reject();reject();assert.equal(store.task('bad').done,0);
 let body=store.task('bad').body;body.rejectedSource.parserVersion--;store.db.prepare('UPDATE tasks SET body=? WHERE key=?').run(JSON.stringify(body),'bad');now+=DAY;reject();assert.equal(store.task('bad').body.rejectedSource.count,1);
 body=store.task('bad').body;body.edition={byteSize:42};store.db.prepare('UPDATE tasks SET body=? WHERE key=?').run(JSON.stringify(body),'bad');now+=DAY;reject();assert.equal(store.task('bad').body.rejectedSource.count,1);assert.equal(store.task('bad').done,0);
});

test('press content rejections use the shared byte confirmation and transient errors reset it',t=>{
 const store=fixture(t,PressStore),id='rejected',now=Date.now();store.discover({id,url:'https://example.test/rejected'},{feed:'feed',now});
 const reject=at=>store.fail(id,{message:'bad',code:'invalid_docx',sourceHash:'a'.repeat(64)},{now:at});
 reject(now);reject(now+DAY/2);store.fail(id,{status:503,message:'busy'},{now:now+DAY});reject(now+DAY);
 assert.equal(store.release(id).failure_state,'transient');assert.equal(JSON.parse(store.release(id).rejected_source).count,1);
 reject(now+DAY*1.5);reject(now+DAY*2);assert.equal(store.release(id).failure_state,'permanent-source-issue');
});
