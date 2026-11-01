import {unthrottledUpstream} from './test-support/upstream.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityStore } from './activity-index-store.mjs';
import { ActivityWorker } from './activity-index-worker.mjs';
import { AMENDMENT_LINKS_VERSION, projectDocument } from './activity-index-model.mjs';
import { distributionEvidenceFor } from './amendments.mjs';
import { AMENDMENT_EXTRACTION_VERSION } from './amendment-documents.mjs';
import { bootstrapAmendmentDependencies, amendmentDependenciesReady, amendmentsPage, enqueueAmendment } from './amendments-store.mjs';
import { rebuildAmendmentTarget } from './amendments-worker.mjs';

const stamp='2026-10-17T09:00:00.000Z', amendmentDate='2026-10-02';
const checkpointKey='amendment:continuations', profileKey='amendment:member:1';
const targetA='A-10-2026-7001',targetB='A-10-2026-7002',targetC='A-10-2026-7003';

function fixture(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-profile-dependencies-'));
  let now=Date.parse(stamp),requests=0;
  const store=new ActivityStore(directory,{clock:()=>now});assert(store.acquire());
  const {generation}=store.beginCycle();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  store.set('amendmentMandateFallback',true);
  store.putSource(generation,'amendment:members:10','amendment-members',{members:[{id:'1',givenName:'Example',familyName:'Member'}]},stamp);
  const worker=new ActivityWorker(store,{runUpstream:unthrottledUpstream,clock:()=>now,
    fetchRecord:async(endpoint,_params,{signal}={})=>{
      assert.equal(endpoint,'/meps/1','Unexpected external request in isolated profile dependency test.');
      assert.equal(signal,worker.controller.signal);requests++;
      return {fetchedAt:new Date(now).toISOString(),payload:{data:[{identifier:'1',givenName:'Example',familyName:'Member',
        hasMembership:[{role:'def/ep-roles/MEMBER_PARLIAMENT',memberDuring:{startDate:'2024-07-16'}}]}]}};
    },
    downloadAmendmentDocx:async()=>{throw new Error('Profile dependency tests must not download document distributions.');},
    downloadVotingXml:async()=>{throw new Error('Profile dependency tests must not download voting distributions.');},
  });
  while(!bootstrapAmendmentDependencies(store,generation)) {}
  return {store,worker,generation,requests:()=>requests,
    advanceTo:value=>{now=value;assert(store.acquire());},
    seed(id,{index=true}={}) {
      const listId=id+'-AM-001-001',url='https://data.europarl.europa.eu/distribution/example/'+listId+'.docx';
      const list=projectDocument({id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',
        document_date:null,foresees_change_of:['eli/dl/doc/'+id],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',
          is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:url}]}]});
      const work=projectDocument({id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/REPORT_PLENARY',
        document_date:amendmentDate,title_dcterms:{en:id},inverse_foresees_change_of:[list]});
      store.putSource(generation,'/plenary-documents/'+id,'document',work,stamp);
      store.putSource(generation,'amendment:list:'+listId,'amendment-list',{...list,targetDocumentId:id,
        distributionEvidence:distributionEvidenceFor(list,{url:'https://data.europarl.europa.eu/api/v2/documents/'+listId,fetchedAt:stamp}),
        extraction:{parserVersion:AMENDMENT_EXTRACTION_VERSION,language:'en',sourceUrl:url,sourceDescriptor:{url,language:'en',byteSize:null},fetchedAt:stamp,gaps:[],
          amendments:[{number:1,date:amendmentDate,documentDate:amendmentDate,authors:['Example Member'],originalText:'Original legal text.',proposedText:'Proposed legal text.',gaps:[]}]},
      },stamp);
      if(index)rebuildAmendmentTarget(worker,generation,id);
    },
  };
}

