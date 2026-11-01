import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {buildTopics,topicCollectorTables} from './topics-project.mjs';
import {RecordTopics} from './topics-store.mjs';
import {collectTopicProcedure,topicCollectionDue,TOPIC_DAILY_CAP} from './topics-collector.mjs';
test('offline generation build reports pending, coverage and durable collector admission bounds',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topic-collector-')),store=new ActivityStore(dir,{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});store.acquire();const c=store.beginCycle();
 const stamp='2026-11-01T12:00:00Z';
 store.putSource(c.generation,'/procedures/2026-2790','procedure',{id:'eli/dl/proc/2026-2790',label:'2026/2790(RSP)'},stamp);
 store.putSource(c.generation,'/plenary-documents/B-10-2026-0423','document',{id:'eli/dl/doc/B-10-2026-0423',identifier:'B-10-2026-0423',work_type:'def/ep-document-types/MOTION',document_date:'2026-10-07',inverse_created_a_realization_of:['eli/dl/proc/2026-2790']},stamp);
 store.publish(c.generation);const result=await buildTopics(store);assert.deepEqual(result.coverage,{referenced:1,withSubjects:0,read:0});assert.equal(new RecordTopics(store).record('B-10-2026-0423','en').status,'pending');
 const now=Date.parse(stamp),worker={store,clock:()=>now,requests:0,budget:5,controller:new AbortController()};let calls=0;
 assert(topicCollectionDue(store,now));await collectTopicProcedure(worker,{sources:{get:async(url,options)=>{calls++;assert.equal(options.priority,'background');assert(url.includes('2026%2F2790'));throw Error('offline');}}});assert.equal(calls,1);assert.equal(worker.requests,1);assert(!topicCollectionDue(store,now));
 store.db.prepare('UPDATE topic_procedure_queue SET next_read=0').run();store.set('topicCollectorBudget',{day:'2026-11-01',used:TOPIC_DAILY_CAP});assert(!topicCollectionDue(store,now));assert.equal(await collectTopicProcedure(worker,{sources:{get:()=>assert.fail()}}),false);
});

test('missing procedure metadata is resolved only by its exact published ID before collecting OEIL',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topic-procedure-id-')),store=new ActivityStore(dir,{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});store.acquire();topicCollectorTables(store.db);store.db.prepare('INSERT INTO topic_procedure_queue VALUES (?,?,0)').run('2026-2790',null);
 let calls=0;const worker={store,clock:()=>Date.parse('2026-11-01T12:00Z'),requests:0,budget:10,controller:new AbortController(),request:async endpoint=>{calls++;worker.requests++;assert.equal(endpoint,'/procedures/2026-2790');return {payload:{data:[{id:'eli/dl/proc/2026-2790',label:'2026/2790(RSP)'}]},url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:'2026-11-01T12:00Z'};}};
 assert(await collectTopicProcedure(worker,{sources:{get:()=>assert.fail('OEIL waits for the exact reference')}}));assert.equal(calls,1);assert.equal(store.db.prepare('SELECT reference FROM topic_procedure_queue').get().reference,'2026/2790(RSP)');assert.equal(store.db.prepare('SELECT COUNT(*) n FROM topic_procedure_metadata').get().n,1);
});

test('disk staging retains raw speech parents, numeric retrieval dates and equal-time conflicts',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topic-raw-speech-')),cache=path.join(dir,'cache');await mkdir(cache);const store=new ActivityStore(path.join(dir,'index'),{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});store.acquire();store.set('active',1);
 const doc='B-10-2026-0423',event='MTG-PL-2026-10-07-PVCRE-ITM-12',speech='MTG-PL-2026-10-07-OTH-100',stamp=Date.parse('2026-10-24T12:00Z');
 const rows=[{id:'eli/dl/doc/'+doc,identifier:doc,work_type:'def/ep-document-types/MOTION',document_date:'2026-10-07',is_about:['http://eurovoc.europa.eu/245']},{id:'eli/dl/event/'+event,activity_id:event,activity_date:'2026-10-07',based_on_a_realization_of:['eli/dl/doc/'+doc]},{id:'eli/dl/event/'+speech,activity_id:speech,activity_date:'2026-10-07',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',inverse_consists_of:['eli/dl/event/'+event]}];
 await writeFile(path.join(cache,'a'.repeat(64)+'.json'),JSON.stringify({url:'https://data.europarl.europa.eu/api/v2/speeches',fetchedAt:stamp,payload:{data:rows}}));
 await buildTopics(store,{cache});let record=new RecordTopics(store).record(speech,'en');assert(record.keywords.some(k=>k.key==='eurovoc:245'));const saved=JSON.parse(store.db.prepare('SELECT body FROM record_topic_records WHERE generation=1 AND id=?').get(speech).body);assert.equal(saved.source.fetchedAt,'2026-10-24T12:00:00.000Z');
 await writeFile(path.join(cache,'b'.repeat(64)+'.json'),JSON.stringify({url:'https://data.europarl.europa.eu/api/v2/speeches',fetchedAt:stamp,payload:{data:[{...rows[2],inverse_consists_of:['eli/dl/event/MTG-PL-2026-10-07-PVCRE-ITM-13']}]}}));
 await buildTopics(store,{cache});record=new RecordTopics(store).record(speech,'en');assert.equal(record.status,'ambiguous');assert.deepEqual(record.keywords,[]);
});
