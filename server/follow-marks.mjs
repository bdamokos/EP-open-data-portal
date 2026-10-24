import {prepareDossierMarks,publishDossierMarks} from './follow-dossiers.mjs';
import {randomUUID} from 'node:crypto';
import {activityOnly,answersOnly} from './activity-read-projections.mjs';
import {refreshSnapshotMatches} from './refresh-policy.mjs';

// Independent of the activity read projections: preparation never rebuilds them.
export const followMarksVersion=3;
export const markedKinds=[['activity','saved_activity_sources',activityOnly],['answer','saved_answer_sources',answersOnly]];

export function assignFollowMarks(db,generation) {
  for(const [number,[,index,predicate]] of markedKinds.entries())db.prepare(`INSERT OR IGNORE INTO item_marks(mep,kind,source_id,mark)
    SELECT DISTINCT mep,?,source_id,? FROM items INDEXED BY ${index} WHERE generation=? AND ${predicate}`).run(number,generation,generation);
}

export function freezeFollowSummary(db,generation) {
  // Empty/unknown roster leaves no summary, rather than a misleading empty manifest.
  db.prepare('DELETE FROM follow_summary WHERE generation=?').run(generation);
  db.prepare(`INSERT INTO follow_summary SELECT ?,id,NULL,NULL,0,0 FROM members`).run(generation);
  for(const [number,[kind,index,predicate]] of markedKinds.entries())db.prepare(`WITH current_marks AS (
      SELECT current.mep,MAX(mark.mark) AS mark,COUNT(*) AS count FROM
        (SELECT DISTINCT mep,source_id FROM items INDEXED BY ${index} WHERE generation=? AND ${predicate}) current
        JOIN item_marks mark ON mark.mep=current.mep AND mark.kind=? AND mark.source_id=current.source_id
      GROUP BY current.mep)
    UPDATE follow_summary SET ${kind}_mark=current_marks.mark,${kind}_count=current_marks.count
      FROM current_marks WHERE generation=? AND follow_summary.mep=current_marks.mep`).run(generation,number,generation);
}

function changedIdentities(db,generation,previous) {
  db.exec(`CREATE TEMP TABLE IF NOT EXISTS follow_changes(mep TEXT,kind INTEGER,source_id TEXT,was_present INTEGER,is_present INTEGER,PRIMARY KEY(mep,kind,source_id)) WITHOUT ROWID;
    DELETE FROM follow_changes;`);
  // Seek each touched source, never scan the generation or parse unchanged bodies.
  for(const [number,[,index,predicate]] of markedKinds.entries()) {
    for(const snapshot of new Set([previous,generation]))db.prepare(`INSERT OR IGNORE INTO follow_changes(mep,kind,source_id)
      SELECT item.mep,?,item.source_id FROM follow_touched touched CROSS JOIN items item INDEXED BY item_source
      WHERE touched.generation=? AND item.generation=? AND item.source_key=touched.source_key AND ${predicate}`).run(number,generation,snapshot);
    // An identity can also occur under an untouched source or another category.
    db.prepare(`UPDATE follow_changes SET was_present=EXISTS(SELECT 1 FROM items INDEXED BY ${index}
        WHERE generation=? AND mep=follow_changes.mep AND source_id=follow_changes.source_id AND ${predicate}),
      is_present=EXISTS(SELECT 1 FROM items INDEXED BY ${index}
        WHERE generation=? AND mep=follow_changes.mep AND source_id=follow_changes.source_id AND ${predicate}) WHERE kind=?`).run(previous,generation,number);
  }
}

function updateFollowSummary(db,generation,previous) {
  db.prepare('DELETE FROM follow_summary WHERE generation=?').run(generation);
  db.prepare(`INSERT INTO follow_summary SELECT ?,members.id,old.activity_mark,old.answer_mark,
    COALESCE(old.activity_count,0),COALESCE(old.answer_count,0) FROM members
    LEFT JOIN follow_summary old ON old.generation=? AND old.mep=members.id`).run(generation,previous);
  for(const [number,[kind,index,predicate]] of markedKinds.entries()) {
    // Most changes only need distinct-identity count deltas and a nondecreasing max.
    // A roster addition or removal of a maximum needs a fresh aggregate for that MEP.
    db.prepare(`WITH delta AS (SELECT change.mep,SUM(is_present-was_present) AS count,
        MAX(CASE WHEN is_present=1 THEN mark.mark END) AS mark FROM follow_changes change
        JOIN item_marks mark USING(mep,kind,source_id) WHERE change.kind=? GROUP BY change.mep)
      UPDATE follow_summary SET ${kind}_count=${kind}_count+delta.count,
        ${kind}_mark=CASE WHEN ${kind}_mark IS NULL OR delta.mark>${kind}_mark THEN delta.mark ELSE ${kind}_mark END
      FROM delta WHERE generation=? AND follow_summary.mep=delta.mep`).run(number,generation);
    const rebuild=db.prepare(`SELECT current.mep FROM follow_summary current
      LEFT JOIN follow_summary old ON old.generation=? AND old.mep=current.mep
      WHERE current.generation=? AND (old.mep IS NULL OR (EXISTS(
        SELECT 1 FROM follow_changes change JOIN item_marks mark USING(mep,kind,source_id)
        WHERE change.mep=current.mep AND change.kind=? AND was_present=1 AND is_present=0 AND mark.mark=current.${kind}_mark)
      AND NOT EXISTS(SELECT 1 FROM follow_changes change JOIN item_marks mark USING(mep,kind,source_id)
        WHERE change.mep=current.mep AND change.kind=? AND is_present=1 AND mark.mark>=current.${kind}_mark)))`).all(previous,generation,number,number);
    const aggregate=db.prepare(`SELECT MAX(mark.mark) AS mark,COUNT(*) AS count FROM
      (SELECT DISTINCT source_id FROM items INDEXED BY ${index} WHERE generation=? AND mep=? AND ${predicate}) current
      JOIN item_marks mark ON mark.mep=? AND mark.kind=? AND mark.source_id=current.source_id`);
    const put=db.prepare(`UPDATE follow_summary SET ${kind}_mark=?,${kind}_count=? WHERE generation=? AND mep=?`);
    for(const {mep} of rebuild) {
      const row=aggregate.get(generation,mep,mep,number);put.run(row.mark,row.count,generation,mep);
    }
  }
}