function fillDirectQueue(context) {
  const {store,generation}=context;
  for(let number=0;number<200;number++)enqueueAmendment(store,generation,'blocker:'+number,'amendment-reparse',{sourceKey:'unused:'+number},1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=?').get(generation).n,200);
}

function directProfile(store,generation) {
  return store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,profileKey);
}

function checkpointProfile(store,generation) {
  return store.source(generation,checkpointKey)?.work.tasks?.find(task=>task.key===profileKey);
}

function task(row) {
  return {...row,body:JSON.parse(row.body),amendmentJob:true};
}

function assertTargets(row,expected) {
  assert(row,'The shared profile dependency job must remain recorded.');
  const targets=JSON.parse(row.body).targets;
  assert.equal(new Set(targets).size,targets.length,'Repeated rebuilds must not duplicate dependencies.');
  assert.deepEqual(new Set(targets),new Set(expected));
}

async function completeProfile(context,generation=context.generation) {
  for(let slice=0;slice<20;slice++) {
    const row=directProfile(context.store,generation);assert(row);
    if(row.done===1) {
      const pending=context.store.db.prepare("SELECT * FROM amendment_jobs WHERE generation=? AND key='amendment:member-changes' AND done=0").get(generation);
      if(pending){await context.worker.task(task(pending));continue;}
      return row;
    }
    assert(row.retry_at<=context.store.clock(),'The profile is still waiting for its preserved retry time.');
    await context.worker.task(task(row));
  }
  assert.fail('The bounded profile completion did not settle after twenty slices.');
}

function assertResolved(context,ids) {
  for(const id of ids) {
    const page=amendmentsPage(context.store,{document:id,member:'1'});
    assert.equal(page.total,1,id+' must resolve through actual profile completion without a manual rebuild.');
    assert.equal(page.items[0].authors[0].personId,'1');assert.equal(page.items[0].authors[0].status,'resolved');
  }
}

test('a deferred shared profile rebuilds every dependent target after actual admission and completion',async t=>{
  const context=fixture(t),{store,worker,generation}=context;
  fillDirectQueue(context);context.seed(targetA);context.seed(targetB);
  assertTargets(checkpointProfile(store,generation),[targetA,targetB]);
  assert.equal(directProfile(store,generation),undefined);
  assert.equal(amendmentsPage(store,{document:targetA,member:'1'}).total,0);
  assert.equal(amendmentsPage(store,{document:targetB,member:'1'}).total,0);
  store.db.prepare('UPDATE amendment_jobs SET done=1 WHERE generation=?').run(generation);
  worker.checkpointContinuations(generation,{includeCore:false});
  assertTargets(directProfile(store,generation),[targetA,targetB]);
  await completeProfile(context);
  assert.equal(context.requests(),1);assertResolved(context,[targetA,targetB]);
  assert.equal(amendmentsPage(store,{document:targetB}).coverage.pending,false);
});

test('adding a direct pending dependency preserves the complete retry state and numeric profile rebuild cursor',t=>{
  const context=fixture(t),{store,worker,generation}=context;
  context.seed(targetA);
  const original=directProfile(store,generation),body={...JSON.parse(original.body),offset:650,checkpoint:'Retained direct profile state',rebuild:{kind:'profile',offset:1}};
  store.db.prepare('UPDATE amendment_jobs SET body=?,attempts=2,retry_at=?,error=? WHERE generation=? AND key=?').run(
    JSON.stringify(body),store.clock()+60000,'Retained direct retry',generation,profileKey);
  const before=directProfile(store,generation);
  context.seed(targetB);
  for(let pass=0;pass<3;pass++)rebuildAmendmentTarget(worker,generation,targetB);
  const actual=directProfile(store,generation);assertTargets(actual,[targetA,targetB]);
  assert.deepEqual({...actual,body:before.body},{...before});
  const next=JSON.parse(actual.body);assert.deepEqual({...next,targets:body.targets},body);
  assert.equal(typeof next.rebuild.offset,'number');assert.equal(next.rebuild.offset,1);
  assert.equal(context.requests(),0);
});

