import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {documentRefreshState,scheduleGapRecovery} from './refresh-policy.mjs';
import {projectDocument} from './activity-index-model.mjs';
import {distributionEvidenceFor} from './amendments.mjs';
import {documentDetailEndpoint,validateAmendmentListMetadata,retainedAmendmentListObservation,sanitizeFreshDocument} from './document-detail-routing.mjs';
import {nextAmendmentTask} from './amendments-store.mjs';
import {reconcileAmendmentDocumentGap,reconcileAmendmentDocumentGaps,amendmentDocumentRouteRepairPending} from './document-route-recovery.mjs';

const now=Date.parse('2026-10-29T08:00:00Z'),stamp=new Date(now).toISOString(),failedAt='2026-10-29T04:00:00.000Z',observedAt='2026-10-29T05:39:00.000Z',older='2026-10-26T00:00:00.000Z';
const target='A-10-2025-0128',id=target+'-AM-001-139',legacy='/plenary-documents/'+id,endpoint='/documents/'+id,origin='https://data.europarl.europa.eu';
const list=(extra={})=>({id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/AMENDMENT_LIST',parliamentary_term:'org/ep-10',foresees_change_of:['eli/dl/doc/'+target],document_date:null,is_realized_by:[{language:'en',is_embodied_by:[{format:'DOCX',is_exemplified_by:origin+'/distribution/doc/'+id+'_en.docx'}]}],...extra});
const retained=(extra={})=>{
  const work={...list(),amendmentDistributionDeclared:true,languageVersionsObserved:true,targetDocumentId:target,metadataCheckedAt:older,relationshipEvidence:{basis:'expanded-target',url:origin+'/api/v2/plenary-documents/'+target+'?format=application%2Fld%2Bjson',fetchedAt:observedAt,targetReference:'eli/dl/doc/'+target,listReference:'eli/dl/doc/'+id},...extra};
  work.distributionEvidence=distributionEvidenceFor(work,{url:work.relationshipEvidence.url,fetchedAt:work.relationshipEvidence.fetchedAt});return work;
};
function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'document-routes-')),store=new ActivityStore(directory,{clock:()=>now});store.acquire();const {generation}=store.beginCycle();
  const worker=new ActivityWorker(store,{clock:()=>now,recoveryMode:'backfill',fetchRecord:async()=>assert.fail('unexpected source request')});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});return {store,worker,generation};
}
function gap(store,generation,key=legacy,{failure=failedAt,retry=now+8*3600000}={}) {
  store.enqueue(generation,key,'document',{endpoint:key,feedDiscovery:true},85);store.finishTask(store.nextTask(generation));
  store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,key,'document',JSON.stringify({endpoint:key,feedDiscovery:true}),85,`EP API returned 404 at ${key}.`,4,failure,retry,null);
}

test('legacy and newly discovered amendment list details use the generic document route without MEP activity',async t=>{
  const {store,worker,generation}=setup(t);let calls=0;
  store.enqueue(generation,legacy,'document',{endpoint:legacy,feedDiscovery:true});
  worker.fetchRecord=async route=>{calls++;assert.equal(route,endpoint);return {fetchedAt:stamp,payload:{data:[list()]}};};
  await worker.task(store.nextTask(generation));
  assert.equal(calls,1);assert.equal(store.source(generation,legacy),undefined);assert.equal(store.source(generation,endpoint).work.identifier,id);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items').get().n,0);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM mutable_documents').get().n,0);
  assert.equal(documentRefreshState(store.source(generation,endpoint).work).mutable,false);
  assert.equal(documentDetailEndpoint('/plenary-documents/RC-10-2026-0482-AM-003-007'),'/documents/RC-10-2026-0482-AM-003-007');
  assert.equal(documentDetailEndpoint('/plenary-documents/'+target),'/plenary-documents/'+target);
});

