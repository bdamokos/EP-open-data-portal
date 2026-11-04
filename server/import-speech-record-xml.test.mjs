import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker,wrapsMissingDataset} from './activity-index-worker.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {CorpusWorker} from './corpus-worker.mjs';
import {auditIndex} from './data-gap-audit.mjs';
import {interventionMetadata} from './speech-interventions.mjs';
import {acquireBothLeases,CORPUS_TABLES,importRecord,INDEX_TABLES,loadRecords,parentFromEvidence,parseSpeechXml,rehearseImport,rollbackRecord,runImport,snapshotQueries,speechActivity} from './import-speech-record-xml.mjs';
import {observeSpeechGap,scheduleWebsiteRechecks,WEBSITE_RECHECK_MS} from './speech-source-gaps.mjs';

// Synthetic records only: no captured speech text belongs in Git.
const day='2026-03-11',number='9000000002',id=`MTG-PL-${day}-OTH-${number}`,parent=`MTG-PL-${day}-PVCRE-ITM-7`;
const url=`https://www.europarl.europa.eu/doceo/document/CRE-10-${day}-INT-${number}_FR.xml`;
const retrievedAt='2026-11-04T08:51:12.000Z',started=Date.parse('2026-11-04T10:00:00Z');
const hit='eli/dl/event/'+id,today='2026-11-04';
const chairXml=({act=number,vl='FR',lg='FR',mep='30482',codict=mep,start=`${day}T21:30:08.345`,end=`${day}T21:30:23.175`,index='3-0563-0000',extra=''}={})=>`<SubItem.CHAPTER><NUMERO VL="${vl}" INDEX="${index}" ACT="${act}" PRE="9000000001" SUIV="9000000003"${start?` VOD-START="${start}" VOD-END="${end}"`:''}/><INTERVENTION><ORATEUR LIB="Le Président" PP="NULL" LG="${lg}" MEPID="${mep}" CODICT="${codict}"><LG>${lg}</LG><EMPHAS NAME="B">Le Président.</EMPHAS></ORATEUR><PARA> – Texte synthétique du président.</PARA>${extra}</INTERVENTION></SubItem.CHAPTER>`;
const writtenXml=`<SubItem.CHAPTER><NUMERO VL="RO" INDEX="3-0562-5000" ACT="${number}" PRE="9000000001" SUIV="9000000003"/><INTERVENTION><ORATEUR LIB="Ana | Exemplu" PP="S-D" LG="RO" MEPID="30482" CODICT="30482"><LG>RO</LG><EMPHAS NAME="B">Ana Exemplu (<PP>S&amp;D</PP>), </EMPHAS></ORATEUR><PARA><EMPHAS NAME="I">în scris</EMPHAS> – Primul paragraf sintetic.</PARA><PARA/><PARA>Al doilea paragraf sintetic.</PARA></INTERVENTION></SubItem.CHAPTER>`;
const neighbour=(n,num,debate=parent)=>({url:`https://data.europarl.europa.eu/api/v2/speeches/MTG-PL-${day}-OTH-${n}`,fetchedAt:retrievedAt,activity:{activity_id:`MTG-PL-${day}-OTH-${n}`,activity_date:day,activity_label:{en:'Synthetic debate',fr:'Débat synthétique'},inverse_consists_of:['eli/dl/event/'+debate],recorded_in_a_realization_of:[{is_part_of:`eli/dl/doc/CRE-10-${day}-ITM-007`,number:num}]}});
const evidence=(overrides={})=>({speeches:{[`MTG-PL-${day}-OTH-9000000001`]:neighbour('9000000001','3-0562-0000'),[`MTG-PL-${day}-OTH-9000000003`]:neighbour('9000000003','3-0564-0000'),...overrides},events:{[parent]:{url:'https://data.europarl.europa.eu/api/v2/events/'+parent,fetchedAt:retrievedAt,consists_of:[`eli/dl/event/MTG-PL-${day}-OTH-9000000001`,`eli/dl/event/MTG-PL-${day}-OTH-9000000003`,hit]}}});
const record=(xml=chairXml(),sourceUrl=url)=>{
  const bytes=Buffer.from(xml),sha256=createHash('sha256').update(bytes).digest('hex'),speech=parseSpeechXml(bytes,sourceUrl,{today}),placement=parentFromEvidence(speech,evidence());
  return {speech,placement,url:sourceUrl,retrievedAt,sha256,activity:speechActivity(speech,placement,{url:sourceUrl,retrievedAt,sha256})};
};
const apiActivity={id:hit,activity_id:id,activity_date:day,activity_label:{en:'From the API'},had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:{id:`eli/dl/participation/${id}_30482`,had_participant_person:['person/30482'],participation_role:'def/ep-roles/SPEAKER'},recorded_in_a_realization_of:[{id:`eli/dl/doc/CRE-10-${day}-OTH-${number}`,identifier:`CRE-10-${day}-OTH-${number}`,number:'3-0563-0000',notation_speechId:number,originalLanguage:['http://publications.europa.eu/resource/authority/language/FRA']}],inverse_consists_of:['eli/dl/event/'+parent]};
function fixture(t,{cycle=true}={}) {
  const root=mkdtempSync(path.join(os.tmpdir(),'speech-import-')),now={value:started},clock=()=>now.value;
  const indexDir=path.join(root,'index'),corpusDir=path.join(root,'corpus');
  const store=new ActivityStore(indexDir,{clock,initializeIndexes:true}),corpus=new CorpusStore(corpusDir,{clock,initializeIndexes:true});
  assert(store.acquire());assert(corpus.acquire());
  store.setMembers([{id:'30482'}]);
  let generation=store.beginCycle().generation;
  store.putSource(generation,'outside:roster:'+day,'outside-roster',{date:day,ids:['30482'],sources:[]},retrievedAt);
  if(!cycle){store.finalize(generation);generation=store.get('active');}
  const worker=new ActivityWorker(store,{clock,fetchRecord:async()=>{throw new Error('Unexpected upstream request.');}});
  t.after(()=>{for(const handle of [store,corpus])try{handle.close();}catch{/* Already closed. */}rmSync(root,{recursive:true,force:true});});
  return {root,indexDir,corpusDir,store,corpus,worker,generation,now};
}
const logged=t=>{const lines=t.mock.method(console,'log',()=>{});return ()=>lines.mock.calls.filter(call=>call.arguments[0]==='[speech-source-gap]').map(call=>JSON.parse(call.arguments[1]));};
const failure=(status,datasetMissing)=>Object.assign(new Error(`EP API returned ${status} at /speeches/${id}.`),{status,...(datasetMissing?{datasetMissing}:{})});
const catalogueTask=(store,generation)=>{store.enqueue(generation,'catalog:/speeches:test','speeches',{endpoint:'/speeches',params:{'sitting-date':day,'sitting-date-end':day},offset:0},100);return store.nextTask(generation);};
const missingHit=async()=>({payload:{data:[],searchResults:{hits:[{id:hit}]},meta:{total:1}},fetchedAt:retrievedAt,url:'https://data.europarl.europa.eu/api/v2/speeches'});

