import * as weekCloudProjection from './week-cloud-projection.mjs';
import {zstdDecompressSync} from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import {weekCloudFixture} from './test-support/week-cloud-fixture.mjs';
import {fillWeekCloud,weekCloudWorkDue} from './week-cloud-worker.mjs';
import {SpeechCloudInsights,speechCloudQuery} from './speech-cloud.mjs';
import {CorpusReader} from './corpus-reader.mjs';
const query=()=>speechCloudQuery(new URLSearchParams('week=2026-10-19&lang=en'));
const params=f=>({week:'2026-10-19',language:'en',dates:f.dates,generation:f.store.indexState().generation,demographicRevision:0,members:weekCloudProjection.weekCloudMemberDigest?.(f.index.db)});
test('worker publishes an exact text-free week, single-response read and invalidation preserve fallback',async t=>{
  const f=weekCloudFixture(201);t.after(()=>f.close());
  let checkpoints=0;const checkpoint=async()=>{checkpoints++;f.store.assertWriter();};
  const cloud=new SpeechCloudInsights(f.index,{clock:f.clock,readWeekCloud:null,request:async()=>{throw Error('no upstream');},readCorpusPage:async p=>f.store.speechPage(p),walkMs:{first:0,next:0}});
  cloud.scope=async()=>({kind:'week',dates:f.dates.map(start=>({start,end:start})),ids:null,phase:'past',title:null,titleLanguage:null});
  let before=await cloud.query(query());while(before.nextPage!==null)before=await cloud.query({...query(),page:before.nextPage});
  assert.equal(await fillWeekCloud(f.store,checkpoint),true);assert(checkpoints>4);
  assert(f.store.get('weekCloudReady'),'the final language publishes the idle ready marker without another writer wake');
  assert.equal(weekCloudWorkDue(f.store),false);
  f.store.db.exec('PRAGMA query_only=ON');
  const after=f.store.weekCloud(params(f));assert(after);
  f.store.db.exec('PRAGMA query_only=OFF');assert.equal(after.nextPage,null);
  for(const key of ['words','speeches','coverage','sources','availability'])assert.deepEqual(after[key],before[key],key);
  const reader=new CorpusReader(f.directory+'/corpus',{timeoutMs:10000});
  assert.deepEqual((await reader.query('speech-cloud',params(f))).words,before.words);
  const projected=new SpeechCloudInsights(f.index,{clock:f.clock,readWeekCloud:async p=>f.store.weekCloud(p),readCorpusPage:async()=>{throw Error('must not walk');}});
  projected.scope=cloud.scope;
  assert.deepEqual((await projected.query(query())).words,before.words);
  const persisted=zstdDecompressSync(f.store.db.prepare('SELECT body FROM week_clouds').get().body).toString();assert(!persisted.includes('provides energy security for citizens'));
  f.add(202,'hu');assert.equal(f.store.weekCloud(params(f)),null,'new speech invalidates ready row');
  await fillWeekCloud(f.store,checkpoint);await fillWeekCloud(f.store,checkpoint);
  assert.equal(f.store.weekCloud(params(f)).coverage.missingLanguage,1);
  assert(f.store.weekCloud({...params(f),language:'hu'}));
  assert.equal(f.store.weekCloud({...params(f),dates:f.dates.slice(0,3)}),null);
  assert.equal(f.store.weekCloud({...params(f),generation:999}),null);
});
test('lease loss prevents publication and leaves legacy path available',async t=>{
  const f=weekCloudFixture(10);t.after(()=>f.close());
  await assert.rejects(fillWeekCloud(f.store,async()=>{f.store.release();f.store.assertWriter();}),/lease/i);
  assert.equal(f.store.weekCloud(params(f)),null);
});