for(const mode of ['catalog','feed'])test(mode+' routes newly discovered lists and never bypasses a future legacy retry owner',async t=>{
  const {store,worker,generation}=setup(t);
  const run=async key=>{
    store.enqueue(generation,key,mode,{endpoint:'/plenary-documents',offset:0,params:{},start:'2026-10-28'},100);
    worker.fetchRecord=async()=>({fetchedAt:stamp,payload:{data:[list()]},xml:'<feed><entry><id>https://data.europarl.europa.eu/eli/dl/doc/'+id+'</id><updated>2026-10-29T07:00:00Z</updated></entry></feed>'});
    await worker.task(store.nextTask(generation));
  };
  gap(store,generation);const before=JSON.stringify(store.db.prepare('SELECT * FROM refresh_gaps').all());
  await run('discovery:held');assert.equal(store.db.prepare('SELECT 1 FROM tasks WHERE key=?').get(endpoint),undefined);assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM refresh_gaps').all()),before);
  store.db.prepare('DELETE FROM refresh_gaps').run();
  if(mode==='catalog')store.finishTask(store.nextTask(generation));
  await run('discovery:ready');assert.equal(store.nextTask(generation).key,endpoint);
});

for(const change of [{identifier:'A-10-2025-9999-AM-001-139'},{work_type:'def/ep-document-types/REPORT_PLENARY'},{id:'https://example.org/'+id},{parliamentary_term:'org/ep-9'}])test('wrong generic metadata cannot clear an existing gap '+JSON.stringify(change),async t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);
  const record=store.db.prepare('SELECT * FROM tasks WHERE key=?').get(legacy);const job={...record,done:0,body:{endpoint:legacy}};
  worker.fetchRecord=async()=>({fetchedAt:stamp,payload:{data:[list(change)]}});
  await assert.rejects(worker.task(job),/Invalid|conflicting/);assert.equal(store.source(generation,endpoint),undefined);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps').get().n,1);
});

test('newer parent metadata resolves only the wrong-route gap with original provenance and no request',t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);store.putSource(generation,'amendment:list:'+id,'amendment-list',retained(),older);
  const sourceBefore=JSON.stringify(store.source(generation,'amendment:list:'+id));
  assert.equal(reconcileAmendmentDocumentGaps(worker,generation),1);assert.equal(worker.requests,0);
  const saved=store.source(generation,endpoint);assert.equal(saved.fetchedAt,observedAt);assert.equal(saved.work.metadataObservation.basis,'expanded-target');
  assert.equal(saved.work.metadataObservation.url,retained().relationshipEvidence.url);assert.equal(saved.work.metadataObservation.retainedSourceFetchedAt,older);assert.equal(saved.work.metadataObservation.directMetadataCheckedAt,older);
  assert.deepEqual(projectDocument(saved.work).metadataObservation,saved.work.metadataObservation);
  assert.equal(JSON.stringify(store.source(generation,'amendment:list:'+id)),sourceBefore);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps').get().n,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items').get().n,0);
});