test('parsing checks exact identity, date, language, speaker and type',()=>{
  const parsed=parseSpeechXml(Buffer.from(chairXml()),url,{today});
  assert.deepEqual([parsed.id,parsed.language,parsed.mepId,parsed.name,parsed.kind,parsed.pre,parsed.suiv],[id,'fr','30482','Le Président','PLENARY_DEBATE_SPEECH','9000000001','9000000003']);
  assert.deepEqual(parsed.texts,['Texte synthétique du président.']);
  const written=parseSpeechXml(Buffer.from(writtenXml),url.replace('_FR','_RO'),{today});
  assert.deepEqual([written.kind,written.name,written.group,written.process,written.texts],['PLENARY_DEBATE_WRITTEN_STATEMENT','Ana Exemplu','S&D','în scris',['Primul paragraf sintetic.','Al doilea paragraf sintetic.']]);
  const refused=[
    [chairXml({act:'9000000009'}),url,/ACT 9000000009/],
    [chairXml({vl:'EN'}),url,/NUMERO language/],
    [chairXml({lg:'EN'}),url,/Speaker language/],
    [chairXml({codict:'1'}),url,/MEPID/],
    [chairXml({mep:'abc',codict:'abc'}),url,/MEPID/],
    [chairXml({start:'2026-03-12T21:30:08.345',end:'2026-03-12T21:30:23.175'}),url,/Recording times/],
    [chairXml({start:null}),url,/type is ambiguous/],
    [chairXml({index:'3-0563-5000'}),url,/type is ambiguous/],
    [chairXml({extra:'<SCRIPT/>'}),url,/Unknown XML element/],
    ['<!DOCTYPE x><SubItem.CHAPTER/>',url,/XML is invalid/],
    [chairXml(),url.replace('CRE-10','CRE-9'),/current term/],
    [chairXml(),url.replace('2026-03-11','2026-03-12').replace('CRE-10-2026-03-12-INT-'+number,'CRE-10-2099-03-12-INT-'+number),/current term/],
    [chairXml(),'https://example.org/CRE-10-2026-03-11-INT-9000000002_FR.xml',/individual verbatim-report/],
  ];
  for(const [xml,source,message] of refused)assert.throws(()=>parseSpeechXml(Buffer.from(xml),source,{today}),error=>error.code==='import_refused'&&message.test(error.message),String(message));
});

test('a parent needs both neighbours to name one debate and bracket the number',()=>{
  const speech=parseSpeechXml(Buffer.from(chairXml()),url,{today}),placed=parentFromEvidence(speech,evidence());
  assert.equal(placed.parent,parent);assert.equal(placed.listedByDebate,true);assert.equal(placed.sources.length,2);
  const next=`MTG-PL-${day}-OTH-9000000003`;
  assert.equal(parentFromEvidence(speech,{speeches:evidence().speeches}).listedByDebate,false);
  for(const [change,message] of [
    [{[next]:neighbour('9000000003','3-0564-0000',`MTG-PL-${day}-PVCRE-ITM-8`)},/name .*ITM-7 and .*ITM-8/],
    [{[next]:neighbour('9000000003','3-0500-0000')},/not numbered between/],
    [{[next]:{...neighbour('9000000003','3-0564-0000'),activity:{...neighbour('9000000003','3-0564-0000').activity,activity_label:{en:'Other'}}}},/different titles/],
    [{[next]:undefined},/no evidence for neighbour/],
  ])assert.throws(()=>parentFromEvidence(speech,evidence(change)),message);
});