test('deferred dependencies survive full-snapshot retry state and legacy generation adoption before admission',t=>{
  const context=fixture(t),{store,worker,generation}=context;
  fillDirectQueue(context);context.seed(targetA);
  const checkpoint=store.source(generation,checkpointKey).work,original=checkpointProfile(store,generation);
  const body={...JSON.parse(original.body),offset:345,checkpoint:'Retained deferred profile state',rebuild:{kind:'profile',offset:1}};
  const snapshot={...original,body:JSON.stringify(body),attempts:3,retry_at:store.clock()+120000,error:'Retained deferred retry'};
  store.putSource(generation,checkpointKey,'amendment-continuations',{...checkpoint,tasks:checkpoint.tasks.map(row=>row.key===profileKey?snapshot:row)},stamp);
  context.seed(targetB);
  context.seed(targetC,{index:false});
  let actual=checkpointProfile(store,generation);assertTargets(actual,[targetA,targetB]);
  assert.deepEqual({...actual,body:snapshot.body},snapshot);
  assert.deepEqual({...JSON.parse(actual.body),targets:body.targets},body);
  store.publish(generation);
  store.db.prepare('INSERT INTO sources SELECT 2,key,kind,body,fetched_at,seen FROM sources WHERE generation=?').run(generation);
  // This fixture predates accepted refresh snapshots; accepted mismatches fail closed.
  store.set('refreshPolicyGeneration',null);store.set('active',2);store.set('sequence',2);store.set('previous',generation);
  const adopted=store.beginCycle();assert.equal(adopted.generation,3);
  rebuildAmendmentTarget(worker,adopted.generation,targetC);
  actual=checkpointProfile(store,adopted.generation);assertTargets(actual,[targetA,targetB,targetC]);
  assert.equal(actual.attempts,snapshot.attempts);assert.equal(actual.retry_at,snapshot.retry_at);assert.equal(actual.error,snapshot.error);
  assert.deepEqual({...JSON.parse(actual.body),targets:body.targets},body);
  store.db.prepare('UPDATE amendment_jobs SET done=1 WHERE generation=?').run(adopted.generation);
  worker.checkpointContinuations(adopted.generation,{includeCore:false});
  const admitted=directProfile(store,adopted.generation);assertTargets(admitted,[targetA,targetB,targetC]);
  assert.equal(admitted.generation,adopted.generation);assert.equal(admitted.attempts,snapshot.attempts);
  assert.equal(admitted.retry_at,snapshot.retry_at);assert.equal(admitted.error,snapshot.error);
  assert.deepEqual(JSON.parse(admitted.body),JSON.parse(actual.body));assert.equal(context.requests(),0);
});

test('a completed direct profile and its deferred snapshot merge later dependencies before checkpoint deduplication',async t=>{
  const context=fixture(t),{store,worker,generation}=context;
  fillDirectQueue(context);context.seed(targetA);context.seed(targetC,{index:false});
  assertTargets(checkpointProfile(store,generation),[targetA]);
  store.db.prepare('DELETE FROM amendment_jobs WHERE generation=? AND key=?').run(generation,'blocker:0');
  store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(generation,profileKey,'amendment-member',
    JSON.stringify({id:'1',targets:[targetC],rebuild:{kind:'profile',offset:1}}),107,1,0,0,null);
  context.seed(targetB);
  const queued=directProfile(store,generation),pending=queued.done===0?queued:checkpointProfile(store,generation);
  assertTargets(pending,[targetA,targetB,targetC]);
  assert.equal(JSON.parse(pending.body).rebuild,undefined,'The pending snapshot must refresh before processing its merged dependencies.');
  store.db.prepare('UPDATE amendment_jobs SET done=1 WHERE generation=? AND key<>?').run(generation,profileKey);
  worker.checkpointContinuations(generation,{includeCore:false});
  assertTargets(directProfile(store,generation),[targetA,targetB,targetC]);
  await completeProfile(context);assert.equal(context.requests(),1);assertResolved(context,[targetA,targetB,targetC]);
});

