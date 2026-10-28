import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {projectDocument} from './activity-index-model.mjs';
import {adoptedTextDiscoveryDue,scheduleAdoptedTexts,validateAdoptedText,adoptedTextRecord,adoptedTextRepairDue,scheduleAdoptedTextRepairs} from './adopted-text-index.mjs';
import {recordTaskGap,scheduleMutable,scheduleGapRecovery,gapRecoveryDue} from './refresh-policy.mjs';
import {motionAmendmentsPage,motionAmendmentsQuery} from './motion-amendments.mjs';

const at=Date.parse('2026-10-28T12:00:00Z'),stamp=new Date(at).toISOString();
const target='B-10-2026-0001',id='TA-10-2026-0001',endpoint='/adopted-texts/'+id;
// Synthetic records follow the public API's adopted-text and exact-link schema.
const adopted=(extra={})=>({id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/TEXT_ADOPTED',parliamentary_term:'org/ep-10',document_date:'2026-10-20',title_dcterms:{en:'Adopted title'},adopts:['eli/dl/doc/'+target],...extra});
function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'adopted-index-'));let now=at;
  const store=new ActivityStore(directory,{clock:()=>now});store.acquire();const cycle=store.beginCycle();
  const worker=new ActivityWorker(store,{clock:()=>now,fetchRecord:async()=>{throw new Error('Unexpected source request');}});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,worker,cycle,setYear:year=>{store.release();now=Date.parse(year+'-01-02T12:00:00Z');assert(store.acquire());}};
}

test('versioned adopted-text admission is restartable, preserves cursors and adds only a new year',t=>{
  const {store,worker,cycle,setYear}=setup(t);
  assert.equal(adoptedTextDiscoveryDue(store),true);assert.equal(scheduleAdoptedTexts(worker,cycle),true);
  const tasks=store.db.prepare("SELECT * FROM tasks WHERE kind='catalog' ORDER BY key").all();
  assert.equal(tasks.length,3);assert.deepEqual(tasks.map(row=>JSON.parse(row.body).params.year),[2024,2025,2026]);
  assert(tasks.every(row=>JSON.parse(row.body).params['parliamentary-term']===10));
  const progressed={...JSON.parse(tasks[0].body),offset:250};store.taskProgress(tasks[0],progressed);
  assert.equal(scheduleAdoptedTexts(worker,cycle),false);
  assert.equal(JSON.parse(store.db.prepare('SELECT body FROM tasks WHERE key=?').get(tasks[0].key).body).offset,250);
  setYear(2027);assert.equal(scheduleAdoptedTexts(worker,cycle),true);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='catalog'").get().n,4);
  assert.equal(adoptedTextDiscoveryDue(store),false);
  store.set('adoptedTextDiscovery',{version:1,throughYear:'2027'});assert.equal(adoptedTextDiscoveryDue(store),true);
});

test('one missing adopted-text detail does not block the next exact record or lose its gap',async t=>{
  const {store,worker,cycle}=setup(t),other='TA-10-2026-0002';
  const catalog={generation:cycle.generation,key:'adopted-catalog',kind:'catalog',body:{endpoint:'/adopted-texts',params:{year:2026,'parliamentary-term':10},offset:0},priority:100};
  store.enqueue(cycle.generation,catalog.key,catalog.kind,catalog.body,100);
  worker.fetchRecord=async()=>({fetchedAt:stamp,payload:{data:[{identifier:id},{identifier:other},{identifier:'TA-9-2023-0001'}]}});
  await worker.task(catalog);
  assert.equal(store.source(cycle.generation,endpoint),undefined);
  const missing=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(cycle.generation,endpoint);
  worker.fetchRecord=async ep=>{if(ep===endpoint)throw Object.assign(new Error('EP API returned 404'),{status:404});return {fetchedAt:stamp,payload:{data:[adopted({id:'eli/dl/doc/'+other,identifier:other})]}};};
  await assert.rejects(worker.task({...missing,body:JSON.parse(missing.body)}),/404/);
  assert(recordTaskGap(worker,{...missing,body:JSON.parse(missing.body)},Object.assign(new Error('EP API returned 404'),{status:404})));
  await worker.task({generation:cycle.generation,key:'/adopted-texts/'+other,kind:'document',body:{endpoint:'/adopted-texts/'+other}});
  assert(store.source(cycle.generation,'/adopted-texts/'+other));
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps WHERE generation=? AND key=?').get(cycle.generation,endpoint).n,1);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM tasks WHERE key LIKE '%TA-9-%'").get().n,0);
});

