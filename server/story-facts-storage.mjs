import {storyDocument,storyAgenda,storyDecision,array,tail,refs,sourceTime} from './story-facts-model.mjs';
export function storyTables(db){db.exec(`
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
 CREATE TABLE IF NOT EXISTS story_parents(generation INTEGER,parent TEXT,speech TEXT,PRIMARY KEY(generation,parent,speech));
 CREATE INDEX IF NOT EXISTS story_parent_speech ON story_parents(generation,speech,parent);
 `);}
const statements=new WeakMap();
function prepared(db){let p=statements.get(db);if(!p){p={queue:db.prepare('INSERT OR IGNORE INTO story_jobs(key,kind,id,state,next_read,error) VALUES (?,?,?,?,?,?)'),input:db.prepare('SELECT body,source FROM story_inputs WHERE kind=? AND id=?'),get:db.prepare('SELECT body,fetched_at,rank FROM story_inputs WHERE kind=? AND id=?'),put:db.prepare('INSERT OR REPLACE INTO story_inputs VALUES (?,?,?,?,?,?)')};statements.set(db,p);}return p;}
export function stageStoryInput(store,w,source,{rank=1}={}){
 source={...source,fetchedAt:sourceTime(source?.fetchedAt)};let kind,value;
 if(w.outside){const o=w.outside;if(!o.id)return;kind='speech';value={id:o.id,date:o.date,titles:o.titles||{},parentIds:o.parentIds||[],creIds:o.parentDocumentIds||[],creId:o.parentDocumentId||null,headers:array(o.headers).map(h=>({personId:String(h.personId),capacity:h.capacity||null,role:h.role||null})),source:o.source||source};}
 else if(w.work_type){kind='document';value=storyDocument(w,source);}
 else {const id=w.activity_id||tail(w.id);if(!id)return;
  if(id.includes('OJ-ITM-')){kind='agenda';value=storyAgenda(w,source);}
  else if(/-DEC-/.test(id)){kind='decision';value=storyDecision(w,source);}
  else if(/-VOT-ITM-/.test(id)){kind='result';value={id,decisions:refs(w.consists_of),executed:refs(w.executed),basedOn:refs(w.based_on_a_realization_of),source};}
  else if(/-PVCRE-ITM-/.test(id)){kind='event';value={id,executed:refs(w.executed),executedKnown:Object.hasOwn(w,'executed'),titles:w.activity_label||{},date:w.activity_date||null,relationships:Object.fromEntries(['executed','based_on_a_realization_of','inverse_consists_of','inverse_was_scheduled_in'].filter(f=>Object.hasOwn(w,f)).map(f=>[f,w[f]])),source};}
 }
 if(!value)return;source=value.source||source;const p=prepared(store.db),old=p.get.get(kind,value.id),at=sourceTime(source.fetchedAt)||'';
 if(old&&(old.fetched_at>at||old.fetched_at===at&&old.rank>rank))return;
 const body=JSON.stringify({...value,source:undefined});
 if(old&&old.fetched_at===at&&old.rank===rank&&old.body!==body){value={...value,conflicted:true};}
 p.put.run(kind,value.id,JSON.stringify({...value,source:undefined}),JSON.stringify(source),at,rank);
}
export function storyInput(store,kind,id){const row=prepared(store.db).input.get(kind,id);return row?{...JSON.parse(row.body),source:JSON.parse(row.source)}:null;}
export function queueStoryRead(store,kind,id,{unavailable=false}={}){
 const key=kind+':'+id;
 prepared(store.db).queue.run(key,kind,id,unavailable?'unavailable':'pending',unavailable?null:0,unavailable?'not-served-before-2024-12-16':null);
}
export function* storyTopicObservations(store){
 for(const row of store.db.prepare("SELECT kind,id,body,source FROM story_inputs WHERE kind IN ('agenda','event') ORDER BY kind,id").iterate()){
  const v=JSON.parse(row.body);if(v.conflicted)continue;
  yield {work:{activity_id:v.id,activity_date:v.date||undefined,activity_label:v.titles||{},...(v.type?{had_activity_type:'def/ep-activities/'+v.type}:{}),...(v.relationships||{})},source:JSON.parse(row.source),projection:'embedded-event'};
 }
}