test('an import reaches every reader, marks provenance and ends this speech\'s gaps',t=>{
  const {store,corpus,worker,generation}=fixture(t),lines=logged(t);
  store.enqueue(generation,'recovery:/speeches/'+id,'speeches',{recoveryId:id},103);
  store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,'recovery:/speeches/'+id,'speeches',JSON.stringify({recoveryId:id}),103,'EP API returned 500',316,retrievedAt,started+1000,null);
  store.db.prepare('INSERT INTO refresh_gap_admissions VALUES (?,?)').run(generation,'recovery:/speeches/'+id);
  corpus.enqueue('speech:'+id,'speech',{id},70);
  const unrelated=`recovery:/speeches/MTG-PL-${day}-OTH-1`;store.enqueue(generation,unrelated,'speeches',{recoveryId:`MTG-PL-${day}-OTH-1`},103);
  const report=importRecord({store,corpus,worker},record());
  assert.equal(report.outcome,'imported');
  const saved=store.source(generation,'/speeches/'+id);
  assert.deepEqual([saved.work.acquisition,saved.work.website.url,saved.work.website.retrievedAt,saved.work.website.fromApi,saved.work.kind,saved.fetchedAt],['website-xml',url,retrievedAt,false,'PLENARY_DEBATE_SPEECH',retrievedAt]);
  assert.deepEqual(saved.work.inverse_consists_of,['eli/dl/event/'+parent]);
  assert.deepEqual(saved.work.website.neighbours,{previous:`MTG-PL-${day}-OTH-9000000001`,next:`MTG-PL-${day}-OTH-9000000003`});
  const item=JSON.parse(store.db.prepare('SELECT body FROM items WHERE generation=? AND source_key=? AND mep=?').get(generation,'/speeches/'+id,'30482').body);
  assert.deepEqual([item.category,item.speechKind,item.provenance.acquisition,item.provenance.websiteSource,item.titles.fr],['plenary-contributions','PLENARY_DEBATE_SPEECH','website-xml',url,'Débat synthétique']);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps WHERE generation=?').get(generation).n,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gap_admissions WHERE generation=?').get(generation).n,0);
  assert.equal(store.db.prepare('SELECT done FROM tasks WHERE generation=? AND key=?').get(generation,'recovery:/speeches/'+id).done,1);
  assert.equal(store.db.prepare('SELECT done FROM tasks WHERE generation=? AND key=?').get(generation,unrelated).done,0);
  assert.equal(store.db.prepare('SELECT state FROM speech_source_gaps WHERE id=?').get(id).state,'held-website');
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM outside_contributions").get().n,0);
  assert.equal(corpus.task('speech:'+id).done,1);
  const transcript=corpus.speechTranscript({sourceId:id,language:'fr'});
  assert.deepEqual([transcript.available,transcript.textLanguage,transcript.translationType,transcript.sourceUrl,transcript.fetchedAt],[true,'fr','original',url,retrievedAt]);
  assert.match(transcript.xml,/Texte synthétique du président\./);
  assert.equal(corpus.db.prepare("SELECT json_extract(source_edition,'$.acquisition') a FROM texts").get().a,'website-xml');
  assert.equal(corpus.speechMetadata(id).summary.intervention.type,'chair');
  assert.equal(corpus.speechMetadata(id).activity.website.url,url);
  assert.equal(corpus.db.prepare("SELECT COUNT(*) n FROM texts_fts WHERE texts_fts MATCH 'synthetique'").get().n,1);
  assert.deepEqual({...corpus.db.prepare('SELECT kind,date FROM speech_catalog WHERE source_id=?').get(id)},{kind:'PLENARY_DEBATE_SPEECH',date:day});
  assert.equal(interventionMetadata(record().activity).parentIds[0],parent);
  assert.equal(lines().length,0,'importRecord leaves logging to the committed caller');
});

test('a written statement keeps its type, marker and group',t=>{
  const {store,corpus,worker,generation}=fixture(t);logged(t);
  const source=url.replace('_FR','_RO');
  importRecord({store,corpus,worker},record(writtenXml,source));
  assert.equal(store.source(generation,'/speeches/'+id).work.kind,'PLENARY_DEBATE_WRITTEN_STATEMENT');
  const metadata=corpus.speechMetadata(id);
  assert.deepEqual([metadata.summary.intervention.type,metadata.summary.intervention.speaker.id],['written','30482']);
  const {xml}=corpus.speechTranscript({sourceId:id,language:'ro'});
  assert.match(xml,/<writtenStatements>.*<person refersTo="epdata:person\/30482">Ana Exemplu<\/person> \(<organization>S&amp;D<\/organization>\), <process refersTo="">în scris<\/process>/s);
  assert.equal(corpus.db.prepare('SELECT body FROM texts').get().body,'Primul paragraf sintetic.\nAl doilea paragraf sintetic.');
});

test('a dry run reports exact row changes and leaves every table as it was',t=>{
  const {store,corpus,worker,generation}=fixture(t);logged(t);
  store.enqueue(generation,'recovery:/speeches/'+id,'speeches',{recoveryId:id},103);
  const counts=()=>[store.db.prepare('SELECT COUNT(*) n FROM sources').get().n,store.db.prepare('SELECT COUNT(*) n FROM items').get().n,store.db.prepare('SELECT COUNT(*) n FROM speech_source_gaps').get().n,store.db.prepare('SELECT done FROM tasks WHERE key=?').get('recovery:/speeches/'+id).done,corpus.db.prepare('SELECT COUNT(*) n FROM texts').get().n,corpus.db.prepare('SELECT COUNT(*) n FROM speech_metadata').get().n];
  const before=counts();
  const [report]=rehearseImport({store,corpus,worker},[record()]);
  assert.deepEqual(counts(),before);
  const changed=report.changes.map(change=>`${change.store}.${change.table}:${change.change}`).sort();
  assert.deepEqual(changed,['corpus.documents:insert','corpus.speech_catalog:insert','corpus.speech_metadata:insert','corpus.texts:insert','index.group_voice_observations:insert','index.items:insert','index.sources:insert','index.speech_source_gaps:insert','index.tasks:update'].sort());
  assert(!store.db.isTransaction&&!corpus.db.isTransaction);
});

