import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CorpusStore} from './corpus-store.mjs';
import {CorpusReader} from './corpus-reader.mjs';
import {server} from './index.mjs';
import {CorpusWorker} from './corpus-worker.mjs';
import {odp} from './odp.mjs';
import {zstdDecompressSync} from 'node:zlib';

const id='MTG-PL-2026-10-07-OTH-1',date='2026-10-16T10:00:00Z';
const xml='<oralStatements><speech xml:lang="de"><from><person refersTo="person/42">Source Name</person></from><p>Exact <inline name="i">editorial note</inline> retained.</p></speech></oralStatements>';
const activity={id:'eli/dl/event/'+id,activity_id:id,activity_date:'2026-10-07',activity_start_date:'2026-10-07T10:00:00Z',activity_end_date:'2026-10-07T10:01:00Z',activity_label:{en:'Exact debate heading'},had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',
  had_participation:[{id:'participation/exact',had_participant_person:['person/42'],participation_in_name_of:['org/S_D'],participation_role:'def/ep-roles/SPEAKER'}],
  inverse_consists_of:['eli/dl/event/MTG-PL-2026-10-07-PVCRE-ITM-1'],
  recorded_in_a_realization_of:[{id:'eli/dl/doc/CRE-10-2026-10-07-INT-1',number:'CRE-10-2026-10-07-INT-1',numbering:17,originalLanguage:['http://publications.europa.eu/resource/authority/language/DEU'],'api:xmlFragment':{en:'omitted from metadata'}}]};
test('corpus transcript reads retain XML, exact keys, languages and provenance without writes or upstream requests',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'retained-speech-'));
  const old={CORPUS_ENABLED:process.env.CORPUS_ENABLED,CORPUS_DIR:process.env.CORPUS_DIR};
  const store=new CorpusStore(directory);store.acquire();
  const sourceUrl='https://data.europarl.europa.eu/api/v2/speeches?include-output=xml_fragment';
  store.putDocument({sourceId:id,kind:'speech',date:'2026-10-07',term:10,originalLanguages:['de']},[
    {sourceKey:'mul',language:'de',translationType:'original',sourceFormat:'xml-fragment',sourceUrl,fetchedAt:date,body:'Exact editorial note retained.',raw:xml},
    {sourceKey:'en',language:'en',translationType:'machine',sourceFormat:'xml-fragment',sourceUrl,fetchedAt:date,body:'English retained.',raw:'<oralStatements><speech xml:lang="de-t-en-mtec"><from><person refersTo="person/42">Source Name</person><process>Blue card question</process></from><p>English retained.</p></speech></oralStatements>'},
  ]);store.putSpeechMetadata(activity,sourceUrl,date);store.release();
  const before=store.db.prepare('SELECT id,sha256,checked_at FROM texts ORDER BY id').all();
  process.env.CORPUS_ENABLED='true';process.env.CORPUS_DIR=directory;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,originalFetch=globalThis.fetch;
  let upstream=0;
  t.mock.method(globalThis,'fetch',(url,options)=>{if(!String(url).startsWith(base)){upstream++;throw new Error('Upstream forbidden');}return originalFetch(url,options);});
  try {
    const get=(language,suffix='')=>fetch(`${base}/api/poc/speech-transcript/${id}?lang=${language}${suffix}`);
    const response=await get('de'),result=await response.json();
    assert.equal(response.status,200);assert.equal(result.xml,xml);
    assert.equal(result.sourceFragmentKey,'mul');assert.equal(result.textLanguage,'de');assert.equal(result.translationType,'original');
    assert.equal(result.sourceUrl,sourceUrl);assert.equal(result.fetchedAt,date);assert.equal(result.checkedAt,date);
    assert.deepEqual(result.availableTextLanguages,['en','de']);
    const english=await (await get('en')).json();assert.equal(english.translationType,'machine');
    assert.equal(english.metadata.id,id);assert.equal(english.metadata.speakers[0].id,'42');
    assert.equal(english.metadata.speakers[0].name,'Source Name');
    assert.equal(english.metadata.intervention.type,'blue-card-question');
    assert.equal(english.metadata.intervention.onBehalfOf[0].uri,'org/S_D');
    assert.deepEqual(english.metadata.intervention.parentIds,['MTG-PL-2026-10-07-PVCRE-ITM-1']);
    assert.equal(english.metadata.intervention.numbering,17);
    assert.equal(english.metadata.metadataSource.url,sourceUrl);assert.equal(english.metadata.metadataSource.fetchedAt,new Date(date).toISOString());
    const retained=JSON.parse(zstdDecompressSync(store.db.prepare('SELECT body FROM speech_metadata').get().body));
    assert.deepEqual(retained.activity.had_participation,activity.had_participation);
    assert.equal(retained.activity.recorded_in_a_realization_of[0]['api:xmlFragment'],undefined);
    await assert.rejects(odp('/meps/999999987',{}, {cachedOnly:true}),error=>error.code==='odp_cache_miss');
    assert.deepEqual(await (await get('fr')).json(),{id,available:false},'a missing language remains a miss');
    assert.deepEqual(await (await fetch(`${base}/api/poc/speech-transcript/${id}9?lang=en`)).json(),{id:id+'9',available:false});
    assert.equal((await get('xx')).status,400);assert.equal((await get('en','&lang=fr')).status,400);
    assert.equal((await get('en','&url=https://example.com')).status,400);
    const searchReader=new CorpusReader(directory);
    const searching=searchReader.query('search',{query:'retained'});
    assert.equal((await get('en')).status,200,'search has its own concurrency lane');await searching;
    const readOnly=new CorpusStore(directory,{readOnly:true});
    try{assert.equal(readOnly.speechTranscript({sourceId:id,language:'de'}).xml,xml);}finally{readOnly.close();}
    assert.deepEqual(store.db.prepare('SELECT id,sha256,checked_at FROM texts ORDER BY id').all(),before);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM lease').get().n,0);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
    assert.equal(upstream,0);
    store.db.prepare("UPDATE speech_metadata SET body=X'00'").run();
    const damagedMetadata=await (await get('de')).json();
    assert.equal(damagedMetadata.xml,xml);assert.equal(damagedMetadata.metadataUnavailable,true);
    assert.equal(damagedMetadata.metadata,undefined,'invalid metadata cannot remove valid retained text');
    store.db.prepare("UPDATE texts SET sha256='invalid' WHERE source_key='en'").run();
    assert.equal((await get('en')).status,500,'corruption is an error, not a miss or an upstream fetch');
    assert.equal(upstream,0);
    process.env.CORPUS_ENABLED='false';assert.deepEqual(await (await get('en')).json(),{id,available:false});
  } finally {
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();
    for(const [key,value] of Object.entries(old))value===undefined?delete process.env[key]:process.env[key]=value;
    rmSync(directory,{recursive:true,force:true});
  }
});

