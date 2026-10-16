import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { CATEGORIES, CATEGORY_GROUPS, CATEGORY_GAPS, localize, documentFiles } from './activity-index-model.mjs';
import { isMotion, motionOutcome, motionReference, motionSourceKey } from './motion-outcomes.mjs';

const parse = value => value == null ? null : JSON.parse(value);
const motionReferenceValue = `CASE WHEN ref.type='object' THEN json_extract(ref.value,'$.id') ELSE ref.value END`;
const originalMotionRef = `CASE
  WHEN instr(${motionReferenceValue},'https://data.europarl.europa.eu/')=1 THEN substr(${motionReferenceValue},length('https://data.europarl.europa.eu/')+1)
  WHEN instr(${motionReferenceValue},'http://data.europarl.europa.eu/')=1 THEN substr(${motionReferenceValue},length('http://data.europarl.europa.eu/')+1)
  ELSE ${motionReferenceValue} END`;
const motionLinkSelect = (source,from='') => `SELECT ${source}.generation,${originalMotionRef},${source}.key
  FROM ${from}json_each(${source}.body,'$.is_derivative_of') AS ref
  WHERE ${source}.kind='document' AND json_extract(${source}.body,'$.work_type') LIKE '%/RESOLUTION_MOTION_JOINT'
  AND ${originalMotionRef} LIKE 'eli/dl/doc/B-10-%'`;
const relatedJointMotionsSql = `SELECT source.key,source.body,source.fetched_at
  FROM motion_links AS link JOIN sources AS source ON source.generation=link.generation AND source.key=link.joint_key
  WHERE link.generation=? AND link.original_ref=?
  ORDER BY json_extract(source.body,'$.document_date') DESC,source.key LIMIT 5`;
