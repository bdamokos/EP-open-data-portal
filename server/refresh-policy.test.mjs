import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker,feedDocuments} from './activity-index-worker.mjs';
import {projectDocument} from './activity-index-model.mjs';
import {scheduleSittingOutcomes} from './amendments-worker.mjs';
import {AMENDMENTS_VERSION,AMENDMENT_SITTING_PROJECTION_VERSION} from './amendments.mjs';
import {DAY,MUTABLE_LIMIT,GAP_LIMIT,documentRefreshState,scheduleMutable,scheduleGapRecovery,gapRecoveryDue,recordTaskGap,sittingConfirmationDay,sittingOutcomesComplete} from './refresh-policy.mjs';
import {mutableRecoveryDue,mutableDocumentCandidates,mutableCandidateSql} from './mutable-document-recovery.mjs';
import {auditMutableAdmission} from './data-gap-audit.mjs';

const languages='bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(' ');
const files=n=>languages.slice(0,n).map(language=>({language,is_embodied_by:[{format:'DOCX',is_exemplified_by:`https://data.europarl.europa.eu/distribution/test/${language}.docx`}]}));
const document=(extra={})=>({identifier:'E-10-2026-000001',work_type:'def/ep-document-types/QUESTION_WRITTEN',document_date:'2026-09-01',parliamentary_term:'org/ep-10',workHadParticipation:[],is_realized_by:files(24),inverse_answers_to:[],...extra});
function setup(t,at='2026-10-20T10:00:00Z') {
  const directory=mkdtempSync(path.join(os.tmpdir(),'refresh-policy-'));let now=Date.parse(at);
  const clock=()=>now,store=new ActivityStore(directory,{clock});store.acquire();const {generation}=store.beginCycle();
  const worker=new ActivityWorker(store,{clock,fetchRecord:async()=>{throw new Error('Unexpected upstream request');}});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,generation,worker,clock,advance:ms=>{store.release();now+=ms;assert(store.acquire());}};
}
const sitting='MTG-PL-2026-10-07';
const complete=()=>({results:[{id:'result'}],decisions:[{id:'decision'}],coverage:{missingResultIds:[],missingDecisionIds:[]},splitRequests:[],amendmentVersion:AMENDMENTS_VERSION,amendmentProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION});

test('backfill recovers due gaps between daily cycles without resetting future retries or saved cursors',t=>{
  const {store,generation,worker,clock,advance}=setup(t);
  for(let i=0;i<28;i++) {
    const key='recover:'+i,body={endpoint:'/parliamentary-questions/E-10-2026-'+i,offset:150};
    store.enqueue(generation,key,'document',body,84);
    recordTaskGap(worker,{generation,key,kind:'document',body,priority:84,attempts:4},new Error('EP API returned 500'));
  }
  store.publish(generation);store.set('lastSuccess',new Date(clock()).toISOString());
  worker.recoveryMode='backfill';
  assert.equal(gapRecoveryDue(store,generation,clock()),false);
  advance(7*DAY);store.set('lastSuccess',new Date(clock()).toISOString());
  // Ignore other optional upgrade triggers: the recovery-specific predicate is
  // independent of a daily core refresh and preserves recorded admission state.
  assert.equal(worker.coreDue(),false);assert.equal(gapRecoveryDue(store,generation,clock()),true);
  assert.equal(scheduleGapRecovery(worker,generation),25);
  assert.equal(store.taskCounts(generation).total-store.taskCounts(generation).completed,25);
  const first=store.nextTask(generation);assert.equal(first.body.offset,150);assert.equal(first.attempts,5);
  assert.equal(scheduleGapRecovery(worker,generation),0);
  store.finishTask(first);
  assert.equal(scheduleGapRecovery(worker,generation),1);
  assert.equal(scheduleGapRecovery(worker,generation),0);
  assert.equal(gapRecoveryDue(store,generation,clock()),false,'full in-flight queue waits for its owners');
  assert.equal(store.get('working'),null);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps').get().n,27,'admission leaves coverage gaps visible');
  store.finishTask(store.nextTask(generation));
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps').get().n,26,'only successful completion clears its gap');
  assert.equal(store.get('slowGapAdmissions'),null,'daily counters are retired');
});

test('idle backfill publishes recovered questions and Following marks in a new frozen generation',async t=>{
  const {store,generation,worker,clock}=setup(t);
  store.setMembers([{id:'42',name:'Member'}]);store.publish(generation);
  const key='/parliamentary-questions/E-10-2026-000001';
  store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,key,'document',JSON.stringify({endpoint:key}),84,'EP API returned 500',5,new Date(clock()-8*DAY).toISOString(),clock()-1,null);
  worker.recoveryMode='backfill';
  worker.fetchRecord=async()=>({fetchedAt:new Date(clock()).toISOString(),payload:{data:[document({id:'eli/dl/doc/E-10-2026-000001',creator:['person/42']})]}});
  const runTask=worker.task.bind(worker);
  // Leave the actual recovered document and publication paths intact while
  // settling unrelated discovery jobs without upstream fixture traffic.
  worker.task=async task=>task.key===key?runTask(task):store.finishTask(task);
  assert.equal(worker.coreDue(),false);store.release();await worker.runIteration();
  const active=store.get('active');assert.notEqual(active,generation);assert.equal(store.get('working'),null);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=? AND source_id=?').get(generation,'E-10-2026-000001').n,0,'old serving rows stay frozen');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=? AND source_id=?').get(active,'E-10-2026-000001').n,1);
  assert.equal(store.db.prepare("SELECT mark FROM item_marks WHERE mep='42' AND source_id='E-10-2026-000001'").get()?.mark,active);
  assert.equal(store.db.prepare("SELECT activity_count FROM follow_summary WHERE generation=? AND mep='42'").get(active)?.activity_count,1);
  assert.equal(store.db.prepare("SELECT activity_count FROM follow_summary WHERE generation=? AND mep='42'").get(generation)?.activity_count,0);
});

test('multiple admission batches share one working generation and publish only after due recovery is admitted',async t=>{
  const {store,generation,worker,clock}=setup(t);
  store.setMembers([{id:'42',name:'Member'}]);store.publish(generation);
  for(let i=1;i<=28;i++) {
    const key='/parliamentary-questions/E-10-2026-'+String(i).padStart(6,'0');
    store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,key,'document',JSON.stringify({endpoint:key}),84,'EP API returned 500',5,new Date(clock()-8*DAY).toISOString(),clock()-1,null);
  }
  worker.recoveryMode='backfill';worker.budget=25;
  worker.fetchRecord=async endpoint=>({fetchedAt:new Date(clock()).toISOString(),payload:{data:[document({identifier:endpoint.split('/').at(-1),id:'eli/dl/doc/'+endpoint.split('/').at(-1),creator:['person/42']})]}});
  const runTask=worker.task.bind(worker);
  worker.task=async task=>task.key.startsWith('/parliamentary-questions/')?runTask(task):store.finishTask(task);
  store.release();await worker.runIteration();
  assert.equal(store.get('active'),generation);const working=store.get('working').generation;
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=?').get(working).n,25);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM item_marks').get().n,0);
  await worker.runIteration();
  assert.equal(store.get('active'),working);assert.equal(store.get('working'),null);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=?').get(working).n,28);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM item_marks').get().n,28);
  assert.equal(store.db.prepare("SELECT activity_count FROM follow_summary WHERE generation=? AND mep='42'").get(working).activity_count,28);
});

