import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceTitle,sourceTitles} from './source-titles.mjs';
import {questionFromSource} from './insights-model.mjs';
import {documentSummary} from './activities.mjs';
import {localize} from './activity-index-model.mjs';
import {QuestionInsights,insightQuery} from './insights-store.mjs';
import {LegalReferences} from './legal-references.mjs';
import {savedItemPreview} from './insights-saved.mjs';

const id='E-10-2026-004205',key='/parliamentary-questions/'+id,fetchedAt='2026-10-22T16:00:00Z';
const title='Reservations regarding the Greek Public Employment Service (DYPA) staffing process';
const source=()=>({identifier:id,id:'eli/dl/doc/'+id,work_type:'def/ep-document-types/QUESTION_WRITTEN',document_date:'2026-10-15',title_dcterms:{en:title+'&nbsp;',el:'Επιφυλάξεις&nbsp;'},creator:['person/197701']});

test('source titles decode named and numeric entities once, preserving literal and malformed text',()=>{
  assert.equal(sourceTitle(title+'&nbsp;'),title+'\u00a0');
  assert.equal(sourceTitle('&eacute; &Eacute; &amp; &#160; &#x1F642; &#X26;'), 'é É & \u00a0 🙂 &');
  assert.equal(sourceTitle('&lt;img src=x onerror=alert(1)&gt; <b>literal</b>'),'<img src=x onerror=alert(1)> literal');
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

// Public source: https://data.europarl.europa.eu/api/v2/parliamentary-questions/E-10-2026-003952
const scriptTitle='VAT and CO<sub>2</sub>-related costs in Cypriot electricity bills';
const cleanScriptTitle='VAT and CO₂-related costs in Cypriot electricity bills';

test('source titles normalize subscript and superscript pairs without interpreting other markup',()=>{
  assert.equal(sourceTitle(scriptTitle),cleanScriptTitle);
  assert.equal(sourceTitle(scriptTitle.replaceAll('<','&lt;').replaceAll('>','&gt;')),cleanScriptTitle);
  assert.equal(sourceTitle('H<SUB>2</SUB>O &amp; m<sup>2</sup>'), 'H₂O & m²');
  assert.equal(sourceTitle('x<sup>0123456789+-=()</sup>'), 'x⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾');
  assert.equal(sourceTitle('x<sub>0123456789+-=()</sub>'), 'x₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎');
  assert.equal(sourceTitle('x<sub>letters &amp; symbols</sub>'), 'xletters & symbols');
  for(const literal of ['<img src=x onerror=alert(1)>','<script>alert(1)</script>'])assert.equal(sourceTitle(literal),literal);
  assert.equal(sourceTitle('CO&amp;lt;sub&amp;gt;2&amp;lt;/sub&amp;gt;'),'CO&lt;sub&gt;2&lt;/sub&gt;');
});

test('common title formatting is plain text, including attributes, nesting and line breaks',()=>{
  for(const tag of ['b','strong','i','em','u','span','small']){
    assert.equal(sourceTitle(`<${tag}>European</${tag}> policy`),'European policy');
    assert.equal(sourceTitle(`<${tag} class="source" lang='en'>European</${tag}> policy`),'European policy');
  }
  assert.equal(sourceTitle('CO<sub class="chemical"><i>2</i></sub> and m<sup title="area">2</sup>'),'CO₂ and m²');
  assert.equal(sourceTitle('&lt;em&gt;In situ&lt;/em&gt; &amp; action'),'In situ & action');
  for(const br of ['<br>','<br/>','<BR />','<br class="line">'])assert.equal(sourceTitle('First'+br+'second'),'First second');
  assert.equal(sourceTitle('CO<sub data-label=chemical>2</sub>'),'CO₂');
  assert.equal(sourceTitle('<span title="A > B">European</span> policy'),'European policy');
  for(const input of ['CO<sub>2','CO</sub>2','CO<sub>2</sup>'])assert.equal(sourceTitle(input),'CO2');
  // Retained E-10-2024-002503 (el), E-10-2025-000488 (fr) and E-10-2025-000548 (de).
  assert.equal(sourceTitle('CO<sup><sub>2</sub></sup>'),'CO₂');
  assert.equal(sourceTitle('10<sup>e</sup> PC and NO<sub>x</sub>'),'10e PC and NOx');
  for(const literal of ['capacity < 5 MW and > 2 MW','<custom>word</custom>','<custom data-label="<b>">word</custom>','<custom data-label="<sub>2</sub>">word</custom>','<iframe src=x>word</iframe>','<b title="unfinished>word','&amp;lt;i&amp;gt;word&amp;lt;/i&amp;gt;']){
    assert.equal(sourceTitle(literal),literal.replaceAll('&amp;','&'));
  }
});

test('question titles normalize on retained source reads across question, document, activity and saved previews',()=>{
  const work={...source(),identifier:'E-10-2026-003952',document_date:'2026-09-30',title_dcterms:{en:scriptTitle}},original=structuredClone(work);
  const sourceKey='/parliamentary-questions/'+work.identifier;
  const question=questionFromSource({work,key:sourceKey,fetchedAt});
  assert.equal(question.titles.en,cleanScriptTitle);
  assert.equal(documentSummary(work,'197701').titles.en,cleanScriptTitle);
  const row={category:'written-questions',sourceId:work.identifier,titles:work.title_dcterms,reference:work.identifier,files:[],provenance:{apiUrl:question.apiUrl,fetchedAt}};
  const localized=localize(row,'en');
  assert.equal(localized.title,cleanScriptTitle);
  assert.deepEqual(localized.provenance,row.provenance);
  const preview=savedItemPreview({},1,{source_id:work.identifier,body:JSON.stringify(row)},'en');
  assert.equal(preview.title,cleanScriptTitle);
  assert.deepEqual(work,original,'normalization never rewrites retained sources');
});

test('retained activity titles decode on read without a reindex or changed provenance',()=>{
  const row={category:'written-questions',sourceId:id,titles:{el:'Επιφυλάξεις&nbsp;',en:'&amp;lt;b&amp;gt;'},reference:id,files:[],provenance:{apiUrl:'https://data.europarl.europa.eu/api/v2'+key,fetchedAt}},original=structuredClone(row);
  const item=localize(row,'hu');assert.equal(item.title,'&lt;b&gt;');assert.equal(item.titleLanguage,'en');
  assert.equal(localize(row,'el').title,'Επιφυλάξεις\u00a0');assert.deepEqual(item.provenance,row.provenance);assert.deepEqual(row,original);
});

test('saved raw question sources produce clean titles while retaining incomplete coverage and source dates',async()=>{
  const work=source();work.title_dcterms.en=scriptTitle;
  const store={clock:()=>Date.now(),get:()=>null,readSnapshot:fn=>fn(),status:()=>({currentMeps:1,servingGeneration:1,complete:false,sourceCounts:{document:1}}),db:{prepare(sql){
    if(sql.includes('FROM group_history_snapshots'))return {get:()=>undefined};
    if(sql.includes('FROM refresh_gaps'))return {all:()=>[]};
    if(sql.includes('FROM fast_read_progress'))return {get:()=>({ready:1})};
    if(sql.includes('FROM question_frontiers')&&sql.startsWith('SELECT COUNT(*)'))return {get:()=>({n:sql.includes('IS NULL')?0:1})};
    if(sql.includes('FROM question_frontiers'))return {iterate:(generation,subtype)=>subtype==='QUESTION_WRITTEN'?[{subtype:work.work_type,date:work.document_date,fetchedAt:'2026-10-23T10:00:00Z'}]:[]};
    if(sql.startsWith('SELECT COUNT(*)'))return {get:()=>({n:1})};
    if(sql.startsWith('SELECT key,body'))return {all:()=>[{key,body:JSON.stringify(work),fetched_at:fetchedAt}]};
    if(sql.startsWith('SELECT id,body'))return {all:()=>[{id:'197701',body:JSON.stringify({id:'197701',name:'Fixture author',countryCode:'EL'})}]};
    throw Error('Unexpected statement: '+sql);
  }}};
  const clock=()=>Date.parse(fetchedAt),service=new QuestionInsights(store,{clock,loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()});
  const page=await service.query(insightQuery(new URLSearchParams('lang=en&days=90'),{now:clock()}));
  assert.equal(page.questions[0].title,cleanScriptTitle);assert.equal(page.questions[0].titleLanguage,'en');assert.equal(page.questions[0].id,id);
  assert.equal(page.questions[0].fetchedAt,fetchedAt);assert.equal(page.coverage.indexComplete,false);assert.equal(page.counts.totalQuestions,null);
  assert.equal(work.title_dcterms.en,scriptTitle);
});

test('reference cards invalidate old assembled titles and do not decode a saved card twice',async()=>{
  let calls=0;const referenceKey='question:E-2026-004205',work=source();work.title_dcterms.en=scriptTitle+' &amp;nbsp; &nbsp;';
  const references=new LegalReferences({}, {directory:null,clock:()=>Date.parse(fetchedAt),request:async endpoint=>{
    calls++;assert.equal(endpoint,key);return {url:'https://data.europarl.europa.eu/api/v2'+key,fetchedAt:Date.parse(fetchedAt),payload:{data:[work]}};
  }});
  const old=references.cache.key(['question-reference-v3',referenceKey,'en']);
  await references.cache.save(old,{key:referenceKey,kind:'question',status:'found',id,title:'Old &nbsp;'});
  const query={keys:[referenceKey],language:'en'},first=(await references.query(query)).references[0];
  assert.equal(first.title,cleanScriptTitle+' &nbsp; \u00a0');assert.equal(first.titleLanguage,'en');assert.equal(first.id,id);assert.equal(first.source.fetchedAt,new Date(fetchedAt).toISOString());
  assert.equal((await references.query(query)).references[0].title,first.title);assert.equal(calls,1);
  assert.notEqual(references.cacheKey(referenceKey,'en'),old);
  assert.equal(references.cacheKey('celex:32016R0679','en'),references.cache.key(['legal-reference-v1','celex:32016R0679','en']),'unrelated reference caches remain usable');
});
