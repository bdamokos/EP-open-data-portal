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
import {recordTaskGap,scheduleGapRecovery} from './refresh-policy.mjs';
import {DossierActivity} from './dossier-activity.mjs';

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
  const task=(key,g=generation)=>{const row=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(g,key);return row&&{...row,body:JSON.parse(row.body)};};
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
  assert.equal(x.store.source(x.generation,'/speeches/'+child(2)).work.declaredParent,parent);
  assert.equal(x.store.db.prepare('SELECT mep FROM items WHERE source_id=?').get(child(2)).mep,'42');
  assert.equal(x.task('/events/'+child(3)).done,0,'unrelated declarations keep their owners');
});

test('generic classification rejects foreign, duplicate, untyped, wrongly parented and undated speech records',async t=>{
  const x=fixture(t),key='/events/'+child(1);
  for(const response of [node(child(2),'PLENARY_PROCEEDING'),[node(child(1),'PLENARY_PROCEEDING'),node(child(1),'PLENARY_PROCEEDING')],[node(child(1),'PLENARY_PROCEEDING'),node(child(2),'PLENARY_PROCEEDING',{activity_id:child(1)})],{id:uri(child(1))},node(child(1),'PLENARY_PROCEEDING',{inverse_consists_of:[uri(parent+'0')]}),node(child(1),'PLENARY_DEBATE_SPEECH')]) {
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

test('checkpoint-admitted future speech and event owners survive generation copies and late dispatch',async t=>{
  const x=fixture(t);x.procedure();x.store.publish(x.generation);
  for(const [key,kind,body] of [
    ['recovery:/speeches/'+child(1),'speeches',{recoveryId:child(1),offset:250}],
    ['/events/'+child(2),'declared-event',{id:child(2),role:'child',parent,childOffset:100}],
  ]) {
    x.store.enqueue(x.generation,key,kind,body,103);
    x.store.db.prepare('UPDATE tasks SET attempts=3,retry_at=?,error=? WHERE generation=? AND key=?').run(now()+86400000,'saved future retry',x.generation,key);
  }
  x.worker.checkpointContinuations(x.generation);
  const before=x.store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? ORDER BY key').all(x.generation);
  assert.equal(before.length,2);
  const g=x.store.beginCycle().generation;
  x.records.set('/events/'+parent,node(parent,'PLENARY_DEBATE',{consists_of:[1,2,3].map(n=>uri(child(n)))}));
  scheduleDeclaredDebateRecovery(x.worker,g);await x.worker.task(x.task('debate-links:/procedures/2024-0212',g));await x.worker.task(x.task('/events/'+parent,g));
  assert.equal(x.task('/events/'+child(1),g),undefined,'future admitted speech owner prevents classification fan-out');
  assert.equal(x.task('/events/'+child(2),g),undefined,'future admitted event owner prevents a duplicate owner');
  for(const prior of before)assert.deepEqual({...x.store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(g,prior.key),generation:x.generation},{...prior});
  const key='recovery:/speeches/'+child(3);x.store.enqueue(g,key,'speeches',{recoveryId:child(3),offset:500},103);
  x.store.db.prepare('UPDATE tasks SET attempts=2,retry_at=? WHERE generation=? AND key=?').run(now()+86400000,g,key);
  x.worker.checkpointContinuations(g);
  const owner=x.store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(g,key);
  const queued=x.store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(g,'/events/'+child(3));
  await x.worker.task({...queued,body:JSON.parse(queued.body),amendmentJob:true});
  assert.deepEqual(x.calls,['/events/'+parent],'late admitted owner prevents the generic request');
  assert.deepEqual(x.store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(g,key),owner);
});

for(const [label,change] of [
  ['URI',{id:uri(child(999))}],['activity identifier',{activity_id:child(999)}],
  ['old date',{activity_date:'2023-01-01'}],['invalid date',{activity_date:'2024-02-30'}],
  ['future date',{activity_date:'2027-01-01'}],
  ['type',{had_activity_type:'def/ep-activities/PLENARY_PROCEEDING'}],
  ['parent',{inverse_consists_of:[uri(parent+'0')]}],
  ['extra parent',{inverse_consists_of:[uri(parent),uri(parent+'0')]}],
  ['explicit term',{parliamentary_term:'org/ep-9'}],
])test('speech detail preserves declared '+label+' safeguards after generic classification',async t=>{
  const x=fixture(t),id=child(20),key='/events/'+id;
  x.store.enqueue(x.generation,key,'declared-event',{id,role:'child',parent},103);
  x.records.set(key,node(id,'PLENARY_DEBATE_SPEECH',{activity_date:'2024-10-07',inverse_consists_of:[uri(parent)]}));
  await x.worker.task(x.task(key));
  const recovery=x.task('recovery:/speeches/'+id);
  x.records.set('/speeches/'+id,node(id,'PLENARY_DEBATE_SPEECH',{activity_date:'2024-10-07',inverse_consists_of:[uri(parent)],had_participation:[{had_participant_person:['person/42']}],...change}));
  const error=await x.worker.task(recovery).then(()=>null,error=>error);
  assert(error,'contradictory speech detail must not be accepted');
  assert.equal(x.store.source(x.generation,'/speeches/'+id),undefined);assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM items').get().n,0);
  assert(recordTaskGap(x.worker,{...recovery,attempts:4},error));
  const gap=x.store.db.prepare('SELECT body FROM refresh_gaps WHERE generation=? AND key=?').get(x.generation,recovery.key);
  assert.equal(JSON.parse(gap.body).declaredParent,parent);
  const reader=new DossierActivity(x.store,{reader:{record:async()=>({payload:{data:[node(parent,'PLENARY_DEBATE',{consists_of:[uri(id)]})]},url:'https://data.europarl.europa.eu/api/v2/events/'+parent,fetchedAt:time})}});
  const result={generation:x.generation,coverage:{sources:[],gaps:[]},pagination:{}};
  await reader.speeches(result,{consists_of:[node(parent,'PLENARY_DEBATE')]},{targetOffset:0,language:'en',member:'42'},()=>{});
  // The rejected detail cannot attribute this URI-only declaration to person42.
  // Recovery remains owned, but this person's count must not inherit that gap.
  assert.equal(result.coverage.status,'complete');assert.deepEqual(result.coverage.missingSpeechIds,[]);assert.deepEqual(result.coverage.unresolvedChildIds,[id]);
});

test('a changed parent observation resets fan-out even if it committed before the cursor checkpoint failed',async t=>{
  const x=fixture(t);let ms=now();x.store.clock=()=>ms;x.worker.clock=()=>ms;
  x.worker.fetchRecord=async endpoint=>({payload:{data:[x.records.get(endpoint)]},fetchedAt:new Date(ms).toISOString()});
  const key='/events/'+parent,old=Array.from({length:201},(_,i)=>uri(child(i)));
  x.store.enqueue(x.generation,key,'declared-event',{id:parent,role:'debate'},103);
  x.records.set(key,node(parent,'PLENARY_DEBATE',{consists_of:old}));await x.worker.task(x.task(key));
  assert.equal(x.task(key).body.childOffset,100);
  ms+=8*86400000;assert(x.store.acquire());
  const added=child(99999);x.records.set(key,node(parent,'PLENARY_DEBATE',{consists_of:[uri(added),...old]}));
  const progress=x.store.taskProgress;
  x.store.taskProgress=()=>{throw new Error('fixture checkpoint rollback');};
  try{await assert.rejects(x.worker.task(x.task(key)),/fixture checkpoint rollback/);}finally{x.store.taskProgress=progress;}
  assert(x.store.source(x.generation,key).work.children.includes(added));assert.equal(x.task('/events/'+added),undefined);
  while(!x.task(key).done)await x.worker.task(x.task(key));
  assert(x.task('/events/'+added),'new reference before the saved offset must receive an owner');
  assert.equal(x.store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='declared-event' AND key<>?").get(key).n,202);
});

for(const [label,change] of [['URI',{id:uri(child(999))}],['date',{activity_date:'2023-01-01'}],['type',{had_activity_type:'def/ep-activities/PLENARY_PROCEEDING'}],['parent',{inverse_consists_of:[uri(parent+'0')]}]])test('corpus handoff preserves the declared '+label+' guard before retaining text',async t=>{
  const x=fixture(t),id=child(30);
  x.store.putSource(x.generation,'/speeches/'+id,'speech',{id,kind:'PLENARY_DEBATE_SPEECH',date:'2024-10-07',declaredParent:parent},time);
  x.store.set('active',x.generation);
  const corpus=new CorpusStore(path.join(x.directory,'corpus'),{indexFile:x.store.filename,clock:now});assert(corpus.acquire());t.after(()=>corpus.close());
  const fragment='<oralStatements xml:lang="en"><intervention><p>Do not retain this contradictory body.</p></intervention></oralStatements>';
  const worker=new CorpusWorker(corpus,{clock:now,fetchRecord:async()=>({payload:{data:[node(id,'PLENARY_DEBATE_SPEECH',{activity_date:'2024-10-07',inverse_consists_of:[uri(parent)],recorded_in_a_realization_of:[{id:'eli/dl/doc/CRE','api:xmlFragment':{en:fragment}}],...change})]},fetchedAt:time})});
  await discoverDeclaredSpeeches(worker,x.generation);
  const task=corpus.task('speech:'+id);assert.equal(task.body.declaredParent,parent);
  await assert.rejects(worker.task(task));
  assert.equal(corpus.task(task.key).done,0);assert.equal(corpus.db.prepare('SELECT COUNT(*) n FROM texts').get().n,0);assert.equal(corpus.db.prepare('SELECT COUNT(*) n FROM speech_metadata').get().n,0);
});

test('an admitted failed event yields to a future owner once without retiring its endpoint gap',async t=>{
  const x=fixture(t);let ms=now();x.store.clock=x.worker.clock=()=>ms;
  const key='/events/'+child(41),canonical='recovery:/speeches/'+child(41);
  x.store.enqueue(x.generation,key,'declared-event',{id:child(41),role:'child',parent},103);
  assert(recordTaskGap(x.worker,{...x.task(key),attempts:4},new Error('fixture failed endpoint')));
  ms+=8*86400000;assert(x.store.acquire());assert.equal(scheduleGapRecovery(x.worker,x.generation),1);
  x.worker.checkpointContinuations(x.generation);
  x.store.enqueue(x.generation,canonical,'speeches',{recoveryId:child(41),offset:250},103);
  x.store.db.prepare('UPDATE tasks SET attempts=3,retry_at=?,error=? WHERE generation=? AND key=?').run(ms+86400000,'future canonical owner',x.generation,canonical);
  x.worker.checkpointContinuations(x.generation);
  const before=x.store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(x.generation,canonical);
  const gap=x.store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=? AND key=?').get(x.generation,key);
  const row=x.store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(x.generation,key);
  assert.equal(row.done,0);await x.worker.task({...row,body:JSON.parse(row.body),amendmentJob:true});
  assert.equal(x.store.db.prepare('SELECT done FROM amendment_jobs WHERE generation=? AND key=?').get(x.generation,key).done,1);
  assert.deepEqual(x.store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(x.generation,canonical),before);
  assert.deepEqual(x.store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=? AND key=?').get(x.generation,key),gap);
  assert.deepEqual(x.calls,[]);
});

test('ordinary procedure refresh restarts relationship paging on a changed observation, even at the same retrieval time',async t=>{
  const x=fixture(t),key='/procedures/2024-0212',links='debate-links:'+key;
  const ids=Array.from({length:201},(_,i)=>'MTG-PL-2024-10-07-PVCRE-ITM-'+i),added='MTG-PL-2024-10-07-PVCRE-ITM-99999';
  const procedure=list=>({id:'eli/dl/proc/2024-0212',consists_of:list.map(id=>node(id,'PLENARY_DEBATE'))});
  x.store.putSource(x.generation,key,'procedure',procedure(ids),time);
  scheduleDeclaredDebateRecovery(x.worker,x.generation);await x.worker.task(x.task(links));assert.equal(x.task(links).body.offset,100);
  x.store.enqueue(x.generation,key,'procedure',{endpoint:key},105);x.records.set(key,procedure([added,...ids.slice().reverse()]));
  await x.worker.task(x.task(key));assert.equal(x.store.source(x.generation,key).fetchedAt,time);
  while(!x.task(links).done)await x.worker.task(x.task(links));
  for(const id of [added,...ids])assert(x.task('/events/'+id),'Every observed debate receives an owner: '+id);
  assert.equal(x.store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='declared-event'").get().n,202);
});

test('oversized procedure relationship observations stay owned without returning unbounded metadata or admitting children',async t=>{
  const x=fixture(t),key='/procedures/2024-0212';
  x.store.putSource(x.generation,key,'procedure',{id:'eli/dl/proc/2024-0212',consists_of:[node(parent,'PLENARY_DEBATE',{based_on_a_realization_of:['x'.repeat(8*1024*1024)]})]},time);
  scheduleDeclaredDebateRecovery(x.worker,x.generation);
  await assert.rejects(x.worker.task(x.task('debate-links:'+key)),/8 MiB/);
  assert.equal(x.task('debate-links:'+key).done,0);assert.equal(x.task('/events/'+parent),undefined);assert.deepEqual(x.calls,[]);
});

test('yielding a queued duplicate preserves the actual admitted event owner and its gap reservation',async t=>{
  const x=fixture(t);let ms=now();x.store.clock=x.worker.clock=()=>ms;const key='/events/'+child(42);
  x.store.enqueue(x.generation,key,'declared-event',{id:child(42),role:'child',parent},103);
  assert(recordTaskGap(x.worker,{...x.task(key),attempts:4},new Error('fixture failed endpoint')));
  ms+=8*86400000;assert(x.store.acquire());assert.equal(scheduleGapRecovery(x.worker,x.generation),1);
  x.worker.checkpointContinuations(x.generation);
  x.store.db.prepare('UPDATE amendment_jobs SET retry_at=? WHERE generation=? AND key=?').run(ms+86400000,x.generation,key);
  const owner=x.store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(x.generation,key);
  const gap=x.store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=? AND key=?').get(x.generation,key);
  x.store.db.prepare('INSERT INTO tasks SELECT generation,key,kind,body,priority,done,attempts,0,error FROM amendment_jobs WHERE generation=? AND key=?').run(x.generation,key);
  await x.worker.task(x.task(key));
  assert.equal(x.task(key).done,1);
  assert.deepEqual(x.store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(x.generation,key),owner);
  assert.deepEqual(x.store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=? AND key=?').get(x.generation,key),gap);
  assert(x.store.db.prepare('SELECT 1 FROM refresh_gap_admissions WHERE generation=? AND key=?').get(x.generation,key));
  assert.deepEqual(x.calls,[]);
});

for(const recovery of [true,false])test(`cancelled ${recovery?'declared detail':'catalogue'} responses cannot retain speech metadata or finish work`,async t=>{
  const x=fixture(t),id=child(51),key=recovery?'recovery:/speeches/'+id:'catalog:/speeches:cancelled';
  x.store.enqueue(x.generation,key,'speeches',recovery?{recoveryId:id,declaredParent:parent}:{params:{'sitting-date':'2024-10-07','sitting-date-end':'2024-10-07'},offset:0},103);
  x.worker.fetchRecord=async()=>{
    x.worker.controller.abort(new Error('fixture cancellation'));
    return {payload:{data:[node(id,'PLENARY_DEBATE_SPEECH',{activity_date:'2024-10-07',inverse_consists_of:[uri(parent)],had_participation:[{had_participant_person:['person/42']}]})]},fetchedAt:time};
  };
  await assert.rejects(x.worker.task(x.task(key)),/cancellation/);
  assert.equal(x.store.source(x.generation,'/speeches/'+id),undefined);
  assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM items WHERE source_id=?').get(id).n,0);
  assert.equal(x.task(key).done,0);assert.equal(x.task(key).body.offset,recovery?undefined:0);
});

test('ordinary catalogue refresh retains declared lineage and explicit conflicting links without inventing omitted links',async t=>{
  const x=fixture(t),id=child(52),key='recovery:/speeches/'+id,catalog='catalog:/speeches:lineage',other=parent+'0';
  const speech=extra=>node(id,'PLENARY_DEBATE_SPEECH',{activity_date:'2024-10-07',had_participation:[{had_participant_person:['person/42']}],...extra});
  x.store.enqueue(x.generation,key,'speeches',{recoveryId:id,declaredParent:parent},103);
  x.records.set('/speeches/'+id,speech({inverse_consists_of:[uri(parent)]}));await x.worker.task(x.task(key));
  x.store.enqueue(x.generation,catalog,'speeches',{params:{'sitting-date':'2024-10-07','sitting-date-end':'2024-10-07'},offset:0},100);
  x.records.set('/speeches',[speech({})]);await x.worker.task(x.task(catalog));
  let saved=x.store.source(x.generation,'/speeches/'+id).work;
  assert.equal(saved.declaredParent,parent);assert.equal(Object.hasOwn(saved,'inverse_consists_of'),false);
  x.store.enqueue(x.generation,catalog+':refresh','speeches',{params:{'sitting-date':'2024-10-07','sitting-date-end':'2024-10-07'},offset:0},100);
  x.records.set('/speeches',[speech({inverse_consists_of:[uri(other)]})]);await x.worker.task(x.task(catalog+':refresh'));
  saved=x.store.source(x.generation,'/speeches/'+id).work;
  assert.equal(saved.declaredParent,parent);assert.deepEqual(saved.inverse_consists_of,[uri(other)]);
  const dossier=new DossierActivity(x.store,{reader:{record:async()=>({payload:{data:[node(parent,'PLENARY_DEBATE',{activity_date:'2024-10-07',consists_of:[uri(id)]})]},url:'https://data.europarl.europa.eu/api/v2/events/'+parent,fetchedAt:time})}});
  const result={generation:x.generation,coverage:{sources:[],gaps:[]},pagination:{}};
  await dossier.speeches(result,{consists_of:[node(parent,'PLENARY_DEBATE')]},{targetOffset:0,language:'en',member:'42'},items=>{result.items=items;});
  assert.deepEqual(result.items,[]);assert.equal(result.coverage.status,'partial');
  assert(result.coverage.gaps.includes('A contribution has conflicting debate links.'));
});

for(const emptyRow of [false,true])test(`six-hour discovery reopens ${emptyRow?'zero-character':'textless'} speech documents while preserving pending future retries`,async t=>{
  const x=fixture(t);let ms=now();const clock=()=>ms,id=child(53),key='speech:'+id;
  x.store.putSource(x.generation,'/speeches/'+id,'speech',{id,kind:'PLENARY_DEBATE_SPEECH',date:'2024-10-07',declaredParent:parent},time);x.store.publish(x.generation);
  const corpus=new CorpusStore(path.join(x.directory,'corpus'),{indexFile:x.store.filename,clock});assert(corpus.acquire());t.after(()=>corpus.close());
  const worker=new CorpusWorker(corpus,{clock,fetchRecord:async()=>({payload:{data:[node(id,'PLENARY_DEBATE_SPEECH',{activity_date:'2024-10-07',inverse_consists_of:[uri(parent)]})]},fetchedAt:new Date(ms).toISOString()})});
  await discoverDeclaredSpeeches(worker,x.generation);await worker.task(corpus.task(key));
  assert.equal(corpus.task(key).done,1);assert.equal(corpus.db.prepare('SELECT COUNT(*) n FROM texts').get().n,0);
  if(emptyRow)corpus.putDocument({sourceId:id,kind:'speech',date:'2024-10-07'},[{language:'en',sourceKey:'en',translationType:'original',sourceFormat:'xml-fragment',sourceUrl:'https://data.europarl.europa.eu/api/v2/speeches/'+id,fetchedAt:time,body:''}]);
  ms+=6*3600000;assert(corpus.acquire());assert(declaredSpeechDiscoveryDue(corpus,x.generation));await discoverDeclaredSpeeches(worker,x.generation);
  assert.equal(corpus.task(key).done,0);assert.equal(corpus.task(key).body.declaredParent,parent);
  corpus.failTask(corpus.task(key),new Error('fixture source unavailable'),12*3600);
  const pending=corpus.task(key);
  ms+=6*3600000;assert(corpus.acquire());await discoverDeclaredSpeeches(worker,x.generation);
  assert.deepEqual(corpus.task(key),pending,'real future owner and its clock survive another scan');
});
