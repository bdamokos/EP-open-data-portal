import {countryLabelSourceFor} from './country-label-source.mjs';
import {SNAPSHOT_MAX_BYTES} from './sitting-snapshot-store.mjs';
import {gunzipSync} from 'node:zlib';
import {voteActivity} from './story-facts-model.mjs';
import {storyEventType} from './story-facts-storage.mjs';
import countryNames from './topic-country-labels.json' with {type:'json'};
const countryLabelSource=countryLabelSourceFor(countryNames);
import {conceptLabel} from './oeil-labels.mjs';
import {readableRecordTopicState} from './topic-projection-state.mjs';
import {topicBatches} from './topic-disk-map.mjs';
import {questionPlaceTables,writeQuestionPlaceAskers,questionPlaceAskerSteps} from './question-place-askers.mjs';
import {orderRecordKeywords} from './topic-keyword-order.mjs';
import {countryIdentity} from './topic-country-identity.mjs';
import {languagePreference} from './language-order.mjs';
import {HttpError} from './http-utils.mjs';
import {RECORD_TOPICS_VERSION,validTopicKey} from './record-topics.mjs';
export const TOPICS_VERSION=25;
export const topicKinds=['debate','document','question','speech','vote'];
export const quarter=date=>date.slice(0,4)+'-Q'+Math.ceil(Number(date.slice(5,7))/3);
export function topicPeriods(now=Date.now()){
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),end=quarter(day),out=[];
 for(let y=2024;y<=Number(day.slice(0,4));y++)for(let q=1;q<=4;q++){const p=y+'-Q'+q;if(p>='2024-Q3'&&p<=end)out.push(p);}return out;
}
export function topicTables(db){questionPlaceTables(db);db.exec(`
 CREATE TABLE IF NOT EXISTS record_topic_records(generation INTEGER,id TEXT,kind TEXT,date TEXT,group_key TEXT,group_kind TEXT,body TEXT,PRIMARY KEY(generation,id));
 CREATE INDEX IF NOT EXISTS topic_record_kind_date ON record_topic_records(generation,kind,date,id);
 CREATE INDEX IF NOT EXISTS topic_group ON record_topic_records(generation,group_key,date DESC,id);
 CREATE INDEX IF NOT EXISTS topic_record_status ON record_topic_records(generation,id,json_extract(body,'$.status'));
 CREATE TABLE IF NOT EXISTS record_topic_concepts(generation INTEGER,key TEXT,role TEXT,body TEXT,PRIMARY KEY(generation,key));
 CREATE TABLE IF NOT EXISTS record_topic_memberships(generation INTEGER,key TEXT,record_id TEXT,kind TEXT,date TEXT,group_key TEXT,PRIMARY KEY(generation,key,record_id));
 CREATE INDEX IF NOT EXISTS record_topic_record ON record_topic_memberships(generation,record_id,key);
 CREATE INDEX IF NOT EXISTS topic_selection ON record_topic_memberships(generation,key,date DESC,group_key,kind,record_id);
 CREATE TABLE IF NOT EXISTS record_topic_groups(generation INTEGER,key TEXT,period TEXT,group_key TEXT,date TEXT,n INTEGER,body TEXT,PRIMARY KEY(generation,key,period,group_key));
 CREATE INDEX IF NOT EXISTS topic_group_top ON record_topic_groups(generation,key,period,n DESC,date DESC,group_key);
 CREATE TABLE IF NOT EXISTS record_topic_group_summary(generation INTEGER,key TEXT,period TEXT,groups INTEGER,top TEXT,PRIMARY KEY(generation,key,period));
 CREATE TABLE IF NOT EXISTS record_topic_totals(generation INTEGER,key TEXT,period TEXT,kind TEXT,n INTEGER,PRIMARY KEY(generation,key,period,kind));
 `);}
const eventTypeEvidence=(store,id)=>{try{return storyEventType(store,id);}catch(error){if(/no such table/.test(error.message))return null;throw error;}};
// A verbatim item without held titles takes them from its retained debate snapshot (the /events
// record for that exact item ID), in every language it holds.
const snapshotStatements=new WeakMap(),itemId=/^MTG-PL-\d{4}-\d{2}-\d{2}-PVCRE-ITM-/;
// One query per write batch: complete, error-free debate snapshots for the batch's untitled items.
const snapshotTitles=(store,records)=>{const ids=records.filter(r=>itemId.test(r.id)&&!(r.titles&&Object.keys(r.titles).length)).map(r=>r.id),found=new Map();if(!ids.length)return found;
 let statement=snapshotStatements.get(store.db);
 if(statement===undefined){try{statement=store.db.prepare("SELECT id,body FROM sitting_snapshots WHERE kind='debate' AND version=1 AND complete=1 AND error IS NULL AND id IN (SELECT value FROM json_each(?))");}catch{statement=null;}snapshotStatements.set(store.db,statement);}
 if(!statement)return found;
 for(const row of statement.all(JSON.stringify(ids))){try{const saved=JSON.parse(gunzipSync(row.body,{maxOutputLength:SNAPSHOT_MAX_BYTES}).toString('utf8')),work=(saved?.payload?.data||[]).find(w=>(w.activity_id||String(w.id||'').split('/').at(-1))===row.id),t=work?.activity_label;if(t&&typeof t==='object'&&Object.keys(t).length)found.set(row.id,t);}catch{/* unreadable local evidence counts as absent */}}
 return found;};