test('importing twice changes nothing',t=>{
  const {store,corpus,worker}=fixture(t);logged(t);
  importRecord({store,corpus,worker},record());
  const revision=[store.get('availabilityRevision'),corpus.get('availabilityRevision')];
  const again=importRecord({store,corpus,worker},record());
  assert.deepEqual([again.outcome,again.changes],['unchanged',[]]);
  assert.deepEqual([store.get('availabilityRevision'),corpus.get('availabilityRevision')],revision);
});

test('an identity mismatch refuses the whole manifest before any write',t=>{
  const {root,store,corpus}=fixture(t);logged(t);
  const raw=path.join(root,'raw');mkdirSync(raw);writeFileSync(path.join(raw,'a.xml'),chairXml({act:'9000000009'}));
  const manifest=path.join(root,'manifest.json');
  const entry={file:'raw/a.xml',url,status:200,retrievedAt,sha256:createHash('sha256').update(chairXml({act:'9000000009'})).digest('hex')};
  writeFileSync(manifest,JSON.stringify({files:[entry]}));
  assert.throws(()=>loadRecords(manifest,evidence(),{today}),/ACT 9000000009/);
  writeFileSync(manifest,JSON.stringify({files:[{...entry,sha256:'0'.repeat(64)}]}));
  assert.throws(()=>loadRecords(manifest,evidence(),{today}),/manifest hash/);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM sources WHERE kind='speech'").get().n,0);
  assert.equal(corpus.db.prepare('SELECT COUNT(*) n FROM texts').get().n,0);
});

test('a speaker missing from the dated roster or a conflicting held neighbour refuses the record',t=>{
  const {store,corpus,worker,generation}=fixture(t);logged(t);
  store.putSource(generation,'/speeches/'+`MTG-PL-${day}-OTH-9000000003`,'speech',{id:`MTG-PL-${day}-OTH-9000000003`,inverse_consists_of:[`eli/dl/event/MTG-PL-${day}-PVCRE-ITM-99`]},retrievedAt);
  assert.throws(()=>importRecord({store,corpus,worker},record()),/held neighbour/);
  store.db.prepare('DELETE FROM sources WHERE key=?').run('/speeches/'+`MTG-PL-${day}-OTH-9000000003`);
  store.putSource(generation,'outside:roster:'+day,'outside-roster',{date:day,ids:['1'],sources:[]},retrievedAt);
  assert.throws(()=>importRecord({store,corpus,worker},record()),/dated roster/);
  assert.equal(store.source(generation,'/speeches/'+id),undefined);
  assert.equal(corpus.db.prepare('SELECT COUNT(*) n FROM documents').get().n,0);
});

test('both the serving and working generations receive the record, and it survives rotation',t=>{
  const {store,corpus,worker,generation}=fixture(t,{cycle:false});logged(t);
  const working=store.beginCycle().generation;assert.notEqual(working,generation);
  importRecord({store,corpus,worker},record());
  for(const value of [generation,working])assert.equal(store.source(value,'/speeches/'+id).work.acquisition,'website-xml');
  store.finalize(working);assert.equal(store.get('active'),working);
  const next=store.beginCycle().generation;assert.notEqual(next,working);
  const copied=store.source(next,'/speeches/'+id);
  assert.deepEqual([copied.work.acquisition,copied.work.website.url,copied.fetchedAt],['website-xml',url,retrievedAt]);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=? AND source_key=?').get(next,'/speeches/'+id).n,1);
  store.finalize(next);
  assert.equal(store.source(store.get('active'),'/speeches/'+id).work.acquisition,'website-xml');
  assert.equal(store.db.prepare('SELECT state FROM speech_source_gaps WHERE id=?').get(id).state,'held-website');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps').get().n,0);
});

test('a catalogue page naming a held hit neither queues recovery nor reopens the gap',async t=>{
  const {store,corpus,worker,generation}=fixture(t);logged(t);
  importRecord({store,corpus,worker},record());
  worker.fetchRecord=missingHit;
  await worker.task(catalogueTask(store,generation));
  const keys=store.db.prepare("SELECT key FROM tasks WHERE generation=? AND key LIKE '%"+number+"'").all(generation);
  assert.deepEqual(keys,[]);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps WHERE generation=?').get(generation).n,0);
  assert.equal(store.db.prepare('SELECT state FROM speech_source_gaps WHERE id=?').get(id).state,'held-website');
});

test('a recovery queued before the import ends without a request',async t=>{
  const {store,corpus,worker,generation}=fixture(t);logged(t);
  store.enqueue(generation,'recovery:/speeches/'+id,'speeches',{recoveryId:id,params:{},offset:0},103);
  const queued=store.nextTask(generation);
  importRecord({store,corpus,worker},record());
  store.db.prepare('UPDATE tasks SET done=0 WHERE generation=? AND key=?').run(generation,queued.key);
  await worker.task(queued);
  assert.equal(store.db.prepare('SELECT done FROM tasks WHERE generation=? AND key=?').get(generation,queued.key).done,1);
});

