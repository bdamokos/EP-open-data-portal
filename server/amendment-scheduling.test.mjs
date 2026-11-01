import {unthrottledUpstream} from './test-support/upstream.mjs';
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
import {AMENDMENT_AUTHOR_NAMES_VERSION} from './amendment-author-names.mjs';
import {amendmentsPage,enqueueAmendment,nextAmendmentTask} from './amendments-store.mjs';
import {prepareAmendments,refreshSittingTargets,failAmendmentTask} from './amendments-worker.mjs';

const date='2026-10-02',stamp='2026-10-17T08:00:00.000Z',sitting='MTG-PL-2026-10-07';
const member={id:'1',givenName:'Example',familyName:'Member'};
const source={url:'https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/decisions?offset=0',fetchedAt:stamp};
const id=index=>'A-10-2026-'+String(7000+index);
function setup(t,{budget=1000,clock=()=>Date.parse(stamp)}={}) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-scheduling-'));
  const store=new ActivityStore(directory,{clock});assert(store.acquire());const {generation}=store.beginCycle();
  store.setMembers([{id:'1',name:'Example Member'}]);
  // Metadata is settled in this amendment scheduling fixture.
  store.db.prepare('INSERT INTO group_voice_state VALUES (?,1)').run(generation);
  const worker=new ActivityWorker(store,{runUpstream:unthrottledUpstream,clock,budget,fetchRecord:async()=>{throw Error('Unexpected synthetic source request');},downloadAmendmentDocx:async()=>{throw Error('Unexpected DOCX download');},downloadVotingXml:async()=>{throw Error('Unexpected XML download');}});
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
function fillAmendmentQueues(store,generation,count=200) {
  store.transaction(()=>{
    for(let i=0;i<count;i++)store.db.prepare('INSERT INTO amendment_jobs(generation,key,kind,body,priority) VALUES (?,?,?,?,?)').run(generation,'occupied:'+i,'amendment-rebuild',JSON.stringify({rebuild:{kind:'profile',offset:0},targets:[]}),110);
  });
  store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:Array.from({length:200},(_,i)=>({generation,key:'deferred:'+i,kind:'amendment-rebuild',body:'{}',priority:109,done:0,attempts:0,retry_at:0,error:null})),discovery:[],completed:[]},stamp);
}

test('a full amendment queue defers its dependent vote task so capacity can drain without losing the saved graph',async t=>{
  const {store,worker,generation}=setup(t);
  let now=worker.clock();worker.clock=store.clock=()=>now;
  const body={sittingId:sitting,stage:'decisions',offset:250,results:[{id:'retained-result'}],decisions:[{id:'retained-decision'}],sources:[source],amendmentRebuildPending:true};
  const key='motion-outcomes:'+sitting+':correction';
  store.enqueue(generation,key,'motion-outcomes',body,113);
  store.db.prepare('UPDATE tasks SET attempts=2,error=? WHERE generation=? AND key=?').run('Previous source failure',generation,key);
  const work=sittingWork([],'ADOPTED');saveSitting(store,generation,work);
  fillAmendmentQueues(store,generation);
  const accepted=store.source(generation,'motion-outcomes:'+sitting),lastSuccess=store.get('lastSuccess');
  const first=store.nextTask(generation);await worker.task(first);
  let retained=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key);
  assert.equal(store.nextTask(generation),undefined,'the blocked high-priority task must yield to amendment jobs');
  assert.equal(first.done,null,'ordinary vote tasks use the scheduler\'s NULL pending state');
  assert.equal(retained.retry_at,now+30_000);assert.equal(retained.done,first.done);assert.equal(retained.attempts,2);assert.equal(retained.error,first.error);
  assert.deepEqual(JSON.parse(retained.body),body);assert.deepEqual(store.source(generation,'motion-outcomes:'+sitting),accepted);
  assert.equal(worker.requests,0);assert.equal(store.get('lastSuccess'),lastSuccess);
  const drain=nextAmendmentTask(store,generation);await worker.task(drain);
  assert.equal(row(store,generation,drain.key).done,1,'lower-priority work frees a direct queue slot');
  now+=30_000;store.renew();
  await worker.task(store.nextTask(generation));
  retained=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key);
  assert.equal(retained.done,1);assert.equal(row(store,generation,sittingKey).done,1);
  assert.deepEqual(store.source(generation,'motion-outcomes:'+sitting),accepted);
  assert.equal(worker.requests,0);assert.equal(store.get('lastSuccess'),lastSuccess);
});

