import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ActivityStore} from './activity-index-store.mjs';
import {projectRecordTopics} from './record-topics.mjs';
import {writeTopicProjection} from './topics-store.mjs';
import {readTopics,topicReaderSettings,topicReaderWorkers} from './topics-reader.mjs';
test('overview has a 30 second execution budget while other reads retain 10 seconds',async t=>{
 assert.equal(topicReaderSettings.overviewTimeoutMs,30000);assert.equal(topicReaderSettings.timeoutMs,10000);
 assert.equal(topicReaderSettings.queue,16);assert.equal(topicReaderSettings.waitMs,3000);
 const dir=await mkdtemp(path.join(tmpdir(),'overview-timeout-')),store=new ActivityStore(dir,{initializeIndexes:true}),defaults={...topicReaderSettings};
 t.after(async()=>{Object.assign(topicReaderSettings,defaults);store.close();await rm(dir,{recursive:true,force:true});});
 store.acquire();store.set('active',1);writeTopicProjection(store,projectRecordTopics([{id:'E-10-2026-000001',kind:'question',date:'2026-10-07',titles:{en:'Greece'}}]));store.release();
 Object.assign(topicReaderSettings,{workers:1,timeoutMs:1,overviewTimeoutMs:10000,idleMs:1});
 // Cold worker startup exceeds 1 ms. Background mode isolates timeout admission
 // from the automatic warm-up triggered only by real requests.
 const read=()=>readTopics(store.filename,'overview',new URLSearchParams('role=place'),{background:true});
 assert.equal((await read()).ready,true);
 for(let i=0;i<100&&topicReaderWorkers();i++)await delay(10);
 assert.equal(topicReaderWorkers(),0);
 Object.assign(topicReaderSettings,{timeoutMs:10000,overviewTimeoutMs:1});
 await assert.rejects(read(),e=>e.code==='topics_timeout');
});