test('the corpus treats a held hit as answered and a later list node as the real record',async t=>{
  const {store,corpus,worker}=fixture(t);logged(t);
  importRecord({store,corpus,worker},record());
  const corpusWorker=new CorpusWorker(corpus,{clock:corpus.clock,runUpstream:operation=>operation(new AbortController().signal),fetchRecord:missingHit});
  corpus.enqueue('speeches:2026-03','speeches',{start:'2026-03-01',end:'2026-03-31',offset:0,limit:25},60);
  await corpusWorker.task(corpus.task('speeches:2026-03'));
  corpus.enqueue('speech-editions:2026-03','speech-editions',{start:'2026-03-01',end:'2026-03-31',offset:0,limit:25},60);
  await corpusWorker.task(corpus.task('speech-editions:2026-03'));
  assert.equal(corpus.task('speech:'+id),undefined);
  assert.equal(corpus.task('speech-metadata-detail:'+id),undefined);
  // The real record arrives with its node, and the fragment key differs from the import.
  const api={...apiActivity,recorded_in_a_realization_of:[{...apiActivity.recorded_in_a_realization_of[0],'api:xmlFragment':{en:'<oralStatements><speech xml:lang="fr-t-en-mtec"><from xml:lang="fr-t-en-mtec"><person refersTo="epdata:person/30482">President</person>.</from><blockContainer><p>API text.</p></blockContainer></speech></oralStatements>',fr:'<oralStatements><speech xml:lang="fr"><from xml:lang="fr"><person refersTo="epdata:person/30482">Le Président</person>.</from><blockContainer><p>Texte API.</p></blockContainer></speech></oralStatements>'}}]};
  const later='2026-12-04T10:00:00.000Z';
  corpusWorker.fetchRecord=async()=>({payload:{data:[api],searchResults:{hits:[{id:hit}]}},fetchedAt:later});
  corpus.resetTask('speeches:2026-03',{start:'2026-03-01',end:'2026-03-31',offset:0,limit:25},60);
  await corpusWorker.task(corpus.task('speeches:2026-03'));
  assert.equal(corpus.websiteSpeechHeld(id),false);
  assert.deepEqual(corpus.db.prepare('SELECT source_key,body,source_edition FROM texts ORDER BY source_key').all().map(row=>({...row})),[{source_key:'en',body:'API text.',source_edition:null},{source_key:'fr',body:'Texte API.',source_edition:null}]);
  assert.equal(corpus.speechMetadata(id).activity.acquisition,undefined);
  assert.equal(corpus.speechMetadata(id).fetchedAt,later);
  assert.equal(corpus.db.prepare("SELECT COUNT(*) n FROM texts_fts WHERE texts_fts MATCH 'synthetique'").get().n,0);
});

test('a later API record replaces the import in the index, and a re-import then leaves it alone',async t=>{
  const {store,corpus,worker,generation}=fixture(t),lines=logged(t);
  importRecord({store,corpus,worker},record());
  worker.fetchRecord=async()=>({payload:{data:[apiActivity],searchResults:{hits:[{id:hit}]},meta:{total:1}},fetchedAt:'2026-12-04T10:00:00.000Z',url:'https://data.europarl.europa.eu/api/v2/speeches'});
  await worker.task(catalogueTask(store,generation));
  const saved=store.source(generation,'/speeches/'+id);
  assert.deepEqual([saved.work.acquisition,saved.work.website,saved.fetchedAt],[undefined,undefined,'2026-12-04T10:00:00.000Z']);
  assert.equal(saved.work.outside.source.url.includes('data.europarl.europa.eu'),true);
  const item=JSON.parse(store.db.prepare('SELECT body FROM items WHERE generation=? AND source_key=?').get(generation,'/speeches/'+id).body);
  assert.deepEqual([item.titles.en,item.provenance.acquisition],['From the API',undefined]);
  assert.deepEqual(lines().map(line=>[line.state,line.previous]),[['resolved','held-website']]);
  const again=importRecord({store,corpus,worker},record());
  assert.equal(again.outcome,'api-record-held');
  assert.equal(store.source(generation,'/speeches/'+id).work.website,undefined);
});