test('fresh vote acquisition defers failed rebuild admission once and resumes without refetching',async t=>{
  const {store,worker,generation}=setup(t);let now=worker.clock(),fetches=0;worker.clock=store.clock=()=>now;
  const body={sittingId:sitting,stage:'decisions',offset:0,results:[],decisions:[],splits:[],sources:[]};
  const key='motion-outcomes:'+sitting+':new';store.enqueue(generation,key,'motion-outcomes',body,113);
  fillAmendmentQueues(store,generation);
  worker.fetchRecord=async()=>{fetches++;return {payload:{data:[]},fetchedAt:stamp};};
  await worker.task(store.nextTask(generation));
  const saved=store.source(generation,'motion-outcomes:'+sitting),pending=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key);
  assert(saved);assert.equal(pending.done,null);assert.equal(pending.retry_at,now+30_000);assert.equal(JSON.parse(pending.body).amendmentRebuildPending,true);
  assert.equal(store.nextTask(generation),undefined);assert.equal(fetches,1);assert.equal(worker.requests,1);
  await worker.task(nextAmendmentTask(store,generation));now+=30_000;store.renew();
  await worker.task(store.nextTask(generation));
  assert.equal(store.db.prepare('SELECT done FROM tasks WHERE generation=? AND key=?').get(generation,key).done,1);
  assert.deepEqual(store.source(generation,'motion-outcomes:'+sitting),saved);assert.equal(fetches,1);assert.equal(worker.requests,1);
});

test('checkpointed vote tasks defer in the amendment queue and report a missing retained graph as an error',async t=>{
  const {store,worker,generation}=setup(t),key='motion-outcomes:'+sitting+':optional';
  const body={sittingId:sitting,amendmentRebuildPending:true};
  enqueueAmendment(store,generation,key,'motion-outcomes',body,113);fillAmendmentQueues(store,generation,199);
  await assert.rejects(worker.task(task(store,generation,key)),/Saved vote results are unavailable/);
  saveSitting(store,generation,sittingWork([],'ADOPTED'));
  await worker.task(task(store,generation,key));
  const pending=row(store,generation,key);assert.equal(pending.done,0);assert.equal(pending.retry_at,worker.clock()+30_000);
  assert.deepEqual(JSON.parse(pending.body),body);assert.notEqual(nextAmendmentTask(store,generation).key,key);
  assert.equal(worker.requests,0);
});

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


for(const reserveFull of [false,true])test('a full legacy queue drains extraction before preparation; reserveFull='+reserveFull,async t=>{
  let now=Date.parse('2026-10-26T07:26:48Z'),elapsed=0;
  const {store,worker,generation}=setup(t,{budget:1,clock:()=>now});
  worker.monotonic=()=>elapsed;worker.maxDuration=20;
  for(const targetId of ['A-10-2026-0254','B-10-2026-0424',...Array.from({length:50},(_,i)=>id(i))])seedTarget(store,generation,targetId);
  store.updateCycle({initialized:true,membershipScheduled:true,groupHistoryScheduled:true,mutableScheduled:true,reportJoinsReady:true,procedureTitlesQueued:true,procedureTypesQueued:true,motionOutcomesDay:'2026-10-26',catchupDay:'2026-10-26'});
  const key='amendment:prepare:2026-10-24:legacy';
  enqueueAmendment(store,generation,key,'amendment-prepare',{markers:{amendmentsPreparedDay:'2026-10-24',amendmentDocumentParserVersion:'11'},stage:'documents',afterKey:'',throughKey:'/plenary-documents/Z',upgrades:74},113);
  for(let i=0;i<199;i++)enqueueAmendment(store,generation,'legacy:'+i,i<173?'amendment-extract':'amendment-aliases',{},i<173?112:108);
  if(reserveFull)store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:Array.from({length:200},(_,i)=>({generation,key:'reserved:'+i,kind:'amendment-reparse',body:'{}',priority:1,done:0,attempts:0,retry_at:0,error:null}))},stamp);
  const selected=[],original=worker.task.bind(worker);
  worker.task=async value=>{
    selected.push(value.kind);elapsed+=5;
    if(value.kind==='amendment-extract'){store.finishTask(value);worker.requests++;return;}
    return original(value);
  };
  await worker.runIteration();
  assert(selected.includes('amendment-extract'),'Queued extraction must get a turn within the bounded iteration.');
  const prep=row(store,generation,key)||store.source(generation,'amendment:continuations')?.work.tasks?.find(task=>task.key===key);
  assert.equal(worker.requests,1);assert.equal(prep.done,0);
  assert.equal(JSON.parse(prep.body).afterKey,'','Backpressure preserves the unprocessed preparation cursor.');
  assert(prep.retry_at>now);
  assert.equal(store.source(generation,'amendment:continuations')?.work.capacityGap,undefined);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM sources WHERE generation=? AND kind='document' AND json_type(body,'$.amendmentLinksVersion') IS NOT NULL").get(generation).n,52);
  if(!reserveFull)assert.equal(store.source(generation,'amendment:continuations'),undefined,'A new daily preparation must not fill the continuation reserve.');
});

