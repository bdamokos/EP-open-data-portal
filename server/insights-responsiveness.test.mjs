import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {analyzeQuestions,analyzeQuestionsAsync} from './insights-model.mjs';
import {cooperativeWork} from './cooperative-work.mjs';

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
