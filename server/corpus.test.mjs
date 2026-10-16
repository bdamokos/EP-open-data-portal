import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { ActivityStore } from './activity-index-store.mjs';
import { CorpusStore, corpusQuery } from './corpus-store.mjs';
import { CorpusWorker, corpus, corpusSearchOptions, fragmentText, questionFiles, speechTexts } from './corpus-worker.mjs';
import { CorpusReader } from './corpus-reader.mjs';
import { server } from './index.mjs';

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
    assert.equal(s.corpus.search({query:'question text',kind:'question'}).total,1,'language variants count as one question');
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

test('language widening restarts partial historical months and clears complete coverage',async()=>{
  const s=stores(),id='MTG-PL-2024-07-17-OTH-1',offsets=[];
  const fetchRecord=async(endpoint,params)=>{
    if(params['sitting-date']!=='2024-07-01')return {payload:{data:[]},fetchedAt};
    offsets.push(params.offset);
    return {payload:{data:params.offset?[]:[speech(id,{en:fragment('en','Ocean policy.'),fr:fragment('fr','Océan politique.','fr-t-en-mtec')})]},fetchedAt};
  };
  try {
    const primary=new CorpusWorker(s.corpus,{clock:instant,languages:'primary'});primary.discover();
    const key='speeches:2024-07',task=s.corpus.task(key);
    s.corpus.taskProgress(task,{...task.body,offset:1,lastPage:id});
    s.corpus.set('backfilledAt',fetchedAt);
    const wide=new CorpusWorker(s.corpus,{fetchRecord,clock:instant,languages:'all',interval:0,budget:500,download:async()=>({paragraphs:['Text']})});
    wide.discover();
    assert.equal(s.corpus.task(key).body.offset,0);
    assert.equal(s.corpus.coverage().complete,false);
    assert.equal(s.corpus.coverage().phase,'backfilling');
    s.corpus.release();await wide.run();
    assert.deepEqual(offsets,[0,1]);
    assert.equal(s.corpus.search({query:'politique',language:'fr'}).total,1);
  } finally {s.cleanup();}
});

test('rechecking a missing graph node refreshes completed recovery but preserves pending retries',async()=>{
  const s=stores(),id='MTG-PL-2026-07-08-OTH-2';let revised=false;
  const worker=new CorpusWorker(s.corpus,{clock:instant,interval:0,fetchRecord:async endpoint=>endpoint==='/speeches'?
    {payload:{data:[],searchResults:{hits:[{id:'eli/dl/event/'+id}]}},fetchedAt}:
    {payload:{data:[speech(id,{en:fragment('en',revised?'Revised transcript.':'Earlier transcript.')})]},fetchedAt}});
  const month={key:'month',kind:'speeches',body:{start:'2026-07-01',end:'2026-07-31',offset:0,limit:25}};
  try {
    s.corpus.enqueue(month.key,month.kind,month.body,60);
    await worker.task(month);await worker.task(s.corpus.task('speech:'+id));
    revised=true;
    await worker.task(month);
    assert.equal(s.corpus.task('speech:'+id).done,0);
    await worker.task(s.corpus.task('speech:'+id));
    assert.equal(s.corpus.search({query:'revised'}).total,1);
    assert.equal(s.corpus.search({query:'earlier'}).total,0);
    s.corpus.reopen('speech:'+id,{id},61);
    s.corpus.failTask(s.corpus.task('speech:'+id),new Error('Upstream unavailable'));
    const retry=s.corpus.task('speech:'+id);
    await worker.task(month);
    assert.equal(s.corpus.task('speech:'+id).retry_at,retry.retry_at);
    assert.equal(s.corpus.task('speech:'+id).attempts,1);
  } finally {s.cleanup();}
});

test('pagination stops at the HTTP offset limit and reports truncated results',()=>{
  const s=stores();
  try {
    for(let n=1;n<=1022;n++)s.corpus.putDocument({sourceId:'DOC-'+n,kind:'question'},
      [{sourceKey:'en',language:'en',translationType:'original',sourceFormat:'docx',sourceUrl:'https://example.test/'+n,fetchedAt,body:'Ocean policy',raw:null}]);
    const page=s.corpus.search({query:'ocean',offset:1000,limit:20});
    assert.equal(page.total,1022);assert.equal(page.hits.length,20);
    assert.equal(page.nextOffset,null);assert.equal(page.truncated,true);
    assert.equal(s.corpus.search({query:'ocean',offset:980,limit:20}).nextOffset,1000);
  } finally {s.cleanup();}
});