for(const mode of ['normal','backfill'])test(mode+' mutable admission preserves frozen publication while respecting its batch policy',async t=>{
  const {store,generation,worker,clock,advance}=setup(t);store.setMembers([{id:'42',name:'Member'}]);
  for(let i=1;i<=205;i++) {
    const id='E-10-2026-'+String(i).padStart(6,'0');
    store.putSource(generation,'/parliamentary-questions/'+id,'document',projectDocument(document({id:'eli/dl/doc/'+id,identifier:id,creator:['person/42']})),new Date(clock()-8*DAY).toISOString());
  }
  store.publish(generation);if(mode==='normal')advance(DAY);
  worker.recoveryMode=mode;worker.budget=100;
  worker.fetchRecord=async endpoint=>({fetchedAt:new Date(clock()).toISOString(),payload:{data:[document({id:'eli/dl/doc/'+endpoint.split('/').at(-1),identifier:endpoint.split('/').at(-1),creator:['person/42']})]}});
  const task=worker.task.bind(worker);worker.task=async job=>job.key.startsWith('/parliamentary-questions/')?task(job):store.finishTask(job);
  assert.equal(mutableRecoveryDue(store,generation,clock()),true);
  if(mode==='backfill')assert.equal(worker.coreDue(),false,'mutable backlog wakes between daily cycles');
  store.release();await worker.runIteration();
  const working=store.get('working').generation,start=store.get('working').startedAt;
  assert.equal(store.get('active'),generation);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM item_marks').get().n,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=?').get(working).n,100);
  assert.equal(auditMutableAdmission(store.db,working,clock()).eligibleDue,6);
  await worker.runIteration();assert.equal(store.get('working').generation,working);assert.equal(store.get('working').startedAt,start);
  assert.equal(store.get('active'),generation);assert.equal(auditMutableAdmission(store.db,working,clock()).eligibleDue,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=?').get(working).n,200);
  await worker.runIteration();assert.equal(store.get('active'),working);assert.equal(store.get('working'),null);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=?').get(generation).n,0,'prior serving rows remain frozen');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM item_marks').get().n,205);
  assert.equal(store.db.prepare("SELECT activity_count FROM follow_summary WHERE generation=? AND mep='42'").get(working).activity_count,205);
  assert.equal(mutableRecoveryDue(store,working,clock()),false);
});

test('mutable admissions preserve canonical, amendment, gap and deferred owners and their clocks',t=>{
  const {store,generation,worker,clock}=setup(t);worker.recoveryMode='backfill';
  const stamp=new Date(clock()-8*DAY).toISOString();
  for(const key of ['canonical','amendment','gap','deferred','ready','future'])store.putSource(generation,key,'document',projectDocument(document()),stamp);
  const body={endpoint:'canonical',offset:150,stage:'pages'};
  store.enqueue(generation,'canonical','document',body,90);
  store.db.prepare('UPDATE tasks SET attempts=3,error=?,retry_at=? WHERE key=?').run('EP API returned 500',clock()+DAY,'canonical');
  store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(generation,'amendment','document',JSON.stringify({...body,endpoint:'amendment'}),90,0,3,clock()+DAY,'retry');
  store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,'gap','document',JSON.stringify({...body,endpoint:'gap'}),90,'EP API returned 500',5,stamp,clock()+DAY,null);
  store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[{key:'deferred',kind:'document',body:JSON.stringify({...body,endpoint:'deferred'}),retry_at:clock()+DAY,attempts:3}],discovery:[],completed:[]},stamp);
  store.db.prepare('UPDATE mutable_documents SET next_check=? WHERE key=?').run(clock()+DAY,'future');
  const state=()=>JSON.stringify({tasks:store.db.prepare("SELECT * FROM tasks WHERE key='canonical'").all(),amendments:store.db.prepare('SELECT * FROM amendment_jobs').all(),gaps:store.db.prepare('SELECT * FROM refresh_gaps').all(),deferred:store.source(generation,'amendment:continuations'),clocks:store.db.prepare("SELECT * FROM mutable_documents WHERE key<>'ready' ORDER BY key").all()});
  const before=state(),changes=store.db.prepare('SELECT total_changes() n').get().n;
  const report=auditMutableAdmission(store.db,generation,clock());assert.deepEqual(report.candidates.map(row=>row.key),['ready']);
  assert.equal(store.db.prepare('SELECT total_changes() n').get().n,changes,'audit is read-only');
  assert.equal(scheduleMutable(worker,generation),1);assert.equal(state(),before);assert.equal(mutableRecoveryDue(store,generation,clock()),false);
  store.release();assert.throws(()=>scheduleMutable(worker,generation),/lease/i);
  const plan=store.db.prepare('EXPLAIN QUERY PLAN '+mutableCandidateSql).all(generation,clock()).map(row=>row.detail).join(' ');
  assert.match(plan,/COVERING INDEX mutable_document_due/);assert.doesNotMatch(plan,/TEMP B-TREE/);
});

test('a transient mutable failure keeps its retry while later batches refresh and publish normally',async t=>{
  const {store,generation,worker,clock,advance}=setup(t),failed='/parliamentary-questions/E-10-2026-000001';
  for(let i=1;i<=102;i++) {
    const id='E-10-2026-'+String(i).padStart(6,'0');
    store.putSource(generation,'/parliamentary-questions/'+id,'document',projectDocument(document({id:'eli/dl/doc/'+id,identifier:id})),new Date(clock()-8*DAY).toISOString());
  }
  store.setMembers([{id:'42',name:'Member'}]);store.publish(generation);worker.recoveryMode='backfill';
  worker.fetchRecord=async endpoint=>{
    if(endpoint===failed)throw new Error('EP API returned 500');
    const id=endpoint.split('/').at(-1);return {fetchedAt:new Date(clock()).toISOString(),payload:{data:[document({id:'eli/dl/doc/'+id,identifier:id,creator:['person/42']})]}};
  };
  const task=worker.task.bind(worker);worker.task=async job=>job.key.startsWith('/parliamentary-questions/')?task(job):store.finishTask(job);
  store.release();await worker.runIteration();const working=store.get('working').generation;
  const pending=()=>store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(working,failed);
  const originalRetry=pending().retry_at;
  await worker.runIteration();assert.equal(pending().retry_at,originalRetry,'admission does not reset a future execution retry');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=?').get(working).n,101,'other data advances while one source is unavailable');
  assert.equal(store.get('active'),generation);
  while(pending().done!==1) {
    advance(pending().retry_at-clock()+1);store.release();await worker.runIteration();
  }
  assert.equal(store.get('active'),working);assert.equal(store.get('working'),null);
  const gap=store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=? AND key=?').get(working,failed);
  assert(gap.retry_at>clock());assert.match(gap.error,/500/);assert.equal(mutableRecoveryDue(store,working,clock()),false);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=?').get(working).n,101);
});

test('mutable admission and reservation clocks roll back together when a batch fails',t=>{
  const {store,generation,worker,clock}=setup(t);worker.recoveryMode='backfill';
  for(const key of ['first','second'])store.putSource(generation,key,'document',projectDocument(document()),new Date(clock()-8*DAY).toISOString());
  const before=JSON.stringify(store.db.prepare('SELECT * FROM mutable_documents ORDER BY key').all());
  const enqueue=store.enqueue.bind(store);let calls=0;
  store.enqueue=(...args)=>{if(++calls===2)throw Error('Injected admission failure');return enqueue(...args);};
  assert.throws(()=>scheduleMutable(worker,generation),/Injected admission failure/);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
  assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM mutable_documents ORDER BY key').all()),before);
});

