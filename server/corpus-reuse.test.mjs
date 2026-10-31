import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {CorpusStore} from './corpus-store.mjs';
import {CorpusWorker,speechTexts} from './corpus-worker.mjs';
import {ActivityStore} from './activity-index-store.mjs';
import {speechRows,projectProcedure} from './activity-index-model.mjs';
import {classifyProcedure} from './insights-legislation-model.mjs';
import {SpeechCloudInsights,speechCloudQuery} from './speech-cloud.mjs';
import {SpeechWordInsights,speechWordsQuery} from './insights-speech-words.mjs';
import {SpeechInterventions} from './speech-intervention-service.mjs';
import {LegislationInsights} from './insights-legislation.mjs';
import {retainedSpeechData,retainedSpeechMetadata,retainedSpeechPage} from './corpus-speeches.mjs';
import {odpSpeech} from './odp.mjs';
import {speechMedia} from './mmc.mjs';
import {CorpusReader} from './corpus-reader.mjs';
import {allowSlowCorpusReaders} from './test-support/corpus-reader.mjs';
import {periodAvailability} from './source-availability.mjs';

const fetchedAt='2026-10-17T10:00:00Z',now=()=>Date.parse(fetchedAt),url='https://data.europarl.europa.eu/api/v2/speeches?include-output=xml_fragment';
const xml='<oralStatements><speech xml:lang="de-t-en-mtec"><from><person refersTo="person/42">Exact Speaker</person></from><p>Climate climate water.</p></speech></oralStatements>';
function activity(number,{member='42',date='2026-10-07',kind='PLENARY_DEBATE_SPEECH',fragments={en:xml}}={}) {
  const id=`MTG-PL-${date}-OTH-${number}`;
  return {id:'eli/dl/event/'+id,activity_id:id,activity_date:date,activity_start_date:date+'T10:00:00Z',had_activity_type:'def/ep-activities/'+kind,
    activity_label:{en:'Exact debate',hu:'Pontos vita'},had_participation:[{had_participant_person:['person/'+member]}],
    recorded_in_a_realization_of:[{id:'eli/dl/doc/CRE-10-'+date+'-INT-'+number,numbering:number,originalLanguage:['http://publications.europa.eu/resource/authority/language/DEU'],'api:xmlFragment':fragments}]};
}
function fixture(t,{realReaders=true}={}) {
  if(realReaders)allowSlowCorpusReaders(t);
  const directory=mkdtempSync(path.join(os.tmpdir(),'corpus-reuse-')),store=new CorpusStore(path.join(directory,'corpus'));
  const index=new ActivityStore(path.join(directory,'index'),{clock:now});store.acquire();index.acquire();const {generation}=index.beginCycle();index.setMembers([{id:'42',name:'Exact Speaker',countryCode:'HU'}]);
  const old={CORPUS_DIR:process.env.CORPUS_DIR,CORPUS_ENABLED:process.env.CORPUS_ENABLED,ACTIVITY_INDEX_ENABLED:process.env.ACTIVITY_INDEX_ENABLED};
  process.env.CORPUS_DIR=path.dirname(store.filename);process.env.CORPUS_ENABLED='on';process.env.ACTIVITY_INDEX_ENABLED='false';
  t.mock.method(globalThis,'fetch',()=>{throw new Error('Upstream requests forbidden');});
  t.after(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();index.close();for(const [key,value] of Object.entries(old))value===undefined?delete process.env[key]:process.env[key]=value;rmSync(directory,{recursive:true,force:true});});
  const add=(a,{metadata=true,text=true}={})=>{if(text){const extracted=speechTexts(a,url,fetchedAt);store.putDocument(extracted.document,extracted.texts);}if(metadata)store.putSpeechMetadata(a,url,fetchedAt);index.putSource(generation,'/speeches/'+a.activity_id,'speech',{id:a.activity_id},fetchedAt,speechRows(a,fetchedAt));return a.activity_id;};
  return {directory,store,index,add};
}
test('retained batches preserve exact language and provenance without XML decompression or writes',async t=>{
  const {store,add}=fixture(t),id=add(activity(1));
  store.db.prepare('UPDATE texts SET raw=?').run(Buffer.from('unreadable raw XML'));
  const before=store.db.prepare('SELECT checked_at,sha256 FROM texts').all();
  const en=await retainedSpeechData({sourceIds:[id],language:'en'});
  assert.equal(en.records[0].text.body,'Climate climate water.');assert.equal(en.records[0].text.translationType,'machine');assert.equal(en.records[0].text.sourceUrl,url);assert.equal(en.records[0].text.fetchedAt,fetchedAt);
  const hu=await retainedSpeechData({sourceIds:[id],language:'hu'});assert.equal(hu.records[0].text,null);assert.deepEqual(hu.records[0].availableLanguages,['en']);
  assert.deepEqual(store.db.prepare('SELECT checked_at,sha256 FROM texts').all(),before);
});

