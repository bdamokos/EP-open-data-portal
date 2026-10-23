import {loopback} from './test-support/loopback.mjs';
import {unthrottledUpstream} from './test-support/upstream.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ActivityStore } from './activity-index-store.mjs';
import { CorpusStore, corpusQuery } from './corpus-store.mjs';
import { CorpusWorker, corpus, corpusSearchOptions, fragmentText, questionFiles, speechTexts } from './corpus-worker.mjs';
import { CorpusReader } from './corpus-reader.mjs';
import { handleRequest } from './index.mjs';
import { server } from './index.mjs';
import {readerTimeoutMs} from './test-support/corpus-reader.mjs';

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

function addQuestions(index,count=120) {

  for(let n=2;n<count+2;n++) {
    const id='E-10-2026-'+String(n).padStart(6,'0');
    index.putSource(1,'/parliamentary-questions/'+id,'document',{...question,id:'eli/dl/doc/'+id,identifier:id,is_realized_by:manifestations(id,['en','fr','de']),inverse_answers_to:[]},fetchedAt);
  }
}

function stores() {
  const dir=temp(),index=new ActivityStore(path.join(dir,'index'),{clock:instant});
  index.acquire();
  index.putSource(1,'/parliamentary-questions/E-10-2026-000001','document',question,fetchedAt);
  index.db.exec(`INSERT INTO meta VALUES ('active','1');
    INSERT INTO items VALUES (1,'/speeches/MTG-PL-2026-07-08-OTH-1','MTG-PL-2026-07-08-OTH-1','42','plenary-contributions','2026-07-08','{}');
    INSERT INTO items VALUES (1,'/parliamentary-questions/E-10-2026-000001','E-10-2026-000001-ASW','43','written-questions','2026-06-01','{}');`);
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

test('status counts documents once and reflects variant, task and character changes',()=>{
  const s=stores(),id='MTG-PL-2026-07-08-OTH-1';
  const put=(language,body)=>s.corpus.putDocument({sourceId:id,kind:'speech'},[{sourceKey:language,language,translationType:'original',sourceFormat:'docx',sourceUrl:'https://example.test/'+language,fetchedAt,body,raw:null}]);
  try {
    put('en','🌊 Ocean');put('fr','Océan');
    s.corpus.putDocument({sourceId:'E-10-2026-000002',kind:'question'},[]);
    s.corpus.enqueue('done','docx',{},50);s.corpus.finishTask(s.corpus.task('done'));
    s.corpus.enqueue('retry','docx',{},50);s.corpus.failTask(s.corpus.task('retry'),new Error('Synthetic retry'));
    const first=s.corpus.status();
    assert.deepEqual(first.documents.speech,{discovered:1,withText:1});
    assert.deepEqual(first.documents.question,{discovered:1,withText:0});
    assert.deepEqual(first.tasks.docx,{total:2,done:1,retrying:1});
    assert.equal(first.texts.find(text=>text.language==='en').characters,'🌊 Ocean'.length);
    assert.equal(first.lastError.key,'retry');
    put('en','Longer ocean policy');s.corpus.finishTask(s.corpus.task('retry'));
    const updated=s.corpus.status();
    assert.equal(updated.texts.find(text=>text.language==='en').characters,'Longer ocean policy'.length);
    assert.equal(updated.lastError,null);
    assert.deepEqual(updated.tasks.docx,{total:2,done:2,retrying:0});
    s.corpus.db.prepare('DELETE FROM documents WHERE source_id=?').run(id);
    const deleted=s.corpus.status();
    assert.deepEqual(deleted.documents.speech,{discovered:0,withText:0});
    assert.deepEqual(deleted.texts,[]);
  } finally {s.cleanup();}
});

test('opening a legacy corpus adds status indexes without changing retained data or retries',()=>{
  const dir=temp(),original=new CorpusStore(dir,{clock:instant});let upgraded,originalClosed=false;
  try {
    original.acquire();
    original.putDocument(...Object.values(speechTexts(speech('MTG-PL-2026-07-08-OTH-1',{en:fragment('en','Ocean policy.')}),'https://example.test/list',fetchedAt)));
    original.enqueue('retry','docx',{url:'https://example.test/file'},50);original.failTask(original.task('retry'),new Error('Synthetic retry'));
    original.db.exec('DROP INDEX text_status_metadata; DROP INDEX task_status_counts; DROP INDEX task_status_error');
    const rows=original.db.prepare('SELECT * FROM texts').all(),tasks=original.db.prepare('SELECT * FROM tasks').all();
    const before=original.status();original.close();originalClosed=true;
    upgraded=new CorpusStore(dir,{clock:instant});
    assert.equal(upgraded.get('schema'),1);
    assert.deepEqual(upgraded.db.prepare('SELECT * FROM texts').all(),rows);
    assert.deepEqual(upgraded.db.prepare('SELECT * FROM tasks').all(),tasks);
    const after=upgraded.status();
    for(const key of ['documents','texts','tasks','lastError','coverage'])assert.deepEqual(after[key],before[key]);
    assert.equal(upgraded.raw('MTG-PL-2026-07-08-OTH-1','en'),fragment('en','Ocean policy.'));
    assert.equal(upgraded.search({query:'ocean'}).total,1);
  } finally {if(upgraded)upgraded.close();else if(!originalClosed)original.close();rmSync(dir,{recursive:true,force:true});}
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
  const worker=new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,fetchRecord,download,clock:instant,interval:0,budget:500,languages:'primary',diskLimit:1024**3});
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
  const worker=new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,fetchRecord:async()=>{fetched++;return {payload:{data:[]},fetchedAt};},clock:instant,interval:0,diskLimit:1});
  try {
    await worker.run();
    assert.equal(fetched,0);
    assert.equal(s.corpus.status().phase,'paused: disk limit reached');
    assert.equal(s.corpus.status().complete,false);
  } finally {s.cleanup();}
});