test('read-only queries leave the API event loop free and enforce concurrency and deadlines',async()=>{
  const s=stores();
  try {
    s.corpus.putDocument(...Object.values(speechTexts(speech('MTG-PL-2026-07-08-OTH-1',{en:fragment('en','Ocean protection.')}),'https://example.test/list',fetchedAt)));
    const reader=new CorpusReader(path.dirname(s.corpus.filename),{indexFile:s.index.filename});
    const pending=reader.query('search',{query:'ocean',member:42});
    await assert.rejects(reader.query('search',{query:'ocean'}),error=>error.code==='corpus_busy');
    let ticked=false;setImmediate(()=>{ticked=true;});
    const result=await pending;
    assert.equal(ticked,true);assert.equal(result.hits[0].sourceId,'MTG-PL-2026-07-08-OTH-1');
    assert.deepEqual(result.hits[0].memberIds,[42]);
    assert.equal(result.coverage.complete,false);
    assert.equal((await reader.query('status',{})).documents.speech.withText,1);
    const timeout=new CorpusReader(path.dirname(s.corpus.filename),{timeoutMs:1});
    await assert.rejects(timeout.query('search',{query:'ocean'}),error=>error.code==='corpus_query_timeout');
    const readOnly=new CorpusStore(path.dirname(s.corpus.filename),{readOnly:true});
    try {assert.throws(()=>readOnly.set('changed',true),/readonly/i);}finally{readOnly.close();}
  } finally {s.cleanup();}
});

const putText=(store,sourceId,kind,date,sourceKey,body,extra={})=>store.putDocument({sourceId,kind,date,parentId:extra.parentId||null,term:10},
  [{sourceKey,language:extra.language||'en',translationType:extra.translationType||'original',sourceFormat:'docx',sourceUrl:docx(sourceId,sourceKey),fetchedAt,body,raw:null}]);

test('document and question groups paginate before variants and retain exact same-language provenance',()=>{
  const s=stores(),questionId=question.identifier,answerId=question.inverse_answers_to[0].identifier;
  try {
    putText(s.corpus,questionId,'question','2026-05-01','en','Ocean protection');
    putText(s.corpus,questionId,'question','2026-05-01','mul','Ocean protection',{translationType:'machine'});
    putText(s.corpus,questionId,'question','2026-05-01','fr','Ocean protection',{language:'fr'});
    putText(s.corpus,answerId,'answer','2026-06-01','en','Ocean protection',{parentId:questionId});
    putText(s.corpus,'OTHER-Q','question','2026-07-01','en','Ocean protection');
    const document=s.corpus.search({query:'ocean',sort:'newest',limit:1});
    assert.equal(document.total,3);assert.equal(document.results.length,1);assert.equal(document.nextOffset,1);
    assert.equal(document.results[0].sourceId,'OTHER-Q');
    const grouped=s.corpus.search({query:'ocean',kinds:['question','answer'],group:'question',sort:'newest',limit:1,offset:1});
    assert.equal(grouped.total,2);assert.equal(grouped.nextOffset,null);
    const result=grouped.results[0];
    assert.equal(result.sourceId,questionId);assert.equal(result.kind,'question');assert.equal(result.date,'2026-05-01');
    assert.equal(result.questionDate,'2026-05-01');assert.equal(result.answerDate,'2026-06-01');
    assert.equal(result.hits.length,4);assert.equal(result.hits.filter(hit=>hit.language==='en').length,3);
    const machine=result.hits.find(hit=>hit.sourceKey==='mul');
    assert.equal(machine.translationType,'machine');assert.match(machine.sha256,/^[a-f0-9]{64}$/);
    assert.equal(machine.sourceUrl,docx(questionId,'mul'));
    assert.deepEqual(s.corpus.search({query:'ocean',sourceIds:[]}).results,[]);
    assert.equal(s.corpus.search({query:'ocean',sourceIds:[questionId]}).total,1);
    assert.equal(s.corpus.search({query:'ocean',sourceIds:[questionId],group:'question'}).hits.some(hit=>hit.kind==='answer'),false,'a parent scope never silently broadens to answer documents');
    assert.equal(s.corpus.search({query:'ocean',kinds:[]}).total,0);
    const first=s.corpus.search({query:'ocean',group:'question',limit:1}),again=s.corpus.search({query:'ocean',group:'question',limit:1});
    assert.equal(first.results[0].sourceId,again.results[0].sourceId,'relevance ties are stable');
  } finally {s.cleanup();}
});

