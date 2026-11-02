import {SPEECH_CLOUD_VERSION} from './speech-cloud-version.mjs';
import {createHash} from 'node:crypto';
import {zstdDecompressSync} from 'node:zlib';
export const WEEK_CLOUD_VERSION=3;

const weekSql=ref=>`date(${ref}.date,'-' || ((CAST(strftime('%w',${ref}.date) AS INTEGER)+6)%7) || ' days')`;
export function prepareWeekClouds(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS week_cloud_revisions(week TEXT PRIMARY KEY,revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS week_clouds(week TEXT,language TEXT,revision INTEGER,version INTEGER,dates TEXT,generation INTEGER,demographics INTEGER,body BLOB,PRIMARY KEY(week,language));`);
  if(!db.prepare('PRAGMA table_info(week_clouds)').all().some(row=>row.name==='inputs'))db.exec('ALTER TABLE week_clouds ADD COLUMN inputs TEXT');
  // Role reuse traverses other weeks, including rows which supplied no reused
  // label before a correction. Fence the whole speech evidence graph, not just
  // the successful dependencies serialized in a previous result.
  // Never allocate a meta rowid inside a meta REPLACE's DELETE trigger.
  // The outer statement may already have reserved that same rowid.
  db.exec(`CREATE TABLE IF NOT EXISTS week_cloud_inputs(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO week_cloud_inputs VALUES (1,0);`);
  const touch="UPDATE week_cloud_inputs SET revision=revision+1 WHERE id=1;";
  for(const table of ['speech_catalog','speech_metadata','speech_catalog_dirty','documents','texts','meta']) {
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    for(const event of ['INSERT','UPDATE','DELETE']) {
      const refs=event==='UPDATE'?['OLD','NEW']:[event==='DELETE'?'OLD':'NEW'];
      const condition=table==='documents'?refs.map(ref=>`${ref}.kind='speech'`).join(' OR '):table==='texts'?refs.map(ref=>`EXISTS (SELECT 1 FROM documents WHERE id=${ref}.document_id AND kind='speech')`).join(' OR '):table==='meta'?refs.map(ref=>`${ref}.key IN ('speechReadRevision','resourceIndexes','speechLanguages')`).join(' OR '):'1';
      // Replace deployed v2 trigger bodies as well as preparing fresh databases.
      db.exec(`DROP TRIGGER IF EXISTS week_cloud_inputs_${table}_${event}`);
      db.exec(`CREATE TRIGGER week_cloud_inputs_${table}_${event} AFTER ${event} ON ${table} WHEN ${condition} BEGIN ${touch} END;`);
    }
  }
  // No corpus scan at startup. The worker seeds existing weeks incrementally.
  for(const [event,ref] of [['INSERT','NEW'],['DELETE','OLD'],['UPDATE','OLD'],['UPDATE','NEW']])db.exec(`CREATE TRIGGER IF NOT EXISTS week_cloud_${event}_${ref} AFTER ${event} ON speech_catalog WHEN ${ref}.date IS NOT NULL BEGIN
    INSERT INTO week_cloud_revisions VALUES (${weekSql(ref)},1) ON CONFLICT(week) DO UPDATE SET revision=revision+1; END;`);
}
// Roster replacement does not necessarily advance generation/demographics.
// Hash the bounded directory, including group/name fields, by exact member ID.
export function weekCloudMemberDigest(db,prefix='') {
  const digest=createHash('sha256');
  for(const row of db.prepare(`SELECT id,body FROM ${prefix}members ORDER BY id`).iterate())digest.update(JSON.stringify(row));
  return digest.digest('hex');
}
export const weekCloudInputs=(store,members)=>JSON.stringify([WEEK_CLOUD_VERSION,SPEECH_CLOUD_VERSION,store.db.prepare('SELECT revision FROM week_cloud_inputs WHERE id=1').get().revision,store.get('speechReadRevision')||0,store.get('resourceIndexes'),store.get('speechLanguages'),members]);
export function readWeekCloud(store,{week,language,dates,generation,demographicRevision,members}) {
  if(store.get('weekCloudSchema')!==3||typeof members!=='string')return null;
  if(store.db.prepare('SELECT 1 FROM speech_catalog_dirty LIMIT 1').get())return null;
  const row=store.db.prepare(`SELECT p.body,p.dates FROM week_clouds p JOIN week_cloud_revisions r USING(week)
    WHERE p.week=? AND p.language=? AND p.revision=r.revision AND p.version=? AND p.generation IS ? AND p.demographics=? AND p.inputs=?`).get(week,language,WEEK_CLOUD_VERSION,generation,demographicRevision,weekCloudInputs(store,members));
  if(!row||row.dates!==JSON.stringify(dates)||!row.body)return null;
  const result=JSON.parse(zstdDecompressSync(row.body));
  // Coverage may change without a text revision (failed checks, recovery or a
  // newer language frontier). Refresh it in this same read snapshot.
  const current=store.speechPageSnapshot({dates,from:dates[0],to:dates.at(-1),language,limit:1});
  if(!current||current.missingRetainedLanguage)return null;
  return {...result,availability:current.coverage.availability.text};
}