test('backfill is not complete until question files were discovered from the index',async()=>{
  const dir=temp(),corpus=new CorpusStore(dir,{clock:instant});
  const worker=new CorpusWorker(corpus,{runUpstream:unthrottledUpstream,fetchRecord:async()=>({payload:{data:[]},fetchedAt}),clock:instant,interval:0,diskLimit:1024**3});
  try {
    await worker.run();
    assert.equal(corpus.status().complete,false);
    assert.equal(corpus.status().phase,'waiting for activity index');
  } finally {corpus.close();rmSync(dir,{recursive:true,force:true});}
});

test('a partial initial index generation does not complete the backfill',async()=>{
  const s=stores();
  s.index.db.exec("DELETE FROM meta WHERE key='active'; INSERT INTO meta VALUES ('working','{\"generation\":1}')");
  const worker=new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,fetchRecord:async()=>({payload:{data:[]},fetchedAt}),download:async()=>({paragraphs:['Text']}),clock:instant,interval:0,diskLimit:1024**3});
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
    await new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,fetchRecord:empty,download:async()=>({paragraphs:['Text']}),clock:instant,interval:0,languages:'primary',diskLimit:1024**3}).run();
    assert.equal(s.corpus.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='speeches' AND done=0").get().n,0);
    const wide=new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,fetchRecord:empty,clock:instant,interval:0,languages:'all',diskLimit:1024**3});
    assert.equal(s.corpus.acquire(),true);await wide.discover();
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
    const primary=new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,clock:instant,languages:'primary'});await primary.discover();
    const key='speeches:2024-07',task=s.corpus.task(key);
    s.corpus.taskProgress(task,{...task.body,offset:1,lastPage:id});
    s.corpus.set('backfilledAt',fetchedAt);
    const wide=new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,fetchRecord,clock:instant,languages:'all',interval:0,budget:500,download:async()=>({paragraphs:['Text']})});
    await wide.discover();
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
  const worker=new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,clock:instant,interval:0,fetchRecord:async endpoint=>endpoint==='/speeches'?
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

test('read-only queries leave the API event loop free and enforce concurrency and deadlines',async t=>{
  const s=stores();
  try {
    s.corpus.putDocument(...Object.values(speechTexts(speech('MTG-PL-2026-07-08-OTH-1',{en:fragment('en','Ocean protection.')}),'https://example.test/list',fetchedAt)));
    const reader=new CorpusReader(path.dirname(s.corpus.filename),{indexFile:s.index.filename,timeoutMs:readerTimeoutMs,statusTimeoutMs:readerTimeoutMs});
    const pending=reader.query('search',{query:'ocean',member:42});
    await assert.rejects(reader.query('search',{query:'ocean'}),error=>error.code==='corpus_busy');
    let ticked=false;setImmediate(()=>{ticked=true;});
    const result=await pending;
    assert.equal(ticked,true);assert.equal(result.hits[0].sourceId,'MTG-PL-2026-07-08-OTH-1');
    assert.deepEqual(result.hits[0].memberIds,[42]);
    assert.equal(result.coverage.complete,false);
    assert.equal((await reader.query('status',{})).documents.speech.withText,1);
    const timeout=new CorpusReader(path.dirname(s.corpus.filename),{timeoutMs:1});
    t.mock.timers.enable({apis:['setTimeout']});
    const timedOut=assert.rejects(timeout.query('search',{query:'ocean'}),error=>error.code==='corpus_query_timeout');
    t.mock.timers.tick(1);await timedOut;t.mock.timers.reset();
    const readOnly=new CorpusStore(path.dirname(s.corpus.filename),{readOnly:true});
    try {assert.throws(()=>readOnly.set('changed',true),/readonly/i);}finally{readOnly.close();}
  } finally {s.cleanup();}
});

test('status has its own bounded warm-up timeout and remains retryable',async t=>{
  const s=stores();
  t.mock.timers.enable({apis:['setTimeout']});
  try {
    // A longer search budget must not extend the default status budget.
    const reader=new CorpusReader(path.dirname(s.corpus.filename),{timeoutMs:readerTimeoutMs});
    let settled=false;
    const pending=assert.rejects(reader.query('status',{}),error=>{
      assert.equal(error.status,503);
      assert.equal(error.code,'corpus_status_timeout');
      assert.match(error.message,/warming up/);
      assert.match(error.message,/Coverage is unknown/);
      assert.doesNotMatch(error.message,/fewer words|narrower filters/);
      settled=true;return true;
    });
    t.mock.timers.tick(5000);await Promise.resolve();
    assert.equal(settled,false,'status gets longer than the search budget');
    await assert.rejects(reader.query('search',{query:'ocean'}),error=>error.code==='corpus_busy');
    t.mock.timers.tick(1500);await pending;
    assert.equal(reader.busy,true,'termination holds the concurrency slot until exit');
    t.mock.timers.reset();
    while(reader.busy)await new Promise(resolve=>setImmediate(resolve));
    reader.statusTimeoutMs=readerTimeoutMs;
    const status=await reader.query('status',{});
    assert.equal(status.documents.speech.withText,0,'a successful empty observation is still zero');
    assert.equal(status.authoritativeComplete,false);
  } finally {t.mock.timers.reset();s.cleanup();}
});