for(const mode of ['older','unknown','future-dated','conflicting','wrong-url','unavailable-files','stale-distribution','future-owner','generic-owner','amendment-owner','deferred-owner','admission-marker','generic-gap','active-only'])test('retained reconciliation preserves '+mode+' observations and retry ownership',t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);let work=retained();
  if(mode==='older')work.relationshipEvidence.fetchedAt=older;
  if(mode==='unknown')delete work.relationshipEvidence.fetchedAt;
  if(mode==='future-dated')work.relationshipEvidence.fetchedAt=new Date(now+1).toISOString();
  if(mode==='conflicting')work.foresees_change_of=['eli/dl/doc/B-10-2026-0001'];
  if(mode==='wrong-url')work.relationshipEvidence.url=origin+'/api/v2/documents/'+id+'?format=application%2Fld%2Bjson';
  if(mode==='unavailable-files')work.distributionEvidence.state='unavailable';
  if(mode==='stale-distribution')work.distributionEvidence.source.fetchedAt=older;
  store.putSource(generation,'amendment:list:'+id,'amendment-list',work,older);
  if(mode==='future-owner')store.db.prepare('UPDATE tasks SET done=0,retry_at=?,attempts=3,body=? WHERE key=?').run(now+3600000,JSON.stringify({endpoint:legacy,offset:150}),legacy);
  if(mode==='generic-owner'){store.enqueue(generation,endpoint,'document',{endpoint,offset:150});store.db.prepare('UPDATE tasks SET retry_at=? WHERE key=?').run(now+3600000,endpoint);}
  if(mode==='amendment-owner')store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(generation,'amendment:discover:'+target+':'+id,'amendment-list-detail',JSON.stringify({listId:id,targetDocumentId:target}),115,0,3,now+3600000,'retry');
  if(mode==='deferred-owner')store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[{key:legacy,kind:'document',body:JSON.stringify({endpoint:legacy,offset:150}),retry_at:now+3600000}],discovery:[],completed:[]},older);
  if(mode==='admission-marker')store.db.prepare('INSERT INTO refresh_gap_admissions VALUES (?,?)').run(generation,legacy);
  if(mode==='generic-gap')store.db.prepare('INSERT INTO refresh_gaps VALUES (?,?,?,?,?,?,?,?,?,?)').run(generation,endpoint,'document',JSON.stringify({endpoint}),85,'EP API returned 500',4,failedAt,now+3600000,null);
  if(mode==='active-only')store.publish(generation);
  const before=JSON.stringify({gaps:store.db.prepare('SELECT * FROM refresh_gaps').all(),tasks:store.db.prepare('SELECT * FROM tasks').all()});
  assert.equal(reconcileAmendmentDocumentGap(worker,generation,id),false);
  assert.equal(JSON.stringify({gaps:store.db.prepare('SELECT * FROM refresh_gaps').all(),tasks:store.db.prepare('SELECT * FROM tasks').all()}),before);assert.equal(store.source(generation,endpoint),undefined);
});

test('a partial retained-copy commit is resumable without inventing another observation',t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);store.putSource(generation,'amendment:list:'+id,'amendment-list',retained(),older);
  const finish=store.finishTask.bind(store);store.finishTask=()=>{throw Error('Injected finish failure');};
  assert.throws(()=>reconcileAmendmentDocumentGap(worker,generation,id),/Injected/);assert.equal(store.source(generation,endpoint).fetchedAt,observedAt);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps').get().n,1);
  store.finishTask=finish;assert(reconcileAmendmentDocumentGap(worker,generation,id));assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps').get().n,0);assert.equal(store.source(generation,endpoint).fetchedAt,observedAt);
});

test('retained direct detail keeps its actual detail-check date and source URL',t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);
  const work=retained({metadataCheckedAt:observedAt});work.relationshipEvidence={...work.relationshipEvidence,basis:'list-detail',url:origin+'/api/v2/documents/'+id+'?format=application%2Fld%2Bjson'};
  work.distributionEvidence=distributionEvidenceFor(work,{url:work.relationshipEvidence.url,fetchedAt:observedAt});
  store.putSource(generation,'amendment:list:'+id,'amendment-list',work,older);
  assert(reconcileAmendmentDocumentGap(worker,generation,id));assert.equal(store.source(generation,endpoint).work.metadataObservation.directMetadataCheckedAt,observedAt);
});

test('scan bounds cumulative retained bytes before parsing large source records',t=>{
  const {store,worker,generation}=setup(t),keys=[];
  for(let n=1;n<=3;n++) {
    const next=target+'-AM-'+String(n).padStart(3,'0')+'-'+String(n).padStart(3,'0');keys.push('amendment:list:'+next);gap(store,generation,'/plenary-documents/'+next);
    const work=retained({id:'eli/dl/doc/'+next,identifier:next,padding:'x'.repeat(3*1024*1024)});work.relationshipEvidence.listReference='eli/dl/doc/'+next;
    store.putSource(generation,'amendment:list:'+next,'amendment-list',work,older);
  }
  const read=store.source.bind(store),reads=[];store.source=(gen,key)=>{if(key.startsWith('amendment:list:'))reads.push(key);return read(gen,key);};
  assert.equal(reconcileAmendmentDocumentGaps(worker,generation),2);assert.deepEqual(reads,keys.slice(0,2));assert.equal(store.get('amendmentDocumentRouteRepair').complete,false);
  assert.equal(reconcileAmendmentDocumentGaps(worker,generation),1);assert.deepEqual(reads,keys);assert.equal(store.get('amendmentDocumentRouteRepair').complete,true);
});