test('later mutable deadlines do not extend a long-running generation cohort',async t=>{
  const {store,generation,worker,clock,advance}=setup(t),old='/parliamentary-questions/E-10-2026-000001',later='/parliamentary-questions/E-10-2026-000002';
  for(const key of [old,later])store.putSource(generation,key,'document',projectDocument(document({id:'eli/dl/doc/'+key.split('/').at(-1),identifier:key.split('/').at(-1)})),new Date(clock()-(key===old?8:6)*DAY).toISOString());
  store.setMembers([{id:'42',name:'Member'}]);store.publish(generation);worker.recoveryMode='backfill';worker.budget=1;
  worker.fetchRecord=async endpoint=>{
    assert.equal(endpoint,old,'a later deadline belongs to the next generation');
    return {fetchedAt:new Date(clock()).toISOString(),payload:{data:[document({id:'eli/dl/doc/'+endpoint.split('/').at(-1),identifier:endpoint.split('/').at(-1),creator:['person/42']})]}};
  };
  const task=worker.task.bind(worker);worker.task=async job=>job.key.startsWith('/parliamentary-questions/')?task(job):store.finishTask(job);
  store.release();await worker.runIteration();const working=store.get('working').generation,start=Date.parse(store.get('working').startedAt);
  advance(2*DAY);store.release();
  const report=auditMutableAdmission(store.db,working,clock());assert.equal(report.cutoffAt,start);assert.equal(report.eligibleDue,0);
  assert.equal(mutableRecoveryDue(store,working,clock()),false);
  await worker.runIteration();assert.equal(store.get('active'),working);assert.equal(store.get('working'),null);
  assert.equal(store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=?').get(working,later),undefined);
  assert.equal(mutableRecoveryDue(store,working,clock()),true,'the next generation can recover the now-overdue deadline');
});

test('mutable policy counts distinct observed official file languages and answer languages',()=>{
  const unanswered=projectDocument(document());
  assert.equal(documentRefreshState(unanswered).mutable,true);
  assert.equal(documentRefreshState(unanswered).answered,false);
  const answer=document({identifier:'E-10-2026-000001-ASW',work_type:'QUESTION_WRITTEN_ANSWER'});
  const answered=projectDocument(document({inverse_answers_to:[answer]}));
  assert.deepEqual(documentRefreshState(answered),{languageCount:24,answered:true,mutable:false});
  assert.equal(documentRefreshState({...answered,is_realized_by:files(23)}).mutable,true);
  assert.equal(documentRefreshState({...answered,inverse_answers_to:[{...answer,is_realized_by:files(23)}]}).mutable,true);
  assert.equal(documentRefreshState({...answered,is_realized_by:[...files(23),...files(23)]}).languageCount,23);
  assert.equal(documentRefreshState(projectDocument(document({work_type:'QUESTION_ORAL'}))).mutable,true);
  assert.equal(documentRefreshState(projectDocument(document({work_type:'REPORT_PLENARY'}))).mutable,false);
  const absent=document();delete absent.is_realized_by;delete absent.inverse_answers_to;
  assert.deepEqual(documentRefreshState(projectDocument(absent)),{languageCount:null,answered:null,mutable:true});
  assert.equal(documentRefreshState(projectDocument(document({is_realized_by:[]}))).languageCount,0);
  assert.equal(documentRefreshState(projectDocument(document({is_realized_by:null}))).languageCount,null);
});

test('indexed weekly rechecks are capped, fair and keep their cadence across snapshot copies',t=>{
  const {store,generation,worker,clock,advance}=setup(t);
  for(let i=0;i<MUTABLE_LIMIT+2;i++)store.putSource(generation,'/q/'+String(i).padStart(3,'0'),'document',projectDocument(document()),new Date(clock()-8*DAY).toISOString());
  store.putSource(generation,'/final','document',projectDocument(document({work_type:'REPORT_PLENARY'})),new Date(clock()-100*DAY).toISOString());
  scheduleMutable(worker,generation);
  assert.equal(store.taskCounts(generation).total,MUTABLE_LIMIT);
  assert.equal(store.db.prepare("SELECT 1 FROM tasks WHERE key='/final'").get(),undefined);
  assert.match(store.db.prepare('EXPLAIN QUERY PLAN SELECT key FROM mutable_documents WHERE generation=? AND next_check<=? ORDER BY next_check,key LIMIT 100').all(generation,clock()).map(row=>row.detail).join(' '),/COVERING INDEX mutable_document_due/);
  for(const task of store.db.prepare('SELECT * FROM tasks').all())store.finishTask(task);
  store.publish(generation);const next=store.beginCycle();scheduleMutable(worker,next.generation);
  assert.equal(store.taskCounts(next.generation).total,2);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM mutable_documents WHERE generation=? AND next_check<=?').get(next.generation,clock()).n,0);
  advance(7*DAY);scheduleMutable(worker,next.generation);
  assert.equal(store.taskCounts(next.generation).total,MUTABLE_LIMIT);
});

test('initial generation publishes with exact durable gaps instead of hundreds of retries',async t=>{
  const {store,generation,worker,clock}=setup(t);
  for(let i=0;i<14;i++) {
    const kind=i<8?'speeches':i<13?'motion-outcomes':'document';
    const body=kind==='speeches'?{recoveryId:`MTG-PL-2026-09-16-OTH-${i+1}`,offset:250,searchWindow:{start:'2026-09-01',end:'2026-09-30'}}:kind==='motion-outcomes'?{sittingId:`MTG-PL-2025-11-${String(i+1).padStart(2,'0')}`,stage:'decisions',offset:0,results:[],decisions:[],sources:[]}: {endpoint:'/parliamentary-questions/E-10-2026-004060'};
    store.enqueue(generation,'stuck:'+i,kind,body,103);
    store.db.prepare('UPDATE tasks SET attempts=309,error=?,retry_at=? WHERE generation=? AND key=?').run('EP API returned 500.',clock()+DAY,generation,'stuck:'+i);
  }
  worker.fetchRecord=async(endpoint,params)=>({fetchedAt:new Date(clock()).toISOString(),payload:{data:endpoint==='/meps/show-current'&&params.offset===0?[{identifier:'42',label:'Member'}]:/^\/plenary-documents\/[^/]+$/.test(endpoint)?[document({identifier:endpoint.split('/').at(-1),work_type:'REPORT_PLENARY'})]:[]},xml:'<feed/>'});
  store.release();await worker.run();
  assert.equal(store.get('active'),generation);assert.equal(store.get('working'),null);
  assert.equal(store.get('lastSuccess'),new Date(clock()).toISOString());
  assert.equal(store.status().complete,false);assert.equal(store.status().coverageGaps.count,14);
  assert.equal(store.page('42').total,store.page('42').indexedTotal);assert.equal(store.page('42').categoryCoverage['written-questions'].status,'available');
  const saved=store.db.prepare("SELECT body FROM refresh_gaps WHERE key='stuck:0'").get();assert.equal(JSON.parse(saved.body).offset,250);
  assert(store.acquire());const next=store.beginCycle();await worker.initialize(next);
  assert.equal(store.get('working').fullRefresh,false);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE generation=? AND kind='catalog'").get(next.generation).n,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps WHERE generation=?').get(next.generation).n,14);
});

test('recorded failures retry on a capped slow queue, preserve cursors, and clear only on success',t=>{
  const {store,generation,worker,clock,advance}=setup(t);
  for(let i=0;i<GAP_LIMIT+2;i++) {
    store.enqueue(generation,'failure:'+i,'document',{endpoint:'/q/'+i,offset:750},90);
    const task={...store.nextTask(generation),attempts:4};
    assert(recordTaskGap(worker,task,new Error('Source unavailable')));
  }
  scheduleMutable(worker,generation);assert.equal(store.taskCounts(generation).completed,GAP_LIMIT+2);
  advance(7*DAY);scheduleMutable(worker,generation);
  const pending=store.db.prepare('SELECT * FROM tasks WHERE done=0').all();assert.equal(pending.length,GAP_LIMIT);
  assert.equal(JSON.parse(pending[0].body).offset,750);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps').get().n,GAP_LIMIT+2);
  store.finishTask(pending[0]);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps').get().n,GAP_LIMIT+1);
});

test('initial publication with core gaps unlocks exact Outside context recovery in the next generation',async t=>{
  const {store,generation,worker,clock,advance}=setup(t);
  store.putSource(generation,'outside:state','outside-state',{version:1},new Date(clock()).toISOString());
  const contextKey='outside:procedure:2025-9999',contextBody={id:'2025-9999'};
  store.enqueue(generation,contextKey,'outside-procedure',contextBody,101);
  assert(worker.failOutside({...store.nextTask(generation),attempts:2},new Error('Context unavailable')));
  store.enqueue(generation,'stuck-core','document',{endpoint:'/unavailable'},103);
  store.db.prepare("UPDATE tasks SET attempts=309,error='Unavailable',retry_at=? WHERE generation=? AND key='stuck-core'").run(clock()+DAY,generation);
  worker.fetchRecord=async(endpoint,params)=>({fetchedAt:new Date(clock()).toISOString(),payload:{data:endpoint==='/meps/show-current'&&params.offset===0?[{identifier:'42',label:'Member'}]:/^\/plenary-documents\/[^/]+$/.test(endpoint)?[document({identifier:endpoint.split('/').at(-1),work_type:'REPORT_PLENARY'})]:[]},xml:'<feed/>'});
  store.release();await worker.run();
  assert.equal(store.get('active'),generation);assert.equal(store.get('working'),null);
  assert(store.source(generation,'outside:gap:'+contextKey));assert.equal(store.status().complete,false);
  advance(DAY);const cycle=store.beginCycle();worker.initializeOutside(cycle);
  const retry=store.nextTask(cycle.generation);assert.equal(retry.key,contextKey);assert.deepEqual(retry.body,contextBody);
  assert.equal(store.taskCounts(cycle.generation).total,1,'only the exact saved optional gap is reopened');
  worker.fetchRecord=async(endpoint)=>{assert.equal(endpoint,'/procedures/2025-9999');return {fetchedAt:new Date(clock()).toISOString(),payload:{data:[{id:'https://data.europarl.europa.eu/eli/dl/proc/2025-9999',process_type:'def/ep-procedure-types/COD'}]}};};
  await worker.task(retry);worker.finishOutsideGap(retry);store.publish(cycle.generation);
  assert.equal(store.source(cycle.generation,'outside:gap:'+contextKey),undefined);
  assert(store.source(cycle.generation,contextKey));
  assert.equal(store.status().complete,false,'the unrelated unavailable core observation remains an explicit gap');
});

test('feeds use supported parameters and missed days never trigger detail refreshes of final records',async t=>{
  const {store,generation,worker,clock}=setup(t);
  store.putSource(generation,'/plenary-documents/A-10-2026-000001','document',projectDocument(document({work_type:'REPORT_PLENARY'})),new Date(clock()-40*DAY).toISOString());
  store.publish(generation);store.set('lastSuccess',new Date(clock()-10*DAY).toISOString());const next=store.beginCycle();
  await worker.initialize(next);
  assert.equal(store.get('working').fullRefresh,false);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE generation=? AND kind='catalog'").get(next.generation).n,0);
  const calls=[];worker.fetchRecord=async(endpoint,params)=>{calls.push({endpoint,params});return {fetchedAt:new Date(clock()).toISOString(),xml:endpoint==='/procedures/feed'?'<feed/>':'<feed><entry><id>https://data.europarl.europa.eu/eli/dl/doc/A-10-2026-000001</id><updated>2026-10-20</updated></entry></feed>'};};
  for(const row of store.db.prepare("SELECT * FROM tasks WHERE generation=? AND kind='feed'").all(next.generation))await worker.task({...row,body:JSON.parse(row.body)});
  assert.deepEqual(calls.find(call=>call.endpoint==='/procedures/feed').params,{timeframe:'custom','start-date':'2026-10-08'});
  assert.deepEqual(calls.find(call=>call.endpoint==='/plenary-documents/feed').params,{});
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE generation=? AND kind='document' AND key='/plenary-documents/A-10-2026-000001'").get(next.generation).n,0);
});

test('missed monthly windows expose a persistent gap and discover IDs without refetching retained details',async t=>{
  const {store,generation,worker,clock}=setup(t);store.publish(generation);store.set('lastSuccess',new Date(clock()-60*DAY).toISOString());
  const next=store.beginCycle();await worker.initialize(next);
  assert.equal(store.status().coverageGaps.count,0,'active coverage is unaffected by an unpublished refresh');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps WHERE generation=?').get(next.generation).n,3);
  assert(store.db.prepare("SELECT 1 FROM tasks WHERE generation=? AND kind='catalog'").get(next.generation));
  assert.throws(()=>feedDocuments('<feed><link rel="next" href="https://data.europarl.europa.eu/next"/></feed>','/plenary-documents'),/another page/);
});

test('correction boundary covers Friday noon of the second following week plus a safety margin',t=>{
  assert.equal(sittingConfirmationDay(sitting),'2026-10-24');
  assert.equal(sittingConfirmationDay('MTG-PL-2026-10-05'),'2026-10-24');
  assert.equal(sittingConfirmationDay('MTG-PL-2026-10-09'),'2026-10-24');
  for(const [now,fetched,expected] of [
    ['2026-10-21T10:00Z','2026-10-21T09:00Z',false], // day 14
    ['2026-10-22T10:00Z','2026-10-22T09:00Z',false], // day 15, corrections still open
    ['2026-10-23T23:00Z','2026-10-23T20:00Z',true], // Saturday in Brussels
    ['2026-10-24T10:00Z','2026-10-24T09:00Z',false],
    ['2027-10-24T10:00Z','2026-10-24T09:00Z',false],
  ]) {
    const {store,generation,worker}=setup(t,now);
    store.putSource(generation,'motion-outcomes:'+sitting,'motion-outcomes',complete(),fetched);
    assert.equal(scheduleSittingOutcomes(worker,generation,sitting),expected,now);
  }
});

test('finality survives snapshot copying while incomplete evidence and projection upgrades reopen it',t=>{
  const {store,generation,worker,clock}=setup(t,'2026-11-20T10:00Z');
  store.putSource(generation,'motion-outcomes:'+sitting,'motion-outcomes',complete(),'2026-10-24T10:00Z');
  store.publish(generation);const next=store.beginCycle();assert.equal(scheduleSittingOutcomes(worker,next.generation,sitting),false);
  for(const patch of [{truncated:true},{lastRefreshFailure:{attemptedAt:'2026-10-25'}},{splitProjectionTruncated:true},{amendmentProjectionVersion:0},{retainedEvidence:true},{coverage:{missingResultIds:['missing'],missingDecisionIds:[]}}]) {
    store.putSource(next.generation,'motion-outcomes:'+sitting,'motion-outcomes',{...complete(),...patch},new Date(clock()).toISOString());
    assert.equal(sittingOutcomesComplete({...complete(),...patch}),false);
    assert.equal(scheduleSittingOutcomes(worker,next.generation,sitting),true,JSON.stringify(patch));
    store.db.prepare("DELETE FROM tasks WHERE generation=? AND kind='motion-outcomes'").run(next.generation);
  }
});

test('recent outcomes remain eligible every six hours even after a successful attempt earlier that day',t=>{
  const {store,generation,worker,clock,advance}=setup(t,'2026-10-08T08:00Z');
  store.putSource(generation,'motion-outcomes:'+sitting,'motion-outcomes',complete(),new Date(clock()-6*60*60_000).toISOString());
  assert.equal(scheduleSittingOutcomes(worker,generation,sitting),true);store.finishTask(store.nextTask(generation));
  store.putSource(generation,'motion-outcomes:'+sitting,'motion-outcomes',complete(),new Date(clock()).toISOString());
  assert.equal(scheduleSittingOutcomes(worker,generation,sitting),false);
  advance(6*60*60_000);assert.equal(scheduleSittingOutcomes(worker,generation,sitting),true);
});

test('continuation sitting lookups stay indexed and preserve checkpoints through replacement and deletion',t=>{
  const {store,generation,worker}=setup(t);
  const task={key:'durable-sitting',kind:'motion-outcomes',body:JSON.stringify({sittingId:sitting,stage:'decisions',offset:50}),done:0};
  store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[task],discovery:[],completed:[]},'2026-10-20');
  assert.equal(scheduleSittingOutcomes(worker,generation,sitting),false);
  const plan=store.db.prepare("EXPLAIN QUERY PLAN SELECT 1 FROM continuation_sittings WHERE generation=? AND sitting_id=? AND bucket IN ('tasks','discovery') LIMIT 1").all(generation,sitting).map(row=>row.detail).join(' ');
  assert.match(plan,/SEARCH .*COVERING INDEX/);assert.doesNotMatch(plan,/SCAN|json_each/);
  store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[],discovery:[],completed:[]},'2026-10-20');
  assert.equal(scheduleSittingOutcomes(worker,generation,sitting),true);
  store.db.prepare("DELETE FROM sources WHERE generation=? AND key='amendment:continuations'").run(generation);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM continuation_sittings').get().n,0);
});

