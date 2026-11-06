import {generationGroupOn} from './group-attribution.mjs';
import {groupHistorySnapshot} from './group-history.mjs';
import {summariseVoteSitting,voteSittingStatus,memberVoteRecordRevision} from './member-vote-record-model.mjs';

// Projection tables live beside sitting_snapshots in the activity index. Only
// the leased index writer writes them; readers open the same file read-only.
export function prepareMemberVoteRecord(store) {
  store.assertWriter();
  store.db.exec(`CREATE TABLE IF NOT EXISTS member_vote_record_sittings (
    sitting_id TEXT PRIMARY KEY, revision TEXT NOT NULL, date TEXT NOT NULL,
    group_generation INTEGER, snapshot_version INTEGER NOT NULL,
    named INTEGER NOT NULL, decisions TEXT NOT NULL, complete INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'projected', reason TEXT, subjects TEXT NOT NULL DEFAULT '{}');
    CREATE INDEX IF NOT EXISTS member_vote_record_sitting_date ON member_vote_record_sittings(date DESC);
    CREATE TABLE IF NOT EXISTS member_vote_record_members (
    member_id TEXT NOT NULL, sitting_id TEXT NOT NULL, body TEXT NOT NULL,
    PRIMARY KEY(member_id,sitting_id));
    CREATE TABLE IF NOT EXISTS member_vote_record_totals (
    member_id TEXT PRIMARY KEY, body TEXT NOT NULL);`);
}

const totalKeys=['withGroup','comparable','finalWithGroup','finalComparable'];
const totalBody=value=>Object.fromEntries(totalKeys.map(key=>[key,Number(value?.[key])||0]));
const readTotal=(db,memberId)=>{const row=db.prepare('SELECT body FROM member_vote_record_totals WHERE member_id=?').get(memberId);return totalBody(row?JSON.parse(row.body):null);};
const shift=(total,by,sign)=>Object.fromEntries(totalKeys.map(key=>[key,Math.max(0,total[key]+sign*(by?.[key]||0))]));

// Rewrites one sitting atomically and adjusts member totals by the difference,
// so a term-wide median never needs a full projection scan.
export function writeMemberVoteRecord(store,day,{groupOn=null,groupGeneration=null,snapshotVersion=0}={}) {
  store.assertWriter();
  // Every examined sitting leaves a row: projected, empty (no decisions) or excluded with its reason.
  const {status,reason}=voteSittingStatus(day);
  const summary=status==='projected'?summariseVoteSitting(day,groupOn,{groupGeneration})
    :{sittingId:day.sittingId,date:day.date,revision:memberVoteRecordRevision(day,groupGeneration),members:new Map(),sitting:{named:0,decisions:{},subjects:{},complete:false}};
  store.transaction(()=>{
    const db=store.db,putTotal=db.prepare('INSERT INTO member_vote_record_totals(member_id,body) VALUES(?,?) ON CONFLICT(member_id) DO UPDATE SET body=excluded.body');
    for(const row of db.prepare('SELECT member_id,body FROM member_vote_record_members WHERE sitting_id=?').all(summary.sittingId)) {
      const old=JSON.parse(row.body),current=readTotal(db,row.member_id);
      putTotal.run(row.member_id,JSON.stringify(shift(current,old.bySitting,-1)));
    }
    db.prepare('DELETE FROM member_vote_record_members WHERE sitting_id=?').run(summary.sittingId);
    const insert=db.prepare('INSERT INTO member_vote_record_members(member_id,sitting_id,body) VALUES(?,?,?)');
    for(const [memberId,record] of summary.members) {
      insert.run(memberId,summary.sittingId,JSON.stringify(record));
      putTotal.run(memberId,JSON.stringify(shift(readTotal(db,memberId),record.bySitting,1)));
    }
    db.prepare(`INSERT INTO member_vote_record_sittings(sitting_id,revision,date,group_generation,snapshot_version,named,decisions,complete,status,reason,subjects)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sitting_id) DO UPDATE SET revision=excluded.revision,date=excluded.date,
      group_generation=excluded.group_generation,snapshot_version=excluded.snapshot_version,named=excluded.named,
      decisions=excluded.decisions,complete=excluded.complete,status=excluded.status,reason=excluded.reason,subjects=excluded.subjects`)
      .run(summary.sittingId,summary.revision,summary.date,groupGeneration,snapshotVersion,summary.sitting.named,JSON.stringify(summary.sitting.decisions),Number(summary.sitting.complete),status,reason,JSON.stringify(summary.sitting.subjects));
  });
  return summary;
}

// The scheduler treats a stored votes snapshot with a body and no current examination
// as one bounded backfill unit; no request-time sitting parse is needed. A past vote is
// final, so a failed refresh flag, or an unfinished agenda, does not take a sitting out.
export function missingMemberVoteRecord(store,version,groupGeneration,skip=[]) {
  if(!store?.db)return null;
  const skipped=new Set(skip);
  try {
    return store.db.prepare(`SELECT s.id FROM sitting_snapshots s
      LEFT JOIN member_vote_record_sittings r ON r.sitting_id=s.id
      WHERE s.kind='votes' AND s.version=? AND s.body IS NOT NULL
      AND (r.sitting_id IS NULL OR r.snapshot_version IS NOT ? OR r.group_generation IS NOT ?)
      ORDER BY s.id DESC LIMIT ?`).all(version,version,groupGeneration??null,skipped.size+1).find(row=>!skipped.has(row.id))?.id||null;
  }catch{return null;}
}

export function retainMemberVoteRecord(store,day,version=0) {
  const generation=store.get?.('active');
  const snapshot=generation?groupHistorySnapshot(store,generation):null;
  return writeMemberVoteRecord(store,day,{groupOn:snapshot?generationGroupOn(store,generation):null,groupGeneration:snapshot?generation:null,snapshotVersion:version});
}