test('legacy corpus metadata upgrades through the existing lease and metadata-only monthly cursor',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'speech-metadata-backfill-'));
  let store=new CorpusStore(directory);
  try {
    store.acquire();store.putDocument({sourceId:id,kind:'speech',date:'2026-10-07',term:10},[{sourceKey:'de',language:'de',translationType:'original',sourceFormat:'xml-fragment',sourceUrl:'https://data.europarl.europa.eu/api/v2/speeches/'+id,fetchedAt:date,body:'Retained text.',raw:xml}]);
    store.db.exec("DROP TABLE speech_metadata; DELETE FROM meta WHERE key IN ('speechMetadataVersion','speechMetadataBackfill');");
    store.release();store.close();
    const legacy=new CorpusStore(directory,{readOnly:true});
    assert.equal(legacy.speechTranscript({sourceId:id,language:'de'}).xml,xml);legacy.close();
    store=new CorpusStore(directory);assert.equal(store.get('speechMetadataBackfill'),true);store.acquire();
    const before=store.db.prepare('SELECT sha256,checked_at FROM texts').get();let requests=0;
    const worker=new CorpusWorker(store,{clock:()=>Date.parse(date),interval:0,fetchRecord:async(endpoint,params)=>{
      requests++;assert.equal(endpoint,'/speeches');assert.equal(params['include-output'],undefined);assert.equal(params.limit,500);
      return {payload:{data:params.offset===0?[activity]:[],meta:{total:1}},fetchedAt:date};
    }});
    await worker.discover();let task=store.nextTask();assert.equal(task.kind,'speech-metadata');
    await worker.task(task);assert.equal(store.task(task.key).body.offset,1);
    await worker.task(store.task(task.key));assert.equal(store.task(task.key).done,1);
    await worker.discover();assert.equal(store.get('speechMetadataBackfill'),false);
    assert.equal(requests,2);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM speech_metadata').get().n,1);
    assert.deepEqual(store.db.prepare('SELECT sha256,checked_at FROM texts').get(),before);
    store.release();assert.throws(()=>store.putSpeechMetadata(activity,'https://data.europarl.europa.eu/api/v2/speeches',date),/lease/);
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

test('metadata-only missing graph recovery never fetches XML or rewrites retained text',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'speech-metadata-recovery-')),store=new CorpusStore(directory);
  try {
    store.acquire();store.putDocument({sourceId:id,kind:'speech',date:'2026-10-07',term:10},[{sourceKey:'de',language:'de',translationType:'original',sourceFormat:'xml-fragment',sourceUrl:'https://data.europarl.europa.eu/api/v2/speeches/'+id,fetchedAt:date,body:'Retained text.',raw:xml}]);
    store.set('speechMetadataBackfill',true);
    const before=store.db.prepare('SELECT sha256,checked_at FROM texts').get(),requests=[];
    t.mock.method(store,'putDocument',()=>{throw new Error('Metadata recovery cannot ingest text');});
    const worker=new CorpusWorker(store,{clock:()=>Date.parse(date),interval:0,fetchRecord:async(endpoint,params)=>{
      requests.push(endpoint);assert.equal(params['include-output'],undefined);
      return {payload:endpoint==='/speeches'?{data:[],searchResults:{hits:params.offset===0?[{id:'eli/dl/event/'+id}]:[]}}:{data:[activity]},fetchedAt:date};
    }});
    await worker.discover();const page=store.nextTask();await worker.task(page);await worker.task(store.task(page.key));
    await worker.discover();assert.equal(store.get('speechMetadataBackfill'),true,'missing detail remains pending after the page cursor finishes');
    const recovery=store.task('speech-metadata-detail:'+id);assert(recovery);await worker.task(recovery);
    await worker.discover();assert.equal(store.get('speechMetadataBackfill'),false);
    assert.deepEqual(requests,['/speeches','/speeches','/speeches/'+id]);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM speech_metadata').get().n,1);
    assert.deepEqual(store.db.prepare('SELECT sha256,checked_at FROM texts').get(),before);
  } finally {store.release();store.close();rmSync(directory,{recursive:true,force:true});}
});