test('speech availability ignores the member filter and separates metadata from retained language text',t=>{
  const {store,add}=fixture(t,{realReaders:false});
  add(activity(1,{date:'2026-10-07',member:'42'}));
  add(activity(2,{date:'2026-10-15',member:'43',fragments:{hu:xml.replace('de-t-en-mtec','hu')}}));
  const page=store.speechPage({member:'42',language:'en',from:'2026-10-01',to:'2026-10-17',metadataOnly:false});
  assert.equal(page.total,1);
  assert.equal(page.coverage.availability.metadata.latestObservedDate,'2026-10-15');
  assert.equal(page.coverage.availability.text.latestObservedDate,'2026-10-07');
  const hu=store.speechPage({member:'42',language:'hu',from:'2026-10-01',to:'2026-10-17',metadataOnly:false});
  assert.equal(hu.coverage.availability.text.latestObservedDate,'2026-10-15');
  assert.equal(hu.records[0].text,null);
  const absent=store.speechPage({member:'99',language:'en',from:'2026-10-01',to:'2026-10-17',metadataOnly:false});
  assert.equal(absent.total,0);assert.deepEqual(absent.coverage.availability,page.coverage.availability);
  add(activity(3,{date:'2026-10-09',member:'44',kind:'PLENARY_DEBATE_WRITTEN_STATEMENT'}));
  const mixed=store.speechPage({member:'42',metadataOnly:true,kinds:['PLENARY_DEBATE_SPEECH','PLENARY_DEBATE_WRITTEN_STATEMENT']});
  assert.deepEqual(mixed.coverage.availability.metadataSources.map(source=>[source.subtype,source.latestObservedDate]),[
    ['PLENARY_DEBATE_SPEECH','2026-10-15'],['PLENARY_DEBATE_WRITTEN_STATEMENT','2026-10-09']
  ]);
});

