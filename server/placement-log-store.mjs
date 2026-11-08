import {createHash} from 'node:crypto';
import {amendmentGeneration} from './amendments-store.mjs';
import {displayableAmendmentVersion} from './amendment-display-version.mjs';

export const PLACEMENT_LOG_LIMITS=Object.freeze({rows:200_000,attempts:3,retryMs:3600_000,recheckMs:7*86400_000,recheckForMs:56*86400_000});
// The outcome a later held source can still change. Anything else settles until
// the list's content or the placement code changes.
const WAITING_OUTCOMES=new Set(['acquisition-unavailable']);
const LOGGED_OUTCOMES=new Set(['withheld-pipeline','withheld-source','acquisition-unavailable']);

// Additive and outside generations, so publication, pruning and reparses never
// touch it and older images ignore it. Deliberately not an ACTIVITY_SCHEMA_GATE:
// a changed gate discards a generation begin in progress, and this table has no
// claim on one. It runs on every writer acquisition, so existing databases get it.
export function preparePlacementLog(store) {
  if(store.get('placementLogSchema')===1)return false;
  store.db.exec(`CREATE TABLE IF NOT EXISTS placement_log_lists(list_id TEXT PRIMARY KEY,document_id TEXT,scope TEXT,state TEXT NOT NULL,fingerprint TEXT,first_seen TEXT NOT NULL,first_evaluated TEXT,last_evaluated TEXT,declared INTEGER,first_counts TEXT,counts TEXT,evaluator TEXT,next_check INTEGER,attempts INTEGER NOT NULL DEFAULT 0,error TEXT,dropped INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS placement_log_due ON placement_log_lists(next_check) WHERE next_check IS NOT NULL;
    CREATE TABLE IF NOT EXISTS placement_log_failures(amendment_id TEXT NOT NULL,reason TEXT NOT NULL,outcome TEXT NOT NULL,list_id TEXT NOT NULL,document_id TEXT NOT NULL,language TEXT,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,stopped_at TEXT,stopped_outcome TEXT,PRIMARY KEY(amendment_id,list_id,reason)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS placement_log_failure_seen ON placement_log_failures(first_seen);
    CREATE INDEX IF NOT EXISTS placement_log_failure_open ON placement_log_failures(list_id) WHERE stopped_at IS NULL;`);
  // The log starts now: every list already held is recorded as older and is not
  // read. Keys only, from the primary key; no list body is loaded.
  const generation=amendmentGeneration(store);
  store.db.prepare("INSERT OR IGNORE INTO placement_log_lists(list_id,state,first_seen) SELECT substr(key,16),'baseline',? FROM sources WHERE generation=? AND key>='amendment:list:' AND key<'amendment:list;'").run(new Date(store.clock()).toISOString(),generation);
  store.set('placementLogSchema',1);
  return true;
}

const variantsOf=row=>row.variants?.length?row.variants:[row];
const hasWording=row=>['originalText','proposedText'].some(key=>typeof row[key]==='string');
// Content identity for one list, from rows this rebuild already holds in memory.
// A parser version counts only where it makes withheld wording readable; otherwise
// a new parser re-checks open failures instead of every list.
export function placementListFingerprints(rows) {
  const lists=new Map();
  for(const row of rows)for(const variant of variantsOf(row)) {
    if(typeof variant.listId!=='string')continue;
    const list=lists.get(variant.listId)||{entries:[],wording:false};lists.set(variant.listId,list);
    list.entries.push(JSON.stringify([row.id,variant.language??null,variant.textIntegrity??null,variant.wordingSource?.contentHash??variant.wordingSource?.sha256??variant.wordingSource?.url??null,hasWording(variant),displayableAmendmentVersion(variant.textParserVersion)]));
    list.wording||=hasWording(variant);
  }
  return new Map([...lists].filter(([,list])=>list.wording).map(([id,list])=>[id,createHash('sha256').update(list.entries.sort().join('\n')).digest('hex')]));
}