test('the actual health route responds during initial question-file discovery',loopback,async()=>{
  const s=stores();addQuestions(s.index);
  const worker=new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,clock:instant});
  let incompleteAtResponse=false;
  const server=http.createServer((request,response)=>{incompleteAtResponse=!s.corpus.get('discoveredAt');void handleRequest(request,response);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const response=fetch('http://127.0.0.1:'+server.address().port+'/api/healthz');
    const discovery=worker.discover();
    const health=await response;
    assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
    assert.equal(incompleteAtResponse,true,'health is served before discovery finishes');
    await discovery;
    assert.equal(s.corpus.get('discoveredAt'),fetchedAt);
    assert.equal(s.corpus.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='docx'").get().n,365);
    assert.equal(s.corpus.renew(),true,'the original writer retains its lease');
  } finally {await new Promise(resolve=>server.close(resolve));s.cleanup();}
});

test('speech ingestion serves the event loop between language parses and retains all source data',loopback,async()=>{
  const s=stores(),langs=['en','fr','de'];
  const data=Array.from({length:3},(_,n)=>speech('MTG-PL-2026-07-08-OTH-'+(n+1),Object.fromEntries(langs.map(lang=>[lang,fragment(lang,'Ocean '+('<w>policy</w> '.repeat(300)),lang==='en'?lang:lang+'-t-en-mtec')]))));
  const task={key:'page',kind:'speeches',body:{start:'2026-07-01',end:'2026-07-31',offset:0,limit:25}};
  const worker=new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,clock:instant,interval:0,fetchRecord:async()=>({payload:{data},fetchedAt})});
  let ticks=0,running=true;
  let offsetAtResponse=null;
  const server=http.createServer((request,response)=>{offsetAtResponse=s.corpus.task(task.key).body.offset;void handleRequest(request,response);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const heartbeat=()=>{if(running){ticks++;assert.equal(s.corpus.renew(),true);setImmediate(heartbeat);}};
  try {
    s.corpus.enqueue(task.key,task.kind,task.body,60);setImmediate(heartbeat);
    const health=fetch('http://127.0.0.1:'+server.address().port+'/api/healthz');
    await worker.task(task);running=false;
    const response=await health;
    assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
    assert.equal(offsetAtResponse,0,'health is served before the page advances');
    assert.ok(ticks>=data.length*langs.length,'heartbeats run throughout the page, including within speech extraction');
    assert.equal(s.corpus.task(task.key).body.offset,3);
    assert.equal(s.corpus.db.prepare('SELECT COUNT(*) AS n FROM texts').get().n,9);
    for(const activity of data)for(const expected of speechTexts(activity,'https://unused.test',fetchedAt).texts) {
      assert.equal(s.corpus.raw(activity.activity_id,expected.sourceKey),expected.raw);
      const actual=s.corpus.db.prepare('SELECT t.body,t.translation_type FROM texts t JOIN documents d ON d.id=t.document_id WHERE d.source_id=? AND t.source_key=?').get(activity.activity_id,expected.sourceKey);
      assert.equal(actual.body,expected.body);assert.equal(actual.translation_type,expected.translationType);
    }
  } finally {running=false;await new Promise(resolve=>server.close(resolve));s.cleanup();}
});

test('stopping discovery preserves queued work without claiming completion or fetching sources',async()=>{
  const s=stores();addQuestions(s.index);let fetched=0;
  const worker=new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,clock:instant,fetchRecord:async()=>{fetched++;throw new Error('No source fetch expected');}});
  try {
    s.corpus.release();setImmediate(()=>worker.stop());await worker.run();
    assert.equal(fetched,0);assert.equal(s.corpus.get('discoveredAt'),null);
    assert.equal(s.corpus.coverage().complete,false);
    const queued=s.corpus.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='docx'").get().n;
    assert.ok(queued>0 && queued<365);
    assert.equal(s.corpus.db.prepare('SELECT COUNT(*) AS n FROM lease').get().n,0);
    assert.equal(s.corpus.acquire(),true);
    await new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,clock:instant}).discover();
    assert.equal(s.corpus.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='docx'").get().n,365);
    assert.equal(s.corpus.get('discoveredAt'),fetchedAt);
  } finally {s.cleanup();}
});

test('discovery fences writes after a lease change during an event-loop yield',async()=>{
  const s=stores();addQuestions(s.index);let now=instant();s.corpus.clock=()=>now;
  const other=new CorpusStore(path.dirname(s.corpus.filename),{clock:()=>now});
  const worker=new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,clock:()=>now});
  let acquired=false;
  try {
    setImmediate(()=>{now+=90_001;acquired=other.acquire();});
    await assert.rejects(worker.discover(),/lease was lost/);
    assert.equal(acquired,true);assert.equal(s.corpus.get('discoveredAt'),null);
    assert.equal(s.corpus.get('documentLanguages'),null);
    other.assertWriter();
  } finally {other.close();s.cleanup();}
});

