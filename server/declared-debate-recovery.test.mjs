import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {CorpusWorker} from './corpus-worker.mjs';
import {declaredDebateRecoveryDue,scheduleDeclaredDebateRecovery} from './declared-debate-recovery.mjs';
import {declaredSpeechDiscoveryDue,discoverDeclaredSpeeches} from './declared-speech-discovery.mjs';
import {recordTaskGap} from './refresh-policy.mjs';

const time='2026-10-30T10:00:00.000Z',now=()=>Date.parse(time);
const parent='MTG-PL-2024-10-07-PVCRE-ITM-17',child=n=>'MTG-PL-2024-10-07-OTH-'+n;
const uri=id=>'eli/dl/event/'+id;
const node=(id,kind,extra={})=>({id:uri(id),activity_id:id,had_activity_type:'def/ep-activities/'+kind,...extra});
function fixture(t,records=new Map()) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'declared-debate-')),store=new ActivityStore(path.join(directory,'index'),{clock:now});
  assert(store.acquire());const {generation}=store.beginCycle(),calls=[];
  const worker=new ActivityWorker(store,{clock:now,recoveryMode:'backfill',fetchRecord:async endpoint=>{
    calls.push(endpoint);const value=records.get(endpoint);if(value instanceof Error)throw value;
    assert(value,'Unexpected endpoint '+endpoint);return {payload:{data:Array.isArray(value)?value:[value]},fetchedAt:time};
  }});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const task=key=>{const row=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key);return row&&{...row,body:JSON.parse(row.body)};};
  const procedure=(id='2024-0212',debates=[parent])=>store.putSource(generation,'/procedures/'+id,'procedure',{id:'eli/dl/proc/'+id,consists_of:debates.map(id=>node(id,'PLENARY_DEBATE',{activity_date:'2024-10-07'}))},time);
  return {directory,store,worker,generation,calls,task,procedure,records};
}