test('refresh preparation is explicit, lease guarded, additive and preserves saved publication and cursors',async t=>{
  const {prepareIndexes}=await import('./migrate-indexes.mjs');
  const {store,generation,clock}=setup(t);
  const work=projectDocument(document());store.putSource(generation,'/q','document',work,'2026-10-01');store.publish(generation);
  const cycle=store.beginCycle();store.enqueue(cycle.generation,'saved','document',{endpoint:'/q',offset:750},100);
  const before=store.source(generation,'/q');store.set('refreshPolicyVersion',null);store.db.exec('DELETE FROM mutable_documents');
  assert.throws(()=>new ActivityStore(path.dirname(store.filename),{clock}),/migrate-indexes/);
  assert.throws(()=>prepareIndexes({activityDirectory:path.dirname(store.filename),clock,log:()=>{}}),/writer lease is active/);
  store.release();const [result]=prepareIndexes({activityDirectory:path.dirname(store.filename),clock,log:()=>{}});
  assert.equal(result.noop,false);assert.equal(store.get('active'),generation);assert.equal(store.get('working').generation,cycle.generation);
  assert.deepEqual(store.source(generation,'/q'),before);
  assert.equal(JSON.parse(store.db.prepare("SELECT body FROM tasks WHERE key='saved'").get().body).offset,750);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM mutable_documents').get().n,2);
  assert.equal(prepareIndexes({activityDirectory:path.dirname(store.filename),clock,log:()=>{}})[0].noop,true);
});