test('stopped speech ingestion resumes the saved page without duplicating committed texts',async()=>{
  const s=stores();
  const data=Array.from({length:3},(_,n)=>speech('MTG-PL-2026-07-08-OTH-'+(n+1),{en:fragment('en','Ocean policy.'),fr:fragment('fr','Ocean policy.','fr-t-en-mtec')}));
  const options={runUpstream:unthrottledUpstream,clock:instant,interval:0,budget:1,fetchRecord:async()=>({payload:{data},fetchedAt})};
  const worker=new CorpusWorker(s.corpus,options);
  const task={key:'page',kind:'speeches',body:{start:'2026-07-01',end:'2026-07-31',offset:0,limit:25}};
  let polling=true;
  const stopAfterCommit=()=>{
    if(!polling)return;
    if(s.corpus.db.prepare('SELECT COUNT(*) AS n FROM texts').get().n){worker.stop();return;}
    setImmediate(stopAfterCommit);
  };
  try {
    s.corpus.enqueue(task.key,task.kind,task.body,100);s.corpus.release();
    setImmediate(stopAfterCommit);await worker.run();polling=false;
    assert.equal(s.corpus.task(task.key).body.offset,0);
    assert.equal(s.corpus.db.prepare('SELECT COUNT(*) AS n FROM texts').get().n,2);
    const first=s.corpus.db.prepare('SELECT id,sha256 FROM texts ORDER BY id').all();
    await new CorpusWorker(s.corpus,options).run();
    assert.equal(s.corpus.task(task.key).body.offset,3);
    assert.equal(s.corpus.db.prepare('SELECT COUNT(*) AS n FROM texts').get().n,6);
    assert.deepEqual(s.corpus.db.prepare('SELECT id,sha256 FROM texts ORDER BY id LIMIT 2').all(),first);
    assert.equal(s.corpus.coverage().complete,false);
  } finally {polling=false;s.cleanup();}
});

test('oversized XML bodies are excluded while bounded fragments retain declared provenance',()=>{
  const xml='<oralStatements xml:lang="fr"><p>'+'x'.repeat(2*1024*1024)+'</p></oralStatements>';
  const result=speechTexts(speech('MTG-PL-2026-07-08-OTH-1',{fr:xml,en:fragment('en','Ocean policy.')}),'https://example.test/list',fetchedAt);
  assert.deepEqual(result.texts.map(text=>[text.sourceKey,text.translationType]),[['en','original']]);
  assert.deepEqual(result.document.originalLanguages,['en']);
});

test('oversized translations preserve inferred original provenance and primary-language ingestion',async()=>{
  const s=stores(),id='MTG-PL-2026-07-08-OTH-1';
  const activity=speech(id,{fr:fragment('fr','Politique océanique.'),en:fragment('en','x'.repeat(2*1024*1024),'fr-t-en-mtec')});
  activity.recorded_in_a_realization_of[0].originalLanguage=[];
  const expected=speechTexts(activity,'https://example.test/list',fetchedAt);
  assert.deepEqual(expected.texts.map(text=>[text.language,text.translationType]),[['fr','original']]);
  const task={key:'page',kind:'speeches',body:{start:'2026-07-01',end:'2026-07-31',offset:0,limit:25}};
  const worker=new CorpusWorker(s.corpus,{runUpstream:unthrottledUpstream,clock:instant,interval:0,languages:'primary',fetchRecord:async()=>({payload:{data:[activity]},fetchedAt})});
  try {
    s.corpus.enqueue(task.key,task.kind,task.body,60);await worker.task(task);
    assert.equal(s.corpus.task(task.key).body.offset,1);
    const texts=s.corpus.db.prepare('SELECT language,translation_type FROM texts').all();
    assert.deepEqual(texts.map(text=>[text.language,text.translation_type]),[['fr','original']]);
    assert.equal(s.corpus.raw(id,'fr'),expected.texts[0].raw);
  } finally {s.cleanup();}
});