function roleSpeech(f,day,number,labels) {
  const id=`MTG-PL-${day}-OTH-${number}`,activity={activity_id:id,id:'eli/dl/event/'+id,activity_date:day,activity_start_date:day+'T10:00:00Z',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',activity_label:{en:'Public debate'},had_participation:[{had_participant_person:['person/42']}],recorded_in_a_realization_of:[{identifier:`CRE-10-${day}-OTH-${number}`,numbering:number,'api:xmlFragment':Object.fromEntries(Object.entries({en:null,...labels}).map(([lang,role])=>[lang,`<oralStatements><speech xml:lang="${lang}"><from xml:lang="${lang}"><person refersTo="person/42">Fixture Speaker</person>${role?`<role>${role}</role>`:''}</from><p>Public climate text.</p></speech></oralStatements>`]))}]};
  return activity;
}
async function retainRole(f,activity) {
  const {speechTexts}=await import('./corpus-worker.mjs');
  const url='https://data.europarl.europa.eu/api/v2/speeches',at=new Date(f.store.clock()).toISOString(),text=speechTexts(activity,url,at);
  f.store.putDocument(text.document,text.texts);f.store.putSpeechMetadata(activity,url,at);
}
test('earlier role corrections invalidate dependent weeks before rebuilding',async t=>{
  const f=weekCloudFixture(0);t.after(()=>f.close());
  const bg='член на Комисията',old=roleSpeech(f,'2026-10-07',1,{bg,en:'Member of the Commission'}),current=roleSpeech(f,'2026-10-19',2,{bg});
  await retainRole(f,old);await retainRole(f,current);
  const p={...params(f),dates:['2026-10-19']},checkpoint=async()=>f.store.assertWriter();
  await fillWeekCloud(f.store,checkpoint);
  assert.equal(f.store.weekCloud(p).speeches[0].people[0].roleLabels.en.text,'Member of the Commission');
  await retainRole(f,roleSpeech(f,'2026-10-07',1,{bg:'председател на Комисията',en:'President of the Commission'}));
  assert.equal(f.store.speechData({sourceIds:[current.activity_id],language:'en'}).records[0].metadata.speakers[0].roleLabels.en,undefined);
  assert.equal(f.store.weekCloud(p),null,'dependent week must reject obsolete role evidence');
  assert.equal(weekCloudWorkDue(f.store),true);
  await fillWeekCloud(f.store,checkpoint);
  assert.equal(f.store.weekCloud(p).speeches[0].people[0].roleLabels.en,undefined);
});
test('a retained date becoming held schedules and rebuilds the same week without a corpus write',async t=>{
  const f=weekCloudFixture(8);t.after(()=>f.close());
  let now=Date.parse('2026-10-19T12:00:00Z');f.store.clock=()=>now;
  const checkpoint=async()=>f.store.assertWriter();
  await fillWeekCloud(f.store,checkpoint);
  assert.equal(f.store.weekCloud({...params(f),dates:['2026-10-19']}).coverage.transcripts,2);
  const revision=f.store.get('speechReadRevision');now=Date.parse('2026-10-20T12:00:00Z');
  assert.equal(f.store.get('speechReadRevision'),revision);
  assert.equal(f.store.weekCloud({...params(f),dates:['2026-10-19','2026-10-20']}),null);
  assert.equal(weekCloudWorkDue(f.store),true,'held-date rollover must make the saved row pending');
  assert.equal(await fillWeekCloud(f.store,checkpoint),true);
  assert.equal(f.store.weekCloud({...params(f),dates:['2026-10-19','2026-10-20']}).coverage.transcripts,4);
});

const mutations=[
  ['text body correction',f=>f.store.db.prepare("UPDATE texts SET body='Ocean ocean.',chars=12 WHERE id=(SELECT MIN(id) FROM texts)").run()],
  ['text variant language and translation type',f=>f.store.db.prepare("UPDATE texts SET language='hu',translation_type='machine' WHERE id=(SELECT MIN(id) FROM texts)").run()],
  ['retained transcript deletion',f=>f.store.db.prepare('DELETE FROM texts WHERE id=(SELECT MIN(id) FROM texts)').run()],
  ['retained document deletion',f=>f.store.db.prepare('DELETE FROM documents WHERE id=(SELECT MIN(id) FROM documents)').run()],
  ['metadata deletion',f=>f.store.db.prepare('DELETE FROM speech_metadata WHERE source_id=(SELECT MIN(source_id) FROM speech_metadata)').run()],
  ['sitting reassignment',f=>f.store.db.prepare("UPDATE speech_catalog SET date='2026-10-26' WHERE source_id=(SELECT MIN(source_id) FROM speech_catalog)").run()],
  ['speech kind correction',f=>f.store.db.prepare("UPDATE speech_catalog SET kind='PLENARY_DEBATE_WRITTEN_STATEMENT' WHERE source_id=(SELECT MIN(source_id) FROM speech_catalog)").run()],
  ['participant correction',f=>f.store.db.prepare("UPDATE speech_catalog SET participants='[\"43\"]' WHERE source_id=(SELECT MIN(source_id) FROM speech_catalog)").run()],
  ['unclassified historical row',f=>f.store.db.prepare("INSERT INTO speech_catalog(source_id,date) VALUES ('MTG-PL-2026-10-07-OTH-99','2026-10-07')").run()],
  ['pending metadata repair',f=>f.store.db.prepare("INSERT INTO speech_catalog_dirty VALUES ('MTG-PL-2026-10-07-OTH-99')").run()],
  ['language retention policy',f=>f.store.set('speechLanguages','primary')],
  ['role evidence revision',f=>f.store.set('speechReadRevision',f.store.get('speechReadRevision')+1)],
  ['catalogue readiness',f=>f.store.set('resourceIndexes',0)],
  ['roster names and groups without a generation change',f=>f.index.setMembers([{id:'42',name:'Corrected Speaker',group:'RENEW'}])],
];
for(const [name,mutate] of mutations)test('projection invalidation covers '+name,async t=>{
  const f=weekCloudFixture(8);t.after(()=>f.close());
  await fillWeekCloud(f.store,async()=>f.store.assertWriter());assert(f.store.weekCloud(params(f)));
  mutate(f);assert.equal(f.store.weekCloud(params(f)),null);
});
function localCloud(f,readWeekCloud=null) {
  const service=new SpeechCloudInsights(f.index,{clock:f.store.clock,readWeekCloud,readCorpusPage:async p=>f.store.speechPage(p),walkMs:{first:0,next:0},request:async()=>{throw Error('unexpected upstream');}});
  service.scope=async()=>({kind:'week',dates:f.dates.map(start=>({start,end:start})),ids:null,phase:'past',title:null,titleLanguage:null});return service;
}
test('stale projection falls back to fresh legacy counts, including a previously cached fallback',async t=>{
  const f=weekCloudFixture(8);t.after(()=>f.close());const checkpoint=async()=>f.store.assertWriter();
  await fillWeekCloud(f.store,checkpoint);
  const service=localCloud(f,async p=>f.store.weekCloud(p));assert.equal((await service.query(query())).coverage.transcripts,8);
  const correct=body=>f.store.db.prepare('UPDATE texts SET body=?,chars=? WHERE id=(SELECT MIN(id) FROM texts)').run(body,body.length);
  correct('Ocean ocean.');const first=await service.query(query());
  assert.equal(first.words.find(w=>w.word==='ocean').occurrences,2);
  correct('Biodiversity biodiversity biodiversity.');const second=await service.query(query());
  assert(!second.words.some(w=>w.word==='ocean'));assert.equal(second.words.find(w=>w.word==='biodiversity').occurrences,3);
  await fillWeekCloud(f.store,checkpoint);const after=f.store.weekCloud(params(f));
  assert.deepEqual(after.words,second.words);assert.equal(after.coverage.transcripts,8);
});
test('on-behalf-of group corrections in earlier evidence invalidate reused roles',async t=>{
  const f=weekCloudFixture(0);t.after(()=>f.close());
  const old=roleSpeech(f,'2026-10-07',1,{bg:'Член на Комисията',en:'Member of the Commission'}),current=roleSpeech(f,'2026-10-19',2,{bg:'Член на Комисията'});
  await retainRole(f,old);await retainRole(f,current);await fillWeekCloud(f.store,async()=>f.store.assertWriter());
  const p={...params(f),dates:['2026-10-19']};assert(f.store.weekCloud(p).speeches[0].people[0].roleLabels.en);
  old.had_participation[0].participation_in_name_of=['org/RENEW'];await retainRole(f,old);
  assert.equal(f.store.weekCloud(p),null);await fillWeekCloud(f.store,async()=>f.store.assertWriter());
  assert.equal(f.store.weekCloud(p).speeches[0].people[0].roleLabels.en,undefined);
});
test('directory changes during a fill prevent publication of mixed evidence',async t=>{
  const f=weekCloudFixture(8);t.after(()=>f.close());let calls=0;
  await fillWeekCloud(f.store,async()=>{f.store.assertWriter();if(++calls===2)f.index.setMembers([{id:'42',name:'Corrected Speaker'}]);});
  assert.equal(f.store.weekCloud(params(f)),null);assert.equal(weekCloudWorkDue(f.store),true);
  await fillWeekCloud(f.store,async()=>f.store.assertWriter());assert.equal(f.store.weekCloud(params(f)).speeches[0].people[0].name,'Corrected Speaker');
});
test('calendar membership changes cannot resurrect cached fallback counts',async t=>{
  const f=weekCloudFixture(8);t.after(()=>f.close());
  const service=localCloud(f,async p=>f.store.weekCloud(p));
  let dates=f.dates;
  service.scope=async()=>({kind:'week',dates:dates.map(start=>({start,end:start})),ids:null,phase:dates.length?'past':'upcoming',title:null,titleLanguage:null});
  assert.equal((await service.query(query())).coverage.transcripts,8);
  dates=['2026-10-19'];assert.equal((await service.query(query())).coverage.transcripts,2);
  dates=[];const upcoming=await service.query(query());assert.equal(upcoming.coverage.transcripts,0);assert.deepEqual(upcoming.words,[]);
});
test('corpus correction during analysis cannot publish a mixed projection',async t=>{
  const f=weekCloudFixture(8);t.after(()=>f.close());let calls=0;
  await fillWeekCloud(f.store,async()=>{f.store.assertWriter();if(++calls===2)f.store.db.prepare("UPDATE texts SET body='Ocean ocean.',chars=12 WHERE id=(SELECT MIN(id) FROM texts)").run();});
  assert.equal(f.store.weekCloud(params(f)),null);assert.equal(weekCloudWorkDue(f.store),true);
  await fillWeekCloud(f.store,async()=>f.store.assertWriter());assert.equal(f.store.weekCloud(params(f)).words.find(w=>w.word==='ocean').occurrences,2);
});
test('old projection schemas fall back until preparation and worker refill',async t=>{
  const {prepareIndexes}=await import('./migrate-indexes.mjs');
  const f=weekCloudFixture(8);t.after(()=>f.close());await fillWeekCloud(f.store,async()=>f.store.assertWriter());
  f.store.db.exec('ALTER TABLE week_clouds DROP COLUMN inputs');f.store.set('weekCloudSchema',1);f.store.release();
  assert.equal(f.store.weekCloud(params(f)),null);
  prepareIndexes({corpusDirectory:f.directory+'/corpus',clock:f.clock,log:()=>{}});
  assert.equal(f.store.get('weekCloudSchema'),3);assert(f.store.acquire());assert.equal(f.store.weekCloud(params(f)),null);
  await fillWeekCloud(f.store,async()=>f.store.assertWriter());assert.equal(f.store.weekCloud(params(f)).coverage.transcripts,8);
});
test('concurrent week fallback requests retain one shared build',async t=>{
  const f=weekCloudFixture(8);t.after(()=>f.close());let reads=0,release,started;
  const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
  const service=localCloud(f,async p=>f.store.weekCloud(p));
  service.readCorpusPage=async p=>{reads++;started();await gate;return f.store.speechPage(p);};
  const first=service.query(query());await entered;
  const second=service.query(query());await new Promise(resolve=>setImmediate(resolve));release();
  const [a,b]=await Promise.all([first,second]);assert.equal(reads,1);assert.deepEqual(a,b);
});

// Existing pre-projection corpora have speechLanguages but no input counter.
// With recursive triggers, REPLACE deletes the old key and its DELETE trigger
// used to allocate the rowid already reserved by the outer INSERT.
test('worker discovery replaces retained languages before any projection input counter exists',async t=>{
  const {CorpusWorker}=await import('./corpus-worker.mjs');
  const f=weekCloudFixture(0);t.after(()=>f.close());
  f.store.set('speechLanguages','all');
  f.store.db.exec("DELETE FROM meta WHERE key='weekCloudInputRevision'");
  const worker=new CorpusWorker(f.store,{clock:f.clock,budget:0,diskLimit:0,fetchRecord:async()=>{throw Error('unexpected network');}});
  await worker.discover();
  assert.equal(f.store.get('speechLanguages'),'all');
  assert.equal(f.store.get('discoveryCheckedAt'),f.clock());
});

test('startup preparation replaces deployed meta-writing triggers without scanning retained data',async t=>{
  const {prepareIndexes}=await import('./migrate-indexes.mjs');
  const {CorpusStore}=await import('./corpus-store.mjs');
  const f=weekCloudFixture(8);t.after(()=>f.close());
  await fillWeekCloud(f.store,async()=>f.store.assertWriter());
  const documents=f.store.db.prepare('SELECT COUNT(*) n FROM documents').get().n;
  const triggers=f.store.db.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'week_cloud_inputs_%'").all();
  assert.equal(triggers.length,18);
  for(const {name,sql} of triggers) {
    f.store.db.exec(`DROP TRIGGER ${name}`);
    f.store.db.exec(sql.replace('UPDATE week_cloud_inputs SET revision=revision+1 WHERE id=1;',"INSERT INTO meta(key,value) VALUES ('weekCloudInputRevision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1;"));
  }
  f.store.set('weekCloudSchema',2);f.store.set('speechLanguages','all');
  f.store.db.exec("DELETE FROM meta WHERE key='weekCloudInputRevision'; DROP TABLE week_cloud_inputs");
  f.store.release();
  assert.equal(f.store.weekCloud(params(f)),null);
  assert.equal(prepareIndexes({corpusDirectory:f.directory+'/corpus',clock:f.clock,log:()=>{}})[0].noop,false);
  assert.equal(prepareIndexes({corpusDirectory:f.directory+'/corpus',clock:f.clock,log:()=>{}})[0].noop,true);
  const reopened=new CorpusStore(f.directory+'/corpus',{clock:f.clock});
  try {
    assert(reopened.acquire());reopened.set('speechLanguages','all');
    assert.equal(reopened.get('weekCloudSchema'),3);
    assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM documents').get().n,documents);
    assert(reopened.db.prepare('SELECT revision FROM week_cloud_inputs').get().revision>0);
    assert(reopened.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'week_cloud_inputs_%'").all().every(row=>!row.sql.includes('INSERT INTO meta')));
    reopened.release();
  }finally {reopened.close();}
  assert(f.store.acquire());
  assert.equal(f.store.weekCloud(params(f)),null,'v2 projections require refill');
  await fillWeekCloud(f.store,async()=>f.store.assertWriter());
  assert.equal(f.store.weekCloud(params(f)).coverage.transcripts,8);
});