test('retained observations require exact target and source identity; duplicate records are rejected',()=>{
  assert.throws(()=>validateAmendmentListMetadata({data:[list(),list()]},id),/conflicting/);
  const source={work:retained(),fetchedAt:older};assert(retainedAmendmentListObservation(source,id,failedAt));
  assert.equal(retainedAmendmentListObservation(source,id,observedAt),null);
});

test('route scan bounds candidate keys and source bytes, keeps its cursor, and fences writes',t=>{
  const {store,worker,generation}=setup(t);
  for(let n=1;n<=26;n++)gap(store,generation,'/plenary-documents/'+target+'-AM-'+String(n).padStart(3,'0')+'-'+String(n).padStart(3,'0'));
  assert(amendmentDocumentRouteRepairPending(store,generation));assert.equal(reconcileAmendmentDocumentGaps(worker,generation),0);
  assert.equal(store.get('amendmentDocumentRouteRepair').afterKey,'/plenary-documents/'+target+'-AM-025-025');
  assert.equal(store.get('amendmentDocumentRouteRepair').complete,false);assert.equal(reconcileAmendmentDocumentGaps(worker,generation),0);assert.equal(store.get('amendmentDocumentRouteRepair').complete,true);
  store.release();assert.throws(()=>reconcileAmendmentDocumentGap(worker,generation,id),/lease/i);
});

for(const owner of ['canonical-gap','canonical-task','amendment-job','deferred-task','admission'])test('legacy execution and admission respect a '+owner+' owner on the correct route',async t=>{
  const {store,worker,generation}=setup(t),future=now+24*3600000;
  gap(store,generation,legacy,{retry:now-1});
  if(owner==='canonical-gap')gap(store,generation,endpoint,{retry:future});
  if(owner==='canonical-task') {
    store.enqueue(generation,endpoint,'document',{endpoint,offset:150});
    store.db.prepare('UPDATE tasks SET retry_at=?,attempts=3,error=? WHERE key=?').run(future,'retained failure',endpoint);
  }
  if(owner==='amendment-job')store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(generation,'amendment:discover:'+target+':'+id,'amendment-list-detail',JSON.stringify({listId:id,targetDocumentId:target}),115,0,3,future,'retained failure');
  if(owner==='deferred-task')store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[{key:endpoint,kind:'document',body:JSON.stringify({endpoint,offset:150}),retry_at:future}],discovery:[],completed:[]},older);
  if(owner==='admission')store.db.prepare('INSERT INTO refresh_gap_admissions VALUES (?,?)').run(generation,endpoint);
  const snapshot=()=>JSON.stringify({gaps:store.db.prepare('SELECT * FROM refresh_gaps ORDER BY key').all(),admissions:store.db.prepare('SELECT * FROM refresh_gap_admissions ORDER BY key').all(),foreignTasks:store.db.prepare('SELECT * FROM tasks WHERE key<>? ORDER BY key').all(legacy),jobs:store.db.prepare('SELECT * FROM amendment_jobs ORDER BY key').all(),checkpoint:store.source(generation,'amendment:continuations')});
  const before=snapshot();assert.equal(scheduleGapRecovery(worker,generation),0);assert.equal(snapshot(),before);
  // Simulate an already-admitted old-route job; its body and attempts survive.
  store.db.prepare('UPDATE tasks SET done=0,retry_at=0,attempts=4,error=? WHERE key=?').run('old failure',legacy);
  const task={...store.db.prepare('SELECT * FROM tasks WHERE key=?').get(legacy),body:{endpoint:legacy,feedDiscovery:true}};
  await worker.task(task);
  assert.equal(worker.requests,0);assert.equal(snapshot(),before);
  const after=store.db.prepare('SELECT * FROM tasks WHERE key=?').get(legacy);
  assert.equal(after.done,0);assert.equal(after.attempts,4);assert.equal(after.body,JSON.stringify(task.body));assert.equal(after.error,'old failure');
  assert.equal(after.retry_at,owner==='admission'?now+30_000:future);
});