test('the slow recheck opens no gap on failure and lets a real record win',async t=>{
  const {store,corpus,worker,generation,now}=fixture(t);logged(t);
  importRecord({store,corpus,worker},record());
  assert.equal(scheduleWebsiteRechecks(store,generation),0);
  store.release();now.value+=WEBSITE_RECHECK_MS+1;assert(store.acquire());
  assert.equal(scheduleWebsiteRechecks(store,generation),1);
  assert.equal(scheduleWebsiteRechecks(store,generation),0,'one check a month');
  worker.fetchRecord=async()=>{throw failure(500,true);};
  await worker.task(store.nextTask(generation));
  const key='website-recheck:/speeches/'+id;
  assert.equal(store.db.prepare('SELECT done FROM tasks WHERE generation=? AND key=?').get(generation,key).done,1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps WHERE generation=?').get(generation).n,0);
  assert.equal(store.db.prepare('SELECT http_status FROM speech_source_gaps WHERE id=?').get(id).http_status,500);
  assert.equal(store.source(generation,'/speeches/'+id).work.acquisition,'website-xml');
  store.release();now.value+=WEBSITE_RECHECK_MS+1;assert(store.acquire());
  assert.equal(scheduleWebsiteRechecks(store,generation),1);
  worker.fetchRecord=async()=>({payload:{data:[apiActivity]},fetchedAt:'2027-01-04T10:00:00.000Z',url:'https://data.europarl.europa.eu/api/v2/speeches/'+id});
  await worker.task(store.nextTask(generation));
  assert.equal(store.source(generation,'/speeches/'+id).work.acquisition,undefined);
  assert.equal(store.db.prepare('SELECT state FROM speech_source_gaps WHERE id=?').get(id).state,'resolved');
  assert.equal(scheduleWebsiteRechecks(store,generation),0);
});

test('the gap log changes once per state, not per retry',async t=>{
  const {store,worker,generation}=fixture(t),lines=logged(t);
  worker.fetchRecord=missingHit;
  await worker.task(catalogueTask(store,generation));
  store.db.prepare('UPDATE tasks SET done=0,body=? WHERE key=?').run(JSON.stringify({endpoint:'/speeches',params:{'sitting-date':day,'sitting-date-end':day},offset:0}),'catalog:/speeches:test');
  await worker.task(store.nextTask(generation)).catch(()=>{});
  assert.deepEqual(lines().map(line=>line.state),['missing-hit'],'a repeated page does not log again');
  const recovery=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,'recovery:/speeches/'+id);
  const task={...recovery,body:JSON.parse(recovery.body)};
  worker.fetchRecord=async()=>{throw failure(500,true);};
  for(let i=0;i<3;i++)await assert.rejects(worker.task(task),/returned 500/);
  worker.fetchRecord=async()=>{throw failure(429);};
  await assert.rejects(worker.task(task),/returned 429/);
  const [first,second]=lines();
  assert.equal(lines().length,2);
  assert.deepEqual([second.id,second.state,second.previous,second.sittingDate,second.httpStatus],[id,'detail-failed','missing-hit',day,500]);
  assert.deepEqual(first.searchWindow,{start:day,end:day,offset:0});
  assert.deepEqual(second.searchWindow,{start:day,end:day,offset:0});
  assert(second.firstSeen&&second.lastSeen);
  const row=store.db.prepare('SELECT state,http_status FROM speech_source_gaps WHERE id=?').get(id);
  assert.deepEqual({...row},{state:'detail-failed',http_status:429},'a throttled retry refreshes the row without a state change');
  worker.fetchRecord=async()=>({payload:{data:[apiActivity]},fetchedAt:'2026-11-05T10:00:00.000Z',url:'https://data.europarl.europa.eu/api/v2/speeches/'+id});
  await worker.task(task);
  assert.equal(lines().at(-1).state,'resolved');assert.equal(lines().length,3);
  // An ordinary speech without an open record writes nothing here.
  assert.equal(observeSpeechGap(store,{id:`MTG-PL-${day}-OTH-1`,state:'resolved'}),null);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM speech_source_gaps').get().n,1);
});

test('only a 500 that wraps a backend dataset 404 is treated as a missing record',async()=>{
  const body='{"status":500,"message":"[x] Dataset Resource batch /api/v2/evts//{speech-id=[A]} failed: 404 Not Found from POST https://admin.example/"}';
  assert.equal(await wrapsMissingDataset(new Response(body)),true);
  assert.equal(await wrapsMissingDataset(new Response('{"status":500,"message":"Internal error"}')),false);
  assert.equal(await wrapsMissingDataset(new Response('{"message":"Dataset Resource batch failed: 503"}')),false);
  assert.equal(await wrapsMissingDataset(new Response('x'.repeat(100_000))),false);
});

test('the data-gap audit lists open and held IDs',t=>{
  const {store,corpus,worker}=fixture(t);logged(t);
  observeSpeechGap(store,{id:`MTG-PL-${day}-OTH-5`,state:'missing-hit',searchWindow:{start:day,end:day,offset:0}},{log:false});
  observeSpeechGap(store,{id:`MTG-PL-${day}-OTH-5`,state:'detail-failed',status:500},{log:false});
  importRecord({store,corpus,worker},record());
  const audit=auditIndex(store.db,started).speechSourceGaps;
  assert.deepEqual([audit.state,audit.count,audit.missingFromApi,audit.heldFromWebsite,audit.resolved],['observed',2,1,1,0]);
  assert.deepEqual(audit.records.map(row=>[row.id,row.state,row.httpStatus]),[[`MTG-PL-${day}-OTH-5`,'detail-failed',500],[id,'held-website',null]]);
});

