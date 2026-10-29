import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {auditFollowupMetadata,compareGapAudits} from './data-gap-audit.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {CommissionFollowups} from './commission-followups.mjs';
import {projectFollowup} from './commission-followups-model.mjs';
import {adoptedTextProjectionVersion,scheduleAdoptedTextRepairs,scheduleAdoptedFollowups,followupAdmissionRepairDue,scheduleFollowupAdmissionRepairs,markFollowupAdmissionRepair} from './adopted-text-index.mjs';
import {recordTaskGap,scheduleMutable,nextBackfillTask,gapRecoveryDue,scheduleGapRecovery} from './refresh-policy.mjs';
import {cancelledRequest,runWithRequestSignal} from './request-budget.mjs';

const now=Date.parse('2026-10-29T04:10:00Z'),stamp=new Date(now).toISOString();
const ta='TA-10-2026-0271',rootKey='/adopted-texts/'+ta,sp='SP-2026-05-11-TA-10-2025-0247',spKey='/external-documents/'+sp;
const query={id:ta,language:'en'},ref=id=>'eli/dl/doc/'+id;
const sample=JSON.parse(readFileSync(new URL('./fixtures/commission-followup.json',import.meta.url),'utf8'));
const adopted=(relationships=[ref(sp)])=>({id:ref(ta),identifier:ta,work_type:'def/ep-document-types/TEXT_ADOPTED',parliamentary_term:'org/ep-10',adopts:[],inverse_answers_to:relationships});
const reply=(id=sp,extra={})=>({...structuredClone(sample.payload.data[0]),id:ref(id),identifier:id,answers_to:ref(ta),...extra});
const projected=(relationships=[ref(sp)])=>({...adopted(),inverse_answers_to:[],adoptionProjectionVersion:adoptedTextProjectionVersion,followupRelationships:relationships});
function setup(t){
  const dir=mkdtempSync(path.join(os.tmpdir(),'followup-index-')),clock={now};
  const store=new ActivityStore(dir,{clock:()=>clock.now});store.acquire();const cycle=store.beginCycle();
  const worker=new ActivityWorker(store,{clock:()=>clock.now});
  t.after(()=>{if(store.db.isOpen)store.close();rmSync(dir,{recursive:true,force:true});});
  return {store,worker,generation:cycle.generation,cycle,clock};
}
function reader(){let requests=0;const service=new CommissionFollowups({request:async()=>{requests++;throw Error('Upstream unavailable');}});return {service,requests:()=>requests};}
function save(store,generation,relationships=[ref(sp)]){
  store.putSource(generation,rootKey,'document',projected(relationships),stamp);
  store.putSource(generation,spKey,'document',projectFollowup(reply(),ta),stamp);
}

test('normal adoption ingestion retains URI references and durably owns the exact follow-up before completing the parent',async t=>{
  const {store,worker,generation}=setup(t),links=[ref(sp),{id:'https://data.europarl.europa.eu/'+ref(sp)}];
  store.enqueue(generation,rootKey,'document',{endpoint:rootKey});
  worker.fetchRecord=async endpoint=>({fetchedAt:stamp,payload:{data:[endpoint===rootKey?adopted(links):reply()]}});
  await worker.task(store.nextTask(generation));
  const root=store.source(generation,rootKey).work;assert.deepEqual(root.followupRelationships,links);assert.equal(root.adoptionProjectionVersion,2);
  assert.equal(store.db.prepare('SELECT done FROM tasks WHERE generation=? AND key=?').get(generation,rootKey).done,1);
  const task=store.nextTask(generation);assert.equal(task.key,spKey);assert.equal(task.body.adoptedId,ta);
  await worker.task(task);assert.equal(worker.requests,2);
  const result=await reader().service.query(query,{store});assert.equal(result.status,'available');assert.equal(result.items[0].files.length,4);
  assert.equal(result.items[0].files[2].expressionId,reply().is_realized_by[1].id);assert.equal(result.items[0].files[2].manifestationId,reply().is_realized_by[1].is_embodied_by[0].id);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items').get().n,0,'a Commission response creates no MEP activity');
});

