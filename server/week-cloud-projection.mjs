import {zstdDecompressSync} from 'node:zlib';
export const WEEK_CLOUD_VERSION=1;

const weekSql=ref=>`date(${ref}.date,'-' || ((CAST(strftime('%w',${ref}.date) AS INTEGER)+6)%7) || ' days')`;
export function prepareWeekClouds(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS week_cloud_revisions(week TEXT PRIMARY KEY,revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS week_clouds(week TEXT,language TEXT,revision INTEGER,version INTEGER,dates TEXT,generation INTEGER,demographics INTEGER,body BLOB,PRIMARY KEY(week,language));`);
  // No corpus scan at startup. The worker seeds existing weeks incrementally.
  for(const [event,ref] of [['INSERT','NEW'],['DELETE','OLD'],['UPDATE','OLD'],['UPDATE','NEW']])db.exec(`CREATE TRIGGER IF NOT EXISTS week_cloud_${event}_${ref} AFTER ${event} ON speech_catalog WHEN ${ref}.date IS NOT NULL BEGIN
    INSERT INTO week_cloud_revisions VALUES (${weekSql(ref)},1) ON CONFLICT(week) DO UPDATE SET revision=revision+1; END;`);
}
export function readWeekCloud(store,{week,language,dates,generation,demographicRevision}) {
  if(!store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='week_clouds'").get())return null;
  if(store.db.prepare('SELECT 1 FROM speech_catalog_dirty LIMIT 1').get())return null;
  const row=store.db.prepare(`SELECT p.body,p.dates FROM week_clouds p JOIN week_cloud_revisions r USING(week)
    WHERE p.week=? AND p.language=? AND p.revision=r.revision AND p.version=? AND p.generation IS ? AND p.demographics=?`).get(week,language,WEEK_CLOUD_VERSION,generation,demographicRevision);
  if(!row||row.dates!==JSON.stringify(dates)||!row.body)return null;
  const result=JSON.parse(zstdDecompressSync(row.body));
  // Coverage may change without a text revision (failed checks, recovery or a
  // newer language frontier). Refresh it in this same read snapshot.
  const current=store.speechPageSnapshot({dates,from:dates[0],to:dates.at(-1),language,limit:1});
  if(!current||current.missingRetainedLanguage)return null;
  return {...result,availability:current.coverage.availability.text};
}
