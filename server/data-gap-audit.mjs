import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {adoptedTextProjectionVersion,spId,validateTA,validateReply} from './commission-followups-model.mjs';
import {mutableDocumentCandidates,mutableBackfillCutoff} from './mutable-document-recovery.mjs';

export function failureClass(message='') {
  const status=String(message).match(/(?:returned|HTTP|unavailable\s*\()\s*(404|410|429|5\d\d)/i)?.[1];
  if(status==='429')return 'throttled';
  if(status==='404'||status==='410')return 'missing-at-source';
  if(status?.startsWith('5')||/timeout|timed out|ECONN|ENET|fetch failed/i.test(message))return 'transient';
  if(/invalid|malformed|archive|parse|unsupported|ambiguous|conflicting|pagination repeated/i.test(message))return 'source-or-parser';
  return 'unclassified';
}

// Maintenance inventory, never a public completeness assertion. On-demand
// readers are deliberately distinguished from durable collection workers.
export const RECOVERY_PATHS=Object.freeze([
  {family:'members and memberships',owner:'activity index',recovery:'daily roster, membership and history queues'},
  {family:'questions, answers, reports and procedures',owner:'activity index',recovery:'catalogues, feeds, mutable-document and slow-gap queues'},
  {family:'speech metadata and outside speakers',owner:'activity index',recovery:'monthly catalogues, exact-ID recoveries and dated-roster retries'},
  {family:'group designations',owner:'activity index',recovery:'group_voice_jobs after core work; monitor for starvation'},
  {family:'amendments and sitting outcomes',owner:'activity index',recovery:'amendment_jobs, saved continuations, daily gap and parser recovery'},
  {family:'speech and question/answer search text',owner:'corpus',recovery:'monthly speech tasks and exact distribution URL tasks'},
  {family:'press releases',owner:'activity index',recovery:'daily RSS and capped transient retries; permanent source issues recheck monthly or on re-announcement'},
  {family:'structured document reader and proposal context',owner:'on demand',recovery:'cache refresh on read; no comprehensive background backfill'},
  {family:'calendar, agendas, attendance and member votes',owner:'on demand',recovery:'bounded cached source reads; only indexed sitting outcomes have a background queue'},
  {family:'OEIL, Cellar and dossier context',owner:'on demand',recovery:'source-cache refresh on read; no comprehensive background backfill'},
  {family:'portraits, recordings and live feeds',owner:'on demand',recovery:'bounded cache refresh or live polling'},
  {family:'unverified categories and unresolved exact joins',owner:'maintainer',recovery:'source research or parser/code change; repeated downloads cannot establish a relationship'},
]);

const has=(db,table)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
const meta=(db,key)=>has(db,'meta')?JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value??'null'):null;
function queues(db,table,now,generation) {
  if(!has(db,table))return {state:'unavailable',reason:'table absent'};
  // table names are fixed internal constants, never CLI input.
  const scope=generation===undefined?'':' WHERE generation=?';
  const args=generation===undefined?[]:[generation];
  return {state:'observed',byKind:db.prepare(`SELECT kind,COUNT(*) AS total,SUM(done=1) AS completed,
    SUM(CASE WHEN done IS NULL OR done<>1 THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN (done IS NULL OR done<>1) AND retry_at<=? THEN 1 ELSE 0 END) AS due,
    SUM(CASE WHEN (done IS NULL OR done<>1) AND error IS NOT NULL THEN 1 ELSE 0 END) AS retrying,
    MIN(CASE WHEN done IS NULL OR done<>1 THEN retry_at END) AS earliestRetryAt
    FROM ${table}${scope} GROUP BY kind ORDER BY kind`).all(now,...args)};
}
function inspect(filename,read) {
  if(!filename)return {state:'unavailable',reason:'path not supplied'};
  let db;
  try {
    db=new DatabaseSync(filename,{readOnly:true});
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; PRAGMA cache_size=-2048; BEGIN');
    return {state:'observed',...read(db)};
  } catch(error) {return {state:'unavailable',reason:error.code||'read failed'};}
  finally {if(db){if(db.isTransaction)db.exec('ROLLBACK');db.close();}}
}

