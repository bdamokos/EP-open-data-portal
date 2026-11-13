import {createHash} from 'node:crypto';
import {createGroupOn} from './group-attribution.mjs';
import {groupHistorySnapshot} from './group-history.mjs';
import {summariseVoteSitting,voteSittingStatus,memberVoteRecordRevision} from './member-vote-record-model.mjs';
import {topicsGeneration,decisionTags} from './member-vote-record-topics.mjs';

// Increment when projection semantics change; held snapshots then rebuild once.
export const MEMBER_VOTE_RECORD_PROJECTION_VERSION=2;

// Projection tables live beside sitting_snapshots in the activity index. Only
// the leased index writer writes them; readers open the same file read-only.
export function prepareMemberVoteRecord(store) {
  store.assertWriter();
  store.db.exec(`CREATE TABLE IF NOT EXISTS member_vote_record_sittings (
    sitting_id TEXT PRIMARY KEY, revision TEXT NOT NULL, date TEXT NOT NULL,
    group_generation TEXT, snapshot_version INTEGER NOT NULL, snapshot_checked_at INTEGER, projection_version INTEGER NOT NULL DEFAULT 0,
    named INTEGER NOT NULL, complete INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'projected', reason TEXT,
    unprojected INTEGER NOT NULL DEFAULT 0, decisions TEXT NOT NULL, subjects TEXT NOT NULL DEFAULT '{}');
    -- Tags stay out of the sitting row: SQLite reads past the large wording column to reach a later one.
    CREATE TABLE IF NOT EXISTS member_vote_record_tags (
    sitting_id TEXT PRIMARY KEY, topics_generation INTEGER, tags TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS member_vote_record_members (
    member_id TEXT NOT NULL, sitting_id TEXT NOT NULL, body TEXT NOT NULL,
    PRIMARY KEY(member_id,sitting_id));
    CREATE INDEX IF NOT EXISTS member_vote_record_member_sitting ON member_vote_record_members(sitting_id);
    CREATE TABLE IF NOT EXISTS member_vote_record_totals (
    member_id TEXT NOT NULL, snapshot_version INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(member_id,snapshot_version));`);
  const columns=new Set(store.db.prepare('PRAGMA table_info(member_vote_record_sittings)').all().map(row=>row.name));
  for(const [name,type] of [['projection_version','INTEGER NOT NULL DEFAULT 0'],['snapshot_checked_at','INTEGER'],['unprojected','INTEGER NOT NULL DEFAULT 0']])if(!columns.has(name))store.db.exec('ALTER TABLE member_vote_record_sittings ADD COLUMN '+name+' '+type);
  if(!store.db.prepare('PRAGMA table_info(member_vote_record_totals)').all().some(row=>row.name==='snapshot_version')) {
    store.db.exec(`ALTER TABLE member_vote_record_totals RENAME TO member_vote_record_old_totals;
      CREATE TABLE member_vote_record_totals(member_id TEXT NOT NULL,snapshot_version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(member_id,snapshot_version));
      INSERT INTO member_vote_record_totals SELECT m.member_id,s.snapshot_version,json_object(
        'withGroup',SUM(COALESCE(json_extract(m.body,'$.bySitting.withGroup'),0)),
        'comparable',SUM(COALESCE(json_extract(m.body,'$.bySitting.comparable'),0)),
        'finalWithGroup',SUM(COALESCE(json_extract(m.body,'$.bySitting.finalWithGroup'),0)),
        'finalComparable',SUM(COALESCE(json_extract(m.body,'$.bySitting.finalComparable'),0)))
        FROM member_vote_record_members m JOIN member_vote_record_sittings s ON s.sitting_id=m.sitting_id GROUP BY m.member_id,s.snapshot_version;
      DROP TABLE member_vote_record_old_totals;`);
  }
  store.db.exec('CREATE INDEX IF NOT EXISTS member_vote_record_status ON member_vote_record_sittings(snapshot_version,status,sitting_id,date,unprojected)');
}

const totalKeys=['withGroup','comparable','finalWithGroup','finalComparable'];
const totalBody=value=>Object.fromEntries(totalKeys.map(key=>[key,Number(value?.[key])||0]));
const readTotal=(db,memberId,version)=>{const row=db.prepare('SELECT body FROM member_vote_record_totals WHERE member_id=? AND snapshot_version=?').get(memberId,version);return totalBody(row?JSON.parse(row.body):null);};
const shift=(total,by,sign)=>Object.fromEntries(totalKeys.map(key=>[key,Math.max(0,total[key]+sign*(by?.[key]||0))]));

