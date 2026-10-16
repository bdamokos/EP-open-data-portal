import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityStore } from './activity-index-store.mjs';
import { CorpusStore, corpusQuery } from './corpus-store.mjs';
import { CorpusWorker, fragmentText, questionFiles, speechTexts } from './corpus-worker.mjs';

const instant=()=>Date.parse('2026-10-16T10:00:00Z');
const fetchedAt=new Date(instant()).toISOString();
const temp=()=>mkdtempSync(path.join(os.tmpdir(),'corpus-test-'));
const fragment=(lang,text,tag=lang)=>`<oralStatements xml:lang="${tag}"><intervention><from><person refersTo="person/42">Name</person></from><p>${text}</p><p>Second paragraph.</p></intervention></oralStatements>`;
const speech=(id,texts,original='ENG')=>({id:'eli/dl/event/'+id,activity_id:id,activity_date:id.slice(7,17),
  recorded_in_a_realization_of:[{id:'eli/dl/doc/CRE',originalLanguage:['http://publications.europa.eu/resource/authority/language/'+original],'api:xmlFragment':texts}]});
const docx=(id,language)=>`https://data.europarl.europa.eu/distribution/reds_iMaQp_Asw/${id}/${id}_${language}.docx`;
const manifestations=(id,languages)=>languages.map(language=>({language:'http://publications.europa.eu/resource/authority/language/'+{en:'ENG',fr:'FRA',de:'DEU'}[language],
  is_embodied_by:[{format:'http://publications.europa.eu/resource/authority/file-type/DOCX',byteSize:100,is_exemplified_by:docx(id,language).replace('https://data.europarl.europa.eu/','')}]}));
const question={id:'eli/dl/doc/E-10-2026-000001',identifier:'E-10-2026-000001',document_date:'2026-05-01',originalLanguage:['http://publications.europa.eu/resource/authority/language/FRA'],
  is_realized_by:manifestations('E-10-2026-000001',['fr','en','de']),
  inverse_answers_to:[{id:'eli/dl/doc/E-10-2026-000001-ASW',identifier:'E-10-2026-000001-ASW',document_date:'2026-06-01',originalLanguage:['http://publications.europa.eu/resource/authority/language/ENG'],is_realized_by:manifestations('E-10-2026-000001-ASW',['en','fr'])}]};

function stores() {
  const dir=temp(),index=new ActivityStore(path.join(dir,'index'),{clock:instant});
  index.db.exec(`INSERT INTO meta VALUES ('active','1');
    INSERT INTO items VALUES (1,'/speeches/MTG-PL-2026-07-08-OTH-1','MTG-PL-2026-07-08-OTH-1','42','plenary-contributions','2026-07-08','{}');
    INSERT INTO items VALUES (1,'/parliamentary-questions/E-10-2026-000001','E-10-2026-000001-ASW','43','written-questions','2026-06-01','{}');`);
  index.db.prepare("INSERT INTO sources VALUES (1,'/parliamentary-questions/E-10-2026-000001','document',?,?,1)").run(JSON.stringify(question),fetchedAt);
  const corpus=new CorpusStore(path.join(dir,'corpus'),{indexFile:index.filename,clock:instant});
  assert.equal(corpus.acquire(),true);
  return {dir,index,corpus,cleanup(){corpus.close();index.close();rmSync(dir,{recursive:true,force:true});}};
}

test('search input becomes quoted FTS strings, never operators or column filters',()=>{
  assert.equal(corpusQuery('climate "green deal"'),'"climate" "green deal"');
  assert.equal(corpusQuery('body:secret OR NEAR(a b) *'),'"body secret" "OR" "NEAR a" "b"');
  assert.equal(corpusQuery('   '),null);
  assert.equal(corpusQuery('x '.repeat(13)),null);
});

test('speech fragments keep exact keys, paragraph lines and declared or machine provenance',()=>{
  const activity=speech('MTG-PL-2026-07-08-OTH-1',{en:fragment('en','Climate policy matters.'),fr:fragment('fr','La politique climatique.','fr-t-en-mtec'),mul:fragment('de','Klimapolitik.','de')});
  const {document,texts}=speechTexts(activity,'https://example.test/list',fetchedAt);
  assert.deepEqual(document,{sourceId:'MTG-PL-2026-07-08-OTH-1',kind:'speech',date:'2026-07-08',term:10,originalLanguages:['en']});
  assert.deepEqual(texts.map(t=>[t.sourceKey,t.language,t.translationType]),[['en','en','original'],['fr','fr','machine'],['mul','de','unspecified']]);
  assert.equal(texts[0].body,'Climate policy matters.\nSecond paragraph.');
  assert.equal(fragmentText('<!DOCTYPE x><p>a</p>'),'');
});

