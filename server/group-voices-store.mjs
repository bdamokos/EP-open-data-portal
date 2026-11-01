import {oralAvailability,savedGaps,availabilityGap} from './availability-evidence.mjs';
import {GROUP_VOICE_GROUPS,GROUP_VOICE_SUBJECTS} from '../src/groupVoiceTerms.mjs';
import {GROUP_VOICE_LIMITS,GROUP_VOICE_VERSION,groupVoiceProjection} from './group-voices-model.mjs';
import {nameScript,speakerNameIsSpecific} from '../src/speakerNames.mjs';
import {languagePreference} from './language-order.mjs';

export function groupVoicesSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS group_voice_observations(generation INTEGER,speech TEXT,date TEXT,body TEXT,PRIMARY KEY(generation,speech));
    CREATE TABLE IF NOT EXISTS group_voice_state(generation INTEGER PRIMARY KEY,version INTEGER);
    CREATE TABLE IF NOT EXISTS group_voice_jobs(generation INTEGER,key TEXT,kind TEXT,body TEXT,priority INTEGER,done INTEGER DEFAULT 0,attempts INTEGER DEFAULT 0,retry_at INTEGER DEFAULT 0,error TEXT,PRIMARY KEY(generation,key));
    CREATE INDEX IF NOT EXISTS group_voice_job_due ON group_voice_jobs(generation,retry_at) WHERE done=0;
    CREATE INDEX IF NOT EXISTS group_voice_observation_date ON group_voice_observations(generation,date);
    CREATE TABLE IF NOT EXISTS group_voice_designations(generation INTEGER,speech TEXT,person TEXT,group_id TEXT,date TEXT,subject TEXT,PRIMARY KEY(generation,speech,person,group_id));
    CREATE INDEX IF NOT EXISTS group_voice_group_date ON group_voice_designations(generation,group_id,date DESC,speech,person,subject);`);
}
// Older images ignore these additive tables. If a rollback advanced the core
// generation, adopt the latest retained projection and its durable cursors.
export function groupVoicesCopy(db,generation,active){
  // Adoption is once per target generation. Re-copying after a restart would
  // resurrect source rows corrected or deleted in the working snapshot.
  if(db.prepare('SELECT 1 FROM group_voice_state WHERE generation=?').get(generation))return;
  const saved=db.prepare('SELECT generation FROM group_voice_state WHERE generation<=? ORDER BY generation DESC LIMIT 1').get(active)?.generation;
  if(!saved||saved===generation)return;
  db.prepare('INSERT OR IGNORE INTO group_voice_state SELECT ?,version FROM group_voice_state WHERE generation=?').run(generation,saved);
  db.prepare('INSERT OR IGNORE INTO group_voice_observations SELECT ?,speech,date,body FROM group_voice_observations WHERE generation=?').run(generation,saved);
  db.prepare('INSERT OR IGNORE INTO group_voice_designations SELECT ?,speech,person,group_id,date,subject FROM group_voice_designations WHERE generation=?').run(generation,saved);
  db.prepare('INSERT OR IGNORE INTO group_voice_jobs SELECT ?,key,kind,body,priority,done,attempts,retry_at,error FROM group_voice_jobs WHERE generation=?').run(generation,saved);
}
export function groupVoicesPrune(db,generation,old){
  const previous=db.prepare('SELECT generation FROM group_voice_state WHERE generation<? ORDER BY generation DESC LIMIT 1').get(generation)?.generation||old||generation;
  for(const table of ['group_voice_observations','group_voice_designations','group_voice_jobs','group_voice_state'])db.prepare(`DELETE FROM ${table} WHERE generation NOT IN (?,?)`).run(generation,previous);
}
export function recordGroupVoice(store,generation,projection,outside,id=projection?.id){
  if(!projection){if(id){store.assertWriter();store.db.prepare('DELETE FROM group_voice_designations WHERE generation=? AND speech=?').run(generation,id);store.db.prepare('DELETE FROM group_voice_observations WHERE generation=? AND speech=?').run(generation,id);}return;}
  store.assertWriter();
  // Retain only compact public metadata, independently of legacy speech-source
  // rewrites during rollback. No transcript/XML bodies enter this projection.
  const saved={...projection,titles:outside?.titles||{},websiteUrl:outside?.websiteUrl||null,websiteLanguage:outside?.websiteLanguage||null,
    names:(outside?.headers||[]).filter(p=>p.personId&&speakerNameIsSpecific(p.name)).map(p=>({id:p.personId,name:p.name,language:p.languageTag||null,original:p.original??null,source:outside?.headerSource||outside?.source||null}))};
  store.db.prepare('INSERT OR REPLACE INTO group_voice_observations VALUES (?,?,?,?)').run(generation,projection.id,projection.date,JSON.stringify(saved));
  store.db.prepare('DELETE FROM group_voice_designations WHERE generation=? AND speech=?').run(generation,projection.id);
  const put=store.db.prepare('INSERT OR REPLACE INTO group_voice_designations VALUES (?,?,?,?,?,?)');
  for(const row of projection.designations)put.run(generation,projection.id,row.person,row.group,projection.date,projection.subject);
}
export const groupVoiceJobKey=(kind,suffix)=>'group-voices:'+GROUP_VOICE_VERSION+':'+kind+':'+suffix;
export function enqueueGroupVoice(store,generation,key,body,priority=20){
  store.assertWriter();
  store.db.prepare("INSERT OR IGNORE INTO group_voice_jobs(generation,key,kind,body,priority) VALUES (?,?,'speeches',?,?)").run(generation,key,JSON.stringify(body),priority);
}
export function nextGroupVoiceTask(store,generation,coreTask=null){
  // Probe by deadline before walking priority order, including on idle ticks.
  if(!store.db.prepare('SELECT 1 FROM group_voice_jobs INDEXED BY group_voice_job_due WHERE generation=? AND done=0 AND retry_at<=? LIMIT 1').get(generation,store.clock()))return coreTask;
  const saved=store.get('groupVoiceDispatch');
  const count=saved?.generation===generation?saved.count:0;
  if(coreTask){
    store.assertWriter();
    if(count<8){store.set('groupVoiceDispatch',{generation,count:count+1});return coreTask;}
    store.set('groupVoiceDispatch',{generation,count:0});
  }
  const row=store.db.prepare('SELECT * FROM group_voice_jobs WHERE generation=? AND done=0 AND retry_at<=? ORDER BY priority DESC,key DESC LIMIT 1').get(generation,store.clock());
  return row?{...row,body:JSON.parse(row.body),groupVoiceJob:true}:null;
}
export function groupVoiceWorkDue(store,generation){
  const saved=store.db.prepare('SELECT generation,version FROM group_voice_state WHERE generation<=? ORDER BY generation DESC LIMIT 1').get(generation);
  return !saved||saved.version!==GROUP_VOICE_VERSION||Boolean(store.db.prepare('SELECT 1 FROM group_voice_jobs WHERE generation=? AND done=0 AND retry_at<=? LIMIT 1').get(saved.generation,store.clock()));
}
// The ordinary writer's budgets, lease, backoff and disk limit apply. These
// optional jobs never enter core publication or the amendment continuation log.
export function initializeGroupVoices(worker,generation,windows){
  const store=worker.store;
  if(store.db.prepare('SELECT 1 FROM group_voice_state WHERE generation=? AND version=?').get(generation,GROUP_VOICE_VERSION))return;
  store.transaction(()=>{
    store.assertWriter();
    store.db.prepare('DELETE FROM group_voice_jobs WHERE generation=? AND done<>1 AND key NOT LIKE ?').run(generation,'group-voices:'+GROUP_VOICE_VERSION+':%');
    for(const {start,end} of windows)enqueueGroupVoice(store,generation,groupVoiceJobKey('catalog',start+':'+end),{
      endpoint:'/speeches',params:{'parliamentary-term':10,'activity-type':'PLENARY_DEBATE_SPEECH','sort-by':'sitting-date:desc,numbering:desc','sitting-date':start,'sitting-date-end':end},offset:0,
    });
    store.db.prepare('INSERT OR REPLACE INTO group_voice_state VALUES (?,?)').run(generation,GROUP_VOICE_VERSION);
  });
}
function generationOf(store){
  const active=store.get('active')||0,working=store.get('working')?.generation||0;
  const saved=store.db.prepare('SELECT generation FROM group_voice_state WHERE generation<=? ORDER BY generation DESC LIMIT 1').get(active||working)?.generation;
  return saved||working||active;
}
function coverage(store,generation,query,truncated){
  const observed=store.db.prepare('SELECT COUNT(*) AS n FROM group_voice_observations WHERE generation=? AND date>=? AND date<=?').get(generation,query.from,query.to).n;
  const pending=store.db.prepare('SELECT COUNT(*) AS n FROM group_voice_jobs WHERE generation=? AND done=0').get(generation).n;
  return {generation,observedOralRecords:observed,pending,initialized:Boolean(store.db.prepare('SELECT 1 FROM group_voice_state WHERE generation=?').get(generation)),truncated,authoritativeComplete:false,
    note:observed?'Available recorded designations · partial coverage':'Group designations are being indexed. Available coverage is incomplete.',
    updatedAt:store.get('lastSuccess')||store.get('working')?.startedAt||null};
}
const scopeRows=(store,generation,query)=>{
  const rows=store.db.prepare(`SELECT speech,person,date,subject FROM group_voice_designations
    WHERE generation=? AND group_id=? AND date>=? AND date<=? ORDER BY date DESC,speech,person LIMIT ?`)
    .all(generation,query.group,query.from,query.to,GROUP_VOICE_LIMITS.rows+1);
  return {rows:rows.slice(0,GROUP_VOICE_LIMITS.rows),truncated:rows.length>GROUP_VOICE_LIMITS.rows};
};
function savedSpeech(store,generation,id){const row=store.db.prepare('SELECT body FROM group_voice_observations WHERE generation=? AND speech=?').get(generation,id);return row?JSON.parse(row.body):null;}
function identity(store,generation,id,speech){
  const roster=store.db.prepare('SELECT body FROM members WHERE id=?').get(id);
  const member=roster?JSON.parse(roster.body):null;
  const source=savedSpeech(store,generation,speech),header=source?.names?.find(p=>p.id===id);
  const variants=[...(member?.nameVariants||[]),...(speakerNameIsSpecific(member?.name)?[{value:member.name,script:nameScript(member.name),language:null,source:'ODP current roster name'}]:[]),
    ...(header?[{value:header.name,script:nameScript(header.name),language:header.language,source:'ID-matched transcript header',provenance:header.source,original:header.original}]:[])];
  return {id,name:variants[0]?.value||header?.name||null,nameVariants:variants};
}
function localized(titles,language){
  const available=Object.keys(titles||{}).filter(key=>typeof titles[key]==='string'&&titles[key].trim());
  const code=languagePreference(available,language)[0];
  return {title:code!==undefined?titles[code]:null,titleLanguage:code||null};
}

// Summary uses only indexed scalar designation rows. Source bodies are read at
// most once per person for a name, and only for the bounded contribution page.
// Nothing here reads raw XML, refreshes a source or infers group membership.
export function groupVoicesPage(store,query){return store.readSnapshot(()=>groupVoicesSnapshot(store,query));}
function groupVoicesSnapshot(store,query){
  const generation=generationOf(store),{rows,truncated}=scopeRows(store,generation,query);
  const state=coverage(store,generation,query,truncated);
  const failed=store.db.prepare('SELECT key,body FROM group_voice_jobs WHERE generation=? AND done=0 AND error IS NOT NULL LIMIT 501').all(generation);
  const jobGaps=failed.length>500?[{reason:'source-gap'}]:failed.map(row=>availabilityGap(JSON.parse(row.body),row.key));
  const shared={group:query.group,period:query.period,window:{from:query.from,to:query.to},coverage:state,availability:oralAvailability(store,{generation,start:query.from,end:query.to,limited:truncated||state.pending>0||!state.initialized,gaps:[...savedGaps(store,generation,'speeches'),...jobGaps]})};
  const selected=rows.filter(row=>(!query.person||row.person===query.person)&&(!query.subject||row.subject===query.subject));
  const page={...shared,total:selected.length,offset:query.offset,limit:query.limit,nextOffset:query.offset+query.limit<selected.length?query.offset+query.limit:null,
    contributions:selected.slice(query.offset,query.offset+query.limit).map(row=>{
      const source=savedSpeech(store,generation,row.speech);
      return {id:row.speech,personId:row.person,date:row.date,subject:row.subject,...localized(source?.titles,query.language),
        websiteUrl:source?.websiteUrl||null,websiteLanguage:source?.websiteLanguage||null,source:source?.source||null,
        designation:source?.designations.find(p=>p.person===row.person&&p.group===query.group)||null};
    })};
  if(query.part==='summary'){
    const grouped=new Map();
    for(const row of rows){let person=grouped.get(row.person);if(!person){person={...identity(store,generation,row.person,row.speech),total:0,subjects:{}};grouped.set(row.person,person)}person.total++;person.subjects[row.subject]=(person.subjects[row.subject]||0)+1;}
    return {...page,groups:Object.entries(GROUP_VOICE_GROUPS).map(([id,label])=>({id,label})),subjects:Object.entries(GROUP_VOICE_SUBJECTS).map(([id,label])=>({id,label})),
      // Every group's subject counts over the same window and the same
      // most-recent row cap as people and contributions, one covering-index
      // range per group, so subjects can be compared across groups.
      groupSubjects:Object.keys(GROUP_VOICE_GROUPS).map(id=>{
        const range='FROM group_voice_designations WHERE generation=? AND group_id=? AND date>=? AND date<=? ORDER BY date DESC,speech,person',args=[generation,id,query.from,query.to];
        const subjects={};let total=0;
        for(const row of store.db.prepare(`SELECT subject,COUNT(*) AS n FROM (SELECT subject ${range} LIMIT ?) GROUP BY subject`).all(...args,GROUP_VOICE_LIMITS.rows)){subjects[row.subject]=row.n;total+=row.n;}
        return {id,total,subjects,truncated:Boolean(store.db.prepare(`SELECT 1 ${range} LIMIT 1 OFFSET ?`).get(...args,GROUP_VOICE_LIMITS.rows))};
      }),
      people:[...grouped.values()].sort((a,b)=>b.total-a.total||(a.name||a.id).localeCompare(b.name||b.id)),
      months:store.db.prepare("SELECT DISTINCT substr(date,1,7) AS month FROM group_voice_observations WHERE generation=? AND date>='2024-07-16' ORDER BY month DESC LIMIT 100").all(generation).map(r=>r.month),
      subjectMethod:'Reviewed editorial primary-subject groupings. Unlisted records remain unclassified; these are not official annotations of individual speeches.'};
  }
  return page;
}

export {groupVoiceProjection};