test('a dry run retains no lease row, no table and no record, even on an index the writer has not prepared',t=>{
  const {corpusDir,store,corpus,worker}=fixture(t);logged(t);
  store.db.exec('DROP TABLE speech_source_gaps');
  store.release();corpus.release();
  const reader=(handle,sql)=>handle.db.prepare(sql).all().map(row=>({...row}));
  // A lease copied from the live store must not stop or be replaced by the rehearsal.
  const other=new CorpusStore(corpusDir,{clock:corpus.clock});t.after(()=>other.close());
  assert(other.acquire());
  const state=()=>[...[store,corpus].flatMap(handle=>[
    reader(handle,"SELECT type,name FROM sqlite_master ORDER BY type,name"),reader(handle,'SELECT * FROM lease'),reader(handle,"SELECT key,value FROM meta WHERE key NOT LIKE 'availabilityHistoryPrunedAt' ORDER BY key"),reader(handle,'SELECT COUNT(*) n FROM tasks'),
  ]),reader(store,'SELECT COUNT(*) n FROM sources'),reader(store,'SELECT COUNT(*) n FROM items'),reader(corpus,'SELECT COUNT(*) n FROM texts'),reader(corpus,'SELECT COUNT(*) n FROM speech_metadata')];
  const before=state();
  assert.deepEqual(before[1],[]);assert.equal(before[5].length,1);
  const [report]=rehearseImport({store,corpus,worker},[record()]);
  assert.equal(report.outcome,'imported');
  assert(report.changes.some(change=>change.table==='sources'&&change.change==='insert'));
  assert.deepEqual(state(),before);
  assert.equal(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='speech_source_gaps'").get(),undefined);
  assert(!store.db.isTransaction&&!corpus.db.isTransaction);
});

test('the row report reads every table through an index, scoped by generation',t=>{
  const {store,corpus,generation}=fixture(t);logged(t);
  const plan=(db,{sql,args})=>db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail);
  const queries=snapshotQueries(INDEX_TABLES,id,[generation,generation+1]);
  assert.equal(queries.filter(query=>query.table==='sources').length,2);
  for(const query of queries){const detail=plan(store.db,query);assert(!detail.some(line=>/^SCAN/.test(line)),query.table+': '+detail.join('; '));}
  for(const query of snapshotQueries(CORPUS_TABLES,id)){const detail=plan(corpus.db,query);assert(!detail.some(line=>/^SCAN/.test(line)),query.table+': '+detail.join('; '));}
});

test('rollback removes only imported rows',t=>{
  const {store,corpus,worker,generation}=fixture(t);logged(t);
  importRecord({store,corpus,worker},record());
  const report=rollbackRecord({store,corpus},id);
  assert(report.changes.length>0);
  assert.equal(store.source(generation,'/speeches/'+id),undefined);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE source_key=?').get('/speeches/'+id).n,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM speech_source_gaps').get().n,0);
  for(const table of ['texts','speech_metadata','speech_catalog','documents'])assert.equal(corpus.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0,table);
  assert.equal(corpus.db.prepare("SELECT COUNT(*) n FROM texts_fts WHERE texts_fts MATCH 'synthetique'").get().n,0);
  // A real record is never removed.
  worker.saveSpeech(generation,apiActivity,'2026-12-04T10:00:00.000Z');
  rollbackRecord({store,corpus},id);
  assert.equal(store.source(generation,'/speeches/'+id).work.kind,'PLENARY_DEBATE_SPEECH');
});

test('rollback keeps newer API metadata while removing the imported text',t=>{
  const {store,corpus,worker,generation}=fixture(t);logged(t);
  importRecord({store,corpus,worker},record());
  // A metadata-only API refresh arrives while the website text is still the only text.
  const later='2026-12-04T10:00:00.000Z',apiUrl='https://data.europarl.europa.eu/api/v2/speeches/'+id;
  corpus.putSpeechMetadata(apiActivity,apiUrl,later);
  assert.equal(corpus.websiteSpeechHeld(id),true);
  const report=rollbackRecord({store,corpus},id);
  assert.equal(corpus.websiteSpeechHeld(id),false);
  assert.equal(corpus.db.prepare('SELECT COUNT(*) n FROM texts').get().n,0);
  const metadata=corpus.speechMetadata(id);
  assert.deepEqual([metadata.activity.acquisition,metadata.sourceUrl,metadata.fetchedAt],[undefined,apiUrl,later]);
  assert.equal(corpus.db.prepare('SELECT COUNT(*) n FROM speech_catalog WHERE source_id=?').get(id).n,1);
  assert.equal(corpus.db.prepare('SELECT COUNT(*) n FROM documents WHERE source_id=?').get(id).n,1);
  assert(!report.changes.some(change=>['speech_metadata','speech_catalog','documents'].includes(change.table)));
  assert.equal(store.source(generation,'/speeches/'+id),undefined);
});

