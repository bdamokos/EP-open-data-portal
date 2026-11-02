import {zstdCompressSync} from 'node:zlib';
import {SpeechCloudInsights,speechCloudQuery} from './speech-cloud.mjs';
import {WEEK_CLOUD_VERSION,weekCloudMemberDigest,weekCloudInputs} from './week-cloud-projection.mjs';
import {speechWordLanguages} from './insights-speech-words.mjs';
const monday=date=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
function indexIdentity(store) {
  const read=key=>JSON.parse(store.db.prepare('SELECT value FROM idx.meta WHERE key=?').get(key)?.value||'null');
  return {generation:store.indexState().generation,demographics:read('demographicRevision')||0,members:weekCloudMemberDigest(store.db,'idx.')};
}
// Called only while the existing corpus writer owns its lease. One language of
// one week per batch; no transaction encloses asynchronous analysis/read snapshots.
export async function fillWeekCloud(store,checkpoint) {
  if(!store.attachIndex()||store.db.prepare('SELECT 1 FROM speech_catalog_dirty LIMIT 1').get())return false;
  store.assertWriter();
  const today=new Date(store.clock()).toLocaleDateString('en-CA',{timeZone:'Europe/Brussels'});
  const seed=store.get('weekCloudSeed')||'9999-12-31';
  const rows=store.db.prepare("SELECT DISTINCT date FROM speech_catalog WHERE kind='PLENARY_DEBATE_SPEECH' AND date<? AND date<=? ORDER BY date DESC LIMIT 100").all(seed,today);
  if(rows.length)store.transaction(()=>{store.assertWriter();for(const {date} of rows)store.db.prepare('INSERT OR IGNORE INTO week_cloud_revisions VALUES (?,1)').run(monday(date));store.set('weekCloudSeed',rows.at(-1).date);});
  const identity=indexIdentity(store);
  const inputs=weekCloudInputs(store,identity.members),pending=pendingWeek(store,today,identity);
  if(!pending){markReadyIfFinished(store,today,identity);return rows.length>0;}
  const dates=store.db.prepare("SELECT DISTINCT date FROM speech_catalog WHERE kind='PLENARY_DEBATE_SPEECH' AND date BETWEEN ? AND date(?,'+6 days') AND date<=? ORDER BY date").all(pending.week,pending.week,today).map(row=>row.date);
  if(dates.length>5)return false;
  const languages=store.db.prepare("SELECT DISTINCT l.value language FROM speech_catalog c,json_each(c.available_languages) l WHERE c.kind='PLENARY_DEBATE_SPEECH' AND c.date BETWEEN ? AND date(?,'+6 days') AND c.date<=?").all(pending.week,pending.week,today).map(r=>r.language).filter(l=>speechWordLanguages.includes(l));
  const language=languages.find(l=>!store.db.prepare('SELECT 1 FROM week_clouds WHERE week=? AND language=? AND revision=? AND version=? AND generation IS ? AND demographics=? AND dates=? AND inputs=?').get(pending.week,l,pending.revision,WEEK_CLOUD_VERSION,identity.generation,identity.demographics,JSON.stringify(dates),inputs));
  const facade={db:{prepare:sql=>store.db.prepare(sql.replace('FROM members','FROM idx.members'))},status:()=>({servingGeneration:identity.generation}),get:()=>identity.demographics};
  const cloud=new SpeechCloudInsights(facade,{clock:store.clock,readWeekCloud:null,request:async()=>{throw new Error('Projection must use retained data only.');},readCorpusPage:async params=>{await checkpoint();return store.speechPage(params);},textResolver:id=>store.db.prepare(`SELECT t.body FROM documents d JOIN texts t ON t.document_id=d.id WHERE d.source_id=? AND d.kind='speech' AND t.source_format='xml-fragment' AND t.language=? AND t.chars<=2097152 ORDER BY (t.translation_type='original') DESC,(t.source_key=?) DESC,t.source_key LIMIT 1`).get(id,language,language)?.body||'',deferAnalysis:true,walkMs:{first:0,next:0}});
  cloud.scope=async()=>({kind:'week',dates:dates.map(start=>({start,end:start})),ids:null,phase:'past',title:null,titleLanguage:null});
  const query=speechCloudQuery(new URLSearchParams({week:pending.week,lang:language}),{now:store.clock()});
  const first=store.speechPage({dates,from:dates[0],to:dates.at(-1),language,limit:50});
  if(!first||first.missingRetainedLanguage) {
    store.transaction(()=>{store.assertWriter();store.db.prepare('INSERT OR REPLACE INTO week_clouds VALUES (?,?,?,?,?,?,?,NULL,?)').run(pending.week,language,pending.revision,WEEK_CLOUD_VERSION,JSON.stringify(dates),identity.generation,identity.demographics,inputs);});
    markReadyIfFinished(store,today,identity);
    return true;
  }
  let result=await cloud.query(query);
  while(result.nextPage!==null){await checkpoint();result=await cloud.query({...query,page:result.nextPage});}
  await checkpoint();
  // Recheck ownership/content before publishing the ready row atomically.
  store.transaction(()=>{store.assertWriter();if(store.db.prepare('SELECT revision FROM week_cloud_revisions WHERE week=?').get(pending.week)?.revision!==pending.revision)return;
    const currentIdentity=indexIdentity(store);
    if(inputs!==weekCloudInputs(store,currentIdentity.members)||JSON.stringify(identity)!==JSON.stringify(currentIdentity))return;
    store.db.prepare('INSERT OR REPLACE INTO week_clouds VALUES (?,?,?,?,?,?,?,?,?)').run(pending.week,language,pending.revision,WEEK_CLOUD_VERSION,JSON.stringify(dates),identity.generation,identity.demographics,zstdCompressSync(Buffer.from(JSON.stringify(result))),inputs);});
  markReadyIfFinished(store,today,identity);
  return true;
}

