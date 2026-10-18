import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {zstdCompressSync,zstdDecompressSync} from 'node:zlib';
import {CorpusStore} from './corpus-store.mjs';
import {CorpusWorker,speechTexts} from './corpus-worker.mjs';
import {INTERVENTION_CLASSIFICATION_VERSION} from './speech-interventions.mjs';

const fetchedAt='2026-10-17T10:00:00.000Z',sourceUrl='https://data.europarl.europa.eu/api/v2/speeches?include-output=xml_fragment';
const clock=()=>Date.parse(fetchedAt);
const fragment=(process='',name='Exact Speaker',body='Retained words.')=>`<oralStatements><speech xml:lang="en"><from><person refersTo="person/42">${name}</person>${process?`<process>${process}</process>`:''}</from><p>${body}</p></speech></oralStatements>`;
function activity(number,{xml=fragment('Blue card question'),member='42'}={}) {
  const id='MTG-PL-2026-10-07-OTH-'+number;
  return {id:'eli/dl/event/'+id,activity_id:id,activity_date:'2026-10-07',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',
    activity_label:{en:'Exact topic'},had_participation:[{had_participant_person:['person/'+member],participation_in_name_of:['org/S_D']}],
    inverse_consists_of:['eli/dl/event/MTG-PL-2026-10-07-PVCRE-ITM-1'],
    recorded_in_a_realization_of:[{id:'eli/dl/doc/CRE-10-2026-10-07-INT-'+number,numbering:number,originalLanguage:['http://publications.europa.eu/resource/authority/language/ENG'],'api:xmlFragment':{en:xml}}]};
}
function fixture(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'corpus-intervention-refresh-')),store=new CorpusStore(directory,{clock});store.acquire();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const add=a=>{const extracted=speechTexts(a,sourceUrl,fetchedAt);store.putDocument(extracted.document,extracted.texts);store.putSpeechMetadata(a,sourceUrl,fetchedAt);return a.activity_id;};
  const legacy=(id,type='blue-card')=>{
    const row=store.db.prepare('SELECT body FROM speech_metadata WHERE source_id=?').get(id),saved=JSON.parse(zstdDecompressSync(row.body));
    delete saved.interventionClassificationVersion;delete saved.interventionHeaders;saved.summary.intervention.type=type;
    store.db.prepare('UPDATE speech_metadata SET body=? WHERE source_id=?').run(zstdCompressSync(Buffer.from(JSON.stringify(saved))),id);
  };
  const worker=new CorpusWorker(store,{clock,interval:0,fetchRecord:()=>{throw new Error('Classification refresh cannot request sources');}});
  return {store,add,legacy,worker};
}
const refreshTask=store=>store.task('speech-interventions:'+INTERVENTION_CLASSIFICATION_VERSION);

test('local refresh resolves legacy projections without changing sources, text, names or known projections',async t=>{
  const {store,add,legacy,worker}=fixture(t),id=add(activity(1)),known=add(activity(2,{xml:fragment()}));
  legacy(id);legacy(known,'speech');
  // Known contributions must never decompress their transcript during this upgrade.
  store.db.prepare('UPDATE texts SET raw=? WHERE document_id=(SELECT id FROM documents WHERE source_id=?)').run(Buffer.from('unreadable retained raw'),known);
  const before=store.speechMetadata(id),textBefore=store.db.prepare('SELECT * FROM texts ORDER BY id').all(),knownBefore=store.db.prepare('SELECT body FROM speech_metadata WHERE source_id=?').get(known).body;
  const pageBefore=store.speechPage({member:'42',metadataOnly:true}),knownRevision=store.db.prepare('SELECT revision FROM speech_catalog WHERE source_id=?').get(known).revision;
  await worker.discover();assert.equal(store.status().speechMetadata.classificationRefreshPending,true);
  await worker.task(refreshTask(store));
  const after=store.speechMetadata(id);
  assert.equal(after.summary.intervention.type,'blue-card-question');
  for(const key of ['activity','speakers','headerSources','availableTextLanguages','sourceUrl','fetchedAt'])assert.deepEqual(after[key],before[key],key);
  for(const key of ['speaker','parentIds','onBehalfOf','numbering','headerAvailable'])assert.deepEqual(after.summary.intervention[key],before.summary.intervention[key],key);
  assert.deepEqual(store.db.prepare('SELECT * FROM texts ORDER BY id').all(),textBefore);
  assert.deepEqual(store.db.prepare('SELECT body FROM speech_metadata WHERE source_id=?').get(known).body,knownBefore);
  assert.equal(store.db.prepare('SELECT revision FROM speech_catalog WHERE source_id=?').get(known).revision,knownRevision);
  assert.deepEqual(store.speechPage({member:'42',metadataOnly:true,expectedRevision:pageBefore.revision}),{changed:true});
  assert.equal(refreshTask(store).done,1);assert.equal(store.status().speechMetadata.classificationRefreshPending,false);
  const revision=store.get('speechReadRevision');await worker.discover();assert.equal(store.get('speechReadRevision'),revision);
});