test('a declared URI-only child obtains a generic metadata owner without being assumed a speech',async t=>{
  const x=fixture(t);x.procedure();
  x.records.set('/events/'+parent,node(parent,'PLENARY_DEBATE',{activity_date:'2024-10-07',consists_of:[uri(child(1)),uri(child(2)),uri(child(3))]}));
  assert(declaredDebateRecoveryDue(x.store,x.generation));scheduleDeclaredDebateRecovery(x.worker,x.generation);
  await x.worker.task(x.task('debate-links:/procedures/2024-0212'));
  await x.worker.task(x.task('/events/'+parent));
  assert.deepEqual(x.calls,['/events/'+parent]);
  for(let i=1;i<=3;i++)assert.equal(x.task('/events/'+child(i)).done,0);
  assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM items').get().n,0);
  assert.equal(x.store.get('declaredDebateRecovery').complete,true);
  x.records.set('/events/'+child(1),node(child(1),'PLENARY_PROCEEDING',{inverse_consists_of:[uri(parent)]}));
  await x.worker.task(x.task('/events/'+child(1)));
  const saved=x.store.source(x.generation,'/events/'+child(1));
  assert.equal(saved.work.kind,'PLENARY_PROCEEDING');assert.equal(saved.work.date,null,'never inherit the parent date');
  assert.equal(saved.work.declaredBy,parent);assert.match(saved.work.source.url,/\/events\//);
  assert.equal(x.task('recovery:/speeches/'+child(1)),undefined);
  x.records.set('/events/'+child(2),node(child(2),'PLENARY_DEBATE_SPEECH',{activity_date:'2024-10-08',inverse_consists_of:[uri(parent)]}));
  await x.worker.task(x.task('/events/'+child(2)));
  const owned=x.task('recovery:/speeches/'+child(2));assert.equal(owned.body.params['sitting-date'],'2024-10-08');
  x.records.set('/speeches/'+child(2),node(child(2),'PLENARY_DEBATE_SPEECH',{activity_date:'2024-10-08',had_participation:[{had_participant_person:['person/42']}]}));
  await x.worker.task(owned);
  assert.equal(x.store.source(x.generation,'/speeches/'+child(2)).work.date,'2024-10-08');
  assert.equal(x.store.db.prepare('SELECT mep FROM items WHERE source_id=?').get(child(2)).mep,'42');
  assert.equal(x.task('/events/'+child(3)).done,0,'unrelated declarations keep their owners');
});

test('generic classification rejects foreign, duplicate, untyped, wrongly parented and undated speech records',async t=>{
  const x=fixture(t),key='/events/'+child(1);
  for(const response of [node(child(2),'PLENARY_PROCEEDING'),[node(child(1),'PLENARY_PROCEEDING'),node(child(1),'PLENARY_PROCEEDING')],{id:uri(child(1))},node(child(1),'PLENARY_PROCEEDING',{inverse_consists_of:[uri(parent+'0')]}),node(child(1),'PLENARY_DEBATE_SPEECH')]) {
    x.store.enqueue(x.generation,key,'declared-event',{id:child(1),role:'child',parent},103);
    x.records.set(key,response);await assert.rejects(x.worker.task(x.task(key)));
    assert.equal(x.store.source(x.generation,key),undefined);assert.equal(x.task(key).done,0);
  }
});

test('failed generic metadata has an ordinary durable retry and cannot erase a sibling success',async t=>{
  const x=fixture(t),key='/events/'+child(3),error=Object.assign(new Error('EP API returned 500 at '+key+'.'),{status:500,retryAfter:600});
  x.store.enqueue(x.generation,key,'declared-event',{id:child(3),role:'child',parent},103);
  x.records.set(key,error);await assert.rejects(x.worker.task(x.task(key)),/500/);
  const failed={...x.task(key),attempts:4};assert(recordTaskGap(x.worker,failed,error));
  const gap=x.store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=? AND key=?').get(x.generation,key);
  assert.equal(gap.kind,'declared-event');assert(gap.retry_at>=now()+600000);assert.equal(JSON.parse(gap.body).parent,parent);
  assert.equal(x.store.source(x.generation,key),undefined,'settling the failed task is not recovery');
});

test('canonical future and deferred owners survive admission and late ownership checks byte for byte',async t=>{
  const x=fixture(t);x.procedure();
  x.records.set('/events/'+parent,node(parent,'PLENARY_DEBATE',{consists_of:[uri(child(1)),uri(child(2)),uri(child(3))]}));
  x.store.enqueue(x.generation,'recovery:/speeches/'+child(1),'speeches',{recoveryId:child(1),offset:250},103);
  x.store.db.prepare('UPDATE tasks SET attempts=3,retry_at=?,error=? WHERE key=?').run(now()+86400000,'old error','recovery:/speeches/'+child(1));
  const before=x.task('recovery:/speeches/'+child(1));
  x.store.putSource(x.generation,'amendment:continuations','checkpoint',{tasks:[{key:'recovery:/speeches/'+child(2),kind:'speeches',retry_at:now()+86400000,body:JSON.stringify({recoveryId:child(2)})}]},time);
  scheduleDeclaredDebateRecovery(x.worker,x.generation);await x.worker.task(x.task('debate-links:/procedures/2024-0212'));await x.worker.task(x.task('/events/'+parent));
  assert.equal(x.task('/events/'+child(1)),undefined);assert.equal(x.task('/events/'+child(2)),undefined);
  assert.deepEqual(x.task('recovery:/speeches/'+child(1)),before);
  x.store.enqueue(x.generation,'recovery:/speeches/'+child(3),'speeches',{recoveryId:child(3)},103);
  x.store.db.prepare('UPDATE tasks SET retry_at=? WHERE key=?').run(now()+86400000,'recovery:/speeches/'+child(3));
  await x.worker.task(x.task('/events/'+child(3)));
  assert.deepEqual(x.calls,['/events/'+parent],'late canonical owner prevents a new request');
  assert.equal(x.task('recovery:/speeches/'+child(3)).retry_at,now()+86400000);
});

test('discovery and parent child fan-out resume bounded cursors after reopening',async t=>{
  const x=fixture(t);
  for(let i=0;i<101;i++)x.procedure('2024-'+String(i).padStart(4,'0'));
  scheduleDeclaredDebateRecovery(x.worker,x.generation);
  assert.equal(x.store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='debate-links'").get().n,100);
  const reopened=new ActivityStore(path.join(x.directory,'index'),{clock:now});t.after(()=>reopened.close());
  x.store.release();assert(reopened.acquire());
  const worker=new ActivityWorker(reopened,{clock:now,recoveryMode:'backfill'});scheduleDeclaredDebateRecovery(worker,x.generation);
  assert(reopened.db.prepare('SELECT 1 FROM tasks WHERE key=?').get('debate-links:/procedures/2024-0100'));
  assert.equal(reopened.get('declaredDebateRecovery').complete,true);
  reopened.release();assert(x.store.acquire());
  x.records.set('/events/'+parent,node(parent,'PLENARY_DEBATE',{consists_of:Array.from({length:201},(_,i)=>uri(child(i)))}));
  x.store.enqueue(x.generation,'/events/'+parent,'declared-event',{id:parent,role:'debate'},103);
  for(let i=1;i<=3;i++) {
    await x.worker.task(x.task('/events/'+parent));
    assert.equal(x.store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='declared-event' AND key<>?").get('/events/'+parent).n,Math.min(i*100,201));
  }
  assert.deepEqual(x.calls,['/events/'+parent]);assert.equal(x.task('/events/'+parent).done,1);
});

test('post-request lease loss fences metadata and child jobs',async t=>{
  const x=fixture(t),key='/events/'+child(1);
  x.store.enqueue(x.generation,key,'declared-event',{id:child(1),role:'child',parent},103);
  x.worker.fetchRecord=async()=>{x.store.release();return {payload:{data:[node(child(1),'PLENARY_PROCEEDING')]},fetchedAt:time};};
  await assert.rejects(x.worker.task(x.task(key)),/lease/);
  assert.equal(x.store.source(x.generation,key),undefined);assert.equal(x.task(key).done,0);
});
test('the real dispatch loop finishes the scan before publishing when its first batch already completed',async t=>{
  const x=fixture(t);
  for(let i=0;i<101;i++) {
    const id='2024-'+String(i).padStart(4,'0');x.procedure(id,[]);
    if(i<100){const key='debate-links:/procedures/'+id;x.store.enqueue(x.generation,key,'debate-links',{endpoint:'/procedures/'+id,offset:0},102);x.store.finishTask(x.task(key));}
  }
  x.store.updateCycle({initialized:true,membershipScheduled:true,groupHistoryScheduled:true,historyReadinessVersion:1,mutableScheduled:true,motionOutcomesDay:'2026-10-30',reportJoinsReady:true,procedureTitlesQueued:true,procedureTypesQueued:true});
  const dispatched=[];x.worker.budget=1;
  x.worker.task=async task=>{dispatched.push(task.key);if(task.key==='debate-links:/procedures/2024-0100')x.worker.requests++;x.store.finishTask(task);};
  await x.worker.run();
  assert(dispatched.includes('debate-links:/procedures/2024-0100'));
  assert.equal(x.store.get('active'),null,'available future batches are not skipped by publication');
  assert.equal(x.store.get('working').generation,x.generation);
});

test('published exact speech metadata gives the existing corpus writer a transcript owner; future owners stay unchanged',async t=>{
  const x=fixture(t);
  for(const id of [child(1),child(2)])x.store.putSource(x.generation,'/speeches/'+id,'speech',{id,kind:'PLENARY_DEBATE_SPEECH',date:'2024-10-07'},time);
  x.store.putSource(x.generation,'/events/'+child(3),'event',{id:child(3),kind:'PLENARY_PROCEEDING'},time);
  x.store.set('active',x.generation);
  const corpus=new CorpusStore(path.join(x.directory,'corpus'),{indexFile:x.store.filename,clock:now});assert(corpus.acquire());t.after(()=>corpus.close());
  corpus.enqueue('speech:'+child(2),'speech',{id:child(2),offset:7},61);
  corpus.db.prepare('UPDATE tasks SET attempts=5,retry_at=?,error=? WHERE key=?').run(now()+86400000,'old timeout','speech:'+child(2));
  const before=corpus.task('speech:'+child(2)),worker=new CorpusWorker(corpus,{clock:now});
  assert(declaredSpeechDiscoveryDue(corpus,x.generation));await discoverDeclaredSpeeches(worker,x.generation);
  assert.equal(corpus.task('speech:'+child(1)).kind,'speech');assert.equal(corpus.task('speech:'+child(1)).body.declaredIndex,true);
  assert.deepEqual(corpus.task('speech:'+child(2)),before);assert.equal(corpus.task('speech:'+child(3)),undefined);
  assert.equal(declaredSpeechDiscoveryDue(corpus,x.generation),false);
  const fragment='<oralStatements xml:lang="en"><intervention><from><person refersTo="person/42">Person</person></from><p>Exact retained transcript.</p></intervention></oralStatements>';
  worker.fetchRecord=async()=>({payload:{data:[node(child(1),'PLENARY_DEBATE_SPEECH',{activity_date:'2024-10-07',recorded_in_a_realization_of:[{id:'eli/dl/doc/CRE',originalLanguage:['ENG'],'api:xmlFragment':{en:fragment}}]})]},fetchedAt:time});
  await worker.task(corpus.task('speech:'+child(1)));
  assert.equal(corpus.task('speech:'+child(1)).done,1);assert(corpus.db.prepare('SELECT 1 FROM texts WHERE chars>0').get());
  assert.deepEqual(corpus.task('speech:'+child(2)),before);
});
