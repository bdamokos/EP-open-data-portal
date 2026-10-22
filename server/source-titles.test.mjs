import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceTitle,sourceTitles} from './source-titles.mjs';
import {questionFromSource} from './insights-model.mjs';
import {documentSummary} from './activities.mjs';
import {localize} from './activity-index-model.mjs';
import {QuestionInsights,insightQuery} from './insights-store.mjs';

const id='E-10-2026-004205',key='/parliamentary-questions/'+id,fetchedAt='2026-10-22T16:00:00Z';
const title='Reservations regarding the Greek Public Employment Service (DYPA) staffing process';
const source=()=>({identifier:id,id:'eli/dl/doc/'+id,work_type:'def/ep-document-types/QUESTION_WRITTEN',document_date:'2026-10-15',title_dcterms:{en:title+'&nbsp;',el:'Επιφυλάξεις&nbsp;'},creator:['person/197701']});

test('source titles decode named and numeric entities once, preserving literal and malformed text',()=>{
  assert.equal(sourceTitle(title+'&nbsp;'),title+'\u00a0');
  assert.equal(sourceTitle('&eacute; &Eacute; &amp; &#160; &#x1F642;'), 'é É & \u00a0 🙂');
  assert.equal(sourceTitle('&lt;img src=x onerror=alert(1)&gt; <b>literal</b>'),'<img src=x onerror=alert(1)> <b>literal</b>');
  assert.equal(sourceTitle('&amp;nbsp; &amp;lt;'),'&nbsp; &lt;','no recursive decoding');
  for(const text of ['&unknown;','&constructor;','&nbsp','&#xZZ;','&#12oops;','&#0;','&#xD800;','&#1114112;','& copy;','R&D'])assert.equal(sourceTitle(text),text);
  const titles={en:'English&nbsp;',el:'Ελληνικά &amp; κείμενο',mul:'FR &amp; EN',fr:''},original=structuredClone(titles);
  assert.deepEqual(sourceTitles(titles),{en:'English\u00a0',el:'Ελληνικά & κείμενο',mul:'FR & EN',fr:''});
  assert.deepEqual(titles,original);
});

test('question and document adapters retain exact identity, language and provenance with decoded titles',()=>{
  const work=source(),original=structuredClone(work),question=questionFromSource({work,key,fetchedAt});
  assert.equal(question.titles.en,title+'\u00a0');assert.equal(question.titles.el,'Επιφυλάξεις\u00a0');
  assert.equal(question.id,id);assert.equal(question.apiUrl,'https://data.europarl.europa.eu/api/v2'+key);assert.equal(question.fetchedAt,fetchedAt);
  work.inverse_answers_to=[{identifier:id+'-ASW',title_dcterms:{en:'Answer &amp; context'}}];
  const detail=documentSummary(work,'197701');assert.equal(detail.titles.en,title+'\u00a0');assert.equal(detail.answers[0].titles.en,'Answer & context');
  assert.equal(detail.answers[0].id,id+'-ASW');
  const expression=documentSummary({identifier:id,is_realized_by:[{title:{el:'Τίτλος&nbsp;'}}]});assert.deepEqual(expression.titles,{el:'Τίτλος\u00a0'});
  delete work.inverse_answers_to;assert.deepEqual(work,original,'source records are never rewritten');
});

test('retained activity titles decode on read without a reindex or changed provenance',()=>{
  const row={category:'written-questions',sourceId:id,titles:{el:'Επιφυλάξεις&nbsp;',en:'&amp;lt;b&amp;gt;'},reference:id,files:[],provenance:{apiUrl:'https://data.europarl.europa.eu/api/v2'+key,fetchedAt}},original=structuredClone(row);
  const item=localize(row,'hu');assert.equal(item.title,'&lt;b&gt;');assert.equal(item.titleLanguage,'en');
  assert.equal(localize(row,'el').title,'Επιφυλάξεις\u00a0');assert.deepEqual(item.provenance,row.provenance);assert.deepEqual(row,original);
});

test('saved raw question sources produce clean titles while retaining incomplete coverage and source dates',async()=>{
  const work=source(),store={status:()=>({currentMeps:1,servingGeneration:1,complete:false,sourceCounts:{document:1}}),db:{prepare(sql){
    if(sql.startsWith('SELECT COUNT(*)'))return {get:()=>({n:1})};
    if(sql.startsWith('SELECT key,body'))return {all:()=>[{key,body:JSON.stringify(work),fetched_at:fetchedAt}]};
    if(sql.startsWith('SELECT id,body'))return {all:()=>[{id:'197701',body:JSON.stringify({id:'197701',name:'Fixture author',countryCode:'EL'})}]};
    throw Error('Unexpected statement: '+sql);
  }}};
  const clock=()=>Date.parse(fetchedAt),service=new QuestionInsights(store,{clock,loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()});
  const page=await service.query(insightQuery(new URLSearchParams('lang=en&days=90'),{now:clock()}));
  assert.equal(page.questions[0].title,title+'\u00a0');assert.equal(page.questions[0].titleLanguage,'en');assert.equal(page.questions[0].id,id);
  assert.equal(page.questions[0].fetchedAt,fetchedAt);assert.equal(page.coverage.indexComplete,false);assert.equal(page.counts.totalQuestions,null);
  assert.equal(work.title_dcterms.en,title+'&nbsp;');
});