export function auditFollowupMetadata(db,generation) {
  if(!has(db,'sources'))return {state:'unavailable',reason:'source table absent'};
  const owned=new Set();
  for(const table of ['tasks','amendment_jobs','refresh_gaps'])if(has(db,table))for(const row of db.prepare(`SELECT key FROM ${table} WHERE generation=?${table==='refresh_gaps'?'':' AND (done IS NULL OR done<>1)'}`).iterate(generation))owned.add(row.key);
  const continuation=db.prepare("SELECT body FROM sources WHERE generation=? AND key='amendment:continuations'").get(generation);
  if(continuation){const saved=JSON.parse(continuation.body);for(const task of [...(saved.tasks||[]),...(saved.discovery||[])])if(task.done!==1)owned.add(task.key);}
  const counts={legacyRoots:0,unobservedRoots:0,malformedRoots:0,unrecognisedRelationships:0,observedRoots:0,retained:0,ownedMissing:0,unowned:0};
  const relations=new Map();
  for(const row of db.prepare("SELECT key,body FROM sources WHERE generation=? AND kind='document' AND key GLOB '/adopted-texts/TA-10-*'").iterate(generation)) {
    const work=JSON.parse(row.body);
    if(work.adoptionProjectionVersion!==adoptedTextProjectionVersion){counts.legacyRoots++;continue;}
    try{validateTA({data:[work]},row.key.slice('/adopted-texts/'.length));}catch{counts.malformedRoots++;continue;}
    if(work.followupRelationships==null){counts.unobservedRoots++;continue;}
    if(!Array.isArray(work.followupRelationships)){counts.malformedRoots++;continue;}
    counts.observedRoots++;
    for(const value of work.followupRelationships){const id=spId(value);if(id)relations.set(JSON.stringify([work.identifier,id]),{adoptedId:work.identifier,id,key:'/external-documents/'+id});else counts.unrecognisedRelationships++;}
  }
  const missing=[],retainedSources=new Map();
  for(const [identity,relation] of [...relations].sort(([a],[b])=>a.localeCompare(b))) {
    if(!retainedSources.has(relation.key)){
      const row=db.prepare("SELECT body FROM sources WHERE generation=? AND key=? AND kind='document'").get(generation,relation.key);
      retainedSources.set(relation.key,row?JSON.parse(row.body):null);
    }
    const work=retainedSources.get(relation.key);let retained=false;
    if(work?.followupProjectionVersion===1)try{validateReply({data:[work]},relation.id,relation.adoptedId);retained=true;}catch{/* Keep mismatches missing. */}
    if(retained){counts.retained++;continue;}
    const state=owned.has(relation.key)?'ownedMissing':'unowned';counts[state]++;missing.push({identity,...relation,state});
  }
  return {state:'observed',policy:'metadata of exact SP relationships declared by current adopted-text projections',eligibleRelations:relations.size,
    eligibleRelationDigest:createHash('sha256').update(JSON.stringify([...relations.keys()].sort())).digest('hex'),counts,missing};
}

