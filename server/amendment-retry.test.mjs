import {unthrottledUpstream} from './test-support/upstream.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {AMENDMENT_LINKS_VERSION,projectDocument,documentRows} from './activity-index-model.mjs';
import {AMENDMENTS_VERSION,AMENDMENT_SITTING_PROJECTION_VERSION,AMENDMENT_DISTRIBUTION_PROOF_VERSION} from './amendments.mjs';
import {AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {SPLIT_PARSER_VERSION} from './amendment-splits.mjs';
import {amendmentsPage,enqueueAmendment,saveAmendmentRows} from './amendments-store.mjs';
import {scheduleAmendments,prepareAmendments,scheduleSittingOutcomes} from './amendments-worker.mjs';

const target='A-10-2026-0254',date='2026-10-16',stamp=date+'T16:00:00.000Z';
const report={id:'eli/dl/doc/'+target,identifier:target,work_type:'def/ep-document-types/REPORT_PLENARY',parliamentary_term:['org/ep-10'],document_date:date,title_dcterms:{en:'Accepted report'},workHadParticipation:[{participation_role:'def/ep-roles/RAPPORTEUR',had_participant_person:['person/1']}],inverse_foresees_change_of:[]};
const sourceKey='compat:split-source';

function setup(t,options={}) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-retry-'));
  let now=Date.parse(stamp);
  const clock=()=>now,store=new ActivityStore(directory,{clock});
  assert(store.acquire());
  const {generation}=store.beginCycle();
  store.setMembers([{id:'1',name:'Example member'}]);
  for(const work of [report,{...report,id:'eli/dl/doc/B-10-2026-0424',identifier:'B-10-2026-0424'}]) {
    const projected=projectDocument(work),key='/plenary-documents/'+work.identifier;
    store.putSource(generation,key,'document',projected,stamp,documentRows(projected,key,stamp).rows);
  }
  // This fixture exercises settled metadata; group-voice and membership upgrades have separate tests.
  store.db.prepare('INSERT INTO group_voice_state VALUES (?,1)').run(generation);
  store.putSource(generation,'outside:state','outside-state',{version:1,terms:[9,10]},stamp);
  store.updateCycle({initialized:true,membershipScheduled:true,motionOutcomesDay:date,reportJoinsReady:true,procedureTitlesQueued:true,amendmentsPreparedVersion:AMENDMENTS_VERSION,amendmentsPreparedDay:date,splitParserVersion:SPLIT_PARSER_VERSION,amendmentDocumentParserVersion:AMENDMENT_EXTRACTION_VERSION,amendmentDocumentLinksVersion:AMENDMENT_LINKS_VERSION,amendmentSittingProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION,amendmentDistributionProofVersion:AMENDMENT_DISTRIBUTION_PROOF_VERSION});
  store.release();
  const worker=new ActivityWorker(store,{runUpstream:unthrottledUpstream,clock,monotonic:clock,fetchRecord:async()=>{throw new Error('Unexpected source request.');},...options});
  const write=fn=>{assert(store.acquire());try{return fn();}finally{store.release();}};
  const writeAsync=async fn=>{assert(store.acquire());try{return await fn();}finally{store.release();}};
  t.after(()=>{worker.stop();store.close();rmSync(directory,{recursive:true,force:true});});
  return {directory,store,worker,generation,clock,advance:milliseconds=>{now+=milliseconds;},write,writeAsync,publish:()=>write(()=>store.publish(generation))};
}
const pending=store=>amendmentsPage(store,{document:target}).coverage.pending;
const job=(store,key,generation)=>store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key);

test('a delayed amendment retry remains pending after actual core publication and resumes without a new core cycle',async t=>{
  const {store,worker,generation,write,advance,clock}=setup(t);
  write(()=>{
    store.enqueue(generation,'core:catalog','catalog',{endpoint:'/plenary-documents',params:{year:2026},offset:750},50);
    enqueueAmendment(store,generation,'delayed:roster','amendment-roster',{date,offset:1000,members:[{id:'1',givenName:'Example',familyName:'Member'}],sources:[]},100);
    store.db.prepare('UPDATE amendment_jobs SET retry_at=? WHERE generation=?').run(clock()+30_000,generation);
  });
  const calls=[];
  worker.fetchRecord=async(endpoint,params)=>{calls.push([endpoint,params.offset]);return {payload:{data:[]},fetchedAt:new Date(clock()).toISOString()};};
  await worker.run();
  assert.deepEqual(calls,[['/plenary-documents',750]]);
  assert.equal(store.get('active'),generation);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),generation);
  const accepted=store.page('1').items,lastSuccess=store.get('lastSuccess');
  assert.equal(pending(store),true);assert.equal(worker.due(),false);
  advance(29_999);await worker.run();assert.equal(calls.length,1);
  advance(1);assert.equal(worker.due(),true);await worker.run();
  assert.deepEqual(calls,[['/plenary-documents',750],['/meps/show-current',1000]]);
  assert.equal(job(store,'delayed:roster',generation).done,1);assert.equal(pending(store),false);
  assert.equal(store.get('working'),null);assert.equal(store.get('active'),generation);assert.equal(store.get('sequence'),generation);assert.equal(store.get('lastSuccess'),lastSuccess);
  assert.deepEqual(store.page('1').items,accepted);assert.equal(store.status().lastRefreshRequests,1);
});