test('aborted work, lease failures and a missing first roster never become publishable source gaps',t=>{
  const {store,generation,worker}=setup(t);
  const task={generation,key:'x',kind:'document',body:{endpoint:'/q'},priority:100,attempts:999};
  assert.equal(recordTaskGap(worker,task,new Error('Activity-index writer lease was lost.')),false);
  assert.equal(recordTaskGap(worker,{...task,kind:'roster'},new Error('No current roster.')),false);
  worker.controller.abort();assert.equal(recordTaskGap(worker,task,new Error('Stopped')),false);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps').get().n,0);
});

test('a resumed pre-deadline results page cannot become the final post-deadline confirmation',t=>{
  const {store,generation,worker}=setup(t,'2026-11-20T10:00Z');
  store.putSource(generation,'motion-outcomes:'+sitting,'motion-outcomes',{...complete(),resultsFetchedAt:'2026-10-23T10:00Z',decisionsFetchedAt:'2026-10-24T10:00Z',sources:[{fetchedAt:'2026-10-23T10:00Z'},{fetchedAt:'2026-10-24T10:00Z'}]},'2026-10-24T10:00Z');
  assert.equal(scheduleSittingOutcomes(worker,generation,sitting),true);
});

test('an unavailable current sitting keeps its correction-period cadence without blocking publication',t=>{
  const {store,generation,worker,clock}=setup(t,'2026-10-08T08:00Z');
  store.enqueue(generation,'current-sitting','motion-outcomes',{sittingId:sitting,stage:'decisions',offset:0},100);
  const task={...store.nextTask(generation),attempts:2};
  assert(recordTaskGap(worker,task,Object.assign(new Error('EP API returned 404'),{status:404})));
  assert.equal(store.db.prepare('SELECT retry_at FROM refresh_gaps').get().retry_at,clock()+6*60*60_000);
  assert.equal(store.db.prepare('SELECT next_check FROM sitting_refresh').get().next_check,clock()+6*60*60_000);
  store.publish(generation);assert.equal(store.get('active'),generation);assert.equal(store.status().complete,false);
});

test('daily publication preserves a failed feed interval until its saved retry succeeds',async t=>{
  const {store,generation,worker,clock,advance}=setup(t,'2026-10-02T10:00Z');
  store.enqueue(generation,'feed:/parliamentary-questions','feed',{endpoint:'/parliamentary-questions',start:'2026-09-30'},105);
  assert(recordTaskGap(worker,{...store.nextTask(generation),attempts:4},new Error('Feed unavailable')));
  store.publish(generation);
  for(let n=0;n<3;n++) {
    advance(DAY);const cycle=store.beginCycle();worker.enqueueFeeds(cycle.generation,'feed:',store.get('lastSuccess'));
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE generation=? AND kind='feed' AND json_extract(body,'$.endpoint')='/parliamentary-questions'").get(cycle.generation).n,0);
    for(const task of store.db.prepare('SELECT * FROM tasks WHERE generation=?').all(cycle.generation))store.finishTask(task);
    store.publish(cycle.generation);
  }
  advance(4*DAY);const cycle=store.beginCycle();scheduleMutable(worker,cycle.generation);
  const task=store.nextTask(cycle.generation);assert.equal(task.body.start,'2026-09-30');
  worker.fetchRecord=async()=>({fetchedAt:new Date(clock()).toISOString(),xml:'<feed><entry><id>https://data.europarl.europa.eu/eli/dl/doc/E-10-2026-000007</id><updated>2026-10-02</updated></entry></feed>'});
  await worker.task(task);
  assert(store.db.prepare("SELECT 1 FROM tasks WHERE generation=? AND key='/parliamentary-questions/E-10-2026-000007'").get(cycle.generation));
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM refresh_gaps WHERE generation=? AND kind='feed'").get(cycle.generation).n,0);
});

test('pre-policy feed tasks pin the original interval before partial publication advances lastSuccess',async t=>{
  const {store,generation,worker,clock,advance}=setup(t,'2026-08-31T10:00Z');
  store.setMembers([{id:'42'}]);store.putSource(generation,'outside:state','outside-state',{version:1},new Date(clock()).toISOString());
  store.publish(generation);advance(DAY);const cycle=store.beginCycle();
  store.enqueue(cycle.generation,'feed:/procedures','feed',{endpoint:'/procedures'},105);
  store.db.prepare('UPDATE tasks SET attempts=309,error=?,retry_at=? WHERE generation=?').run('Feed unavailable',clock()+DAY,cycle.generation);
  store.updateCycle({initialized:true,reportJoinsReady:true,procedureTitlesQueued:true,motionOutcomesDay:'2026-09-01'});
  advance(9*DAY);
  worker.fetchRecord=async(endpoint,params)=>({fetchedAt:new Date(clock()).toISOString(),payload:{data:endpoint==='/meps/show-current'&&params.offset===0?[{identifier:'42',label:'Member'}]:/^\/plenary-documents\/[^/]+$/.test(endpoint)?[document({identifier:endpoint.split('/').at(-1),work_type:'REPORT_PLENARY'})]:[]},xml:'<feed/>'});
  store.release();await worker.run();
  assert.equal(store.get('active'),cycle.generation);assert.equal(store.get('working'),null);
  assert.equal(store.get('lastSuccess'),'2026-09-10T10:00:00.000Z');
  assert.equal(JSON.parse(store.db.prepare("SELECT body FROM refresh_gaps WHERE generation=? AND kind='feed'").get(cycle.generation).body).start,'2026-08-29');
  advance(7*DAY);const next=store.beginCycle();scheduleMutable(worker,next.generation);
  const task=store.nextTask(next.generation);assert.equal(task.kind,'feed');
  const calls=[];worker.fetchRecord=async(endpoint,params)=>{calls.push({endpoint,params});return {fetchedAt:new Date(clock()).toISOString(),xml:'<feed><entry><id>https://data.europarl.europa.eu/eli/dl/proc/2026-9999</id><updated>2026-09-03</updated></entry></feed>'};};
  store.putSource(next.generation,'/procedures/2026-9999','procedure',{identifier:'2026-9999'},'2026-08-31T10:00Z');
  await worker.task(task);
  assert.deepEqual(calls[0].params,{timeframe:'custom','start-date':'2026-08-29'});
  assert(store.db.prepare("SELECT 1 FROM tasks WHERE generation=? AND kind='procedure'").get(next.generation),'the September 3 update remains eligible after publication');
});

