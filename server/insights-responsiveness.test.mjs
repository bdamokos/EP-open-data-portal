import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {analyzeQuestions,analyzeQuestionsAsync} from './insights-model.mjs';
import {cooperativeWork} from './cooperative-work.mjs';
import {QuestionInsights,insightQuery} from './insights-store.mjs';
import {createInsights} from './insights.mjs';

const titles=['Digital Services Act and platform transparency','Fishing quotas and marine safety in France','Regional broadband infrastructure and healthcare','Court of Justice and Åland Convention'];
const questions=count=>Array.from({length:count},(_,i)=>({id:'E-10-2026-'+String(i).padStart(6,'0'),date:'2026-10-01',kind:'QUESTION_WRITTEN',titles:i%11?{en:titles[i%titles.length]+' '+i,fr:'Titre fourni'}:{fr:'Titre fourni'},authors:[{id:String(1+i%10)}],answers:[],apiUrl:'https://data.europarl.europa.eu/api/v2/parliamentary-questions/E-10-2026-'+String(i).padStart(6,'0'),fetchedAt:'2026-10-02T10:00:00Z'}));

test('cooperative analysis preserves exact model output, languages, provenance and phrase coverage',async()=>{
  const input=questions(180),bodies=new Map([[input[1].id,{paragraphs:['The Nuclear Energy Programme and Digital Services Act.'],sourceUrl:'https://data.europarl.europa.eu/distribution/question.docx',fetchedAt:input[1].fetchedAt}]]);
  assert.deepEqual(await analyzeQuestionsAsync(input,{bodies}),analyzeQuestions(input,{bodies}));
});

test('maximum question window allows timers and other callbacks to run before analysis finishes',async()=>{
  let finished=false,turns=0,timerRan=false;
  const pulse=()=>{if(!finished){turns++;setImmediate(pulse);}};
  setImmediate(pulse);
  const timer=setTimeout(()=>{timerRan=!finished;},0);
  try {
    const result=await analyzeQuestionsAsync(questions(5000));
    assert.equal(result.questions.length,5000);
    assert(turns>1,'analysis must return control repeatedly during a full window');
    assert(timerRan,'HTTP deadlines and writer heartbeats must run during analysis');
  }finally{finished=true;clearTimeout(timer);}
});

test('analysis stops at the next slice when its owner aborts, with the original reason',async()=>{
  const controller=new AbortController(),reason=Object.assign(new Error('Owner deadline'),{code:'request_timeout'});
  setImmediate(()=>controller.abort(reason));
  await assert.rejects(analyzeQuestionsAsync(questions(5000),{signal:controller.signal}),error=>error===reason);
});

test('cancelled cooperative work closes the iterator before consuming further steps',async()=>{
  const controller=new AbortController(),reason=new Error('Closed'),events=[];
  function* work(){try{events.push('first');yield;events.push('unstarted');yield;}finally{events.push('closed');}}
  const job=cooperativeWork(work(),{signal:controller.signal,sliceMs:0});
  controller.abort(reason);
  await assert.rejects(job,error=>error===reason);
  assert.deepEqual(events,['first','closed']);
  await yieldTurn();
});

