import {gunzipSync} from 'node:zlib';
import {SNAPSHOT_MAX_BYTES} from './sitting-snapshot-store.mjs';
import {storyDocument,storyAgenda,storyDecision,array,tail,refs,sourceTime} from './story-facts-model.mjs';
export function storyTables(db){db.exec(`
 CREATE TABLE IF NOT EXISTS outside_role_speech_reads(speech TEXT PRIMARY KEY,date TEXT,next_read INTEGER,attempts INTEGER DEFAULT 0,body TEXT);
 CREATE TABLE IF NOT EXISTS story_inputs(kind TEXT,id TEXT,body TEXT,source TEXT,fetched_at TEXT,rank INTEGER,PRIMARY KEY(kind,id));
 CREATE TABLE IF NOT EXISTS story_jobs(key TEXT PRIMARY KEY,kind TEXT,id TEXT,offset INTEGER DEFAULT 0,state TEXT DEFAULT 'pending',next_read INTEGER DEFAULT 0,attempts INTEGER DEFAULT 0,signature TEXT,error TEXT);
 CREATE INDEX IF NOT EXISTS story_job_due ON story_jobs(state,next_read,key);
 CREATE TABLE IF NOT EXISTS story_facts(generation INTEGER,kind TEXT,id TEXT,date TEXT,body TEXT,PRIMARY KEY(generation,kind,id));
 CREATE INDEX IF NOT EXISTS story_outcome_date ON story_facts(generation,kind,json_extract(body,'$.outcome.date'),id);
 CREATE INDEX IF NOT EXISTS story_fact_date ON story_facts(generation,kind,date,id);
 CREATE TABLE IF NOT EXISTS story_links(generation INTEGER,relation TEXT,from_id TEXT,to_id TEXT,PRIMARY KEY(generation,relation,from_id,to_id));
 CREATE INDEX IF NOT EXISTS story_link_reverse ON story_links(generation,relation,to_id,from_id);
 CREATE TABLE IF NOT EXISTS story_places(generation INTEGER,place TEXT,kind TEXT,id TEXT,date TEXT,basis TEXT,PRIMARY KEY(generation,place,kind,id));
 CREATE INDEX IF NOT EXISTS story_place_record ON story_places(generation,kind,id,place);
 CREATE TABLE IF NOT EXISTS story_topics(generation INTEGER,key TEXT,kind TEXT,id TEXT,date TEXT,PRIMARY KEY(generation,key,kind,id));
 CREATE TABLE IF NOT EXISTS story_event_types(id TEXT PRIMARY KEY,type TEXT,fetched_at TEXT,conflicted INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS story_parents(generation INTEGER,parent TEXT,speech TEXT,PRIMARY KEY(generation,parent,speech));
 CREATE INDEX IF NOT EXISTS story_parent_speech ON story_parents(generation,speech,parent);
 `);}