test('day changes coalesce into one saved preparation and preserve its backoff and cursor',async t=>{
  let now=Date.parse('2026-10-24T10:00:00Z');
  const {store,worker,generation}=setup(t,{clock:()=>now});
  for(const targetId of ['A-10-2026-0254','B-10-2026-0424',...Array.from({length:13},(_,i)=>id(i))])seedTarget(store,generation,targetId);
  await prepareAmendments(worker,store.get('working'));
  const saved=store.db.prepare("SELECT * FROM amendment_jobs WHERE generation=? AND kind='amendment-prepare'").get(generation),cursor=JSON.parse(saved.body).afterKey;
  now=Date.parse('2026-10-26T10:00:00Z');assert(store.acquire());
  store.db.prepare('UPDATE amendment_jobs SET attempts=2,retry_at=?,error=? WHERE generation=? AND key=?').run(now+60_000,'Preserved preparation failure',generation,saved.key);
  const before=row(store,generation,saved.key);
  assert.equal(await prepareAmendments(worker,store.get('working')),false);
  const merged=row(store,generation,saved.key),body=JSON.parse(merged.body);
  assert.equal(body.afterKey,cursor);assert.equal(body.markers.amendmentsPreparedDay,'2026-10-24');assert.equal(body.requestedMarkers.amendmentsPreparedDay,'2026-10-26');
  assert.equal(merged.attempts,before.attempts);assert.equal(merged.retry_at,before.retry_at);assert.equal(merged.error,before.error);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM amendment_jobs WHERE generation=? AND kind='amendment-prepare' AND done=0").get(generation).n,1);
  assert.equal(store.source(generation,'amendment:continuations'),undefined);
  now+=60_000;assert(store.acquire());
  for(let i=0;row(store,generation,saved.key).done===0&&i<10;i++)await worker.task(task(store,generation,saved.key));
  assert.equal(row(store,generation,saved.key).done,1);assert.equal(store.get('working').amendmentsPreparedDay,'2026-10-26');
  const accepted={...store.get('working')};
  enqueueAmendment(store,generation,'obsolete:prepare','amendment-prepare',{markers:JSON.parse(saved.body).markers,stage:'done',afterKey:'',throughKey:''},113);
  await worker.task(task(store,generation,'obsolete:prepare'));
  assert.deepEqual(store.get('working'),accepted,'A late obsolete completion cannot regress current preparation markers.');
  assert.equal(await prepareAmendments(worker,store.get('working')),true);
  assert.equal(row(store,generation,saved.key).done,1);
});