function savedStore() {
  const work={id:'eli/dl/doc/E-10-2026-000001',identifier:'E-10-2026-000001',document_date:'2026-10-01',work_type:'def/QUESTION_WRITTEN',title_dcterms:{en:'Digital Services Act and platform safety',fr:'Titre fourni'},creator:['person/1']};
  return {clock:()=>Date.now(),get:()=>null,readSnapshot:fn=>fn(),status:()=>({currentMeps:1,servingGeneration:1,complete:false,sourceCounts:{document:1}}),db:{prepare(sql){
    if(sql.includes('FROM group_history_snapshots'))return {get:()=>undefined};
    if(sql.includes('FROM refresh_gaps'))return {all:()=>[]};
    if(sql.includes('FROM fast_read_progress'))return {get:()=>({ready:1})};
    if(sql.includes('FROM question_frontiers'))return {iterate:(generation,subtype)=>subtype==='QUESTION_WRITTEN'?[{subtype:work.work_type,date:work.document_date,fetchedAt:'2026-10-23T10:00:00Z'}]:[]};
    if(sql.startsWith('SELECT COUNT(*)'))return {get:()=>({n:1})};
    if(sql.startsWith('SELECT key,body'))return {all:()=>[{key:'/parliamentary-questions/'+work.identifier,body:JSON.stringify(work),fetched_at:'2026-10-02T10:00:00Z'}]};
    if(sql.startsWith('SELECT id,body'))return {all:()=>[{id:'1',body:JSON.stringify({id:'1',countryCode:'FR'})}]};
    throw new Error('Unexpected statement: '+sql);
  }}};
}
const clock=()=>Date.parse('2026-10-19T12:00:00Z');
const settled=promise=>promise.then(value=>({value}),error=>({error}));

test('independent saved metadata and question bodies load together before analysis',async()=>{
  let releaseMetadata,releaseBodies;
  const metadata=new Promise(resolve=>{releaseMetadata=resolve;}),bodies=new Promise(resolve=>{releaseBodies=resolve;}),started=[];
  const service=new QuestionInsights(savedStore(),{clock,
    loadMetadata:()=>{started.push('metadata');return metadata;},
    loadQuestionBodies:()=>{started.push('bodies');return bodies;}});
  const result=service.query(insightQuery(new URLSearchParams('days=90'),{now:clock()}));
  try {await yieldTurn();assert.deepEqual(started,['metadata','bodies']);}
  finally {releaseMetadata(new Map());releaseBodies(new Map());}
  assert.equal((await result).questions[0].id,'E-10-2026-000001');
});

test('a staggered language view survives the first view owner expiring during shared analysis',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let entered,release,loads=0;
  const started=new Promise(resolve=>{entered=resolve;}),bodies=new Promise(resolve=>{release=resolve;});
  const views=createInsights(savedStore(),{clock,viewCache:{directory:null},loadMetadata:async()=>new Map(),loadQuestionBodies:()=>{loads++;entered();return bodies;}});
  const first=settled(views.query('questions',new URLSearchParams('days=90&lang=en')));
  await Promise.resolve();await Promise.resolve();
  // The first view owns 50 seconds from t=0; its analysis begins at t=10s.
  t.mock.timers.tick(10_000);await started;
  t.mock.timers.tick(15_000);
  const second=settled(views.query('questions',new URLSearchParams('days=90&lang=fr')));
  await yieldTurn();await yieldTurn();
  t.mock.timers.tick(25_000);
  assert.equal((await first).error?.code,'request_timeout');
  release(new Map());
  const result=await second;
  assert.equal(result.error,undefined);
  assert.equal(result.value.questions[0].titleLanguage,'fr');
  assert.equal(result.value.counts.totalQuestions,null);
  assert.equal(result.value.coverage.indexComplete,false);
  assert.equal(loads,1);
});

test('expired analysis owners cannot publish late results or erase a replacement job',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let entered,release,loads=0;
  const started=new Promise(resolve=>{entered=resolve;}),bodies=new Promise(resolve=>{release=resolve;});
  const service=new QuestionInsights(savedStore(),{clock,loadMetadata:async()=>new Map(),loadQuestionBodies:()=>{if(++loads===1){entered();return bodies;}return new Map();}});
  const query=insightQuery(new URLSearchParams('days=90'),{now:clock()});
  const first=settled(service.query(query));await started;
  t.mock.timers.tick(50_000);
  assert.equal((await first).error?.code,'request_timeout');
  assert.equal(service.pending.size,0);
  const replacement=service.query(query);release(new Map());
  const result=await replacement;await yieldTurn();
  assert.equal(result.questions[0].id,'E-10-2026-000001');
  assert.equal(loads,2);
  assert.equal(service.cache.size,1);
  assert.equal(service.pending.size,0);
});
