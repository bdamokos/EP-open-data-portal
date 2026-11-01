import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {buildTopics,topicCollectorTables} from './topics-project.mjs';
import {RecordTopics} from './topics-store.mjs';
import {collectTopicProcedure,topicCollectionDue} from './topics-collector.mjs';
test('offline generation build reports pending, coverage and durable collector admission bounds',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topic-collector-')),store=new ActivityStore(dir,{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});store.acquire();const c=store.beginCycle();
 const stamp='2026-11-01T12:00:00Z';
 store.putSource(c.generation,'/procedures/2026-2790','procedure',{id:'eli/dl/proc/2026-2790',label:'2026/2790(RSP)'},stamp);
 store.putSource(c.generation,'/plenary-documents/B-10-2026-0423','document',{id:'eli/dl/doc/B-10-2026-0423',identifier:'B-10-2026-0423',work_type:'def/ep-document-types/MOTION',document_date:'2026-10-07',inverse_created_a_realization_of:['eli/dl/proc/2026-2790']},stamp);
 store.putSource(c.generation,'/parliamentary-questions/E-10-2026-000001','document',{id:'eli/dl/doc/E-10-2026-000001',identifier:'E-10-2026-000001',work_type:'def/ep-document-types/QUESTION_WRITTEN',document_date:'2026-10-07',inverse_created_a_realization_of:['eli/dl/proc/2026-2790']},stamp);
 const oral='O-10-2026-000002',event='MTG-PL-2026-10-07-PVCRE-ITM-12';
 store.putSource(c.generation,'/parliamentary-questions/'+oral,'document',{identifier:oral,work_type:'def/ep-document-types/QUESTION_ORAL',document_date:'2026-10-07'},stamp);
 store.putSource(c.generation,'/events/'+event,'outside-agenda',{activity_id:event,activity_date:'2026-10-07',based_on_a_realization_of:['eli/dl/doc/'+oral],inverse_consists_of:['eli/dl/proc/2026-2790']},stamp);
 store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(c.generation,'/parliamentary-questions/'+oral,oral,'1','oral-questions','2026-10-07',JSON.stringify({titles:{en:'Oral question'}}));
 store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(c.generation,'/parliamentary-questions/E-10-2026-000001','E-10-2026-000001','1','written-questions','2026-10-07',JSON.stringify({titles:{en:'Written question'}}));
 store.publish(c.generation);const result=await buildTopics(store);assert.deepEqual(result.coverage,{referenced:1,withSubjects:0,read:0,unavailable:0});assert.equal(new RecordTopics(store).record('B-10-2026-0423','en').status,'pending');assert.equal(new RecordTopics(store).record('E-10-2026-000001','en').status,'not-classified');assert.equal(new RecordTopics(store).record(oral,'en').status,'pending');
 const now=Date.parse(stamp),worker={store,clock:()=>now,requests:0,budget:5,controller:new AbortController()};let calls=0;
 assert(topicCollectionDue(store,now));await collectTopicProcedure(worker,{sources:{get:async(url,options)=>{calls++;assert.equal(options.priority,'background');assert(url.includes('2026%2F2790'));throw Error('offline');}}});assert.equal(calls,1);assert.equal(worker.requests,1);assert(!topicCollectionDue(store,now));
 store.db.prepare('UPDATE topic_procedure_queue SET next_read=0').run();store.set('topicCollectorBudget',{day:'2026-11-01',used:10000});assert(topicCollectionDue(store,now));worker.requests=worker.budget;assert.equal(await collectTopicProcedure(worker,{sources:{get:()=>assert.fail()}}),false);
});