test('answer-only matches use their exact parent question date and saved title without upstream reads',()=>{
  const s=stores(),questionId=question.identifier,answerId=question.inverse_answers_to[0].identifier;
  try {
    const saved={...question,label:'E-000001/2026',title_dcterms:{en:'Ocean protection',fr:'Protection des océans'},inverse_answers_to:question.inverse_answers_to.map(answer=>({...answer,label:'E-000001/2026(ASW)'}))};
    s.index.db.prepare('UPDATE sources SET body=? WHERE key=?').run(JSON.stringify(saved),'/parliamentary-questions/'+questionId);
    s.index.db.prepare('INSERT INTO members VALUES (?,?)').run('43',JSON.stringify({id:'43',name:'Saved author',countryCode:'HU'}));
    putText(s.corpus,answerId,'answer','2026-06-01','en','Ocean protection',{parentId:questionId});
    const result=s.corpus.search({query:'ocean',kinds:['question','answer'],group:'question',from:'2026-05-01',to:'2026-05-31',country:'HU',uiLanguage:'fr'});
    assert.equal(result.total,1);assert.equal(result.results[0].date,'2026-05-01');
    assert.equal(result.results[0].questionDate,'2026-05-01');assert.equal(result.results[0].answerDate,'2026-06-01');
    assert.equal(result.results[0].title,'Protection des océans');assert.equal(result.results[0].reference,'E-000001/2026');
    const answer=s.corpus.search({query:'ocean',group:'document',uiLanguage:'fr'}).results[0];
    assert.equal(answer.title,'Protection des océans');assert.equal(answer.reference,'E-000001/2026(ASW)');
    putText(s.corpus,questionId,'question','2026-05-01','en','Ocean question');
    assert.equal(s.corpus.search({query:'ocean',kind:'question',uiLanguage:'fr'}).results[0].title,'Protection des océans','saved exact-ID title is used even without an author item');
    assert.deepEqual(result.results[0].people,[{id:43,name:'Saved author',role:'AUTHOR'}]);
    assert.equal(result.hits[0].people[0].role,'QUESTION_AUTHOR');
    assert.equal(s.corpus.search({query:'ocean',group:'question',from:'2026-06-01'}).total,0);
    assert.equal(s.corpus.search({query:'ocean',dateBasis:'document',from:'2026-06-01'}).total,1);
    assert.equal(s.corpus.search({query:'ocean',country:'IT'}).total,0);
    assert.equal(s.corpus.coverage().authoritativeComplete,false);
  } finally {s.cleanup();}
});