test('an unretired pre-policy feed persists its interval before making a failing request',async t=>{
  const {store,generation,worker}=setup(t,'2026-09-01T10:00Z');
  store.set('lastSuccess','2026-08-31T10:00:00.000Z');
  store.enqueue(generation,'feed:/procedures','feed',{endpoint:'/procedures'},105);
  const task=store.nextTask(generation);
  await assert.rejects(worker.task(task),/Unexpected upstream request/);
  assert.equal(JSON.parse(store.db.prepare('SELECT body FROM tasks WHERE generation=? AND key=?').get(generation,task.key).body).start,'2026-08-29');
  assert.equal(task.body.start,'2026-08-29');
});

test('an expired monthly interval stays a coverage gap after a delayed feed retry succeeds',async t=>{
  const {store,generation,worker,clock,advance}=setup(t,'2026-10-02T10:00Z');
  store.enqueue(generation,'feed:/parliamentary-questions','feed',{endpoint:'/parliamentary-questions',start:'2026-09-30'},105);
  assert(recordTaskGap(worker,{...store.nextTask(generation),attempts:4},new Error('Feed unavailable')));
  store.publish(generation);advance(40*DAY);const cycle=store.beginCycle();scheduleMutable(worker,cycle.generation);
  worker.fetchRecord=async()=>({fetchedAt:new Date(clock()).toISOString(),xml:'<feed/>'});
  await worker.task(store.nextTask(cycle.generation));
  assert(store.db.prepare("SELECT 1 FROM tasks WHERE generation=? AND kind='catalog' AND json_extract(body,'$.deltaOnly')=1").get(cycle.generation));
  for(const task of store.db.prepare('SELECT * FROM tasks WHERE generation=?').all(cycle.generation))store.finishTask(task);
  store.publish(cycle.generation);
  assert.equal(store.status().complete,false);
  const gaps=store.db.prepare('SELECT kind,body FROM refresh_gaps WHERE generation=?').all(cycle.generation);
  assert.equal(gaps.length,1);assert.equal(gaps[0].kind,'coverage');assert.equal(JSON.parse(gaps[0].body).start,'2026-09-30');
});

test('a generation advanced without its refresh snapshot fails closed before pruning saved gaps',async t=>{
  const {prepareIndexes}=await import('./migrate-indexes.mjs');
  const {store,generation,worker,clock}=setup(t);
  store.putSource(generation,'/q','document',projectDocument(document()),'2026-10-01');
  store.enqueue(generation,'saved-gap','document',{endpoint:'/q',offset:750},90);
  assert(recordTaskGap(worker,{...store.nextTask(generation),attempts:4},new Error('Unavailable')));store.publish(generation);
  // An older writer copies ordinary sources/items and advances metadata while
  // leaving the additive refresh tables at the previous accepted generation.
  store.db.prepare('INSERT INTO sources SELECT ?,key,kind,body,fetched_at,0 FROM sources WHERE generation=?').run(generation+1,generation);
  store.set('active',generation+1);store.set('sequence',generation+1);store.release();
  assert.equal(store.status().complete,false);assert.equal(store.status().refreshSnapshotReady,false);
  assert.throws(()=>new ActivityStore(path.dirname(store.filename),{clock}),/snapshot does not match/);
  assert.throws(()=>store.acquire(),/snapshot does not match/);
  assert.throws(()=>prepareIndexes({activityDirectory:path.dirname(store.filename),clock,log:()=>{}}),/snapshot does not match/);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps WHERE generation=?').get(generation).n,1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM mutable_documents WHERE generation=?').get(generation).n,1);
  // Restoring the matching published pointer makes its original cursor usable.
  store.set('active',generation);assert(store.acquire());const next=store.beginCycle();
  assert.equal(JSON.parse(store.db.prepare('SELECT body FROM refresh_gaps WHERE generation=?').get(next.generation).body).offset,750);
});

test('historical sitting gaps refill their in-flight cap across cycles and worker runs',async t=>{
  const {store,generation,worker,clock,advance}=setup(t,'2026-10-02T10:00Z');
  for(let i=1;i<=30;i++) {
    const sittingId=`MTG-PL-2026-01-${String(i).padStart(2,'0')}`;
    store.enqueue(generation,'old-sitting:'+i,'motion-outcomes',{sittingId,stage:'decisions',offset:0},100);
    assert(recordTaskGap(worker,{...store.nextTask(generation),attempts:4},new Error('Missing decisions')));
  }
  store.setMembers([{id:'42'}]);store.publish(generation);store.release();advance(7*DAY);
  worker.fetchRecord=async(endpoint,params)=>({fetchedAt:new Date(clock()).toISOString(),payload:{data:endpoint==='/meps/show-current'&&params.offset===0?[{identifier:'42',label:'Member'}]:[]},xml:'<feed/>'});
  worker.task=async task=>{if(task.kind==='motion-outcomes')store.taskProgress(task,{...task.body,offset:task.body.offset+1});else store.finishTask(task);};
  worker.budget=0;store.release();await worker.run();
  const working=store.get('working');
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE generation=? AND kind='motion-outcomes' AND (done IS NULL OR done<>1)").get(working.generation).n,25);
  assert.equal(store.get('slowGapAdmissions'),null);
  assert(store.acquire());scheduleMutable(worker,working.generation);
  assert.equal(store.get('slowGapAdmissions'),null);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps WHERE generation=? AND retry_at<=?').get(working.generation,clock()).n,30);
  for(const task of store.db.prepare('SELECT * FROM tasks WHERE generation=?').all(working.generation))store.finishTask(task);
  store.publish(working.generation);const next=store.beginCycle();scheduleMutable(worker,next.generation);
  assert.equal(store.get('slowGapAdmissions'),null);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE generation=? AND kind='motion-outcomes'").get(next.generation).n,5);
  advance(DAY);scheduleMutable(worker,next.generation);
  assert.equal(store.get('slowGapAdmissions'),null);
});