test('metadata extraction ignores language-looking text in oversized comments and CDATA',()=>{
  const activity=speech('MTG-PL-2026-07-08-OTH-1',{
    fr:fragment('fr','Politique océanique.'),
    en:'<oralStatements xml:lang="en"><!-- <x xml:lang="fr-t-en-mtec"/> --><p><![CDATA[<x xml:lang="fr-t-en-mtec"/>]]>'+'x'.repeat(2*1024*1024)+'</p></oralStatements>',
  });
  activity.recorded_in_a_realization_of[0].originalLanguage=[];
  assert.deepEqual(speechTexts(activity,'https://example.test/list',fetchedAt).texts.map(text=>[text.language,text.translationType]),[['fr','unspecified']]);
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

test('one counted page preserves exact totals, scoped variants and empty or out-of-range results',()=>{
  const s=stores(),q1=question.identifier,a1=q1+'-ASW',q2='E-10-2026-000002',q3='E-10-2026-000003';
  try {
    s.index.db.exec('DELETE FROM items; DELETE FROM members;');
    for(const id of ['43','44'])s.index.db.prepare('INSERT INTO members VALUES (?,?)').run(id,JSON.stringify({id,name:'Saved author '+id}));
    const documents=[[q1,'question','2026-05-01',43,null],[a1,'answer','2026-06-01',44,q1],[q2,'question','2026-05-02',43,null],[q3,'question','2026-05-03',44,null]];
    for(const [id,kind,date,member,parentId] of documents){
      s.index.db.prepare('INSERT INTO items VALUES (1,?,?,?,?,?,?)').run('/parliamentary-questions/'+id,id,String(member),'written-questions',date,'{}');
      for(const language of id===q1?['en','fr']:id===q3?['fr']:['en'])putText(s.corpus,id,kind,date,language,'Ukraine water policy',{parentId,language});
    }
    const cases=[
      [{language:'en'},[a1,q2,q1]],
      [{language:'fr'},[q3,q1]],
      [{group:'question'},[q3,q2,q1]],
      [{group:'question',language:'en'},[q2,q1]],
      [{kind:'answer'},[a1]],
      [{member:44,group:'question'},[q3,q1]],
      [{member:44,language:'en'},[a1]],
      [{sourceIds:[a1],group:'question'},[q1]],
      [{sourceIds:[],group:'question'},[]],
      [{from:'2026-06-01',dateBasis:'document',group:'question'},[q1]],
      [{from:'2026-06-01',dateBasis:'question',group:'question'},[]],
      [{country:'IT',countryMemberIds:['44'],countryMetadataIds:['43','44'],group:'question'},[q3,q1]],
      [{country:'MT',countryMemberIds:[],countryMetadataIds:['43','44']},[]],
    ];
    for(const [scope,expected] of cases){
      const options={query:'Ukraine',sort:'newest',...scope},full=s.corpus.search(options),seen=[];
      assert.equal(full.total,expected.length,JSON.stringify(scope));
      assert.deepEqual(full.results.map(result=>result.sourceId),expected);
      let offset=0;
      do{
        const page=s.corpus.search({...options,limit:1,offset});
        assert.equal(page.total,expected.length);assert.equal(page.offset,offset);
        assert.deepEqual(page.hits,page.results.flatMap(result=>result.hits));
        seen.push(...page.results);offset=page.nextOffset;
      }while(offset!==null);
      assert.deepEqual(seen,full.results,'pagination retains every matching variant and its exact provenance');
      const beyond=s.corpus.search({...options,limit:1,offset:1000});
      assert.equal(beyond.total,expected.length);assert.deepEqual(beyond.results,[]);assert.deepEqual(beyond.hits,[]);
      assert.equal(beyond.nextOffset,null);assert.equal(beyond.truncated,false);
      for(const hit of full.hits){
        if(scope.language)assert.equal(hit.language,scope.language);
        if(scope.sourceIds)assert(scope.sourceIds.includes(hit.sourceId));
        if(scope.member)assert(hit.memberIds.includes(scope.member));
        assert.equal(hit.sha256,s.corpus.text({sourceId:hit.sourceId,sourceKey:hit.sourceKey}).sha256);
      }
    }
    const missing=s.corpus.search({query:'unmatched',group:'question',offset:3});
    assert.equal(missing.total,0);assert.deepEqual(missing.results,[]);assert.equal(missing.nextOffset,null);
  } finally {s.cleanup();}
});

test('language and kind filters traverse FTS matches before unbounded metadata rows',t=>{
  const s=stores();
  try {
    for(let n=0;n<30;n++)for(const language of ['en','fr','de']){
      const id='MTG-PL-2026-07-08-OTH-'+(n+1);
      putText(s.corpus,id,'speech','2026-07-08',language,n%3?'Ukraine policy':'Other policy',{language});
    }
    const prepare=s.corpus.db.prepare.bind(s.corpus.db),plans=[];
    t.mock.method(s.corpus.db,'prepare',sql=>{
      const statement=prepare(sql);
      if(!sql.includes('texts_fts MATCH'))return statement;
      return new Proxy(statement,{get(target,key){
        const value=Reflect.get(target,key);
        if(key==='all'||key==='get')return (...params)=>{plans.push({sql,rows:prepare('EXPLAIN QUERY PLAN '+sql).all(...params)});return value.call(target,...params);};
        return typeof value==='function'?value.bind(target):value;
      }});
    });
    const exactRequest={query:'Ukraine',kinds:['speech','question','answer'],language:'en',uiLanguage:'en',group:'document',dateBasis:'document',sort:'relevance',limit:20,offset:0};
    for(const scope of [{},{member:42},{kinds:['speech']},{kinds:['question','answer']},{from:'2026-01-01',to:'2026-12-31'}]){
      plans.length=0;
      s.corpus.search({...exactRequest,...scope});
      assert(plans.length>0);
      for(const plan of plans){
        const details=plan.rows.map(row=>row.detail),fts=details.findIndex(detail=>/\b(?:SCAN|SEARCH) texts_fts\b/.test(detail));
        if(!plan.sql.includes('snippet(texts_fts'))assert(details.some(detail=>/SEARCH texts USING COVERING INDEX text_language\b/.test(detail)),
          'language metadata must come from the covering index, without fetching wide text records:\n'+details.join('\n'));
        for(const table of ['t','d']){
          const metadata=details.findIndex(detail=>new RegExp('\\b(?:SCAN|SEARCH) '+table+'\\b').test(detail));
          assert(fts>=0&&metadata>fts,'FTS must drive the join, without one MATCH probe per language or document row:\n'+details.join('\n'));
        }
      }
    }
    t.diagnostic('Node '+process.versions.node+' / SQLite '+prepare('SELECT sqlite_version() AS version').get().version);
  } finally {s.cleanup();}
});

test('relevance pagination keeps score order and exact-ID tie breaks while sharing totals',()=>{
  const s=stores();
  try {
    const ids=['SCORE-Z','SCORE-A','SCORE-B'];
    putText(s.corpus,ids[0],'speech','2026-05-01','en','Ukraine Ukraine Ukraine');
    putText(s.corpus,ids[0],'speech','2026-05-01','fr','Ukraine '+'policy '.repeat(100),{language:'fr'});
    putText(s.corpus,ids[1],'speech','2026-05-01','en','Ukraine '+'policy '.repeat(30));
    putText(s.corpus,ids[2],'speech','2026-05-01','en','Ukraine '+'policy '.repeat(30));
    const full=s.corpus.search({query:'Ukraine',language:'en',sort:'relevance'});
    assert.deepEqual(full.results.map(result=>result.sourceId),ids);
    for(let offset=0;offset<ids.length;offset++){
      const page=s.corpus.search({query:'Ukraine',language:'en',sort:'relevance',limit:1,offset});
      assert.equal(page.total,3);assert.deepEqual(page.results,[full.results[offset]]);
      assert.equal(page.nextOffset,offset<2?offset+1:null);
    }
    const multilingual=s.corpus.search({query:'Ukraine',sort:'relevance'});
    assert.deepEqual(multilingual.results.map(result=>result.sourceId),ids,'the best matching variant determines each group score');
    assert.equal(multilingual.results[0].hits.length,2);
  } finally {s.cleanup();}
});

test('excerpt hydration probes only the exact matching variants of the selected page',t=>{
  const s=stores(),q1=question.identifier,a1=q1+'-ASW',q2='E-10-2026-000002';
  try {
    putText(s.corpus,q1,'question','2026-05-10','en','Ukraine Ukraine');
    putText(s.corpus,q1,'question','2026-05-10','fr','Ukraine '+'policy '.repeat(30),{language:'fr'});
    putText(s.corpus,q1,'question','2026-05-10','de','Other policy',{language:'de'});
    putText(s.corpus,a1,'answer','2026-06-01','en','Ukraine '+'policy '.repeat(10),{parentId:q1});
    putText(s.corpus,a1,'answer','2026-06-01','fr','Other policy',{parentId:q1,language:'fr'});
    putText(s.corpus,q2,'question','2026-05-01','en','Ukraine');
    const prepare=s.corpus.db.prepare.bind(s.corpus.db),hydrations=[];
    t.mock.method(s.corpus.db,'prepare',sql=>{
      const statement=prepare(sql);
      if(!sql.includes('snippet(texts_fts'))return statement;
      return new Proxy(statement,{get(target,key){
        const value=Reflect.get(target,key);
        if(key==='all')return (...params)=>{hydrations.push({params,plan:prepare('EXPLAIN QUERY PLAN '+sql).all(...params)});return value.call(target,...params);};
        return typeof value==='function'?value.bind(target):value;
      }});
    });
    const options={query:'Ukraine',kinds:['speech','question','answer'],group:'question',sort:'newest',limit:1};
    const textId=(sourceId,key)=>prepare('SELECT t.id FROM texts t JOIN documents d ON d.id=t.document_id WHERE d.source_id=? AND t.source_key=?').get(sourceId,key).id;
    const cases=[
      [{},[[q1,'en'],[q1,'fr'],[a1,'en']]],
      [{language:'en'},[[q1,'en'],[a1,'en']]],
      [{language:'fr'},[[q1,'fr']],1],
      [{offset:1},[[q2,'en']]],
      [{sourceIds:[a1]},[[a1,'en']],1],
      [{member:43},[[a1,'en']],1],
      [{group:'document'},[[a1,'en']],3],
    ];
    for(const [scope,expected,total=2] of cases){
      const result=s.corpus.search({...options,...scope}),hydration=hydrations.at(-1),selected=JSON.parse(hydration.params[0]);
      assert.equal(result.total,total);assert.equal(result.results.length,1);
      assert(Array.isArray(selected),'excerpt input must be the selected exact text rows');
      assert.deepEqual(selected.map(([id])=>id).sort((a,b)=>a-b),expected.map(([id,key])=>textId(id,key)).sort((a,b)=>a-b));
      assert(selected.every(([id,rank])=>Number.isSafeInteger(id)&&Number.isSafeInteger(rank)&&rank>=1));
      const ordered=prepare(`SELECT t.id FROM texts_fts JOIN texts t ON t.id=texts_fts.rowid JOIN documents d ON d.id=t.document_id
        WHERE texts_fts MATCH ? AND t.id IN (SELECT value FROM json_each(?)) ORDER BY texts_fts.rank,d.source_id,t.language,t.source_key`)
        .all(corpusQuery(options.query),JSON.stringify(selected.map(([id])=>id))).map(row=>row.id);
      assert.deepEqual(result.hits.map(hit=>textId(hit.sourceId,hit.sourceKey)),ordered,'integer score ranks retain native FTS relevance and exact ties within the selected group');
      const details=hydration.plan.map(row=>row.detail),selectedLoop=details.findIndex(detail=>/SCAN selected_hit\b/.test(detail)),ftsLoop=details.findIndex(detail=>/SCAN texts_fts\b/.test(detail));
      assert(selectedLoop>=0&&ftsLoop>selectedLoop,'selected variants must drive excerpt hydration:\n'+details.join('\n'));
      assert(/VIRTUAL TABLE INDEX.*=/.test(details[ftsLoop]),'excerpt MATCH must be constrained by each selected text rowid');
    }
    const before=hydrations.length;
    assert.equal(s.corpus.search({...options,query:'unmatched'}).total,0);
    assert.equal(s.corpus.search({...options,offset:1000}).total,2);
    assert.equal(hydrations.length,before,'empty pages do not start excerpt reads');
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
    const reader=new CorpusReader(path.dirname(s.corpus.filename),{indexFile:s.index.filename,timeoutMs:readerTimeoutMs});
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

test('HTTP search POST and exact text GET are bounded read-only routes with strict validation',loopback,async()=>{
  const s=stores(),id=question.identifier;
  const savedEnv=Object.fromEntries(['CORPUS_ENABLED','CORPUS_DIR','ACTIVITY_INDEX_DIR','ODP_CACHE_DIR'].map(key=>[key,process.env[key]]));
  putText(s.corpus,id,'question','2026-05-01','en','Ocean <b>policy</b>');
  const answerId=question.inverse_answers_to[0].identifier;
  putText(s.corpus,answerId,'answer','2026-06-01','en','Ocean institutional answer',{parentId:id});
  s.index.db.prepare('INSERT INTO members VALUES (?,?)').run('43',JSON.stringify({id:'43',name:'Saved author'}));
  const cache=path.join(s.dir,'cache');mkdirSync(cache);
  const url='https://data.europarl.europa.eu/api/v2/meps/show-current?limit=1000&offset=0&format=application%2Fld%2Bjson';
  s.index.db.prepare('INSERT INTO members VALUES (?,?)').run('44',JSON.stringify({id:'44',name:'Other saved author'}));
  const rosterFile=path.join(cache,createHash('sha256').update(url).digest('hex')+'.json');
  const roster=[{id:'person/43','api:country-of-representation':'HU'},{id:'person/44','api:country-of-representation':'IT'}];
  const saveRoster=data=>writeFileSync(rosterFile,JSON.stringify({url,fetchedAt:instant(),payload:{data}}));
  saveRoster(roster);
  Object.assign(process.env,{CORPUS_ENABLED:'true',CORPUS_DIR:path.dirname(s.corpus.filename),ACTIVITY_INDEX_DIR:path.dirname(s.index.filename),ODP_CACHE_DIR:cache});
  // fetch and the server share this event loop. After a synchronous fixture
  // write blocks it past the idle timeout, the server's overdue keep-alive
  // timer can close the socket fetch just reused, as a reset. Let the client own idle closes.
  const keepAliveTimeout=server.keepAliveTimeout;server.keepAliveTimeout=0;
  // The 5 s reader bound has its own test above; under parallel suite load the
  // multi-megabyte PFAS fixture below can exceed it on real CPU time.
  corpus().reader.timeoutMs=120_000;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/corpus`;
  const post=body=>fetch(base+'/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    const response=await post({query:'ocean',sourceIds:[id],group:'question'});
    assert.equal(response.status,200);assert.equal((await response.json()).results[0].sourceId,id);
    const empty=await post({query:'ocean',sourceIds:[]});assert.equal((await empty.json()).total,0);
    const country=await post({query:'ocean',sourceIds:[answerId],country:'HU',group:'question'});assert.equal((await country.json()).total,1,'country uses existing exact cached roster metadata, without profile fetches');
    for(const state of ['missing','malformed','partial','no-countries','empty','unconfigured']){
      saveRoster(roster);
      if(state==='missing')rmSync(rosterFile);
      if(state==='malformed')writeFileSync(rosterFile,'{broken');
      if(state==='partial')saveRoster(roster.slice(0,1));
      if(state==='no-countries')saveRoster(roster.map(({id})=>({id})));
      if(state==='empty')saveRoster([]);
      if(state==='unconfigured')delete process.env.ODP_CACHE_DIR;
      for(const response of [await post({query:'ocean',country:'IT'}),await fetch(base+'/search?q=ocean&country=IT')]){
        assert.equal(response.status,503,state);
        assert.equal((await response.json()).error.code,'corpus_country_metadata_unavailable',state);
      }
      const unfiltered=await post({query:'ocean'});assert.equal((await unfiltered.json()).total,2,state);
      const memberOnly=await post({query:'ocean',member:43});assert.equal((await memberOnly.json()).total,1,state);
      process.env.ODP_CACHE_DIR=cache;
    }
    saveRoster(roster);
    const genuineEmpty=await post({query:'ocean',country:'MT'});assert.equal(genuineEmpty.status,200);assert.equal((await genuineEmpty.json()).total,0);
    s.index.db.prepare('UPDATE members SET body=? WHERE id=?').run(JSON.stringify({id:'43',name:'Saved author',countryCode:'IT'}),'43');
    const staleCountry=await post({query:'ocean',sourceIds:[answerId],country:'IT',group:'question'});assert.equal((await staleCountry.json()).total,0,'known cached roster metadata takes precedence over a conflicting saved index country');
    s.index.db.prepare('UPDATE sources SET body=? WHERE generation=1 AND key=?').run(JSON.stringify({...question,workHadParticipation:[{participation_role:'def/ep-roles/ADDRESSEE',had_participant_organization:['org/COM']}]}),'/parliamentary-questions/'+id);
    for(const recipient of ['org/COM','org/CS','unavailable']) {
      const expected=recipient==='org/COM'?1:0;
      for(const response of [await post({query:'ocean',kinds:['question','answer'],group:'question',addressee:recipient}),await fetch(base+'/search?q=ocean&kinds=question,answer&group=question&addressee='+encodeURIComponent(recipient))]) {
        assert.equal(response.status,200);assert.equal((await response.json()).total,expected,'GET/POST recipient parity: '+recipient);
      }
    }
    for(const value of ['', 'COM', 'org/COM/', 'org/'+('A'.repeat(101))]) {
      assert.equal((await post({query:'ocean',addressee:value})).status,400);
      assert.equal((await fetch(base+'/search?q=ocean&addressee='+encodeURIComponent(value))).status,400);
    }
    for(const [raw,status] of [
      ['{"query":"ocean","group":"question","addressee":"org/CS","addressee":"org/COM"}',200],
      ['{"query":"ocean","group":"question","addressee":"org/COM","addressee":"bad"}',400],
      ['{"query":"ocean","group":"question","addressee":"org/CS","addre\\u0073see":"org/COM"}',200],
      ['{"query":"ocean","group":"question","addressee":"org/COM","addre\\u0073see":[]}',400],
    ]) {
      const response=await fetch(base+'/search',{method:'POST',headers:{'Content-Type':'application/json'},body:raw});assert.equal(response.status,status,'decoded last-key semantics');if(status===200)assert.equal((await response.json()).total,1);
    }
    assert.equal((await fetch(base+'/search?q=ocean&addressee=org%2FCOM&addressee=org%2FCS')).status,400);
    assert.equal((await fetch(base+'/search?addressee=org%2FCOM',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'ocean'})})).status,400,'POST recipient belongs in body only');
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
    // Ordinary all-language question/answer groups exceed 5 MiB when repeated
    // per-variant authors and legacy hits are retained. Keep complete groups.
    const languages='bg cs da de el en es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' ');
    const putMember=s.index.db.prepare('INSERT INTO members VALUES (?,?)'),putItem=s.index.db.prepare('INSERT INTO items VALUES (1,?,?,?,?,?,?)');
    for(let n=0;n<40;n++)putMember.run(String(100000+n),JSON.stringify({id:String(100000+n),name:'Alessandra Maria Fernández '+n}));
    const ids=[];
    for(let n=0;n<20;n++){
      const questionId='E-10-2026-'+String(100+n).padStart(6,'0');ids.push(questionId);
      for(const [sourceId,kind,parentId] of [[questionId,'question',null],[questionId+'-ASW','answer',questionId]]){
        s.corpus.putDocument({sourceId,kind,parentId,date:'2026-05-01'},languages.map(language=>({sourceKey:language,language,translationType:'original',sourceFormat:'docx',sourceUrl:docx(sourceId,language),fetchedAt,body:'PFAS contamination in drinking water and environmental protection.',raw:null})));
        for(let a=0;a<40;a++)putItem.run('/parliamentary-questions/'+questionId,sourceId,String(100000+a),'written-questions','2026-05-01','{}');
      }
    }
    const options={query:'PFAS',group:'question',limit:20};
    assert(Buffer.byteLength(JSON.stringify({...s.corpus.search(options),coverage:s.corpus.coverage()}))>5*1024*1024,'fixture reproduces the former generic 500 at the default response limit');
    for(const method of ['GET','POST']){
      const seen=[];let offset=0;
      do{
        const response=method==='POST'?await post({...options,offset}):await fetch(base+'/search?q=PFAS&group=question&limit=20&offset='+offset);
        assert.equal(response.status,200,method);
        const body=await response.text();assert(Buffer.byteLength(body)<=5*1024*1024);
        const page=JSON.parse(body);assert.equal(page.total,20);assert.equal(page.coverage.authoritativeComplete,false);
        assert.deepEqual(page.hits,page.results.flatMap(result=>result.hits));
        for(const result of page.results){assert.equal(result.hits.length,48);assert(result.hits.every(hit=>hit.people.length===40));}
        if(offset===0){assert.equal(page.responseLimited,true);assert(page.nextOffset>0&&page.nextOffset<20);}
        seen.push(...page.results.map(result=>result.sourceId));offset=page.nextOffset;
      }while(offset!==null);
      assert.deepEqual([...seen].sort(),ids);assert.equal(new Set(seen).size,20);
    }
    assert.equal(s.corpus.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0,'bounded pagination schedules no collection');
  } finally {
    await new Promise(resolve=>server.close(resolve));server.keepAliveTimeout=keepAliveTimeout;
    corpus().store.close();
    for(const [key,value] of Object.entries(savedEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    s.cleanup();
  }
});
