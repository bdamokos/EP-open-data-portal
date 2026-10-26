import {scheduleGroupHistory,freezeGroupHistory} from './group-history.mjs';
import {scheduleMembership,freezeMembership} from './following-membership.mjs';
import {stat} from 'node:fs/promises';
import {generationGroupOn} from './group-attribution.mjs';
import {brusselsDay} from './analysis-period.mjs';

export const HISTORY_READINESS_VERSION=1;
const pending="generation=? AND (done IN (-1,0) OR done IS NULL) AND (kind='membership' OR kind LIKE 'group-history-%')";

export function scheduleHistoryReadiness(store,generation) {
  const cycle=store.get('working');
  if(cycle?.generation!==generation||cycle.historyReadinessVersion===HISTORY_READINESS_VERSION)return;
  // Reuse pending pre-upgrade tasks and their durable page cursors.
  if(!cycle.membershipScheduled)scheduleMembership(store,generation);
  if(!cycle.groupHistoryScheduled)scheduleGroupHistory(store,generation);
  store.updateCycle({historyReadinessVersion:HISTORY_READINESS_VERSION,membershipScheduled:true,groupHistoryScheduled:true});
}

export function publishMissingHistory(store,sourceGeneration) {
  const generation=store.get('active');
  if(!generation||store.get('working')?.generation!==sourceGeneration)return false;
  if(store.db.prepare('SELECT 1 FROM membership_snapshots WHERE generation=?').get(generation)&&store.db.prepare('SELECT 1 FROM group_history_snapshots WHERE generation=?').get(generation))return false;
  if(store.db.prepare('SELECT 1 FROM tasks WHERE '+pending+' LIMIT 1').get(sourceGeneration))return false;
  if(store.get('working').historyReadinessVersion!==HISTORY_READINESS_VERSION)return false;
  return store.transaction(()=>{
    store.assertWriter();
    const original=store.db.prepare('SELECT published_at FROM follow_generations WHERE generation=?').get(generation)?.published_at||store.get('lastSuccess');
    if(!original)throw Error('History upgrade requires the serving publication date.');
    const publication={version:HISTORY_READINESS_VERSION,boundGeneration:generation,sourceGeneration,asOf:brusselsDay(Date.parse(original)),publishedAt:new Date(store.clock()).toISOString()};
    const people=new Set(store.db.prepare('SELECT mep FROM follow_summary WHERE generation=? UNION SELECT mep FROM items WHERE generation=?').all(generation,generation).map(row=>row.mep));
    // Former people already absent from the serving roster can still have
    // historical contributions/following events. Never admit later joiners.
    for(const list of ['incoming','outgoing'])for(const mandate of store.source(sourceGeneration,'membership:'+list)?.work.mandates||[])if(mandate.end&&mandate.end<=publication.asOf)people.add(mandate.mep);
    let changed=false;
    // A generation that returned 200 stays byte-for-byte frozen. Only a missing
    // (503) observation can receive this first, explicitly bound publication.
    if(!store.db.prepare('SELECT 1 FROM membership_snapshots WHERE generation=?').get(generation)) {
      freezeMembership(store,generation,store.get('previous'),{sourceGeneration,publication,people});changed=true;
    }
    if(!store.db.prepare('SELECT 1 FROM group_history_snapshots WHERE generation=?').get(generation)) {
      freezeGroupHistory(store,generation,store.get('previous'),{sourceGeneration,publication,people});changed=true;
    }
    return changed;
  });
}

export async function runHistoryReadiness(worker,generation) {
  const {store}=worker;
  scheduleHistoryReadiness(store,generation);
  if(worker.requests>=worker.budget)return;
  const start=worker.requests,cap=Math.min(32,Math.max(1,Math.floor(worker.budget/5)));
  // At a one-request budget alternate with ordinary work instead of consuming
  // every iteration. Larger budgets always leave ordinary acquisition room.
  if(worker.budget===1){worker.historyTurn=!worker.historyTurn;if(!worker.historyTurn)return;}
  const deadline=Math.min(worker.runDeadline??Infinity,worker.monotonic()+20_000);
  for(let actions=0;actions<64&&!worker.stopped&&worker.requests<worker.budget&&worker.requests-start<cap&&worker.monotonic()<deadline;actions++) {
    const size=(await Promise.all(['','-wal','-shm'].map(suffix=>stat(store.filename+suffix).then(file=>file.size).catch(()=>0)))).reduce((sum,bytes)=>sum+bytes,0);
    if(size>worker.diskLimit){store.updateCycle({phase:'paused',error:'Activity index reached its configured disk limit.'});return;}
    const row=store.db.prepare("SELECT * FROM tasks WHERE generation=? AND (done IN (-1,0) OR done IS NULL) AND (kind='roster' OR kind='membership' OR kind LIKE 'group-history-%') AND retry_at<=? ORDER BY priority DESC,key DESC LIMIT 1").get(generation,worker.clock());
    if(!row)break;
    const task={...row,body:JSON.parse(row.body)};
    try {await worker.task(task);}catch(error){if(worker.stopped||worker.controller.signal.aborted)throw error;store.failTask(task,error);}
  }
  publishMissingHistory(store,generation);
}

export function historyReadiness(store,generation) {
  const group=store.db.prepare("SELECT json_extract(body,'$.coverage') coverage,json_extract(body,'$.publication') publication FROM group_history_snapshots WHERE generation=?").get(generation);
  const membership=store.db.prepare("SELECT json_extract(body,'$.publication') publication FROM membership_snapshots WHERE generation=?").get(generation);
  const cycle=store.get('working');
  return {groups:{ready:!!group,coverage:group?.coverage?JSON.parse(group.coverage):null,publication:group?.publication?JSON.parse(group.publication):null},membership:{ready:!!membership,publication:membership?.publication?JSON.parse(membership.publication):null},
    acquisition:cycle?{generation:cycle.generation,refetches:cycle.groupHistoryRefetches||0,refetchLimit:150,pending:store.db.prepare('SELECT kind,COUNT(*) count FROM tasks WHERE '+pending+' GROUP BY kind').all(cycle.generation)}:null};
}

// First publication changes the cache identity; successful snapshots never change.
export function historyCacheKey(store,generation) {
  return Number(!!generationGroupOn(store,generation).codes);
}