test('stored text reads exact keys, retains markup as text, and highlights with the search tokenizer',async()=>{
  const s=stores(),id=question.identifier;
  try {
    const body='Économie <script>alert("x")</script> & policy';
    putText(s.corpus,id,'question','2026-05-01','mul',body,{translationType:'machine'});
    putText(s.corpus,id,'question','2026-05-01','en','Another variant');
    const hit=s.corpus.search({query:'economie'}).hits[0];
    const reader=new CorpusReader(path.dirname(s.corpus.filename),{indexFile:s.index.filename});
    const text=await reader.query('text',{sourceId:id,sourceKey:hit.sourceKey,query:'economie'});
    assert.equal(text.body,body);assert.equal(text.sourceKey,'mul');assert.equal(text.language,'en');
    assert.equal(text.sha256,hit.sha256);assert.equal(text.sourceUrl,hit.sourceUrl);assert.equal(text.translationType,'machine');
    assert.equal(text.highlightedBody,'\u0002Économie\u0003 <script>alert("x")</script> & policy');
    assert.equal(s.corpus.text({sourceId:id,sourceKey:'missing'}),null);
    assert.equal(s.corpus.text({sourceId:'UNKNOWN',sourceKey:'mul'}),null);
    assert.equal(s.corpus.text({sourceId:id,sourceKey:'en',query:'economie'}).highlightedBody,'Another variant');
    assert.equal('highlightedBody' in s.corpus.text({sourceId:id,sourceKey:'mul'}),false);
    const longBody='Ocean '+'Ж'.repeat(1_400_000);
    putText(s.corpus,'LARGE-Q','question','2026-05-01','en',longBody);
    const long=s.corpus.text({sourceId:'LARGE-Q',sourceKey:'en',query:'ocean'});
    assert.equal(long.body,longBody);assert.equal('highlightedBody' in long,false);
    assert.deepEqual(long.highlightRanges,[{start:0,end:5}]);assert.equal(long.highlightsTruncated,false);
    putText(s.corpus,'MATCHES-Q','question','2026-05-01','en','😀 ocean policy ocean');
    const ranges=s.corpus.text({sourceId:'MATCHES-Q',sourceKey:'en',query:'ocean',highlightBytes:0,highlightRangeLimit:1});
    assert.deepEqual(ranges.highlightRanges,[{start:3,end:8}]);assert.equal(ranges.highlightsTruncated,true);
  } finally {s.cleanup();}
});

test('search options reject malformed and overlarge scopes without broadening an empty scope',()=>{
  assert.deepEqual(corpusSearchOptions({query:'ocean',sourceIds:[],kinds:['question','answer'],group:'question',country:'GR'}).sourceIds,[]);
  assert.equal(corpusSearchOptions({query:'ocean',country:'GR'}).country,'EL');
  assert.equal(corpusSearchOptions({query:'ocean',group:'question'}).dateBasis,'question');
  for(const input of [{query:'ocean',sourceIds:'ID'},{query:'ocean',sourceIds:['https://example.test']},{query:'ocean',sourceIds:Array(1001).fill('ID')},
    {query:'ocean',kinds:['speech','speech']},{query:'ocean',kind:'speech',kinds:['answer']},{query:'ocean',group:'other'},
    {query:'ocean',sort:'random'},{query:'ocean',dateBasis:'answer'},{query:'ocean',from:'2026-02-30'},{query:'ocean',from:'2026-06-01',to:'2026-05-01'},
    {query:'ocean',country:'UK'},{query:'ocean',member:'43'},{query:'ocean',limit:51},{query:'ocean',offset:1001},{query:'ocean',unsupported:true},null,[]]){
    assert.throws(()=>corpusSearchOptions(input),error=>error.status===400,JSON.stringify(input));
  }
});