test('an active-only amendment failure keeps its delayed retry without fabricating working metadata',async t=>{
  const {store,worker,generation,write,advance,clock,publish}=setup(t);
  write(()=>enqueueAmendment(store,generation,'missing:source','amendment-reparse',{sourceKey},100));publish();
  const lastSuccess=store.get('lastSuccess');
  await worker.run();
  const failed=job(store,'missing:source',generation);
  assert.equal(failed.attempts,1);assert.equal(failed.retry_at,clock()+30_000);assert.match(failed.error,/unavailable/);
  assert.equal(store.get('working'),null);assert.equal(store.get('lastSuccess'),lastSuccess);assert.equal(pending(store),true);assert.equal(worker.due(),false);
  write(()=>store.putSource(generation,sourceKey,'motion-outcomes',{splitRequests:[],sources:[],decisions:[]},stamp));
  advance(30_000);await worker.run();
  assert.equal(job(store,'missing:source',generation).done,1);assert.equal(pending(store),false);
  assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),generation);assert.equal(store.get('lastSuccess'),lastSuccess);
});

test('post-publication pagination respects the existing request and duration bounds while retaining its cursor',async t=>{
  for(const limit of ['requests','duration']) {
    const {store,worker,generation,write,advance,publish}=setup(t,{budget:limit==='requests'?1:10,maxDuration:limit==='duration'?10:90*60_000});
    write(()=>enqueueAmendment(store,generation,'bounded:roster','amendment-roster',{date,offset:700,members:[],sources:[]},100));publish();
    let calls=0;
    worker.fetchRecord=async(endpoint,params)=>{
      assert.equal(endpoint,'/meps/show-current');calls++;
      if(limit==='duration')advance(11);
      return {payload:{data:params.offset===700?[{identifier:'1',givenName:'Example',familyName:'Member'}]:[]},fetchedAt:stamp};
    };
    await worker.run();
    assert.equal(calls,1);assert.equal(JSON.parse(job(store,'bounded:roster',generation).body).offset,701);
    assert.equal(job(store,'bounded:roster',generation).done,0);assert.equal(pending(store),true);assert.equal(store.get('working'),null);
    await worker.run();assert.equal(calls,2);
    if(limit==='duration') {
      // The final page also spends the run's duration, so the roster rebuild
      // yields at its slice boundary and resumes without another request.
      assert.equal(job(store,'bounded:roster',generation).done,0);assert.equal(pending(store),true);assert.equal(store.get('working'),null);
      await worker.run();assert.equal(calls,2);
    }
    assert.equal(job(store,'bounded:roster',generation).done,1);assert.equal(pending(store),false);assert.equal(store.get('sequence'),generation);
  }
});

test('an active-only disk limit and late abort preserve pending jobs without creating a core cycle',async t=>{
  for(const mode of ['disk','abort']) {
    const {store,worker,generation,write,publish}=setup(t,{diskLimit:mode==='disk'?1:1024*1024*1024});
    write(()=>enqueueAmendment(store,generation,'limit:source','amendment-reparse',{sourceKey},100));publish();
    const before=job(store,'limit:source',generation);
    if(mode==='abort')worker.task=async()=>{worker.stop();throw new DOMException('Stopped','AbortError');};
    await worker.run();
    assert.deepEqual(job(store,'limit:source',generation),before);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),generation);assert.equal(pending(store),true);
  }
});

