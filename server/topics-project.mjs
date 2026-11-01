import {storyTables,stageStoryInput,storyTopicObservations} from './story-facts-storage.mjs';
import {buildStoryFacts} from './story-facts-project.mjs';
import {topicWorkFields} from './topic-work-fields.mjs';
import {topicCachedWorks} from './topic-cache-stream.mjs';
import {TopicDiskMap,topicBatches} from './topic-disk-map.mjs';
import {questionCountryMetadata} from './question-place-askers.mjs';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {topicObservationNodes,topicObservationSteps} from './record-topic-observations.mjs';
import {projectRecordTopics,projectTopicSteps,conceptIdentity,RECORD_TOPICS_VERSION} from './record-topics.mjs';
import {topicTables,putTopicRecords,finishTopicProjection} from './topics-store.mjs';
import {parseProcedurePage} from './official-context.mjs';
const sourceDate=value=>typeof value==='number'||/^\d{13}$/.test(String(value))?new Date(Number(value)).toISOString():value;
const normalizeSource=source=>source?{...source,fetchedAt:sourceDate(source.fetchedAt)}:source;
const fields=['id','identifier','activity_id','activity_date','activity_label','had_activity_type','work_type','document_date','title_dcterms','is_realized_by','creator','workHadParticipation','is_about','isAboutSubjectMatter','inverse_created_a_realization_of','inverse_based_on_a_realization_of','inverse_decided_on_a_realization_of','based_on_a_realization_of','inverse_consists_of','inverse_was_scheduled_in','executed','consists_of','process_type','process_title','label','outside','date','titles','source'];
const compact=w=>Object.fromEntries(fields.filter(k=>w[k]!==undefined).map(k=>[k,k==='is_realized_by'?(Array.isArray(w[k])?w[k]:[w[k]]).map(e=>({title:e.title})):k==='consists_of'?(Array.isArray(w[k])?w[k]:[w[k]]).map(e=>typeof e==='object'?compact(e):e):k==='outside'?Object.fromEntries(['identifier','date','titles','source','parentIds','participants'].filter(f=>w[k][f]!==undefined).map(f=>[f,w[k][f]])):w[k]]));
export async function buildTopics(store,{generation=store.get('active'),cache=process.env.ODP_CACHE_DIR,onProgress=()=>{}}={}){
 store.assertWriter();topicTables(store.db);topicCollectorTables(store.db);storyTables(store.db);
 const previousCacheSize=store.db.prepare('PRAGMA cache_size').get().cache_size;store.db.exec('PRAGMA cache_size=-1024;PRAGMA temp_store=FILE;PRAGMA temp.cache_size=-1024');
 const heartbeat=setInterval(()=>{try{store.renew();}catch{}},20_000);heartbeat.unref();
 try{
 const readWork=topicWorkFields(store.db);
 const disk=name=>new TopicDiskMap(store.db,name),observations=disk('observations'),concepts=disk('concepts'),procedureTopics=disk('procedure_topics');
 store.db.exec('DROP TABLE IF EXISTS temp.topic_speech_inputs;CREATE TEMP TABLE topic_speech_inputs(id TEXT PRIMARY KEY,body TEXT)');
 const speechGet=store.db.prepare('SELECT body FROM topic_speech_inputs WHERE id=?'),speechPut=store.db.prepare('INSERT OR REPLACE INTO topic_speech_inputs VALUES (?,?)');
 const stageSpeech=node=>{
  node.source=normalizeSource(node.source);const row=speechGet.get(node.id);
  if(row){
   const old=JSON.parse(row.body),before=Date.parse(old.source?.fetchedAt)||0,after=Date.parse(node.source?.fetchedAt)||0;
   if(before>after)return;
   if(before===after&&(old.conflicted||JSON.stringify([...(old.parentIds||[])].sort())!==JSON.stringify([...(node.parentIds||[])].sort())))node={...node,conflicted:true,parentIds:[]};
  }
  speechPut.run(node.id,JSON.stringify(node));
 };


 const add=input=>{const o={...input,source:normalizeSource(input.source)},w=compact(o.work);if(o.projection!=='embedded-event')stageStoryInput(store,o.work,o.source,{rank:o.projection==='raw'?3:2});if(w.source)w.source=normalizeSource(w.source);if(w.outside?.source)w.outside.source=normalizeSource(w.outside.source);const id=w.identifier||w.activity_id||w.id;if(!id)return;const k=o.projection+'|'+id,old=observations.get(k);if(old&&o.source?.fetchedAt===old.source?.fetchedAt&&JSON.stringify(w)!==JSON.stringify(old.work)){if(!observations.has(k+'|conflict'))observations.set(k+'|conflict',{...o,work:w});}else if(!old||String(o.source?.fetchedAt)>String(old.source?.fetchedAt))observations.set(k,{...o,work:w});};
 let seen=0;
 for(const row of store.db.prepare("SELECT key,kind,body,fetched_at FROM sources WHERE generation=? AND kind IN ('document','procedure','outside-agenda')").iterate(generation)){
 const w=readWork(row.body);add({work:w,source:w.source||{url:'https://data.europarl.europa.eu/api/v2'+row.key,fetchedAt:row.fetched_at},projection:row.kind});if(++seen%200===0){store.renew();await new Promise(setImmediate);}
 }
 onProgress('sources');
 if(cache)for(const file of await readdir(cache).catch(()=>[]))if(/^[a-f0-9]{64}\.json$/.test(file)){
 const name=path.join(cache,file);if((await stat(name)).size>12*1024*1024)continue;
 for await(const {json,source} of topicCachedWorks(name)){
  const w=readWork(json);
  const observation={work:w,source:{...source,fetchedAt:sourceDate(source.fetchedAt)},projection:'raw'};
  if(/\/(?:PLENARY_DEBATE_SPEECH|PLENARY_DEBATE_WRITTEN_STATEMENT)$/.test(w.had_activity_type||'')){for(const n of topicObservationNodes([observation]))if(n.kind==='speech')stageSpeech(n);}else add(observation);
 }

 if(++seen%100===0)store.renew();
 }
 onProgress('cache');
 for(const observation of storyTopicObservations(store))add(observation);
 for(const row of store.db.prepare('SELECT * FROM topic_procedure_metadata').iterate())add({work:JSON.parse(row.body),source:{url:row.url,fetchedAt:row.fetched_at},projection:'procedure'});
 if(!store.renew())throw Error('Activity-index writer lease was lost.');
 const byId=await topicBatches(store,topicObservationSteps(observations.values(),{map:disk,stream:true}));observations.clear();
 // Questions are indexed activity items, including questions whose document
 // metadata has not been retained. The item rows supply all exact author IDs.
 let questionRows=0;
 for(const row of store.db.prepare("SELECT source_key,source_id,mep,date,body FROM items WHERE generation=? AND category IN ('written-questions','oral-questions') ORDER BY source_id,mep,category").iterate(generation)){
  const item=JSON.parse(row.body),old=byId.get(row.source_id),fromItems=old?.questionItems;
  const source=item.provenance?.apiUrl?{url:item.provenance.apiUrl,fetchedAt:item.provenance.sourceFetchedAt}:item.source;
  const node=fromItems?old:{...old,id:row.source_id,kind:'question',reference:old?.reference||item.reference||row.source_id,date:row.date,titles:{...old?.titles,...item.titles},members:[],procedureIds:[...new Set([...(old?.procedureIds||[]),...(item.procedureIds||[])])],questionItems:true,source:old?.source||source,titleSource:item.titles?.en?source:old?.source||source};
  if(!node.members.includes(String(row.mep)))node.members.push(String(row.mep));
  byId.set(node.id,node);
  if(++questionRows%100===0){store.renew();await new Promise(setImmediate);}
 }
 for(const n of byId.values())if(n.kind==='question'&&!n.questionItems)byId.delete(n.id);
 const nodes={[Symbol.iterator]:()=>byId.values()};onProgress('nodes');
 if(cache)for(const file of await readdir(path.join(cache,'eurovoc-catalog-v1')).catch(()=>[]))if(file.endsWith('.json')){
 const r=JSON.parse(await readFile(path.join(cache,'eurovoc-catalog-v1',file),'utf8')),v=r.value;if(v?.state!=='mapped')continue;
 for(const c of v.concepts||[]){const identity=conceptIdentity(c.id);if(!identity)continue;const old=concepts.get(identity.key)||{...identity,labels:{}};old.labels[c.language||'en']=c.label;concepts.set(identity.key,old);}
 const node=byId.get(v.id);if(!node||node.reference!==v.reference)continue;const existing=procedureTopics.get(v.id)||{reference:v.reference,assignments:[]};
 for(const c of v.concepts||[]){const identity=conceptIdentity(c.id);if(!identity)continue;existing.assignments.push({concept:concepts.get(identity.key),basis:'initiating-act',steps:[{from:v.id,field:'initiating act',to:v.work},{from:v.work,field:'work_is_about_concept_eurovoc',to:c.id}],sources:[v.source]});}procedureTopics.set(v.id,existing);
 }
 if(cache)for(const file of await readdir(path.join(cache,'official-context-v1')).catch(()=>[]))if(file.endsWith('.json')){
 const raw=JSON.parse(await readFile(path.join(cache,'official-context-v1',file),'utf8')),v=raw.value;if(!v?.html||!v.url?.includes('/procedure-file?'))continue;
 const url=new URL(v.url),reference=url.searchParams.get('reference');if(!reference)continue;let p;try{p=parseProcedurePage(v.html,reference,url.pathname.includes('/fr/')?'fr':'en');}catch{continue;}
 const id=reference.slice(0,9).replace('/','-')+(reference.match(/^\d{4}\/\d{4}([A-Z])/)?.[1]||'');const node=byId.get(id);if(!node||node.reference!==reference)continue;
 const existing=procedureTopics.get(id)||{reference,assignments:[]};existing.oeilRead=true;
 for(const subject of p.subjects){const key='oeil:'+subject.code,c=concepts.get(key)||{key,scheme:'oeil',uri:v.url+'#subject-'+subject.code,labels:{},source:{url:v.url,fetchedAt:v.fetchedAt}};c.labels[p.language]=subject.label;concepts.set(key,c);if(!existing.assignments.some(a=>a.concept.key===key))existing.assignments.push({concept:c,basis:'direct',steps:[{from:id,field:'OEIL subject',to:subject.code}],sources:[{url:v.url,fetchedAt:v.fetchedAt}]});}procedureTopics.set(id,existing);
 }
 // Persist collector's retained pages independently of its bounded HTTP cache.
 for(const row of store.db.prepare('SELECT id,reference,body FROM topic_procedure_pages').iterate()){
 const node=byId.get(row.id);if(!node||node.reference!==row.reference)continue;const p=JSON.parse(row.body),existing=procedureTopics.get(row.id)||{reference:row.reference,assignments:[]};if(p.state==='unavailable'){existing.oeilUnavailable=p.reason;procedureTopics.set(row.id,existing);continue;}existing.oeilRead=true;
 for(const s of p.subjects){const key='oeil:'+s.code,c={key,scheme:'oeil',role:'topic',uri:p.url+'#subject-'+s.code,labels:{[p.language]:s.label},source:p.source};concepts.set(key,c);if(!existing.assignments.some(a=>a.concept.key===key))existing.assignments.push({concept:c,basis:'direct',steps:[{from:row.id,field:'OEIL subject',to:s.code}],sources:[p.source]});}procedureTopics.set(row.id,existing);
 }
 const referenced=new Set();for(const n of nodes)if((!n.date||n.date>='2024-07-16')&&(n.kind!=='question'||n.id.startsWith('O-')))for(const id of [...(n.procedureIds||[]),...(n.procedureEdges||[]).map(e=>e.id)])referenced.add(id);
 if(!store.renew())throw Error('Activity-index writer lease was lost.');
 const projection=await topicBatches(store,projectTopicSteps(nodes,{concepts,procedureTopics,map:disk,stream:true}));
 onProgress('assignments');
 const pendingProcedures=new Set([...referenced].filter(id=>!procedureTopics.get(id)?.oeilRead&&!procedureTopics.get(id)?.oeilUnavailable));
 const unavailableProcedures=new Set([...referenced].filter(id=>procedureTopics.get(id)?.oeilUnavailable));
 const projected=projection.records;
 await topicBatches(store,(function*(){
  for(const r of projected.values()){yield;if(!(r.kind==='question'&&!r.id.startsWith('O-'))&&(r.procedureIds||[]).some(id=>pendingProcedures.has(id))){r.status='pending';projected.set(r.id,r);}else if(!(r.kind==='question'&&!r.id.startsWith('O-'))&&(r.procedureIds||[]).some(id=>unavailableProcedures.has(id))){r.status='unavailable';projected.set(r.id,r);}}
  for(let pass=0;pass<4;pass++)for(const n of nodes){yield;const r=projected.get(n.id);if(!r||r.status==='ambiguous'||(n.kind==='question'&&!n.id.startsWith('O-')))continue;const states=[...(n.documentIds||[]),...(n.executed||[]),...(n.procedureIds||[]),...(n.procedureEdges||[]).map(e=>e.id),...(n.kind==='question'&&n.id.startsWith('O-')?r.eventIds||[]:[])].map(id=>projected.get(id)?.status),status=r.status==='pending'||states.includes('pending')?'pending':r.status==='unavailable'||states.includes('unavailable')?'unavailable':null;if(status&&r.status!==status){r.status=status;projected.set(r.id,r);}}
 })());

 if(!store.renew())throw Error('Activity-index writer lease was lost.');store.assertWriter();store.set('recordTopicProjection',null);

 for(const table of ['record_topic_records','record_topic_memberships','record_topic_concepts','record_topic_totals','record_topic_groups','record_topic_group_summary','record_topic_question_places','record_topic_author_countries','record_topic_filtered_totals','record_topic_filtered_groups']){let changes;do{store.transaction(()=>{store.assertWriter();changes=store.db.prepare('DELETE FROM '+table+' WHERE rowid IN (SELECT rowid FROM '+table+' WHERE generation=? LIMIT 500)').run(generation).changes;});if(!store.renew())throw Error('Activity-index writer lease was lost.');await new Promise(setImmediate);}while(changes); }
 for(const eventPass of [true,false]){let batch=[];for(const r of projected.values()){if((r.kind==='event')!==eventPass)continue;batch.push(r);if(batch.length===10){store.transaction(()=>{store.assertWriter();putTopicRecords(store,generation,batch);});batch=[];store.renew();await new Promise(setImmediate);}}if(batch.length)store.transaction(()=>{store.assertWriter();putTopicRecords(store,generation,batch);});}
 onProgress('records');
 // Speeches dominate source volume. Stream them; never retain the whole speech catalogue.

 const parents={get:id=>{const r=projected.get(id);return r?.kind==='event'?r:null;}};
 const speechRows=store.db.prepare("SELECT key,body,fetched_at FROM sources WHERE generation=? AND kind IN ('speech','outside-speech') ORDER BY key");
 let pendingSpeeches=[];
 for(const row of speechRows.iterate(generation)){
  const w=readWork(row.body);stageStoryInput(store,w,w.outside?.source||{url:'https://data.europarl.europa.eu/api/v2'+row.key,fetchedAt:sourceDate(row.fetched_at)},{rank:2});pendingSpeeches.push(...topicObservationNodes([{work:w,source:{url:'https://data.europarl.europa.eu/api/v2'+row.key,fetchedAt:sourceDate(row.fetched_at)},projection:w.outside?'outside-speech':'speech'}]).filter(n=>n.kind==='speech'));
  if(pendingSpeeches.length>=25){store.transaction(()=>{store.assertWriter();for(const n of pendingSpeeches)stageSpeech(n);});pendingSpeeches=[];store.renew();await new Promise(setImmediate);}
 }
 if(pendingSpeeches.length)store.transaction(()=>{store.assertWriter();for(const n of pendingSpeeches)stageSpeech(n);});
 let batch=[];
 for(const row of store.db.prepare('SELECT body FROM topic_speech_inputs ORDER BY id').iterate()){
  const n=JSON.parse(row.body),p=projectRecordTopics([n]).records[0];if(!p)continue;const parent=!n.conflicted&&n.parentIds?.length===1?parents.get(n.parentIds[0]):null;
  if(parent){p.assignments=parent.assignments.map(a=>({...a,paths:a.paths.map(path=>({...path,basis:'debate',steps:[{from:p.id,field:'inverse_consists_of',to:parent.id},...path.steps]}))}));p.status=parent.status;}
  batch.push(p);if(batch.length>=10){store.transaction(()=>{store.assertWriter();putTopicRecords(store,generation,batch);});batch=[];store.renew();await new Promise(setImmediate);}
 }
 if(batch.length)store.transaction(()=>{store.assertWriter();putTopicRecords(store,generation,batch);});
 store.db.exec('DROP TABLE temp.topic_speech_inputs');

 store.transaction(()=>{store.assertWriter();for(const row of store.db.prepare('SELECT id FROM topic_procedure_queue').iterate())if(!referenced.has(row.id))store.db.prepare('DELETE FROM topic_procedure_queue WHERE id=?').run(row.id);for(const id of referenced){const n=byId.get(id);store.db.prepare('INSERT INTO topic_procedure_queue(id,reference,next_read) VALUES (?,?,0) ON CONFLICT(id) DO UPDATE SET reference=COALESCE(excluded.reference,reference),next_read=CASE WHEN excluded.reference IS NOT NULL AND reference IS NOT excluded.reference THEN 0 ELSE next_read END').run(id,n?.reference||null);}});

 const coverage={referenced:referenced.size,withSubjects:[...referenced].filter(id=>procedureTopics.get(id)?.assignments.some(a=>a.concept.key.startsWith('oeil:'))).length,read:[...referenced].filter(id=>procedureTopics.get(id)?.oeilRead).length,unavailable:[...referenced].filter(id=>procedureTopics.get(id)?.oeilUnavailable).length};
 store.set('recordTopicCoverage',{generation,...coverage});
 onProgress('speeches');
 await buildStoryFacts(store,generation,{concepts,onProgress});
 const questionCountries=await questionCountryMetadata(store,generation,cache);
 finishTopicProjection(store,generation,concepts.values(),{questionCountries});onProgress('totals');
 const previous=store.get('previous')||generation;
 for(const table of ['record_topic_records','record_topic_memberships','record_topic_concepts','record_topic_totals','record_topic_groups','record_topic_group_summary','record_topic_question_places','record_topic_author_countries','record_topic_filtered_totals','record_topic_filtered_groups','story_facts','story_links','story_places','story_topics','story_parents']){const lo=Math.min(generation,previous),hi=Math.max(generation,previous);let n;do{store.transaction(()=>{store.assertWriter();n=store.db.prepare('DELETE FROM '+table+' WHERE rowid IN (SELECT rowid FROM '+table+' WHERE generation<? OR generation>? OR (generation>? AND generation<?) LIMIT 500)').run(lo,hi,lo,hi).changes;});if(!store.renew())throw Error('Activity-index writer lease was lost.');await new Promise(setImmediate);}while(n);}
 return {version:RECORD_TOPICS_VERSION,generation,coverage};
 }finally{clearInterval(heartbeat);store.db.exec('PRAGMA cache_size='+Number(previousCacheSize));}
}
export function topicCollectorTables(db){db.exec(`CREATE TABLE IF NOT EXISTS topic_procedure_queue(id TEXT PRIMARY KEY,reference TEXT,next_read INTEGER);CREATE INDEX IF NOT EXISTS topic_procedure_due ON topic_procedure_queue(next_read,id);CREATE TABLE IF NOT EXISTS topic_procedure_metadata(id TEXT PRIMARY KEY,body TEXT,url TEXT,fetched_at TEXT);CREATE TABLE IF NOT EXISTS topic_procedure_pages(id TEXT PRIMARY KEY,reference TEXT,body TEXT);`);}