test('classification cursor resumes bounded pages through a different writer without fetching sources',async t=>{
  const {store,add,legacy,worker}=fixture(t),ids=[1,2,3].map(number=>add(activity(number)));ids.forEach(id=>legacy(id));
  await worker.discover();store.refreshSpeechInterventions(refreshTask(store),{limit:1});
  assert.equal(refreshTask(store).body.afterId,ids[0]);assert.equal(refreshTask(store).done,0);
  const first=store.db.prepare('SELECT body FROM speech_metadata WHERE source_id=?').get(ids[0]).body;
  store.release();const next=new CorpusStore(path.dirname(store.filename),{clock});
  try {
    next.acquire();next.refreshSpeechInterventions(refreshTask(next),{limit:1});assert.equal(refreshTask(next).body.afterId,ids[1]);
    assert.deepEqual(next.db.prepare('SELECT body FROM speech_metadata WHERE source_id=?').get(ids[0]).body,first);
    next.refreshSpeechInterventions(refreshTask(next),{limit:1});assert.equal(refreshTask(next).done,0);
    next.refreshSpeechInterventions(refreshTask(next),{limit:1});assert.equal(refreshTask(next).done,1);
  } finally {next.release();next.close();}
});

test('refresh failures roll back metadata, revision and cursor and remain visible for retry',async t=>{
  const {store,add,legacy}=fixture(t),id=add(activity(1));legacy(id);
  const before=store.speechMetadata(id),revision=store.get('speechReadRevision'),nextRevision=store.nextSpeechRevision.bind(store);
  const mock=t.mock.method(store,'nextSpeechRevision',()=>{nextRevision();throw new Error('classification revision failed');});
  const worker=new CorpusWorker(store,{clock,budget:1,interval:0,fetchRecord:()=>{throw new Error('Source request forbidden');}});
  await worker.run();
  assert.deepEqual(store.speechMetadata(id),before);assert.equal(store.get('speechReadRevision'),revision);
  assert.equal(refreshTask(store).body.afterId,'');assert.equal(refreshTask(store).done,0);
  assert.match(refreshTask(store).error,/classification revision failed/);assert.equal(store.status().speechMetadata.classificationRefreshPending,true);
  mock.mock.restore();store.acquire();await worker.task(refreshTask(store));assert.equal(refreshTask(store).done,1);
});

test('corrupt unresolved XML cannot advance a classification cursor or publish a new version',async t=>{
  const {store,add,legacy,worker}=fixture(t),id=add(activity(1));legacy(id);
  store.db.prepare('UPDATE texts SET sha256=?').run('incorrect');const before=store.speechMetadata(id);
  await worker.discover();assert.throws(()=>store.refreshSpeechInterventions(refreshTask(store)),/failed projection validation/);
  assert.deepEqual(store.speechMetadata(id),before);assert.equal(refreshTask(store).body.afterId,'');assert.equal(refreshTask(store).done,0);
  assert.notEqual(store.get('speechInterventionClassificationVersion'),INTERVENTION_CLASSIFICATION_VERSION);
});

test('classification refresh yields at its elapsed-work bound even with a fixed corpus clock',async t=>{
  const {store,add,legacy,worker}=fixture(t),ids=[1,2,3].map(number=>add(activity(number)));ids.forEach(id=>legacy(id));
  await worker.discover();let ticks=0;t.mock.method(performance,'now',()=>ticks++*1000);
  store.refreshSpeechInterventions(refreshTask(store));
  assert.equal(refreshTask(store).body.afterId,ids[0]);assert.equal(refreshTask(store).done,0);
  assert.equal(store.speechMetadata(ids[1]).summary.intervention.type,'blue-card');
});