// Called where the writer has just saved a target's rows, which is the moment
// wording becomes held. Nothing is evaluated here; a list only becomes due.
export function notePlacementLists(store,rows,{now=store.clock()}={}) {
  // The saved rows are already committed; the log can never undo that work.
  try {
    if(store.get('placementLogSchema')!==1)return;
    const fingerprints=placementListFingerprints(rows);
    if(!fingerprints.size)return;
    const read=store.db.prepare('SELECT state,fingerprint FROM placement_log_lists WHERE list_id=?');
    const changes=[...fingerprints].filter(([id,fingerprint])=>{
      const saved=read.get(id);
      return saved?.state!=='baseline'&&saved?.fingerprint!==fingerprint;
    });
    if(!changes.length)return;
    const write=()=>{
      store.assertWriter();
      const firstSeen=new Date(now).toISOString();
      const upsert=store.db.prepare(`INSERT INTO placement_log_lists(list_id,state,fingerprint,first_seen,next_check) VALUES (?,'pending',?,?,?)
        ON CONFLICT(list_id) DO UPDATE SET fingerprint=excluded.fingerprint,state=CASE WHEN state='failed' THEN 'pending' ELSE state END,next_check=excluded.next_check,attempts=0,error=NULL`);
      for(const [id,fingerprint] of changes)upsert.run(id,fingerprint,firstSeen,now);
    };
    store.db.isTransaction?write():store.transaction(write);
  }catch(error){console.warn('[placement-log]',String(error?.message).slice(0,120));}
}

export const listFingerprint=(store,listId)=>store.db.prepare('SELECT fingerprint FROM placement_log_lists WHERE list_id=?').get(listId)?.fingerprint??null;
export function dueLists(store,now=store.clock()) {
  if(store.get('placementLogSchema')!==1)return null;
  return store.db.prepare('SELECT list_id FROM placement_log_lists WHERE next_check IS NOT NULL AND next_check<=? ORDER BY next_check,list_id LIMIT 1').get(now)?.list_id||null;
}
export const hasDueList=(store,now=store.clock())=>Boolean(dueLists(store,now));
export const hasOpenFailures=store=>store.get('placementLogSchema')===1&&Boolean(store.db.prepare('SELECT 1 FROM placement_log_failures WHERE stopped_at IS NULL LIMIT 1').get());

// New placement code can only change a failure, so only lists with an open one
// are read again. A list that placed cleanly is not re-read on every release.
export function reopenForEvaluator(store,evaluator,{now=store.clock()}={}) {
  if(store.get('placementLogEvaluator')===evaluator)return 0;
  const write=()=>{
    store.assertWriter();
    const {changes}=store.db.prepare(`UPDATE placement_log_lists SET next_check=?,attempts=0,error=NULL,state=CASE WHEN state='failed' THEN 'pending' ELSE state END
      WHERE state='failed' OR list_id IN (SELECT DISTINCT list_id FROM placement_log_failures WHERE stopped_at IS NULL)`).run(now);
    store.set('placementLogEvaluator',evaluator);
    return changes;
  };
  return store.db.isTransaction?write():store.transaction(write);
}