export function followIndexComplete(store,generation) {
  return Boolean(generation)&&refreshSnapshotMatches(store)&&!store.db.prepare('SELECT 1 FROM refresh_gaps WHERE generation=? LIMIT 1').get(generation);
}

export function publishFollowMarks(store,generation,publishedAt,indexComplete,previous=null,rosterBasis='publication') {
  const db=store.db;
  publishDossierMarks(store,generation);
  const incremental=previous&&previous!==generation&&db.prepare('SELECT 1 FROM follow_summary WHERE generation=? LIMIT 1').get(previous);
  if(incremental) {
    changedIdentities(db,generation,previous);
    db.prepare(`INSERT OR IGNORE INTO item_marks SELECT mep,kind,source_id,? FROM follow_changes WHERE is_present=1`).run(generation);
    updateFollowSummary(db,generation,previous);
  } else {
    assignFollowMarks(db,generation);
    freezeFollowSummary(db,generation);
  }
  db.prepare('INSERT OR REPLACE INTO follow_generations VALUES (?,?,?,?)').run(generation,publishedAt,Number(indexComplete),rosterBasis);
  db.prepare('DELETE FROM follow_touched WHERE generation=?').run(generation);
  if(store.get('markBaseline')===null)store.set('markBaseline',generation);
}

// Called only within acquire's leased preparation transaction, after read indexes.
export function prepareFollowMarks(store) {
  const db=store.db;
  prepareDossierMarks(store);
  // Preserve first-publication marks/epoch when upgrading the unreleased text-kind schema.
  const legacy=db.prepare("PRAGMA table_info('item_marks')").all().some(row=>row.name==='kind'&&row.type==='TEXT');
  if(legacy)db.exec('ALTER TABLE item_marks RENAME TO legacy_item_marks;');
  db.exec(`CREATE TABLE IF NOT EXISTS item_marks(mep TEXT NOT NULL,kind INTEGER NOT NULL CHECK(kind IN (0,1)),source_id TEXT NOT NULL,mark INTEGER NOT NULL,PRIMARY KEY(mep,kind,source_id)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS follow_touched(generation INTEGER,source_key TEXT,PRIMARY KEY(generation,source_key)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS follow_summary(generation INTEGER,mep TEXT,activity_mark INTEGER,answer_mark INTEGER,activity_count INTEGER NOT NULL,answer_count INTEGER NOT NULL,PRIMARY KEY(generation,mep));
    CREATE TABLE IF NOT EXISTS follow_generations(generation INTEGER PRIMARY KEY,published_at TEXT,index_complete INTEGER NOT NULL,roster_basis TEXT NOT NULL);`);
  if(legacy)db.exec(`INSERT INTO item_marks SELECT mep,CASE kind WHEN 'activity' THEN 0 ELSE 1 END,source_id,mark FROM legacy_item_marks; DROP TABLE legacy_item_marks;`);
  if(!db.prepare("PRAGMA table_info('follow_generations')").all().some(row=>row.name==='roster_basis'))db.exec("ALTER TABLE follow_generations ADD COLUMN roster_basis TEXT NOT NULL DEFAULT 'preparation'");
  if(!store.get('marksEpoch'))store.set('marksEpoch',randomUUID());
  const active=store.get('active'),previous=store.get('previous');
  for(const generation of [...new Set([previous,active].filter(Boolean))]) {
    // No timestamp was retained for pre-migration previous generations.
    publishFollowMarks(store,generation,generation===active?store.get('lastSuccess'):null,followIndexComplete(store,generation),null,'preparation');
  }
  // Work may predate preparation, including deletions. Compare all its sources once.
  db.exec('DELETE FROM follow_touched');
  const working=store.get('working')?.generation;
  if(working)for(const generation of new Set([working,active].filter(Boolean)))db.prepare(`INSERT OR IGNORE INTO follow_touched
    SELECT ?,source_key FROM items WHERE generation=? GROUP BY source_key`).run(working,generation);
  store.set('markBaseline',active||null);
  store.set('followMarksVersion',followMarksVersion);
}