test('simultaneous direct and deferred pending snapshots merge dependencies without rewriting either retry or rebuild cursor',t=>{
  const context=fixture(t),{store,worker,generation}=context;
  fillDirectQueue(context);context.seed(targetA);context.seed(targetC,{index:false});
  const saved=store.source(generation,checkpointKey).work,deferred=checkpointProfile(store,generation);
  const deferredBody={...JSON.parse(deferred.body),offset:400,rebuild:{kind:'profile',offset:0},checkpoint:'Deferred continuation'};
  const retained={...deferred,body:JSON.stringify(deferredBody),attempts:3,retry_at:store.clock()+120000,error:'Deferred retry'};
  store.putSource(generation,checkpointKey,'amendment-continuations',{...saved,tasks:saved.tasks.map(row=>row.key===profileKey?retained:row)},stamp);
  store.db.prepare('DELETE FROM amendment_jobs WHERE generation=? AND key=?').run(generation,'blocker:0');
  const directBody={id:'1',targets:[targetC],offset:200,rebuild:{kind:'profile',offset:1},checkpoint:'Direct continuation'};
  store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(generation,profileKey,'amendment-member',
    JSON.stringify(directBody),107,0,1,store.clock()+60000,'Direct retry');
  const direct=directProfile(store,generation);
  context.seed(targetB);
  const mergedDirect=directProfile(store,generation),mergedDeferred=checkpointProfile(store,generation);
  assertTargets(mergedDirect,[targetA,targetB,targetC]);assertTargets(mergedDeferred,[targetA,targetB,targetC]);
  assert.deepEqual({...mergedDirect,body:direct.body},{...direct});
  assert.deepEqual({...mergedDeferred,body:retained.body},retained);
  assert.deepEqual({...JSON.parse(mergedDirect.body),targets:directBody.targets},directBody);
  assert.deepEqual({...JSON.parse(mergedDeferred.body),targets:deferredBody.targets},deferredBody);
  worker.checkpointContinuations(generation,{includeCore:false});
  const admitted=directProfile(store,generation);assert.deepEqual(admitted,mergedDirect);
  assertTargets(admitted,[targetA,targetB,targetC]);assert.equal(checkpointProfile(store,generation),undefined);
  assert.equal(context.requests(),0);
});

test('a later dependency uses a valid completed profile immediately or reopens completed work when that profile is absent',async t=>{
  for(const profilePresent of [true,false]) {
    const context=fixture(t),{store,generation}=context;
    context.seed(targetA);await completeProfile(context);assertResolved(context,[targetA]);
    assert.equal(directProfile(store,generation).done,1);assert.equal(context.requests(),1);
    if(!profilePresent)store.db.prepare('DELETE FROM sources WHERE generation=? AND key=?').run(generation,profileKey);
    context.seed(targetB);
    if(profilePresent) {
      assert.equal(directProfile(store,generation).done,1);assertResolved(context,[targetB]);
      assert.equal(amendmentsPage(store,{document:targetB}).coverage.pending,false);assert.equal(context.requests(),1);
    } else {
      const reopened=directProfile(store,generation);assert.equal(reopened.done,0);assertTargets(reopened,[targetA,targetB]);
      assert.equal(JSON.parse(reopened.body).rebuild,undefined);
      await completeProfile(context);assertResolved(context,[targetA,targetB]);assert.equal(context.requests(),2);
    }
  }
});

test('more than 100 profile dependencies stay on disk and resolve without a capacity gap',async t=>{
  const context=fixture(t),{store,generation}=context;
  const ids=Array.from({length:105},(_,i)=>'A-10-2026-'+String(7100+i));
  for(const id of ids)context.seed(id);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM amendment_member_dependencies WHERE generation=?').get(generation).n,105);
  await completeProfile(context);assertResolved(context,ids);
  assert.equal(store.source(generation,checkpointKey)?.work.capacityGap,undefined);
  assert.equal(context.requests(),1);
});

