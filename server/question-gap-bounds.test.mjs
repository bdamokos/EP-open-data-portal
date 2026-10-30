import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {ActivityStore} from './activity-index-store.mjs';
import {documentRows} from './activity-index-model.mjs';
import {QuestionInsights,insightQuery} from './insights-store.mjs';
import {savedGaps} from './availability-evidence.mjs';
import {sourceAvailability,periodAvailability} from './source-availability.mjs';
import {coverageNotices} from '../src/coverageNotices.mjs';
import {sendJson} from './http-utils.mjs';

const clock=()=>Date.parse('2026-10-30T12:00:00Z');
function fixture(t){const directory=mkdtempSync('/tmp/question-gap-bounds-'),store=new ActivityStore(directory,{clock});store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'42',name:'Selected member',countryCode:'HU'},{id:'43',name:'Other member',countryCode:'FR'}]);t.after(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});});return {store,generation};}
for(const day of ['2025-01-02','2026-09-01'])test('thousands of dated failures cannot break an unrelated country response: '+day,async t=>{
  const {store,generation}=fixture(t),source=store.db.prepare("INSERT INTO sources VALUES (?,?,'document',?,?,1)"),item=store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)'),gap=store.db.prepare("INSERT INTO refresh_gaps(generation,key,kind,body) VALUES (?,?,'document','{}')");
  const put=(id,date,person)=>{const endpoint='/parliamentary-questions/'+id,work={id:'eli/dl/doc/'+id,identifier:id,parliamentary_term:['org/ep-10'],work_type:'def/ep-document-types/QUESTION_WRITTEN',document_date:date,title_dcterms:{en:'Climate energy policy'},creator:['person/'+person]};source.run(generation,endpoint,JSON.stringify(work),clock());for(const row of documentRows(work,endpoint,clock()).rows)item.run(generation,endpoint,row.sourceId,String(row.mepId),row.category,row.date,JSON.stringify(row));return endpoint;};
  store.transaction(()=>{put('E-10-2026-990001','2026-10-30','42');for(let i=1;i<=7000;i++)gap.run(generation,put('E-10-'+day.slice(0,4)+'-'+String(i).padStart(6,'0'),day,'43'));});
  store.publish(generation);store.release();store.db.exec('PRAGMA query_only=ON');
  const producer=new QuestionInsights(store,{clock,loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()}),data=await producer.query(insightQuery(new URLSearchParams({days:'90',country:'HU'}),{now:clock()}));
  assert.equal(data.counts.selectedQuestions,1);assert(data.availability.every(source=>source.gaps.length<10));assert(Buffer.byteLength(JSON.stringify(data))<512*1024);
  assert.doesNotThrow(()=>sendJson({method:'GET',headers:{}},{setHeader(){},end(){}},200,data));
  assert.deepEqual(coverageNotices(data.availability,{start:data.window.start,end:data.window.end,sourceIds:data.questions.map(question=>question.id),onlyRelevant:true}),[]);
});
test('bounded date summaries retain exact separated intervals and requested identities',t=>{
  const {store,generation}=fixture(t),gap=store.db.prepare("INSERT INTO refresh_gaps(generation,key,kind,body) VALUES (?,?,'document',?)"),key=i=>'/parliamentary-questions/E-10-2026-'+String(i).padStart(6,'0');
  store.transaction(()=>{for(let i=1;i<=7000;i++)gap.run(generation,key(i),JSON.stringify({start:i===7000?'2026-10-18':'2026-10-16',end:i===7000?'2026-10-18':'2026-10-16'}));});
  const gaps=savedGaps(store,generation,'questions',{start:'2026-10-01',end:'2026-10-30',recordIds:[key(7000)]}),evidence=sourceAvailability({sourceKey:'questions',family:'questions',start:'2026-10-01',end:'2026-10-30',gaps,today:'2026-10-30'});
  assert(gaps.length<10);assert(gaps.some(gap=>gap.sourceId===key(7000)&&gap.retained===false));assert.equal(gaps.find(gap=>gap.reason==='record-gap-summary').minimumCount,6999);
  for(const [day,state] of [['2026-10-16','partial'],['2026-10-17','observed'],['2026-10-18','partial']])assert.equal(periodAvailability({start:day,end:day},evidence,1,{today:'2026-10-30'}).state,state);
  assert.equal(periodAvailability({start:'2026-10-17',end:'2026-10-17'},evidence,0,{today:'2026-10-30'}).observedCount,0);
  assert.deepEqual(coverageNotices(evidence,{onlyRelevant:true,sourceIds:[key(7000)]}).map(notice=>notice.id),['E-10-2026-007000']);
  assert(coverageNotices(evidence).some(notice=>notice.kind==='gap-overflow'&&notice.count===501));
});