test('unchanged text keeps its row, changed text replaces its FTS entry, raw XML round-trips',()=>{
  const s=stores();
  try {
    const put=text=>s.corpus.putDocument(...Object.values(speechTexts(speech('MTG-PL-2026-07-08-OTH-1',{en:fragment('en',text)}),'https://example.test/list',fetchedAt)));
    put('Fisheries quota debate.');
    const first=s.corpus.db.prepare('SELECT id FROM texts').get().id;
    put('Fisheries quota debate.');
    assert.equal(s.corpus.db.prepare('SELECT COUNT(*) AS n FROM texts').get().n,1);
    assert.equal(s.corpus.db.prepare('SELECT id FROM texts').get().id,first);
    assert.equal(s.corpus.search({query:'fisheries'}).total,1);
    put('Agriculture subsidies debate.');
    assert.equal(s.corpus.search({query:'fisheries'}).total,0);
    assert.equal(s.corpus.search({query:'agriculture'}).total,1);
    assert.match(s.corpus.raw('MTG-PL-2026-07-08-OTH-1','en'),/Agriculture subsidies/);
  } finally {s.cleanup();}
});

test('search joins members through exact index identifiers and filters kind, language and dates',()=>{
  const s=stores();
  try {
    s.corpus.putDocument(...Object.values(speechTexts(speech('MTG-PL-2026-07-08-OTH-1',{en:fragment('en','Ocean protection now.')}),'https://example.test/list',fetchedAt)));
    s.corpus.putDocument({sourceId:'E-10-2026-000001-ASW',kind:'answer',parentId:'E-10-2026-000001',date:'2026-06-01',term:10,originalLanguages:['en']},
      [{sourceKey:'en',language:'en',translationType:'original',sourceFormat:'docx',sourceUrl:docx('E-10-2026-000001-ASW','en'),fetchedAt,body:'The Commission supports ocean protection.',raw:null}]);
    const all=s.corpus.search({query:'ocean protection'});
    assert.equal(all.total,2);
    assert.deepEqual(all.hits.map(hit=>hit.memberIds).sort(),[[42],[43]]);
    assert.match(all.hits[0].snippet,/\u0002ocean\u0003/i);
    assert.deepEqual(s.corpus.search({query:'ocean',member:43}).hits.map(hit=>[hit.sourceId,hit.parentId]),[['E-10-2026-000001-ASW','E-10-2026-000001']]);
    assert.equal(s.corpus.search({query:'ocean',kind:'speech'}).hits[0].sourceId,'MTG-PL-2026-07-08-OTH-1');
    assert.equal(s.corpus.search({query:'ocean',language:'fr'}).total,0);
    assert.equal(s.corpus.search({query:'ocean',from:'2026-07-01'}).total,1);
  } finally {s.cleanup();}
});

test('question files follow the language policy, originals and English first',()=>{
  const all=questionFiles(question,'all');
  assert.deepEqual(all.map(f=>[f.sourceId,f.language,f.primary]),[
    ['E-10-2026-000001','fr',true],['E-10-2026-000001','en',true],['E-10-2026-000001','de',false],
    ['E-10-2026-000001-ASW','en',true],['E-10-2026-000001-ASW','fr',false]]);
  assert.equal(all.find(f=>f.kind==='answer').parentId,'E-10-2026-000001');
  assert.deepEqual(questionFiles(question,'primary').map(f=>f.language),['fr','en','en']);
});

test('worker pages speeches, halves oversized pages, recovers missing graph nodes and loads DOCX text',async()=>{
  const s=stores();
  const calls=[];
  const page=[speech('MTG-PL-2026-07-08-OTH-1',{en:fragment('en','Ocean protection now.'),fr:fragment('fr','Protection des océans.','fr-t-en-mtec')})];
  const fetchRecord=async(endpoint,params)=>{
    calls.push([endpoint,params.limit,params.offset]);
    if(endpoint==='/speeches/MTG-PL-2026-07-08-OTH-2')return {payload:{data:[speech('MTG-PL-2026-07-08-OTH-2',{en:fragment('en','Recovered detail.')})]},fetchedAt};
    if(params['sitting-date']!=='2026-07-01')return {payload:{data:[]},fetchedAt};
    if(params.limit===25)throw new Error('EP API response exceeded 12 MiB.');
    if(params.offset>0)return {payload:{data:[]},fetchedAt};
    return {payload:{data:page,searchResults:{hits:[{id:'eli/dl/event/MTG-PL-2026-07-08-OTH-1'},{id:'eli/dl/event/MTG-PL-2026-07-08-OTH-2'}]}},fetchedAt};
  };
  const downloads=[];
  const download=async url=>{downloads.push(url);return {paragraphs:['Question text','about '+url.slice(-7,-5)]};};
  const worker=new CorpusWorker(s.corpus,{fetchRecord,download,clock:instant,interval:0,budget:500,languages:'primary',diskLimit:1024**3});
  try {
    await worker.run();
    assert.ok(calls.some(([endpoint,limit])=>endpoint==='/speeches' && limit===12),'oversized page retried at half size');
    assert.equal(s.corpus.search({query:'recovered'}).hits[0].sourceId,'MTG-PL-2026-07-08-OTH-2');
    assert.equal(s.corpus.search({query:'protection',language:'fr'}).total,0,'primary policy skips machine translations');
    assert.deepEqual(downloads.sort(),[docx('E-10-2026-000001','en'),docx('E-10-2026-000001','fr'),docx('E-10-2026-000001-ASW','en')].sort());
    assert.equal(s.corpus.search({query:'question text',kind:'question'}).total,2);
    const status=s.corpus.status();
    assert.equal(status.complete,true);
    assert.equal(status.documents.answer.withText,1);
    assert.deepEqual(status.languages,{speeches:'primary',documents:'primary'});
  } finally {s.cleanup();}
});

