import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {documentRefreshState} from './refresh-policy.mjs';
import {projectDocument} from './activity-index-model.mjs';
import {distributionEvidenceFor} from './amendments.mjs';
import {documentDetailEndpoint,validateAmendmentListMetadata,retainedAmendmentListObservation} from './document-detail-routing.mjs';
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