export function auditMutableDocuments(db,generation,now) {
  if(!has(db,'mutable_documents'))return null;
  const result={...db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(next_check<=?),0) AS due,
    MIN(CASE WHEN next_check<=? THEN next_check END) AS oldestDueAt FROM mutable_documents WHERE generation=?`).get(now,now,generation),
    dueAdoptedTexts:null,dueUnknownTypes:null,dueAdoptedTextShare:null};
  result.oldestDueAgeMs=result.oldestDueAt==null?null:Math.max(0,now-result.oldestDueAt);
  if(!has(db,'sources'))return result;
  result.dueAdoptedTexts=0;result.dueUnknownTypes=0;
  for(const row of db.prepare(`SELECT CASE
    WHEN json_type(s.body,'$.work_type.id')='text' THEN json_extract(s.body,'$.work_type.id')
    WHEN json_type(s.body,'$.work_type')='text' THEN json_extract(s.body,'$.work_type') END AS type
    FROM mutable_documents m LEFT JOIN sources s ON s.generation=m.generation AND s.key=m.key
    WHERE m.generation=? AND m.next_check<=?`).iterate(generation,now)) {
    if(!row.type)result.dueUnknownTypes++;
    else if(row.type.split('/').at(-1)==='TEXT_ADOPTED')result.dueAdoptedTexts++;
  }
  if(result.due>0&&result.dueUnknownTypes===0)result.dueAdoptedTextShare=result.dueAdoptedTexts/result.due;
  return result;
}

export function auditMutableAdmission(db,generation,now) {
  if(['mutable_documents','sources','tasks','amendment_jobs','refresh_gaps'].some(table=>!has(db,table)))return {state:'unavailable',reason:'required tables absent'};
  const cutoffAt=mutableBackfillCutoff(meta(db,'working'),generation,now);
  const candidates=[...mutableDocumentCandidates(db,generation,cutoffAt)].map(row=>({...row}));
  return {state:'observed',policy:'backfill cohort',cutoffAt,eligibleDue:candidates.length,candidates,
    eligibleKeyDigest:createHash('sha256').update(JSON.stringify(candidates.map(row=>row.key).sort())).digest('hex'),
    oldestEligibleDueAt:candidates[0]?.nextCheck??null,
    note:'Admission candidates exclude existing task, gap and continuation owners. Leaving this set does not prove a successful refresh.'};
}

export function auditIndex(db,now) {
  const active=meta(db,'active'),working=meta(db,'working'),amendmentSnapshot=meta(db,'amendmentSnapshotGeneration'),generations=[...new Set([active,working?.generation,amendmentSnapshot].filter(Number.isInteger))];
  const lease=has(db,'lease')?db.prepare('SELECT expires FROM lease WHERE id=1').get():null;
  return {activeGeneration:active,workingGeneration:working?.generation??null,amendmentSnapshotGeneration:amendmentSnapshot,phase:working?.phase??'idle',
    lastSuccessfulRefresh:meta(db,'lastSuccess'),writerLeaseActive:Boolean(lease?.expires>now),
    generations:generations.map(generation=>{
      const gaps=has(db,'refresh_gaps')?db.prepare('SELECT kind,COUNT(*) AS count,MIN(retry_at) AS earliestRetryAt FROM refresh_gaps WHERE generation=? GROUP BY kind').all(generation):null;
      const gapRecords=has(db,'refresh_gaps')?db.prepare('SELECT key,kind,error,attempts,retry_at AS retryAt FROM refresh_gaps WHERE generation=? ORDER BY key').all(generation).map(({error,...gap})=>({...gap,failure:failureClass(error)})):null;
      const sourceGaps=has(db,'sources')?db.prepare("SELECT kind,COALESCE(json_extract(body,'$.state'),'unclassified') AS state,COUNT(*) AS count FROM sources WHERE generation=? AND kind IN ('outside-gap','amendment-gap') GROUP BY kind,state").all(generation):null;
      const continuation=has(db,'sources')?db.prepare("SELECT body FROM sources WHERE generation=? AND key='amendment:continuations'").get(generation):null;
      const saved=continuation?JSON.parse(continuation.body):null;
      return {generation,queues:Object.fromEntries(['tasks','amendment_jobs','group_voice_jobs'].map(table=>[table,queues(db,table,now,generation)])),
        refreshGaps:gaps,gapRecords,savedSourceGaps:sourceGaps,followupMetadata:auditFollowupMetadata(db,generation),
        adoptedTexts:has(db,'sources')?db.prepare(`SELECT COUNT(*) AS retained,
          COALESCE(SUM(json_type(body,'$.adopts') IS NOT NULL AND json_type(body,'$.adopts')<>'null'),0) AS withAdoptionObservation,
          COALESCE(SUM(json_type(body,'$.adopts') IS NULL OR json_type(body,'$.adopts')='null'),0) AS withoutAdoptionObservation,
          COALESCE(SUM(COALESCE(json_extract(body,'$.adoptionProjectionVersion'),0)<>${adoptedTextProjectionVersion}),0) AS legacyProjection
          FROM sources WHERE generation=? AND kind='document' AND key GLOB '/adopted-texts/TA-10-*'`).get(generation):null,
        continuations:saved?{tasks:saved.tasks?.length??0,discovery:saved.discovery?.length??0,capacityGap:saved.capacityGap??null}:null,
        mutableDocuments:auditMutableDocuments(db,generation,now),mutableAdmission:auditMutableAdmission(db,generation,now)};
    }),
    adoptedTextDiscovery:meta(db,'adoptedTextDiscovery'),followupAdmissionRepair:meta(db,'followupAdmissionRepair'),amendmentDocumentRouteRepair:meta(db,'amendmentDocumentRouteRepair'),amendmentDocumentRouteVerification:meta(db,'amendmentDocumentRouteVerification'),unresolvedJoins:(meta(db,'unresolved')||[]).length,
    nonRetryableCoverageWindows:has(db,'refresh_gaps')?db.prepare("SELECT COUNT(*) AS count FROM refresh_gaps WHERE generation=? AND kind='coverage'").get(active??0).count:null};
}
export function auditCorpus(db,now) {
  const lease=has(db,'lease')?db.prepare('SELECT expires FROM lease WHERE id=1').get():null;
  return {phase:meta(db,'phase'),lastRunAt:meta(db,'lastRunAt'),backfilledAt:meta(db,'backfilledAt'),
    authoritativeComplete:false,writerLeaseActive:Boolean(lease?.expires>now),languages:meta(db,'documentLanguages'),
    sourceFailures:has(db,'source_failures')?db.prepare('SELECT key,state,reason,descriptor,content_hash AS contentHash,parser_version AS parserVersion,next_check AS nextCheck FROM source_failures ORDER BY key').all():null,
    queues:queues(db,'tasks',now),
    pendingTasks:has(db,'tasks')?db.prepare('SELECT key,kind,attempts,retry_at AS retryAt,error FROM tasks WHERE done=0 ORDER BY key').all().map(({error,...task})=>({...task,state:'transient',failure:failureClass(error)})):null,
    documents:has(db,'documents')&&has(db,'texts')?db.prepare(`SELECT d.kind,COUNT(*) AS discovered,
      SUM(NOT EXISTS(SELECT 1 FROM texts t WHERE t.document_id=d.id)) AS withoutText FROM documents d GROUP BY d.kind`).all():null};
}

// Compare exact indexed distribution URLs with corpus texts and task ownership.
// Each database has its own read snapshot; a concurrent writer can advance
// between them, so an orphan is a repair candidate, never proof of source absence.
export function reconcileQuestionFiles(indexFile,corpusFile,{exampleLimit=20,now=Date.now()}={}) {
  let index,corpus;
  try {
    index=new DatabaseSync(indexFile,{readOnly:true});corpus=new DatabaseSync(corpusFile,{readOnly:true});
    for(const db of [index,corpus])db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; PRAGMA cache_size=-2048; BEGIN');
    if(!has(index,'question_files')||!has(corpus,'texts')||!has(corpus,'tasks'))return {state:'unavailable',reason:'required table absent'};
    const generation=meta(index,'active')??meta(index,'working')?.generation;
    if(!Number.isInteger(generation))return {state:'unavailable',reason:'no index generation'};
    const policy=meta(corpus,'documentLanguages');
    if(!['all','primary'].includes(policy))return {state:'unavailable',reason:'corpus language policy unknown'};
    const text=corpus.prepare('SELECT 1 FROM texts WHERE source_url=? LIMIT 1');
    const task=corpus.prepare('SELECT done,retry_at FROM tasks WHERE key=?');
    const failure=has(corpus,'source_failures')?corpus.prepare('SELECT state FROM source_failures WHERE key=?'):null;
    const counts={retained:0,queued:0,retryingLater:0,unowned:0,completedWithoutText:0,excludedByPolicy:0,permanentSourceIssue:0,satisfiedByAlternative:0},examples=[],missing=[],universe=createHash('sha256');
    const files=index.prepare("SELECT url,COALESCE(json_extract(body,'$.format'),'docx') AS format,MAX(is_primary) AS is_primary FROM question_files WHERE generation=? GROUP BY url ORDER BY url").iterate(generation);
    for(const file of files) {
      if(policy==='primary'&&!file.is_primary){counts.excludedByPolicy++;continue;}
      universe.update(file.url+'\n');
      if(text.get(file.url)){counts.retained++;continue;}
      const issue=failure?.get(file.format+':'+file.url);
      if(issue?.state==='satisfied-by-alternative'){counts.satisfiedByAlternative++;continue;}
      if(issue?.state==='permanent-source-issue'){counts.permanentSourceIssue++;missing.push({url:file.url,state:'permanent-source-issue'});continue;}
      const queued=task.get(file.format+':'+file.url),state=!queued?'unowned':queued.done===1?'completedWithoutText':'queued';
      counts[state]++;
      missing.push({url:file.url,state});
      if((state==='unowned'||state==='completedWithoutText')&&examples.length<exampleLimit)examples.push({url:file.url,state});
      if(state==='queued'&&queued.retry_at>now)counts.retryingLater++;
    }
    return {state:'observed',generation,policy,eligibleFiles:counts.retained+counts.satisfiedByAlternative+missing.length,eligibleUrlDigest:universe.digest('hex'),counts,missing,examples,action:counts.unowned||counts.completedWithoutText?'reconcile through the corpus writer; inspect completed empty extractions before requeue':'existing corpus queue owns known eligible files'};
  } catch(error) {return {state:'unavailable',reason:error.code||'read failed'};}
  finally {for(const db of [index,corpus])if(db){if(db.isTransaction)db.exec('ROLLBACK');db.close();}}
}

export function compareGapAudits(current,baseline) {
  const compare=(before,after,key)=>{
    if(!Array.isArray(before)||!Array.isArray(after))return {state:'unavailable'};
    const a=new Set(before.map(row=>row[key])),b=new Set(after.map(row=>row[key]));
    return {state:'observed',previous:a.size,current:b.size,resolved:[...a].filter(id=>!b.has(id)),newlyMissing:[...b].filter(id=>!a.has(id)),retained:[...b].filter(id=>a.has(id)).length};
  };
  const active=report=>report.index?.generations?.find(g=>g.generation===report.index.activeGeneration)?.gapRecords;
  const questionFiles=compare(baseline.questionFiles?.missing,current.questionFiles?.missing,'url');
  const followups=report=>report.index?.generations?.find(g=>g.generation===report.index.activeGeneration)?.followupMetadata;
  const mutable=report=>report.index?.generations?.find(g=>g.generation===report.index.activeGeneration)?.mutableAdmission?.candidates;
  return {baselineAt:baseline.observedAt,currentAt:current.observedAt,
    indexGaps:compare(active(baseline),active(current),'key'),corpusTasks:compare(baseline.corpus?.pendingTasks,current.corpus?.pendingTasks,'key'),questionFiles,
    followupMetadata:compare(followups(baseline)?.missing,followups(current)?.missing,'identity'),
    mutableAdmissionCandidates:compare(mutable(baseline),mutable(current),'key'),
    sameFollowupMetadataUniverse:followups(baseline)?.eligibleRelationDigest&&followups(current)?.eligibleRelationDigest?followups(baseline).eligibleRelationDigest===followups(current).eligibleRelationDigest:null,
    sameQuestionFileUniverse:baseline.questionFiles?.eligibleUrlDigest&&current.questionFiles?.eligibleUrlDigest?baseline.questionFiles.eligibleUrlDigest===current.questionFiles.eligibleUrlDigest:null,
    note:'Resolved means absent from the current set; confirm retained data and source scope before calling it recovered. Mutable admission candidates can leave the set because they are queued, not refreshed. New publications can add gaps while older gaps recover.'};
}
export function dataGapAudit({indexFile,corpusFile,pressFile,now=Date.now(),reconcile=false}={}) {
  return {schemaVersion:1,observedAt:new Date(now).toISOString(),recoveryPaths:RECOVERY_PATHS,
    limits:['Queue ownership is not worker liveness; verify enabled services, run timestamps and progress on the host.','On-demand sources and unpublished upstream records are not exhaustively inventoried.','Read-only snapshots do not start collectors, reopen tasks or clear coverage gaps.'],
    index:inspect(indexFile,db=>auditIndex(db,now)),corpus:inspect(corpusFile,db=>auditCorpus(db,now)),
    press:inspect(pressFile,db=>({failureStates:has(db,'releases')&&db.prepare("PRAGMA table_info('releases')").all().some(column=>column.name==='failure_state')?db.prepare('SELECT failure_state AS state,COUNT(*) AS count FROM releases WHERE error IS NOT NULL GROUP BY failure_state').all():null,releases:has(db,'releases')?db.prepare(`SELECT COUNT(*) AS total,SUM(checked_at IS NULL AND next_check IS NOT NULL) AS queued,SUM(checked_at IS NULL AND next_check IS NULL) AS exhausted FROM releases`).get():null})),
    questionFiles:reconcile&&indexFile&&corpusFile?reconcileQuestionFiles(indexFile,corpusFile,{now}):{state:'not checked',reason:'use --reconcile with both database paths'}};
}