// Fields whose values depend on the parser revision (STORY_DOCUMENT_PARSER).
const PARSER_DERIVED={document:['groups']};
const statements=new WeakMap();
function prepared(db){let p=statements.get(db);if(!p){p={queue:db.prepare('INSERT OR IGNORE INTO story_jobs(key,kind,id,state,next_read,error) VALUES (?,?,?,?,?,?)'),input:db.prepare('SELECT body,source FROM story_inputs WHERE kind=? AND id=?'),get:db.prepare('SELECT body,source,fetched_at,rank FROM story_inputs WHERE kind=? AND id=?'),put:db.prepare('INSERT OR REPLACE INTO story_inputs VALUES (?,?,?,?,?,?)')};statements.set(db,p);}return p;}
export function stageStoryInput(store,w,source,{rank=1}={}){
 source={...source,fetchedAt:sourceTime(source?.fetchedAt)};let kind,value;
 // Verbatim items embedded as consists_of children of a retained parent carry their own type.
 for(const child of array(w?.consists_of))if(child&&typeof child==='object'&&child.had_activity_type){const cid=child.activity_id||tail(child.id);if(/-PVCRE-ITM-/.test(cid))recordEventType(store,cid,tail(child.had_activity_type),sourceTime(source.fetchedAt)||'');}
 if(w.outside){const o=w.outside;if(!o.id)return;kind='speech';value={id:o.id,date:o.date,titles:o.titles||{},parentIds:o.parentIds||[],creIds:o.parentDocumentIds||[],creId:o.parentDocumentId||null,headers:array(o.headers).map(h=>({personId:String(h.personId),capacity:h.capacity||null,role:h.role||null})),source:o.source||source};}
 else if(w.work_type){kind='document';value=storyDocument(w,source);}
 else {const id=w.activity_id||tail(w.id);if(!id)return;
  if(id.includes('OJ-ITM-')){kind='agenda';value=storyAgenda(w,source);}
  else if(/-DEC-/.test(id)){kind='decision';value=storyDecision(w,source);}
  else if(/-VOT-ITM-/.test(id)){kind='result';value={id,date:w.activity_date||null,type:tail(w.had_activity_type)||'PLENARY_VOTE_RESULTS',decisions:refs(w.consists_of),executed:refs(w.executed),basedOn:refs(w.based_on_a_realization_of),relationships:Object.fromEntries(['executed','based_on_a_realization_of'].filter(f=>Object.hasOwn(w,f)).map(f=>[f,w[f]])),source};}
  else if(/-PVCRE-ITM-/.test(id)){kind='event';
   // Retained outside-agenda records keep had_activity_type as their exact `kind`.
   const typed=Object.hasOwn(w,'had_activity_type')?tail(w.had_activity_type)||null:typeof w.kind==='string'&&/^[A-Z_]+$/.test(w.kind)?w.kind:undefined;
   if(typed)recordEventType(store,id,typed,sourceTime((w.outside?.source||source)?.fetchedAt)||'');
   value={id,...(typed!==undefined?{type:typed}:{type:null}),executed:refs(w.executed),executedKnown:Object.hasOwn(w,'executed'),titles:w.activity_label||{},date:w.activity_date||null,relationships:Object.fromEntries(['executed','based_on_a_realization_of','inverse_consists_of','inverse_was_scheduled_in'].filter(f=>Object.hasOwn(w,f)).map(f=>[f,w[f]])),source};}
 }
 if(!value)return;source=value.source||source;const p=prepared(store.db),old=p.get.get(kind,value.id),at=sourceTime(source.fetchedAt)||'';
 // The same observation may fill a field that an older stored shape lacked (event type) without a conflict.
 if(old&&kind==='event'&&old.fetched_at===at&&old.rank>rank&&value.type){const prior=JSON.parse(old.body);
  if(!Object.hasOwn(prior,'type')&&!prior.conflicted&&Object.entries(prior).every(([k,v])=>JSON.stringify(v)===JSON.stringify(value[k]))){p.put.run(kind,value.id,JSON.stringify({...prior,type:value.type}),old.source,old.fetched_at,old.rank);return true;}}
 if(old&&(old.fetched_at>at||old.fetched_at===at&&old.rank>rank))return;
 // New projection fields may enrich an older retained shape at the same
 // source timestamp. Compare its known fields; preserve actual conflicts.
 // A newer parser revision may change only its own derived fields when it re-parses the
 // same retained source; any other difference, or an earlier conflict, still conflicts.
 if(old&&old.fetched_at===at&&old.rank===rank){const prior=JSON.parse(old.body),derived=(prior.parser??0)!==(value.parser??0)?PARSER_DERIVED[kind]||[]:[];
  // An event's type disagreement is recorded only in story_event_types: the input keeps its undisputed
  // date, title and relationships, and holds no type of its own.
  const ignored=kind==='event'?['type']:[];
  if(kind==='event'&&Object.hasOwn(prior,'type')&&prior.type!==value.type)value={...value,type:null};
  if(prior.conflicted||Object.entries(prior).some(([key,v])=>key!=='conflicted'&&key!=='parser'&&!derived.includes(key)&&!ignored.includes(key)&&JSON.stringify(v)!==JSON.stringify(value[key])))value={...value,conflicted:true};}
 const saved=JSON.stringify({...value,source:undefined}),encodedSource=JSON.stringify(source);
 if(old&&old.fetched_at===at&&old.rank===rank&&old.body===saved&&old.source===encodedSource)return;
 p.put.run(kind,value.id,saved,encodedSource,at,rank);return !old||old.body!==saved;
}
// Every retained observation of an event's type, from any source; same-time disagreement is a conflict.
function recordEventType(store,id,type,at){const db=store.db,old=db.prepare('SELECT type,fetched_at,conflicted FROM story_event_types WHERE id=?').get(id);
 if(!old||old.fetched_at<at)db.prepare('INSERT OR REPLACE INTO story_event_types VALUES (?,?,?,0)').run(id,type,at);
 else if(old.fetched_at===at&&old.type!==type&&!old.conflicted)db.prepare('UPDATE story_event_types SET conflicted=1 WHERE id=?').run(id);}