test('two mature alias gaps admit the canonical route and execute without a mutual ownership block',async t=>{
  const {store,worker,generation}=setup(t);gap(store,generation,legacy,{retry:now-2});gap(store,generation,endpoint,{retry:now-1});
  assert.equal(scheduleGapRecovery(worker,generation),1);
  const task=store.nextTask(generation);assert.equal(task.key,endpoint);
  worker.fetchRecord=async route=>{assert.equal(route,endpoint);return {fetchedAt:stamp,payload:{data:[list()]}};};
  await worker.task(task);assert.equal(worker.requests,1);assert.equal(store.source(generation,endpoint).work.identifier,id);
  assert.equal(store.db.prepare('SELECT key FROM refresh_gaps').get().key,legacy);
});

test('a checkpointed legacy retry excludes its own admission and amendment job only',async t=>{
  const {store,worker,generation}=setup(t);gap(store,generation,legacy,{retry:now-1});
  assert.equal(scheduleGapRecovery(worker,generation),1);worker.checkpointContinuations(generation);
  const task=nextAmendmentTask(store,generation);assert.equal(task.key,legacy);assert.equal(task.amendmentJob,true);
  worker.fetchRecord=async route=>{assert.equal(route,endpoint);return {fetchedAt:stamp,payload:{data:[list()]}};};
  await worker.task(task);assert.equal(worker.requests,1);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gaps').get().n,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM refresh_gap_admissions').get().n,0);
});

test('an already queued canonical task can complete while a duplicate legacy task waits for it',async t=>{
  const {store,worker,generation}=setup(t);
  store.enqueue(generation,legacy,'document',{endpoint:legacy},85);store.enqueue(generation,endpoint,'document',{endpoint},50);
  const legacyTask=store.nextTask(generation);assert.equal(legacyTask.key,legacy);
  await worker.task(legacyTask);assert.equal(worker.requests,0);
  worker.fetchRecord=async route=>{assert.equal(route,endpoint);return {fetchedAt:stamp,payload:{data:[list()]}};};
  const canonicalTask=store.nextTask(generation);assert.equal(canonicalTask.key,endpoint);
  await worker.task(canonicalTask);assert.equal(worker.requests,1);assert.equal(store.source(generation,endpoint).work.identifier,id);
});

test('canonical bodies count toward the cumulative scan budget before either body is loaded',t=>{
  const {store,worker,generation}=setup(t),keys=[];
  for(let n=1;n<=2;n++) {
    const next=target+'-AM-'+String(n).padStart(3,'0')+'-'+String(n).padStart(3,'0');gap(store,generation,'/plenary-documents/'+next);
    const work=retained({id:'eli/dl/doc/'+next,identifier:next});work.relationshipEvidence.listReference='eli/dl/doc/'+next;
    store.putSource(generation,'amendment:list:'+next,'amendment-list',work,older);
    store.putSource(generation,'/documents/'+next,'document',{...list(),identifier:next,padding:'x'.repeat(5*1024*1024)},older);
    keys.push('amendment:list:'+next,'/documents/'+next);
  }
  // A checkpoint body is not copied into JS just to read its owner keys.
  store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[],discovery:[],padding:'x'.repeat(5*1024*1024)},older);
  const read=store.source.bind(store),reads=[];let bytes=0;
  store.source=(gen,key)=>{
    assert.notEqual(key,'amendment:continuations');
    reads.push(key);bytes+=store.db.prepare('SELECT length(CAST(body AS BLOB)) bytes FROM sources WHERE generation=? AND key=?').get(gen,key)?.bytes||0;
    return read(gen,key);
  };
  assert.equal(reconcileAmendmentDocumentGaps(worker,generation),1);assert.deepEqual(reads,keys.slice(0,2));assert(bytes<=8*1024*1024);assert.equal(store.get('amendmentDocumentRouteRepair').complete,false);
  bytes=0;assert.equal(reconcileAmendmentDocumentGaps(worker,generation),1);assert.deepEqual(reads,keys);assert(bytes<=8*1024*1024);
});