// Tags are one entry per named decision, in the order of the members' vectors:
// [decisionId, procedures, microthesaurus IDs, country IDs].
function sittingTags(db,generation,decisions) {
  return JSON.stringify(Object.entries(decisions).map(([id,decision])=>{const tags=decisionTags(db,generation,decision.docs);return [id,tags.p,tags.m,tags.c];}));
}

// Rewrites one sitting atomically and adjusts member totals by the difference,
// so a term-wide median never needs a full projection scan.
export function writeMemberVoteRecord(store,day,{groupOn=null,groupGeneration=null,snapshotVersion=0,topicGeneration=topicsGeneration(store),snapshotCheckedAt=null}={}) {
  store.assertWriter();
  // Every examined sitting leaves a row: projected, empty (no decisions) or excluded with its reason.
  const {status,reason}=voteSittingStatus(day);
  const summary=status==='projected'?summariseVoteSitting(day,groupOn,{groupGeneration})
    :{sittingId:day.sittingId,date:day.date,revision:memberVoteRecordRevision(day,groupGeneration),members:new Map(),sitting:{named:0,decisions:{},subjects:{},complete:false}};
  store.transaction(()=>{
    store.assertWriter();
    const db=store.db,putTotal=db.prepare('INSERT INTO member_vote_record_totals(member_id,snapshot_version,body) VALUES(?,?,?) ON CONFLICT(member_id,snapshot_version) DO UPDATE SET body=excluded.body');
    const oldVersion=db.prepare('SELECT snapshot_version FROM member_vote_record_sittings WHERE sitting_id=?').get(summary.sittingId)?.snapshot_version??snapshotVersion;
    for(const row of db.prepare('SELECT member_id,body FROM member_vote_record_members WHERE sitting_id=?').all(summary.sittingId)) {
      const old=JSON.parse(row.body),current=readTotal(db,row.member_id,oldVersion);
      putTotal.run(row.member_id,oldVersion,JSON.stringify(shift(current,old.bySitting,-1)));
    }
    db.prepare('DELETE FROM member_vote_record_members WHERE sitting_id=?').run(summary.sittingId);
    const insert=db.prepare('INSERT INTO member_vote_record_members(member_id,sitting_id,body) VALUES(?,?,?)');
    for(const [memberId,record] of summary.members) {
      insert.run(memberId,summary.sittingId,JSON.stringify(record));
      putTotal.run(memberId,snapshotVersion,JSON.stringify(shift(readTotal(db,memberId,snapshotVersion),record.bySitting,1)));
    }
    db.prepare(`INSERT INTO member_vote_record_sittings(sitting_id,revision,date,group_generation,snapshot_version,named,decisions,complete,status,reason,subjects,snapshot_checked_at,unprojected,projection_version)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sitting_id) DO UPDATE SET revision=excluded.revision,date=excluded.date,
      group_generation=excluded.group_generation,snapshot_version=excluded.snapshot_version,named=excluded.named,
      decisions=excluded.decisions,complete=excluded.complete,status=excluded.status,reason=excluded.reason,subjects=excluded.subjects,snapshot_checked_at=excluded.snapshot_checked_at,unprojected=excluded.unprojected,projection_version=excluded.projection_version`)
      .run(summary.sittingId,summary.revision,summary.date,groupGeneration,snapshotVersion,summary.sitting.named,JSON.stringify(summary.sitting.decisions),Number(summary.sitting.complete),status,reason,JSON.stringify(summary.sitting.subjects),snapshotCheckedAt,summary.sitting.unprojected||0,MEMBER_VOTE_RECORD_PROJECTION_VERSION);
    db.prepare('INSERT INTO member_vote_record_tags(sitting_id,topics_generation,tags) VALUES(?,?,?) ON CONFLICT(sitting_id) DO UPDATE SET topics_generation=excluded.topics_generation,tags=excluded.tags')
      .run(summary.sittingId,topicGeneration,sittingTags(db,topicGeneration,summary.sitting.decisions));
  });
  return summary;
}

