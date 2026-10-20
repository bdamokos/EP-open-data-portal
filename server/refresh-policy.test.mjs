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
import {DAY,MUTABLE_LIMIT,GAP_LIMIT,documentRefreshState,scheduleMutable,recordTaskGap,sittingConfirmationDay,sittingOutcomesComplete} from './refresh-policy.mjs';

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
  assert.equal(store.taskCounts(next.generation).total,MUTABLE_LIMIT+2);
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
  assert.equal(store.page('42').total,null);assert.equal(store.page('42').categoryCoverage['written-questions'].status,'incomplete-joins');
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