for(const location of ['tasks','amendment_jobs','reserve'])test('marker changes retain the furthest legacy preparation in '+location,async t=>{
  const {store,worker,generation}=setup(t);
  for(const targetId of ['A-10-2026-0254','B-10-2026-0424',...Array.from({length:13},(_,i)=>id(i))])seedTarget(store,generation,targetId);
  await prepareAmendments(worker,store.get('working'));
  const saved=store.db.prepare("SELECT * FROM amendment_jobs WHERE generation=? AND kind='amendment-prepare'").get(generation);
  const body=JSON.parse(saved.body),key='legacy:furthest',retry=worker.clock()+60_000;
  const further={...body,afterKey:body.afterKey+'z',markers:{...body.markers,amendmentDocumentParserVersion:'legacy'}};
  const legacy={...saved,key,body:JSON.stringify(further),retry_at:retry,attempts:2,error:'Saved error'};
  if(location==='reserve')store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:[legacy]},stamp);
  else if(location==='tasks')store.enqueue(generation,key,'amendment-prepare',further,113);
  else enqueueAmendment(store,generation,key,'amendment-prepare',further,113);
  if(location!=='reserve')store.db.prepare(`UPDATE ${location} SET retry_at=?,attempts=2,error=? WHERE generation=? AND key=?`).run(retry,'Saved error',generation,key);
  for(let i=0;i<3;i++)assert.equal(await prepareAmendments(worker,store.get('working')),false);
  const kept=location==='reserve'?store.source(generation,'amendment:continuations').work.tasks[0]:store.db.prepare(`SELECT * FROM ${location} WHERE generation=? AND key=?`).get(generation,key);
  assert.equal(JSON.parse(kept.body).afterKey,further.afterKey);
  assert.equal(JSON.parse(kept.body).requestedMarkers.amendmentDocumentParserVersion,body.markers.amendmentDocumentParserVersion);
  assert.equal(kept.retry_at,retry);assert.equal(kept.attempts,2);assert.equal(kept.error,'Saved error');
  assert.equal(row(store,generation,saved.key).done,1);
  const count=['tasks','amendment_jobs'].reduce((n,table)=>n+store.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE generation=? AND kind='amendment-prepare' AND (done IS NULL OR done<>1)`).get(generation).n,0)+(store.source(generation,'amendment:continuations')?.work.tasks||[]).filter(t=>t.kind==='amendment-prepare'&&t.done!==1).length;
  assert.equal(count,1);
});

test('preparation admission at full queue and reserve preserves every report marker',async t=>{
  const {store,worker,generation}=setup(t);
  for(const targetId of ['A-10-2026-0254','B-10-2026-0424',id(0)])seedTarget(store,generation,targetId);
  for(let i=0;i<200;i++)enqueueAmendment(store,generation,'queued:'+i,'amendment-reparse',{},112);
  const tasks=Array.from({length:200},(_,i)=>({generation,key:'reserve:'+i,kind:'amendment-reparse',body:'{}',priority:112,done:0,attempts:0,retry_at:0,error:null}));
  store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks},stamp);
  const before=store.db.prepare('SELECT key,body FROM sources WHERE generation=? ORDER BY key').all(generation);
  assert.equal(await prepareAmendments(worker,store.get('working')),false);
  assert.equal(await prepareAmendments(worker,store.get('working')),false);
  assert.deepEqual(store.db.prepare('SELECT key,body FROM sources WHERE generation=? ORDER BY key').all(generation),before);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM amendment_jobs WHERE generation=? AND kind='amendment-prepare'").get(generation).n,0);
});

for(const linkUpgrade of [false,true])test('a partial target fanout retains its cursor and retries children; linkUpgrade='+linkUpgrade,async t=>{
  let now=Date.parse(stamp);
  const {store,worker,generation}=setup(t,{clock:()=>now});
  for(const targetId of ['A-10-2026-0254','B-10-2026-0424',...Array.from({length:12},(_,i)=>id(i))])seedTarget(store,generation,targetId);
  await prepareAmendments(worker,store.get('working'));
  const prep=store.db.prepare("SELECT * FROM amendment_jobs WHERE generation=? AND kind='amendment-prepare'").get(generation),cursor=JSON.parse(prep.body).afterKey;
  const source=store.db.prepare("SELECT key,body FROM sources WHERE generation=? AND kind='document' AND key>? ORDER BY key LIMIT 1").get(generation,cursor),work=JSON.parse(source.body);
  const listIds=[work.identifier+'-AM-001-001',work.identifier+'-AM-002-002'];
  store.putSource(generation,source.key,'document',{...work,amendmentLinksVersion:linkUpgrade?'legacy':work.amendmentLinksVersion,inverse_foresees_change_of:listIds.map(id=>'eli/dl/doc/'+id)},stamp);
  for(let i=1;i<199;i++)enqueueAmendment(store,generation,'queued:'+i,'amendment-reparse',{},112);
  const tasks=Array.from({length:200},(_,i)=>({generation,key:'reserve:'+i,kind:'amendment-reparse',body:'{}',priority:112,done:0,attempts:0,retry_at:0,error:null}));
  store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks},stamp);
  await worker.task(task(store,generation,prep.key));
  const child=id=>'amendment:discover:'+work.identifier+':'+id;
  assert(row(store,generation,child(listIds[0])));assert.equal(row(store,generation,child(listIds[1])),undefined);
  assert.equal(row(store,generation,prep.key).done,0);assert.equal(JSON.parse(row(store,generation,prep.key).body).afterKey,cursor);assert(row(store,generation,prep.key).retry_at>now);
  assert.equal(store.source(generation,source.key).work.amendmentLinksVersion,linkUpgrade?'legacy':work.amendmentLinksVersion);
  assert.deepEqual(store.source(generation,'amendment:continuations').work,{tasks});
  if(linkUpgrade) {
    assert.equal(JSON.parse(row(store,generation,prep.key).body).upgrades,1);
    const current=store.source(generation,source.key);
    store.putSource(generation,source.key,'document',{...current.work,amendmentLinksVersion:work.amendmentLinksVersion},stamp);
  }
  store.db.prepare("UPDATE amendment_jobs SET done=1 WHERE generation=? AND key IN ('queued:1','queued:2')").run(generation);
  now+=60_000;assert(store.acquire());await worker.task(task(store,generation,prep.key));
  assert(row(store,generation,child(listIds[1])),'The unadmitted child is retried from the same source.');
  assert.equal(JSON.parse(row(store,generation,prep.key).body).upgrades,linkUpgrade?1:0,'A target admitted before backpressure counts exactly once, even if its metadata refresh finishes before retry.');
  assert.equal(store.source(generation,source.key).work.amendmentLinksVersion,work.amendmentLinksVersion);
  assert.equal(store.source(generation,'amendment:continuations').work.capacityGap,undefined);
});

for(const kind of ['roster','members'])test(kind+' fan-out resumes beyond ten targets from saved evidence without refetching',async t=>{
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
  const retained=store.source(generation,evidenceKey);
  if(kind==='members') {
    assert.match(retained.work.rebuildRevision,/^[a-f0-9]{64}$/);
    const {rebuildRevision,...work}=retained.work;assert.deepEqual({...retained,work},evidence);
  } else assert.deepEqual(retained,evidence);
  assert.equal(calls.length,1);assert.equal(worker.requests,1);assert.equal(store.get('working').requests,1);
});

test('dated-roster failure reuses a retained term directory after its job was reclaimed',t=>{
  const {store,worker,generation}=setup(t),key='amendment:members:10';
  store.putSource(generation,key,'amendment-members',{nameVersion:AMENDMENT_AUTHOR_NAMES_VERSION,members:[member]},stamp);
  const failed={generation,key:'failed-dated-roster',kind:'amendment-roster',body:{date,offset:0,members:[],sources:[]},priority:114,attempts:0,amendmentJob:true};
  enqueueAmendment(store,generation,failed.key,failed.kind,failed.body,114);
  failAmendmentTask(worker,failed,new Error('Dated roster unavailable'));
  assert.equal(store.get('amendmentMandateFallback'),true);
  assert.equal(row(store,generation,key),undefined,'retained evidence must prevent an unchanged full members pass');
});

test('a reclaimed term-members job stays complete through dated-roster failures and unchanged source refreshes',async t=>{
  const {store,worker,generation}=setup(t),key='amendment:members:10',ids=Array.from({length:24},(_,i)=>id(i));
  for(const targetId of ids)seedTarget(store,generation,targetId,{sentinel:true});
  const members=[member,{id:'2',givenName:'Other',familyName:'Member'}];
  worker.fetchRecord=async()=>({payload:{data:[]},fetchedAt:stamp});
  enqueueAmendment(store,generation,key,'amendment-members',{offset:2,members},108);
  await worker.task(task(store,generation,key));
  let cursor=task(store,generation,key).body.rebuild.afterTarget;
  assert(cursor&&cursor<ids.at(-1));
  // Routine scheduling cannot replace a running members cursor.
  enqueueAmendment(store,generation,key,'amendment-members',{offset:0,members:[]},108,true);
  assert.equal(task(store,generation,key).body.rebuild.afterTarget,cursor);
  while(row(store,generation,key).done===0) {
    await worker.task(task(store,generation,key));
    assert(task(store,generation,key).body.rebuild.afterTarget>=cursor);
    cursor=task(store,generation,key).body.rebuild.afterTarget;
  }
  const revision=store.source(generation,key).work.rebuildRevision;assert(revision);
  // The bounded queue routinely reclaims completed jobs. Failed dated reads
  // must reuse the retained term directory rather than starting another pass.
  store.db.prepare('DELETE FROM amendment_jobs WHERE generation=? AND key=?').run(generation,key);
  store.set('amendmentMandateFallback',false);
  const failed={generation,key:'failed-dated-roster',kind:'amendment-roster',body:{date,offset:0,members:[],sources:[]},priority:114,attempts:0,amendmentJob:true};
  enqueueAmendment(store,generation,failed.key,failed.kind,failed.body,114);
  failAmendmentTask(worker,failed,new Error('Dated roster unavailable'));
  assert.equal(row(store,generation,key),undefined);assert.equal(store.get('amendmentMandateFallback'),true);
  store.db.exec('CREATE TABLE rebuilt_targets(id TEXT); CREATE TEMP TRIGGER count_member_rebuild AFTER INSERT ON amendment_targets BEGIN INSERT INTO rebuilt_targets VALUES (NEW.id); END');
  // Retrieval time and API order are not changes to the name/ID directory.
  worker.fetchRecord=async()=>({payload:{data:[]},fetchedAt:'2026-10-18T08:00:00.000Z'});
  enqueueAmendment(store,generation,key,'amendment-members',{offset:2,members:[...members].reverse()},108,true);
  await worker.task(task(store,generation,key));
  assert.equal(row(store,generation,key).done,1);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM rebuilt_targets').get().n,0);
  assert.equal(store.source(generation,key).work.rebuildRevision,revision);
  // A real source-name change still starts and completes a fresh sliced pass.
  enqueueAmendment(store,generation,key,'amendment-members',{offset:2,members:[{...member,familyName:'Changed'},members[1]]},108,true);
  await worker.task(task(store,generation,key));assert.equal(row(store,generation,key).done,0);
  assert.notEqual(task(store,generation,key).body.rebuild.revision,revision);
  while(row(store,generation,key).done===0)await worker.task(task(store,generation,key));
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM rebuilt_targets').get().n,24);
  assert.notEqual(store.source(generation,key).work.rebuildRevision,revision);
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
    // This fixture predates accepted refresh snapshots; accepted mismatches fail closed.
    store.db.prepare('DELETE FROM sources WHERE generation<>4').run();store.db.prepare('DELETE FROM items WHERE generation<>4').run();store.db.prepare('DELETE FROM tasks').run();store.set('refreshPolicyGeneration',null);store.set('active',4);store.set('sequence',4);
  });store.release();
  assert.equal(worker.coreDue(),false);assert.equal(worker.due(),true);assert.equal(amendmentsPage(store,{}).coverage.pending,true);
  await worker.run();const admitted=row(store,4,sittingKey);
  assert.equal(admitted.body,checkpoint.body);assert.equal(admitted.attempts,raw.attempts);assert.equal(admitted.retry_at,raw.retry_at);assert.equal(admitted.error,raw.error);assert.equal(admitted.done,0);
  assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),4);assert.equal(worker.requests,0);
  worker.budget=1000;await worker.run();
  assert.equal(row(store,4,sittingKey).done,1);for(const targetId of ids)assert.equal(outcome(store,4,targetId),'REJECTED');
  assert.equal(amendmentsPage(store,{}).coverage.pending,false);assert.deepEqual(store.page('1').items,accepted);assert.equal(store.get('lastSuccess'),lastSuccess);assert.equal(store.get('working'),null);assert.equal(store.get('sequence'),4);assert.equal(worker.requests,0);
});

test('parser recovery keysets lists independently of report upgrades and resumes after queue saturation',async t=>{
  const {prepareAmendmentParserUpgrade}=await import('./amendments-worker.mjs');
  const {AMENDMENT_DISTRIBUTION_PROOF_VERSION}=await import('./amendments.mjs');
  const {store,worker,generation}=setup(t),ids=Array.from({length:13},(_,index)=>id(index)),key='amendment:parser-upgrade:'+(await import('./amendment-documents.mjs')).AMENDMENT_EXTRACTION_VERSION;
  for(const targetId of ids) {
    const listId=targetId+'-AM-001-001';
    store.putSource(generation,'amendment:list:'+listId,'amendment-list',{id:'eli/dl/doc/'+listId,identifier:listId,targetDocumentId:targetId,extraction:{parserVersion:'10'},distributionEvidence:{version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,state:'available',descriptors:[{url:'https://data.europarl.europa.eu/distribution/test/'+listId+'.docx',language:'en',byteSize:null}]}},stamp);
  }
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(task(store,generation,key));
  assert.equal(row(store,generation,key).done,0);assert.equal(store.db.prepare("SELECT COUNT(*) n FROM amendment_jobs WHERE kind='amendment-extract'").get().n,8);
  const cursor=JSON.parse(row(store,generation,key).body);
  worker.stopped=true;await worker.task(task(store,generation,key));assert.deepEqual(JSON.parse(row(store,generation,key).body),cursor);worker.stopped=false;
  // Saturate both admission slots and the durable continuation reserve.
  for(let i=store.db.prepare('SELECT COUNT(*) n FROM amendment_jobs').get().n;i<200;i++)enqueueAmendment(store,generation,'blocked:'+i,'amendment-reparse',{},100);
  store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:Array.from({length:200},(_,i)=>({key:'reserve:'+i}))},stamp);
  await worker.task(task(store,generation,key));assert.deepEqual(JSON.parse(row(store,generation,key).body),cursor,'An unadmitted list must not be skipped.');
  store.db.prepare("DELETE FROM amendment_jobs WHERE key LIKE 'blocked:%'").run();store.db.prepare("DELETE FROM sources WHERE key='amendment:continuations'").run();
  store.publish(generation);const next=store.beginCycle();
  assert.deepEqual(JSON.parse(row(store,next.generation,key).body),cursor);
  store.db.prepare("UPDATE amendment_jobs SET done=1 WHERE generation=? AND kind='amendment-extract'").run(next.generation);
  await worker.task(task(store,next.generation,key));assert.equal(row(store,next.generation,key).done,1);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM amendment_jobs WHERE generation=? AND kind='amendment-extract'").get(next.generation).n,13);assert.equal(worker.requests,0);
});

test('an incompatible list saved behind the upgrade cursor requires another bounded pass',async t=>{
  const {prepareAmendmentParserUpgrade,amendmentParserUpgradeDue}=await import('./amendments-worker.mjs');
  const {AMENDMENT_DISTRIBUTION_PROOF_VERSION}=await import('./amendments.mjs');
  const {AMENDMENT_EXTRACTION_VERSION}=await import('./amendment-documents.mjs');
  const {store,worker,generation}=setup(t),key='amendment:parser-upgrade:'+AMENDMENT_EXTRACTION_VERSION;
  const put=targetId=>{
    const listId=targetId+'-AM-001-001';
    store.putSource(generation,'amendment:list:'+listId,'amendment-list',{id:'eli/dl/doc/'+listId,identifier:listId,targetDocumentId:targetId,extraction:{parserVersion:'10'},distributionEvidence:{version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,state:'available',descriptors:[{url:'https://data.europarl.europa.eu/distribution/test/'+listId+'.docx',language:'en',byteSize:null}]}},stamp);
    return listId;
  };
  for(let i=0;i<11;i++)put(id(i));
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(task(store,generation,key));
  const cursor=JSON.parse(row(store,generation,key).body).afterKey;
  const late=put('A-10-2026-9999');assert('amendment:list:'+late>cursor);
  store.db.prepare("UPDATE amendment_jobs SET done=1 WHERE generation=? AND kind='amendment-extract'").run(generation);
  await worker.task(task(store,generation,key));assert.equal(row(store,generation,key).done,1);assert.equal(amendmentParserUpgradeDue(store,generation),true);
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(task(store,generation,key));
  assert.equal(row(store,generation,'amendment:extract:'+late).done,0);
});

test('600 stale lists use eight in-flight slots without overflowing or invalidating report links',async t=>{
  const {prepareAmendmentParserUpgrade}=await import('./amendments-worker.mjs');
  const {AMENDMENT_DISTRIBUTION_PROOF_VERSION}=await import('./amendments.mjs');
  const {AMENDMENT_EXTRACTION_VERSION}=await import('./amendment-documents.mjs');
  const {AMENDMENT_LINKS_VERSION}=await import('./activity-index-model.mjs');
  const {store,worker,generation}=setup(t),key='amendment:parser-upgrade:'+AMENDMENT_EXTRACTION_VERSION;
  for(let i=0;i<600;i++) {
    const targetId=id(i),listId=targetId+'-AM-001-001';
    store.putSource(generation,'amendment:list:'+listId,'amendment-list',{id:'eli/dl/doc/'+listId,identifier:listId,targetDocumentId:targetId,document_date:i===86?'2026-10-22':'2026-01-01',extraction:{parserVersion:'10'},distributionEvidence:{version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,state:'available',descriptors:[{url:'https://data.europarl.europa.eu/distribution/test/'+listId+'.docx',language:'en',byteSize:null}]}},stamp);
    store.db.prepare('INSERT INTO sources VALUES (?,?,?,?,?,1)').run(generation,'/plenary-documents/'+targetId,'document',JSON.stringify({identifier:targetId,work_type:'def/ep-document-types/REPORT_PLENARY',amendmentLinksVersion:AMENDMENT_LINKS_VERSION}),stamp);
  }
  prepareAmendmentParserUpgrade(worker,generation);
  for(let pass=0;pass<5;pass++)await worker.task(task(store,generation,key));
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM amendment_jobs WHERE generation=? AND kind='amendment-extract' AND done=0").get(generation).n,8);
  assert(row(store,generation,'amendment:extract:'+id(86)+'-AM-001-001'),'Recent lists take priority over older lists.');
  assert.equal(row(store,generation,key).done,0);assert(row(store,generation,key).retry_at>store.clock());
  assert.equal(store.source(generation,'amendment:continuations'),undefined);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM sources WHERE generation=? AND kind='document' AND json_extract(body,'$.amendmentLinksVersion')=?").get(generation,AMENDMENT_LINKS_VERSION).n,600);
  assert.equal(worker.requests,0);
});

test('eight metadata jobs can each hand their slot to extraction without deadlocking at the recovery cap',async t=>{
  const {store,worker,generation}=setup(t),targetId=id(0),lists=Array.from({length:8},(_,i)=>targetId+'-AM-'+String(i+1).padStart(3,'0')+'-'+String(i+1).padStart(3,'0'));
  for(const listId of lists) {
    store.putSource(generation,'amendment:list:'+listId,'amendment-list',{id:'eli/dl/doc/'+listId,identifier:listId,targetDocumentId:targetId,extraction:{parserVersion:'10'}},stamp);
    enqueueAmendment(store,generation,'amendment:discover:'+targetId+':'+listId,'amendment-list-detail',{listId,targetDocumentId:targetId,parserUpgrade:true},115);
  }
  worker.fetchRecord=async endpoint=>{const listId=endpoint.split('/').at(-1);return {fetchedAt:stamp,payload:{data:[{id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+targetId],is_realized_by:[{language:'language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:'https://data.europarl.europa.eu/distribution/test/'+listId+'.docx'}]}]}]}};};
  for(const listId of lists) {
    const key='amendment:discover:'+targetId+':'+listId;await worker.task(task(store,generation,key));
    assert.equal(row(store,generation,key).done,1);
    assert.equal(row(store,generation,'amendment:extract:'+listId).done,0);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM amendment_jobs WHERE generation=? AND done=0').get(generation).n,8);
  }
  assert.equal(worker.requests,8);assert.equal(store.source(generation,'amendment:continuations'),undefined);
});

test('daily link recovery rotates beyond the first hundred repeatedly invalidated reports to B and RC motions',async t=>{
  const {store,worker,generation}=setup(t);
  for(const targetId of ['A-10-2026-0254','B-10-2026-0424',...Array.from({length:105},(_,i)=>id(i)),'B-10-2026-0244','RC-10-2026-0285'])seedTarget(store,generation,targetId);
  store.db.exec("UPDATE sources SET body=json_remove(body,'$.amendmentLinksVersion') WHERE kind='document'");
  const prepare=async()=>{for(let pass=0;pass<40;pass++)if(await prepareAmendments(worker,store.get('working')))return;assert.fail('preparation did not finish');};
  await prepare();
  const first=store.db.prepare("SELECT key FROM tasks WHERE kind='document' ORDER BY key").all().map(r=>r.key);
  assert.equal(first.length,100);assert(!first.includes('/plenary-documents/B-10-2026-0244'));
  const cursor=store.get('amendmentLinkUpgradeAfterKey');assert.equal(cursor,first.at(-1));
  // An overflowing continuation can invalidate the same first hundred again;
  // their pending jobs must not consume the next daily upgrade window.
  store.updateCycle({amendmentsPreparedDay:null});
  store.db.exec("UPDATE amendment_jobs SET done=1 WHERE kind='amendment-prepare'");
  await prepare();
  const all=store.db.prepare("SELECT key FROM tasks WHERE kind='document' ORDER BY key").all().map(r=>r.key);
  assert.equal(all.length,109);assert(all.includes('/plenary-documents/B-10-2026-0244'));assert(all.includes('/plenary-documents/RC-10-2026-0285'));
  assert.equal(store.get('amendmentLinkUpgradeAfterKey'),'');assert.equal(worker.requests,0);
});

test('legacy per-profile rebuild cursors still finish without refetching profiles',async t=>{
  const {store,worker,generation}=setup(t),ids=Array.from({length:12},(_,i)=>id(i));
  for(const targetId of ids)seedTarget(store,generation,targetId,{sentinel:true});
  const key='legacy-profile';
  enqueueAmendment(store,generation,key,'amendment-member',{id:'1',targets:ids,rebuild:{kind:'profile',offset:0}},107);
  await worker.task(task(store,generation,key));
  assert.equal(task(store,generation,key).body.rebuild.offset,10);
  await worker.task(task(store,generation,key));
  assert.equal(task(store,generation,key).done,1);
  assert(ids.every(id=>!target(store,generation,id).sentinel));
  assert.equal(worker.requests,0);
});
