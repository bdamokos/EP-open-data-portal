import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {projectDocument,documentRows} from './activity-index-model.mjs';
import {AMENDMENTS_VERSION,AMENDMENT_SITTING_PROJECTION_VERSION} from './amendments.mjs';
import {SPLIT_PARSER_VERSION} from './amendment-splits.mjs';
import {amendmentsPage,enqueueAmendment} from './amendments-store.mjs';
import {prepareAmendments,refreshSittingTargets} from './amendments-worker.mjs';

const date='2026-10-02',stamp='2026-10-17T08:00:00.000Z',sitting='MTG-PL-2026-10-07';
const member={id:'1',givenName:'Example',familyName:'Member'};
const source={url:'https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/decisions?offset=0',fetchedAt:stamp};
const id=index=>'A-10-2026-'+String(7000+index);
function setup(t,{budget=1000}={}) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-scheduling-')),clock=()=>Date.parse(stamp);
  const store=new ActivityStore(directory,{clock});assert(store.acquire());const {generation}=store.beginCycle();
  store.setMembers([{id:'1',name:'Example Member'}]);
  // Metadata is settled in this amendment scheduling fixture.
  store.db.prepare('INSERT INTO group_voice_state VALUES (?,1)').run(generation);
  const worker=new ActivityWorker(store,{clock,budget,fetchRecord:async()=>{throw Error('Unexpected synthetic source request');},downloadAmendmentDocx:async()=>{throw Error('Unexpected DOCX download');},downloadVotingXml:async()=>{throw Error('Unexpected XML download');}});
  t.after(()=>{worker.stop();store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,worker,generation};
}
function seedTarget(store,generation,target,{listed=false,sentinel=false}={}) {
  const work=projectDocument({id:'eli/dl/doc/'+target,identifier:target,work_type:'def/ep-document-types/REPORT_PLENARY',parliamentary_term:['org/ep-10'],document_date:date,title_dcterms:{en:'Synthetic '+target},inverse_foresees_change_of:[],workHadParticipation:[{participation_role:'def/ep-roles/RAPPORTEUR',had_participant_person:['person/1']}]});
  const key='/plenary-documents/'+target;store.putSource(generation,key,'document',work,stamp,documentRows(work,key,stamp).rows);
  if(listed)store.putSource(generation,'amendment:list:'+target+'-AM-001-001','amendment-list',{id:'eli/dl/doc/'+target+'-AM-001-001',identifier:target+'-AM-001-001',targetDocumentId:target,document_date:date},stamp);
  if(sentinel)store.db.prepare('INSERT INTO amendment_targets VALUES (?,?,?)').run(generation,target,JSON.stringify({id:target,date,titles:work.title_dcterms,sentinel:true}));
}
function row(store,generation,key) {return store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key);}
function task(store,generation,key) {const value=row(store,generation,key);return {...value,body:JSON.parse(value.body),amendmentJob:true};}
function target(store,generation,targetId) {const value=store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,targetId);return value?JSON.parse(value.body):null;}
function outcome(store,generation,targetId) {return store.db.prepare('SELECT outcome FROM amendments WHERE generation=? AND target=?').get(generation,targetId)?.outcome;}
function sittingWork(ids,status) {
  return {amendmentVersion:AMENDMENTS_VERSION,amendmentProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION,splitParserVersion:SPLIT_PARSER_VERSION,splitRequests:[],parsedSplits:[],results:[],coverage:{missingResultIds:[],missingDecisionIds:[]},truncated:false,decisions:ids.map((targetId,index)=>({id:'eli/dl/event/'+sitting+'-DEC-'+(index+1),decided_on_a_realization_of:['eli/dl/doc/'+targetId+'-AM-1'],decision_outcome:'def/ep-statuses/'+status,decision_method:'def/ep-vote-methods/ROLL_CALL',activity_date:sitting.slice(7),source,provenance:'exact'}))};
}
function saveSitting(store,generation,work) {store.putSource(generation,'motion-outcomes:'+sitting,'motion-outcomes',work,stamp);}
const sittingKey='amendment:rebuild-sitting:'+sitting;

test('preparation keysets more than ten targets and preserves its cursor across optional generation advancement',async t=>{
  const {store,worker,generation}=setup(t),ids=Array.from({length:13},(_,index)=>id(index));
  for(const targetId of ['A-10-2026-0254','B-10-2026-0424',...ids])seedTarget(store,generation,targetId);
  assert.equal(await prepareAmendments(worker,store.get('working')),false);
  const first=store.db.prepare("SELECT * FROM amendment_jobs WHERE generation=? AND kind='amendment-prepare'").get(generation),body=JSON.parse(first.body);
  assert.equal(first.done,0);assert.equal(body.stage,'documents');assert(body.afterKey>''&&body.afterKey<body.throughKey);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_targets WHERE generation=?').get(generation).n,10);
  assert.equal(store.get('working').amendmentsPreparedDay,undefined);assert.equal(worker.requests,0);
  store.publish(generation);const next=store.beginCycle();
  assert.deepEqual(JSON.parse(row(store,next.generation,first.key).body),body);
  assert.equal(await prepareAmendments(worker,store.get('working')),true);
  assert.equal(row(store,next.generation,first.key).done,1);assert.equal(JSON.parse(row(store,next.generation,first.key).body).stage,'done');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_targets WHERE generation=?').get(next.generation).n,15);
  assert.equal(store.get('working').amendmentsPreparedDay,stamp.slice(0,10));assert.equal(worker.requests,0);assert.equal(store.get('working').requests,0);
});