test('an oversized canonical body is skipped without blocking later keys or reading it',t=>{
  const {store,worker,generation}=setup(t);gap(store,generation);store.putSource(generation,'amendment:list:'+id,'amendment-list',retained(),older);
  store.putSource(generation,endpoint,'document',{padding:'x'.repeat(8*1024*1024)},older);
  store.source=()=>assert.fail('oversized candidate body read');
  assert.equal(reconcileAmendmentDocumentGaps(worker,generation),0);assert.equal(store.get('amendmentDocumentRouteRepair').oversized,1);assert.equal(store.get('amendmentDocumentRouteRepair').complete,true);
});

test('a restarted worker resumes the incomplete same-generation cursor and reaches candidate 26',t=>{
  const {store,worker,generation}=setup(t);let next;
  for(let n=1;n<=26;n++){next=target+'-AM-'+String(n).padStart(3,'0')+'-'+String(n).padStart(3,'0');gap(store,generation,'/plenary-documents/'+next);}
  const work=retained({id:'eli/dl/doc/'+next,identifier:next});work.relationshipEvidence.listReference='eli/dl/doc/'+next;
  store.putSource(generation,'amendment:list:'+next,'amendment-list',work,older);
  assert.equal(reconcileAmendmentDocumentGaps(worker,generation,{restart:true}),0);
  const read=store.source.bind(store),reads=[];store.source=(gen,key)=>{reads.push(key);return read(gen,key);};
  const restarted=new ActivityWorker(store,{clock:()=>now,recoveryMode:'backfill',fetchRecord:async()=>assert.fail('unexpected source request')});
  assert.equal(reconcileAmendmentDocumentGaps(restarted,generation,{restart:restarted.amendmentRouteStartupRepair}),1);
  assert.deepEqual(reads,['amendment:list:'+next,'/documents/'+next]);assert.equal(store.get('amendmentDocumentRouteRepair').complete,true);
});

for(const mode of ['busy','future','publish'])test('one worker iteration reaches later retained repairs '+mode,async t=>{
  const busy=mode==='busy',blocked=mode!=='publish';
  const {store,worker,generation:serving}=setup(t);
  worker.recoveryMode='normal';
  store.setMembers([{id:'101',name:'Member'}]);store.publish(serving);
  const {generation}=store.beginCycle(),keys=[];
  for(let n=1;n<=82;n++) {
    const next=target+'-AM-'+String(n).padStart(3,'0')+'-'+String(n).padStart(3,'0');
    keys.push('/plenary-documents/'+next);gap(store,generation,keys.at(-1));
    if(n<80)continue;
    const work=retained({id:'eli/dl/doc/'+next,identifier:next});work.relationshipEvidence.listReference='eli/dl/doc/'+next;
    store.putSource(generation,'amendment:list:'+next,'amendment-list',work,older);
  }
  // A newer observation still cannot take over another route's future retry.
  const held='/documents/'+keys[80].split('/').at(-1);
  if(blocked)store.enqueue(generation,held,'document',{endpoint:held,offset:150},130);
  store.db.prepare('UPDATE tasks SET retry_at=?,attempts=3,error=? WHERE generation=? AND key=?').run(now+3600000,'saved retry',generation,held);
  const owner=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,held);
  const gaps=store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=? ORDER BY key').all(generation);
  if(busy)for(let n=0;n<10;n++)store.enqueue(generation,'busy:'+n,'document',{endpoint:'/busy/'+n},120);
  const dispatches=[];
  worker.budget=3;
  worker.task=async task=>{
    if(task.key.startsWith('busy:')){worker.requests++;dispatches.push(store.get('amendmentDocumentRouteRepair'));}
    store.finishTask(task);
  };
  store.release();await worker.runIteration();
  assert.equal(store.get('amendmentDocumentRouteRepair').complete,true);
  assert.equal(store.get('amendmentDocumentRouteRepair').resolved,blocked?2:3);
  for(const index of [79,81]) {
    const saved=store.source(generation,'/documents/'+keys[index].split('/').at(-1));
    assert.equal(saved.fetchedAt,observedAt);assert.equal(saved.work.metadataObservation.basis,'expanded-target');
    assert.equal(store.source(serving,'/documents/'+keys[index].split('/').at(-1)),undefined,'serving sources remain frozen');
  }
  assert.equal(store.get('active'),blocked?serving:generation);
  if(blocked)assert.equal(store.source(generation,held),undefined);
  assert.deepEqual(store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,held),owner);
  assert.deepEqual(store.db.prepare('SELECT * FROM refresh_gaps WHERE generation=? ORDER BY key').all(generation),gaps.filter(row=>!(blocked?[keys[79],keys[81]]:keys.slice(79)).includes(row.key)));
  assert.equal(worker.requests,busy?3:0,'local recovery consumes no request budget');
  if(busy)assert.equal(dispatches[2].complete,true,'later repair finishes before the third ordinary dispatch');
});