test('ordinary document and speech discovery cannot reopen gaps or replace their saved cursors',async t=>{
  const {prepareAmendments}=await import('./amendments-worker.mjs');
  const {enqueueAmendment}=await import('./amendments-store.mjs');
  const {store,generation,worker,clock,advance}=setup(t);
  const pilot='/plenary-documents/A-10-2026-0254',speech='MTG-PL-2026-09-16-OTH-987',recovery='recovery:/speeches/'+speech;
  store.enqueue(generation,pilot,'document',{endpoint:pilot,offset:750},109);
  assert(recordTaskGap(worker,{...store.nextTask(generation),attempts:4},new Error('Missing pilot')));
  const savedRecovery={recoveryId:speech,offset:750,detectedAt:'2026-10-01',searchWindow:{start:'2026-09-01',end:'2026-09-30',offset:500}};
  store.enqueue(generation,recovery,'speeches',savedRecovery,103);
  assert(recordTaskGap(worker,{...store.nextTask(generation),attempts:4},new Error('Missing speech')));
  store.publish(generation);advance(DAY);const cycle=store.beginCycle();
  await prepareAmendments(worker,cycle);
  assert.equal(store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=?').get(cycle.generation,pilot),undefined);
  assert.equal(store.enqueue(cycle.generation,recovery,'speeches',{recoveryId:speech,offset:0},103),false);
  assert.equal(enqueueAmendment(store,cycle.generation,recovery,'speeches',{recoveryId:speech,offset:0},103),false);
  assert.equal(store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=?').get(cycle.generation,recovery),undefined);
  const gap=store.db.prepare('SELECT body FROM refresh_gaps WHERE generation=? AND key=?').get(cycle.generation,recovery);
  assert.deepEqual(JSON.parse(gap.body),savedRecovery);
  advance(6*DAY);scheduleMutable(worker,cycle.generation);
  const admitted=store.db.prepare('SELECT body FROM tasks WHERE generation=? AND key=?').get(cycle.generation,recovery);
  assert.deepEqual(JSON.parse(admitted.body),savedRecovery);
  assert.equal(store.db.prepare('SELECT retry_at FROM refresh_gaps WHERE generation=? AND key=?').get(cycle.generation,recovery).retry_at,clock());
});

test('incomplete current sitting snapshots receive a new correction-period attempt six hours later',t=>{
  for(const patch of [{truncated:true},{coverage:{missingResultIds:['missing'],missingDecisionIds:[]}},{splitProjectionTruncated:true}]) {
    const {store,generation,worker,clock,advance}=setup(t,'2026-10-08T08:00Z');
    const partial={...complete(),...patch};store.putSource(generation,'motion-outcomes:'+sitting,'motion-outcomes',partial,new Date(clock()).toISOString());
    assert.equal(scheduleSittingOutcomes(worker,generation,sitting),true);
    store.finishTask(store.nextTask(generation));
    assert.equal(scheduleSittingOutcomes(worker,generation,sitting),false,'same attempt is coalesced');
    advance(6*60*60_000);assert.equal(scheduleSittingOutcomes(worker,generation,sitting),true,JSON.stringify(patch));
    const key=store.nextTask(generation).key;
    assert(key.includes(':refresh:'));assert.equal(store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='motion-outcomes'").get().n,2);
  }
});

test('each later expired feed interval starts catalogue recovery independently of persistent coverage gaps',async t=>{
  const {store,generation,worker,clock,advance}=setup(t,'2026-10-20T10:00Z');
  worker.recoverFeedWindow(generation,'/parliamentary-questions','2026-09-01');
  for(const task of store.db.prepare('SELECT * FROM tasks').all())store.finishTask(task);
  store.publish(generation);advance(60*DAY);const cycle=store.beginCycle();
  store.enqueue(cycle.generation,'second-feed','feed',{endpoint:'/parliamentary-questions',start:'2026-11-01'},105);
  worker.fetchRecord=async()=>({fetchedAt:new Date(clock()).toISOString(),xml:'<feed/>'});
  await worker.task(store.nextTask(cycle.generation));
  const catalogues=store.db.prepare("SELECT body FROM tasks WHERE generation=? AND kind='catalog'").all(cycle.generation);
  assert(catalogues.length>0);assert(catalogues.every(task=>JSON.parse(task.body).feedRecovery.start==='2026-11-01'));
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM feed_catalog_recovery WHERE generation=?').get(cycle.generation).n,2);
  worker.recoverFeedWindow(cycle.generation,'/parliamentary-questions','2026-11-01');
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE generation=? AND kind='catalog'").get(cycle.generation).n,catalogues.length);
  const gap=store.db.prepare("SELECT body FROM refresh_gaps WHERE generation=? AND kind='coverage'").get(cycle.generation);
  assert.equal(JSON.parse(gap.body).start,'2026-09-01','the oldest unavailable window remains explicit');
});

test('an admitted retry retains its progressed cursor through repeated full-queue checkpoints',t=>{
  const {store,generation,worker,advance}=setup(t,'2026-10-08T08:00Z');
  const key='motion-outcomes:'+sitting+':retry',original={sittingId:sitting,stage:'results',offset:0,results:[],decisions:[],sources:[]};
  store.enqueue(generation,key,'motion-outcomes',original,100);
  assert(recordTaskGap(worker,{...store.nextTask(generation),attempts:2},Object.assign(new Error('Unavailable'),{status:404})));
  store.publish(generation);advance(6*60*60_000);
  assert.equal(store.enqueue(generation,key,'motion-outcomes',{},0,true,{retryGap:true}),true);
  const progressed={...original,stage:'decisions',offset:750,results:[{id:'retained-result'}]};
  store.taskProgress(store.nextTask(generation),progressed);
  const fill=store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)');
  for(let n=0;n<200;n++)fill.run(generation,'full:'+n,'amendment-reparse','{}',200,0,0,0,null);
  for(let n=0;n<3;n++) {
    worker.checkpointContinuations(generation);
    const snapshot=store.source(generation,'amendment:continuations').work.tasks.find(task=>task.key===key);
    assert(snapshot,'an admitted progressed retry stays in its checkpoint');assert.deepEqual(JSON.parse(snapshot.body),progressed);
    assert.equal(store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=?').get(generation,key),undefined);
    assert(store.db.prepare('SELECT 1 FROM refresh_gap_admissions WHERE generation=? AND key=?').get(generation,key));
  }
  store.db.prepare("DELETE FROM amendment_jobs WHERE generation=? AND key='full:0'").run(generation);
  worker.checkpointContinuations(generation);
  const queued=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key);
  assert.deepEqual(JSON.parse(queued.body),progressed);
  store.finishTask({...queued,amendmentJob:true});
  assert.equal(store.db.prepare('SELECT 1 FROM refresh_gaps WHERE generation=? AND key=?').get(generation,key),undefined);
  assert.equal(store.db.prepare('SELECT 1 FROM refresh_gap_admissions WHERE generation=? AND key=?').get(generation,key),undefined);
});

test('retry queue admission and its durable marker roll back together on failure',t=>{
  const {store,generation,worker,advance}=setup(t);
  store.enqueue(generation,'atomic-retry','document',{endpoint:'/q',offset:750},90);
  assert(recordTaskGap(worker,{...store.nextTask(generation),attempts:4},new Error('Unavailable')));advance(7*DAY);
  const prepare=store.db.prepare.bind(store.db);
  t.mock.method(store.db,'prepare',sql=>sql.startsWith('INSERT OR IGNORE INTO refresh_gap_admissions')?{run(){throw new Error('Simulated admission failure');}}:prepare(sql));
  assert.throws(()=>store.enqueue(generation,'atomic-retry','document',{},0,true,{retryGap:true}),/Simulated admission failure/);
  assert.equal(prepare("SELECT done FROM tasks WHERE key='atomic-retry'").get().done,1);
  assert.equal(prepare('SELECT COUNT(*) n FROM refresh_gap_admissions').get().n,0);
  assert.equal(JSON.parse(prepare("SELECT body FROM refresh_gaps WHERE key='atomic-retry'").get().body).offset,750);
});

test('an expired admitted retry cannot duplicate a checkpointed cursor across generations',t=>{
  const {store,generation,worker,advance}=setup(t,'2026-11-01T10:00Z');
  const key='motion-outcomes:'+sitting+':retry',original={sittingId:sitting,stage:'decisions',offset:100,results:[{id:'retained-result'}],decisions:[],sources:[]};
  store.enqueue(generation,key,'motion-outcomes',original,100);
  assert(recordTaskGap(worker,{...store.nextTask(generation),attempts:4},new Error('Unavailable')));
  advance(7*DAY);scheduleMutable(worker,generation);
  const progressed={...original,offset:750};store.taskProgress(store.nextTask(generation),progressed);
  for(let n=0;n<200;n++)store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(generation,'full:'+n,'amendment-reparse','{}',200,0,0,0,null);
  worker.checkpointContinuations(generation);store.publish(generation);
  advance(7*DAY);const cycle=store.beginCycle();
  scheduleMutable(worker,cycle.generation);
  assert.equal(store.get('slowGapAdmissions'),null,'admission no longer uses a daily counter');
  assert.equal(store.enqueue(cycle.generation,key,'motion-outcomes',{},100,true,{retryGap:true}),false,'even direct duplicate admission is refused after the due date');
  assert.equal(store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=?').get(cycle.generation,key),undefined);
  worker.checkpointContinuations(cycle.generation);
  assert.deepEqual(JSON.parse(store.source(cycle.generation,'amendment:continuations').work.tasks.find(task=>task.key===key).body),progressed);
  store.db.prepare("DELETE FROM amendment_jobs WHERE generation=? AND key='full:0'").run(cycle.generation);
  worker.checkpointContinuations(cycle.generation);
  const resumed=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(cycle.generation,key);
  assert.deepEqual(JSON.parse(resumed.body),progressed);
  assert(recordTaskGap(worker,{...resumed,body:JSON.parse(resumed.body),amendmentJob:true,attempts:4},new Error('Still unavailable')));
  worker.checkpointContinuations(cycle.generation);
  assert.equal(store.db.prepare('SELECT 1 FROM refresh_gap_admissions WHERE generation=? AND key=?').get(cycle.generation,key),undefined);
  assert.deepEqual(JSON.parse(store.db.prepare('SELECT body FROM refresh_gaps WHERE generation=? AND key=?').get(cycle.generation,key).body),progressed,'re-retirement saves the progressed cursor');
  advance(7*DAY);scheduleMutable(worker,cycle.generation);
  assert.deepEqual(store.nextTask(cycle.generation).body,progressed);
});

test('expired feed gaps discover catalogue IDs while retries wait or fail',async t=>{
  const {store,generation,worker,advance}=setup(t,'2026-10-02T10:00Z');
  const key='feed:/parliamentary-questions',endpoint='/parliamentary-questions',start='2026-09-30';
  store.enqueue(generation,key,'feed',{endpoint,start},105);
  assert(recordTaskGap(worker,{...store.nextTask(generation),attempts:4},new Error('Feed unavailable')));
  store.publish(generation);advance(40*DAY);const cycle=store.beginCycle();
  store.db.prepare('UPDATE refresh_gaps SET retry_at=retry_at+? WHERE generation=? AND key=?').run(60*DAY,cycle.generation,key);
  worker.enqueueFeeds(cycle.generation,'feed:',store.get('lastSuccess'));
  const catalogues=store.db.prepare("SELECT * FROM tasks WHERE generation=? AND kind='catalog' AND json_extract(body,'$.endpoint')=?").all(cycle.generation,endpoint);
  assert(catalogues.length>0,'catalogues are scheduled even while the saved feed gap is not due');
  assert(catalogues.every(row=>JSON.parse(row.body).feedRecovery.start===start));
  assert.equal(store.db.prepare("SELECT 1 FROM tasks WHERE generation=? AND kind='feed' AND json_extract(body,'$.endpoint')=?").get(cycle.generation,endpoint),undefined);
  assert.equal(store.db.prepare('SELECT start FROM feed_catalog_recovery WHERE generation=? AND endpoint=?').get(cycle.generation,endpoint).start,start);
  // Exercise execution directly too: expired work may be retained between
  // daily initialization passes, and recovery cannot depend on a valid XML body.
  store.db.prepare('DELETE FROM feed_catalog_recovery WHERE generation=? AND endpoint=?').run(cycle.generation,endpoint);
  store.db.prepare("DELETE FROM tasks WHERE generation=? AND kind='catalog'").run(cycle.generation);
  worker.fetchRecord=async()=>{throw new Error('Feed still unavailable');};
  await assert.rejects(worker.task({generation:cycle.generation,key,kind:'feed',body:{endpoint,start}}),/Feed still unavailable/);
  assert(store.db.prepare("SELECT 1 FROM tasks WHERE generation=? AND kind='catalog'").get(cycle.generation));
  assert(store.db.prepare('SELECT 1 FROM feed_catalog_recovery WHERE generation=? AND endpoint=?').get(cycle.generation,endpoint));
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM refresh_gaps WHERE generation=? AND json_extract(body,'$.endpoint')=?").get(cycle.generation,endpoint).n,2,'both failed feed and expired window remain incomplete');
});

test('further expiry of the same failed feed start advances catalogue recovery without duplicating identical bounds',t=>{
  const {store,generation,worker,advance}=setup(t,'2026-11-15T10:00Z');
  worker.recoverFeedWindow(generation,'/parliamentary-questions','2026-09-01');
  const first=store.db.prepare('SELECT end FROM feed_catalog_recovery WHERE generation=?').get(generation).end;
  for(const task of store.db.prepare('SELECT * FROM tasks').all())store.finishTask(task);
  store.publish(generation);advance(40*DAY);const cycle=store.beginCycle();
  worker.recoverFeedWindow(cycle.generation,'/parliamentary-questions','2026-09-01');
  const queued=store.db.prepare("SELECT body FROM tasks WHERE generation=? AND kind='catalog'").all(cycle.generation);
  assert(queued.length>0);assert(queued.every(row=>JSON.parse(row.body).feedRecovery.end>first));
  const end=store.db.prepare('SELECT end FROM feed_catalog_recovery WHERE generation=?').get(cycle.generation).end;assert(end>first);
  worker.recoverFeedWindow(cycle.generation,'/parliamentary-questions','2026-09-01');
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE generation=? AND kind='catalog'").get(cycle.generation).n,queued.length);
});

test('missing records back off across publications, remain labelled gaps, and recover on success',t=>{
  const {store,generation,worker,clock,advance}=setup(t);
  const key='/parliamentary-questions/E-10-2026-004060';
  const body={endpoint:key};
  const missing=Object.assign(new Error('EP API returned 404 at '+key),{status:404});
  store.setMembers([{id:'42',name:'Member'}]);
  store.enqueue(generation,key,'document',body,90);
  for(let attempt=0;attempt<12;attempt++) {
    const current=store.get('working')?.generation || store.get('active');
    const task=store.nextTask(current);
    assert(task);assert.equal(task.attempts,attempt);
    assert(recordTaskGap(worker,task,missing));
    const delay=Math.min(7*DAY,3_600_000*2**attempt);
    const gap=store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=? AND key=?').get(current,key);
    assert.equal(gap.retry_at,clock()+delay);assert.equal(gap.attempts,attempt+1);
    store.publish(current);
    const status=store.status();
    assert.equal(status.complete,false);assert.equal(status.coverageGaps.count,1);
    assert.equal(status.coverageGaps.examples[0].retryAt,new Date(clock()+delay).toISOString());
    assert.equal(status.coverageGaps.examples[0].failedAt,new Date(clock()).toISOString());
    assert.equal(store.page('42').total,0); // Unknown authors stay in global diagnostics.
    const next=store.beginCycle();
    advance(delay-1);scheduleMutable(worker,next.generation);
    assert.equal(store.nextTask(next.generation),undefined);
    advance(1);scheduleMutable(worker,next.generation);scheduleMutable(worker,next.generation);
    assert.equal(store.taskCounts(next.generation).total,1,'one admission, without immediate retry bursts');
  }
  const current=store.get('working').generation;
  store.finishTask(store.nextTask(current));store.publish(current);
  assert.equal(store.status().coverageGaps.count,0);
});

test('legacy high-attempt 404s immediately use the days cap and honour a longer upstream pause',t=>{
  const {store,generation,worker,clock}=setup(t);
  const key='/plenary-documents/A-10-2025-0128-AM-001-139';
  store.enqueue(generation,key,'document',{endpoint:key},90);
  const task={...store.nextTask(generation),attempts:149};
  assert(recordTaskGap(worker,task,Object.assign(new Error('Missing'),{status:404,retryAfter:8*DAY/1000})));
  assert.equal(store.db.prepare('SELECT retry_at FROM refresh_gaps').get().retry_at,clock()+8*DAY);
});