test('large relationship admission advances a saved cursor and reopens with child ownership intact',async t=>{
  const {store,worker,generation}=setup(t),links=Array.from({length:205},(_,i)=>ref('SP-'+i));
  store.enqueue(generation,rootKey,'document',{endpoint:rootKey});
  worker.fetchRecord=async()=>({fetchedAt:stamp,payload:{data:[adopted(links)]}});
  await worker.task(store.nextTask(generation));
  const parent=(reader=store)=>{const row=reader.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,rootKey);return {...row,body:JSON.parse(row.body)};};
  assert.equal(parent().body.followupOffset,100);assert.equal(parent().done,0);
  const filename=store.filename;store.close();
  const reopened=new ActivityStore(path.dirname(filename),{clock:()=>now});reopened.acquire();t.after(()=>reopened.close());
  const resumed=new ActivityWorker(reopened,{clock:()=>now,fetchRecord:async()=>assert.fail('a saved cursor needs no repeated TA metadata request')});
  await resumed.task(parent(reopened));assert.equal(parent(reopened).body.followupOffset,200);await resumed.task(parent(reopened));assert.equal(parent(reopened).done,1);
  assert.equal(reopened.db.prepare("SELECT COUNT(*) n FROM tasks WHERE key GLOB '/external-documents/SP-*'").get().n,205);assert.equal(resumed.requests,0);
});

for(const owner of ['canonical','amendment','deferred','gap'])test('linked admission preserves existing '+owner+' retry ownership',t=>{
  const {store,worker,generation}=setup(t),body={endpoint:spKey,adoptedId:ta,offset:750};
  const saved={generation,key:spKey,kind:'document',body:JSON.stringify(body),priority:101,done:0,attempts:3,retry_at:now+3_600_000,error:'Saved failure'};
  if(owner==='canonical'||owner==='amendment')store.db.prepare(`INSERT INTO ${owner==='canonical'?'tasks':'amendment_jobs'} VALUES (?,?,?,?,?,?,?,?,?)`).run(...Object.values(saved));
  if(owner==='deferred')store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[saved],discovery:[],completed:[]},stamp);
  if(owner==='gap')store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,spKey,'document',saved.body,101,saved.error,3,stamp,saved.retry_at,null);
  const before=JSON.stringify(owner==='canonical'||owner==='amendment'?store.db.prepare(`SELECT * FROM ${owner==='canonical'?'tasks':'amendment_jobs'}`).all():owner==='deferred'?store.source(generation,'amendment:continuations'):store.db.prepare('SELECT * FROM refresh_gaps').all());
  scheduleAdoptedFollowups(worker,{generation,body:{}},projected());
  const after=JSON.stringify(owner==='canonical'||owner==='amendment'?store.db.prepare(`SELECT * FROM ${owner==='canonical'?'tasks':'amendment_jobs'}`).all():owner==='deferred'?store.source(generation,'amendment:continuations'):store.db.prepare('SELECT * FROM refresh_gaps').all());
  assert.equal(after,before);if(owner!=='canonical')assert.equal(store.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);
});

test('legacy roots get one normal repair and remain unknown to a fast read until a current observation exists',async t=>{
  const {store,worker,generation,cycle}=setup(t),legacy={...projected(),adoptionProjectionVersion:1};delete legacy.followupRelationships;
  store.putSource(generation,rootKey,'document',legacy,stamp);assert.equal(scheduleAdoptedTextRepairs(worker,cycle),1);
  const {service,requests}=reader(),before=store.db.prepare('SELECT total_changes() n').get().n;
  const unknown=await service.query(query,{store});assert.equal(requests(),0);assert.equal(unknown.status,'unavailable');assert.equal(unknown.relationshipObservation,'unobserved');assert.equal(unknown.declaredCount,null);assert(unknown.gaps.some(gap=>gap.reason==='lookup-failed'));
  assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(service.cache.size,0);
  worker.fetchRecord=async()=>({fetchedAt:stamp,payload:{data:[adopted([])]}});await worker.task(store.nextTask(generation));
  assert.equal(scheduleAdoptedTextRepairs(worker,cycle),0);const empty=await service.query(query,{store});assert.equal(empty.status,'none-listed');assert.equal(empty.declaredCount,0);assert.equal(empty.sources[0].stale,true);assert.equal(service.cache.size,0);
});

