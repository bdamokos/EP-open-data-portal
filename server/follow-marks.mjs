import {randomUUID} from 'node:crypto';
import {activityOnly,answersOnly} from './activity-read-projections.mjs';
import {refreshSnapshotMatches} from './refresh-policy.mjs';

// Independent of the activity read projections: preparation never rebuilds them.
export const followMarksVersion=1;
export const markedKinds=[['activity','saved_activity_sources',activityOnly],['answer','saved_answer_sources',answersOnly]];

export function assignFollowMarks(db,generation) {
  for(const [kind,index,predicate] of markedKinds)db.prepare(`INSERT OR IGNORE INTO item_marks(mep,kind,source_id,mark)
    SELECT DISTINCT mep,?,source_id,? FROM items INDEXED BY ${index} WHERE generation=? AND ${predicate}`).run(kind,generation,generation);
}

export function freezeFollowSummary(db,generation) {
  // Empty/unknown roster leaves no summary, rather than a misleading empty manifest.
  db.prepare('DELETE FROM follow_summary WHERE generation=?').run(generation);
  db.prepare(`INSERT INTO follow_summary SELECT ?,id,NULL,NULL,0,0 FROM members`).run(generation);
  for(const [kind,index,predicate] of markedKinds)db.prepare(`WITH current_marks AS (
      SELECT current.mep,MAX(mark.mark) AS mark,COUNT(*) AS count FROM
        (SELECT DISTINCT mep,source_id FROM items INDEXED BY ${index} WHERE generation=? AND ${predicate}) current
        JOIN item_marks mark ON mark.mep=current.mep AND mark.kind=? AND mark.source_id=current.source_id
      GROUP BY current.mep)
    UPDATE follow_summary SET ${kind}_mark=current_marks.mark,${kind}_count=current_marks.count
      FROM current_marks WHERE generation=? AND follow_summary.mep=current_marks.mep`).run(generation,kind,generation);
}

export function followIndexComplete(store,generation) {
  return Boolean(generation)&&refreshSnapshotMatches(store)&&!store.db.prepare('SELECT 1 FROM refresh_gaps WHERE generation=? LIMIT 1').get(generation);
}

export function publishFollowMarks(store,generation,publishedAt,indexComplete) {
  assignFollowMarks(store.db,generation);
  freezeFollowSummary(store.db,generation);
  store.db.prepare('INSERT OR REPLACE INTO follow_generations VALUES (?,?,?)').run(generation,publishedAt,Number(indexComplete));
  if(store.get('markBaseline')===null)store.set('markBaseline',generation);
}

// Called only within acquire's leased preparation transaction, after read indexes.
export function prepareFollowMarks(store) {
  const db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS item_marks(mep TEXT NOT NULL,kind TEXT NOT NULL,source_id TEXT NOT NULL,mark INTEGER NOT NULL,PRIMARY KEY(mep,kind,source_id));
    CREATE TABLE IF NOT EXISTS follow_summary(generation INTEGER,mep TEXT,activity_mark INTEGER,answer_mark INTEGER,activity_count INTEGER NOT NULL,answer_count INTEGER NOT NULL,PRIMARY KEY(generation,mep));
    CREATE TABLE IF NOT EXISTS follow_generations(generation INTEGER PRIMARY KEY,published_at TEXT,index_complete INTEGER NOT NULL);`);
  if(!store.get('marksEpoch'))store.set('marksEpoch',randomUUID());
  const active=store.get('active'),previous=store.get('previous');
  for(const generation of [...new Set([previous,active].filter(Boolean))]) {
    // No timestamp was retained for pre-migration previous generations.
    publishFollowMarks(store,generation,generation===active?store.get('lastSuccess'):null,followIndexComplete(store,generation));
  }
  store.set('markBaseline',active||null);
  store.set('followMarksVersion',followMarksVersion);
}