test('a retained extension retry adopts the current legacy core generation before reading its source',async t=>{
  const {store,worker,generation,write,advance,clock,publish}=setup(t);
  write(()=>{
    store.putSource(generation,sourceKey,'motion-outcomes',{splitRequests:[],sources:[],decisions:[]},stamp);
    saveAmendmentRows(store,generation,{id:target,date,titles:{en:'Accepted report'}},[{id:target+'-AM-1',targetDocumentId:target,number:1,date,authors:[],decisions:[],gaps:[]}],{complete:false,gaps:[],lastUpdated:stamp});
    enqueueAmendment(store,generation,'retained:source','amendment-reparse',{sourceKey,offset:1000},100);
    store.db.prepare('UPDATE amendment_jobs SET attempts=1,retry_at=? WHERE generation=?').run(clock()+30_000,generation);
  });publish();
  write(()=>{
    store.db.prepare('INSERT INTO sources SELECT 4,key,kind,body,fetched_at,seen FROM sources WHERE generation=?').run(generation);
    store.db.prepare('INSERT INTO items SELECT 4,source_key,source_id,mep,category,date,body FROM items WHERE generation=?').run(generation);
    store.db.prepare('DELETE FROM sources WHERE generation<>4').run();store.db.prepare('DELETE FROM items WHERE generation<>4').run();store.db.prepare('DELETE FROM tasks').run();
    // This fixture predates accepted refresh snapshots; accepted mismatches fail closed.
    store.set('refreshPolicyGeneration',null);store.set('active',4);store.set('sequence',4);
  });
  assert.equal(amendmentsPage(store,{document:target}).coverage.servingGeneration,generation);assert.equal(pending(store),true);assert.equal(worker.due(),false);
  const queued=job(store,'retained:source',generation),execute=worker.task.bind(worker);let adopted;
  worker.task=async task=>{
    if(task.key==='retained:source')adopted={generation:task.generation,attempts:task.attempts,error:task.error,retry_at:task.retry_at,offset:task.body.offset};
    return execute(task);
  };
  advance(30_000);await worker.run();
  assert.deepEqual(adopted,{generation:4,attempts:1,error:queued.error,retry_at:queued.retry_at,offset:1000});
  const resumed=job(store,'retained:source',4);assert.equal(resumed.done,1);assert.equal(resumed.attempts,0);assert.equal(resumed.error,null);assert.equal(resumed.retry_at,0);assert.equal(JSON.parse(resumed.body).offset,1000);assert.equal(JSON.parse(resumed.body).rebuild.kind,'sitting');assert.equal(worker.requests,0);
  assert.equal(store.source(generation,sourceKey),undefined);assert.equal(store.source(4,sourceKey).work.splitParserVersion,SPLIT_PARSER_VERSION);
  assert.equal(store.get('active'),4);assert.equal(store.get('sequence'),4);assert.equal(store.get('working'),null);assert.equal(pending(store),false);
});

test('ordinary dependencies queued after publication are checkpointed before a budget exit and resume after rollback',async t=>{
  const {store,worker,generation,write,advance,clock,publish}=setup(t,{budget:1});
  write(()=>{
    enqueueAmendment(store,generation,'parent:roster','amendment-roster',{date,offset:1000,members:[{id:'1'}],sources:[]},100);
  });publish();
  const task=worker.task.bind(worker),dependency='dependency:document';
  worker.task=async current=>{
    await task(current);
    if(current.key==='parent:roster') {
      store.enqueue(generation,dependency,'document',{endpoint:'/plenary-documents/'+target,offset:750},90);
      store.db.prepare('UPDATE tasks SET attempts=2,retry_at=?,error=? WHERE generation=? AND key=?').run(clock()+30_000,'Preserved retry',generation,dependency);
    }
  };
  worker.fetchRecord=async endpoint=>{assert.equal(endpoint,'/meps/show-current');return {payload:{data:[]},fetchedAt:stamp};};
  await worker.run();
  const saved=job(store,dependency,generation);assert.equal(JSON.parse(saved.body).offset,750);assert.equal(saved.attempts,2);assert.equal(saved.retry_at,clock()+30_000);
  assert.equal(store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=?').get(generation,dependency),undefined);assert.equal(pending(store),true);
  write(()=>{
    store.db.prepare('INSERT INTO sources SELECT 4,key,kind,body,fetched_at,seen FROM sources WHERE generation=?').run(generation);
    store.db.prepare('DELETE FROM sources WHERE generation<>4').run();store.db.prepare('DELETE FROM tasks').run();store.set('refreshPolicyGeneration',null);store.set('active',4);store.set('sequence',4);
  });
  advance(30_000);let requests=0;
  worker.fetchRecord=async endpoint=>{assert.equal(endpoint,'/plenary-documents/'+target);requests++;return {payload:{data:[report]},fetchedAt:stamp};};
  await worker.run();
  assert.equal(requests,1);assert.equal(job(store,dependency,4).done,1);assert.equal(job(store,dependency,4).attempts,2);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),4);
});