test('detail ingestion retains exact adoption links for the existing indexed motion reader',async t=>{
  const {store,worker,cycle}=setup(t);
  store.putSource(cycle.generation,'/plenary-documents/'+target,'document',{id:'eli/dl/doc/'+target,identifier:target,work_type:'def/ep-document-types/RESOLUTION_MOTION',document_date:'2026-10-19'},stamp);
  worker.fetchRecord=async()=>({fetchedAt:stamp,payload:{data:[{id:'eli/dl/doc/another',type:'Work'},adopted({document_date:null})]}});
  await worker.task({generation:cycle.generation,key:endpoint,kind:'document',body:{endpoint}});
  worker.finalize(cycle.generation);assert.equal(store.get('active'),cycle.generation);
  const read=motionAmendmentsPage(store,motionAmendmentsQuery(target,new URLSearchParams('lang=en')));
  assert.equal(read.relations.adoptedTexts[0].id,id);
  assert.equal(read.relations.adoptedTexts[0].relationship.to,target);
  assert.equal(read.relations.adoptedTexts[0].date,null);
  assert.deepEqual(store.source(cycle.generation,endpoint).work.adopts,['eli/dl/doc/'+target]);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=?').get(cycle.generation).n,0,'adoption does not invent individual authorship');
  for(const value of [null,[],['eli/dl/doc/'+target]])assert.deepEqual(projectDocument(adopted({adopts:value})).adopts,value);
  const unknown=adopted();delete unknown.adopts;assert.equal(Object.hasOwn(projectDocument(unknown),'adopts'),false);
  for(const change of [{identifier:'TA-9-2023-0001'},{id:'https://example.org/'+id},{work_type:'def/ep-document-types/REPORT_PLENARY'},{parliamentary_term:'org/ep-9'}])assert.throws(()=>validateAdoptedText(endpoint,adopted(change)),/Invalid/);
  assert.throws(()=>adoptedTextRecord(endpoint,[adopted(),adopted({adopts:[]})]),/conflicting/);
});

test('adopted-text update feeds retain their custom interval and refresh final-language metadata',async t=>{
  const {store,worker,cycle}=setup(t);
  const languages='bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(' ');
  store.putSource(cycle.generation,endpoint,'document',projectDocument(adopted({is_realized_by:languages.map(language=>({language,is_embodied_by:[{format:'DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/test/'+language+'.docx'}]}))})), '2026-09-01T12:00:00Z');
  worker.fetchRecord=async(ep,params,opts)=>{
    assert.equal(ep,'/adopted-texts/feed');assert.deepEqual(params,{timeframe:'custom','start-date':'2024-07-16'});assert.equal(opts.xml,true);
    return {fetchedAt:stamp,xml:'<feed><entry><id>https://data.europarl.europa.eu/eli/dl/doc/'+id+'</id><updated>2026-10-27T12:00:00Z</updated></entry></feed>'};
  };
  const task={generation:cycle.generation,key:'feed:adopted',kind:'feed',body:{endpoint:'/adopted-texts',start:'2024-07-16'}};
  store.enqueue(cycle.generation,task.key,task.kind,task.body,105);await worker.task(task);
  assert.equal(store.db.prepare('SELECT done FROM tasks WHERE generation=? AND key=?').get(cycle.generation,endpoint).done,0);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM refresh_gaps WHERE kind='coverage'").get().n,0,'custom feeds do not acquire a fixed-month gap');
});