test('retained follow-ups use one generation, original projection provenance and no reader metadata requests',async t=>{
  const {store,generation}=setup(t);save(store,generation);store.publish(generation);const working=store.beginCycle();
  store.db.prepare('DELETE FROM sources WHERE generation=? AND key=?').run(working.generation,spKey);
  const {service,requests}=reader();const missing=await service.query(query,{store});assert.equal(missing.items.length,0);assert.equal(missing.status,'partial');assert.equal(requests(),0);
  store.putSource(working.generation,spKey,'document',projectFollowup(reply(),ta),stamp);
  const result=await service.query(query,{store});assert.equal(result.status,'available');assert.equal(result.items[0].id,sp);assert(result.sources.every(source=>source.generation===working.generation&&source.epoch===store.get('marksEpoch')&&source.fetchedAt===stamp&&source.stale&&source.representation==='retained-index-projection'));
  assert.equal(service.cache.size,0);assert.equal(requests(),0);
});

for(const change of [{answers_to:ref('TA-10-2026-0001')},{creator:['org/EU_PARLIAMENT']},{work_type:'https://example.org/ACT_FOLLOWUP'},{identifier:'SP-other'}])test('retained wrong reciprocal identity/type/creator is explicit and never fetched again by the reader '+JSON.stringify(change),async t=>{
  const {store,generation}=setup(t);save(store,generation);store.putSource(generation,spKey,'document',projectFollowup(reply(sp,change),ta),stamp);
  const {service,requests}=reader(),result=await service.query(query,{store});assert.equal(result.items.length,0);assert(result.gaps.some(gap=>gap.reason==='record-unverified'));assert.equal(requests(),0);assert.equal(service.cache.size,0);
});

test('one missing child settles to an owned gap without blocking the next successful follow-up',async t=>{
  const {store,worker,generation}=setup(t),second='SP-0000';
  store.enqueue(generation,rootKey,'document',{endpoint:rootKey});worker.fetchRecord=async endpoint=>{if(endpoint===spKey)throw Object.assign(Error('EP API returned 404'),{status:404});return {fetchedAt:stamp,payload:{data:[endpoint===rootKey?adopted([ref(second),ref(sp)]):reply(second)]}};};
  await worker.task(store.nextTask(generation));let task=store.nextTask(generation);assert.equal(task.key,spKey);
  await assert.rejects(worker.task(task));assert(recordTaskGap(worker,task,Object.assign(Error('EP API returned 404'),{status:404})));assert.equal(store.source(generation,spKey),undefined);
  await worker.task(store.nextTask(generation));const result=await reader().service.query(query,{store});assert.equal(result.items[0].id,second);assert.equal(result.status,'partial');assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps WHERE key=?').get(spKey).n,1);
});

test('normal mutable refresh of a retained follow-up preserves its exact adopted target',async t=>{
  const {store,worker,generation,clock}=setup(t);save(store,generation);store.release();clock.now+=8*86400_000;store.acquire();scheduleMutable(worker,generation);
  const task=store.db.prepare('SELECT * FROM tasks WHERE key=?').get(spKey);assert(task);assert.equal(JSON.parse(task.body).adoptedId,undefined);
  worker.fetchRecord=async()=>({fetchedAt:new Date(clock.now).toISOString(),payload:{data:[reply()]}});await worker.task({...task,body:JSON.parse(task.body)});
  assert.equal(store.source(generation,spKey).work.followupOf,ta);assert.equal(store.source(generation,spKey).fetchedAt,new Date(clock.now).toISOString());
});