test('a continuation respects the existing writer lease while a rollback reader owns it',async t=>{
  const {directory,store,worker,generation,write,advance,publish}=setup(t);
  write(()=>{store.putSource(generation,sourceKey,'motion-outcomes',{splitRequests:[],sources:[],decisions:[]},stamp);enqueueAmendment(store,generation,'leased:source','amendment-reparse',{sourceKey},100);});publish();
  const rollbackReader=new ActivityStore(directory,{clock:worker.clock});
  try {
    assert(rollbackReader.acquire());await worker.run();assert.equal(job(store,'leased:source',generation).done,0);assert.equal(store.get('working'),null);
    advance(91_000);await worker.run();assert.equal(job(store,'leased:source',generation).done,1);assert.equal(rollbackReader.renew(),false);assert.throws(()=>rollbackReader.assertWriter(),/lease/);
    assert.equal(store.get('schema'),1);assert.equal(store.get('sequence'),generation);
  } finally {rollbackReader.close();}
});

test('a full queue reclaims completed records and preserves sitting completion dedup at Brussels midnight',async t=>{
  const {store,worker,generation,write,advance,clock,publish}=setup(t,{budget:1});
  advance(7.5*60*60_000); // 23:30 UTC is the next calendar day in Brussels.
  const sitting='MTG-PL-2026-10-08',completedKey='motion-outcomes:'+sitting+':2026-10-17';
  write(()=>{
    enqueueAmendment(store,generation,completedKey,'motion-outcomes',{sittingId:sitting},10);store.finishTask({...job(store,completedKey,generation),amendmentJob:true});
    for(let index=0;index<198;index++){const key='z-completed:'+index;enqueueAmendment(store,generation,key,'amendment-reparse',{sourceKey},10);store.finishTask({...job(store,key,generation),amendmentJob:true});}
    enqueueAmendment(store,generation,'parent:capacity','amendment-roster',{date,offset:1000,members:[{id:'1'}],sources:[]},100);
  });publish();
  const original=worker.task.bind(worker),dependency='capacity:document';
  worker.task=async current=>{await original(current);if(current.key==='parent:capacity'){store.enqueue(generation,dependency,'document',{endpoint:'/plenary-documents/'+target,offset:750},90);store.db.prepare('UPDATE tasks SET attempts=2,retry_at=? WHERE generation=? AND key=?').run(clock()+30_000,generation,dependency);}};
  worker.fetchRecord=async()=>({payload:{data:[]},fetchedAt:new Date(clock()).toISOString()});
  await worker.run();
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=?').get(generation).n,200);
  const saved=job(store,dependency,generation);assert.equal(saved.attempts,2);assert.equal(JSON.parse(saved.body).offset,750);assert.equal(saved.retry_at,clock()+30_000);
  const checkpoint=store.source(generation,'amendment:continuations').work;
  assert(checkpoint.completed.some(task=>task.key===completedKey));assert.equal(pending(store),true);
  write(()=>assert.equal(scheduleSittingOutcomes(worker,generation,sitting),false));
  assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),generation);
});