test('legacy adoption projections are repaired once; a new upstream omission is retained without an endless retry',async t=>{
  const {store,worker,cycle}=setup(t),old=adopted({is_realized_by:'bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(' ').map(language=>({language,is_embodied_by:[{format:'DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/test/'+language+'.docx'}]}))});delete old.adopts;
  store.set('adoptedTextDiscovery',{version:1,throughYear:2026});
  store.putSource(cycle.generation,endpoint,'document',projectDocument(old),stamp);
  assert.equal(adoptedTextRepairDue(store,cycle.generation),true);
  assert.equal(scheduleAdoptedTextRepairs(worker,cycle),1);
  // An in-flight retry owns this key and keeps its saved attempt and deadline.
  store.db.prepare('UPDATE tasks SET attempts=3,retry_at=? WHERE generation=? AND key=?').run(at+60_000,cycle.generation,endpoint);
  assert.equal(scheduleAdoptedTextRepairs(worker,cycle),0);
  assert.equal(store.db.prepare('SELECT attempts,retry_at FROM tasks WHERE generation=? AND key=?').get(cycle.generation,endpoint).attempts,3);
  worker.fetchRecord=async()=>({fetchedAt:stamp,payload:{data:[old]}});
  await worker.task({generation:cycle.generation,key:endpoint,kind:'document',body:{endpoint}});
  const saved=store.source(cycle.generation,endpoint).work;
  assert.equal(saved.adoptionProjectionVersion,1);assert.equal(Object.hasOwn(saved,'adopts'),false);
  assert.equal(adoptedTextRepairDue(store,cycle.generation),false);assert.equal(scheduleAdoptedTextRepairs(worker,cycle),0);
  assert.equal(projectDocument(saved).adoptionProjectionVersion,1);
  worker.finalize(cycle.generation);
  // A later legacy writer can complete compatible jobs but discard new fields.
  const rollback=store.beginCycle();store.putSource(rollback.generation,endpoint,'document',projectDocument(old),stamp);store.publish(rollback.generation);
  store.set('groupHistoryRepairVersion',1);worker.repairOnStartup=true;
  assert.equal(worker.coreDue(),true,'startup detects the lost projection despite a current discovery marker');
});

test('legacy repair uses bounded batches and publishes them in one new generation',async t=>{
  const {store,worker,cycle}=setup(t);
  store.set('adoptedTextDiscovery',{version:1,throughYear:2026});store.set('groupHistoryRepairVersion',1);store.setMembers([{id:'101',name:'Member'}]);
  for(let i=1;i<=101;i++) {
    const next='TA-10-2026-'+String(i).padStart(4,'0'),work=adopted({id:'eli/dl/doc/'+next,identifier:next});delete work.adopts;
    store.putSource(cycle.generation,'/adopted-texts/'+next,'document',work,stamp);
  }
  store.publish(cycle.generation);worker.repairOnStartup=true;
  worker.fetchRecord=async ep=>({fetchedAt:stamp,payload:{data:[adopted({id:'eli/dl/doc/'+ep.split('/').at(-1),identifier:ep.split('/').at(-1)})]}});
  const task=worker.task.bind(worker);worker.task=async next=>next.key.startsWith('/adopted-texts/')?task(next):store.finishTask(next);
  store.release();await worker.runIteration();
  assert.equal(store.get('active'),cycle.generation);const working=store.get('working').generation;
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM sources WHERE generation=? AND json_extract(body,'$.adoptionProjectionVersion')=1").get(working).n,100);
  await worker.runIteration();assert.equal(store.get('active'),working);assert.equal(store.get('working'),null);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM sources WHERE generation=? AND json_extract(body,'$.adoptionProjectionVersion')=1").get(working).n,101);
});

for(const owner of ['amendment','deferred'])test('catalogue discovery preserves '+owner+' document retry ownership',async t=>{
  const {store,worker,cycle}=setup(t),old=adopted();delete old.adopts;
  const body={endpoint,offset:750},saved={generation:cycle.generation,key:endpoint,kind:'document',body:JSON.stringify(body),priority:101,done:0,attempts:3,retry_at:at+3_600_000,error:'Saved source failure'};
  if(owner==='amendment')store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(saved.generation,saved.key,saved.kind,saved.body,saved.priority,saved.done,saved.attempts,saved.retry_at,saved.error);
  else store.putSource(cycle.generation,'amendment:continuations','amendment-continuations',{tasks:[saved],discovery:[],completed:[]},stamp);
  worker.fetchRecord=async()=>({fetchedAt:stamp,payload:{data:[{identifier:id}]}});
  for(const retained of [false,true]) {
    if(retained)store.putSource(cycle.generation,endpoint,'document',projectDocument(old),stamp);
    assert.equal(scheduleAdoptedTextRepairs(worker,cycle),0);
    const key='catalog:'+retained,task={generation:cycle.generation,key,kind:'catalog',body:{endpoint:'/adopted-texts',params:{year:2026},offset:0}};
    store.enqueue(cycle.generation,key,'catalog',task.body);await worker.task(task);
    assert.equal(store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=?').get(cycle.generation,endpoint),undefined);
  }
  const after=owner==='amendment'?store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(cycle.generation,endpoint):store.source(cycle.generation,'amendment:continuations').work.tasks[0];
  assert.equal(after.attempts,3);assert.equal(after.retry_at,saved.retry_at);assert.equal(JSON.parse(after.body).offset,750);
});

for(const owner of ['amendment','deferred'])test('feed, mutable and gap admission preserve '+owner+' retry ownership',async t=>{
  const {store,worker,cycle}=setup(t),body={endpoint,offset:750};
  const saved={generation:cycle.generation,key:endpoint,kind:'document',body:JSON.stringify(body),priority:101,done:0,attempts:3,retry_at:at+3_600_000,error:'Saved source failure'};
  if(owner==='amendment')store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(saved.generation,saved.key,saved.kind,saved.body,saved.priority,saved.done,saved.attempts,saved.retry_at,saved.error);
  else store.putSource(cycle.generation,'amendment:continuations','amendment-continuations',{tasks:[saved],discovery:[],completed:[]},stamp);
  worker.fetchRecord=async()=>({fetchedAt:stamp,xml:'<feed><entry><id>https://data.europarl.europa.eu/eli/dl/doc/'+id+'</id><updated>2026-10-27T12:00:00Z</updated></entry></feed>'});
  for(const retained of [false,true]) {
    if(retained)store.putSource(cycle.generation,endpoint,'document',adopted(), '2026-09-01T12:00:00Z');
    const key='feed:'+retained,task={generation:cycle.generation,key,kind:'feed',body:{endpoint:'/adopted-texts',start:'2024-07-16'}};
    store.enqueue(cycle.generation,key,'feed',task.body);await worker.task(task);
    scheduleMutable(worker,cycle.generation);
    assert.equal(store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=?').get(cycle.generation,endpoint),undefined);
  }
  store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(cycle.generation,endpoint,'document',JSON.stringify(body),101,'Saved source failure',3,stamp,at-1,null);
  worker.recoveryMode='backfill';assert.equal(gapRecoveryDue(store,cycle.generation),false);assert.equal(scheduleGapRecovery(worker,cycle.generation),0);
  const after=owner==='amendment'?store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(cycle.generation,endpoint):store.source(cycle.generation,'amendment:continuations').work.tasks[0];
  assert.equal(after.attempts,3);assert.equal(after.retry_at,saved.retry_at);assert.equal(JSON.parse(after.body).offset,750);
});