test('a failed earlier corpus window remains null below a newer language frontier',t=>{
  const {store,add}=fixture(t,{realReaders:false});add(activity(1,{date:'2026-10-15'}));
  store.enqueue('failed-window','speeches',{start:'2026-09-01',end:'2026-09-30'},50);
  store.failTask(store.task('failed-window'),new Error('source unavailable'));
  const evidence=store.speechPage({language:'en',from:'2026-09-01',to:'2026-10-17'}).coverage.availability.text;
  assert.equal(evidence.latestObservedDate,'2026-10-15');
  assert.equal(periodAvailability({start:'2026-09-01',end:'2026-09-30'},evidence,0).observedCount,null);
  assert.equal(periodAvailability({start:'2026-09-01',end:'2026-09-30'},evidence,2).state,'partial');
});
test('metadata-only reads work without a retained transcript and isolate damaged metadata',async t=>{
  const {store,add}=fixture(t),id=add(activity(2),{text:false});
  assert.equal((await retainedSpeechMetadata(id)).summary.id,id);
  store.db.prepare('UPDATE speech_metadata SET body=? WHERE source_id=?').run(Buffer.from('corrupt'),id);
  assert.equal(await retainedSpeechMetadata(id),null);
  const data=await retainedSpeechData({sourceIds:[id],language:'en'});assert.equal(data.records[0].metadataUnavailable,true);
});
test('parallel cloud and statistics page reads share bounded worker capacity through teardown',{timeout:120_000},async t=>{
  const {add}=fixture(t);for(let n=1;n<=51;n++)add(activity(n));
  // Exercise real workers and all four results independently of the 250 ms
  // admission policy, which is checked with controlled readers below.
  t.mock.method(performance,'now',()=>0);
  const reads=await Promise.all(Array.from({length:4},(_,n)=>retainedSpeechPage({member:'42',language:'en',offset:(n%2)*50,limit:50})));
  assert(reads.every(result=>result?.total===51));assert.deepEqual(reads.map(result=>result.records.length),[50,1,50,1]);
});
test('retained page admission bounds active readers, queued readers and waiting time',async t=>{
  fixture(t,{realReaders:false});
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  // The pool imports timers/promises by name; publish the mocked binding too.
  syncBuiltinESMExports();
  t.after(()=>{t.mock.timers.reset();syncBuiltinESMExports();});
  t.mock.method(performance,'now',()=>Date.now());
  const active=[],turn=()=>new Promise(resolve=>setImmediate(resolve));
  t.mock.method(CorpusReader.prototype,'query',function(operation,params) {
    assert.equal(this.busy,false);assert.equal(operation,'speech-page');this.busy=true;
    const {promise,resolve}=Promise.withResolvers();
    active.push({reader:this,offset:params.offset,resolve});return promise;
  });
  const read=offset=>retainedSpeechPage({language:'en',offset});
  const first=read(0),second=read(1),queued=Array.from({length:8},(_,n)=>read(n+2));
  assert.equal(active.length,2);assert.equal(await read(10),null,'only eight readers may wait');
  t.mock.timers.tick(240);await turn();assert.equal(active.length,2);
  // A settled result still occupies its lane until worker teardown completes.
  active[0].resolve({total:51});assert.deepEqual(await first,{total:51});
  t.mock.timers.tick(9);await turn();assert.equal(active.length,2);
  active[0].reader.busy=false;
  t.mock.timers.tick(1);await turn();
  assert.equal(active.length,3);assert.equal(active[2].offset,2);
  assert.equal(active[2].reader,active[0].reader,'the exited worker lane is reused');
  assert.deepEqual(await Promise.all(queued.slice(1)),Array(7).fill(null),'remaining waits expire at 250 ms');
  active[1].reader.busy=false;active[1].resolve({total:52});
  active[2].reader.busy=false;active[2].resolve({total:53});
  assert.deepEqual(await second,{total:52});assert.deepEqual(await queued[0],{total:53});
  const next=read(11);assert.equal(active.length,4);
  active[3].reader.busy=false;active[3].resolve({total:54});assert.deepEqual(await next,{total:54});
});
test('speech pages filter exact members, types, dates and topic IDs with stable continuation and partial coverage',t=>{
  const {store,add}=fixture(t),a=add(activity(1)),b=add(activity(2)),written=add(activity(3,{kind:'PLENARY_DEBATE_WRITTEN_STATEMENT'}));
  add(activity(4,{member:'7'}));add(activity(5,{date:'2026-10-08'}));
  store.db.exec('PRAGMA query_only=ON');
  const first=store.speechPage({member:'42',from:'2026-10-07',to:'2026-10-07',language:'en',limit:1});
  assert.equal(first.total,2);assert.equal(first.records[0].id,a);assert.equal(first.nextOffset,1);assert.equal(first.coverage.authoritativeComplete,false);
  assert.equal(store.speechPage({member:'42',dates:['2026-10-07'],sourceIds:[b,written],language:'en',limit:50}).records[0].id,b);
  const next=store.speechPage({member:'42',from:'2026-10-07',to:'2026-10-07',language:'en',limit:1,offset:1});assert.equal(next.records[0].id,b);assert.equal(next.nextOffset,null);
});
test('statistics report the latest collection date independently of the selected member',async t=>{
  const {store,add}=fixture(t);
  add(activity(1,{date:'2026-10-07'}));
  add(activity(2,{member:'7',date:'2026-10-09',kind:'PLENARY_DEBATE_WRITTEN_STATEMENT'}));
  const first=store.speechPage({member:'42',to:'2026-10-07',metadataOnly:true});
  assert.equal(first.coverage.latestDataDate,'2026-10-09');
  assert.equal(first.coverage.authoritativeComplete,false);
  const service=new SpeechInterventions({identities:null,readCorpusPage:params=>store.speechPage(params)});
  const older=await service.member('42'),newer=await service.member('7');
  assert.equal(older.items[0].date,'2026-10-07');
  assert.equal(newer.items[0].date,'2026-10-09');
  assert.equal(older.coverage.latestDataDate,'2026-10-09');
  assert.equal(newer.coverage.latestDataDate,'2026-10-09');
  assert.equal(older.coverage.complete,false);
});
test('legacy catalogue projection is populated by the leased writer without source calls and fences lease loss',async t=>{
  const {store,add}=fixture(t);add(activity(1));store.db.exec('DELETE FROM speech_catalog');
  assert.equal(store.speechPage({language:'en'}),null);
  const worker=new CorpusWorker(store,{clock:now,fetchRecord:()=>{throw new Error('No metadata downloads');}});
  await worker.discover();assert.equal(store.speechPage({language:'en'}).total,1);
  store.db.exec('DELETE FROM speech_catalog');t.mock.method(store,'projectSpeechCatalog',()=>{store.release();throw new Error('lease changed');});
  await assert.rejects(worker.discover(),/lease was lost/);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM speech_catalog').get().n,0);
});
test('retained pages obey aggregate and ID limits and reject older metadata from changing their selection',t=>{
  const {store,add}=fixture(t),a=activity(1),id=add(a);add(activity(2));
  store.db.prepare('UPDATE texts SET body=?,chars=?').run('x'.repeat(2*1024*1024),2*1024*1024);
  assert.equal(store.speechPage({language:'en'}).truncated,true);
  assert.throws(()=>store.speechData({sourceIds:Array(101).fill(id),language:'en'}),/Invalid retained/);
  const old={...a,had_participation:[{had_participant_person:['person/7']}]};store.putSpeechMetadata(old,url,'2026-10-16T10:00:00Z');
  assert.equal(store.speechPage({member:'7',metadataOnly:true}).total,0);assert.equal(store.speechPage({member:'42',metadataOnly:true}).total,2);
});
test('clouds consume retained paragraphs and saved speaker metadata without any API request',async t=>{
  const {index,add}=fixture(t);const id=add(activity(1));add(activity(2,{kind:'PLENARY_DEBATE_WRITTEN_STATEMENT'}));
  const cloud=new SpeechCloudInsights(index,{clock:now});
  const result=await cloud.query(speechCloudQuery(new URLSearchParams('member=42&days=term'),{now:now()}));
  assert.equal(result.coverage.transcripts,1);assert.equal(result.words.find(word=>word.word==='climate').occurrences,2);assert.equal(result.speeches[0].id,id);assert.equal(result.speeches[0].people[0].name,'Exact Speaker');assert.equal(result.coverage.basis,'retained-corpus');assert.equal(result.coverage.complete,false);assert(result.sources.some(source=>source.url===url&&source.fetchedAt===fetchedAt));
  const missing=await cloud.query(speechCloudQuery(new URLSearchParams('member=42&days=term&lang=hu'),{now:now()}));assert.equal(missing.coverage.missingLanguage,1);assert.deepEqual(missing.words,[]);
});
test('cloud corpus pagination never switches catalogues and keeps country and topic filters',async t=>{
  const {index,add}=fixture(t);for(let n=1;n<=51;n++)add(activity(n));
  let calls=0;const cloud=new SpeechCloudInsights(index,{clock:now,readCorpusPage:async params=>{calls++;return retainedSpeechPage(params);}}),query=speechCloudQuery(new URLSearchParams('member=42&days=term&country=HU'),{now:now()});
  const first=await cloud.query(query);assert.equal(first.coverage.transcripts,50);assert.equal(first.nextPage,1);
  const second=await cloud.query({...query,page:1});assert.equal(second.coverage.transcripts,51);assert.equal(second.nextPage,null);assert.equal(calls,2);
  const parent='MTG-PL-2026-10-07-OJ-ITM-D-1';
  const topic=new SpeechCloudInsights(index,{clock:now,legislation:{catalogue:async()=>({sittings:[{activity_id:'MTG-PL-2026-10-07',activity_date:'2026-10-07'}]}),query:async()=>({detail:{coverage:{speechAssociations:{sources:[{eventDate:'2026-10-07',contributionIds:[activity(51).activity_id]}]}},people:[],title:'Exact topic'}})}});
  const selected=await topic.query(speechCloudQuery(new URLSearchParams('sitting=MTG-PL-2026-10-07&topic='+parent),{now:now()}));assert.equal(selected.coverage.transcripts,1);assert.equal(selected.speeches[0].id,activity(51).activity_id);
});
test('an unavailable corpus retains the existing public pagination fallback',async t=>{
  const {index}=fixture(t);let calls=0;
  const cloud=new SpeechCloudInsights(index,{clock:now,readCorpusPage:retainedSpeechPage,request:async()=>{calls++;return {url,fetchedAt:now(),payload:{data:[],meta:{total:0}}};}});
  const result=await cloud.query(speechCloudQuery(new URLSearchParams('member=42&days=term'),{now:now()}));assert.equal(calls,1);assert.equal(result.coverage.complete,true);assert.equal(result.coverage.basis,undefined);
});
test('a known source translation omitted by retention keeps the public cloud fallback',async t=>{
  const {store,index,add}=fixture(t),a=activity(1,{fragments:{en:xml,hu:'<oralStatements><speech xml:lang="de-t-hu-mtec"><p>Éghajlat vízgazdálkodás.</p></speech></oralStatements>'}}),id=add(a);
  store.db.prepare("DELETE FROM texts WHERE source_key='hu'").run();
  assert.equal(store.speechPage({member:'42',language:'hu'}).missingRetainedLanguage,1);
  let calls=0;const service=new SpeechCloudInsights(index,{clock:now,readCorpusPage:retainedSpeechPage,request:async()=>{calls++;return {url,fetchedAt:now(),payload:{data:[a],meta:{total:1}}};}});
  const result=await service.query(speechCloudQuery(new URLSearchParams('member=42&days=term&lang=hu'),{now:now()}));
  assert.equal(calls,1);assert.equal(result.speeches[0].id,id);assert.equal(result.coverage.transcripts,1);assert.equal(result.coverage.basis,undefined);
});
test('missing retained translations are counted across the exact selection, independently of pagination',t=>{
  const {store,add}=fixture(t,{realReaders:false});
  const ids=Array.from({length:51},(_,n)=>add(activity(n+1)));
  const missing=ids.at(-1);
  store.db.prepare('DELETE FROM texts WHERE document_id=(SELECT id FROM documents WHERE source_id=?)').run(missing);
  // Missing text for other members, dates and intervention kinds must not force
  // this selection onto the public source. Unknown translations are gaps, too.
  add(activity(100,{member:'7'}),{text:false});
  add(activity(101,{date:'2026-09-01'}),{text:false});
  add(activity(102,{kind:'PLENARY_DEBATE_WRITTEN_STATEMENT'}),{text:false});
  add(activity(103,{fragments:{hu:xml.replace('de-t-en-mtec','hu')}}),{text:false});
  const query={member:'42',from:'2026-10-01',to:'2026-10-17',language:'en'};
  store.db.exec('PRAGMA query_only=ON');
  const first=store.speechPage({...query,limit:50}),last=store.speechPage({...query,offset:50,limit:50});
  assert.equal(first.total,52);assert.equal(first.missingRetainedLanguage,1);
  assert.equal(last.missingRetainedLanguage,1);
  assert.equal(last.records.find(record=>record.id===missing).text,null);
  assert.equal(store.speechPage({...query,sourceIds:ids.slice(0,50)}).missingRetainedLanguage,0);
  assert.equal(store.speechPage({...query,dates:['2026-10-07'],sourceIds:[missing]}).missingRetainedLanguage,1);
  assert.equal(store.speechPage({...query,member:'99'}).missingRetainedLanguage,0);
  assert.equal(store.speechPage({...query,metadataOnly:true}).missingRetainedLanguage,0);
});
test('an unavailable later corpus page cannot reinterpret its offset as an upstream page',async t=>{
  const {index,add}=fixture(t);for(let n=1;n<=51;n++)add(activity(n));
  let reads=0;const service=new SpeechCloudInsights(index,{clock:now,readCorpusPage:params=>++reads===1?retainedSpeechPage(params):null});
  const query=speechCloudQuery(new URLSearchParams('member=42&days=term'),{now:now()});
  assert.equal((await service.query(query)).coverage.transcripts,50);
  await assert.rejects(service.query({...query,page:1}),error=>error.code==='corpus_unavailable');
});
test('saved word analysis uses exact-language corpus text and retains its disk-only fallback',async t=>{
  const {index,add}=fixture(t);add(activity(1));let savedReads=0;
  const words=new SpeechWordInsights(index,{clock:now,readTranscript:async()=>{savedReads++;return null;}});
  const en=await words.query(speechWordsQuery(new URLSearchParams('member=42&days=term'),{now:now()}));assert.equal(en.coverage.analyzedTranscripts,1);assert.equal(savedReads,0);assert.equal(Date.parse(en.speeches[0].sourceFetchedAt),Date.parse(fetchedAt));
  const hu=await words.query(speechWordsQuery(new URLSearchParams('member=42&days=term&lang=hu'),{now:now()}));assert.equal(hu.coverage.missingRequestedLanguage,1);assert.equal(savedReads,1);
});
test('statistics and context reuse saved intervention projections rather than XML-stripped metadata',async t=>{
  const {add}=fixture(t),id=add(activity(1));
  const service=new SpeechInterventions({identities:null});
  const stats=await service.member('42');assert.equal(stats.items[0].intervention.type,'speech');assert.equal(stats.coverage.available,1);assert.equal(stats.coverage.complete,false);assert.equal(stats.counts.blueQuestions,null);assert.equal(stats.counts.groupOrations,null);
  const context=await service.context(id);assert.equal(context.intervention.type,'speech');assert.equal(context.intervention.speaker.name,'Exact Speaker');assert.equal(context.unavailable,true);
});
test('legacy speech detail and media metadata reuse corpus data',async t=>{
  const {add,directory}=fixture(t),id=add(activity(1));
  const speech=await odpSpeech(id,'en');assert.equal(speech.id,id);assert.equal(speech.xml,xml);assert.equal(speech.speakers[0].name,'Exact Speaker');
  const media=await speechMedia(id,'en','en',{directory});assert.equal(media.status,'missing-times');
});
test('speech detail keeps a retained original readable when the requested translation and upstream are unavailable',async t=>{
  const {add,store}=fixture(t),original='<oralStatements><speech xml:lang="de"><p>Originaler Klimabeitrag.</p></speech></oralStatements>';
  const id=add(activity(7001,{fragments:{mul:original}}));
  const before=store.db.prepare('SELECT id,sha256,checked_at FROM texts ORDER BY id').all();
  const speech=await odpSpeech(id,'en');
  assert.equal(speech.id,id);assert.equal(speech.textLanguage,'de');assert.equal(speech.xml,original);
  assert.equal(speech.sourceFragmentKey,'mul');assert.equal(speech.translationType,'original');
  assert.equal(speech.sourceReadError.code,'speech_source_unavailable');assert.equal(speech.textCache.refreshError,null);
  assert.equal(speech.fetchedAt,fetchedAt);assert.equal(speech.metadataSource.url,url);
  assert.deepEqual(store.db.prepare('SELECT id,sha256,checked_at FROM texts ORDER BY id').all(),before);
});
test('stored language fallback requires exact metadata and prefers the original over an unrelated translation',async t=>{
  const {add}=fixture(t),original='<oralStatements><speech xml:lang="de"><p>Originaler Beitrag.</p></speech></oralStatements>';
  const id=add(activity(7021,{fragments:{mul:original,en:xml}}));
  const result=await odpSpeech(id,'fr');assert.equal(result.textLanguage,'de');assert.equal(result.xml,original);
  const missing=add(activity(7022,{fragments:{de:original}}),{metadata:false});
  await assert.rejects(odpSpeech(missing,'en'),/Upstream requests forbidden/);
});
test('cloud omissions expose bounded real alternative languages without mixing them into the selected language',async t=>{
  const {index,add}=fixture(t);
  add(activity(7002,{fragments:{mul:'<oralStatements><speech xml:lang="de"><p>Klimaschutz.</p></speech></oralStatements>'}}));
  add(activity(7003,{fragments:{ro:'<oralStatements><speech xml:lang="ro"><p>Protecția climei.</p></speech></oralStatements>'}}));
  add(activity(7004));
  const cloud=new SpeechCloudInsights(index,{clock:now});
  const result=await cloud.query(speechCloudQuery(new URLSearchParams('member=42&days=term&lang=en'),{now:now()}));
  assert.equal(result.coverage.missingLanguage,2);assert.equal(result.coverage.transcripts,1);
  assert.deepEqual(result.coverage.missingLanguageAlternatives,[{language:'de',count:1},{language:'ro',count:1}]);
  assert.equal(result.speeches.length,1);assert(!result.words.some(word=>word.word==='klimaschutz'));
});
test('public cloud recognizes a single-language mul original and reports only known alternatives for omitted speeches',async t=>{
  const {index}=fixture(t,{realReaders:false});
  const nodes=[activity(7011,{fragments:{mul:'<oralStatements><speech xml:lang="en"><p>Climate action.</p></speech></oralStatements>'}}),
    activity(7012,{fragments:{mul:'<oralStatements><speech xml:lang="de"><p>Klimaschutz.</p></speech></oralStatements>'}})];
  const cloud=new SpeechCloudInsights(index,{clock:now,request:async()=>({payload:{data:nodes,meta:{total:2}},url,fetchedAt:now()})});
  const result=await cloud.query(speechCloudQuery(new URLSearchParams('member=42&days=term&lang=en'),{now:now()}));
  assert.equal(result.coverage.transcripts,1);assert.equal(result.coverage.missingLanguage,1);
  assert.deepEqual(result.coverage.missingLanguageAlternatives,[{language:'de',count:1}]);
  assert.deepEqual(result.speeches.map(speech=>speech.id),[nodes[0].activity_id]);
});
test('public cloud parses separate selected-language XML parts without losing an existing English fragment',async t=>{
  const {index}=fixture(t,{realReaders:false}),node=activity(7031,{fragments:{en:xml}});
  node.recorded_in_a_realization_of.push({'api:xmlFragment':{mul:'<oralStatements><speech xml:lang="en"><p>Renewable energy.</p></speech></oralStatements>'}});
  const cloud=new SpeechCloudInsights(index,{clock:now,request:async()=>({payload:{data:[node],meta:{total:1}},url,fetchedAt:now()})});
  const result=await cloud.query(speechCloudQuery(new URLSearchParams('member=42&days=term&lang=en'),{now:now()}));
  assert.equal(result.coverage.transcripts,1);assert.equal(result.coverage.unreadableText,0);
  assert(result.words.some(word=>word.word==='climate'));assert(result.words.some(word=>word.word==='renewable'));
});
test('public cloud offers only bounded readable language alternatives',async t=>{
  const {index}=fixture(t,{realReaders:false});
  const fragments=['<oralStatements><speech xml:lang="de"><p/></speech></oralStatements>','   ','<speech><p>Broken',
    '<oralStatements><speech xml:lang="de"><p>'+('x'.repeat(1024*1024))+'</p></speech></oralStatements>',
    '<oralStatements><speech xml:lang="de"><p>Lesbarer Beitrag.</p></speech></oralStatements>'];
  const nodes=fragments.map((xml,i)=>activity(7071+i,{fragments:{de:xml}}));
  const cloud=new SpeechCloudInsights(index,{clock:now,request:async()=>({payload:{data:nodes,meta:{total:nodes.length}},url,fetchedAt:now()})});
  const result=await cloud.query(speechCloudQuery(new URLSearchParams('member=42&days=term&lang=en'),{now:now()}));
  assert.equal(result.coverage.missingLanguage,5);assert.equal(result.coverage.transcripts,0);
  assert.deepEqual(result.coverage.missingLanguageAlternatives,[{language:'de',count:1}]);
});
test('alternative verification stops at its XML budget and reports bounded counts',async t=>{
  const {index}=fixture(t,{realReaders:false}),xml='<speech xml:lang="de"><p>'+('x'.repeat(900*1024))+'</p></speech>';
  const nodes=Array.from({length:5},(_,i)=>activity(7081+i,{fragments:{de:xml}}));
  const cloud=new SpeechCloudInsights(index,{clock:now,request:async()=>({payload:{data:nodes,meta:{total:5}},url,fetchedAt:now()})});
  const result=await cloud.query(speechCloudQuery(new URLSearchParams('member=42&days=term&lang=en'),{now:now()}));
  assert.equal(result.coverage.missingLanguage,5);assert.equal(result.coverage.languageAlternativesLimited,true);
  assert.deepEqual(result.coverage.missingLanguageAlternatives,[{language:'de',count:4}]);
  assert(result.coverage.sourceRecords.issues.includes('language-choice-byte-limit'));
});
test('a successful detail response with no matching activity still allows an exact retained original',async t=>{
  const {add}=fixture(t),original='<oralStatements><speech xml:lang="de"><p>Originaler Beitrag.</p></speech></oralStatements>';
  const id=add(activity(7032,{fragments:{de:original}}));
  t.mock.method(globalThis,'fetch',async()=>Response.json({data:[]}));
  const result=await odpSpeech(id,'en');assert.equal(result.textLanguage,'de');assert.equal(result.xml,original);
  assert.equal(result.sourceReadError.code,'speech_not_found');
});
test('retained original XML can use exact upstream headers when the separate metadata retention is missing',async t=>{
  const {add}=fixture(t),original='<oralStatements><speech xml:lang="de"><p>Originaler Beitrag.</p></speech></oralStatements>';
  const node=activity(7051,{fragments:{de:original}}),id=add(node,{metadata:false}),fresh=structuredClone(node);
  delete fresh.recorded_in_a_realization_of[0]['api:xmlFragment'];
  t.mock.method(globalThis,'fetch',async input=>{if(String(input).includes('/speeches/'))return Response.json({data:[fresh]});throw new Error('No profile request allowed');});
  const result=await odpSpeech(id,'en');
  assert.equal(result.xml,original);assert.equal(result.textLanguage,'de');assert.equal(result.fetchedAt,fetchedAt);
  assert.equal(result.textCache.sourceUrl,url);assert.equal(result.textCache.sourceFetchedAt,fetchedAt);
  assert.notEqual(result.metadataSource.fetchedAt,fetchedAt);assert(result.metadataSource.url.includes('/speeches/'+id));
});
test('fresh headers with conflicting date or URI cannot relabel retained XML',async t=>{
  const {add}=fixture(t),original='<oralStatements><speech xml:lang="de"><p>Originaler Beitrag.</p></speech></oralStatements>';
  for(const [i,change] of [{activity_date:'2026-10-08'},{id:'eli/dl/event/FOREIGN'},{'@id':'eli/dl/event/FOREIGN'},{had_activity_type:'https://foreign.invalid/PLENARY_DEBATE_SPEECH'},{parliamentary_term:'org/ep-11'}].entries()) {
    const node=activity(7061+i,{fragments:{de:original}}),id=add(node,{metadata:false}),fresh=structuredClone(node);
    delete fresh.recorded_in_a_realization_of[0]['api:xmlFragment'];Object.assign(fresh,change);
    t.mock.method(globalThis,'fetch',async input=>{if(String(input).includes('/speeches/'))return Response.json({data:[fresh]});throw new Error('No profile request allowed');});
    assert.equal((await odpSpeech(id,'en')).xml,null);
  }
});
test('legislation associations use exact saved speech and document metadata without redundant source requests',async t=>{
  const {index,add}=fixture(t),id=add(activity(1)),work={id:'eli/dl/doc/B-10-2026-0001',identifier:'B-10-2026-0001',title_dcterms:{en:'Exact saved work'},inverse_based_on_a_realization_of:[]};
  const generation=index.status().servingGeneration;index.putSource(generation,'/plenary-documents/'+work.identifier,'document',work,fetchedAt,[]);
  const service=new LegislationInsights(index,{clock:now});
  assert.equal((await service.record('/speeches/'+id)).payload.data[0].activity_id,id);
  assert.deepEqual((await service.record('/plenary-documents/'+work.identifier)).payload.data[0],work);
});
test('legacy incomplete procedure projections retain source classification and debate association fallback',async t=>{
  const {index}=fixture(t),id='2025-0407',work={id:'eli/dl/proc/'+id,process_type:'def/procedure-types/COD',label:'2025/0407(COD)',consists_of:[{id:'eli/dl/event/MTG-PL-2026-10-07-PVCRE-ITM-1',activity_id:'MTG-PL-2026-10-07-PVCRE-ITM-1',had_activity_type:'def/ep-activities/PLENARY_DEBATE'}]};
  const projection=projectProcedure(work),generation=index.status().servingGeneration;
  delete projection.label;delete projection.consists_of[0].activity_id;
  index.putSource(generation,'/procedures/'+id,'procedure',projection,fetchedAt,[]);
  let calls=0;const service=new LegislationInsights(index,{clock:now,request:async endpoint=>{calls++;assert.equal(endpoint,'/procedures/'+id);return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:now(),payload:{data:[work]}};}});
  const read=(await service.record('/procedures/'+id)).payload.data[0];assert.equal(calls,1);assert.equal(classifyProcedure(read).code,'COD');assert.equal(read.consists_of[0].activity_id,work.consists_of[0].activity_id);
  index.putSource(generation,'/procedures/'+id,'procedure',work,fetchedAt,[]);
  assert.equal((await service.record('/procedures/'+id)).payload.data[0].label,work.label);assert.equal(calls,1);
  index.putSource(generation,'/procedures/'+id,'procedure',projectProcedure(work),fetchedAt,[]);
  assert.equal((await service.record('/procedures/'+id)).payload.data[0].consists_of[0].activity_id,work.consists_of[0].activity_id);assert.equal(calls,1);
});
test('cloud and member page walks restart when selected members change without silently skipping a speech',async t=>{
  const {store,index,add}=fixture(t);for(let n=1;n<=51;n++)add(activity(n));
  const query=speechCloudQuery(new URLSearchParams('member=42&days=term'),{now:now()}),cloud=new SpeechCloudInsights(index,{clock:now});
  assert.equal((await cloud.query(query)).coverage.transcripts,50);
  store.putSpeechMetadata(activity(1,{member:'7'}),url,'2026-10-17T11:00:00Z');
  const reset=await cloud.query({...query,page:1});assert.equal(reset.restarted,true);assert.equal(reset.coverage.transcripts,50);assert.equal(reset.nextPage,null);assert(!reset.speeches.some(row=>row.id===activity(1).activity_id));assert(reset.speeches.some(row=>row.id===activity(51).activity_id));
  const stats=new SpeechInterventions({clock:now,identities:null});store.putSpeechMetadata(activity(1),url,'2026-10-17T12:00:00Z');
  assert.equal((await stats.member('42')).coverage.available,50);
  store.putSpeechMetadata(activity(51,{member:'7'}),url,'2026-10-17T13:00:00Z');
  const next=await stats.member('42',1);assert.equal(next.restarted,true);assert.equal(next.coverage.available,50);assert(next.items.some(row=>row.id===activity(1).activity_id));assert(!next.items.some(row=>row.id===activity(51).activity_id));
});
test('selection revisions track relevant text changes without restarting for unrelated members',t=>{
  const {store,add}=fixture(t),id=add(activity(1));add(activity(2,{member:'7'}));
  const before=store.speechPage({member:'42',language:'en'});
  store.putSpeechMetadata(activity(2,{member:'7'}),url,'2026-10-17T12:00:00Z');
  assert.equal(store.speechPage({member:'42',language:'en',expectedRevision:before.revision}).changed,undefined);
  const updated=speechTexts(activity(1,{fragments:{en:xml.replace('Climate climate water.','Energy energy water.')}}),url,'2026-10-17T13:00:00Z');store.putDocument(updated.document,updated.texts);
  assert.deepEqual(store.speechPage({member:'42',language:'en',expectedRevision:before.revision}),{changed:true});
  assert.equal(store.speechData({sourceIds:[id],language:'en'}).records[0].text.body,'Energy energy water.');
});
test('availability updates refresh labels without restarting speech counts or word cloud pagination',async t=>{
  const {store,index,add}=fixture(t,{realReaders:false});
  for(let n=1;n<=121;n++)add(activity(n));
  const readCorpusPage=async params=>store.speechPage(params);
  const cloud=new SpeechCloudInsights(index,{clock:now,readCorpusPage});
  const stats=new SpeechInterventions({clock:now,identities:null,readCorpusPage});
  const query=speechCloudQuery(new URLSearchParams('member=42&days=term'),{now:now()});
  const revision=store.speechPage({member:'42',language:'en'}).revision;
  let previousCloud,previousStats;
  for(let page=0;page<3;page++) {
    // Both stores receive background progress; no selected speech changes.
    store.enqueue('background-'+page,'speeches',{start:'2026-09-01',end:'2026-09-30'},50);
    store.failTask(store.task('background-'+page),new Error('Source unavailable'));
    index.set('availabilityRevision',page+100);
    assert.equal(store.speechPage({member:'42',language:'en',expectedRevision:revision}).changed,undefined);
    const counted=await stats.member('42',page),words=await cloud.query({...query,page});
    const expected=Math.min(121,(page+1)*50);
    assert.equal(counted.restarted,false);assert.equal(words.restarted,undefined);
    assert.equal(counted.coverage.available,expected);assert.equal(words.coverage.transcripts,expected);
    assert.equal(counted.nextPage,page===2?null:page+1);assert.equal(words.nextPage,page===2?null:page+1);
    assert.deepEqual(words.availability,store.speechPage({member:'42',language:'en',to:query.end}).coverage.availability.text);
    assert.deepEqual(counted.availability,store.speechPage({member:'42',metadataOnly:true,kinds:['PLENARY_DEBATE_SPEECH','PLENARY_DEBATE_WRITTEN_STATEMENT']}).coverage.availability.metadataSources);
    if(previousCloud)assert.deepEqual(words.speeches.slice(0,previousCloud.speeches.length),previousCloud.speeches);
    if(previousStats)assert.deepEqual(counted.items.slice(0,previousStats.items.length),previousStats.items);
    previousCloud=structuredClone(words);previousStats=structuredClone(counted);
  }
  assert.equal(previousCloud.coverage.complete,false,'retained coverage stays partial');
  assert.equal(previousStats.coverage.complete,false);
  store.finishTask(store.task('background-0'));index.set('availabilityRevision',200);
  const refreshed=await cloud.query(query);
  assert.deepEqual(refreshed.availability,store.speechPage({member:'42',language:'en',to:query.end}).coverage.availability.text,'fresh visits refresh availability');
  assert.notDeepEqual(refreshed.availability,previousCloud.availability);
});
test('metadata, selection fields and revision roll back together when projection fails',t=>{
  const {store,add}=fixture(t),id=add(activity(1)),before=store.speechMetadata(id),page=store.speechPage({member:'42',metadataOnly:true}),project=store.projectSpeechCatalog.bind(store),revision=store.get('speechReadRevision');
  t.mock.method(store,'projectSpeechCatalog',(...args)=>{project(...args);throw new Error('projection failed after write');});
  assert.throws(()=>store.putSpeechMetadata(activity(1,{member:'7',kind:'PLENARY_DEBATE_WRITTEN_STATEMENT'}),url,'2026-10-17T12:00:00Z'),/projection failed/);
  assert.deepEqual(store.speechMetadata(id),before);assert.equal(store.get('speechReadRevision'),revision);assert.equal(store.speechPage({member:'42',metadataOnly:true}).revision,page.revision);
});
test('discovery repairs an existing selection row left behind newer metadata',async t=>{
  const {store,add}=fixture(t),id=add(activity(1)),old=store.db.prepare('SELECT * FROM speech_catalog WHERE source_id=?').get(id);
  store.putSpeechMetadata(activity(1,{member:'7',kind:'PLENARY_DEBATE_WRITTEN_STATEMENT'}),url,'2026-10-17T12:00:00Z');
  store.db.prepare('UPDATE speech_catalog SET kind=?,participants=?,revision=?,fetched_at=? WHERE source_id=?').run(old.kind,old.participants,old.revision,old.fetched_at,id);
  assert.equal(store.speechPage({member:'42'}),null);
  const worker=new CorpusWorker(store,{clock:now,fetchRecord:()=>{throw new Error('No source fetch');}});await worker.discover();
  assert.equal(store.speechPage({member:'42'}).total,0);assert.equal(store.speechPage({member:'7',kinds:['PLENARY_DEBATE_WRITTEN_STATEMENT'],metadataOnly:true}).records[0].metadata.activity.activity_id,id);
});
