import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {projectDocument} from './activity-index-model.mjs';
import {amendmentsPage,enqueueAmendment,nextAmendmentTask} from './amendments-store.mjs';
import {prepareAmendments} from './amendments-worker.mjs';
import {unthrottledUpstream} from './test-support/upstream.mjs';

const stamp='2026-11-01T10:00:00.000Z',now=Date.parse(stamp),date=stamp.slice(0,10);
const rows=(store,generation)=>store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? ORDER BY key').all(generation);
const task=row=>({...row,body:JSON.parse(row.body),amendmentJob:true});
async function fixture(t,{mode='normal',budget=1000}={}) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'activity-publication-'));
  const store=new ActivityStore(directory,{clock:()=>now});assert(store.acquire());
  const first=store.beginCycle();store.setMembers([{id:'1',name:'Example Member'}]);store.publish(first.generation);
  const {generation}=store.beginCycle();
  store.set('adoptedTextDiscovery',{version:1,throughYear:2026});
  store.db.prepare('INSERT INTO group_voice_state VALUES (?,1)').run(generation);
  store.putSource(generation,'outside:state','outside-state',{version:1,terms:[9,10]},stamp);
  for(const id of ['A-10-2026-0254','B-10-2026-0424'])store.putSource(generation,'/plenary-documents/'+id,'document',projectDocument({
    id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/REPORT_PLENARY',parliamentary_term:'org/ep-10',document_date:date,inverse_foresees_change_of:[],
  }),stamp);
  store.updateCycle({initialized:true,membershipScheduled:true,groupHistoryScheduled:true,motionOutcomesDay:date,reportJoinsReady:true,procedureTitlesQueued:true,procedureTypesQueued:true});
  const options={clock:()=>now,runUpstream:unthrottledUpstream,recoveryMode:mode,budget,fetchRecord:async endpoint=>{
    const id=endpoint.split('/').at(-1);
    assert.match(endpoint,/^\/parliamentary-questions\/E-10-2026-\d{6}$/,'Only fixture recovery documents may be fetched.');
    return {fetchedAt:stamp,payload:{data:[{id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/QUESTION_WRITTEN',parliamentary_term:'org/ep-10',document_date:date}]}};
  }};
  const worker=new ActivityWorker(store,options);await prepareAmendments(worker,store.get('working'));
  t.after(()=>{worker.stop();store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,worker,generation,previous:first.generation,options};
}

test('a completed core publishes before due amendment document, members, committee and alias jobs',async t=>{
  const {store,worker,generation}=await fixture(t);
  for(const [key,kind,body] of [
    ['document-dependency','document',{endpoint:'/plenary-documents/A-10-2026-7000',offset:750}],
    ['amendment:members:10','amendment-members',{rebuild:{kind:'members',afterTarget:'A-10-2026-0043',throughTarget:'committee:TRAN:example'}}],
    ['committee-discovery','amendment-committee-discover',{offset:20}],
    ['aliases','amendment-aliases',{sittingId:'MTG-PL-2026-10-07'}],
  ])enqueueAmendment(store,generation,key,kind,body,120);
  const before=rows(store,generation);
  worker.task=async()=>assert.fail('Core publication must precede optional amendment dispatch.');
  store.release();await worker.runIteration();
  assert.equal(store.get('active'),generation);assert.equal(store.get('working'),null);
  assert.equal(store.status().refreshInProgress,false);
  assert.equal(amendmentsPage(store,{}).coverage.pending,true);
  assert.deepEqual(rows(store,generation),before,'publication preserves every optional cursor');
});

test('partly rebuilt members and deferred continuations survive publication, copy and complete',async t=>{
  const {store,worker,generation}=await fixture(t),ids=Array.from({length:13},(_,i)=>'A-10-2026-'+String(7000+i));
  for(const id of ids) {
    store.putSource(generation,'/plenary-documents/'+id,'document',projectDocument({id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/REPORT_PLENARY',document_date:date,inverse_foresees_change_of:[]}),stamp);
    store.db.prepare('INSERT INTO amendment_targets VALUES (?,?,?)').run(generation,id,JSON.stringify({id,sentinel:true}));
  }
  const key='amendment:members:10';
  enqueueAmendment(store,generation,key,'amendment-members',{rebuild:{kind:'members',afterTarget:'',throughTarget:ids.at(-1)}},108);
  await worker.task(task(rows(store,generation).find(row=>row.key===key)));
  const before=rows(store,generation).find(row=>row.key===key);assert(JSON.parse(before.body).rebuild.afterTarget>ids[0]);assert(JSON.parse(before.body).rebuild.afterTarget<ids.at(-1));
  const completed={key:'motion-outcomes:MTG-PL-2026-11-01:'+date,kind:'motion-outcomes',sittingId:'MTG-PL-2026-11-01'};
  const deferred={generation,key:'deferred-rebuild',kind:'amendment-rebuild',body:JSON.stringify({rebuild:{kind:'profile',offset:0},targets:[]}),priority:1,done:0,attempts:2,retry_at:now+60_000,error:'Retained retry'};
  for(let i=0;i<199;i++)enqueueAmendment(store,generation,'occupied:'+i,'amendment-rebuild',{rebuild:{kind:'profile',offset:0},targets:[]},1);
  store.db.prepare("UPDATE amendment_jobs SET retry_at=? WHERE generation=? AND key LIKE 'occupied:%'").run(now+86400_000,generation);
  store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[deferred],completed:[completed]},stamp);
  worker.checkpointContinuations(generation,{includeCore:false});
  const checkpoint=store.source(generation,'amendment:continuations').work;assert.equal(checkpoint.tasks.length,1);
  store.release();await worker.runIteration();assert.equal(store.get('active'),generation);
  assert(store.acquire());const next=store.beginCycle().generation;
  const copied=rows(store,next).find(row=>row.key===key);
  assert.deepEqual({...copied},{...before,generation:next});
  assert.deepEqual(store.source(next,'amendment:continuations').work,checkpoint);
  await worker.task(task(copied));assert.equal(rows(store,next).find(row=>row.key===key).done,1);
  assert(ids.every(id=>!JSON.parse(store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(next,id).body).sentinel));
  worker.checkpointContinuations(next,{includeCore:false});
  const admitted=rows(store,next).find(row=>row.key===deferred.key);assert.deepEqual({...admitted},{...deferred,generation:next});
  store.clock=worker.clock=()=>now+60_000;assert(store.renew());
  const ready=nextAmendmentTask(store,next);assert.equal(ready.key,deferred.key);
  await worker.task(ready);assert.equal(rows(store,next).find(row=>row.key===deferred.key).done,1);
  assert.deepEqual(store.source(next,'amendment:continuations').work.completed,[completed]);
});

for(const [lane,core] of [['gaps',false],['mutable',false],['both',false],['gaps',true]])test('backfill publishes within four recovery batches with continuously due '+lane+(core?' after ordinary core work':''),async t=>{
  const {store,worker,generation,previous,options}=await fixture(t,{mode:'backfill',budget:17});
  store.transaction(()=>{
    for(let i=0;i<600;i++) {
      const key='/parliamentary-questions/E-10-2026-'+String(i+1).padStart(6,'0');
      if(lane!=='mutable')store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,key,'document',JSON.stringify({endpoint:key,offset:750}),84,'Missing',5,stamp,now-1,null);
      const mutableKey=lane==='both'?'/parliamentary-questions/E-10-2026-'+String(i+601).padStart(6,'0'):key;
      if(lane!=='gaps')store.db.prepare('INSERT INTO mutable_documents VALUES (?,?,?)').run(generation,mutableKey,now-1);
    }
    if(core)store.enqueue(generation,'/parliamentary-questions/E-10-2026-002000','document',{endpoint:'/parliamentary-questions/E-10-2026-002000'},200);
  });
  let turns=0,requests=0;
  const batches=[];
  store.release();
  while(store.get('working')) {
    assert(++turns<40,'a continuing due backlog must not keep this generation open');
    // A fresh worker each turn proves the admission bound survives resumes.
    const resumed=new ActivityWorker(store,options);await resumed.runIteration();requests+=resumed.requests;
    const cycle=store.get('working');
    if(cycle){batches.push(cycle.publicationRecoveryBatches);assert.equal(store.get('active'),previous);}
  }
  assert.equal(store.get('active'),generation);assert.equal(store.get('sequence'),generation);
  assert(batches.every(batch=>batch>=1&&batch<=4));
  assert.equal(requests,(lane==='mutable'?400:lane==='both'?500:100)+Number(core));
  const backlog=lane==='mutable'?store.db.prepare('SELECT COUNT(*) n FROM mutable_documents WHERE generation=? AND next_check<=?').get(generation,now).n:store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps WHERE generation=? AND retry_at<=?').get(generation,now).n;
  assert(backlog>0,'unfinished recovery remains durable for the next cycle');
  assert(worker.due(),'the remaining backlog wakes the next recovery cycle');
});