test('a later oversized child preserves earlier replies and cancellation retains its typed local error',async t=>{
  const {store,generation}=setup(t);save(store,generation,[ref(sp),ref('SP-large')]);store.putSource(generation,'/external-documents/SP-large','document',{...projectFollowup(reply('SP-large'),ta),padding:'x'.repeat(20000)},stamp);
  const service=new CommissionFollowups({limits:{metadataBytes:12000},request:async()=>assert.fail('retained read must not fetch')});
  const result=await service.query(query,{store});assert.equal(result.items[0].id,sp);assert(result.gaps.some(gap=>gap.reason==='metadata-budget'));assert.equal(result.truncated,true);
  const caller=new AbortController();caller.abort(cancelledRequest());await runWithRequestSignal(caller.signal,()=>assert.rejects(service.query(query,{store}),{code:'request_cancelled'}));
});


test('exact follow-up audit separates retained metadata, future owners, orphans and an unknown legacy denominator without writing',t=>{
  const {store,generation}=setup(t),queued='SP-queued',orphan='SP-orphan';save(store,generation,[ref(sp),ref(queued),ref(orphan)]);
  store.enqueue(generation,'/external-documents/'+queued,'document',{endpoint:'/external-documents/'+queued,adoptedId:ta});
  store.db.prepare('UPDATE tasks SET retry_at=? WHERE key=?').run(now+3600000,'/external-documents/'+queued);
  const legacy='TA-10-2026-0001';store.putSource(generation,'/adopted-texts/'+legacy,'document',{...projected(),id:ref(legacy),identifier:legacy,adoptionProjectionVersion:1},stamp);
  const before=store.db.prepare('SELECT total_changes() n').get().n,baseline=auditFollowupMetadata(store.db,generation);
  assert.equal(baseline.eligibleRelations,3);assert.deepEqual(baseline.counts,{legacyRoots:1,unobservedRoots:0,malformedRoots:0,unrecognisedRelationships:0,observedRoots:1,retained:1,ownedMissing:1,unowned:1});
  assert.equal(baseline.missing.find(row=>row.id===queued).state,'ownedMissing');assert.equal(baseline.missing.find(row=>row.id===orphan).state,'unowned');
  assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
  store.putSource(generation,'/external-documents/'+queued,'document',projectFollowup(reply(queued),ta),stamp);
  const current=auditFollowupMetadata(store.db,generation);assert.equal(current.eligibleRelationDigest,baseline.eligibleRelationDigest);assert.equal(current.counts.retained,2);
  const report=followupMetadata=>({index:{activeGeneration:generation,generations:[{generation,followupMetadata}]}});
  const comparison=compareGapAudits(report(current),report(baseline));assert.equal(comparison.sameFollowupMetadataUniverse,true);assert.equal(comparison.followupMetadata.resolved.length,1);
});

test('independent database epochs and newer retained metadata cannot join a pending follow-up response',async t=>{
  const first=setup(t),second=setup(t);save(first.store,first.generation);save(second.store,second.generation);
  const {service}=reader(),original=service.collect.bind(service);let collects=0;
  service.collect=async(...args)=>{collects++;return original(...args);};
  const [a,b]=await Promise.all([service.query(query,{store:first.store}),service.query(query,{store:second.store})]);
  assert.equal(collects,2);assert.notEqual(a.sources[0].epoch,b.sources[0].epoch);
  first.store.putSource(first.generation,spKey,'document',projectFollowup(reply(sp,{document_date:'2026-05-12'}),ta),stamp);
  const c=await service.query(query,{store:first.store});assert.equal(c.items[0].documentDate,'2026-05-12');assert.equal(collects,3);
});

test('changed parent relationships restart the saved admission cursor without resetting existing children',t=>{
  const {store,worker,generation}=setup(t),old=Array.from({length:101},(_,i)=>ref('SP-old-'+i));
  const next=scheduleAdoptedFollowups(worker,{generation,body:{}},projected(old));assert.equal(next.followupOffset,100);
  const key='/external-documents/SP-old-0';store.db.prepare('UPDATE tasks SET attempts=3,retry_at=? WHERE key=?').run(now+3600000,key);
  const changed=scheduleAdoptedFollowups(worker,{generation,body:next},projected([ref('SP-new'),...old]));assert.equal(changed.followupOffset,100);assert.notEqual(changed.followupHash,next.followupHash);
  assert(store.db.prepare('SELECT 1 FROM tasks WHERE key=?').get('/external-documents/SP-new'));const saved=store.db.prepare('SELECT attempts,retry_at FROM tasks WHERE key=?').get(key);assert.equal(saved.attempts,3);assert.equal(saved.retry_at,now+3600000);
});