test('a checkpoint above 200 dependencies keeps progressed cursors and compact discovery through legacy advancement',async t=>{
  const {store,worker,generation,write,advance,clock,publish}=setup(t,{budget:0});
  const protectedKey='protected:cursor',sitting='MTG-PL-2026-10-08',waitingSitting='MTG-PL-2026-10-07',waitingMotion='motion-outcomes:'+waitingSitting+':'+date;
  const expected=new Map();
  write(()=>{
    for(let index=0;index<199;index++) {
      const key=index===0?waitingMotion:'waiting:'+index;
      enqueueAmendment(store,generation,key,index===0?'motion-outcomes':'amendment-reparse',index===0?{sittingId:waitingSitting,stage:'results',offset:250,results:[],decisions:[],splits:[],sources:[]}:{sourceKey,offset:index},10);
      store.db.prepare('UPDATE amendment_jobs SET attempts=2,retry_at=?,error=? WHERE generation=? AND key=?').run(clock()+60_000,'Accepted optional progress',generation,key);
      expected.set(key,job(store,key,generation));
    }
  });publish();
  write(()=>{
    store.enqueue(generation,protectedKey,'motion-outcomes',{sittingId:sitting,stage:'results',offset:750,results:[],decisions:[],splits:[],sources:[]},200);
    store.db.prepare('UPDATE tasks SET attempts=3,retry_at=?,error=? WHERE generation=? AND key=?').run(clock()+30_000,'Accepted progress',generation,protectedKey);
    for(let index=0;index<2;index++) {
      const key='protected:document:'+index;store.enqueue(generation,key,'document',{endpoint:'/plenary-documents/'+target,offset:900+index},190);
      store.db.prepare('UPDATE tasks SET attempts=4,retry_at=?,error=? WHERE generation=? AND key=?').run(clock()+30_000,'Accepted document progress',generation,key);
    }
    for(const row of store.db.prepare('SELECT * FROM tasks WHERE generation=?').all(generation))expected.set(row.key,row);
    for(let index=0;index<500;index++)store.enqueue(generation,'discovery:'+index,'document',{endpoint:'/plenary-documents/A-10-2026-'+(1000+index)},100);
  });
  await worker.run();
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=?').get(generation).n,200);
  let checkpoint=store.source(generation,'amendment:continuations').work;
  assert(checkpoint.tasks.length<=200);assert(checkpoint.discovery.length>0);assert(checkpoint.discovery.length<=200);
  const protectedTask=checkpoint.tasks.find(task=>task.key===protectedKey) || job(store,protectedKey,generation);
  assert.equal(protectedTask.attempts,3);assert.equal(protectedTask.retry_at,clock()+30_000);assert.equal(JSON.parse(protectedTask.body).offset,750);
  assert(checkpoint.discovery.every(task=>!Object.hasOwn(task,'body')&&!Object.hasOwn(task,'attempts')&&!Object.hasOwn(task,'retry_at')));
  assert(!checkpoint.completed.some(task=>task.key===waitingMotion));
  assert(checkpoint.capacityGap.count>0);assert.equal(pending(store),true);
  assert(amendmentsPage(store,{document:target}).coverage.gaps.includes(checkpoint.capacityGap.message));
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM sources WHERE generation=? AND json_type(body,'$.continuation') IS NOT NULL").get(generation).n,0);
  const assertCursors=active=>{
    const saved=store.source(active,'amendment:continuations').work;
    for(const [key,row] of expected) {
      const retained=job(store,key,active) || saved.tasks.find(task=>task.key===key);
      assert(retained,key);for(const field of ['body','attempts','retry_at','error'])assert.equal(retained[field],row[field],key+':'+field);
    }
    assert(saved.tasks.length<=200);assert(saved.discovery.length<=200);
  };
  assert.equal(expected.size,202);assertCursors(generation);
  write(()=>assert.equal(scheduleSittingOutcomes(worker,generation,sitting),false));
  write(()=>{
    store.db.prepare('INSERT INTO sources SELECT 4,key,kind,body,fetched_at,seen FROM sources WHERE generation=?').run(generation);
    store.db.prepare('DELETE FROM sources WHERE generation<>4').run();store.db.prepare('DELETE FROM tasks').run();store.set('refreshPolicyGeneration',null);store.set('active',4);store.set('sequence',4);
  });
  advance(30_000);await worker.run();
  checkpoint=store.source(4,'amendment:continuations').work;
  const resumed=checkpoint.tasks.find(task=>task.key===protectedKey) || job(store,protectedKey,4);
  assert.equal(resumed.attempts,3);assert.equal(resumed.retry_at,Date.parse(stamp)+30_000);assert.equal(JSON.parse(resumed.body).offset,750);
  assertCursors(4);assert(amendmentsPage(store,{document:target}).coverage.gaps.includes(checkpoint.capacityGap.message));
  assert.equal(store.get('working'),null);assert.equal(store.get('active'),4);assert.equal(store.get('sequence'),4);assert.equal(pending(store),true);
});

test('compact discovery alone wakes the existing worker and admits its dependency',async t=>{
  const {store,worker,generation,write,publish}=setup(t,{budget:1});publish();
  const key='compact:document';
  write(()=>store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[],discovery:[{key,kind:'document',endpoint:'/plenary-documents/'+target,priority:100}],completed:[]},stamp));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs').get().n,0);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0);
  assert.equal(pending(store),true);assert.equal(worker.due(),true);
  let calls=0;worker.fetchRecord=async endpoint=>{assert.equal(endpoint,'/plenary-documents/'+target);calls++;return {payload:{data:[report]},fetchedAt:stamp};};
  await worker.run();
  assert.equal(calls,1);assert.equal(job(store,key,generation).done,1);assert.equal(pending(store),false);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),generation);
});