function markReadyIfFinished(store,today,identity) {
  if(!weekCloudWorkDue(store)){store.assertWriter();store.set('weekCloudReady',readyStamp(store,today,identity));}
}

function pendingWeek(store,today,identity) {
  return store.db.prepare(`SELECT r.week,r.revision FROM week_cloud_revisions r WHERE EXISTS (
    SELECT 1 FROM speech_catalog c, json_each(c.available_languages) l WHERE c.kind='PLENARY_DEBATE_SPEECH' AND c.date BETWEEN r.week AND date(r.week,'+6 days') AND c.date<=?
    AND l.value IN (${speechWordLanguages.map(()=>'?').join(',')}) AND NOT EXISTS (SELECT 1 FROM week_clouds p WHERE p.week=r.week AND p.language=l.value AND p.revision=r.revision AND p.version=? AND p.generation IS ? AND p.demographics=? AND p.inputs=? AND p.dates=(SELECT json_group_array(date) FROM (
      SELECT DISTINCT date FROM speech_catalog WHERE kind='PLENARY_DEBATE_SPEECH' AND date BETWEEN r.week AND date(r.week,'+6 days') AND date<=? ORDER BY date)))) ORDER BY r.week DESC LIMIT 1`).get(today,...speechWordLanguages,WEEK_CLOUD_VERSION,identity.generation,identity.demographics,weekCloudInputs(store,identity.members),today);
}
export function weekCloudWorkDue(store) {
  if(!store.attachIndex()||!store.db.prepare("SELECT 1 FROM speech_catalog WHERE kind='PLENARY_DEBATE_SPEECH' LIMIT 1").get())return false;
  const today=new Date(store.clock()).toLocaleDateString('en-CA',{timeZone:'Europe/Brussels'});
  if(store.get('weekCloudReady')===readyStamp(store,today,indexIdentity(store)))return false;
  if(store.db.prepare("SELECT 1 FROM speech_catalog WHERE kind='PLENARY_DEBATE_SPEECH' AND date<? AND date<=? LIMIT 1").get(store.get('weekCloudSeed')||'9999-12-31',today))return true;
  return Boolean(pendingWeek(store,today,indexIdentity(store)));
}

const readyStamp=(store,today,identity)=>JSON.stringify([WEEK_CLOUD_VERSION,today,weekCloudInputs(store,identity.members),identity]);