test('the reserved adoption dispatch services a due follow-up under a higher-priority backlog',t=>{
  const {store,generation}=setup(t);store.enqueue(generation,spKey,'document',{endpoint:spKey,adoptedId:ta},101);
  for(let i=0;i<20;i++)store.enqueue(generation,'high:'+i,'document',{endpoint:'/busy/'+i},200);
  const dispatched=[];for(let i=0;i<9;i++){const task=nextBackfillTask(store,generation,store.nextTask(generation));dispatched.push(task.key);store.finishTask(task);}
  assert.equal(dispatched[8],spKey);assert(dispatched.slice(0,8).every(key=>key.startsWith('high:')));
});

test('lost writer fencing rejects child admission without changing queued ownership',t=>{
  const {store,worker,generation}=setup(t);store.release();const before=store.db.prepare('SELECT total_changes() n').get().n;
  assert.throws(()=>scheduleAdoptedFollowups(worker,{generation,body:{}},projected()),/lease/);
  assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
});

for(const relationships of [null,'malformed'])test('retained unknown or malformed relationship shape never becomes none-listed '+relationships,async t=>{
  const {store,generation}=setup(t);save(store,generation,relationships);const {service,requests}=reader();
  const result=await service.query(query,{store});assert.equal(requests(),0);assert.equal(result.declaredCount,null);assert.equal(result.relationshipObservation,'unobserved');assert.notEqual(result.status,'none-listed');assert(result.gaps.length);
});


for(const owner of ['amendment','deferred'])test('mutable and gap admission preserve an existing '+owner+' SP retry',t=>{
  const {store,worker,generation}=setup(t),old=new Date(now-8*86400_000).toISOString();
  store.putSource(generation,spKey,'document',projectFollowup(reply(),ta),old);
  const saved={generation,key:spKey,kind:'document',body:JSON.stringify({endpoint:spKey,adoptedId:ta,offset:750}),priority:101,done:0,attempts:3,retry_at:now+3600000,error:'Saved source failure'};
  if(owner==='amendment')store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(...Object.values(saved));
  else store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[saved],discovery:[],completed:[]},stamp);
  scheduleMutable(worker,generation);assert.equal(store.db.prepare('SELECT 1 FROM tasks WHERE key=?').get(spKey),undefined);
  store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,spKey,'document',saved.body,101,saved.error,3,stamp,now-1,null);
  assert.equal(gapRecoveryDue(store,generation),false);assert.equal(scheduleGapRecovery(worker,generation),0);
  assert.equal(store.db.prepare('SELECT retry_at FROM refresh_gaps WHERE key=?').get(spKey).retry_at,now-1);
  const after=owner==='amendment'?store.db.prepare('SELECT * FROM amendment_jobs WHERE key=?').get(spKey):store.source(generation,'amendment:continuations').work.tasks[0];
  assert.equal(after.attempts,3);assert.equal(after.retry_at,saved.retry_at);assert.equal(JSON.parse(after.body).adoptedId,ta);
});