test('saved optional continuations advance during a working core retry without moving its cursor',async t=>{
  const {store,worker,generation,write,clock}=setup(t,{budget:2});
  const coreKey='core:delayed',optionalKey='optional:compact';
  write(()=>{
    store.enqueue(generation,coreKey,'catalog',{endpoint:'/plenary-documents',params:{year:2026},offset:750},100);
    store.db.prepare('UPDATE tasks SET attempts=3,retry_at=?,error=? WHERE generation=? AND key=?').run(clock()+60_000,'Core retry',generation,coreKey);
    for(let index=0;index<199;index++) {
      const key='optional:waiting:'+index;enqueueAmendment(store,generation,key,'amendment-reparse',{sourceKey,offset:index},10);
      store.db.prepare('UPDATE amendment_jobs SET retry_at=? WHERE generation=? AND key=?').run(clock()+60_000,generation,key);
    }
    enqueueAmendment(store,generation,'optional:finishes','amendment-roster',{date,offset:1000,members:[{id:'1'}],sources:[]},200);
    store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[],discovery:[{key:optionalKey,kind:'document',endpoint:'/plenary-documents/'+target,priority:100}],completed:[]},stamp);
  });
  const coreBefore=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,coreKey),calls=[];
  worker.fetchRecord=async endpoint=>{calls.push(endpoint);return {payload:{data:endpoint==='/meps/show-current'?[]:[report]},fetchedAt:stamp};};
  await worker.run();
  assert.deepEqual(calls,['/meps/show-current','/plenary-documents/'+target]);
  assert.equal(job(store,optionalKey,generation).done,1);
  assert.deepEqual(store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,coreKey),coreBefore);
  assert.equal(job(store,coreKey,generation),undefined);assert.equal(store.get('working').generation,generation);assert.equal(store.get('active'),null);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=?').get(generation).n,200);
});

test('dependencies created on failure and abort exits are durable before the writer lease is released',async t=>{
  for(const mode of ['failure','abort']) {
    const {store,worker,generation,write,publish}=setup(t,{budget:1});
    write(()=>{store.putSource(generation,sourceKey,'motion-outcomes',{splitRequests:[],sources:[],decisions:[]},stamp);enqueueAmendment(store,generation,'exiting:source','amendment-reparse',{sourceKey},100);});publish();
    const original=worker.task.bind(worker),dependency='exit:document';
    worker.task=async current=>{
      await original(current);store.enqueue(generation,dependency,'document',{endpoint:'/plenary-documents/'+target,offset:750},90);
      if(mode==='abort')worker.stop();
      throw new Error('Synthetic '+mode+' after dependency scheduling');
    };
    await worker.run();
    const saved=job(store,dependency,generation) || store.source(generation,'amendment:continuations')?.work.tasks.find(task=>task.key===dependency);
    assert(saved);assert.equal(JSON.parse(saved.body).offset,750);assert.equal(store.db.prepare('SELECT 1 FROM tasks WHERE generation=? AND key=?').get(generation,dependency),undefined);
    assert.equal(store.get('working'),null);assert.equal(store.status().exclusiveWriterActive,false);assert.equal(pending(store),true);
  }
});