test('primary retention preserves source-discovered languages in ready metadata across metadata-only refreshes',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'speech-primary-metadata-')),store=new CorpusStore(directory);
  try {
    store.acquire();
    const source=structuredClone(activity),doc=source.recorded_in_a_realization_of[0];
    doc.originalLanguage=['http://publications.europa.eu/resource/authority/language/SPA'];
    doc['api:xmlFragment']=Object.fromEntries(['en','fr','de'].map(language=>[language,`<speech xml:lang="es-t-${language}-mtec"><from><person refersTo="person/42">Source Name</person></from><p>Source ${language} variant.</p></speech>`]));
    const worker=new CorpusWorker(store,{languages:'primary',interval:0,fetchRecord:async()=>({payload:{data:[source]},fetchedAt:date})});
    store.enqueue('primary-test','speeches',{start:'2026-10-01',end:'2026-10-31',offset:0,limit:25},60);
    await worker.task(store.task('primary-test'));
    assert.deepEqual(store.speechTranscript({sourceId:id,language:'en'}).availableTextLanguages,['en']);
    assert.equal(store.speechTranscript({sourceId:id,language:'fr'}).available,false);
    const reader=new CorpusReader(directory);
    let result=await reader.query('speech-transcript',{sourceId:id,language:'en'});
    assert.deepEqual(result.metadata.availableTextLanguages,['en','fr','de']);
    assert.deepEqual(result.metadata.textCache.availableLanguages,['en'],'retained and source availability stay distinct');
    delete doc['api:xmlFragment'];store.putSpeechMetadata(source,'https://data.europarl.europa.eu/api/v2/speeches/'+id,'2026-10-17T10:00:00Z');
    result=await reader.query('speech-transcript',{sourceId:id,language:'en'});
    assert.deepEqual(result.metadata.availableTextLanguages,['en','fr','de']);
  } finally {store.release();store.close();rmSync(directory,{recursive:true,force:true});}
});
