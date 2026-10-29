// Shared by the normal writer and the dependency-free, read-only audit CLI.
// An existing task, gap or saved continuation owns its own retry/cursor clock.
export const mutableCandidateSql=`SELECT mutable.key,mutable.next_check AS nextCheck
  FROM mutable_documents mutable WHERE mutable.generation=? AND mutable.next_check<=?
  AND NOT EXISTS(SELECT 1 FROM refresh_gaps gap WHERE gap.generation=mutable.generation AND gap.key=mutable.key)
  AND NOT EXISTS(SELECT 1 FROM tasks task WHERE task.generation=mutable.generation AND task.key=mutable.key AND (task.done IS NULL OR task.done<>1))
  AND NOT EXISTS(SELECT 1 FROM amendment_jobs task WHERE task.generation=mutable.generation AND task.key=mutable.key AND (task.done IS NULL OR task.done<>1))
  ORDER BY mutable.next_check,mutable.key`;

export function* mutableDocumentCandidates(db,generation,now) {
  let deferred;
  for(const row of db.prepare(mutableCandidateSql).iterate(generation,now)) {
    if(!deferred) {
      const saved=db.prepare("SELECT body FROM sources WHERE generation=? AND key='amendment:continuations'").get(generation);
      const checkpoint=saved?JSON.parse(saved.body):{};
      deferred=new Set([...(checkpoint.tasks||[]),...(checkpoint.discovery||[])].map(task=>task.key));
    }
    if(!deferred.has(row.key))yield row;
  }
}

// A long catch-up must not chase newly due weekly checks forever. Subsequent
// deadlines can start the next ordinary generation after this cohort publishes.
export function mutableBackfillCutoff(cycle,generation,now) {
  if(cycle?.generation!==generation)return now;
  const started=Date.parse(cycle.startedAt);
  if(!Number.isFinite(started))throw new Error('Mutable backfill requires a valid working-generation start.');
  return Math.min(now,started);
}

export function mutableRecoveryDue(store,generation,now=store.clock()) {
  const cutoff=mutableBackfillCutoff(store.get('working'),generation,now);
  for(const row of mutableDocumentCandidates(store.db,generation,cutoff))return true;
  return false;
}