test('missing procedure metadata is resolved only by its exact published ID before collecting OEIL',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topic-procedure-id-')),store=new ActivityStore(dir,{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});store.acquire();topicCollectorTables(store.db);store.db.prepare('INSERT INTO topic_procedure_queue VALUES (?,?,0)').run('2026-2790',null);
 let calls=0;const worker={store,clock:()=>Date.parse('2026-11-01T12:00Z'),requests:0,budget:10,controller:new AbortController(),request:async endpoint=>{calls++;worker.requests++;assert.equal(endpoint,'/procedures/2026-2790');return {payload:{data:[{id:'eli/dl/proc/2026-2790',label:'2026/2790(RSP)'}]},url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:'2026-11-01T12:00Z'};}};
 assert(await collectTopicProcedure(worker,{sources:{get:()=>assert.fail('OEIL waits for the exact reference')}}));assert.equal(calls,1);assert.equal(store.db.prepare('SELECT reference FROM topic_procedure_queue').get().reference,'2026/2790(RSP)');assert.equal(store.db.prepare('SELECT COUNT(*) n FROM topic_procedure_metadata').get().n,1);
});

test('disk staging retains raw speech parents, numeric retrieval dates and equal-time conflicts',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topic-raw-speech-')),cache=path.join(dir,'cache');await mkdir(cache);const store=new ActivityStore(path.join(dir,'index'),{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});store.acquire();store.set('active',1);
 const doc='B-10-2026-0423',event='MTG-PL-2026-10-07-PVCRE-ITM-12',speech='MTG-PL-2026-10-07-OTH-100',stamp=Date.parse('2026-10-24T12:00Z');
 const rows=[{id:'eli/dl/doc/'+doc,identifier:doc,work_type:'def/ep-document-types/MOTION',document_date:'2026-10-07',is_about:['http://eurovoc.europa.eu/245']},{id:'eli/dl/event/'+event,activity_id:event,activity_date:'2026-10-07',based_on_a_realization_of:['eli/dl/doc/'+doc]},{id:'eli/dl/event/'+speech,activity_id:speech,activity_date:'2026-10-07',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',inverse_consists_of:['eli/dl/event/'+event,'eli/dl/event/MTG-PL-2026-10-07-PVCRE-ITM-1'],recorded_in_a_realization_of:[{identifier:'CRE-10-2026-10-07-ITM-012',is_part_of:['eli/dl/doc/CRE-10-2026-10-07-ITM-012']}]}];
 await writeFile(path.join(cache,'a'.repeat(64)+'.json'),JSON.stringify({url:'https://data.europarl.europa.eu/api/v2/speeches',fetchedAt:stamp,payload:{data:rows}}));
 await buildTopics(store,{cache});let record=new RecordTopics(store).record(speech,'en');assert(record.keywords.some(k=>k.key==='eurovoc:245'));const saved=JSON.parse(store.db.prepare('SELECT body FROM record_topic_records WHERE generation=1 AND id=?').get(speech).body);assert.equal(saved.source.fetchedAt,'2026-10-24T12:00:00.000Z');assert.deepEqual(saved.parentIds,[event]);
 await writeFile(path.join(cache,'b'.repeat(64)+'.json'),JSON.stringify({url:'https://data.europarl.europa.eu/api/v2/speeches',fetchedAt:stamp,payload:{data:[{...rows[2],inverse_consists_of:['eli/dl/event/MTG-PL-2026-10-07-PVCRE-ITM-13']}]}}));
 await buildTopics(store,{cache});record=new RecordTopics(store).record(speech,'en');assert.equal(record.status,'ambiguous');assert.deepEqual(record.keywords,[]);
});

test('question items are the universe, deduplicating authors without requiring document metadata',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topic-question-items-')),store=new ActivityStore(dir,{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});store.acquire();store.set('active',1);
 const put=store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)'),written='E-10-2025-000001',oral='O-10-2025-000002';

 store.db.prepare('INSERT INTO members VALUES (?,?)').run('1',JSON.stringify({id:'1',countryCode:'GR'}));
 store.db.prepare('INSERT INTO members VALUES (?,?)').run('2',JSON.stringify({id:'2',countryCode:'CY'}));
 store.putSource(1,'/parliamentary-questions/'+oral,'document',{identifier:oral,work_type:'def/ep-document-types/QUESTION_ORAL',document_date:'2025-05-06',title_dcterms:{fr:'Grèce'},creator:['person/999']},'2025-06-01');
 store.putSource(1,'/parliamentary-questions/E-10-2025-999999','document',{identifier:'E-10-2025-999999',work_type:'def/ep-document-types/QUESTION_WRITTEN',title_dcterms:{en:'Greece'}},'2025-06-01');
 for(const [id,mep,category,title] of [[written,'1','written-questions','Greece and Cyprus'],[written,'2','written-questions','Greece and Cyprus'],[oral,'2','oral-questions','Greece']])put.run(1,'/parliamentary-questions/'+id,id,mep,category,'2025-05-06',JSON.stringify({titles:{en:title},provenance:{apiUrl:'https://data.europarl.europa.eu/api/v2/parliamentary-questions/'+id,sourceFetchedAt:'2025-06-02T00:00:00Z'}}));
 await buildTopics(store);
 const reader=new RecordTopics(store);assert.equal(reader.record(written,'en').kind,'question');assert.equal(reader.record(oral,'en').places[0].askers,'elsewhere');assert.equal(reader.record(written,'en').places.find(p=>p.id==='GRC').askers,'home');assert.equal(reader.record(written,'en').places.find(p=>p.id==='CYP').askers,'home');
 const rows=store.db.prepare("SELECT id,body FROM record_topic_records WHERE generation=1 AND kind='question' ORDER BY id").all();assert.equal(rows.length,2);assert.deepEqual(JSON.parse(rows[0].body).members,['1','2']);assert.equal(JSON.parse(rows[0].body).assignments[0].paths[0].sources[0].fetchedAt,'2025-06-02T00:00:00Z');assert.equal(JSON.parse(rows[1].body).titles.fr,'Grèce');
 const overview=reader.query(new URLSearchParams('role=place'),'overview');assert.equal(overview.items.find(p=>p.id==='GRC').counts.question,2);assert.equal(Object.values(overview.periodTotals).reduce((n,p)=>n+p.question,0),2);
});