test('compressed checkpoint and reopen preserve an unsourced SP target, while exact retained roots re-admit checkpoint overflow',async t=>{
  const {store,worker,generation}=setup(t),links=Array.from({length:401},(_,i)=>ref('SP-'+i));
  store.putSource(generation,rootKey,'document',projected(links),stamp);
  for(let i=0;i<200;i++)store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(generation,'occupied:'+i,'document',JSON.stringify({endpoint:'/busy/'+i}),200,0,0,0,null);
  let body={};do{const next=scheduleAdoptedFollowups(worker,{generation,body},projected(links));body=next;}while(body);
  worker.checkpointContinuations(generation);
  const checkpoint=store.source(generation,'amendment:continuations').work;assert.equal(checkpoint.discovery.length,200);
  assert(checkpoint.discovery.every(task=>task.adoptedId===ta));
  const audit=auditFollowupMetadata(store.db,generation);assert.equal(audit.counts.unowned,1,'bounded checkpoint cannot erase its retained exact discovery source');
  const dropped=audit.missing.find(row=>row.state==='unowned');assert(followupAdmissionRepairDue(store,generation));assert.equal(scheduleFollowupAdmissionRepairs(worker,generation),1);
  assert.equal(JSON.parse(store.db.prepare('SELECT body FROM tasks WHERE key=?').get(dropped.key).body).adoptedId,ta);assert.equal(worker.requests,0);
  const descriptor=checkpoint.discovery[0];
  // Replay this actual compact descriptor after the other fixture jobs settle.
  store.db.exec('DELETE FROM amendment_jobs');store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[],discovery:[descriptor],completed:[]},stamp);
  const dir=path.dirname(store.filename);store.close();const reopened=new ActivityStore(dir,{clock:()=>now});reopened.acquire();t.after(()=>reopened.close());
  const resumed=new ActivityWorker(reopened,{clock:()=>now,fetchRecord:async endpoint=>({fetchedAt:stamp,payload:{data:[reply(endpoint.slice('/external-documents/'.length))]}})});
  resumed.checkpointContinuations(generation,{includeCore:false});const raw=reopened.db.prepare('SELECT * FROM amendment_jobs WHERE key=?').get(descriptor.key);assert.equal(JSON.parse(raw.body).adoptedId,ta);
  await resumed.task({...raw,body:JSON.parse(raw.body),amendmentJob:true});assert.equal(reopened.source(generation,descriptor.key).work.followupOf,ta);
});


test('bounded admission reconciliation resumes its persisted cursor, resets invalid state and keeps existing future owners',t=>{
  const {store,worker,generation}=setup(t),links=Array.from({length:205},(_,i)=>ref('SP-repair-'+i));store.putSource(generation,rootKey,'document',projected(links),stamp);
  store.set('followupAdmissionRepair',{version:1,generation,pending:true,afterKey:'bad',rootKey:null,offset:Infinity});
  assert.equal(scheduleFollowupAdmissionRepairs(worker,generation),100);assert.equal(store.get('followupAdmissionRepair').offset,100);
  const first='/external-documents/SP-repair-0';store.db.prepare('UPDATE tasks SET attempts=3,retry_at=? WHERE key=?').run(now+3600000,first);
  const resumed=new ActivityWorker(store,{clock:()=>now,fetchRecord:async()=>assert.fail('admission does not fetch')});
  assert.equal(scheduleFollowupAdmissionRepairs(resumed,generation),100);assert.equal(store.get('followupAdmissionRepair').offset,200);
  assert.equal(scheduleFollowupAdmissionRepairs(resumed,generation),5);assert.equal(followupAdmissionRepairDue(store,generation),false);
  const row=store.db.prepare('SELECT attempts,retry_at FROM tasks WHERE key=?').get(first);assert.equal(row.attempts,3);assert.equal(row.retry_at,now+3600000);
  markFollowupAdmissionRepair(store,generation);assert.equal(followupAdmissionRepairDue(store,generation),true);assert.equal(scheduleFollowupAdmissionRepairs(resumed,generation),0);assert.equal(store.get('followupAdmissionRepair').offset,100);
});

test('oversized retained roots are explicit repair-budget exceptions and do not block a later usable root',t=>{
  const {store,worker,generation}=setup(t),large='TA-10-2026-0001';
  store.putSource(generation,'/adopted-texts/'+large,'document',{...projected(),id:ref(large),identifier:large,padding:'x'.repeat(32*1024*1024)},stamp);
  store.putSource(generation,rootKey,'document',projected(),stamp);
  assert.equal(scheduleFollowupAdmissionRepairs(worker,generation),1);const state=store.get('followupAdmissionRepair');assert.equal(state.oversizedRoots,1);assert.deepEqual(state.oversizedExamples,['/adopted-texts/'+large]);assert.equal(state.pending,false);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM tasks WHERE key=?').get(spKey).n,1);assert.equal(worker.requests,0);
});