test('profiles arriving mid-members pass coalesce into one dependent-only follow-up with full-rebuild parity',async t=>{
  const context=fixture(t),{store,worker,generation}=context;
  const ids=Array.from({length:24},(_,i)=>'A-10-2026-'+String(8000+i));
  for(const [i,id] of ids.entries()) {
    context.seed(id,{index:false});
    if(i>=2) {
      const key='amendment:list:'+id+'-AM-001-001',list=store.source(generation,key);
      list.work.extraction.amendments[0].authors=['Other Person'];
      store.putSource(generation,key,'amendment-list',list.work,stamp);
    }
    rebuildAmendmentTarget(worker,generation,id);
  }
  // Only the first two targets depend on this profile. Other targets remain
  // unchanged during the follow-up, including those already visited.
  store.db.prepare('DELETE FROM amendment_member_dependencies WHERE generation=? AND target NOT IN (?,?)').run(generation,ids[0],ids[1]);
  const profile=directProfile(store,generation);
  store.db.prepare('UPDATE amendment_jobs SET body=? WHERE generation=? AND key=?').run(JSON.stringify({id:'1',targets:[]}),generation,profile.key);
  const key='amendment:members:10';
  enqueueAmendment(store,generation,key,'amendment-members',{rebuild:{kind:'members',revision:'legacy',requestedRevision:'new-profile',afterTarget:'',throughTarget:ids.at(-1)}},108);
  await worker.task(task(store.db.prepare('SELECT * FROM amendment_jobs WHERE key=?').get(key)));
  const cursor=JSON.parse(store.db.prepare('SELECT body FROM amendment_jobs WHERE key=?').get(key).body).rebuild.afterTarget;
  await worker.task(task(directProfile(store,generation)));
  assert.equal(JSON.parse(store.db.prepare('SELECT body FROM amendment_jobs WHERE key=?').get(key).body).rebuild.afterTarget,cursor);
  enqueueAmendment(store,generation,profileKey,'amendment-member',{id:'1',targets:[]},107,true);
  await worker.task(task(directProfile(store,generation)));
  while(store.db.prepare('SELECT done FROM amendment_jobs WHERE key=?').get(key).done===0)await worker.task(task(store.db.prepare('SELECT * FROM amendment_jobs WHERE key=?').get(key)));
  store.db.exec('CREATE TABLE rebuilt_targets(id TEXT); CREATE TEMP TRIGGER count_rebuild AFTER INSERT ON amendment_targets BEGIN INSERT INTO rebuilt_targets VALUES (NEW.id); END');
  await completeProfile(context);
  assert.deepEqual(store.db.prepare('SELECT id FROM rebuilt_targets ORDER BY id').all().map(r=>r.id),ids.slice(0,2).flatMap(id=>[id,id]));
  assert.equal(context.requests(),2);
  const incremental=store.db.prepare('SELECT id,body FROM amendments WHERE generation=? ORDER BY id').all(generation);
  for(const id of ids)rebuildAmendmentTarget(worker,generation,id,{discover:false});
  assert.deepEqual(store.db.prepare('SELECT id,body FROM amendments WHERE generation=? ORDER BY id').all(generation),incremental);
});

test('a full queue defers profile handoff without repeating the profile fetch',async t=>{
  const context=fixture(t),{store,worker,generation}=context;context.seed(targetA);
  for(let i=0;i<199;i++)enqueueAmendment(store,generation,'blocker:'+i,'amendment-reparse',{},1);
  await worker.task(task(directProfile(store,generation)));
  const waiting=directProfile(store,generation);
  assert.equal(waiting.done,0);assert.equal(JSON.parse(waiting.body).profileStored,true);
  assert(waiting.retry_at>store.clock());assert.equal(context.requests(),1);
  assert.equal(store.db.prepare("SELECT 1 FROM amendment_jobs WHERE key='amendment:member-changes'").get(),undefined);
  store.db.prepare("DELETE FROM amendment_jobs WHERE key='blocker:0'").run();
  context.advanceTo(waiting.retry_at);await completeProfile(context);
  assert.equal(context.requests(),1);assertResolved(context,[targetA]);
});