export class ActivityStore {
  constructor(directory, { clock = Date.now } = {}) {
    mkdirSync(directory, { recursive: true });
    this.clock = clock; this.owner = randomUUID();
    this.filename = path.join(directory, 'activities-v1.sqlite');
    this.db = new DatabaseSync(this.filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (generation INTEGER, key TEXT, kind TEXT, body TEXT, fetched_at TEXT, seen INTEGER DEFAULT 0, PRIMARY KEY(generation,key));
      CREATE TABLE IF NOT EXISTS motion_links (generation INTEGER, original_ref TEXT, joint_key TEXT, PRIMARY KEY(generation,original_ref,joint_key));
      CREATE INDEX IF NOT EXISTS motion_link_source ON motion_links(generation,joint_key);
      CREATE TRIGGER IF NOT EXISTS motion_links_insert AFTER INSERT ON sources BEGIN
        DELETE FROM motion_links WHERE generation=NEW.generation AND joint_key=NEW.key;
        INSERT OR IGNORE INTO motion_links ${motionLinkSelect('NEW')};
      END;
      CREATE TRIGGER IF NOT EXISTS motion_links_update AFTER UPDATE OF body,kind ON sources BEGIN
        DELETE FROM motion_links WHERE generation=OLD.generation AND joint_key=OLD.key;
        INSERT OR IGNORE INTO motion_links ${motionLinkSelect('NEW')};
      END;
      CREATE TRIGGER IF NOT EXISTS motion_links_delete AFTER DELETE ON sources BEGIN
        DELETE FROM motion_links WHERE generation=OLD.generation AND joint_key=OLD.key;
      END;
      CREATE TABLE IF NOT EXISTS items (generation INTEGER, source_key TEXT, source_id TEXT, mep TEXT, category TEXT, date TEXT, body TEXT, PRIMARY KEY(generation,source_id,mep,category));
      CREATE INDEX IF NOT EXISTS item_lookup ON items(generation,mep,date DESC,source_id);
      CREATE INDEX IF NOT EXISTS item_source ON items(generation,source_key);
      CREATE TABLE IF NOT EXISTS tasks (generation INTEGER, key TEXT, kind TEXT, body TEXT, priority INTEGER, done INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, retry_at INTEGER DEFAULT 0, error TEXT, PRIMARY KEY(generation,key));
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, body TEXT);
      INSERT OR IGNORE INTO meta VALUES ('schema','1');`);
    if (this.get('schema') !== 1) throw new Error('Unsupported activity-index schema.');
  }
  get(key) { return parse(this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value); }
  set(key,value) { this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key,JSON.stringify(value)); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const out=fn(); this.db.exec('COMMIT'); return out; }
    catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  acquire(ttl=90_000) {
    return this.transaction(()=> {
      const old=this.db.prepare('SELECT * FROM lease WHERE id=1').get();
      if (old && old.owner!==this.owner && old.expires>this.clock()) return false;
      this.db.prepare('INSERT OR REPLACE INTO lease VALUES (1,?,?)').run(this.owner,this.clock()+ttl);
      if(this.get('motionLinksIndexVersion')!==1) {
        this.assertWriter();
        this.db.exec('INSERT OR IGNORE INTO motion_links '+motionLinkSelect('source','sources AS source, '));
        this.assertWriter();
        this.set('motionLinksIndexVersion',1);
      }
      return true;
    });
  }
  renew(ttl=90_000) { return this.db.prepare('UPDATE lease SET expires=? WHERE id=1 AND owner=? AND expires>?').run(this.clock()+ttl,this.owner,this.clock()).changes===1; }
  assertWriter() {
    const lease=this.db.prepare('SELECT owner,expires FROM lease WHERE id=1').get();
    if (lease?.owner!==this.owner || lease.expires<=this.clock()) throw new Error('Activity-index writer lease was lost.');
  }
  release() { this.db.prepare('DELETE FROM lease WHERE id=1 AND owner=?').run(this.owner); }
  beginCycle() {
    return this.transaction(()=> {
      this.assertWriter();
      const working=this.get('working');
      if (working) return working;
      const active=this.get('active') || 0, generation=(this.get('sequence') || 0)+1;
      this.set('sequence',generation);
      if (active) {
        for (const table of ['sources','items','tasks']) this.db.prepare(`DELETE FROM ${table} WHERE generation<>?`).run(active);
        this.set('previous',null);
        this.db.prepare('INSERT INTO sources SELECT ?,key,kind,body,fetched_at,0 FROM sources WHERE generation=?').run(generation,active);
        this.db.prepare('INSERT INTO items SELECT ?,source_key,source_id,mep,category,date,body FROM items WHERE generation=?').run(generation,active);
      }
      const cycle={ generation, initial:!active, startedAt:new Date(this.clock()).toISOString(), phase:'discovering', error:null, requests:0 };
      this.set('working',cycle);return cycle;
    });
  }
  updateCycle(values) { this.assertWriter();this.set('working',{...this.get('working'),...values}); }
  enqueue(generation,key,kind,body,priority=50,refreshCompleted=false) {
    this.assertWriter();
    // Older images select only done=0. Leave new task kinds pending for an
    // outcome-aware worker during rollback; SUM(done) still counts only finished work.
    const pending=kind==='motion-outcomes'?null:0;
    this.db.prepare('INSERT OR IGNORE INTO tasks(generation,key,kind,body,priority,done) VALUES (?,?,?,?,?,?)').run(generation,key,kind,JSON.stringify(body),priority,pending);
    if(refreshCompleted)this.db.prepare('UPDATE tasks SET done=?,attempts=0,error=NULL,retry_at=0,body=?,priority=? WHERE generation=? AND key=? AND done=1').run(pending,JSON.stringify(body),priority,generation,key);
  }
  nextTask(generation) { const r=this.db.prepare('SELECT * FROM tasks WHERE generation=? AND (done=0 OR done IS NULL) AND retry_at<=? ORDER BY priority DESC,key DESC LIMIT 1').get(generation,this.clock()); return r && {...r,body:parse(r.body)}; }
  taskProgress(task,body) { this.assertWriter();this.db.prepare('UPDATE tasks SET body=?,attempts=0,error=NULL,retry_at=0 WHERE generation=? AND key=?').run(JSON.stringify(body),task.generation,task.key); }
  finishTask(task) { this.assertWriter();this.db.prepare('UPDATE tasks SET done=1,error=NULL WHERE generation=? AND key=?').run(task.generation,task.key); }
  failTask(task,error) {
    this.assertWriter();const delay=Math.min(30*60_000,30_000*2**Math.min(task.attempts,6));
    this.db.prepare('UPDATE tasks SET attempts=attempts+1,retry_at=?,error=? WHERE generation=? AND key=?').run(this.clock()+delay,String(error.message).slice(0,350),task.generation,task.key);
    this.updateCycle({phase:'retrying',error:String(error.message).slice(0,350)});
  }
  taskCounts(generation) { return this.db.prepare('SELECT COUNT(*) AS total,COALESCE(SUM(done),0) AS completed,COALESCE(SUM(CASE WHEN (done=0 OR done IS NULL) AND error IS NOT NULL THEN 1 ELSE 0 END),0) AS retrying FROM tasks WHERE generation=?').get(generation); }
  source(generation,key) { const s=this.db.prepare('SELECT * FROM sources WHERE generation=? AND key=?').get(generation,key);return s && {work:parse(s.body),fetchedAt:s.fetched_at}; }
  sources(generation,kind,workType=null) {
    const rows=this.db.prepare('SELECT key,body,fetched_at FROM sources WHERE generation=? AND kind=?'+(workType?" AND json_extract(body,'$.work_type') LIKE ?":'')).all(generation,kind,...(workType?['%/'+workType]:[]));
    return rows.map(s=>({key:s.key,work:parse(s.body),fetchedAt:s.fetched_at}));
  }
  *iterateSources(generation,kind) {
    for(const source of this.db.prepare('SELECT key,body,fetched_at FROM sources WHERE generation=? AND kind=?').iterate(generation,kind))
      yield {key:source.key,work:parse(source.body),fetchedAt:source.fetched_at};
  }
  *reportsForProcedure(generation,id) {
    const relative='eli/dl/proc/'+id;
    const sql=`SELECT key,body,fetched_at FROM sources AS source
      WHERE generation=? AND kind='document' AND json_extract(body,'$.work_type') LIKE '%/REPORT_PLENARY'
      AND EXISTS(SELECT 1 FROM json_each(source.body,'$.inverse_created_a_realization_of') AS ref
        WHERE (CASE WHEN ref.type='object' THEN json_extract(ref.value,'$.id') ELSE ref.value END) IN (?,?,?))`;
    for(const source of this.db.prepare(sql).iterate(generation,relative,'https://data.europarl.europa.eu/'+relative,'http://data.europarl.europa.eu/'+relative))
      yield {key:source.key,work:parse(source.body),fetchedAt:source.fetched_at};
  }
  relatedJointMotions(generation,id) {
    return this.db.prepare(relatedJointMotionsSql).all(generation,'eli/dl/doc/'+id)
      .map(source=>({key:source.key,work:parse(source.body),fetchedAt:source.fetched_at}));
  }
  markSeen(generation,key) { this.assertWriter();this.db.prepare('UPDATE sources SET seen=1 WHERE generation=? AND key=?').run(generation,key); }
  putSource(generation,key,kind,work,fetchedAt,rows=[]) {
    this.transaction(()=> {
      this.assertWriter();
      this.db.prepare('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,1)').run(generation,key,kind,JSON.stringify(work),fetchedAt);
      this.replaceRows(generation,key,rows);
    });
  }
  replaceRows(generation,key,rows) {
    this.assertWriter();this.db.prepare('DELETE FROM items WHERE generation=? AND source_key=?').run(generation,key);
    const put=this.db.prepare('INSERT OR REPLACE INTO items VALUES (?,?,?,?,?,?,?)');
    for (const row of rows) put.run(generation,key,row.sourceId,String(row.mepId),row.category,row.date,JSON.stringify(row));
  }
  pruneUnseenDocuments(generation) {
    this.transaction(()=>{this.assertWriter();
      this.db.prepare("DELETE FROM items WHERE generation=? AND source_key IN (SELECT key FROM sources WHERE generation=? AND kind='document' AND seen=0)").run(generation,generation);
      this.db.prepare("DELETE FROM sources WHERE generation=? AND kind='document' AND seen=0").run(generation);
    });
  }
  setMembers(nodes) {
    this.transaction(()=>{ this.assertWriter();this.db.exec('DELETE FROM members');const q=this.db.prepare('INSERT OR REPLACE INTO members VALUES (?,?)');
      for (const n of nodes) q.run(String(n.id),JSON.stringify(n));this.set('rosterFetchedAt',new Date(this.clock()).toISOString()); });
  }
  publish(generation,unresolved=[]) {
    this.transaction(()=> {
      this.assertWriter();const progress=this.taskCounts(generation);
      if (progress.total!==progress.completed) throw new Error('Cannot publish an incomplete generation.');
      const old=this.get('active');this.set('lastRefreshRequests',this.get('working')?.requests || 0);this.set('previous',old);this.set('active',generation);this.set('working',null);
      this.set('lastSuccess',new Date(this.clock()).toISOString());this.set('unresolved',unresolved);
      // Retain the immediately previous generation for recovery; cache is reproducible public data.
      for (const table of ['sources','items','tasks']) this.db.prepare(`DELETE FROM ${table} WHERE generation NOT IN (?,?)`).run(generation,old || generation);
    });
  }
  status() {
    const cycle=this.get('working'), active=this.get('active'), generation=active || cycle?.generation || 0;
    const counts=this.db.prepare('SELECT kind,COUNT(*) AS count FROM sources WHERE generation=? GROUP BY kind').all(generation);
    const lease=this.db.prepare('SELECT expires FROM lease WHERE id=1').get();
    const recoveryGeneration=cycle?.generation || generation;
    const recoveryWhere="generation=? AND done=0 AND kind='speeches' AND json_extract(body,'$.recoveryId') IS NOT NULL";
    const recoveryCount=this.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE '+recoveryWhere).get(recoveryGeneration).n;
    const recoveryExamples=this.db.prepare('SELECT body,attempts,retry_at,error FROM tasks WHERE '+recoveryWhere+' ORDER BY key LIMIT 20').all(recoveryGeneration).map(task=>{const body=parse(task.body);return {sourceId:body.recoveryId,detectedAt:body.detectedAt,searchWindow:body.searchWindow,attempts:task.attempts,nextRetryAt:new Date(task.retry_at || this.clock()).toISOString(),lastError:task.error};});
    return { schemaVersion:1, enabled:true, term:10, complete:Boolean(active), servingGeneration:generation,
      phase:cycle?.phase || (active?'ready':'waiting'), lastSuccessfulRefresh:this.get('lastSuccess'), refreshStartedAt:cycle?.startedAt || null,
      stale:!this.get('lastSuccess') || this.clock()-Date.parse(this.get('lastSuccess'))>26*60*60_000,
      refreshInProgress:Boolean(cycle), progress:cycle?this.taskCounts(cycle.generation):null, backgroundRequests:cycle?.requests || 0, lastRefreshRequests:this.get('lastRefreshRequests') || 0,
      pendingSpeechRecoveries:{count:recoveryCount,examples:recoveryExamples},
      sourceCounts:Object.fromEntries(counts.map(c=>[c.kind,c.count])), currentMeps:this.db.prepare('SELECT COUNT(*) AS n FROM members').get().n,
      rosterFetchedAt:this.get('rosterFetchedAt'), lastError:cycle?.phase==='paused' ? cycle.error : cycle ? this.db.prepare('SELECT error FROM tasks WHERE generation=? AND (done=0 OR done IS NULL) AND error IS NOT NULL ORDER BY retry_at DESC LIMIT 1').get(cycle.generation)?.error || null : null, exclusiveWriterActive:Boolean(lease && lease.expires>this.clock()),
      unresolvedJoinCount:(this.get('unresolved') || []).length, unresolvedJoins:(this.get('unresolved') || []).slice(0,100), unresolvedCategories:[...new Set((this.get('unresolved') || []).map(join=>join.category || 'reports-shadow'))], unsupportedCategories:Object.entries(CATEGORY_GAPS).map(([category,reason])=>({category,label:CATEGORIES[category],reason})),
      dataSource:'European Parliament Open Data API v2', attribution:'European Parliament, CC BY 4.0', schedule:'Daily after 03:00 Europe/Brussels; interrupted initial loads resume automatically.' };
  }
  page(mep,{language='en',category=null,limit=10,offset=0,sourceId=null}={}) {
    const member=this.db.prepare('SELECT body FROM members WHERE id=?').get(String(mep));
    if (!member) return null;
    const status=this.status(), generation=status.servingGeneration;
    const activityOnly=" AND COALESCE(json_extract(body,'$.recordKind'),'document')<>'answer'";
    const where='generation=? AND mep=?'+activityOnly+(category?' AND category=?':'');
    const params=[generation,String(mep),...(category?[category]:[])];
    const total=this.db.prepare('SELECT COUNT(*) AS n FROM items WHERE '+where).get(...params).n;
    const sittingSources=new Map(), outcomes=new Map();
    const outcome=source=>{
      const id=source.work.identifier || source.work.id;
      if(!outcomes.has(id))outcomes.set(id,motionOutcome(source.work,source.fetchedAt,sittingId=>{
        if(!sittingSources.has(sittingId))sittingSources.set(sittingId,this.source(generation,motionSourceKey(sittingId)));
        return sittingSources.get(sittingId);
      }));
      return outcomes.get(id);
    };
    const present=body=>{
      const row=parse(body);
      if(row.recordKind==='document' && row.motionType) {
        const source=this.source(generation,'/plenary-documents/'+row.sourceId);
        if(source && isMotion(source.work)) {
          const relatedJointMotions=this.relatedJointMotions(generation,row.sourceId).map(joint=>{
            const id=joint.work.identifier, files=documentFiles(joint.work);
            const file=files.find(file=>file.language===language && file.format==='PDF') || files.find(file=>file.language==='en' && file.format==='PDF');
            const titles=joint.work.title_dcterms || {};
            return {sourceId:id,reference:motionReference(id),title:titles[language]||titles.en||id,outcome:outcome(joint),
              url:file?.url || 'https://data.europarl.europa.eu/eli/dl/doc/'+id};
          });
          return {...localize(row,language),resolutionOutcome:outcome(source),relatedJointMotions};
        }
      }
      if(row.recordKind==='answer'&&row.relatedQuestionId) {
        const question=this.source(generation,'/parliamentary-questions/'+row.relatedQuestionId)?.work;
        const titles=Object.assign({},...(question?.is_realized_by||[]).map(expression=>expression.title||{}),question?.title_dcterms||{});
        if(Object.keys(titles).length)return {...localize({...row,titles},language),relatedQuestionTitles:titles,relatedQuestionTitle:titles[language]||titles.en||Object.values(titles)[0]};
      }
      return localize(row,language);
    };
    const items=this.db.prepare('SELECT body FROM items WHERE '+where+' ORDER BY date DESC,source_id DESC,category LIMIT ? OFFSET ?').all(...params,limit,offset).map(r=>present(r.body));
    const selectedItems=sourceId?this.db.prepare('SELECT body FROM items WHERE generation=? AND mep=? AND source_id=? ORDER BY category').all(generation,String(mep),sourceId).map(r=>present(r.body)):[];
    const counts=Object.fromEntries(this.db.prepare('SELECT category,COUNT(*) AS count FROM items WHERE generation=? AND mep=?'+activityOnly+' GROUP BY category').all(generation,String(mep)).map(r=>[r.category,r.count]));
    const categoryCoverage=Object.fromEntries(Object.keys(CATEGORIES).map(id=> {
      const reason=CATEGORY_GAPS[id] || (status.unresolvedCategories.includes(id)?id==='reports-shadow'?'Some report-stage joins are unresolved.':'Some source relationships or dates are incomplete.':null) || (['motions','individual-motions'].includes(id) && counts['unclassified-motions']?'Some motions lack a verified EP-rule classification.':null);
      const state=CATEGORY_GAPS[id]?'source-not-verified':!status.complete?'backfilling':reason?'incomplete-joins':'available';
      return [id,{status:state,indexedCount:counts[id] || 0,total:state==='available'?counts[id] || 0:null,reason}];
    }));
    const exactTotal=category?categoryCoverage[category]?.status==='available':status.complete;
    return { mepId:Number(mep), member:parse(member.body), term:10, requestedLanguage:language, category, total:exactTotal?total:null, indexedTotal:total, offset, limit, nextOffset:offset+items.length<total?offset+items.length:null,
      order:'MEP activity/question date descending; answers remain attached to their question; source ID and category break ties', cache:status, categories:CATEGORIES, categoryGroups:CATEGORY_GROUPS, categoryCoverage, unclassifiedMotionCount:counts['unclassified-motions'] || 0, selectedItems, items };
  }
  close() { this.release();this.db.close(); }
}
