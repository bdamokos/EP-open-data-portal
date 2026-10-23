import {groupHistorySchema,freezeGroupHistory} from './group-history.mjs';
import {membershipSchema,freezeMembership} from './following-membership.mjs';
import {followMarksVersion,prepareFollowMarks,publishFollowMarks,followIndexComplete} from './follow-marks.mjs';
import {sourceMissing, missingSourceDelay} from './source-retry.mjs';
import {sourceTitle} from './source-titles.mjs';
import {languagePreference} from './language-order.mjs';
import {activityReadVersion,initializeActivityReads,prepareQuestionFiles,projectQuestionFiles,copyQuestionFiles,motionDocuments} from './activity-read-projections.mjs';
import {groupVoicesSchema,groupVoicesCopy,groupVoicesPrune,recordGroupVoice} from './group-voices-store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CATEGORIES, CATEGORY_GROUPS, CATEGORY_GAPS, localize, documentFiles, documentRows } from './activity-index-model.mjs';
import { isMotion, motionOutcome, motionReference, motionSourceKey } from './motion-outcomes.mjs';
import { amendmentReadVersion, amendmentReadIndexes, amendmentsSchema, amendmentsCopy, amendmentsPrune, amendmentFailureSummary, amendmentGeneration } from './amendments-store.mjs';
import {outsideSchema,outsideCopy,outsidePrune} from './outside-store.mjs';
import {observeSqlite} from './sqlite-observability.mjs';
import {refreshPolicyTables,refreshPolicySchema,updateDocumentRefresh,updateSittingRefresh,assertRefreshSnapshot,refreshSnapshotMatches} from './refresh-policy.mjs';

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
  constructor(directory, { clock = Date.now, initializeIndexes=false, prepareLog=()=>{} } = {}) {
    mkdirSync(directory, { recursive: true });
    this.prepareLog=prepareLog;this.clock = clock; this.owner = randomUUID();
    this.filename = path.join(directory, 'activities-v1.sqlite');
    this.initializeIndexes=initializeIndexes||!existsSync(this.filename);
    this.db = observeSqlite(new DatabaseSync(this.filename),'activity');
    if(!this.initializeIndexes) {
      try {
        if(this.get('resourceIndexes')!==1||this.get('amendmentReadVersion')!==amendmentReadVersion||this.get('motionLinksIndexVersion')!==1||this.get('activityReadVersion')!==activityReadVersion||this.get('refreshPolicyVersion')!==1||this.get('followMarksVersion')!==followMarksVersion)throw new Error('Unprepared activity indexes.');
      } catch {this.db.close();throw new Error('Activity indexes need preparation. Stop the app and run node server/migrate-indexes.mjs before starting it.');}
    }
    if(this.initializeIndexes)this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;
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
    if(!this.initializeIndexes)this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;');
    if (this.get('schema') !== 1) throw new Error('Unsupported activity-index schema.');
    try {assertRefreshSnapshot(this);}catch(error){this.db.close();throw error;}
    membershipSchema(this.db);groupHistorySchema(this.db);
    if(this.initializeIndexes){outsideSchema(this.db);amendmentsSchema(this.db);groupVoicesSchema(this.db);refreshPolicyTables(this.db);}
  }
  get(key) { return parse(this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value); }
  set(key,value) { this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key,JSON.stringify(value)); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const out=fn(); this.db.exec('COMMIT'); return out; }
    catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  acquire(ttl=90_000) {
    let initialized=false;
    const acquired=this.transaction(()=> {
      const old=this.db.prepare('SELECT * FROM lease WHERE id=1').get();
      if (old && old.owner!==this.owner && old.expires>this.clock()) return false;
      assertRefreshSnapshot(this);
      const initialize=this.get('resourceIndexes')!==1,initializeProofs=this.get('amendmentReadVersion')!==amendmentReadVersion;
      if((initialize||initializeProofs||this.get('activityReadVersion')!==activityReadVersion||this.get('followMarksVersion')!==followMarksVersion)&&!this.initializeIndexes)throw new Error('Run node server/migrate-indexes.mjs before starting the app.');
      this.db.prepare('INSERT OR REPLACE INTO lease VALUES (1,?,?)').run(this.owner,this.clock()+ttl);
      // BEGIN IMMEDIATE prevents takeover throughout synchronous initialization.
      // Refresh against the current clock before commit; elapsed build time must
      // never roll back a completed build solely because its old TTL expired.
      const refresh=()=>{if(this.db.prepare('UPDATE lease SET expires=? WHERE id=1 AND owner=?').run(this.clock()+ttl,this.owner).changes!==1)throw new Error('Activity-index writer lease was lost.');};
      if(initialize){this.initializeResourceIndexes();initialized=true;refresh();}
      if(initializeProofs){amendmentReadIndexes(this.db);this.set('amendmentReadVersion',amendmentReadVersion);initialized=true;refresh();}
      if(this.get('motionLinksIndexVersion')!==1) {
        this.assertWriter();
        this.db.exec('INSERT OR IGNORE INTO motion_links '+motionLinkSelect('source','sources AS source, '));
        refresh();this.assertWriter();
        this.set('motionLinksIndexVersion',1);
      }
      if(this.get('activityReadVersion')!==activityReadVersion) {
        initializeActivityReads(this.db);prepareQuestionFiles(this.db,this.prepareLog);
        this.set('activityReadVersion',activityReadVersion);initialized=true;refresh();
      }
      if(this.get('refreshPolicyVersion')!==1) {
        if(!this.initializeIndexes)throw new Error('Run node server/migrate-indexes.mjs before starting the app.');
        refreshPolicySchema(this);initialized=true;refresh();
      }
      if(this.get('followMarksVersion')!==followMarksVersion) {
        prepareFollowMarks(this);initialized=true;refresh();
      }
      refresh();
      return true;
    });
    if(acquired&&initialized)this.db.exec('PRAGMA main.wal_checkpoint(TRUNCATE)');
    return acquired;
  }
  // Increment resourceIndexes and rebuild these projections if relationship SQL changes.
  initializeResourceIndexes() {
    this.assertWriter();
    for(const sql of [
      'CREATE INDEX IF NOT EXISTS task_pending_order ON tasks(generation,priority DESC,key DESC,retry_at) WHERE done IN (-1,0) OR done IS NULL',
      'CREATE INDEX IF NOT EXISTS task_pending_due ON tasks(generation,retry_at) WHERE done IN (-1,0) OR done IS NULL',
      'CREATE INDEX IF NOT EXISTS task_counts ON tasks(generation,done,error,kind)',
      "CREATE INDEX IF NOT EXISTS task_sitting ON tasks(generation,kind,json_extract(body,'$.sittingId'),done)",
      "CREATE INDEX IF NOT EXISTS amendment_job_sitting ON amendment_jobs(generation,kind,json_extract(body,'$.sittingId'),done)",
      "CREATE INDEX IF NOT EXISTS task_recoveries ON tasks(generation,key) WHERE done=0 AND kind='speeches' AND json_extract(body,'$.recoveryId') IS NOT NULL",
      'CREATE INDEX IF NOT EXISTS task_last_error ON tasks(generation,retry_at DESC,error) WHERE (done IN (-1,0) OR done IS NULL) AND error IS NOT NULL',
      'CREATE INDEX IF NOT EXISTS source_kind_key ON sources(generation,kind,key)',
      "CREATE INDEX IF NOT EXISTS source_identifier ON sources(generation,kind,json_extract(body,'$.identifier'))",
      "CREATE INDEX IF NOT EXISTS question_window ON sources(generation,json_extract(body,'$.document_date') DESC,key) WHERE kind='document' AND (json_extract(body,'$.work_type') LIKE '%/QUESTION_WRITTEN' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_WRITTEN_PRIORITY' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_ORAL')",
      "CREATE INDEX IF NOT EXISTS amendment_preparation ON sources(generation,kind,key) WHERE json_extract(body,'$.work_type') LIKE '%/REPORT_PLENARY' OR json_extract(body,'$.work_type') LIKE '%/RESOLUTION_MOTION' OR json_extract(body,'$.work_type') LIKE '%/RESOLUTION_MOTION_JOINT'",
      'CREATE INDEX IF NOT EXISTS amendment_job_pending ON amendment_jobs(generation,priority DESC,key DESC,retry_at) WHERE done=0',
      'CREATE INDEX IF NOT EXISTS group_voice_job_pending ON group_voice_jobs(generation,priority DESC,key DESC,retry_at) WHERE done=0',
      "CREATE INDEX IF NOT EXISTS outside_agenda_upgrade ON outside_contributions(generation,speech) WHERE json_array_length(body,'$.parentIds')>1 AND (COALESCE(json_type(body,'$.parentDocumentIds'),'')<>'array' OR COALESCE(json_type(body,'$.parentDocumentsComplete'),'') NOT IN ('true','false'))",
      "CREATE INDEX IF NOT EXISTS outside_term_date ON outside_contributions(generation,json_extract(body,'$.term'),date DESC,speech)",
      'CREATE INDEX IF NOT EXISTS outside_directory_date ON outside_contributions(generation,date DESC,speech)',
      "CREATE INDEX IF NOT EXISTS outside_unresolved ON outside_contributions(generation,speech) WHERE json_extract(body,'$.header.name') IS NULL OR json_array_length(body,'$.parentIds')=0",
      "CREATE INDEX IF NOT EXISTS amendment_failure_status ON amendment_split_failures(json_extract(body,'$.status'))",
    ])this.db.exec(sql);
    // Invert the exact multi-valued report relationship once, instead of
    // parsing every report body again for every procedure-detail task.
    this.db.exec('CREATE TABLE IF NOT EXISTS report_procedures(generation INTEGER,procedure_ref TEXT,source_key TEXT,PRIMARY KEY(generation,procedure_ref,source_key))');
    this.db.exec('CREATE INDEX IF NOT EXISTS report_procedure_source ON report_procedures(generation,source_key)');
    const links=source=>`SELECT ${source}.generation,${originalMotionRef},${source}.key FROM json_each(${source}.body,'$.inverse_created_a_realization_of') ref WHERE ${source}.kind='document' AND json_extract(${source}.body,'$.work_type') LIKE '%/REPORT_PLENARY'`;
    for(const [event,reference] of [['INSERT','NEW'],['UPDATE OF body,kind','NEW'],['DELETE',null]])this.db.exec(`CREATE TRIGGER IF NOT EXISTS report_procedures_${event.split(' ')[0].toLowerCase()} AFTER ${event} ON sources BEGIN
      DELETE FROM report_procedures WHERE generation=${reference||'OLD'}.generation AND source_key=${reference||'OLD'}.key;
      ${reference?'INSERT OR IGNORE INTO report_procedures '+links(reference)+';':''} END`);
    this.db.exec(`INSERT OR IGNORE INTO report_procedures SELECT source.generation,${originalMotionRef},source.key FROM sources source,json_each(source.body,'$.inverse_created_a_realization_of') ref WHERE source.kind='document' AND json_extract(source.body,'$.work_type') LIKE '%/REPORT_PLENARY'`);
    this.db.exec('CREATE TABLE IF NOT EXISTS amendment_sitting_references(generation INTEGER,version INTEGER,reference TEXT COLLATE NOCASE,source_key TEXT,PRIMARY KEY(generation,version,reference,source_key))');
    this.db.exec('CREATE INDEX IF NOT EXISTS amendment_sitting_source ON amendment_sitting_references(generation,source_key)');
    const references=(source,from='')=>`SELECT ${source}.generation,COALESCE(json_extract(${source}.body,'$.amendmentEvidence.amendmentVersion'),json_extract(${source}.body,'$.amendmentVersion')),${originalMotionRef},${source}.key
      FROM ${from}json_each(COALESCE(json_extract(${source}.body,'$.amendmentEvidence.decisions'),json_extract(${source}.body,'$.decisions'))) decision,
      json_each(decision.value,'$.decided_on_a_realization_of') ref WHERE ${source}.kind='motion-outcomes' AND ref.type='text'`;
    for(const [event,ref] of [['INSERT','NEW'],['UPDATE OF body,kind','NEW'],['DELETE',null]])this.db.exec(`CREATE TRIGGER IF NOT EXISTS amendment_sitting_${event.split(' ')[0].toLowerCase()} AFTER ${event} ON sources BEGIN
      DELETE FROM amendment_sitting_references WHERE generation=${ref||'OLD'}.generation AND source_key=${ref||'OLD'}.key;
      ${ref?'INSERT OR IGNORE INTO amendment_sitting_references '+references(ref)+';':''} END`);
    this.db.exec('INSERT OR IGNORE INTO amendment_sitting_references '+references('source','sources source,'));
    this.set('resourceIndexes',1);
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
      assertRefreshSnapshot(this);
      const working=this.get('working');
      if (working) { groupVoicesCopy(this.db,working.generation,this.get('active') || 0); amendmentsCopy(this.db,working.generation,this.get('active') || 0); return working; }
      const active=this.get('active') || 0, generation=(this.get('sequence') || 0)+1;
      this.set('sequence',generation);
      if (active) {
        this.pruneGenerations(active);
        this.set('previous',null);
        this.db.prepare('INSERT INTO sources SELECT ?,key,kind,body,fetched_at,0 FROM sources WHERE generation=?').run(generation,active);
        this.db.prepare('INSERT INTO items SELECT ?,source_key,source_id,mep,category,date,body FROM items WHERE generation=?').run(generation,active);
        copyQuestionFiles(this.db,generation,active);
        this.db.prepare('INSERT INTO refresh_gaps SELECT ?,key,kind,body,priority,error,attempts,failed_at,retry_at,sitting_id FROM refresh_gaps WHERE generation=?').run(generation,active);
        this.db.prepare('INSERT INTO refresh_gap_admissions SELECT ?,key FROM refresh_gap_admissions WHERE generation=?').run(generation,active);
        this.db.prepare('INSERT INTO sitting_refresh SELECT ?,sitting_id,next_check FROM sitting_refresh WHERE generation=?').run(generation,active);
        this.db.prepare('INSERT INTO feed_catalog_recovery SELECT ?,endpoint,start,end FROM feed_catalog_recovery WHERE generation=?').run(generation,active);
        // Preserve bounded selection progress across generations.
        this.db.prepare('INSERT INTO mutable_documents SELECT ?,key,next_check FROM mutable_documents WHERE generation=?').run(generation,active);
        for(const table of ['refresh_gaps','refresh_gap_admissions','mutable_documents','continuation_sittings','sitting_refresh','feed_catalog_recovery'])this.db.prepare(`DELETE FROM ${table} WHERE generation NOT IN (?,?)`).run(active,generation);
        outsideCopy(this.db,generation,active);
        groupVoicesCopy(this.db,generation,active);
        amendmentsCopy(this.db,generation,active);
      }
      // The copied active rows are unchanged; only later writes are touched.
      this.db.exec('DELETE FROM follow_touched');
      const cycle={ generation, initial:!active, startedAt:new Date(this.clock()).toISOString(), phase:'discovering', error:null, requests:0 };
      this.set('working',cycle);return cycle;
    });
  }
  updateCycle(values) { this.assertWriter();this.set('working',{...this.get('working'),...values}); }
  enqueue(generation,key,kind,body,priority=50,refreshCompleted=false,{retryGap=false}={}) {
    const enqueue=()=>{
      this.assertWriter();
      const gap=this.db.prepare('SELECT kind,body,priority,retry_at,attempts FROM refresh_gaps WHERE generation=? AND key=?').get(generation,key);
      if(gap) {
        if(!retryGap || gap.retry_at>this.clock() || this.db.prepare('SELECT 1 FROM refresh_gap_admissions WHERE generation=? AND key=?').get(generation,key))return false;
        // Admission and its marker commit together. Checkpoints retain any
        // subsequently progressed cursor until completion or another failure.
        kind=gap.kind;body=parse(gap.body);priority=gap.priority;
      }
      const outside=kind.startsWith('outside-') || body.outsideOnly || key.startsWith('outside:upgrade:');
      const pending=outside?-1:kind==='motion-outcomes'?null:0;
      this.db.prepare('INSERT OR IGNORE INTO tasks(generation,key,kind,body,priority,done) VALUES (?,?,?,?,?,?)').run(generation,key,kind,JSON.stringify(body),priority,pending);
      if(refreshCompleted)this.db.prepare('UPDATE tasks SET done=?,attempts=0,error=NULL,retry_at=0,body=?,priority=? WHERE generation=? AND key=? AND done=1').run(pending,JSON.stringify(body),priority,generation,key);
      if(gap) {
        this.db.prepare('UPDATE tasks SET attempts=? WHERE generation=? AND key=?').run(gap.attempts,generation,key);
        this.db.prepare('INSERT OR IGNORE INTO refresh_gap_admissions VALUES (?,?)').run(generation,key);
      }
      return true;
    };
    return retryGap&&!this.db.isTransaction?this.transaction(enqueue):enqueue();
  }
  hasDueTask(generation) {return Boolean(this.db.prepare('SELECT 1 FROM tasks INDEXED BY task_pending_due WHERE generation=? AND (done IN (-1,0) OR done IS NULL) AND retry_at<=? LIMIT 1').get(generation,this.clock()));}
  nextTask(generation) { if(!this.hasDueTask(generation))return;const r=this.db.prepare('SELECT * FROM tasks INDEXED BY task_pending_order WHERE generation=? AND (done IN (-1,0) OR done IS NULL) AND retry_at<=? ORDER BY priority DESC,key DESC LIMIT 1').get(generation,this.clock()); return r && {...r,body:parse(r.body)}; }
  taskProgress(task,body) { this.assertWriter();this.db.prepare(`UPDATE ${task.groupVoiceJob?'group_voice_jobs':task.amendmentJob?'amendment_jobs':'tasks'} SET body=?,attempts=0,error=NULL,retry_at=0 WHERE generation=? AND key=?`).run(JSON.stringify(body),task.generation,task.key); }
  finishTask(task) {
    const finish=()=>{
      this.assertWriter();this.db.prepare(`UPDATE ${task.groupVoiceJob?'group_voice_jobs':task.amendmentJob?'amendment_jobs':'tasks'} SET done=1,error=NULL WHERE generation=? AND key=?`).run(task.generation,task.key);
      if(!task.groupVoiceJob) {
        this.db.prepare('DELETE FROM refresh_gaps WHERE generation=? AND key=?').run(task.generation,task.key);
        this.db.prepare('DELETE FROM refresh_gap_admissions WHERE generation=? AND key=?').run(task.generation,task.key);
      }
    };
    return this.db.isTransaction?finish():this.transaction(finish);
  }
  failTask(task,error) {
    this.assertWriter();const delay=Math.max(Number(error.retryAfter || 0)*1000,sourceMissing(error)?missingSourceDelay(task.attempts):Math.min(30*60_000,30_000*2**Math.min(task.attempts,6)));
    this.db.prepare(`UPDATE ${task.groupVoiceJob?'group_voice_jobs':task.amendmentJob?'amendment_jobs':'tasks'} SET attempts=attempts+1,retry_at=?,error=? WHERE generation=? AND key=?`).run(this.clock()+delay,String(error.message).slice(0,350),task.generation,task.key);
    if(!task.groupVoiceJob&&this.get('working')?.generation===task.generation)this.updateCycle({phase:'retrying',error:String(error.message).slice(0,350)});
  }
  taskCounts(generation) { return this.db.prepare('SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN done=1 THEN 1 ELSE 0 END),0) AS completed,COALESCE(SUM(CASE WHEN (done IN (-1,0) OR done IS NULL) AND error IS NOT NULL THEN 1 ELSE 0 END),0) AS retrying FROM tasks WHERE generation=?').get(generation); }
  source(generation,key) { const s=this.db.prepare('SELECT * FROM sources WHERE generation=? AND key=?').get(generation,key);return s && {work:parse(s.body),fetchedAt:s.fetched_at}; }
  sources(generation,kind,workType=null) {
    const rows=this.db.prepare('SELECT key,body,fetched_at FROM sources WHERE generation=? AND kind=?'+(workType?" AND json_extract(body,'$.work_type') LIKE ?":'')).all(generation,kind,...(workType?['%/'+workType]:[]));
    return rows.map(s=>({key:s.key,work:parse(s.body),fetchedAt:s.fetched_at}));
  }
  *iterateSources(generation,kind) {
    for(const source of this.db.prepare('SELECT key,body,fetched_at FROM sources WHERE generation=? AND kind=?').iterate(generation,kind))
      yield {key:source.key,work:parse(source.body),fetchedAt:source.fetched_at};
  }
  *motionDocuments(generation) {
    for(const source of this.db.prepare('SELECT key,body,fetched_at FROM sources INDEXED BY motion_documents WHERE generation=? AND '+motionDocuments).iterate(generation))
      yield {key:source.key,work:parse(source.body),fetchedAt:source.fetched_at};
  }
  *reportsForProcedure(generation,id) {
    const relative='eli/dl/proc/'+id;
    const sql=`SELECT source.key,source.body,source.fetched_at FROM report_procedures link
      JOIN sources source ON source.generation=link.generation AND source.key=link.source_key
      WHERE link.generation=? AND link.procedure_ref=?`;
    for(const source of this.db.prepare(sql).iterate(generation,relative))
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
      projectQuestionFiles(this.db,generation,key,kind,work);
      if(kind==='document')updateDocumentRefresh(this,generation,key,work,fetchedAt);
      if(kind==='motion-outcomes')updateSittingRefresh(this,generation,key,work,fetchedAt);
      this.replaceRows(generation,key,rows);
      if(Object.hasOwn(work,'groupVoices'))recordGroupVoice(this,generation,work.groupVoices,work.outside,work.id);
    });
  }
  replaceRows(generation,key,rows) {
    this.assertWriter();
    const touch=this.db.prepare('INSERT OR IGNORE INTO follow_touched VALUES (?,?)');
    touch.run(generation,key);
    this.db.prepare('DELETE FROM items WHERE generation=? AND source_key=?').run(generation,key);
    const put=this.db.prepare('INSERT OR REPLACE INTO items VALUES (?,?,?,?,?,?,?)');
    const displaced=this.db.prepare('SELECT source_key FROM items WHERE generation=? AND source_id=? AND mep=? AND category=?');
    for (const row of rows) {
      // REPLACE can delete another source's row through the identity/category PK.
      const old=displaced.get(generation,row.sourceId,String(row.mepId),row.category);
      if(old&&old.source_key!==key)touch.run(generation,old.source_key);
      put.run(generation,key,row.sourceId,String(row.mepId),row.category,row.date,JSON.stringify(row));
    }
  }
  setMembers(nodes) {
    this.transaction(()=>{ this.assertWriter();this.db.exec('DELETE FROM members');const q=this.db.prepare('INSERT OR REPLACE INTO members VALUES (?,?)');
      for (const n of nodes) q.run(String(n.id),JSON.stringify(n));this.set('rosterFetchedAt',new Date(this.clock()).toISOString()); });
  }
  publish(generation,unresolved=[]) {
    this.transaction(()=> {
      this.assertWriter();assertRefreshSnapshot(this);const progress=this.taskCounts(generation);
      if (progress.total!==progress.completed) throw new Error('Cannot publish an incomplete generation.');
      const old=this.get('active');this.set('lastRefreshRequests',this.get('working')?.requests || 0);this.set('previous',old);this.set('active',generation);this.set('working',null);
      this.set('refreshPolicyGeneration',generation);
      const publishedAt=new Date(this.clock()).toISOString();
      publishFollowMarks(this,generation,publishedAt,followIndexComplete(this,generation),old);
      freezeMembership(this,generation,old);freezeGroupHistory(this,generation,old);
      this.set('lastSuccess',publishedAt);this.set('unresolved',unresolved);
      // Retain the immediately previous generation for recovery; cache is reproducible public data.
      this.pruneGenerations(generation,old || generation);
      outsidePrune(this.db,generation,old);
      amendmentsPrune(this.db,generation,old);
      groupVoicesPrune(this.db,generation,old);
    });
  }
  pruneGenerations(first,second=first) {
    const low=Math.min(first,second),high=Math.max(first,second);
    // NOT IN / <> scans all retained item bodies even when nothing is deleted.
    // Separate indexed ranges also handle a nonadjacent recovery generation.
    for(const table of ['sources','items','tasks','follow_summary','follow_generations','follow_touched','membership_snapshots','group_history_snapshots']) {
      this.db.prepare(`DELETE FROM ${table} WHERE generation<?`).run(low);
      this.db.prepare(`DELETE FROM ${table} WHERE generation>?`).run(high);
      if(low!==high)this.db.prepare(`DELETE FROM ${table} WHERE generation>? AND generation<?`).run(low,high);
    }
  }
  status() {
    const cycle=this.get('working'), active=this.get('active'), generation=active || cycle?.generation || 0;
    const counts=this.db.prepare('SELECT kind,COUNT(*) AS count FROM sources WHERE generation=? GROUP BY kind').all(generation);
    const lease=this.db.prepare('SELECT expires FROM lease WHERE id=1').get();
    const recoveryGeneration=cycle?.generation || generation;
    const recoveryWhere="generation=? AND done=0 AND kind='speeches' AND json_extract(body,'$.recoveryId') IS NOT NULL";
    const recoveryCount=this.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE '+recoveryWhere).get(recoveryGeneration).n;
    const recoveryExamples=this.db.prepare('SELECT body,attempts,retry_at,error FROM tasks WHERE '+recoveryWhere+' ORDER BY key LIMIT 20').all(recoveryGeneration).map(task=>{const body=parse(task.body);return {sourceId:body.recoveryId,detectedAt:body.detectedAt,searchWindow:body.searchWindow,attempts:task.attempts,nextRetryAt:new Date(task.retry_at || this.clock()).toISOString(),lastError:task.error};});
    const gapCount=this.db.prepare('SELECT COUNT(*) AS n FROM refresh_gaps WHERE generation=?').get(generation).n;
    const gapExamples=this.db.prepare("SELECT key,kind,error,attempts,failed_at AS failedAt,CASE WHEN kind='coverage' THEN NULL ELSE retry_at END AS retryAt,sitting_id AS sittingId,json_extract(body,'$.endpoint') AS endpoint,json_extract(body,'$.recoveryId') AS sourceId,json_extract(body,'$.start') AS start,json_extract(body,'$.end') AS end FROM refresh_gaps WHERE generation=? ORDER BY key LIMIT 20").all(generation).map(gap=>({...gap,retryAt:gap.retryAt===null?null:new Date(gap.retryAt).toISOString()}));
    const refreshSnapshotReady=refreshSnapshotMatches(this);
    return { schemaVersion:1, enabled:true, term:10, complete:Boolean(active)&&gapCount===0&&refreshSnapshotReady, servingGeneration:generation,
      refreshSnapshotReady,
      coverageGaps:{count:gapCount,examples:gapExamples},
      phase:cycle?.phase || (active?'ready':'waiting'), lastSuccessfulRefresh:this.get('lastSuccess'), refreshStartedAt:cycle?.startedAt || null,
      stale:!this.get('lastSuccess') || this.clock()-Date.parse(this.get('lastSuccess'))>26*60*60_000,
      refreshInProgress:Boolean(cycle), progress:cycle?this.taskCounts(cycle.generation):null, backgroundRequests:cycle?.requests || 0, lastRefreshRequests:this.get('lastRefreshRequests') || 0,
      amendments:{indexed:this.db.prepare('SELECT COUNT(*) AS n FROM amendments WHERE generation=?').get(amendmentGeneration(this)).n,servingGeneration:amendmentGeneration(this),failures:amendmentFailureSummary(this)},
      pendingSpeechRecoveries:{count:recoveryCount,examples:recoveryExamples},
      sourceCounts:Object.fromEntries(counts.map(c=>[c.kind,c.count])), currentMeps:this.db.prepare('SELECT COUNT(*) AS n FROM members').get().n,
      rosterFetchedAt:this.get('rosterFetchedAt'), lastError:cycle?.phase==='paused' ? cycle.error : cycle ? this.db.prepare('SELECT error FROM tasks WHERE generation=? AND (done IN (-1,0) OR done IS NULL) AND error IS NOT NULL ORDER BY retry_at DESC LIMIT 1').get(cycle.generation)?.error || null : null, exclusiveWriterActive:Boolean(lease && lease.expires>this.clock()),
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
            const id=joint.work.identifier, files=documentFiles(joint.work).filter(file=>['PDF','DOCX'].includes(file.format));
            const preferred=code=>files.find(file=>file.language===code && file.format==='PDF') || files.find(file=>file.language===code);
            const fileLanguage=languagePreference(files.map(file=>file.language).filter(Boolean),language)[0];
            const file=preferred(fileLanguage) || files[0];
            const titles=joint.work.title_dcterms || {};
            const authors=documentRows(joint.work,joint.key,joint.fetchedAt).rows;
            return {sourceId:id,reference:motionReference(id),title:titles[languagePreference(Object.keys(titles).filter(code=>titles[code]?.trim()),language)[0]]||id,outcome:outcome(joint),
              memberAuthorship:authors.some(author=>author.mepId===String(mep))?'recorded':'not-recorded',
              url:file?.url || null,documentFormat:file?.format || null,documentLanguage:file?.language || null};
          });
          return {...localize(row,language),reference:motionReference(row.sourceId),resolutionOutcome:outcome(source),relatedJointMotions};
        }
      }
      if(row.recordKind==='answer'&&row.relatedQuestionId) {
        const question=this.source(generation,'/parliamentary-questions/'+row.relatedQuestionId)?.work;
        const titles=Object.assign({},...(question?.is_realized_by||[]).map(expression=>expression.title||{}),question?.title_dcterms||{});
        if(Object.keys(titles).length)return {...localize({...row,titles},language),relatedQuestionTitles:titles,relatedQuestionTitle:sourceTitle(titles[languagePreference(Object.keys(titles).filter(code=>titles[code]?.trim()),language)[0]])};
      }
      return localize(row,language);
    };
    const items=this.db.prepare('SELECT body FROM items WHERE '+where+' ORDER BY date DESC,source_id DESC,category LIMIT ? OFFSET ?').all(...params,limit,offset).map(r=>present(r.body));
    const selectedItems=sourceId?this.db.prepare('SELECT body FROM items WHERE generation=? AND mep=? AND source_id=? ORDER BY category').all(generation,String(mep),sourceId).map(r=>present(r.body)):[];
    const counts=Object.fromEntries(this.db.prepare('SELECT category,COUNT(*) AS count FROM items WHERE generation=? AND mep=?'+activityOnly+' GROUP BY category').all(generation,String(mep)).map(r=>[r.category,r.count]));
    const categoryCoverage=Object.fromEntries(Object.keys(CATEGORIES).map(id=> {
      const reason=CATEGORY_GAPS[id] || (!status.refreshSnapshotReady?'Refresh state requires offline reconciliation.':null) || (status.coverageGaps.count?'Some source records or refresh windows remain unavailable.':null) || (status.unresolvedCategories.includes(id)?id==='reports-shadow'?'Some report-stage joins are unresolved.':'Some source relationships or dates are incomplete.':null) || (['motions','individual-motions'].includes(id) && counts['unclassified-motions']?'Some motions lack a verified EP-rule classification.':null);
      const state=CATEGORY_GAPS[id]?'source-not-verified':status.coverageGaps.count||!status.refreshSnapshotReady?'incomplete-joins':!status.complete?'backfilling':reason?'incomplete-joins':'available';
      return [id,{status:state,indexedCount:counts[id] || 0,total:state==='available'?counts[id] || 0:null,reason}];
    }));
    const exactTotal=category?categoryCoverage[category]?.status==='available':status.complete;
    return { mepId:Number(mep), member:parse(member.body), term:10, requestedLanguage:language, category, total:exactTotal?total:null, indexedTotal:total, offset, limit, nextOffset:offset+items.length<total?offset+items.length:null,
      order:'MEP activity/question date descending; answers remain attached to their question; source ID and category break ties', cache:status, categories:CATEGORIES, categoryGroups:CATEGORY_GROUPS, categoryCoverage, unclassifiedMotionCount:counts['unclassified-motions'] || 0, selectedItems, items };
  }
  close() { this.release();this.db.close(); }
}
