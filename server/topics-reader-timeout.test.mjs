import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {projectRecordTopics} from './record-topics.mjs';
import {writeTopicProjection} from './topics-store.mjs';
import {readTopics,topicReaderSettings} from './topics-reader.mjs';
// Its own file, so no idle worker from another test can take the queued read.
// Covers the timeout path; the late-reply race itself can't be forced here.
test('a timed-out worker never takes the next queued read',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topics-reader-timeout-')),store=new ActivityStore(dir,{initializeIndexes:true}),defaults={...topicReaderSettings};
 t.after(async()=>{Object.assign(topicReaderSettings,defaults);store.close();await rm(dir,{recursive:true,force:true});});
 store.acquire();store.set('active',1);const id='E-10-2026-000002';writeTopicProjection(store,projectRecordTopics([{id,kind:'question',date:'2026-10-07',titles:{en:'Greece'},members:['42']}]));store.release();
 const read=()=>readTopics(store.filename,'records',new URLSearchParams('ids='+id));
 Object.assign(topicReaderSettings,{workers:1,timeoutMs:1});const first=read();Object.assign(topicReaderSettings,{timeoutMs:10000});const second=read();
 await assert.rejects(first,e=>e.code==='topics_timeout');const result=await second;assert.equal(result.records[0].id,id,'the queued read runs on a fresh worker');
});
