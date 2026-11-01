import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {topicCollectorTables} from './topics-project.mjs';
import {storyTables,queueStoryRead} from './story-facts-storage.mjs';
import {collectTopicProcedure} from './topics-collector.mjs';
import {collectStorySource} from './story-facts-collector.mjs';
import {collectorRetry,collectorPermanent} from './collector-retry.mjs';
const DAY=86400_000;
test('retry classifications preserve source causes, identity/parse gaps and server pauses',()=>{
 for(const e of [{status:404},{code:'official_source_unavailable',cause:{status:404}},{code:'procedure_identity'},{code:'official_document_invalid'},Error('Procedure reference unavailable.'),Error('Event identity does not match the request.')])assert(collectorPermanent(e));
 assert.equal(collectorRetry({code:'official_context_capacity'},8,0).attempts,8);
 assert.equal(collectorRetry({retryAfter:9*DAY/1000},20,0).next,9*DAY);
 assert.equal(collectorRetry(Error('offline'),0,0).next,60_000);assert.equal(collectorRetry(Error('offline'),1,0).next,120_000);assert.equal(collectorRetry(Error('offline'),30,0).next,7*DAY);
});
for(const kind of ['topic','story'])for(const permanent of [true,false])test(`${kind} retains ${permanent?'unavailable rechecks':'growing transient retries'} across restart`,async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'collector-retry-'));let now=Date.now(),calls=0,store=new ActivityStore(dir,{clock:()=>now,initializeIndexes:true});store.acquire();t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});topicCollectorTables(store.db);storyTables(store.db);
 if(kind==='topic')store.db.prepare('INSERT INTO topic_procedure_queue VALUES (?,?,0)').run('2025-0001','2025/0001(COD)');else queueStoryRead(store,'event','MTG-PL-2025-03-12-PVCRE-ITM-1');
 const fail=async()=>{calls++;throw permanent?Object.assign(Error('missing'),{code:'official_source_unavailable',cause:{status:404}}):Error('transport');};
 const worker=()=>({store,clock:()=>now,requests:0,budget:100,controller:new AbortController(),request:fail});
 const run=()=>kind==='topic'?collectTopicProcedure(worker(),{sources:{get:fail}}):collectStorySource(worker());
 const row=()=>kind==='topic'?store.db.prepare('SELECT q.next_read,a.attempts FROM topic_procedure_queue q LEFT JOIN topic_procedure_attempts a ON a.id=q.id').get():store.db.prepare('SELECT next_read,attempts,state FROM story_jobs').get();
 await run();assert.equal(calls,1);assert.equal(row().next_read,now+(permanent?30*DAY:60_000));if(permanent){if(kind==='topic')assert.equal(JSON.parse(store.db.prepare('SELECT body FROM topic_procedure_pages').get().body).state,'unavailable');else assert.equal(row().state,'unavailable');}
 const saved={...row()};store.close();store=new ActivityStore(dir,{clock:()=>now});store.acquire();assert.deepEqual({...row()},saved);assert.equal(await run(),false);assert.equal(calls,1);
 now=saved.next_read-1;store.acquire();assert.equal(await run(),false);now++;store.acquire();await run();assert.equal(calls,2);assert.equal(row().attempts,2);
 if(!permanent){for(let i=0;i<24;i++){now=row().next_read;store.acquire();await run();}assert.equal(row().next_read-now,7*DAY);}
});