test('an incomplete route scan stays due while every queued source owner waits in the future',async t=>{
  const {store,worker,generation}=setup(t);
  worker.recoveryMode='normal';
  for(let n=1;n<=82;n++)gap(store,generation,'/plenary-documents/'+target+'-AM-'+String(n).padStart(3,'0')+'-'+String(n).padStart(3,'0'));
  store.enqueue(generation,'busy','document',{endpoint:'/busy'},120);worker.budget=1;
  worker.task=async task=>{if(task.key==='busy')worker.requests++;store.finishTask(task);};
  store.release();await worker.runIteration();
  const state=store.get('amendmentDocumentRouteRepair');assert.equal(state.complete,false);
  assert(store.acquire());
  for(const table of ['tasks','amendment_jobs','group_voice_jobs'])store.db.prepare(`UPDATE ${table} SET retry_at=? WHERE generation=? AND done<>1`).run(now+3600000,generation);
  store.set('amendmentDocumentRouteRepair',{...state,complete:true});
  assert.equal(worker.due(),false,'control excludes other work triggers');
  store.set('amendmentDocumentRouteRepair',state);
  assert.equal(worker.due(),true,'local scan does not wait for a source retry');
});

test('fresh nested metadata and dedicated list details cannot supply internal retained provenance',async t=>{
  const {store,worker,generation}=setup(t),forged={url:'https://example.org/foreign',fetchedAt:'2099-01-01T00:00:00Z'};
  const raw={id:'eli/dl/doc/'+target,identifier:target,work_type:'def/ep-document-types/REPORT_PLENARY',parliamentary_term:'org/ep-10',document_date:'2025-07-01',metadataObservation:forged,inverse_foresees_change_of:[list({metadataObservation:forged})]};
  const original=JSON.stringify(raw),clean=sanitizeFreshDocument(raw);
  assert.equal(JSON.stringify(raw),original);assert.equal(clean.metadataObservation,undefined);assert.equal(clean.inverse_foresees_change_of[0].metadataObservation,undefined);
  store.enqueue(generation,'/plenary-documents/'+target,'document',{endpoint:'/plenary-documents/'+target});
  worker.fetchRecord=async()=>({fetchedAt:stamp,payload:{data:[raw]}});
  await worker.task(store.nextTask(generation));
  assert.equal(store.source(generation,'/plenary-documents/'+target).work.metadataObservation,undefined);
  assert.equal(store.source(generation,'/plenary-documents/'+target).work.inverse_foresees_change_of[0].metadataObservation,undefined);
  assert.equal(store.source(generation,'amendment:list:'+id).work.metadataObservation,undefined);
  // A URI-only declaration exercises the separate list-detail ingestion path.
  store.putSource(generation,'/plenary-documents/'+target,'document',projectDocument({...raw,inverse_foresees_change_of:['eli/dl/doc/'+id]}),older);
  store.db.prepare('INSERT OR REPLACE INTO amendment_jobs VALUES (?,?,?,?,?,?,?,?,?)').run(generation,'amendment:discover:'+target+':'+id,'amendment-list-detail',JSON.stringify({listId:id,targetDocumentId:target}),115,0,0,0,null);
  worker.fetchRecord=async route=>{assert.equal(route,endpoint);return {fetchedAt:stamp,payload:{data:[list({metadataObservation:forged})]}};};
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(store.source(generation,'amendment:list:'+id).work.metadataObservation,undefined);
  assert.deepEqual(projectDocument({...list(),metadataObservation:forged}).metadataObservation,forged);
});