test('worker pauses at its disk limit without fetching',async()=>{
  const s=stores();
  let fetched=0;
  const worker=new CorpusWorker(s.corpus,{fetchRecord:async()=>{fetched++;return {payload:{data:[]},fetchedAt};},clock:instant,interval:0,diskLimit:1});
  try {
    await worker.run();
    assert.equal(fetched,0);
    assert.equal(s.corpus.status().phase,'paused: disk limit reached');
    assert.equal(s.corpus.status().complete,false);
  } finally {s.cleanup();}
});

test('backfill is not complete until question files were discovered from the index',async()=>{
  const dir=temp(),corpus=new CorpusStore(dir,{clock:instant});
  const worker=new CorpusWorker(corpus,{fetchRecord:async()=>({payload:{data:[]},fetchedAt}),clock:instant,interval:0,diskLimit:1024**3});
  try {
    await worker.run();
    assert.equal(corpus.status().complete,false);
    assert.equal(corpus.status().phase,'waiting for activity index');
  } finally {corpus.close();rmSync(dir,{recursive:true,force:true});}
});

test('a partial initial index generation does not complete the backfill',async()=>{
  const s=stores();
  s.index.db.exec("DELETE FROM meta WHERE key='active'; INSERT INTO meta VALUES ('working','{\"generation\":1}')");
  const worker=new CorpusWorker(s.corpus,{fetchRecord:async()=>({payload:{data:[]},fetchedAt}),download:async()=>({paragraphs:['Text']}),clock:instant,interval:0,diskLimit:1024**3});
  try {
    await worker.run();
    assert.equal(s.corpus.status().documents.question.withText,1);
    assert.equal(s.corpus.coverage().complete,false);
    s.index.db.exec("UPDATE meta SET value='1' WHERE key='working'; INSERT INTO meta VALUES ('active','1')");
    await worker.run();
    assert.equal(s.corpus.coverage().complete,true);
  } finally {s.cleanup();}
});

test('same text from a replacement file updates its link without a new row',()=>{
  const s=stores();
  try {
    const put=url=>s.corpus.putDocument({sourceId:'E-10-2026-000001',kind:'question',date:'2026-05-01',term:10},
      [{sourceKey:'en',language:'en',translationType:'unspecified',sourceFormat:'docx',sourceUrl:url,fetchedAt,body:'Same text.',raw:null}]);
    put(docx('E-10-2026-000001','en'));put(docx('E-10-2026-000001-REV','en'));
    assert.equal(s.corpus.db.prepare('SELECT COUNT(*) AS n FROM texts').get().n,1);
    assert.equal(s.corpus.hasText(docx('E-10-2026-000001-REV','en')),true);
    assert.equal(s.corpus.search({query:'same'}).hits[0].sourceUrl,docx('E-10-2026-000001-REV','en'));
  } finally {s.cleanup();}
});

test('widening the language policy reopens every finished speech month',async()=>{
  const s=stores();
  const empty=async()=>({payload:{data:[]},fetchedAt});
  try {
    await new CorpusWorker(s.corpus,{fetchRecord:empty,download:async()=>({paragraphs:['Text']}),clock:instant,interval:0,languages:'primary',diskLimit:1024**3}).run();
    assert.equal(s.corpus.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='speeches' AND done=0").get().n,0);
    const wide=new CorpusWorker(s.corpus,{fetchRecord:empty,clock:instant,interval:0,languages:'all',diskLimit:1024**3});
    assert.equal(s.corpus.acquire(),true);wide.discover();
    assert.equal(s.corpus.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='speeches' AND done=0").get().n,s.corpus.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='speeches'").get().n);
    assert.ok(s.corpus.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='docx' AND done=0").get().n>0,'non-primary question files are queued');
  } finally {s.cleanup();}
});