for(const kind of ['roster','members','profile'])test(kind+' fan-out resumes beyond ten targets from saved evidence without refetching',async t=>{
  const {store,worker,generation}=setup(t),ids=Array.from({length:12},(_,index)=>id(index));
  for(const targetId of ids)seedTarget(store,generation,targetId,{listed:kind==='roster',sentinel:true});
  const key='synthetic:'+kind,type=kind==='profile'?'amendment-member':'amendment-'+kind;
  const body=kind==='profile'?{id:'1',targets:ids}:kind==='roster'?{date,offset:1,members:[member],sources:[]}:{offset:1,members:[member]};
  enqueueAmendment(store,generation,key,type,body,114);const calls=[];
  worker.fetchRecord=async(endpoint,params)=>{calls.push([endpoint,params]);return {payload:{data:kind==='profile'?[{identifier:'1',givenName:'Example',familyName:'Member',hasMembership:[{role:'def/ep-roles/MEMBER_PARLIAMENT',memberDuring:{startDate:'2024-07-16'}}]}]:[]},fetchedAt:stamp};};
  await worker.task(task(store,generation,key));
  let saved=task(store,generation,key);assert.equal(saved.done,0);assert.equal(saved.body.rebuild.kind,kind);
  assert.equal(ids.filter(targetId=>!target(store,generation,targetId).sentinel).length,10);assert.equal(calls.length,1);assert.equal(worker.requests,1);
  const evidenceKey=kind==='roster'?'amendment:roster:'+date:kind==='members'?'amendment:members:10':'amendment:member:1',evidence=store.source(generation,evidenceKey);
  assert(evidence);worker.fetchRecord=async()=>{throw Error('A persisted rebuild continuation must not refetch evidence');};
  if(kind==='profile') {
    const earlier='A-10-2026-6000';seedTarget(store,generation,earlier,{sentinel:true});
    assert.equal(saved.body.rebuild.offset,10);
    store.taskProgress(saved,{...saved.body,targets:[...saved.body.targets,earlier]});
    await worker.task(task(store,generation,key));
    assert.equal(target(store,generation,earlier).sentinel,undefined);assert.equal(task(store,generation,key).body.rebuild.offset,13);
  } else await worker.task(saved);
  saved=task(store,generation,key);assert.equal(saved.done,1);assert.equal(ids.filter(targetId=>!target(store,generation,targetId).sentinel).length,12);
  assert.deepEqual(store.source(generation,evidenceKey),evidence);assert.equal(calls.length,1);assert.equal(worker.requests,1);assert.equal(store.get('working').requests,1);
});