export function storyEventType(store,id){return store.db.prepare('SELECT type,conflicted FROM story_event_types WHERE id=?').get(id)||null;}
export function storyInput(store,kind,id){const row=prepared(store.db).input.get(kind,id);return row?{...JSON.parse(row.body),source:JSON.parse(row.source)}:null;}
export function queueStoryRead(store,kind,id,{unavailable=false,refresh=false}={}){
 const key=kind+':'+id;
 // A completed read whose retained input lacks a field added later is read once more.
 if(refresh){store.db.exec('CREATE TABLE IF NOT EXISTS story_seen_pages(job TEXT,signature TEXT,PRIMARY KEY(job,signature))');if(store.db.prepare("UPDATE story_jobs SET state='pending',next_read=0,attempts=0,error=NULL WHERE key=? AND state='available'").run(key).changes)store.db.prepare('DELETE FROM story_seen_pages WHERE job=?').run(key);}
 prepared(store.db).queue.run(key,kind,id,unavailable?'unavailable':'pending',unavailable?null:0,unavailable?'not-served-before-2024-12-16':null);
}
export function* storyTopicObservations(store){
 for(const row of store.db.prepare("SELECT kind,id,body,source FROM story_inputs WHERE kind IN ('agenda','event','result') ORDER BY kind,id").iterate()){
  const v=JSON.parse(row.body);if(v.conflicted)continue;
  yield {work:{activity_id:v.id,activity_date:v.date||undefined,activity_label:v.titles||{},...(v.type||row.kind==='result'?{had_activity_type:'def/ep-activities/'+(v.type||'PLENARY_VOTE_RESULTS')}:{}),...(v.relationships||(row.kind==='result'?{executed:v.executed,based_on_a_realization_of:v.basedOn}:{}))},source:JSON.parse(row.source),projection:'embedded-event'};
 }
}

// A held debate snapshot is the exact /events/{id} response. Story event jobs adopt complete,
// error-free snapshots for the same ID at the snapshot's own fetch time and the collector's rank,
// through the normal staging path: pending jobs settle without a network read, and settled jobs
// follow a newer held snapshot. Refresh intent stays with the debate collector. Each batch commits
// on its own under the writer lease.
export function adoptHeldEventSnapshots(store,{ids=null}={}){
 const db=store.db;if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='sitting_snapshots'").get())return {adopted:0,changed:false};
 const wanted=ids??db.prepare("SELECT id FROM story_jobs WHERE kind='event'").all().map(r=>r.id);
 const select=db.prepare("SELECT id,body FROM sitting_snapshots WHERE kind='debate' AND version=1 AND complete=1 AND error IS NULL AND id IN (SELECT value FROM json_each(?))");
 const input=db.prepare("SELECT fetched_at FROM story_inputs WHERE kind='event' AND id=?");
 const settle=db.prepare("UPDATE story_jobs SET attempts=0,state='available',next_read=NULL,error=NULL WHERE key=? AND state IN ('pending','unavailable')");
 let adopted=0,changed=false;
 for(let i=0;i<wanted.length;i+=200){const batch=wanted.slice(i,i+200);
  store.transaction(()=>{store.assertWriter();
   for(const row of select.all(JSON.stringify(batch))){let saved;try{saved=JSON.parse(gunzipSync(row.body,{maxOutputLength:SNAPSHOT_MAX_BYTES}).toString('utf8'));}catch{continue;}
    // Same identity check as a network read: exactly one root record, for this item.
    const data=saved?.payload?.data;if(!Array.isArray(data)||data.length!==1||(data[0]?.activity_id||tail(data[0]?.id))!==row.id||!saved.url||!saved.fetchedAt)continue;
    const at=sourceTime(saved.fetchedAt)||'',held=input.get(row.id);
    if(!held||held.fetched_at<=at)changed=Boolean(stageStoryInput(store,data[0],{url:saved.url,fetchedAt:saved.fetchedAt},{rank:4}))||changed;
    if(settle.run('event:'+row.id).changes)adopted++;}
   // The dirty marker commits with the batch that changed inputs or settled jobs.
   if(changed||adopted)store.set('topicProjectionDirty',true);
  });
  store.renew?.();
 }
 return {adopted,changed:changed||adopted>0};
}