// The scheduler treats a stored votes snapshot with a body and no current examination
// as one bounded backfill unit; no request-time sitting parse is needed. A past vote is
// final, so a failed refresh flag, or an unfinished agenda, does not take a sitting out.
export function missingMemberVoteRecord(store,version,groupGeneration,skip=[],topicGeneration=null) {
  if(!store?.db)return null;
  const skipped=new Set(skip);
  try {
    const rows=store.db.prepare(`SELECT s.id,s.checked_at,r.snapshot_checked_at,r.snapshot_version,r.projection_version,r.group_generation,r.status,t.topics_generation
      FROM sitting_snapshots s LEFT JOIN member_vote_record_sittings r ON r.sitting_id=s.id
      LEFT JOIN member_vote_record_tags t ON t.sitting_id=s.id
      WHERE s.kind='votes' AND s.version=? AND s.body IS NOT NULL ORDER BY s.id DESC`).all(version);
    return rows.find(row=>!skipped.has(row.id)&&(row.projection_version!==MEMBER_VOTE_RECORD_PROJECTION_VERSION||row.snapshot_version!==version||row.snapshot_checked_at!==row.checked_at||
      row.group_generation!==(typeof groupGeneration==='function'?groupGeneration(row.id.slice(7,17)):groupGeneration??null)||
      row.status==='projected'&&row.topics_generation!==(topicGeneration??null)))?.id||null;
  }catch{return null;}
}

// Frozen history is cached by generation, but staleness is keyed by its answers
// on the sitting date. Publication timestamps and clipped open interval ends can
// change daily without changing a single historical group attribution. Only
// attached IDs and group codes enter the projection; unavailable, not-serving
// and non-attached answers have identical effects and stay out of the key.
const histories=new WeakMap();
export function memberVoteRecordHistory(store) {
  const generation=store.get?.('active')??null;
  const prior=histories.get(store);
  if(prior?.generation===generation)return prior;
  const snapshot=generation?groupHistorySnapshot(store,generation):null;
  const groupOn=snapshot?createGroupOn(snapshot):null,keys=new Map();
  const state={generation,groupOn,key:date=>{
    if(!snapshot)return null;
    if(!keys.has(date))keys.set(date,createHash('sha256').update(JSON.stringify(Object.keys(snapshot.members||{}).sort().flatMap(id=>{const group=groupOn(id,date);return typeof group==='object'&&group.code&&group.code!=='NI'?[[id,group.code]]:[];}))).digest('hex'));
    return keys.get(date);
  }};
  // A late history repair for this same generation must be observed.
  if(snapshot)histories.set(store,state);
  return state;
}
export function retainMemberVoteRecord(store,day,version=0) {
  const history=memberVoteRecordHistory(store);
  const checked=store.db.prepare("SELECT checked_at FROM sitting_snapshots WHERE kind='votes' AND version=? AND id=?").get(version,day.sittingId)?.checked_at??null;
  return writeMemberVoteRecord(store,day,{groupOn:history.groupOn,groupGeneration:history.key(day.date),snapshotVersion:version,snapshotCheckedAt:checked});
}

// A sitting whose projection is current except for its topics is only re-tagged:
// the vectors do not depend on topics, and the result documents are kept on the row.
export function retagMemberVoteRecord(store,sittingId,topicGeneration=topicsGeneration(store)) {
  store.assertWriter();
  const row=store.db.prepare("SELECT decisions FROM member_vote_record_sittings WHERE sitting_id=? AND status='projected'").get(sittingId);
  if(!row)return false;
  store.db.prepare('INSERT INTO member_vote_record_tags(sitting_id,topics_generation,tags) VALUES(?,?,?) ON CONFLICT(sitting_id) DO UPDATE SET topics_generation=excluded.topics_generation,tags=excluded.tags').run(sittingId,topicGeneration,sittingTags(store.db,topicGeneration,JSON.parse(row.decisions)));
  return true;
}
// Whether the stored projection of a sitting is current apart from its topics.
export function memberVoteRecordNeedsOnlyTags(store,sittingId,version,groupGeneration) {
  const row=store.db.prepare('SELECT snapshot_version,projection_version,group_generation,snapshot_checked_at,status FROM member_vote_record_sittings WHERE sitting_id=?').get(sittingId);
  const checked=store.db.prepare("SELECT checked_at FROM sitting_snapshots WHERE kind='votes' AND version=? AND id=?").get(version,sittingId)?.checked_at??null;
  return Boolean(row&&row.projection_version===MEMBER_VOTE_RECORD_PROJECTION_VERSION&&row.snapshot_checked_at===checked&&row.status==='projected'&&row.snapshot_version===version&&row.group_generation===(groupGeneration??null));
}