test('a newer sitting revision arriving halfway through fan-out requires a second bounded pass',async t=>{
  const {store,worker,generation}=setup(t),ids=Array.from({length:21},(_,index)=>id(index));for(const targetId of ids)seedTarget(store,generation,targetId);
  const firstWork=sittingWork(ids,'ADOPTED');saveSitting(store,generation,firstWork);await refreshSittingTargets(worker,generation,sitting,firstWork);
  let saved=task(store,generation,sittingKey),firstRevision=saved.body.rebuild.revision;
  assert.equal(saved.done,0);assert.equal(saved.body.rebuild.afterTarget,ids[9]);assert.equal(saved.body.rebuild.throughTarget,ids.at(-1));assert.equal(saved.body.rebuild.requestedRevision,firstRevision);
  assert.equal(outcome(store,generation,ids[0]),'ADOPTED');assert.equal(outcome(store,generation,ids[10]),undefined);
  const revised=sittingWork(ids,'REJECTED');saveSitting(store,generation,revised);await refreshSittingTargets(worker,generation,sitting,revised);
  saved=task(store,generation,sittingKey);assert.equal(saved.body.rebuild.afterTarget,ids[19]);assert.equal(saved.body.rebuild.revision,firstRevision);assert.notEqual(saved.body.rebuild.requestedRevision,firstRevision);
  const secondRevision=saved.body.rebuild.requestedRevision;assert.equal(outcome(store,generation,ids[0]),'ADOPTED');assert.equal(outcome(store,generation,ids[10]),'REJECTED');
  await worker.task(saved);saved=task(store,generation,sittingKey);
  assert.equal(saved.done,0);assert.equal(saved.body.rebuild.afterTarget,'');assert.equal(saved.body.rebuild.revision,secondRevision);assert.equal(saved.body.rebuild.requestedRevision,secondRevision);
  await worker.task(saved);saved=task(store,generation,sittingKey);assert.equal(saved.done,0);assert.equal(saved.body.rebuild.afterTarget,ids[9]);
  await worker.task(saved);await worker.task(task(store,generation,sittingKey));
  assert.equal(row(store,generation,sittingKey).done,1);for(const targetId of ids)assert.equal(outcome(store,generation,targetId),'REJECTED');
  assert.equal(worker.requests,0);assert.equal(store.get('working').requests,0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=? AND kind='amendment-rebuild'").get(generation).n,1);
});

for(const mode of ['stop','deadline'])test(mode+' leaves a partial fan-out queued before the next uncommitted target',async t=>{
  const {store,worker,generation}=setup(t),ids=Array.from({length:12},(_,index)=>id(index));for(const targetId of ids)seedTarget(store,generation,targetId);
  const work=sittingWork(ids,'ADOPTED');saveSitting(store,generation,work);await refreshSittingTargets(worker,generation,sitting,work);
  const before=row(store,generation,sittingKey);assert.equal(JSON.parse(before.body).rebuild.afterTarget,ids[9]);assert.equal(outcome(store,generation,ids[10]),undefined);
  if(mode==='stop')worker.stopped=true;else worker.runDeadline=performance.now()-1;
  await worker.task(task(store,generation,sittingKey));
  assert.deepEqual(row(store,generation,sittingKey),before);assert.equal(outcome(store,generation,ids[10]),undefined);assert.equal(worker.requests,0);
  worker.stopped=false;delete worker.runDeadline;await worker.task(task(store,generation,sittingKey));
  assert.equal(row(store,generation,sittingKey).done,1);assert.equal(outcome(store,generation,ids[10]),'ADOPTED');
});

test('checkpoint-only CPU work coalesces revisions, wakes due and survives legacy-shaped generation advancement',async t=>{
  const {store,worker,generation}=setup(t,{budget:0}),ids=Array.from({length:12},(_,index)=>id(index));for(const targetId of ids)seedTarget(store,generation,targetId);
  const first=sittingWork(ids,'ADOPTED');saveSitting(store,generation,first);await refreshSittingTargets(worker,generation,sitting,first);
  const raw={...row(store,generation,sittingKey),attempts:2,retry_at:worker.clock()-1,error:'Preserved CPU retry'};
  store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[raw],discovery:[],completed:[]},stamp);store.db.prepare('DELETE FROM amendment_jobs WHERE generation=?').run(generation);
  const revised=sittingWork(ids,'REJECTED');saveSitting(store,generation,revised);await refreshSittingTargets(worker,generation,sitting,revised);
  const checkpoint=store.source(generation,'amendment:continuations').work.tasks[0],beforeBody=JSON.parse(raw.body),afterBody=JSON.parse(checkpoint.body);
  assert.equal(checkpoint.attempts,raw.attempts);assert.equal(checkpoint.retry_at,raw.retry_at);assert.equal(checkpoint.error,raw.error);
  assert.equal(afterBody.rebuild.afterTarget,beforeBody.rebuild.afterTarget);assert.equal(afterBody.rebuild.revision,beforeBody.rebuild.revision);assert.notEqual(afterBody.rebuild.requestedRevision,beforeBody.rebuild.requestedRevision);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs').get().n,0);
  store.publish(generation);const accepted=store.page('1').items,lastSuccess=store.get('lastSuccess');
  store.transaction(()=>{
    store.db.prepare('INSERT INTO sources SELECT 4,key,kind,body,fetched_at,seen FROM sources WHERE generation=?').run(generation);
    store.db.prepare('INSERT INTO items SELECT 4,source_key,source_id,mep,category,date,body FROM items WHERE generation=?').run(generation);
    store.db.prepare('DELETE FROM sources WHERE generation<>4').run();store.db.prepare('DELETE FROM items WHERE generation<>4').run();store.db.prepare('DELETE FROM tasks').run();store.set('active',4);store.set('sequence',4);
  });store.release();
  assert.equal(worker.coreDue(),false);assert.equal(worker.due(),true);assert.equal(amendmentsPage(store,{}).coverage.pending,true);
  await worker.run();const admitted=row(store,4,sittingKey);
  assert.equal(admitted.body,checkpoint.body);assert.equal(admitted.attempts,raw.attempts);assert.equal(admitted.retry_at,raw.retry_at);assert.equal(admitted.error,raw.error);assert.equal(admitted.done,0);
  assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),4);assert.equal(worker.requests,0);
  worker.budget=1000;await worker.run();
  assert.equal(row(store,4,sittingKey).done,1);for(const targetId of ids)assert.equal(outcome(store,4,targetId),'REJECTED');
  assert.equal(amendmentsPage(store,{}).coverage.pending,false);assert.deepEqual(store.page('1').items,accepted);assert.equal(store.get('lastSuccess'),lastSuccess);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),4);assert.equal(worker.requests,0);
});
