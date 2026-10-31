import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {ActivityStore} from './activity-index-store.mjs';
import {QuestionInsights,insightQuery} from './insights-store.mjs';
import {createInsights} from './insights.mjs';
import {documentRows} from './activity-index-model.mjs';

const now=()=>Date.parse('2026-10-31T10:00:00Z');
function fixture(t){
  const directory=mkdtempSync('/tmp/question-analysis-cache-'),store=new ActivityStore(directory,{clock:now});
  store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'42',name:'Selected member',countryCode:'HU'}]);
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const put=(generation,id,date='2026-10-30')=>{
    const endpoint='/parliamentary-questions/'+id,work={id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/QUESTION_WRITTEN',document_date:date,title_dcterms:{en:'Water and environmental protection',fr:'Protection des eaux'},creator:['person/42']};
    store.putSource(generation,endpoint,'document',work,new Date(now()).toISOString(),documentRows(work,endpoint,new Date(now()).toISOString()).rows);
  };
  put(generation,'E-10-2026-000001');
  let metadataLoads=0,bodyLoads=0;
  const options={clock:now,viewCache:{directory:null},loadMetadata:async()=>{metadataLoads++;return new Map();},loadQuestionBodies:async()=>{bodyLoads++;return new Map();}};
  return {store,generation,put,options,loads:()=>({metadataLoads,bodyLoads})};
}

for(const assembled of [false,true])test('unrelated working writes reuse published question analysis: assembled='+assembled,async t=>{
  const {store,generation,put,options,loads}=fixture(t);store.publish(generation);const working=store.beginCycle().generation;
  store.enqueue(working,'unrelated-a','document',{},0);store.enqueue(working,'unrelated-b','document',{},0);
  const reader=assembled?createInsights(store,options):new QuestionInsights(store,options);
  const read=()=>assembled?reader.query('questions',new URLSearchParams('days=90&lang=en')):reader.query(insightQuery(new URLSearchParams('days=90&lang=en'),{now:now()}));
  const first=await read(),revision=store.get('availabilityRevision');
  put(working,'E-10-2026-000002');
  store.db.prepare('UPDATE tasks SET done=1 WHERE generation=? AND key=?').run(working,'unrelated-a');
  assert(store.get('availabilityRevision')>revision);
  const second=await read();
  assert.deepEqual(loads(),{metadataLoads:1,bodyLoads:1});
  assert.deepEqual(second.questions,first.questions);
  assert.deepEqual(second.counts,first.counts);
  assert.equal(second.coverage.servingGeneration,generation);
  assert(second.availability.every(source=>source.snapshot.revision===store.get('availabilityRevision')),'fresh availability must accompany reused analysis');
});

test('unpublished question changes and first publication invalidate the analysis',async t=>{
  const {store,generation,put,options,loads}=fixture(t),reader=new QuestionInsights(store,options),query=insightQuery(new URLSearchParams('days=90'),{now:now()});
  assert.equal((await reader.query(query)).counts.analyzedQuestions,1);
  put(generation,'E-10-2026-000002');
  assert.equal((await reader.query(query)).counts.analyzedQuestions,2);assert.equal(loads().bodyLoads,2);
  store.publish(generation);
  const published=await reader.query(query);assert.equal(published.coverage.servingGeneration,generation);assert.equal(loads().bodyLoads,3);
  const next=store.beginCycle().generation;put(next,'E-10-2026-000003');store.publish(next);
  assert.equal((await reader.query(query)).coverage.servingGeneration,next);assert.equal(loads().bodyLoads,4);
});

test('published metadata revisions still invalidate question analysis',async t=>{
  const {store,generation,options,loads}=fixture(t);store.publish(generation);
  const reader=new QuestionInsights(store,options),query=insightQuery(new URLSearchParams('days=90'),{now:now()});
  await reader.query(query);store.set('demographicRevision',(store.get('demographicRevision')||0)+1);await reader.query(query);
  assert.deepEqual(loads(),{metadataLoads:2,bodyLoads:2});
});

test('gap/status changes remain current without reloading published question bodies',async t=>{
  const {store,generation,options,loads}=fixture(t);store.publish(generation);
  const reader=new QuestionInsights(store,options),query=insightQuery(new URLSearchParams('days=90'),{now:now()});
  const first=await reader.query(query);assert.equal(first.coverage.indexComplete,true);
  store.db.prepare("INSERT INTO refresh_gaps(generation,key,kind,body,attempts,retry_at) VALUES (?,'feed:/parliamentary-questions','feed',?,5,?)").run(generation,JSON.stringify({endpoint:'/parliamentary-questions',start:'2026-10-15',end:'2026-10-20'}),now()+86_400_000);
  store.set('availabilityRevision',(store.get('availabilityRevision')||0)+1);
  const before=store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=?').all(generation);
  store.db.exec('PRAGMA query_only=ON');const second=await reader.query(query);store.db.exec('PRAGMA query_only=OFF');
  assert.equal(second.coverage.indexComplete,false);assert.equal(second.counts.totalQuestions,null);
  assert.deepEqual(second.questions,first.questions);assert.deepEqual(loads(),{metadataLoads:1,bodyLoads:1});
  assert(second.availability.every(source=>source.gaps.some(gap=>gap.sourceId==='feed:/parliamentary-questions'&&gap.start==='2026-10-15'&&gap.end==='2026-10-20')));
  assert.deepEqual(store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=?').all(generation),before);
});

test('published input reuse retains the existing sixty-second analysis lifetime',async t=>{
  const {store,generation,options,loads}=fixture(t);store.publish(generation);let time=now();
  const reader=new QuestionInsights(store,{...options,clock:()=>time}),query=insightQuery(new URLSearchParams('days=90'),{now:now()});
  await reader.query(query);time+=59_999;await reader.query(query);assert.equal(loads().bodyLoads,1);
  time+=2;await reader.query(query);assert.equal(loads().bodyLoads,2);
});

test('a publication during async preparation keeps the original source and availability together',async t=>{
  const {store,generation,put,options}=fixture(t);store.publish(generation);
  const reader=new QuestionInsights(store,{...options,loadMetadata:async()=>{
    const next=store.beginCycle().generation;put(next,'E-10-2026-000002');store.publish(next);return new Map();
  }});
  const result=await reader.query(insightQuery(new URLSearchParams('days=90'),{now:now()}));
  assert.equal(result.coverage.servingGeneration,generation);
  assert.deepEqual(result.questions.map(row=>row.id),['E-10-2026-000001']);
  assert(result.availability.every(source=>source.snapshot.generation===generation));
});