test('losing the writer lease while preparing a refresh cannot update metadata or its cursor',async t=>{
  const {store,add,legacy,worker}=fixture(t),id=add(activity(1));legacy(id);await worker.discover();
  const before=store.speechMetadata(id),read=store.retainedSpeechFragments.bind(store);
  t.mock.method(store,'retainedSpeechFragments',sourceId=>{const value=read(sourceId);store.release();return value;});
  assert.throws(()=>store.refreshSpeechInterventions(refreshTask(store)),/lease was lost/);
  assert.deepEqual(store.speechMetadata(id),before);assert.equal(refreshTask(store).body.afterId,'');assert.equal(refreshTask(store).done,0);
});

test('a record without any transcript or independent evidence stays explicitly unresolved',async t=>{
  const {store,legacy,worker}=fixture(t),source=activity(7);source.recorded_in_a_realization_of=[];
  store.putSpeechMetadata(source,sourceUrl,fetchedAt);legacy(source.activity_id,'unclassified');
  const before=store.speechMetadata(source.activity_id);await worker.discover();await worker.task(refreshTask(store));
  const after=store.speechMetadata(source.activity_id);
  assert.deepEqual(after.summary.intervention,before.summary.intervention);assert.equal(after.summary.intervention.type,'unclassified');
  assert.equal(after.summary.intervention.headerAvailable,false);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM texts').get().n,0);
  assert.deepEqual(after.headerSources,[]);assert.equal(refreshTask(store).done,1);
});

test('metadata-only refresh preserves no-text chair headers and updates current exact relationships',t=>{
  const {store}=fixture(t),source=activity(8,{xml:fragment('','President','')});
  store.putSpeechMetadata(source,sourceUrl,fetchedAt);
  const before=store.speechMetadata(source.activity_id);assert.equal(before.summary.intervention.type,'chair');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM texts').get().n,0);
  assert.match(before.interventionHeaders.en,/<from>/);assert.doesNotMatch(before.interventionHeaders.en,/<p[ >]/);
  const metadataOnly=structuredClone(source);delete metadataOnly.recorded_in_a_realization_of[0]['api:xmlFragment'];
  metadataOnly.inverse_consists_of=['eli/dl/event/MTG-PL-2026-10-07-PVCRE-ITM-2'];
  store.putSpeechMetadata(metadataOnly,'https://data.europarl.europa.eu/api/v2/speeches/'+source.activity_id,'2026-10-18T10:00:00.000Z');
  const after=store.speechMetadata(source.activity_id);assert.equal(after.summary.intervention.type,'chair');assert.equal(after.summary.intervention.headerAvailable,true);
  assert.deepEqual(after.summary.intervention.parentIds,['MTG-PL-2026-10-07-PVCRE-ITM-2']);assert.deepEqual(after.headerSources,before.headerSources);
  assert.deepEqual(after.speakers,before.speakers);assert.equal(after.activity.recorded_in_a_realization_of[0]['api:xmlFragment'],undefined);
  metadataOnly.had_participation[0].had_participant_person=['person/43'];
  store.putSpeechMetadata(metadataOnly,sourceUrl,'2026-10-18T11:00:00.000Z');
  assert.equal(store.speechMetadata(source.activity_id).summary.intervention.headerAvailable,false);
});

test('legacy no-text header fallback is ID-checked and keeps newly supplied membership',t=>{
  const {store}=fixture(t),source=activity(9,{xml:fragment('','President','')});store.putSpeechMetadata(source,sourceUrl,fetchedAt);
  const row=store.db.prepare('SELECT body FROM speech_metadata').get(),saved=JSON.parse(zstdDecompressSync(row.body));delete saved.interventionHeaders;
  store.db.prepare('UPDATE speech_metadata SET body=?').run(zstdCompressSync(Buffer.from(JSON.stringify(saved))));
  const metadataOnly=structuredClone(source);delete metadataOnly.recorded_in_a_realization_of[0]['api:xmlFragment'];
  metadataOnly.inverse_consists_of=['eli/dl/event/MTG-PL-2026-10-07-PVCRE-ITM-3'];
  store.putSpeechMetadata(metadataOnly,sourceUrl,'2026-10-18T10:00:00.000Z');
  const after=store.speechMetadata(source.activity_id);assert.equal(after.summary.intervention.type,'chair');assert.equal(after.summary.intervention.headerAvailable,true);
  assert.deepEqual(after.summary.intervention.speaker,saved.summary.intervention.speaker);
  assert.deepEqual(after.summary.intervention.parentIds,['MTG-PL-2026-10-07-PVCRE-ITM-3']);
});