test('HTTP search POST and exact text GET are bounded read-only routes with strict validation',async()=>{
  const s=stores(),id=question.identifier;
  const savedEnv=Object.fromEntries(['CORPUS_ENABLED','CORPUS_DIR','ACTIVITY_INDEX_DIR','ODP_CACHE_DIR'].map(key=>[key,process.env[key]]));
  putText(s.corpus,id,'question','2026-05-01','en','Ocean <b>policy</b>');
  const answerId=question.inverse_answers_to[0].identifier;
  putText(s.corpus,answerId,'answer','2026-06-01','en','Ocean institutional answer',{parentId:id});
  s.index.db.prepare('INSERT INTO members VALUES (?,?)').run('43',JSON.stringify({id:'43',name:'Saved author'}));
  const cache=path.join(s.dir,'cache');mkdirSync(cache);
  const url='https://data.europarl.europa.eu/api/v2/meps/show-current?limit=1000&offset=0&format=application%2Fld%2Bjson';
  writeFileSync(path.join(cache,createHash('sha256').update(url).digest('hex')+'.json'),JSON.stringify({url,fetchedAt:instant(),payload:{data:[{id:'person/43','api:country-of-representation':'HU'}]}}));
  Object.assign(process.env,{CORPUS_ENABLED:'true',CORPUS_DIR:path.dirname(s.corpus.filename),ACTIVITY_INDEX_DIR:path.dirname(s.index.filename),ODP_CACHE_DIR:cache});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/poc/corpus`;
  const post=body=>fetch(base+'/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    const response=await post({query:'ocean',sourceIds:[id],group:'question'});
    assert.equal(response.status,200);assert.equal((await response.json()).results[0].sourceId,id);
    const empty=await post({query:'ocean',sourceIds:[]});assert.equal((await empty.json()).total,0);
    const country=await post({query:'ocean',sourceIds:[answerId],country:'HU',group:'question'});assert.equal((await country.json()).total,1,'country uses existing exact cached roster metadata, without profile fetches');
    s.index.db.prepare('UPDATE members SET body=? WHERE id=?').run(JSON.stringify({id:'43',name:'Saved author',countryCode:'IT'}),'43');
    const staleCountry=await post({query:'ocean',sourceIds:[answerId],country:'IT',group:'question'});assert.equal((await staleCountry.json()).total,0,'known cached roster metadata takes precedence over a conflicting saved index country');
    const get=await fetch(base+'/search?q=ocean&kinds=question,answer&group=question&date-basis=question&sort=newest');
    assert.equal(get.status,200);assert.equal((await get.json()).total,1);
    const text=await fetch(base+'/text?source-id='+id+'&source-key=en&q=ocean');
    assert.equal(text.status,200);assert.equal((await text.json()).highlightedBody,'\u0002Ocean\u0003 <b>policy</b>');
    assert.equal((await fetch(base+'/text?source-id='+id+'&source-key=fr')).status,404);
    assert.equal((await fetch(base+'/text?source-id='+id)).status,400);
    assert.equal((await fetch(base+'/text?source-id='+id+'&source-key=en&source-key=fr')).status,400);
    assert.equal((await fetch(base+'/search?q=ocean&from=2026-02-30')).status,400);
    assert.equal((await fetch(base+'/search?q=ocean&q=policy')).status,400);
    assert.equal((await post({query:'ocean',sourceIds:['INVALID/ID']})).status,400);
    assert.equal((await fetch(base+'/search',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'})).status,400);
    assert.equal((await fetch(base+'/search',{method:'POST',body:'ocean'})).status,415);
    assert.equal((await fetch(base+'/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'ocean',padding:'x'.repeat(128*1024)})})).status,413);
    const chunks=(async function*(){yield 'x'.repeat(64*1024);yield 'x'.repeat(64*1024);yield 'x';})();
    assert.equal((await fetch(base+'/search',{method:'POST',headers:{'Content-Type':'application/json'},body:chunks,duplex:'half'})).status,413,'chunked requests enforce the same byte limit');
    assert.equal((await fetch(base+'/search',{method:'POST',headers:{'Origin':'https://other.test','Content-Type':'application/json'},body:'{"query":"ocean"}'})).status,403);
    assert.equal((await fetch(base+'/text?source-id='+id+'&source-key=en',{method:'POST'})).status,405);
    assert.match((await fetch(base+'/search',{method:'OPTIONS'})).headers.get('allow'),/POST/);
    assert.equal(s.corpus.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0,'HTTP reads schedule no corpus downloads');
    putText(s.corpus,'LARGE-Q','question','2026-05-01','en','Ocean '+'Ж'.repeat(1_400_000));
    const large=await fetch(base+'/text?source-id=LARGE-Q&source-key=en&q=ocean');
    assert.equal(large.status,200);assert.deepEqual((await large.json()).highlightRanges,[{start:0,end:5}]);
    putText(s.corpus,'OVERSIZED-Q','question','2026-05-01','en','Ocean '+'漢'.repeat(2*1024*1024-6));
    const oversized=await fetch(base+'/text?source-id=OVERSIZED-Q&source-key=en&q=ocean');
    assert.equal(oversized.status,413);assert.equal((await oversized.json()).error.code,'corpus_text_too_large','supported extraction can exceed a configured response budget, with an explicit reader-unavailable error');
  } finally {
    await new Promise(resolve=>server.close(resolve));
    corpus().store.close();
    for(const [key,value] of Object.entries(savedEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    s.cleanup();
  }
});