test('oversized OEIL pages retain an unavailable observation and do not loop',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topic-oversized-')),store=new ActivityStore(dir,{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});store.acquire();topicCollectorTables(store.db);store.db.prepare('INSERT INTO topic_procedure_queue VALUES (?,?,0)').run('2023-0284','2023/0284(COD)');
 const worker={store,clock:()=>Date.parse('2026-11-01T12:00Z'),requests:0,budget:10,controller:new AbortController()};let calls=0;const sources={get:async()=>{calls++;throw Object.assign(Error('Source too large'),{code:'official_source_size'});}};
 assert(await collectTopicProcedure(worker,{sources}));assert(!topicCollectionDue(store,worker.clock()));assert.equal(await collectTopicProcedure(worker,{sources}),false);assert.equal(calls,1);const body=JSON.parse(store.db.prepare('SELECT body FROM topic_procedure_pages').get().body);assert.equal(body.state,'unavailable');assert.equal(body.reason,'source-too-large');
});

test('topic collector defers at retained-source capacity without fetching or marking failure',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'topic-capacity-')),store=new ActivityStore(dir,{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});store.acquire();topicCollectorTables(store.db);store.db.prepare('INSERT INTO topic_procedure_queue VALUES (?,?,0)').run('2023-0284','2023/0284(COD)');
 const now=Date.parse('2026-11-01T12:00Z'),sources={cache:{capacity:async()=>({state:'capacity'})},get:()=>assert.fail('capacity pauses source reads')},worker={store,clock:()=>now,requests:0,budget:10,controller:new AbortController(),officialContext:{sources}};
 assert.equal(await collectTopicProcedure(worker),false);assert.equal(worker.requests,0);assert.equal(store.db.prepare('SELECT next_read FROM topic_procedure_queue').get().next_read,now+60_000);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM topic_procedure_pages').get().n,0);assert.equal(store.get('topicProjectionDirty'),null);
});