function discoveryReport() {
  const listId=target+'-AM-001-001',url='https://data.europarl.europa.eu/distribution/example/new-amendment.docx';
  return {listId,url,work:projectDocument({...report,inverse_foresees_change_of:[{id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',document_date:date,foresees_change_of:['eli/dl/doc/'+target],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:url}]}]}]})};
}
function discoveryDocx() {
  const p=text=>'<w:p><w:r><w:t>'+text.replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t></w:r></w:p>';
  const row=values=>'<w:tr>'+values.map(value=>'<w:tc>'+p(value)+'</w:tc>').join('')+'</w:tr>';
  const xml='<w:document xmlns:w="urn:word"><w:body>'+p('<Amend><Date>16.10.2026</Date><NumAm>1</NumAm>')+p('<Article>Article 1</Article>')+'<w:tbl>'+row(['Text proposed by the Commission','Amendment'])+row(['Accepted original','New proposed wording'])+'</w:tbl>'+p('</Amend>')+'</w:body></w:document>';
  const name=Buffer.from('word/document.xml'),body=Buffer.from(xml),compressed=deflateRawSync(body),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
  return Buffer.concat([local,name,compressed,central,name,end]);
}
function discoveryFetch(calls) {
  return async(endpoint,params)=>{assert.equal(endpoint,'/meps/show-current');assert.equal(params['mandate-date'],date);calls.push(params.offset);return {payload:{data:params.offset===0?[{identifier:'1',givenName:'Example',familyName:'Member'}]:[]},fetchedAt:stamp};};
}

test('200 completed jobs allow actual scheduling and preparation to execute a new extraction and dated roster',async t=>{
  for(const mode of ['schedule','prepare']) {
    const {store,worker,generation,writeAsync,clock}=setup(t,{budget:3}),{work,listId,url}=discoveryReport();
    const coreKey='core:held-for-retry';
    await writeAsync(async()=>{
      store.putSource(generation,'/plenary-documents/'+target,'document',work,stamp);
      for(let index=0;index<200;index++){const key='completed:'+index;enqueueAmendment(store,generation,key,'amendment-reparse',{sourceKey},10);store.finishTask({...job(store,key,generation),amendmentJob:true});}
      store.enqueue(generation,coreKey,'catalog',{endpoint:'/plenary-documents',params:{year:2026},offset:750},100);
      store.db.prepare('UPDATE tasks SET attempts=3,retry_at=?,error=? WHERE generation=? AND key=?').run(clock()+60_000,'Existing core retry',generation,coreKey);
      if(mode==='schedule')scheduleAmendments(worker,generation,work,stamp,'/plenary-documents/'+target);
      else {store.updateCycle({amendmentsPreparedDay:'2026-10-15'});await prepareAmendments(worker,store.get('working'));}
    });
    const coreBefore=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,coreKey),calls=[];let downloads=0;
    assert.equal(pending(store),true);assert.equal(job(store,'amendment:extract:'+listId,generation).done,0);assert.equal(job(store,'amendment:roster:'+date,generation).done,0);
    worker.fetchRecord=discoveryFetch(calls);worker.downloadAmendmentDocx=async actual=>{assert.equal(actual,url);downloads++;return {buffer:discoveryDocx()};};
    await worker.run();
    assert.equal(downloads,1);assert.deepEqual(calls,[0,1]);assert(store.source(generation,'amendment:roster:'+date));
    const page=amendmentsPage(store,{document:target});assert.equal(page.items[0].proposedText,'New proposed wording');assert(!page.coverage.gaps.includes('Amendment text extraction is pending.'));assert.equal(page.coverage.pending,false);
    assert.deepEqual(store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,coreKey),coreBefore);assert.equal(store.get('working').generation,generation);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=?').get(generation).n,200);
  }
});

test('a fully pending queue durably defers newly scheduled work through legacy generation advancement',async t=>{
  const {store,worker,generation,write,clock,publish}=setup(t,{budget:3}),{work,listId,url}=discoveryReport(),expected=new Map();
  write(()=>{
    store.putSource(generation,'/plenary-documents/'+target,'document',work,stamp);
    for(let index=0;index<200;index++) {
      const key='retained:'+index;enqueueAmendment(store,generation,key,'amendment-reparse',{sourceKey,offset:250+index},10);
      store.db.prepare('UPDATE amendment_jobs SET attempts=2,retry_at=?,error=? WHERE generation=? AND key=?').run(clock()+60_000,'Retained retry',generation,key);expected.set(key,job(store,key,generation));
    }
  });publish();
  write(()=>scheduleAmendments(worker,generation,work,stamp,'/plenary-documents/'+target));
  const checkpoint=store.source(generation,'amendment:continuations').work;
  assert.equal(checkpoint.tasks.length,2);assert.equal(pending(store),true);assert.equal(worker.due(),true);
  write(()=>store.transaction(()=>assert.equal(enqueueAmendment(store,generation,'amendment:extract:'+listId,'amendment-extract',{listId,targetDocumentId:target},112,true),true)));
  assert.deepEqual(store.source(generation,'amendment:continuations').work,checkpoint);
  write(()=>{
    store.db.prepare('INSERT INTO sources SELECT 4,key,kind,body,fetched_at,seen FROM sources WHERE generation=?').run(generation);
    store.db.prepare('DELETE FROM sources WHERE generation<>4').run();store.db.prepare('DELETE FROM tasks').run();store.set('refreshPolicyGeneration',null);store.set('active',4);store.set('sequence',4);
  });
  const calls=[];worker.fetchRecord=discoveryFetch(calls);worker.downloadAmendmentDocx=async actual=>{assert.equal(actual,url);return {buffer:discoveryDocx()};};
  await worker.run();
  assert.deepEqual(calls,[0,1]);assert.equal(store.source(4,'amendment:list:'+listId).work.extraction.amendments[0].proposedText,'New proposed wording');assert(store.source(4,'amendment:roster:'+date));
  const saved=store.source(4,'amendment:continuations')?.work;
  for(const [key,row] of expected){const retained=job(store,key,4)||saved?.tasks.find(task=>task.key===key);assert(retained,key);for(const field of ['body','attempts','retry_at','error'])assert.equal(retained[field],row[field],key+':'+field);}
  assert.equal(store.get('active'),4);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),4);assert.equal(store.get('schema'),1);assert.equal(pending(store),true);
});

test('admission saturation exposes a capacity gap without replacing full saved cursor records',t=>{
  const {store,worker,generation,write,clock,publish}=setup(t),snapshots=[];
  write(()=>{
    for(let index=0;index<200;index++) {
      const key='pending:'+index;enqueueAmendment(store,generation,key,'amendment-reparse',{sourceKey,offset:index},10);
      store.db.prepare('UPDATE amendment_jobs SET attempts=2,retry_at=?,error=? WHERE generation=? AND key=?').run(clock()+60_000,'Queue cursor',generation,key);
      snapshots.push({generation,key:'snapshot:'+index,kind:'amendment-reparse',body:JSON.stringify({sourceKey,offset:1000+index}),priority:10,done:0,attempts:3,retry_at:clock()+60_000,error:'Snapshot cursor'});
    }
    store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:snapshots,discovery:[],completed:[]},stamp);
  });publish();
  write(()=>assert.equal(enqueueAmendment(store,generation,'new:discovery','amendment-extract',{listId:target+'-AM-002-002',targetDocumentId:target},112),false));
  const checkpoint=store.source(generation,'amendment:continuations').work,page=amendmentsPage(store,{document:target});
  assert.deepEqual(checkpoint.tasks,snapshots);assert.equal(checkpoint.capacityGap.count,1);assert(page.coverage.gaps.includes(checkpoint.capacityGap.message));assert.equal(page.coverage.pending,true);assert.equal(page.coverage.complete,false);
  assert.equal(store.source(generation,'/plenary-documents/'+target).work.amendmentLinksVersion,undefined);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=?').get(generation).n,200);
});

