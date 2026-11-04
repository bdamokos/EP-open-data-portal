// Additive preparation: no body reads, projection replay or corpus rewrite.
export const generationPruneSchemaVersion=1;
const derived=['amendment_contributors','amendment_read_flags','amendment_page_reads','amendment_procedure_targets','amendment_target_reads'];
const base=['amendments','amendment_targets','amendment_jobs','amendment_member_dependencies','amendment_member_pending','amendment_author_targets','amendment_member_current','amendment_dependency_bootstrap'];
export function prepareGenerationPrune(db) {
  db.exec(`CREATE INDEX IF NOT EXISTS amendment_contributor_identity ON amendment_contributors(generation,amendment_id,person_id);
    CREATE INDEX IF NOT EXISTS amendment_procedure_target ON amendment_procedure_targets(generation,target);`);
  // Only source-table DELETE triggers are gated. In particular, never gate or
  // add triggers on REPLACE-written projections, whose recursive mode varies.
  for(const name of ['amendment_contributor_delete','amendment_read_delete','fast_amendment_page_delete','amendment_procedure_delete','fast_amendment_targets_delete']) {
    const {sql}=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name);
    if(sql.includes('amendmentPruneGeneration'))continue;
    db.exec('DROP TRIGGER '+name);
    db.exec(sql.replace(/\bBEGIN\b/i,"WHEN COALESCE((SELECT value FROM meta WHERE key='amendmentPruneGeneration'),'')<>CAST(OLD.generation AS TEXT) BEGIN"));
  }
}

export function pruneAmendmentGenerations(db,generation,old) {
  if(!db.isTransaction)throw new Error('Generation pruning requires a transaction.');
  // Include orphaned projections from interrupted legacy writers as well.
  const removed=db.prepare('SELECT DISTINCT generation FROM ('+[...base,...derived].map(table=>`SELECT generation FROM ${table}`).join(' UNION ALL ')+" UNION ALL SELECT generation FROM fast_read_progress WHERE projection IN ('amendments','targets')) WHERE generation NOT IN (?,?)").all(generation,old);
  for(const {generation:discard} of removed) {
    db.prepare("INSERT INTO meta(key,value) VALUES ('amendmentPruneGeneration',?)").run(String(discard));
    try {
      db.prepare("DELETE FROM fast_read_progress WHERE generation=? AND projection IN ('amendments','targets')").run(discard);
      let changed=0;
      for(const table of derived)changed+=Number(db.prepare(`DELETE FROM ${table} WHERE generation=?`).run(discard).changes);
      for(const table of base)changed+=Number(db.prepare(`DELETE FROM ${table} WHERE generation=?`).run(discard).changes);
      // Revision is an invalidation token, not a row count. One bump suffices
      // for the removed contributor/target set, including orphaned projections.
      if(changed)db.exec("INSERT INTO meta(key,value) VALUES ('amendmentMutationRevision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)");
    } finally {
      db.exec("DELETE FROM meta WHERE key='amendmentPruneGeneration'");
    }
  }
}
