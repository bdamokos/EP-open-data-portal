import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activitySourceId } from './activity-links.mjs';
import { ActivityStore } from './activity-index-store.mjs';
import { ActivityWorker, feedDocuments } from './activity-index-worker.mjs';
import { CATEGORY_GROUPS, CATEGORIES, documentRows, projectDocument, projectProcedure, speechRows } from './activity-index-model.mjs';

const person='person/257043';
const date='2026-03-10';
const participant=(role,id=person,stage='RDG1',term=10)=>({id:'participation/test',had_participant_person:[id],participation_role:'def/ep-roles/'+role,occured_at_stage:'http://publications.europa.eu/resource/authority/procedure-phase/'+stage,parliamentary_term:'org/ep-'+term});
const report={id:'eli/dl/doc/A-10-2026-0049',identifier:'A-10-2026-0049',work_type:'def/ep-document-types/REPORT_PLENARY',parliamentary_term:'org/ep-10',document_date:date,title_dcterms:{en:'Report'},workHadParticipation:[participant('RAPPORTEUR','person/42')],inverse_created_a_realization_of:['eli/dl/proc/2025-0233']};
const procedure={id:'eli/dl/proc/2025-0233',had_participation:[participant('RAPPORTEUR_SHADOW'),participant('RAPPORTEUR_SHADOW','person/43','RDG2'),participant('RAPPORTEUR_SHADOW','person/44','RDG1',9)],consists_of:[{id:'event/tabling',had_activity_type:'def/ep-activities/TABLING_PLENARY',based_on_a_realization_of:[report.id],occured_at_stage:'http://publications.europa.eu/resource/authority/procedure-phase/RDG1'}]};
const question={id:'eli/dl/doc/E-10-2026-003031',identifier:'E-10-2026-003031',parliamentary_term:'org/ep-10',work_type:'def/ep-document-types/QUESTION_WRITTEN',document_date:'2026-06-10',title_dcterms:{es:'Pregunta'},workHadParticipation:[participant('AUTHOR')],inverse_answers_to:[{id:'eli/dl/doc/E-10-2026-003031-ASW',identifier:'E-10-2026-003031-ASW',document_date:'2026-09-18',creator:['org/COM'],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/SPA',is_embodied_by:[{format:'authority/PDF',byteSize:123,is_exemplified_by:'distribution/doc/answer.pdf'}]}]}]};
const instant=()=>Date.parse('2026-10-13T14:00:00Z');
const fetchedAt=new Date(instant()).toISOString();
function temp(){return mkdtempSync(path.join(os.tmpdir(),'activity-index-test-'));}

test('report shadow join follows the specific tabling stage and term, not every appointment in the procedure',()=> {
  const result=documentRows(projectDocument(report),'/plenary-documents/'+report.identifier,fetchedAt,new Map([['2025-0233',{work:projectProcedure(procedure),fetchedAt}]]));
  assert.equal(result.unresolved.length,0);
  assert.deepEqual(result.rows.filter(r=>r.category==='reports-shadow').map(r=>r.mepId),['257043']);
  assert.equal(result.rows.find(r=>r.category==='reports-shadow').provenance.stage,'RDG1');
  assert.equal(result.rows.find(r=>r.category==='reports-shadow').provenance.procedureFetchedAt,fetchedAt);
  assert.equal(result.rows.find(r=>r.category==='reports-rapporteur').mepId,'42');
  assert.equal(documentRows({...report,parliamentary_term:'org/ep-9'},'/test',fetchedAt).rows.length,0);
});
test('missing report-stage evidence remains unresolved instead of creating a false shadow relationship',()=> {
  const result=documentRows(report,'/test',fetchedAt,new Map([['2025-0233',{...procedure,consists_of:[]}]]));
  assert.equal(result.rows.some(r=>r.category==='reports-shadow'),false);
  assert.equal(result.unresolved[0].reason,'No report-specific procedure stage supplied');
});
test('answers inherit the question author, retain answer dates/files, and do not credit the Commission as an MEP',()=> {
  const result=documentRows(projectDocument(question),'/parliamentary-questions/'+question.identifier,fetchedAt);
  const answer=result.rows.find(r=>r.recordKind==='answer');
  assert.equal(answer.mepId,'257043');assert.equal(answer.date,'2026-09-18');assert.equal(answer.relatedQuestionId,question.identifier);
  assert.equal(answer.files[0].byteSize,123);assert.equal(answer.files[0].translationType,'unspecified');
  assert.equal(answer.files[0].humanReviewStatus,'unspecified');
  assert.equal(result.rows.length,2);
});
test('opinion/shadow roles remain distinct and an individual motion is classified by its rule, not author count',()=> {
  const opinion={...report,work_type:'def/ep-document-types/OPINION_LETTER_PARLIAMENTARY_COMMITTEE',workHadParticipation:[participant('RAPPORTEUR_OPINION'),participant('RAPPORTEUR_SHADOW_OPINION','person/42')]};
  assert.deepEqual(documentRows(opinion,'/test',fetchedAt).rows.map(r=>r.category),['opinions-rapporteur','opinions-shadow']);
  const motion={...report,work_type:'def/ep-document-types/RESOLUTION_MOTION',workHadParticipation:[participant('AUTHOR'),participant('AUTHOR','person/42')],based_on:['eli/dl/doc/RULES-10-2025-01-20-ITM-A149']};
  assert(documentRows(motion,'/test',fetchedAt).rows.every(r=>r.motionType==='individual'));
  assert(documentRows({...motion,based_on:[]},'/test',fetchedAt).rows.every(r=>r.motionType==='unspecified'));
});
test('speech summary retains original-language link and excludes non-contribution activity types',()=> {
  const speech={activity_id:'MTG-PL-2026-10-07-OTH-2017097993206',activity_date:'2026-10-07',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:participant('SPEAKER'),recorded_in_a_realization_of:[{identifier:'CRE-10-2026-10-07-OTH-2017097993206',originalLanguage:['http://publications.europa.eu/resource/authority/language/SPA']}]};
  const [row]=speechRows(speech,fetchedAt);assert.equal(row.mepId,'257043');assert.match(row.websiteUrl,/_ES.html$/);
  assert.equal(speechRows({...speech,had_activity_type:'def/ep-activities/VOTE_EXPLANATION_ORAL'},fetchedAt).length,0);
});
test('exclusive writer leases survive overlap: expiry transfers ownership and fences the old process',()=> {
  const dir=temp();let now=instant();const clock=()=>now;
  const a=new ActivityStore(dir,{clock}),b=new ActivityStore(dir,{clock});
  try {assert.equal(a.acquire(),true);assert.equal(b.acquire(),false);now+=91_000;assert.equal(b.acquire(),true);assert.equal(a.renew(),false);assert.throws(()=>a.beginCycle(),/lease/);b.beginCycle();assert.equal(b.get('sequence'),1);}
  finally {a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
test('failed daily updates retain the last published generation; restart resumes the unpublished generation',()=> {
  const dir=temp();let s=new ActivityStore(dir,{clock:instant});
  try {
    assert(s.acquire());const first=s.beginCycle();s.setMembers([{id:'257043',name:'MEP'}]);
    const oldRows=documentRows(question,'/question',fetchedAt).rows;
    s.putSource(first.generation,'/question','document',projectDocument(question),fetchedAt,oldRows);
    s.publish(first.generation);const oldSuccess=s.get('lastSuccess');
    const second=s.beginCycle();s.enqueue(second.generation,'pending','document',{},80);
    s.putSource(second.generation,'/question','document',question,fetchedAt,oldRows.map(r=>({...r,titles:{en:'Unpublished update'}})));
    s.failTask(s.nextTask(second.generation),new Error('Upstream unavailable'));
    assert.equal(s.page('257043').items[0].title,'Pregunta');assert.equal(s.get('lastSuccess'),oldSuccess);
    assert.throws(()=>s.publish(second.generation),/incomplete/);
    s.close();s=new ActivityStore(dir,{clock:instant});assert(s.acquire());
    assert.equal(s.beginCycle().generation,second.generation);assert.equal(s.page('257043').cache.lastError,'Upstream unavailable');
    const task=s.db.prepare('SELECT * FROM tasks WHERE generation=?').get(second.generation);s.finishTask(task);s.publish(second.generation);
    assert.equal(s.page('257043').items[0].title,'Unpublished update');assert.equal(s.page('257043').cache.complete,true);
  } finally {s.close();rmSync(dir,{recursive:true,force:true});}
});
test('cached pagination groups answers under question dates and excludes them from activity counts',()=> {
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try {s.acquire();const cycle=s.beginCycle();s.setMembers([{id:'257043',name:'MEP'}]);s.putSource(cycle.generation,'/q','document',question,fetchedAt,documentRows(question,'/q',fetchedAt).rows);s.publish(cycle.generation);
    const p=s.page('257043',{language:'hu',limit:1});assert.equal(p.items[0].recordKind,'document');assert.equal(p.items[0].date,question.document_date);assert.equal(p.indexedTotal,1);assert.equal(p.categoryCoverage['written-questions'].indexedCount,1);assert.equal(p.nextOffset,null);assert.equal(p.items[0].titleLanguage,'es');
    assert.equal(s.page('257043',{offset:1,limit:1}).items.length,0);assert.equal(s.page('257043',{sourceId:question.identifier+'-ASW'}).selectedItems[0].recordKind,'answer');
    assert.equal(s.page('257043',{category:'reports-shadow'}).total,0);assert.equal(s.page('42'),null);
  } finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('a recent answer does not move an older question ahead of newer MEP work',()=>{
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try {
    s.acquire();const {generation}=s.beginCycle();s.setMembers([{id:'257043',name:'MEP'}]);
    s.putSource(generation,'/q','document',question,fetchedAt,documentRows(question,'/q',fetchedAt).rows);
    const motion={...report,identifier:'B-10-2026-000001',document_date:'2026-08-01',work_type:'def/ep-document-types/RESOLUTION_MOTION',workHadParticipation:[participant('AUTHOR')],based_on:['eli/dl/doc/RULES-10-2025-01-20-ITM-A114']};
    s.putSource(generation,'/motion','document',motion,fetchedAt,documentRows(motion,'/motion',fetchedAt).rows);s.publish(generation);
    const first=s.page('257043',{limit:1});assert.equal(first.items[0].sourceId,motion.identifier);assert.equal(first.nextOffset,1);assert.equal(first.indexedTotal,2);
    const second=s.page('257043',{limit:1,offset:1});assert.equal(second.items[0].sourceId,question.identifier);assert.equal(second.items[0].date,'2026-06-10');assert.equal(second.nextOffset,null);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('document feeds are identifier inputs, not arbitrary outgoing URLs or HTML descriptions',()=> {
  assert.deepEqual(feedDocuments('<feed><entry><id>https://data.europarl.europa.eu/eli/dl/doc/E-10-2026-003031-ASW</id><updated>2026-10-01</updated></entry><entry><id>https://evil.example/path</id></entry></feed>','/parliamentary-questions'),[{id:'E-10-2026-003031-ASW',updated:'2026-10-01'}]);
  assert.throws(()=>feedDocuments('<!DOCTYPE feed><feed/>','/test'));assert.throws(()=>feedDocuments('<html/>','/test'));
});
test('background job is request-bounded, resumable, and separate from cache reads',async()=> {
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});let calls=0;
  const fetchRecord=async(ep,params)=>{calls++;assert.equal(ep,'/meps/show-current');return {payload:{data:params.offset===0?[{id:'person/257043',label:'MEP'}]:[]},fetchedAt};};
  try {const worker=new ActivityWorker(s,{clock:instant,fetchRecord,budget:1});await worker.run();assert.equal(calls,1);assert.equal(s.get('working').initialized,true);
    await worker.run();assert.equal(calls,2);assert.equal(s.status().currentMeps,1);const before=calls;s.page('257043');assert.equal(calls,before);
  } finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('real EP records verify report-to-procedure shadow and question-to-answer joins',async()=> {
  const {readFile}=await import('node:fs/promises');
  const fixture=JSON.parse(await readFile(new URL('./fixtures/activity-index-live-20261013.json',import.meta.url),'utf8'));
  const proc=new Map([['2025-0233',{work:fixture.procedure.work,fetchedAt:fixture.verifiedAt}]]);
  const r=fixture.documents.find(d=>d.endpoint.startsWith('/plenary-documents'));
  const reportRows=documentRows(r.work,r.endpoint,fixture.verifiedAt,proc).rows;
  const shadow=reportRows.find(row=>row.mepId==='257043'&&row.category==='reports-shadow');
  assert(shadow);assert.equal(shadow.date,'2026-03-10');assert.equal(shadow.provenance.stage,'RDG1');
  const q=fixture.documents.find(d=>d.endpoint.startsWith('/parliamentary-questions'));
  const rows=documentRows(q.work,q.endpoint,fixture.verifiedAt).rows.filter(row=>row.mepId==='257043');
  assert.equal(rows.find(row=>row.recordKind==='document').date,'2026-07-16');
  assert.equal(rows.find(row=>row.recordKind==='answer').date,'2026-09-18');
});

test('HTTP joined endpoints read the persistent cache and validate categories, paging, methods and origin',async t=> {
  const dir=temp();process.env.ACTIVITY_INDEX_ENABLED='true';process.env.ACTIVITY_INDEX_DIR=dir;
  const {activityIndex}=await import('./activity-index-worker.mjs');const {store}=activityIndex();
  assert(store.acquire());const cycle=store.beginCycle();store.setMembers([{id:'257043',name:'MEP'}]);store.putSource(cycle.generation,'/q','document',projectDocument(question),fetchedAt,documentRows(question,'/q',fetchedAt).rows);
  const early={...question,id:'eli/dl/doc/E-10-2024-000001',identifier:'E-10-2024-000001',document_date:'2024-07-16',inverse_answers_to:[]};store.putSource(cycle.generation,'/parliamentary-questions/'+early.identifier,'document',projectDocument(early),fetchedAt,documentRows(early,'/parliamentary-questions/'+early.identifier,fetchedAt).rows);store.publish(cycle.generation);store.release();
  const {server}=await import('./index.mjs?activity-http-test');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});delete process.env.ACTIVITY_INDEX_ENABLED;delete process.env.ACTIVITY_INDEX_DIR;});
  assert.equal((await fetch(base+'/api/poc/activity-index/status')).status,200);
  const r=await fetch(base+'/api/poc/latest-activities/257043?lang=es&limit=1');assert.equal(r.status,200);assert.equal((await r.json()).items[0].recordKind,'document');
  for(const suffix of ['?limit=0','?limit=51','?offset=-1','?offset=1e2','?category=unknown','?url=https://evil.example','?limit=1&limit=2'])assert.equal((await fetch(base+'/api/poc/latest-activities/257043'+suffix)).status,400);
  assert.equal((await fetch(base+'/api/poc/latest-activities/257043',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/poc/latest-activities/257043',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(base+'/api/poc/latest-activities/42')).status,404);
  const head=await fetch(base+'/api/poc/latest-activities/257043',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const groupRoute=base+'/api/poc/insights/group-voices';
  const groupResponse=await fetch(groupRoute);assert.equal(groupResponse.status,200);assert.equal((await groupResponse.json()).coverage.authoritativeComplete,false);
  for(const suffix of ['?group=NI','?lang=__proto__','?person=abc','?limit=0','?group=S_D&group=PPE','?url=https://example.com'])assert.equal((await fetch(groupRoute+suffix)).status,400);
  assert.equal((await fetch(groupRoute,{method:'POST'})).status,405);assert.equal((await fetch(groupRoute,{headers:{Origin:'https://evil.example'}})).status,403);
  const groupHead=await fetch(groupRoute,{method:'HEAD'});assert.equal(groupHead.status,200);assert.equal(await groupHead.text(),'');
  const before=store.status();
  const insight='/poc/insights/questions?days=365&end=2026-10-13';
  for(const prefix of ['/api']) {
    const response=await fetch(base+prefix+insight);assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.counts.analyzedQuestions,1);
    assert.equal(body.questions[0].id,question.identifier);
    assert.equal(body.questions[0].authors.length,1);
    assert.equal(body.questions[0].answers[0].date,'2026-09-18');
    assert.equal(body.cache.readOnly,true);
    const h=await fetch(base+prefix+insight,{method:'HEAD'});assert.equal(h.status,200);assert.equal(await h.text(),'');
  }
  for(const days of ['term','366']) {
    const response=await fetch(base+'/api/poc/insights/questions?days='+days+'&end=2026-10-13');assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.counts.analyzedQuestions,days==='term'?2:1);
    if(days==='term'){assert.equal(body.window.start,'2024-07-16');assert(body.questions.some(q=>q.id===early.identifier));}
  }
  for(const suffix of ['?days=0','?days=999999','?days=90&days=90','?url=https://evil.example'])assert.equal((await fetch(base+'/api/poc/insights/questions'+suffix)).status,400);
  assert.equal((await fetch(base+'/api/poc/insights/legislation?url=https://evil.example')).status,400);
  assert.equal((await fetch(base+'/api/poc/insights/unknown')).status,404);
  assert.equal((await fetch(base+ '/api'+insight,{method:'POST'})).status,405);
  assert.equal((await fetch(base+ '/api'+insight,{headers:{Origin:'https://evil.example'}})).status,403);
  assert.deepEqual(store.status(),before);
});

test('official 204 pagination/feed endings are empty structured responses, not format failures',async()=> {
  const {apiFetch}=await import('./activity-index-worker.mjs');const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response(null,{status:204});
  try {assert.deepEqual((await apiFetch('/meps/show-current',{offset:719})).payload.data,[]);assert.equal((await apiFetch('/plenary-documents/feed',{},{xml:true})).xml,'<feed/>');}
  finally{globalThis.fetch=old;}
});

test('full-term speech indexing partitions the 10,000-hit search ceiling without date gaps',async()=> {
  const {speechWindows}=await import('./activity-index-worker.mjs');const windows=speechWindows('2026-10-13');
  assert.deepEqual(windows[0],{start:'2024-07-01',end:'2024-07-31'});assert.deepEqual(windows.at(-1),{start:'2026-10-01',end:'2026-10-13'});
  for(let i=1;i<windows.length;i++)assert.equal(Date.parse(windows[i].start)-Date.parse(windows[i-1].end),24*60*60_000);
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try {s.acquire();const cycle=s.beginCycle();const worker=new ActivityWorker(s,{clock:instant,fetchRecord:async()=>({payload:{data:[],meta:{total:10000}},fetchedAt})});
    const body={params:{'sitting-date':'2026-10-01','sitting-date-end':'2026-10-13'},offset:0};s.enqueue(cycle.generation,'full','speeches',body,100);
    await worker.task(s.nextTask(cycle.generation));
    const ranges=s.db.prepare('SELECT body FROM tasks WHERE generation=? AND done=0 ORDER BY key').all(cycle.generation).map(r=>JSON.parse(r.body).params);
    assert.deepEqual(ranges.map(r=>[r['sitting-date'],r['sitting-date-end']]),[['2026-10-01','2026-10-07'],['2026-10-08','2026-10-13']]);
  } finally{s.close();rmSync(dir,{recursive:true,force:true});}
});


test('accepted activity GUIDs resolve to exact source IDs without inventing categories or roles',()=> {
  for(const value of ['QEREP_E-10-2026-003031-ASW_EN','written-questions:E-10-2026-003031-ASW','E-10-2026-003031-ASW'])assert.equal(activitySourceId(value),'E-10-2026-003031-ASW');
  assert.equal(activitySourceId('QE_E-10-2026-003840_HU'),'E-10-2026-003840');
  assert.equal(activitySourceId('VD-ORAPL_2017097993206_202610071135_EN'),'MTG-PL-2026-10-07-OTH-2017097993206');
  assert.equal(activitySourceId('CRE-10-2026-10-07-INT-2017097993206_ES'),'MTG-PL-2026-10-07-OTH-2017097993206');
  for(const value of ['bad','../../secrets','https://evil.example',null,'x'.repeat(251)])assert.equal(activitySourceId(value),null);
});
test('selected source outside the first page remains accessible; incomplete and unsupported category totals stay unknown',()=> {
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try {s.acquire();const cycle=s.beginCycle();s.setMembers([{id:'257043',name:'MEP'}]);s.putSource(cycle.generation,'/q','document',question,fetchedAt,documentRows(question,'/q',fetchedAt).rows);
    const p=s.page('257043',{limit:1,sourceId:question.identifier});
    assert.equal(p.items[0].recordKind,'document');assert.equal(p.selectedItems[0].sourceId,question.identifier);assert.equal(p.selectedItems[0].id,'written-questions:'+question.identifier);assert.equal(p.total,null);
    assert.equal(p.categoryCoverage['reports-shadow'].total,null);
    s.publish(cycle.generation);
    assert.equal(s.page('257043',{category:'written-vote-explanations'}).total,null);
    assert.equal(s.page('257043').categoryCoverage['union-act-proposals'].status,'source-not-verified');
    assert.equal(CATEGORY_GROUPS.flatMap(group=>group.categories).length,11);
    assert.deepEqual(CATEGORY_GROUPS[1].categories,['written-vote-explanations','written-questions','individual-motions','union-act-proposals']);
    assert.equal(CATEGORIES['reports-shadow'],'Reports - as shadow rapporteur');
  } finally{s.close();rmSync(dir,{recursive:true,force:true});}
});


test('daily catalog reconciliation removes withdrawn documents only from the unpublished generation',()=> {
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try {s.acquire();let cycle=s.beginCycle();s.setMembers([{id:'257043'}]);s.putSource(cycle.generation,'/q','document',question,fetchedAt,documentRows(question,'/q',fetchedAt).rows);s.publish(cycle.generation);
    cycle=s.beginCycle();s.pruneUnseenDocuments(cycle.generation);assert.equal(s.page('257043').indexedTotal,1);s.publish(cycle.generation);assert.equal(s.page('257043').indexedTotal,0);
  } finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('search hit IDs control speech indexing; unmatched graph nodes do not become MEP activities',async()=> {
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try {s.acquire();const cycle=s.beginCycle();
    const activity=id=>({id,activity_id:id,activity_date:'2026-10-08',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:participant('SPEAKER')});
    const found=activity('MTG-PL-2026-10-08-OTH-123'),unrelated=activity('MTG-PL-2026-10-08-OTH-456');
    const worker=new ActivityWorker(s,{clock:instant,fetchRecord:async()=>({payload:{data:[unrelated,found],searchResults:{hits:[{id:found.id}]}},fetchedAt})});
    s.enqueue(cycle.generation,'speeches','speeches',{params:{},offset:0},100);await worker.task(s.nextTask(cycle.generation));
    assert.equal(s.sources(cycle.generation,'speech').length,1);assert.equal(s.sources(cycle.generation,'speech')[0].work.id,found.id);
  } finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('long initial loads reconcile records arriving after the starting calendar day before publication',()=> {
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try {s.acquire();const cycle=s.beginCycle();const worker=new ActivityWorker(s,{clock:()=>instant()+24*60*60_000});
    assert.equal(worker.catchUp(cycle),true);assert.equal(worker.catchUp(s.get('working')),false);
    const tasks=s.db.prepare('SELECT kind,body FROM tasks WHERE generation=?').all(cycle.generation);
    assert(tasks.some(task=>task.kind==='feed'));assert(tasks.some(task=>task.kind==='roster'));
    assert(tasks.filter(task=>task.kind==='catalog').every(task=>JSON.parse(task.body).deltaOnly===true));
  } finally{s.close();rmSync(dir,{recursive:true,force:true});}
});


test('missing answer dates do not become a false complete written-question count',()=> {
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try {s.acquire();const cycle=s.beginCycle();s.setMembers([{id:'257043'}]);
    const incomplete={...question,inverse_answers_to:question.inverse_answers_to.map(answer=>({...answer,document_date:null}))};
    const result=documentRows(incomplete,'/q',fetchedAt);
    s.putSource(cycle.generation,'/q','document',incomplete,fetchedAt,result.rows);s.publish(cycle.generation,result.unresolved);
    const page=s.page('257043',{category:'written-questions'});assert.equal(page.total,null);assert.equal(page.categoryCoverage['written-questions'].status,'incomplete-joins');assert.equal(page.categoryCoverage['reports-shadow'].status,'available');
  } finally{s.close();rmSync(dir,{recursive:true,force:true});}
});


test('missing EP search graph node stays as a durable detail retry while the available page records advance',async()=> {
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try {s.acquire();const cycle=s.beginCycle();s.setMembers([{id:'257043'}]);
    const activity=id=>({id:'eli/dl/event/'+id,activity_id:id,activity_date:'2026-05-20',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:participant('SPEAKER')});
    const found=activity('MTG-PL-2026-05-20-OTH-123'),missing=activity('MTG-PL-2026-05-20-OTH-456');let detailFails=true;
    const worker=new ActivityWorker(s,{clock:instant,fetchRecord:async ep=>{
      if(ep==='/speeches')return {payload:{data:[found],searchResults:{hits:[{id:found.id},{id:missing.id}]}},fetchedAt};
      assert.equal(ep,'/speeches/'+missing.activity_id);if(detailFails)throw new Error('EP API returned 500');
      return {payload:{data:[missing]},fetchedAt};
    }});
    s.enqueue(cycle.generation,'list','speeches',{params:{'sitting-date':'2026-05-01','sitting-date-end':'2026-05-31'},offset:500},100);
    await worker.task(s.nextTask(cycle.generation));
    const cursor=JSON.parse(s.db.prepare("SELECT body FROM tasks WHERE key='list'").get().body);assert.equal(cursor.offset,502);
    assert.equal(s.sources(cycle.generation,'speech').length,1);assert.equal(s.status().pendingSpeechRecoveries.count,1);
    const recovery=s.nextTask(cycle.generation);assert.equal(recovery.body.recoveryId,missing.activity_id);
    await assert.rejects(worker.task(recovery),/500/);s.failTask(recovery,new Error('EP API returned 500'));
    assert.equal(s.status().complete,false);assert.throws(()=>s.publish(cycle.generation),/incomplete/);
    detailFails=false;await worker.task(recovery);assert.equal(s.sources(cycle.generation,'speech').length,2);assert.equal(s.status().pendingSpeechRecoveries.count,0);
    assert.equal(s.page('257043').indexedTotal,2);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});


test('daily catch-up proceeds while a missing historical speech keeps the generation incomplete',async()=> {
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try{s.acquire();const cycle=s.beginCycle();s.updateCycle({initialized:true});
    s.enqueue(cycle.generation,'recovery:/speeches/old','speeches',{recoveryId:'MTG-PL-2026-05-20-OTH-456',params:{},offset:0},103);s.release();
    const worker=new ActivityWorker(s,{clock:()=>instant()+24*60*60_000,budget:1,fetchRecord:async ep=>{assert.equal(ep,'/meps/show-current');return {payload:{data:[{identifier:'257043',label:'MEP'}]},fetchedAt};}});
    await worker.run();assert.equal(s.get('working').catchupDay,'2026-10-14');assert.equal(s.status().complete,false);assert.equal(s.status().pendingSpeechRecoveries.count,1);
    assert(s.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='feed'").get().n>0);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('explicit feed refresh can rerun a completed source within the same unfinished generation',()=> {
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try{s.acquire();const cycle=s.beginCycle();s.enqueue(cycle.generation,'/q','document',{endpoint:'/q'},101);s.finishTask(s.nextTask(cycle.generation));
    s.enqueue(cycle.generation,'/q','document',{endpoint:'/q'},85);assert.equal(s.nextTask(cycle.generation),undefined);
    s.enqueue(cycle.generation,'/q','document',{endpoint:'/q'},85,true);assert.equal(s.nextTask(cycle.generation).key,'/q');
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});


test('real report shadows appear after their procedure arrives even while an unrelated speech remains pending',async()=> {
  const {readFile}=await import('node:fs/promises');const fixture=JSON.parse(await readFile(new URL('./fixtures/activity-index-live-20261013.json',import.meta.url),'utf8'));
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try{s.acquire();const cycle=s.beginCycle();s.setMembers([{id:'257043'}]);
    const report=fixture.documents.find(d=>d.endpoint.startsWith('/plenary-documents'));
    s.putSource(cycle.generation,report.endpoint,'document',report.work,fixture.verifiedAt,documentRows(report.work,report.endpoint,fixture.verifiedAt).rows);
    s.enqueue(cycle.generation,'recovery','speeches',{recoveryId:'MTG-PL-2026-05-20-OTH-456',params:{},offset:0},103);
    s.enqueue(cycle.generation,'/procedures/2025-0233','procedure',{endpoint:'/procedures/2025-0233'},104);
    assert.equal(s.page('257043',{category:'reports-shadow'}).indexedTotal,0);
    const worker=new ActivityWorker(s,{clock:instant,fetchRecord:async ep=>{assert.equal(ep,'/procedures/2025-0233');return {payload:{data:[fixture.procedure.work]},fetchedAt:fixture.verifiedAt};}});
    await worker.task(s.nextTask(cycle.generation));
    const page=s.page('257043',{category:'reports-shadow'});assert.equal(page.indexedTotal,1);assert.equal(page.items[0].sourceId,'A-10-2026-0049');assert.equal(page.items[0].date,'2026-03-10');assert.equal(page.items[0].provenance.stage,'RDG1');
    assert.equal(page.cache.complete,false);assert.equal(page.total,null);assert.equal(page.cache.pendingSpeechRecoveries.count,1);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});


test('existing partial reports/procedures are joined locally on upgrade without a source request or cursor reset',async()=> {
  const {readFile}=await import('node:fs/promises');const fixture=JSON.parse(await readFile(new URL('./fixtures/activity-index-live-20261013.json',import.meta.url),'utf8'));
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try{s.acquire();const cycle=s.beginCycle();s.updateCycle({initialized:true});s.setMembers([{id:'257043'}]);
    const report=fixture.documents.find(d=>d.endpoint.startsWith('/plenary-documents'));
    s.putSource(cycle.generation,report.endpoint,'document',report.work,fixture.verifiedAt,documentRows(report.work,report.endpoint,fixture.verifiedAt).rows);
    s.putSource(cycle.generation,'/procedures/2025-0233','procedure',fixture.procedure.work,fixture.verifiedAt);
    s.enqueue(cycle.generation,'recovery','speeches',{recoveryId:'MTG-PL-2026-05-20-OTH-456',params:{},offset:500},103);s.release();
    let requests=0;const worker=new ActivityWorker(s,{clock:instant,budget:0,fetchRecord:async()=>{requests++;throw new Error('No request expected');}});
    await worker.run();assert.equal(requests,0);assert.equal(s.get('working').generation,cycle.generation);assert.equal(s.get('working').reportJoinsReady,true);
    assert.equal(s.page('257043',{category:'reports-shadow'}).indexedTotal,1);assert.equal(s.status().complete,false);
    assert.equal(JSON.parse(s.db.prepare("SELECT body FROM tasks WHERE key='recovery'").get().body).offset,500);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('title projection upgrade queues only legacy procedures, preserves cursors and records absent titles once',async()=> {
  const dir=temp(),s=new ActivityStore(dir,{clock:instant});
  try {
    s.acquire();const {generation}=s.beginCycle();s.updateCycle({initialized:true,reportJoinsReady:true});
    const key='/procedures/2025-0233';
    s.putSource(generation,key,'procedure',procedure,fetchedAt);
    s.enqueue(generation,key,'procedure',{endpoint:key},103);s.finishTask({generation,key});
    s.putSource(generation,'/procedures/2025-0234','procedure',projectProcedure({...procedure,id:'eli/dl/proc/2025-0234',process_title:{en:'Saved title'}}),fetchedAt);
    s.putSource(generation,'/procedures/2025-0235','procedure',projectProcedure({...procedure,id:'eli/dl/proc/2025-0235'}),fetchedAt);
    s.enqueue(generation,'recovery','speeches',{offset:500,recoveryId:'MTG-PL-2026-05-20-OTH-456'},103);s.release();
    let requests=0;
    const worker=new ActivityWorker(s,{clock:instant,budget:0,fetchRecord:async endpoint=>{requests++;assert.equal(endpoint,key);return {payload:{data:[procedure]},fetchedAt};}});
    await worker.run();await worker.run();
    assert.equal(requests,0);assert.equal(s.get('working').procedureTitlesQueued,true);
    const tasks=s.db.prepare("SELECT * FROM tasks WHERE generation=? AND kind='procedure'").all(generation);
    assert.equal(tasks.length,1);assert.equal(tasks[0].done,0);assert.equal(tasks[0].priority,104);
    assert.equal(JSON.parse(s.db.prepare("SELECT body FROM tasks WHERE key='recovery'").get().body).offset,500);
    s.acquire();await worker.task({...tasks[0],body:JSON.parse(tasks[0].body)});
    assert.equal(requests,1);assert.equal(s.source(generation,key).work.process_title,null);
    assert.equal(s.db.prepare("SELECT json_type(body,'$.process_title') type FROM sources WHERE generation=? AND key=?").get(generation,key).type,'null');
  } finally {s.close();rmSync(dir,{recursive:true,force:true});}
});