test('reclamation preserves current-day sitting dedup and never overflows its completion-marker reserve',async t=>{
  const {store,worker,generation,write,publish}=setup(t,{budget:1}),completed=[];
  const sitting='MTG-PL-2026-03-22',key='motion-outcomes:'+sitting+':'+date;
  write(()=>{
    for(let index=0;index<200;index++) {
      const sittingId='MTG-PL-'+new Date(Date.parse('2026-03-22')+index*86_400_000).toISOString().slice(0,10),taskKey='motion-outcomes:'+sittingId+':'+date;
      enqueueAmendment(store,generation,taskKey,'motion-outcomes',{sittingId},10);store.finishTask({...job(store,taskKey,generation),amendmentJob:true});
      const previousSitting='MTG-PL-'+new Date(Date.parse('2025-01-01')+index*86_400_000).toISOString().slice(0,10);
      completed.push({key:'motion-outcomes:'+previousSitting+':'+date,kind:'motion-outcomes',sittingId:previousSitting});
    }
    assert.equal(enqueueAmendment(store,generation,'new:slot','amendment-reparse',{sourceKey},100),true);
  });
  let checkpoint=store.source(generation,'amendment:continuations').work;
  assert(checkpoint.completed.some(task=>task.key===key));write(()=>assert.equal(scheduleSittingOutcomes(worker,generation,sitting),false));
  write(()=>{
    store.db.prepare('DELETE FROM amendment_jobs WHERE generation=? AND key=?').run(generation,'new:slot');
    enqueueAmendment(store,generation,key,'motion-outcomes',{sittingId:sitting},10);store.finishTask({...job(store,key,generation),amendmentJob:true});
    store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[],discovery:[],completed},stamp);
    assert.equal(enqueueAmendment(store,generation,'reserve:pending','amendment-reparse',{sourceKey},100),true);
  });publish();
  await worker.run();checkpoint=store.source(generation,'amendment:continuations').work;
  assert.deepEqual(checkpoint.completed,completed);assert.equal(checkpoint.tasks.length,1);assert.equal(job(store,key,generation).done,1);assert.equal(pending(store),true);
  write(()=>assert.equal(scheduleSittingOutcomes(worker,generation,sitting),false));assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=?').get(generation).n,200);
});