test('a real record found by the monthly re-read replaces the corpus text through the corpus writer',async t=>{
  const {store,corpus,worker,generation,now}=fixture(t);logged(t);
  corpus.indexFile=store.filename;
  corpus.enqueue('speech:'+id,'speech',{id},70);
  importRecord({store,corpus,worker},record());
  assert.equal(corpus.task('speech:'+id).done,1,'the import ends the failing read, which must not block the later handoff');
  const api={...apiActivity,recorded_in_a_realization_of:[{...apiActivity.recorded_in_a_realization_of[0],'api:xmlFragment':{fr:'<oralStatements><speech xml:lang="fr"><from xml:lang="fr"><person refersTo="epdata:person/30482">Le Président</person>.</from><blockContainer><p>Texte API.</p></blockContainer></speech></oralStatements>'}}]};
  let reads=0;
  const corpusWorker=new CorpusWorker(corpus,{clock:corpus.clock,runUpstream:operation=>operation(new AbortController().signal),fetchRecord:async endpoint=>{reads++;assert.equal(endpoint,'/speeches/'+id);return {payload:{data:[api]},fetchedAt:new Date(now.value).toISOString()};}});
  // Still held: nothing is handed over and nothing is read.
  corpusWorker.handOffResolvedSpeeches();
  assert.equal(corpus.task('speech:'+id).done,1);
  store.release();corpus.release();now.value+=WEBSITE_RECHECK_MS+1;assert(store.acquire());assert(corpus.acquire());
  assert.equal(scheduleWebsiteRechecks(store,generation),1);
  worker.fetchRecord=async()=>({payload:{data:[api]},fetchedAt:new Date(now.value).toISOString(),url:'https://data.europarl.europa.eu/api/v2/speeches/'+id});
  await worker.task(store.nextTask(generation));
  assert.equal(store.db.prepare('SELECT state FROM speech_source_gaps WHERE id=?').get(id).state,'resolved');
  assert.equal(corpus.websiteSpeechHeld(id),true,'the index writer never writes the corpus');
  now.value+=1000;
  await corpusWorker.discover();
  const task=corpus.task('speech:'+id);
  assert.equal(task.done,0);
  await corpusWorker.task(task);
  assert.equal(reads,1);
  assert.equal(corpus.websiteSpeechHeld(id),false);
  assert.deepEqual(corpus.db.prepare('SELECT source_key,body,source_url FROM texts').all().map(row=>({...row})),[{source_key:'fr',body:'Texte API.',source_url:'https://data.europarl.europa.eu/api/v2/speeches/'+id+'?include-output=xml_fragment&format=application%2Fld%2Bjson'}]);
  assert.equal(corpus.speechMetadata(id).activity.acquisition,undefined);
  assert.equal(corpus.db.prepare("SELECT COUNT(*) n FROM texts_fts WHERE texts_fts MATCH 'synthetique'").get().n,0);
  // The report is consumed: the record is no longer held, so no further read follows.
  corpusWorker.handOffResolvedSpeeches();
  assert.equal(corpus.task('speech:'+id).done,1);
});

test('waiting for the corpus lease leaves the index writer free',async t=>{
  const {indexDir,corpusDir,store,corpus}=fixture(t);logged(t);
  store.release();corpus.release();
  const importer=new ActivityStore(indexDir,{preparedOnly:true,clock:store.clock}),corpusImporter=new CorpusStore(corpusDir,{clock:corpus.clock});
  t.after(()=>{importer.close();corpusImporter.close();});
  assert(corpus.acquire());
  const waiting=acquireBothLeases(importer,corpusImporter,30,{pauseMs:5});
  await new Promise(resolve=>setTimeout(resolve,40));
  assert(store.acquire(),'the index writer takes its lease during the wait');
  store.release();
  corpus.release();
  await waiting;
  assert.equal(store.acquire(),false,'both leases are held once the wait ends');
  assert.equal(corpus.acquire(),false);
});

test('the command rehearses only on backup copies, then writes under both leases',async t=>{
  const {root,indexDir,corpusDir,store,corpus,generation}=fixture(t);logged(t);
  store.close();corpus.close();
  const raw=path.join(root,'raw');mkdirSync(raw);writeFileSync(path.join(raw,'a.xml'),chairXml());
  const manifest=path.join(root,'manifest.json'),evidenceFile=path.join(root,'evidence.json');
  writeFileSync(manifest,JSON.stringify({files:[{file:'raw/a.xml',url,status:200,retrievedAt,sha256:createHash('sha256').update(chairXml()).digest('hex')},{url:url.replace('_FR','_EN'),status:404}]}));
  writeFileSync(evidenceFile,JSON.stringify(evidence()));
  const output=[],options={manifest,evidence:evidenceFile,index:indexDir,corpus:corpusDir,waitSeconds:0,log:line=>output.push(line)};
  await assert.rejects(runImport({...options,dryRun:true}),/reads backup copies only/,'live databases are refused');
  const copies=path.join(root,'copies');mkdirSync(copies);
  const files=[[path.join(indexDir,'activities-v1.sqlite'),'activities-v1.sqlite'],[path.join(corpusDir,'corpus-v1.sqlite'),'corpus-v1.sqlite']].map(([from,name])=>{
    const copy=path.join(copies,name);copyFileSync(from,copy);
    // The live writer held its lease when the copy was taken.
    const db=new DatabaseSync(copy);db.prepare('INSERT OR REPLACE INTO lease VALUES (1,?,?)').run('live-writer',Date.now()+3_600_000);db.close();
    writeFileSync(copy+'.sha256','recorded\n');
    return copy;
  });
  const hashes=()=>files.map(file=>createHash('sha256').update(readFileSync(file)).digest('hex'));
  const before=hashes();
  const rehearsal=await runImport({...options,index:copies,corpus:copies,waitSeconds:0,dryRun:true});
  assert.equal(rehearsal[0].outcome,'imported');assert(rehearsal[0].changes.length>0);
  assert.deepEqual(hashes(),before,'a dry run leaves the backup copies byte-identical');
  const reopened=new ActivityStore(indexDir,{preparedOnly:true});t.after(()=>reopened.close());
  assert.equal(reopened.source(generation,'/speeches/'+id),undefined);
  const written=await runImport(options);
  assert.equal(written[0].outcome,'imported');assert.equal(reopened.source(generation,'/speeches/'+id).work.acquisition,'website-xml');
  assert(Number.isInteger(written[0].lockMs));
  assert.equal((await runImport(options))[0].outcome,'unchanged');
  assert.match(output.at(-1),/--rollback/);
  assert(reopened.acquire());
  await assert.rejects(runImport(options),/not both free/);
  reopened.release();
});