export function emptyCounts(){return {amendments:0,placed:0,'not-applicable':0,'withheld-pipeline':0,'withheld-source':0,'acquisition-unavailable':0};}
// One transaction for one list. A failure already recorded only moves its last
// seen date; a row that stops failing keeps its history; nothing is deleted.
export function commitEvaluation(store,result,{evaluator,fingerprint,now=store.clock(),maxRows=PLACEMENT_LOG_LIMITS.rows}={}) {
  const at=new Date(now).toISOString();
  return store.transaction(()=>{
    store.assertWriter();
    const counts=emptyCounts(),reasons={};let added=0,dropped=0,waiting=false;
    const seen=new Set();
    const existing=store.db.prepare('SELECT stopped_at FROM placement_log_failures WHERE amendment_id=? AND list_id=? AND reason=?');
    const insert=store.db.prepare('INSERT INTO placement_log_failures(amendment_id,reason,outcome,list_id,document_id,language,first_seen,last_seen) VALUES (?,?,?,?,?,?,?,?)');
    const touch=store.db.prepare('UPDATE placement_log_failures SET outcome=?,document_id=?,language=?,last_seen=?,stopped_at=NULL,stopped_outcome=NULL WHERE amendment_id=? AND list_id=? AND reason=?');
    let total=store.db.prepare('SELECT COUNT(*) n FROM placement_log_failures').get().n;
    for(const row of result.amendments) {
      counts.amendments++;counts[row.outcome]++;
      waiting||=WAITING_OUTCOMES.has(row.outcome);
      if(!LOGGED_OUTCOMES.has(row.outcome))continue;
      seen.add(JSON.stringify([row.id,row.reason]));
      const prior=existing.get(row.id,result.listId,row.reason);
      if(prior)touch.run(row.outcome,result.documentId,row.language,at,row.id,result.listId,row.reason);
      else if(total>=maxRows)dropped++;
      else {
        insert.run(row.id,row.reason,row.outcome,result.listId,result.documentId,row.language,at,at);total++;
        if(row.outcome==='withheld-pipeline'){added++;reasons[row.reason]=(reasons[row.reason]||0)+1;}
      }
    }
    const outcomes=new Map(result.amendments.map(row=>[row.id,row.outcome]));
    const stop=store.db.prepare('UPDATE placement_log_failures SET stopped_at=?,stopped_outcome=? WHERE amendment_id=? AND list_id=? AND reason=?');
    for(const row of store.db.prepare('SELECT amendment_id,reason FROM placement_log_failures WHERE list_id=? AND stopped_at IS NULL').all(result.listId))
      if(!seen.has(JSON.stringify([row.amendment_id,row.reason])))stop.run(at,outcomes.get(row.amendment_id)||'absent-from-list',row.amendment_id,result.listId,row.reason);
    const saved=store.db.prepare('SELECT first_seen,fingerprint FROM placement_log_lists WHERE list_id=?').get(result.listId);
    const keepChecking=waiting&&saved&&now-Date.parse(saved.first_seen)<PLACEMENT_LOG_LIMITS.recheckForMs;
    // Rows saved while the thread ran are newer than this result: read them next.
    const changed=fingerprint!==undefined&&saved?.fingerprint!==fingerprint;
    store.db.prepare(`UPDATE placement_log_lists SET document_id=?,scope=?,state='evaluated',declared=?,first_evaluated=COALESCE(first_evaluated,?),last_evaluated=?,first_counts=COALESCE(first_counts,?),counts=?,evaluator=?,next_check=?,attempts=0,error=NULL,dropped=dropped+? WHERE list_id=?`)
      .run(result.documentId,result.scope,result.declared??null,at,at,JSON.stringify(counts),JSON.stringify(counts),evaluator??null,changed?now:keepChecking?now+PLACEMENT_LOG_LIMITS.recheckMs:null,dropped,result.listId);
    return {counts,added,reasons,dropped};
  });
}

// A thread that ran out of time or memory is not a placement result.
export function recordEvaluationFailure(store,listId,code,{now=store.clock()}={}) {
  return store.transaction(()=>{
    store.assertWriter();
    const saved=store.db.prepare('SELECT attempts FROM placement_log_lists WHERE list_id=?').get(listId);
    if(!saved)return false;
    const attempts=saved.attempts+1,failed=attempts>=PLACEMENT_LOG_LIMITS.attempts;
    store.db.prepare(`UPDATE placement_log_lists SET attempts=?,error=?,state=CASE WHEN ? THEN 'failed' ELSE state END,next_check=? WHERE list_id=?`).run(attempts,String(code).slice(0,120),failed?1:0,failed?null:now+PLACEMENT_LOG_LIMITS.retryMs,listId);
    return failed;
  });
}
