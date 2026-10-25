import {brusselsDay} from './analysis-period.mjs';
import {sourceTime,validDay} from './source-availability.mjs';

export const AVAILABILITY_HISTORY_LIMITS=Object.freeze({days:90,observations:20000,checks:256});
const cutoff=now=>new Date(now-AVAILABILITY_HISTORY_LIMITS.days*86400_000).toISOString();
const atomic=store=>{store.assertWriter();if(!store.db.isTransaction)throw new Error('Availability evidence must commit with its source.');};
export function initializeAvailabilityHistory(store) {
  atomic(store);
  store.db.exec(`CREATE TABLE IF NOT EXISTS source_observations (
    identity TEXT PRIMARY KEY,source_id TEXT NOT NULL,family TEXT NOT NULL,subtype TEXT,stage TEXT NOT NULL,language TEXT,variant TEXT,
    event_date TEXT,first_source_at TEXT,last_source_at TEXT,first_observed_at TEXT NOT NULL,last_observed_at TEXT NOT NULL,
    acquisition TEXT NOT NULL,source_url TEXT);
    CREATE INDEX IF NOT EXISTS source_observation_age ON source_observations(last_observed_at,identity);
    CREATE TABLE IF NOT EXISTS source_checks (
    id INTEGER PRIMARY KEY,source_key TEXT NOT NULL,scope TEXT NOT NULL,start TEXT,end TEXT,first_source_at TEXT,last_source_at TEXT,
    observed_at TEXT NOT NULL,pages INTEGER NOT NULL,first_url TEXT,last_url TEXT,acquisition TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS source_check_age ON source_checks(observed_at,id);`);
  for(const table of ['tasks','group_voice_jobs','amendment_jobs','refresh_gaps']) {
    if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    for(const [label,event] of [['insert','INSERT'],['update',table!=='refresh_gaps'?'UPDATE OF done,error':'UPDATE'],['delete','DELETE']])
      store.db.exec(`CREATE TRIGGER IF NOT EXISTS availability_${table}_${label} AFTER ${event} ON ${table} ${table!=='refresh_gaps'&&label==='update'?'WHEN OLD.done IS NOT NEW.done OR OLD.error IS NOT NEW.error':''} BEGIN
        INSERT INTO meta(key,value) VALUES ('availabilityRevision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1;
        INSERT INTO meta(key,value) VALUES ('availabilityCoverageRevision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1; END;`);
  }
  if(!store.get('availabilityHistoryStartedAt')){store.set('availabilityHistoryStartedAt',new Date(store.clock()).toISOString());touchAvailability(store);}
}
export function touchAvailability(store) {
  atomic(store);store.set('availabilityRevision',(store.get('availabilityRevision')||0)+1);
}
function prune(store) {
  const now=store.clock();
  let removed=0;
  if(!store.get('availabilityHistoryPrunedAt')||now-store.get('availabilityHistoryPrunedAt')>=60_000) {
    removed+=store.db.prepare('DELETE FROM source_observations WHERE last_observed_at<? OR event_date<?').run(cutoff(now),cutoff(now).slice(0,10)).changes;
    removed+=store.db.prepare('DELETE FROM source_checks WHERE observed_at<?').run(cutoff(now)).changes;
    store.set('availabilityHistoryPrunedAt',now);
  }
  const excess=store.db.prepare('SELECT COUNT(*) n FROM source_observations').get().n-AVAILABILITY_HISTORY_LIMITS.observations;
  if(excess>0)removed+=store.db.prepare('DELETE FROM source_observations WHERE identity IN (SELECT identity FROM source_observations ORDER BY last_observed_at,identity LIMIT ?)').run(excess).changes;
  const checks=store.db.prepare('DELETE FROM source_checks WHERE id IN (SELECT id FROM source_checks ORDER BY id DESC LIMIT -1 OFFSET ?)').run(AVAILABILITY_HISTORY_LIMITS.checks).changes;
  if(removed||checks){store.set('availabilityHistoryLimitedAt',new Date(now).toISOString());store.set('availabilityCoverageRevision',(store.get('availabilityCoverageRevision')||0)+1);}
}
// Call only inside the source/text transaction, after the network operation.
// A first entry means first retained observation in this bounded history.
export function observeSource(store,{sourceId,family,subtype=null,stage='metadata',language=null,variant=null,date=null,fetchedAt=null,url=null,acquisition='unknown',existed=false}) {
  atomic(store);
  if(typeof sourceId!=='string'||!sourceId||!validDay(date)||date>brusselsDay(store.clock())||date<cutoff(store.clock()).slice(0,10))return;
  const at=sourceTime(fetchedAt),now=new Date(store.clock()).toISOString();
  if(at&&date>brusselsDay(Date.parse(at)))return;
  const identity=JSON.stringify([family,subtype,stage,sourceId,language,variant]);
  const inserted=store.db.prepare('INSERT OR IGNORE INTO source_observations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(identity,sourceId,family,subtype,stage,language,variant,date,at,at,now,now,existed?'baseline':acquisition,url);
  if(!inserted.changes)store.db.prepare('UPDATE source_observations SET last_source_at=CASE WHEN last_source_at IS NULL OR ?>last_source_at THEN ? ELSE last_source_at END,last_observed_at=?,source_url=? WHERE identity=?')
    .run(at,at,now,url,identity);
}
export function finishAvailabilityWrite(store) {atomic(store);prune(store);touchAvailability(store);}
export function observeCheck(store,check) {
  atomic(store);
  if(!check?.complete||!check.pages||!check.sourceKey)return;
  store.db.prepare('INSERT INTO source_checks(source_key,scope,start,end,first_source_at,last_source_at,observed_at,pages,first_url,last_url,acquisition) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(check.sourceKey,JSON.stringify(check.scope),check.start||null,check.end||null,check.firstSourceAt,check.lastSourceAt,new Date(store.clock()).toISOString(),check.pages,check.firstUrl,check.lastUrl,check.acquisition||'unknown');
  finishAvailabilityWrite(store);
}
export function cataloguePage(body,record,{sourceKey,endpoint,params={},start=null,end=null,acquisition='unknown',complete=false}={}) {
  const prior=body.availabilityCheck,at=sourceTime(record.fetchedAt);
  const url=new URL('https://data.europarl.europa.eu/api/v2'+endpoint);
  for(const [key,value] of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(key,String(value));
  // A later successful page cannot remove censoring from earlier pages.
  const modes=[prior?.acquisition,acquisition].filter(Boolean);
  acquisition=['recovery','backfill','unknown'].find(mode=>modes.includes(mode))||'incremental';
  return {sourceKey,scope:{endpoint,params:Object.fromEntries(Object.entries(params).filter(([key])=>!['offset','limit'].includes(key)))},start,end,acquisition,
    firstSourceAt:prior?.firstSourceAt&&at?[prior.firstSourceAt,at].sort()[0]:prior?.firstSourceAt||at,
    lastSourceAt:prior?.lastSourceAt&&at?[prior.lastSourceAt,at].sort().at(-1):prior?.lastSourceAt||at,
    firstUrl:prior?.firstUrl||url.href,lastUrl:url.href,pages:(prior?.pages||0)+1,complete};
}
export function historyStatus(store) {
  return {startedAt:store.get('availabilityHistoryStartedAt')||null,limitedAt:store.get('availabilityHistoryLimitedAt')||null,
    basis:'first-retained-observation',limits:AVAILABILITY_HISTORY_LIMITS};
}

export function acquisitionMode(store,task,{corpus=false}={}) {
  if(task.attempts||task.body?.recoveryId||task.body?.feedRecovery)return 'recovery';
  if(corpus&&!store.get('backfilledAt'))return 'backfill';
  const working=store.get('working');
  if(working?.initial)return 'backfill';
  const last=Date.parse(store.get(corpus?'lastRunAt':'lastSuccess'));
  return Number.isFinite(last)&&store.clock()-last<=26*60*60_000?'incremental':'unknown';
}