const topicWriteStatements=new WeakMap();
export function putTopicRecords(store,generation,records){
 const db=store.db;let statements=topicWriteStatements.get(db);if(!statements){statements={removeRecord:db.prepare('DELETE FROM record_topic_records WHERE generation=? AND id=?'),remove:db.prepare('DELETE FROM record_topic_memberships WHERE generation=? AND record_id=?'),group:db.prepare('SELECT group_key FROM record_topic_records WHERE generation=? AND id=?'),put:db.prepare('INSERT OR REPLACE INTO record_topic_records VALUES (?,?,?,?,?,?,?)'),member:db.prepare('INSERT OR IGNORE INTO record_topic_memberships VALUES (?,?,?,?,?,?)')};topicWriteStatements.set(db,statements);}const {removeRecord,remove,group,put,member}=statements;
 // Proceeding markers (catch-the-eye starts/ends, notes) and chair announcements are not records anyone reads as debates.
 const heldSnapshots=snapshotTitles(store,records);
 for(const record of records){if(record.kind==='event'&&(/\/(?:PROCEEDING_ACTIVITY|MEETING_NAME_CHAIR)$/.test(record.activityType||'')||/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-/.test(record.id))){remove.run(generation,record.id);removeRecord.run(generation,record.id);continue;}
 // Same evidence as story debates: retained type observations first; conflicting evidence keeps a debate.
 const evidence=record.kind==='event'?eventTypeEvidence(store,record.id):null;
 const held=record.titles&&Object.keys(record.titles).length?record.titles:heldSnapshots.get(record.id)||null;
 const r={...record,titles:held||record.titles||{},kind:record.kind==='event'?!evidence?.conflicted&&voteActivity(evidence?evidence.type:record.activityType)?'vote':'debate':record.kind};
 const parents=r.kind==='speech'?r.parentIds?.filter(id=>!/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-/.test(id)):r.kind==='debate'?r.agendaIds:r.eventIds||[];
 const resolvedParents=[...new Set((parents||[]).map(id=>group.get(generation,id)?.group_key||id))];
 const parent=resolvedParents.length===1?resolvedParents[0]:null,procedure=r.procedureIds?.length===1?r.procedureIds[0]:null;
 const parentGroup=parent?group.get(generation,parent)?.group_key:null;
 r.groupKey=parentGroup||parent||((r.kind==='debate')?r.id:procedure)||r.id;r.groupKind=parent||r.kind==='debate'?'debate':procedure?'procedure':'record';
 remove.run(generation,r.id);
 put.run(generation,r.id,r.kind,r.date,r.groupKey,r.groupKind,JSON.stringify(r));
 for(const a of r.assignments)member.run(generation,a.key,r.id,r.kind,r.date,r.groupKey);
 }
}
export function finishTopicProjection(store,generation,concepts,{questionCountries}={}){
 const put=store.db.prepare('INSERT OR REPLACE INTO record_topic_concepts VALUES (?,?,?,?)');
 store.transaction(()=>{store.assertWriter();for(const c of concepts)put.run(generation,c.key,c.role,JSON.stringify(c));});
 writeQuestionPlaceAskers(store,generation,questionCountries);
 store.generationTransaction(()=>{store.assertWriter();store.db.prepare('DELETE FROM record_topic_totals WHERE generation=?').run(generation);store.db.prepare(`INSERT OR REPLACE INTO record_topic_totals SELECT generation,key,substr(date,1,4)||'-Q'||CAST((CAST(substr(date,6,2) AS INTEGER)+2)/3 AS INTEGER),kind,COUNT(*) FROM record_topic_memberships WHERE generation=? AND date>='2024-07-16' AND date<=? AND kind IN ('debate','document','question','speech','vote') GROUP BY key,3,kind`).run(generation,new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(store.clock?.()??Date.now()));const end=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(store.clock?.()??Date.now());
 store.db.prepare('DELETE FROM record_topic_groups WHERE generation=?').run(generation);store.db.prepare('DELETE FROM record_topic_group_summary WHERE generation=?').run(generation);
 store.db.prepare(`INSERT INTO record_topic_groups SELECT m.generation,m.key,substr(m.date,1,4)||'-Q'||CAST((CAST(substr(m.date,6,2) AS INTEGER)+2)/3 AS INTEGER),m.group_key,MAX(m.date),COUNT(*),NULL FROM record_topic_memberships m WHERE m.generation=? AND m.date BETWEEN '2024-07-16' AND ? AND m.kind IN ('debate','document','question','speech','vote') GROUP BY m.key,3,m.group_key`).run(generation,end);
 const groupSummarySql=`INSERT INTO record_topic_group_summary SELECT g.generation,g.key,g.period,COUNT(*),(SELECT json_object('key',t.group_key,'date',t.date,'procedural',EXISTS(SELECT 1 FROM record_topic_records r WHERE r.generation=t.generation AND r.id=t.group_key AND json_extract(r.body,'$.procedural') IS 1),'titles',json(COALESCE((SELECT NULLIF(json_extract(r.body,'$.titles'),'{}') FROM record_topic_records r WHERE r.generation=t.generation AND r.id=t.group_key),(SELECT json_extract(r.body,'$.titles') FROM record_topic_records r WHERE r.generation=t.generation AND r.group_key=t.group_key ORDER BY r.date DESC,r.id LIMIT 1),'{}'))) FROM record_topic_groups t WHERE t.generation=g.generation AND t.key=g.key AND t.period=g.period ORDER BY t.n DESC,t.date DESC,t.group_key LIMIT 1) FROM record_topic_groups g WHERE generation=? GROUP BY key,period`;store.db.prepare(groupSummarySql).run(generation);
 store.db.prepare(`INSERT INTO record_topic_group_summary SELECT generation,key,'',COUNT(DISTINCT group_key),NULL FROM record_topic_groups WHERE generation=? GROUP BY key`).run(generation);
 store.db.prepare('DELETE FROM record_topic_filtered_totals WHERE generation=?').run(generation);store.db.prepare('DELETE FROM record_topic_filtered_groups WHERE generation=?').run(generation);
 const askerFilter=" AND (m.kind<>'question' OR EXISTS (SELECT 1 FROM record_topic_question_places q WHERE q.generation=m.generation AND q.record_id=m.record_id AND q.askers IN (SELECT value FROM json_each(?)) AND (m.key NOT LIKE 'place:%' OR q.key=m.key)))";
 store.db.exec('DROP TABLE IF EXISTS temp.topic_filtered_group_counts;CREATE TEMP TABLE topic_filtered_group_counts(generation INTEGER,key TEXT,period TEXT,group_key TEXT,date TEXT,n INTEGER,body TEXT,PRIMARY KEY(generation,key,period,group_key));CREATE INDEX temp.topic_filtered_top ON topic_filtered_group_counts(generation,key,period,n DESC,date DESC,group_key)');
 for(const askers of ['home','elsewhere','not-home']){
  store.db.prepare(`INSERT INTO record_topic_filtered_totals SELECT m.generation,?,m.key,substr(m.date,1,4)||'-Q'||CAST((CAST(substr(m.date,6,2) AS INTEGER)+2)/3 AS INTEGER),m.kind,COUNT(*) FROM record_topic_memberships m WHERE m.generation=? AND m.date BETWEEN '2024-07-16' AND ? AND m.kind IN ('debate','document','question','speech','vote')`+askerFilter+' GROUP BY m.key,4,m.kind').run(askers,generation,end,JSON.stringify(askers==='not-home'?['elsewhere','unknown']:[askers]));
  store.db.exec('DELETE FROM temp.topic_filtered_group_counts');
  store.db.prepare(`INSERT INTO topic_filtered_group_counts SELECT m.generation,m.key,substr(m.date,1,4)||'-Q'||CAST((CAST(substr(m.date,6,2) AS INTEGER)+2)/3 AS INTEGER),m.group_key,MAX(m.date),COUNT(*),NULL FROM record_topic_memberships m WHERE m.generation=? AND m.date BETWEEN '2024-07-16' AND ? AND m.kind IN ('debate','document','question','speech','vote')`+askerFilter+' GROUP BY m.key,3,m.group_key').run(generation,end,JSON.stringify(askers==='not-home'?['elsewhere','unknown']:[askers]));
  store.db.prepare(groupSummarySql.replace('record_topic_group_summary SELECT g.generation','record_topic_filtered_groups SELECT g.generation,?').replaceAll('record_topic_groups','topic_filtered_group_counts')).run(askers,generation);
  store.db.prepare(`INSERT INTO record_topic_filtered_groups SELECT generation,?,key,'',COUNT(DISTINCT group_key),NULL FROM topic_filtered_group_counts WHERE generation=? GROUP BY key`).run(askers,generation);
 }
 store.db.exec('DROP TABLE temp.topic_filtered_group_counts');
 const periods=topicPeriods(store.clock?.()??Date.now()),periodTotals=Object.fromEntries(periods.map(p=>[p,counts()])),sittingDays=Object.fromEntries(periods.map(p=>[p,null]));
 for(const r of store.db.prepare(`SELECT substr(date,1,4)||'-Q'||CAST((CAST(substr(date,6,2) AS INTEGER)+2)/3 AS INTEGER) period,kind,COUNT(*) n FROM record_topic_records WHERE generation=? AND date BETWEEN '2024-07-16' AND ? AND kind IN ('debate','document','question','speech','vote') GROUP BY period,kind`).iterate(generation,end))if(periodTotals[r.period])periodTotals[r.period][r.kind]=r.n;
 for(const r of store.db.prepare(`SELECT substr(date,1,4)||'-Q'||CAST((CAST(substr(date,6,2) AS INTEGER)+2)/3 AS INTEGER) period,COUNT(DISTINCT substr(id,8,10)) n FROM record_topic_records WHERE generation=? AND date BETWEEN '2024-07-16' AND ? AND id LIKE 'MTG-PL-%' AND kind IN ('debate','vote') GROUP BY period`).iterate(generation,end))if(r.n)sittingDays[r.period]=r.n;
 const last=store.db.prepare("SELECT MAX(date) date FROM record_topic_records WHERE generation=? AND date<=? AND kind IN ('debate','document','question','speech','vote')").get(generation,end).date;
 store.set('recordTopicCalendar',{generation,periodTotals,sittingDays,end,partial:{first:'2024-07-16',last:last||null}});
 store.set('recordTopicProjection',{version:RECORD_TOPICS_VERSION,generation,askerSubsets:['all','home','elsewhere','not-home'],builtAt:new Date().toISOString()});});
}
export function writeTopicProjection(store,projection,generation=store.get('active')||store.get('working')?.generation){topicTables(store.db);store.transaction(()=>{store.assertWriter();store.set('recordTopicProjection',null);for(const t of ['record_topic_records','record_topic_concepts','record_topic_memberships','record_topic_totals'])store.db.prepare('DELETE FROM '+t+' WHERE generation=?').run(generation);putTopicRecords(store,generation,[...projection.records].sort((a,b)=>(a.kind==='event'?-1:1)-(b.kind==='event'?-1:1)));});finishTopicProjection(store,generation,projection.concepts);}
// Production finalization is stepped by topicBatches; each key uses covering
// membership indexes and commits before yielding to the writer event loop.
export async function finishTopicProjectionBatched(store,generation,concepts,options={}){
 return topicBatches(store,finishTopicSteps(store,generation,concepts,options),25);
}
function* finishTopicSteps(store,generation,concepts,{questionCountries}={}){
 const db=store.db,put=db.prepare('INSERT OR REPLACE INTO record_topic_concepts VALUES (?,?,?,?)');
 for(const c of concepts){yield;put.run(generation,c.key,c.role,JSON.stringify(c));}
 yield* questionPlaceAskerSteps(store,generation,questionCountries);
 for(const table of ['record_topic_totals','record_topic_groups','record_topic_group_summary','record_topic_filtered_totals','record_topic_filtered_groups']){let n;do{yield;n=db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE generation=? LIMIT 500)`).run(generation).changes;}while(n);}
 const end=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(store.clock()),periodSql="substr(m.date,1,4)||'-Q'||CAST((CAST(substr(m.date,6,2) AS INTEGER)+2)/3 AS INTEGER)",scope=" FROM record_topic_memberships m WHERE m.generation=? AND m.key=? AND m.date BETWEEN '2024-07-16' AND ? AND m.kind IN ('debate','document','question','speech','vote')";
 db.exec('DROP TABLE IF EXISTS temp.topic_filtered_group_counts;CREATE TEMP TABLE topic_filtered_group_counts(generation INTEGER,key TEXT,period TEXT,group_key TEXT,date TEXT,n INTEGER,body TEXT,PRIMARY KEY(generation,key,period,group_key));CREATE INDEX temp.topic_filtered_top ON topic_filtered_group_counts(generation,key,period,n DESC,date DESC,group_key)');
 const summary=(target,table,filtered)=>`INSERT INTO ${target} SELECT g.generation,${filtered?'?,':''}g.key,g.period,COUNT(*),(SELECT json_object('key',t.group_key,'date',t.date,'procedural',EXISTS(SELECT 1 FROM record_topic_records r WHERE r.generation=t.generation AND r.id=t.group_key AND json_extract(r.body,'$.procedural') IS 1),'titles',json(COALESCE((SELECT NULLIF(json_extract(r.body,'$.titles'),'{}') FROM record_topic_records r WHERE r.generation=t.generation AND r.id=t.group_key),(SELECT json_extract(r.body,'$.titles') FROM record_topic_records r WHERE r.generation=t.generation AND r.group_key=t.group_key ORDER BY r.date DESC,r.id LIMIT 1),'{}'))) FROM ${table} t WHERE t.generation=g.generation AND t.key=g.key AND t.period=g.period ORDER BY t.n DESC,t.date DESC,t.group_key LIMIT 1) FROM ${table} g WHERE generation=? AND key=? GROUP BY key,period`;
 for(const {key} of db.prepare('SELECT key FROM record_topic_concepts WHERE generation=? ORDER BY key').iterate(generation)){
  yield;db.prepare(`INSERT INTO record_topic_totals SELECT m.generation,m.key,${periodSql},m.kind,COUNT(*)${scope} GROUP BY 3,m.kind`).run(generation,key,end);
  for(const r of db.prepare(`SELECT m.generation,m.key,${periodSql} period,m.group_key,MAX(m.date) date,COUNT(*) n${scope} GROUP BY 3,m.group_key`).iterate(generation,key,end)){yield;db.prepare('INSERT INTO record_topic_groups VALUES (?,?,?,?,?,?,NULL)').run(r.generation,r.key,r.period,r.group_key,r.date,r.n);}
  yield;db.prepare(summary('record_topic_group_summary','record_topic_groups',false)).run(generation,key);
  yield;db.prepare("INSERT INTO record_topic_group_summary SELECT generation,key,'',COUNT(DISTINCT group_key),NULL FROM record_topic_groups WHERE generation=? AND key=? GROUP BY key").run(generation,key);
  for(const askers of ['home','elsewhere','not-home']){
   const filter=" AND (m.kind<>'question' OR EXISTS (SELECT 1 FROM record_topic_question_places q WHERE q.generation=m.generation AND q.record_id=m.record_id AND q.askers IN (SELECT value FROM json_each(?)) AND (m.key NOT LIKE 'place:%' OR q.key=m.key)))";
   yield;db.prepare(`INSERT INTO record_topic_filtered_totals SELECT m.generation,?,m.key,${periodSql},m.kind,COUNT(*)${scope}${filter} GROUP BY 4,m.kind`).run(askers,generation,key,end,JSON.stringify(askers==='not-home'?['elsewhere','unknown']:[askers]));
   let removed;do{yield;removed=db.prepare('DELETE FROM temp.topic_filtered_group_counts WHERE rowid IN (SELECT rowid FROM temp.topic_filtered_group_counts LIMIT 500)').run().changes;}while(removed);
   for(const r of db.prepare(`SELECT m.generation,m.key,${periodSql} period,m.group_key,MAX(m.date) date,COUNT(*) n${scope}${filter} GROUP BY 3,m.group_key`).iterate(generation,key,end,JSON.stringify(askers==='not-home'?['elsewhere','unknown']:[askers]))){yield;db.prepare('INSERT INTO topic_filtered_group_counts VALUES (?,?,?,?,?,?,NULL)').run(r.generation,r.key,r.period,r.group_key,r.date,r.n);}
   yield;db.prepare(summary('record_topic_filtered_groups','topic_filtered_group_counts',true)).run(askers,generation,key);
   yield;db.prepare("INSERT INTO record_topic_filtered_groups SELECT generation,?,key,'',COUNT(DISTINCT group_key),NULL FROM topic_filtered_group_counts WHERE generation=? AND key=? GROUP BY key").run(askers,generation,key);
  }
 }
 db.exec('DROP TABLE temp.topic_filtered_group_counts');
 const periods=topicPeriods(store.clock()),periodTotals=Object.fromEntries(periods.map(p=>[p,counts()])),sittingDays=Object.fromEntries(periods.map(p=>[p,null]));
 for(const period of periods){const [year,q]=period.split('-Q'),start=`${year}-${String((Number(q)-1)*3+1).padStart(2,'0')}-01`,next=new Date(Date.UTC(Number(year),Number(q)*3,1)).toISOString().slice(0,10);
  for(const kind of topicKinds){yield;periodTotals[period][kind]=db.prepare("SELECT COUNT(*) n FROM record_topic_records WHERE generation=? AND kind=? AND date>=? AND date<? AND date>='2024-07-16' AND date<=? AND json_extract(body,'$.procedural') IS NOT 1").get(generation,kind,start,next,end).n;}
  yield;const n=db.prepare("SELECT COUNT(DISTINCT substr(id,8,10)) n FROM record_topic_records WHERE generation=? AND kind IN ('debate','vote') AND date>=? AND date<? AND date>='2024-07-16' AND date<=? AND id LIKE 'MTG-PL-%'").get(generation,start,next,end).n;if(n)sittingDays[period]=n;
 }
 let last=null;for(const kind of topicKinds){yield;const date=db.prepare('SELECT MAX(date) date FROM record_topic_records WHERE generation=? AND kind=? AND date<=?').get(generation,kind,end).date;if(date&&(!last||date>last))last=date;}
 store.set('recordTopicCalendar',{generation,periodTotals,sittingDays,end,partial:{first:'2024-07-16',last}});
 store.set('recordTopicProjection',{version:RECORD_TOPICS_VERSION,generation,askerSubsets:['all','home','elsewhere','not-home'],builtAt:new Date().toISOString()});
}

const counts=()=>Object.fromEntries(topicKinds.map(k=>[k,0]));
const fold=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
export class RecordTopics{
 constructor(store){this.store=store;this.db=store.db;this.concepts=new Map();this.rawConcepts=new Map();this.rankCounts=new Map();}
 get state(){if(this._state===undefined)this._state=readableRecordTopicState(this.store);return this._state;}
 concept(key,language){const cacheKey=key+'|'+language;if(this.concepts.has(cacheKey))return this.concepts.get(cacheKey);const row=this.db.prepare('SELECT body FROM record_topic_concepts WHERE generation=? AND key=?').get(this.state.generation,key);if(!row)return null;const c=JSON.parse(row.body);const result={key:c.key,role:c.role,...conceptLabel(c,language),uri:c.uri,...(['keyword','place'].includes(c.role)?{source:c.labelSource||c.source||(c.role==='place'?countryLabelSource:null)}:{}),...(c.role==='place'?{id:c.key.slice(6),iso3:countryIdentity(c.key.slice(6))?.iso3||null,...(countryIdentity(c.key.slice(6))?.deprecated?{deprecated:true}:{})}:{})};Object.defineProperty(result,'englishFold',{value:fold(conceptLabel(c,'en').label)});if(this.concepts.size>=2000){this.concepts.clear();this.rawConcepts.clear();}this.concepts.set(cacheKey,result);this.rawConcepts.set(c.key,c);return result;}
 record(id,language,{rankKeywords=true}={}){const row=this.db.prepare('SELECT body FROM record_topic_records WHERE generation=? AND id=?').get(this.state.generation,id);if(!row)return {id,kind:null,status:'not-observed',topics:[],keywords:[],places:[]};const r=JSON.parse(row.body),parts={topics:[],keywords:[],places:[]};for(const a of r.assignments){const c=this.concept(a.key,language);if(!c||c.role==='hidden')continue;const v={key:c.key,label:c.label,language:c.language,labelLanguage:c.labelLanguage,...(c.labelSource?{labelSource:c.labelSource}:{})};if(c.role==='place')Object.assign(v,{id:c.id,iso3:c.iso3,...(c.deprecated?{deprecated:true}:{}),basis:a.paths.some(p=>p.basis==='title')?'title':'official'});if(c.role==='place'&&r.kind==='question')v.askers=this.db.prepare('SELECT askers FROM record_topic_question_places WHERE generation=? AND record_id=? AND key=?').get(this.state.generation,r.id,c.key)?.askers||'unknown';parts[c.role==='topic'?'topics':c.role==='keyword'?'keywords':'places'].push(v);}parts.topics.sort((a,b)=>a.key.localeCompare(b.key));
 if(rankKeywords&&parts.keywords.length){const topicKeys=parts.topics.map(k=>k.key),keywordKeys=parts.keywords.map(k=>k.key),signature=JSON.stringify([topicKeys,[...keywordKeys].sort()]);let shared=this.rankCounts.get(signature);if(!shared){shared=new Map();if(topicKeys.length){const rows=this.db.prepare('SELECT k.key,COUNT(DISTINCT k.record_id) n FROM record_topic_memberships k JOIN record_topic_memberships t ON t.generation=k.generation AND t.record_id=k.record_id WHERE k.generation=? AND k.kind IN (\'debate\',\'document\',\'question\',\'speech\',\'vote\') AND k.key IN ('+keywordKeys.map(()=>'?').join(',')+') AND t.key IN ('+topicKeys.map(()=>'?').join(',')+') GROUP BY k.key').all(this.state.generation,...keywordKeys,...topicKeys);shared=new Map(rows.map(r=>[r.key,r.n]));}if(this.rankCounts.size>=50)this.rankCounts.clear();this.rankCounts.set(signature,shared);}
 parts.keywords=orderRecordKeywords(parts.keywords,{title:r.titles?.[languagePreference(Object.keys(r.titles||{}),language)[0]]||'',concepts:new Map(keywordKeys.map(key=>[key,this.rawConcepts.get(key)])),counts:shared});}
 return {id:r.id,kind:r.kind,status:r.status,...parts};}
 query(params,view='records'){this._state=undefined;this.concepts.clear();this.rawConcepts.clear();this.rankCounts.clear();return this.store.readSnapshot(()=>this.querySnapshot(params,view));}
 querySnapshot(params,view,chartOnly=false){
 const allowed=view==='records'?['ids','lang']:view==='search'?['q','lang','askers']:view==='overview'?['role','lang','askers']:['key','lang','kind','keyword','place','from','to','offset','askers'];
 for(const k of params.keys())if(!allowed.includes(k)||params.getAll(k).length!==1)throw new HttpError(400,'invalid_query','Unsupported topic parameter.');
 const language=params.get('lang')||'en',generation=this.state?.generation,askers=params.get('askers')||'all';if(!['all','home','elsewhere','not-home'].includes(askers))throw new HttpError(400,'invalid_query','Choose question authors.');
 const ids=params.get('ids')?.split(',')||[];
 if(view==='records'&&(ids.length>50||ids.some(id=>!/^[-A-Za-z0-9_]{1,150}$/.test(id))))throw new HttpError(400,'invalid_query','Choose up to 50 records.');
 const role=params.get('role')||'topic';if(view==='overview'&&!['topic','place'].includes(role))throw new HttpError(400,'invalid_query','Choose topics or places.');
 const key=params.get('key'),kind=params.get('kind'),offset=Number(params.get('offset')||0),keyword=params.get('keyword'),place=params.get('place'),from=params.get('from'),to=params.get('to');
 if(view==='detail'&&(!validTopicKey(key)||key.startsWith('subject-matter:')||kind&&!topicKinds.includes(kind)||!Number.isSafeInteger(offset)||offset<0||keyword&&(!validTopicKey(keyword)||!/^eurovoc:/.test(keyword))||place&&(!validTopicKey(place)||!/^place:/.test(place))))throw new HttpError(400,'invalid_query','Choose a topic.');
 for(const d of [from,to])if(d&&(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d))throw new HttpError(400,'invalid_query','Choose a date.');
 if(from&&to&&from>to)throw new HttpError(400,'invalid_query','Choose a date range.');
 if(!generation||askers==='not-home'&&view!=='detail'&&!this.state.askerSubsets?.includes('not-home'))return {ready:false};
 if(view==='records')return {ready:true,records:[...new Set(ids)].map(id=>this.record(id,language))};
 const periods=topicPeriods(),summary=new Map(),storedCoverage=this.store.get('recordTopicCoverage'),coverage=storedCoverage?{...storedCoverage,pending:storedCoverage.pending??Math.max(0,storedCoverage.referenced-storedCoverage.read-storedCoverage.unavailable)}:storedCoverage,calendar=this.store.get('recordTopicCalendar')||{},extras={sittingDays:calendar.sittingDays||{},periodTotals:calendar.periodTotals||{},partial:calendar.partial||{first:'2024-07-16',last:null}};
 // Overview totals were bounded by the build day; detail and question splits
 // use the same bound so both count the same records.
 const bound=calendar.end||calendar.partial?.last||new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(Date.now());
 // The optional summary field is a storage optimization, not a new projection
 // contract: older generations keep the exact body lookup until their next rebuild.
 // A top group whose parent is excluded (procedural) carries kind 'record' so captions never call it a debate.
 const procedural=this.db.prepare("SELECT 1 FROM record_topic_records WHERE generation=? AND id=? AND json_extract(body,'$.procedural') IS 1");
 const top=value=>{if(!value)return undefined;const t=typeof value==='string'?JSON.parse(value):value;return {key:t.key,title:t.titles?.[languagePreference(Object.keys(t.titles||{}),language)[0]]||null,date:t.date,...((Object.hasOwn(t,'procedural')?t.procedural===1:procedural.get(generation,t.key))?{kind:'record'}:{})};};
 if(view!=='detail'){
 // The overview lists one role; reading only that role's keys skips the keyword concepts and their top-group lookups.
 const overviewRole=view==='overview';
 for(const row of this.db.prepare('SELECT key,period,kind,n FROM '+(askers==='all'?'record_topic_totals':'record_topic_filtered_totals')+' WHERE generation=?'+(askers==='all'?'':' AND askers=?')+(overviewRole?' AND key IN (SELECT key FROM record_topic_concepts WHERE generation=? AND role=?)':'')).iterate(generation,...(askers==='all'?[]:[askers]),...(overviewRole?[generation,role]:[]))){
 if(!periods.includes(row.period))continue;let item=summary.get(row.key);if(!item){const c=this.concept(row.key,language);if(!c||c.role==='hidden')continue;item={...c,englishFold:c.englishFold,total:0,counts:counts(),series:[]};summary.set(row.key,item);}item.total+=row.n;item.counts[row.kind]+=row.n;let s=item.series.find(s=>s.period===row.period);if(!s){s={period:row.period,...counts()};item.series.push(s);}s[row.kind]+=row.n;
 }
 for(const r of this.db.prepare('SELECT key,period,groups,top FROM '+(askers==='all'?'record_topic_group_summary':'record_topic_filtered_groups')+' WHERE generation=?'+(askers==='all'?'':' AND askers=?')+(overviewRole?' AND key IN (SELECT key FROM record_topic_concepts WHERE generation=? AND role=?)':'')).iterate(generation,...(askers==='all'?[]:[askers]),...(overviewRole?[generation,role]:[]))){const item=summary.get(r.key);if(!item)continue;if(!r.period)item.groupsTotal=r.groups;else {const period=item.series.find(s=>s.period===r.period);if(period)Object.assign(period,{groups:r.groups,top:top(r.top)});}}
 for(const item of summary.values())if(item.role==='place')for(const s of item.series)Object.assign(s,{questionHome:0,questionElsewhere:0,questionUnknown:0});
 for(const r of this.db.prepare("SELECT key,substr(date,1,4)||'-Q'||CAST((CAST(substr(date,6,2) AS INTEGER)+2)/3 AS INTEGER) period,askers,COUNT(*) n FROM record_topic_question_places WHERE generation=? AND date>='2024-07-16' AND date<=?"+(askers==='all'?'':" AND askers IN (SELECT value FROM json_each(?))")+' GROUP BY key,period,askers').iterate(generation,bound,...(askers==='all'?[]:[JSON.stringify(askers==='not-home'?['elsewhere','unknown']:[askers])]))){const s=summary.get(r.key)?.series.find(s=>s.period===r.period);if(s)s['question'+r.askers[0].toUpperCase()+r.askers.slice(1)]=r.n;}
 const items=[...summary.values()].sort((a,b)=>b.total-a.total||a.key.localeCompare(b.key));
 if(view==='overview')return {ready:true,coverage,...extras,periods,items:items.filter(c=>c.role===role).map(({key,label,labelLanguage,labelSource,id,iso3,deprecated,total,counts,series,groupsTotal})=>({key,label,labelLanguage,...(labelSource?{labelSource}:{}),...(id?{id,iso3,...(deprecated?{deprecated:true}:{})}:{}),total,groupsTotal,counts,series}))};
 const text=params.get('q')||'';if(text.length>120)throw new HttpError(400,'invalid_query','Use a shorter search.');const q=fold(text),limits={topic:0,keyword:0,place:0};return {ready:true,results:items.filter(c=>(!q?c.role==='topic':(fold(c.label).includes(q)||c.englishFold.includes(q)))&&limits[c.role]++<8).map(({key,role,label,labelLanguage,labelSource,id,iso3,deprecated,total,counts})=>({key,role,label,labelLanguage,...(labelSource?{labelSource}:{}),...(id?{id,iso3,...(deprecated?{deprecated:true}:{})}:{}),total,counts}))};
 }
 const concept=this.concept(key,language);if(concept?.role==='hidden')throw new HttpError(400,'invalid_topic','Choose a topic.');
 const where=['m.generation=?','m.key=?',"m.kind IN ('debate','document','question','speech','vote')","m.date>=?","m.date<=?"],args=[generation,key,from&&from>'2024-07-16'?from:'2024-07-16',to&&to<bound?to:bound];
 if(kind){where.push('m.kind=?');args.push(kind);}for(const filter of [keyword,place])if(filter){where.push('EXISTS (SELECT 1 FROM record_topic_memberships f WHERE f.generation=m.generation AND f.record_id=m.record_id AND f.key=?)');args.push(filter);}
 if(askers!=='all'){where.push("(m.kind<>'question' OR EXISTS (SELECT 1 FROM record_topic_question_places q WHERE q.generation=m.generation AND q.record_id=m.record_id AND q.askers IN (SELECT value FROM json_each(?))"+(key.startsWith('place:')||place?' AND q.key=?':'')+'))');args.push(JSON.stringify(askers==='not-home'?['elsewhere','unknown']:[askers]),...(key.startsWith('place:')||place?[key.startsWith('place:')?key:place]:[]));}
 const selection='FROM record_topic_memberships m WHERE '+where.join(' AND ');
 const totals=this.db.prepare('SELECT COUNT(*) records,COUNT(DISTINCT group_key) groups '+selection).get(...args),total=totals.records,groupTotal=totals.groups;
 const series=this.db.prepare("SELECT substr(date,1,4)||'-Q'||CAST((CAST(substr(date,6,2) AS INTEGER)+2)/3 AS INTEGER) period,kind,COUNT(*) n "+selection+' GROUP BY period,kind').all(...args).reduce((out,r)=>{let s=out.find(s=>s.period===r.period);if(!s){s={period:r.period,...counts()};out.push(s);}s[r.kind]=r.n;return out;},[]);
 if(concept?.role==='place'){
 for(const s of series)Object.assign(s,{questionHome:0,questionElsewhere:0,questionUnknown:0});
 for(const r of this.db.prepare("SELECT substr(q.date,1,4)||'-Q'||CAST((CAST(substr(q.date,6,2) AS INTEGER)+2)/3 AS INTEGER) period,q.askers,COUNT(*) n FROM record_topic_question_places q JOIN (SELECT m.record_id,m.generation "+selection+") s ON s.generation=q.generation AND s.record_id=q.record_id WHERE q.key=? GROUP BY period,q.askers").iterate(...args,key)){const s=series.find(s=>s.period===r.period);if(s)s['question'+r.askers[0].toUpperCase()+r.askers.slice(1)]=r.n;}
 }
 for(const s of series){const condition=selection+" AND substr(m.date,1,4)||'-Q'||CAST((CAST(substr(m.date,6,2) AS INTEGER)+2)/3 AS INTEGER)=?";s.groups=this.db.prepare('SELECT COUNT(DISTINCT group_key) n '+condition).get(...args,s.period).n;const winner=this.db.prepare('SELECT group_key,MAX(date) date,COUNT(*) n '+condition+' GROUP BY group_key ORDER BY n DESC,date DESC,group_key LIMIT 1').get(...args,s.period);if(winner){const row=this.db.prepare('SELECT body FROM record_topic_records WHERE generation=? AND id=?').get(generation,winner.group_key)||this.db.prepare('SELECT body FROM record_topic_records WHERE generation=? AND group_key=? ORDER BY date DESC,id LIMIT 1').get(generation,winner.group_key);s.top=top({key:winner.group_key,date:winner.date,titles:row?JSON.parse(row.body).titles:{}});}}
 // Peak periods and group winners include every tie. Counts are distinct
 // records of the metric kind; group n counts its matching records in that period.
 const peaks={},peakTitles=new Map(),metrics=['question','document','debate','groups',...(concept?.role==='place'?['questionHome','questionElsewhere','questionUnknown','questionNotHome']:[])];
 const metricValue=(s,m)=>m==='questionNotHome'?(s.questionElsewhere||0)+(s.questionUnknown||0):s[m]||0;
 for(const metric of metrics){const maximum=Math.max(0,...series.map(s=>metricValue(s,metric)));peaks[metric]=[];if(!maximum)continue;
  for(const point of series.filter(s=>metricValue(s,metric)===maximum)){
   let scope=selection+" AND substr(m.date,1,4)||'-Q'||CAST((CAST(substr(m.date,6,2) AS INTEGER)+2)/3 AS INTEGER)=?",values=[...args,point.period];
   if(metric!=='groups'){scope+=' AND m.kind=?';values.push(metric.startsWith('question')?'question':metric);}
   if(metric.startsWith('question')&&metric!=='question'){const origin=metric==='questionNotHome'?"IN ('elsewhere','unknown')":metric==='questionHome'?"='home'":metric==='questionElsewhere'?"='elsewhere'":"='unknown'";scope+=` AND EXISTS (SELECT 1 FROM record_topic_question_places q WHERE q.generation=m.generation AND q.record_id=m.record_id AND q.key=? AND q.askers ${origin})`;values.push(key);}
   const groups=[];let topCount;
   for(const row of this.db.prepare('SELECT group_key,MAX(date) date,COUNT(*) n '+scope+' GROUP BY group_key ORDER BY n DESC,date DESC,group_key').iterate(...values)){
    if(topCount===undefined)topCount=row.n;if(row.n!==topCount)break;
    let base=peakTitles.get(row.group_key);if(!base){const raw=this.db.prepare('SELECT body FROM record_topic_records WHERE generation=? AND id=?').get(generation,row.group_key)||this.db.prepare('SELECT body FROM record_topic_records WHERE generation=? AND group_key=? ORDER BY date DESC,id LIMIT 1').get(generation,row.group_key);base=raw?JSON.parse(raw.body):{id:row.group_key,titles:{}};peakTitles.set(row.group_key,base);}
    const languageUsed=languagePreference(Object.keys(base.titles||{}),language)[0];groups.push({key:row.group_key,kind:base.procedural===true?'record':base.kind==='procedure'?'procedure':base.kind==='debate'||base.kind==='event'?'debate':base.groupKind||'record',title:base.titles?.[languageUsed]||null,language:languageUsed||null,date:row.date,n:row.n});
   }
   peaks[metric].push({period:point.period,n:maximum,groups});
  }
 }
 if(chartOnly)return {periods,series,peaks,total,groupsTotal:groupTotal};
 // chart keeps key/keyword/place filters, but spans the full term and all kinds
 // and author origins. Existing top-level fields retain every requested filter.
 const chartParams=new URLSearchParams(params);for(const name of ['kind','from','to','askers','offset'])chartParams.delete(name);
 const scoped=['kind','from','to','askers','offset'].some(name=>params.has(name)&&!(name==='offset'&&Number(params.get(name))===0));
 const chart=scoped?this.querySnapshot(chartParams,'detail',true):{periods,series,peaks,total,groupsTotal:groupTotal};
 const facets={keywords:[],places:[],topics:[]};for(const row of this.db.prepare('SELECT f.key,COUNT(*) n FROM record_topic_memberships f JOIN (SELECT m.record_id,m.generation '+selection+') s ON s.generation=f.generation AND s.record_id=f.record_id GROUP BY f.key ORDER BY n DESC,f.key').iterate(...args)){const c=this.concept(row.key,language);if(c&&c.role!=='hidden')facets[c.role==='topic'?'topics':c.role==='place'?'places':'keywords'].push({key:c.key,label:c.label,labelLanguage:c.labelLanguage,...(c.labelSource?{labelSource:c.labelSource}:{}),...(c.id?{id:c.id,iso3:c.iso3}:{}),n:row.n});}
 const groups=this.db.prepare('SELECT group_key,MAX(date) date '+selection+' GROUP BY group_key ORDER BY date DESC,group_key LIMIT 20 OFFSET ?').all(...args,offset).map(g=>{
 const recordScope=' FROM record_topic_records r JOIN (SELECT m.record_id,m.generation '+selection+' AND m.group_key=?) s ON s.generation=r.generation AND s.record_id=r.id';
 const rows=this.db.prepare('SELECT r.body'+recordScope+" WHERE r.kind<>'speech' ORDER BY r.date DESC,r.id").all(...args,g.group_key).map(r=>JSON.parse(r.body));
 const representative=rows[0]||JSON.parse(this.db.prepare('SELECT r.body'+recordScope+' ORDER BY r.date DESC,r.id LIMIT 1').get(...args,g.group_key).body),speechCount=this.db.prepare('SELECT COUNT(*) n '+selection+" AND m.group_key=? AND m.kind='speech'").get(...args,g.group_key).n;
 const saved=this.db.prepare('SELECT body FROM record_topic_records WHERE generation=? AND id=?').get(generation,g.group_key),parent=saved?JSON.parse(saved.body):null,base=parent||representative,speakers=new Map();
 for(const {id} of this.db.prepare('SELECT DISTINCT CAST(j.value AS TEXT) id'+recordScope+" JOIN json_each(r.body,'$.members') j WHERE r.kind='speech' ORDER BY r.date DESC,r.id,j.key LIMIT 5").all(...args,g.group_key)){const raw=this.db.prepare('SELECT body FROM members WHERE id=?').get(id);speakers.set(id,{id,name:raw?JSON.parse(raw.body).name||null:null});}
 // No held title gives null (the interface shows a short label); IDs stay in keys and links.
 const titleLanguage=r=>languagePreference(Object.keys(r.titles||{}),language)[0]||null,title=r=>r.titles?.[titleLanguage(r)]||null;
 // An excluded (procedural) parent, such as a voting-time item, is never presented as a debate.
 // Only a stored vote parent makes a group a vote record; a dossier group whose
 // newest item happens to be a vote stays a dossier.
 const parentVote=parent?.kind==='vote';
 const groupKind=parent?.procedural===true||parentVote?'record':representative.groupKind;
 const voteTargets=parentVote?[...new Set(base.agendaIds||[])].filter(id=>{let row;try{row=this.db.prepare("SELECT body FROM story_inputs WHERE kind='agenda' AND id=?").get(id);}catch(error){if(/no such table/.test(error.message))return false;throw error;}const agenda=row?JSON.parse(row.body):null;return agenda&&!agenda.conflicted&&agenda.type==='PLENARY_VOTE'&&agenda.date===base.date&&id.startsWith('MTG-PL-'+base.date+'-OJ-ITM-V-');}):[];
 return {key:g.group_key,kind:groupKind,title:title(base),titleLanguage:title(base)?titleLanguage(base):null,date:g.date,...(base.reference?{reference:base.reference}:{}),...(groupKind==='procedure'?{procedureId:g.group_key}:{}),...(parentVote?(voteTargets.length===1?{agendaId:voteTargets[0]}:{}):groupKind==='debate'?{agendaId:g.group_key}:{}),items:rows.filter(r=>r.kind!=='speech').map(r=>({id:r.id,kind:r.kind,title:title(r),titleLanguage:title(r)?titleLanguage(r):null,date:r.date,members:r.members})),speechCount,speakers:[...speakers.values()]};
 });
 return {ready:true,coverage,...extras,groupsTotal:groupTotal,concept,periods,series,peaks,chart,facets,groups,total,nextOffset:offset+20<groupTotal?offset+20:null};
 }
}