test('105-target upgrade uses full rebuilding until committed dependency bootstrap is ready',async t=>{
  const context=fixture(t),{store,worker,generation}=context;
  const ids=Array.from({length:105},(_,i)=>'A-10-2026-'+String(9000+i));
  for(const id of ids)context.seed(id);
  for(const table of ['amendment_dependency_bootstrap','amendment_member_dependencies','amendment_author_targets'])store.db.prepare('DELETE FROM '+table+' WHERE generation=?').run(generation);
  assert.equal(amendmentDependenciesReady(store,generation),false);
  // The old profile body is capped at 100, as on an upgraded installation.
  store.db.prepare('UPDATE amendment_jobs SET body=? WHERE key=?').run(JSON.stringify({id:'1',targets:ids.slice(0,100)}),profileKey);
  await completeProfile(context);assertResolved(context,ids);
  let batches=0;
  while(!bootstrapAmendmentDependencies(store,generation,7)){assert(++batches<100);}
  assert(batches>1);assert(amendmentDependenciesReady(store,generation));
  enqueueAmendment(store,generation,profileKey,'amendment-member',{id:'1',targets:[]},107,true);
  await completeProfile(context);assertResolved(context,ids);
  const incremental=store.db.prepare('SELECT id,body FROM amendments WHERE generation=? ORDER BY id').all(generation);
  for(const id of ids)rebuildAmendmentTarget(worker,generation,id,{discover:false});
  assert.deepEqual(store.db.prepare('SELECT id,body FROM amendments WHERE generation=? ORDER BY id').all(generation),incremental);
});

test('24 targets and 12 arrivals terminate each captured pass',async t=>{
  const context=fixture(t),{store,worker,generation}=context;
  const ids=Array.from({length:24},(_,i)=>'A-10-2026-'+String(8500+i));
  for(const id of ids)context.seed(id);
  await worker.task(task(directProfile(store,generation)));
  let arrivals=0,boundaries=0,previous='',previousPass=null;
  const cursors=new Map();
  for(let turn=0;turn<50;turn++) {
    const row=store.db.prepare("SELECT * FROM amendment_jobs WHERE key='amendment:member-changes' AND done=0").get();
    if(!row)break;
    const {afterTarget:before,passId}=JSON.parse(row.body).rebuild;
    assert(before>=(cursors.get(passId)||''),'a captured pass never resets its cursor');
    cursors.set(passId,before);
    if(previousPass&&previousPass!==passId)assert.equal(before,'','only a new pass resets the cursor');
    previousPass=passId;
    if(previous&&before==='')boundaries++;
    await worker.task(task(row));previous=JSON.parse(store.db.prepare('SELECT body FROM amendment_jobs WHERE key=?').get(row.key).body).rebuild.afterTarget;
    if(arrivals<12) {
      const id=String(100+arrivals++);
      store.db.prepare('INSERT INTO amendment_member_dependencies SELECT generation,?,target FROM amendment_member_dependencies WHERE person_id=?').run(id,'1');
      store.putSource(generation,'amendment:member:'+id,'amendment-member',{id,givenName:'Example',familyName:'Member'},stamp);
      enqueueAmendment(store,generation,'arrival:'+id,'amendment-member',{id,profileStored:true,targets:[]},107,true);
      await worker.task(task(store.db.prepare('SELECT * FROM amendment_jobs WHERE key=?').get('arrival:'+id)));
    }
  }
  assert.equal(arrivals,12);assert(boundaries<=12);
  assert.equal(store.db.prepare("SELECT 1 FROM amendment_jobs WHERE key='amendment:member-changes' AND done=0").get(),undefined);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM amendment_member_pending').get().n,0);
});
