import {sourceMissing, missingSourceDelay} from './source-retry.mjs';
import {array, tail, documentFiles} from './activity-index-model.mjs';
import {AMENDMENTS_VERSION,AMENDMENT_SITTING_PROJECTION_VERSION} from './amendments.mjs';
import {adoptedTextOwnedElsewhere,adoptedTextDeferredKeys} from './adopted-text-index.mjs';

export const DAY=86_400_000, MUTABLE_LIMIT=100, GAP_LIMIT=25;
const ordinaryBackfillQuantum=8;

// Reserve a bounded share of dispatches, not extra requests. Canonical tasks
// retain their priority, cursor and retry ownership; only due tasks can run.
// Persist the turn so small budgets and restarts cannot reset the allowance.
export function nextBackfillTask(store,generation,ordinaryTask) {
  store.assertWriter();
  if(!ordinaryTask)return ordinaryTask;
  const saved=store.get('backfillSchedule');
  const state=saved?.generation===generation&&Number.isInteger(saved.ordinary)&&saved.ordinary>=0&&saved.ordinary<=ordinaryBackfillQuantum&&[0,1].includes(saved.nextLane)
    ?saved:{generation,ordinary:0,nextLane:0};
  if(state.ordinary>=ordinaryBackfillQuantum) {
    const predicates=[
      "EXISTS(SELECT 1 FROM refresh_gap_admissions admitted WHERE admitted.generation=task.generation AND admitted.key=task.key)",
      "(task.kind='document' AND (task.key GLOB '/adopted-texts/TA-10-*' OR task.key GLOB '/external-documents/SP-*') OR task.kind IN ('catalog','feed') AND json_extract(task.body,'$.endpoint')='/adopted-texts')",
    ];
    for(const lane of [state.nextLane,1-state.nextLane]) {
      const task=store.db.prepare(`SELECT task.* FROM tasks task INDEXED BY task_pending_order
        WHERE task.generation=? AND (task.done IN (-1,0) OR task.done IS NULL) AND task.retry_at<=? AND ${predicates[lane]}
        ORDER BY task.priority DESC,task.key DESC LIMIT 1`).get(generation,store.clock());
      if(!task)continue;
      store.set('backfillSchedule',{generation,ordinary:0,nextLane:1-lane});
      return {...task,body:JSON.parse(task.body)};
    }
  }
  store.set('backfillSchedule',{...state,ordinary:Math.min(ordinaryBackfillQuantum,state.ordinary+1)});
  return ordinaryTask;
}
export const feedStart=(store,now)=>new Date(Date.parse(store.get('lastSuccess') || store.get('working')?.startedAt || new Date(now).toISOString())-2*DAY).toISOString().slice(0,10);
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
  // A Commission reply can be declared after all adopted-text languages exist.
  const adopted=tail(work.work_type)==='TEXT_ADOPTED';
  return {languageCount,answered,mutable:adopted || languageCount!==24 || question && (!answered || !answerLanguagesComplete)};
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
  let adoptedDeferred;const eligible=[];
  for(const {key} of store.db.prepare('SELECT key FROM mutable_documents mutable WHERE generation=? AND next_check<=? AND NOT EXISTS (SELECT 1 FROM refresh_gaps gap WHERE gap.generation=mutable.generation AND gap.key=mutable.key) ORDER BY next_check,key').iterate(generation,now)) {
    if((key.startsWith('/adopted-texts/')||key.startsWith('/external-documents/SP-'))&&adoptedTextOwnedElsewhere(store,generation,key,adoptedDeferred??=adoptedTextDeferredKeys(store,generation)))continue;
    eligible.push(key);if(eligible.length>=MUTABLE_LIMIT)break;
  }
  for(const key of eligible) {
    store.enqueue(generation,key,'document',{endpoint:key},84,true);
    store.db.prepare('UPDATE mutable_documents SET next_check=? WHERE generation=? AND key=?').run(now+7*DAY,generation,key);
  }
  if(worker.recoveryMode!=='backfill')scheduleGapRecovery(worker,generation);
}

function dueRecoveryGaps(store,generation,now,limit) {
  if(limit<=0)return [];
  const today=localDay(now),result=[];let adoptedDeferred;
  for(const gap of store.db.prepare("SELECT * FROM refresh_gaps gap WHERE generation=? AND kind<>'coverage' AND retry_at<=? AND NOT EXISTS (SELECT 1 FROM refresh_gap_admissions admitted WHERE admitted.generation=gap.generation AND admitted.key=gap.key) ORDER BY retry_at,key").iterate(generation,now)) {
    if((gap.key.startsWith('/adopted-texts/')||gap.key.startsWith('/external-documents/SP-'))&&adoptedTextOwnedElsewhere(store,generation,gap.key,adoptedDeferred??=adoptedTextDeferredKeys(store,generation)))continue;
    if(gap.kind==='motion-outcomes'&&today<sittingConfirmationDay(gap.sitting_id))continue;
    result.push(gap);if(result.length>=limit)break;
  }
  return result;
}
export const gapRecoveryDue=(store,generation,now=store.clock())=>dueRecoveryGaps(store,generation,now,1).length>0;

export function scheduleGapRecovery(worker,generation) {
  const store=worker.store,now=worker.clock(),backfill=worker.recoveryMode==='backfill';
  return store.transaction(()=>{
    store.assertWriter();
    const today=localDay(now),prior=store.get('slowGapAdmissions');
    let count=backfill?0:prior?.day===today?prior.count:0;
    for(const gap of dueRecoveryGaps(store,generation,now,Math.max(0,GAP_LIMIT-count))) {
      if(!store.enqueue(generation,gap.key,gap.kind,{},gap.priority,true,{retryGap:true}))continue;
      store.db.prepare('UPDATE refresh_gaps SET retry_at=? WHERE generation=? AND key=?').run(now+7*DAY,generation,gap.key);
      if(gap.kind==='motion-outcomes')store.db.prepare('UPDATE sitting_refresh SET next_check=? WHERE generation=? AND sitting_id=?').run(now+7*DAY,generation,gap.sitting_id);
      count++;
    }
    if(!backfill)store.set('slowGapAdmissions',{day:today,count});
    return count;
  });
}

export function recordTaskGap(worker,task,error) {
  if(task.groupVoiceJob || task.kind.startsWith('amendment-') || task.kind.startsWith('outside-') || worker.controller.signal.aborted || /lease/i.test(error.message))return false;
  // An empty roster cannot provide a usable first publication.
  if(task.kind==='roster' && !worker.store.db.prepare('SELECT 1 FROM members LIMIT 1').get())return false;
  if(!sourceMissing(error) && task.attempts<4)return false;
  const now=worker.clock();
  // Pre-policy pending feeds carry only their endpoint. Pin their interval
  // before an incomplete publication advances the global successful-run date.
  if(task.kind==='feed' && !task.body.start)task={...task,body:{...task.body,start:feedStart(worker.store,now)}};
  const correcting=task.kind==='motion-outcomes' && localDay(now)<sittingConfirmationDay(task.body.sittingId);
  const retryAt=now+Math.max(Number(error.retryAfter || 0)*1000,sourceMissing(error)?Math.max(missingSourceDelay(task.attempts),correcting?6*60*60_000:0):(correcting?6*60*60_000:7*DAY));
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
