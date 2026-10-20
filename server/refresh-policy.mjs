import {array, tail, documentFiles} from './activity-index-model.mjs';
import {AMENDMENTS_VERSION,AMENDMENT_SITTING_PROJECTION_VERSION} from './amendments.mjs';

export const DAY=86_400_000, MUTABLE_LIMIT=100, GAP_LIMIT=25;
const official=new Set('bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(' '));
const localDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function refreshSnapshotMatches(store) {
  const accepted=store.get('refreshPolicyGeneration');
  return accepted==null || accepted===store.get('active');
}
export function assertRefreshSnapshot(store) {
  if(!refreshSnapshotMatches(store))throw new Error('Refresh policy snapshot does not match the active generation. Restore or reconcile the matching snapshot offline before continuing.');
}
export function sittingConfirmationDay(sittingId) {
  const date=Date.parse(sittingId.slice(7)),weekday=(new Date(date).getUTCDay()+6)%7;
  // Current plenary guidance: Friday noon of the second week following
  // the part-session. Saturday adds a local-calendar safety margin.
  return new Date(Math.max(date+15*DAY,date+(19-weekday)*DAY)).toISOString().slice(0,10);
}
export function sittingOutcomesComplete(work) {
  const evidence=work?.amendmentEvidence || work;
  return Boolean(work && !work.truncated && !evidence.retainedEvidence && !evidence.truncated && !evidence.splitProjectionTruncated && !work.lastRefreshFailure && !evidence.lastRefreshFailure &&
    Array.isArray(work.results) && work.results.length>0 && Array.isArray(work.decisions) && work.decisions.length>0 && Array.isArray(work.coverage?.missingResultIds) && Array.isArray(work.coverage?.missingDecisionIds) &&
    !work.coverage.missingResultIds.length && !work.coverage.missingDecisionIds.length && evidence.amendmentVersion===AMENDMENTS_VERSION &&
    evidence.amendmentProjectionVersion===AMENDMENT_SITTING_PROJECTION_VERSION && Array.isArray(evidence.splitRequests));
}
export function sittingSnapshotConfirmed(work,sittingId,fetchedAt) {
  const dates=[fetchedAt,...[work?.resultsFetchedAt,work?.decisionsFetchedAt].filter(Boolean),...array(work?.sources).map(source=>source.fetchedAt)];
  return sittingOutcomesComplete(work) && dates.every(value=>Number.isFinite(Date.parse(value)) && localDay(Date.parse(value))>=sittingConfirmationDay(sittingId));
}
export function updateSittingRefresh(store,generation,key,work,fetchedAt) {
  const sittingId=key.replace(/^motion-outcomes:/,'');
  if(!/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(sittingId))return;
  const confirmation=Date.parse(sittingConfirmationDay(sittingId)),fetched=Date.parse(fetchedAt);
  const final=sittingSnapshotConfirmed(work,sittingId,fetchedAt);
  const next=final?Number.MAX_SAFE_INTEGER:fetched+(fetched<confirmation?6*60*60_000:7*DAY);
  store.db.prepare('INSERT OR REPLACE INTO sitting_refresh VALUES (?,?,?)').run(generation,sittingId,next);
}
export function documentRefreshState(work) {
  const languages=new Set(documentFiles(work).map(file=>file.language).filter(code=>official.has(code)));
  const observed=work.languageVersionsObserved ?? array(work.is_realized_by).length>0;
  const languageCount=observed?languages.size:null;
  const question=['QUESTION_WRITTEN','QUESTION_WRITTEN_PRIORITY','QUESTION_ORAL'].includes(tail(work.work_type));
  const answers=array(work.inverse_answers_to);
  const hasAnswer=answers.some(answer=>answer && typeof answer==='object' && (answer.identifier || answer.id));
  const answered=question?(hasAnswer?true:work.answersObserved===true?false:null):null;
  const answerLanguagesComplete=!question || answered && answers.every(answer=>answer && typeof answer==='object' && documentRefreshState({...answer,work_type:'ANSWER'}).languageCount===24);
  return {languageCount,answered,mutable:languageCount!==24 || question && (!answered || !answerLanguagesComplete)};
}
export function updateDocumentRefresh(store,generation,key,work,fetchedAt) {
  if(documentRefreshState(work).mutable)store.db.prepare('INSERT OR REPLACE INTO mutable_documents VALUES (?,?,?)').run(generation,key,(Date.parse(fetchedAt)||0)+7*DAY);
  else store.db.prepare('DELETE FROM mutable_documents WHERE generation=? AND key=?').run(generation,key);
}

// Built only by explicit preparation or the leased writer on a new database.
// Triggers invert the bounded continuation document once per change, rather
// than parsing its three arrays once per sitting candidate.
export function refreshPolicyTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS mutable_documents(generation INTEGER,key TEXT,next_check INTEGER,PRIMARY KEY(generation,key));
    CREATE INDEX IF NOT EXISTS mutable_document_due ON mutable_documents(generation,next_check,key);
    CREATE TABLE IF NOT EXISTS refresh_gaps(generation INTEGER,key TEXT,kind TEXT,body TEXT,priority INTEGER,error TEXT,attempts INTEGER,failed_at TEXT,retry_at INTEGER,sitting_id TEXT,PRIMARY KEY(generation,key));
    CREATE INDEX IF NOT EXISTS refresh_gap_due ON refresh_gaps(generation,retry_at,key);
    CREATE INDEX IF NOT EXISTS refresh_gap_sitting ON refresh_gaps(generation,sitting_id,retry_at);
    CREATE INDEX IF NOT EXISTS refresh_gap_endpoint ON refresh_gaps(generation,kind,json_extract(body,'$.endpoint'));
    CREATE TABLE IF NOT EXISTS refresh_gap_admissions(generation INTEGER,key TEXT,PRIMARY KEY(generation,key));
    CREATE INDEX IF NOT EXISTS task_feed_endpoint ON tasks(generation,kind,json_extract(body,'$.endpoint'),done);
    CREATE TABLE IF NOT EXISTS feed_catalog_recovery(generation INTEGER,endpoint TEXT,start TEXT,end TEXT,PRIMARY KEY(generation,endpoint,start));
    CREATE TABLE IF NOT EXISTS sitting_refresh(generation INTEGER,sitting_id TEXT,next_check INTEGER,PRIMARY KEY(generation,sitting_id));
    CREATE INDEX IF NOT EXISTS sitting_refresh_due ON sitting_refresh(generation,next_check,sitting_id);
    CREATE TABLE IF NOT EXISTS continuation_sittings(generation INTEGER,sitting_id TEXT,bucket TEXT,key TEXT,PRIMARY KEY(generation,sitting_id,bucket,key));`);
}
export function refreshPolicySchema(store) {
  const db=store.db;refreshPolicyTables(db);
  const entries=ref=>['tasks','discovery','completed'].map(bucket=>`INSERT OR IGNORE INTO continuation_sittings
    SELECT ${ref}.generation,COALESCE(json_extract(entry.value,'$.sittingId'),json_extract(json_extract(entry.value,'$.body'),'$.sittingId')),'${bucket}',json_extract(entry.value,'$.key')
    FROM json_each(${ref}.body,'$.${bucket}') entry WHERE ${ref}.key='amendment:continuations' AND json_extract(entry.value,'$.kind')='motion-outcomes'
    AND COALESCE(json_extract(entry.value,'$.sittingId'),json_extract(json_extract(entry.value,'$.body'),'$.sittingId')) IS NOT NULL ${bucket==='tasks'?"AND COALESCE(json_extract(entry.value,'$.done'),0)<>1":''};`).join('\n');
  for(const [event,ref] of [['INSERT','NEW'],['UPDATE OF body,kind,fetched_at','NEW'],['DELETE',null]])db.exec(`CREATE TRIGGER IF NOT EXISTS refresh_policy_${event.split(' ')[0].toLowerCase()} AFTER ${event} ON sources BEGIN
    ${ref?'':`DELETE FROM mutable_documents WHERE generation=OLD.generation AND key=OLD.key;`}
    DELETE FROM continuation_sittings WHERE generation=${ref||'OLD'}.generation AND ${ref||'OLD'}.key='amendment:continuations';
    ${ref?entries(ref):''} END`);
  for(const source of db.prepare("SELECT generation,key,body,fetched_at FROM sources WHERE kind='document'").iterate())updateDocumentRefresh(store,source.generation,source.key,JSON.parse(source.body),source.fetched_at);
  // One retained checkpoint per generation; trigger the same projection.
  db.exec("UPDATE sources SET body=body WHERE key='amendment:continuations'");
  for(const source of db.prepare("SELECT generation,key,body,fetched_at FROM sources WHERE kind='motion-outcomes'").iterate())updateSittingRefresh(store,source.generation,source.key,JSON.parse(source.body),source.fetched_at);
  store.set('refreshPolicyVersion',1);
}

export function scheduleMutable(worker,generation) {
  const store=worker.store,now=worker.clock();
  for(const {key} of store.db.prepare('SELECT key FROM mutable_documents mutable WHERE generation=? AND next_check<=? AND NOT EXISTS (SELECT 1 FROM refresh_gaps gap WHERE gap.generation=mutable.generation AND gap.key=mutable.key) ORDER BY next_check,key LIMIT ?').all(generation,now,MUTABLE_LIMIT)) {
    store.enqueue(generation,key,'document',{endpoint:key},84,true);
    store.db.prepare('UPDATE mutable_documents SET next_check=? WHERE generation=? AND key=?').run(now+7*DAY,generation,key);
  }
  store.transaction(()=>{
    const today=localDay(now),prior=store.get('slowGapAdmissions');
    let count=prior?.day===today?prior.count:0;
    for(const gap of store.db.prepare("SELECT * FROM refresh_gaps WHERE generation=? AND kind<>'coverage' AND retry_at<=? ORDER BY retry_at,key LIMIT ?").all(generation,now,Math.max(0,GAP_LIMIT-count))) {
      if(gap.kind==='motion-outcomes' && today<sittingConfirmationDay(gap.sitting_id))continue;
      store.enqueue(generation,gap.key,gap.kind,{},gap.priority,true,{retryGap:true});
      store.db.prepare('UPDATE refresh_gaps SET retry_at=? WHERE generation=? AND key=?').run(now+7*DAY,generation,gap.key);
      if(gap.kind==='motion-outcomes')store.db.prepare('UPDATE sitting_refresh SET next_check=? WHERE generation=? AND sitting_id=?').run(now+7*DAY,generation,gap.sitting_id);
      count++;
    }
    store.set('slowGapAdmissions',{day:today,count});
  });
}

export function recordTaskGap(worker,task,error) {
  if(task.groupVoiceJob || task.kind.startsWith('amendment-') || task.kind.startsWith('outside-') || worker.controller.signal.aborted || /lease/i.test(error.message))return false;
  // An empty roster cannot provide a usable first publication.
  if(task.kind==='roster' && !worker.store.db.prepare('SELECT 1 FROM members LIMIT 1').get())return false;
  if(task.attempts<((error.status===404||error.status===410)?2:4))return false;
  const now=worker.clock();
  const retryAt=now+(task.kind==='motion-outcomes' && localDay(now)<sittingConfirmationDay(task.body.sittingId)?6*60*60_000:7*DAY);
  worker.store.transaction(()=>{
    worker.store.finishTask(task);
    worker.store.db.prepare('INSERT OR REPLACE INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(task.generation,task.key,task.kind,JSON.stringify(task.body),task.priority,String(error.message).slice(0,350),task.attempts+1,new Date(now).toISOString(),retryAt,task.body.sittingId || null);
    if(task.kind==='motion-outcomes')worker.store.db.prepare('INSERT OR REPLACE INTO sitting_refresh VALUES (?,?,?)').run(task.generation,task.body.sittingId,retryAt);
  });
  return true;
}

export function coverageGap(store,generation,key,body,message,now) {
  store.assertWriter();
  const prior=store.db.prepare('SELECT body FROM refresh_gaps WHERE generation=? AND key=?').get(generation,key);
  if(prior) {
    const saved=JSON.parse(prior.body);
    if(saved.start && saved.start<body.start)body={...body,start:saved.start};
  }
  store.db.prepare('INSERT OR REPLACE INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,key,'coverage',JSON.stringify(body),0,message,0,new Date(now).toISOString(),Number.MAX_SAFE_INTEGER,null);
}
