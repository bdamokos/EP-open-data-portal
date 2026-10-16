import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { ActivityStore } from './activity-index-store.mjs';
import { ActivityWorker } from './activity-index-worker.mjs';
import { AMENDMENT_LINKS_VERSION } from './activity-index-model.mjs';
import { AMENDMENTS_VERSION, amendmentLists, amendmentOutcome, amendmentQuery, amendmentReference } from './amendments.mjs';
import { amendmentFailures, amendmentsPage, enqueueAmendment, nextAmendmentTask, recordSplitResults, saveAmendmentRows } from './amendments-store.mjs';
import { failAmendmentTask, parseSavedSplits, prepareAmendments, rebuildAmendmentTarget, refreshSittingTargets, scheduleAmendments, scheduleSittingOutcomes } from './amendments-worker.mjs';
import { SPLIT_PARSER_VERSION, parseSplitRequest } from './amendment-splits.mjs';
import { resolveAmendmentAuthors } from './amendment-authors.mjs';
import { AMENDMENT_EXTRACTION_VERSION, extractAmendments } from './amendment-documents.mjs';
import { motionSourceKey } from './motion-outcomes.mjs';
import { boundedUpstream, upstreamStatus } from './odp.mjs';

const targetId='A-10-2026-0254', otherTarget='B-10-2026-0254', sitting='MTG-PL-2026-10-07';
const tabled='2026-10-02', fetchedAt='2026-10-16T17:00:00.000Z', earlier='2026-10-15T17:00:00.000Z';
const sourceUrl='https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/vote-results?format=application%2Fld%2Bjson';
const target={id:'eli/dl/doc/'+targetId,identifier:targetId,amendmentLinksVersion:AMENDMENT_LINKS_VERSION,work_type:'def/ep-document-types/REPORT_PLENARY',document_date:tabled,title_dcterms:{en:'A public report',fr:'Un rapport public'},inverse_created_a_realization_of:['eli/dl/proc/2025-0233'],inverse_based_on_a_realization_of:['eli/dl/event/'+sitting+'-VOT-ITM-123'],isAboutSubjectMatter:['http://publications.europa.eu/resource/authority/subject-matter/ENV']};
const listId=targetId+'-AM-001-004';
const amendment=(number,extra={})=>({number,authors:[],targetLabel:'Article '+number,originalText:'Original '+number,proposedText:'Proposal '+number,date:tabled,language:'en',gaps:[],...extra});
const list=(amendments,extra={})=>({id:'eli/dl/doc/'+listId,identifier:listId,targetDocumentId:targetId,document_date:tabled,work_type:'def/ep-document-types/AMENDMENT_LIST',extraction:{amendments,gaps:[],language:'en',sourceUrl:'https://data.europarl.europa.eu/distribution/example/amendments_en.docx',fetchedAt:earlier,parserVersion:AMENDMENT_EXTRACTION_VERSION},...extra});
const decision=(number,refs,outcome,extra={})=>({id:'eli/dl/event/'+sitting+'-DEC-'+number,decided_on_a_realization_of:refs,activity_date:'2026-10-07',decision_outcome:'def/ep-statuses/'+outcome,decision_method:'def/ep-vote-methods/ROLL_CALL',referenceText:{en:'The same public title'},...extra});
const part=(number,description)=>({id:'eli/dl/doc/'+sitting+'-VOT-ITM-123-SPLIT-1-'+number,number:String(number),numbering:number,expressionContent:{en:'<partValue>'+description+'</partValue>'}});
const request=(parts)=>({id:'eli/dl/event/'+sitting+'-VOT-ITM-123-SPLIT-1',had_activity_type:'def/ep-activities/REQUEST_VOTE_SPLIT',created_a_realization_of:parts});
const coverage={complete:true,gaps:[],lastUpdated:earlier};
const metadata={id:targetId,date:tabled,titles:target.title_dcterms,procedureIds:['2025-0233']};
const row=(number,extra={})=>({id:targetId+'-AM-'+number,targetDocumentId:targetId,number,date:tabled,proposerDate:tabled,proposerDateBasis:'individual-amendment-document',documentDate:tabled,textParserVersion:AMENDMENT_EXTRACTION_VERSION,titles:target.title_dcterms,procedureIds:['2025-0233'],authors:[],decisions:[],gaps:[],...extra});
const completeSitting=(sittingId=sitting)=>({
  amendmentVersion:AMENDMENTS_VERSION,amendmentProjectionVersion:2,splitRequests:[],coverage:{missingResultIds:[],missingDecisionIds:[]},truncated:false,lastRefreshFailure:null,
  results:[{id:'eli/dl/event/'+sittingId+'-VOT-ITM-123',consists_of:['eli/dl/event/'+sittingId+'-DEC-1'],sittingResultIds:[]}],
  decisions:[{...decision(1,['eli/dl/doc/'+targetId+'-AM-1'],'ADOPTED'),id:'eli/dl/event/'+sittingId+'-DEC-1'}],
});
const outcomeJobs=(store,generation)=>store.db.prepare("SELECT * FROM tasks WHERE generation=? AND kind='motion-outcomes' ORDER BY key").all(generation);

function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendments-test-'));
  let now=Date.parse(fetchedAt);
  const store=new ActivityStore(directory,{clock:()=>now});
  assert(store.acquire());
  const {generation}=store.beginCycle();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const worker=new ActivityWorker(store,{clock:()=>now,fetchRecord:async()=>{throw new Error('Unexpected network request in amendment test.');}});
  return {store,worker,generation,advance:milliseconds=>{now+=milliseconds;store.renew();}};
}
function seedTarget(store,generation,amendments) {
  store.putSource(generation,'/plenary-documents/'+targetId,'document',target,fetchedAt);
  store.putSource(generation,'amendment:list:'+listId,'amendment-list',list(amendments),earlier);
}
function deferred() {
  let resolve,reject;
  const promise=new Promise((accept,fail)=>{resolve=accept;reject=fail;});
  return {promise,resolve,reject};
}
async function beforeTimeout(promise,milliseconds=1000) {
  let timer;
  try {return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cancellation did not settle within '+milliseconds+' milliseconds.')),milliseconds);})]);}
  finally {clearTimeout(timer);}
}
function cancellationTask(t,kind) {
  const context=setup(t),{store,generation}=context;
  const file={format:kind==='amendment-extract'?'DOCX':'XML',language:'en',url:'https://data.europarl.europa.eu/distribution/example/cancel.'+(kind==='amendment-extract'?'docx':'xml')};
  store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
  store.putSource(generation,'amendment:list:'+listId,'amendment-list',list([],{files:[file],extraction:null}),earlier);
  const key='cancel:'+kind,body=kind==='amendment-extract'?{listId,targetDocumentId:targetId,offset:700}:{sittingId:sitting,file,documentSource:{url:sourceUrl,fetchedAt:earlier},offset:700};
  enqueueAmendment(store,generation,key,kind,body,180);
  store.db.prepare('UPDATE amendment_jobs SET attempts=2,retry_at=?,error=? WHERE generation=? AND key=?').run(Date.parse(fetchedAt)-1,'Retained retry state',generation,key);
  const task=nextAmendmentTask(store,generation),original=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key);
  const sources=store.db.prepare('SELECT key,body,fetched_at FROM sources WHERE generation=? ORDER BY key').all(generation);
  const response=kind==='amendment-extract'?{buffer:comparisonDocx([['Original wording','Proposed wording']])}:'<PV.RollCallVoteResults Sitting.Date="2026-10-07"/>';
  return {...context,task,response,download:kind==='amendment-extract'?'downloadAmendmentDocx':'downloadVotingXml',unchanged:()=>{
    assert.deepEqual(store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key),original);
    assert.deepEqual(store.db.prepare('SELECT key,body,fetched_at FROM sources WHERE generation=? ORDER BY key').all(generation),sources);
    assert.equal(amendmentsPage(store).total,0);assert.equal(amendmentFailures(store).total,0);
  }};
}

test('worker cancellation rejects late DOCX and XML responses even when a downloader ignores its signal',async t=>{
  for(const kind of ['amendment-extract','amendment-aliases']) {
    const {store,worker,task,response,download,unchanged}=cancellationTask(t,kind),started=deferred(),reply=deferred();
    worker.running=true;
    worker[download]=async(_url,options={})=>{started.resolve(options.signal);return reply.promise;};
    const pending=worker.task(task),rejected=assert.rejects(pending,error=>error===worker.controller.signal.reason);
    const signal=await started.promise;
    worker.stop();reply.resolve(response);
    await rejected;
    assert.equal(signal,worker.controller.signal,kind);
    unchanged();assert.doesNotThrow(()=>store.assertWriter());
    worker.running=false;
  }
});

test('worker cancellation reaches signal-aware DOCX and XML downloads promptly after admission',async t=>{
  for(const kind of ['amendment-extract','amendment-aliases']) {
    const {worker,task,download,unchanged}=cancellationTask(t,kind),started=deferred(),reply=deferred();
    worker.running=true;
    worker[download]=async(_url,options={})=>{options.signal?.addEventListener('abort',()=>reply.reject(options.signal.reason),{once:true});started.resolve(options.signal);return reply.promise;};
    const pending=worker.task(task),rejected=assert.rejects(pending,error=>error===worker.controller.signal.reason);
    const signal=await started.promise;
    worker.stop();
    try {await beforeTimeout(rejected);}
    finally {reply.reject(worker.controller.signal.reason);await rejected;worker.running=false;}
    assert.equal(signal,worker.controller.signal,kind);unchanged();
  }
});

test('worker cancellation removes a queued amendment download before its downloader starts',async t=>{
  const {worker,task,download,unchanged}=cancellationTask(t,'amendment-extract'),occupied=deferred(),release=deferred();
  const blocker=boundedUpstream(async()=>{occupied.resolve();await release.promise;},{priority:'background'});
  await occupied.promise;
  const baseline=upstreamStatus().queued;let downloads=0;
  worker.running=true;worker[download]=async()=>{downloads++;return {buffer:Buffer.alloc(0)};};
  const pending=worker.task(task),rejected=assert.rejects(pending,error=>error===worker.controller.signal.reason);
  assert.equal(upstreamStatus().queued,baseline+1);
  worker.stop();
  try {await beforeTimeout(rejected);assert.equal(upstreamStatus().queued,baseline);assert.equal(downloads,0);unchanged();}
  finally {release.resolve();await blocker;await rejected;worker.running=false;}
});

test('worker run releases its writer lease after cancellation and preserves the pending amendment retry',async t=>{
  const {store,worker,task,download,generation,unchanged}=cancellationTask(t,'amendment-aliases'),started=deferred();
  store.putSource(generation,'/plenary-documents/'+otherTarget,'document',{...target,id:'eli/dl/doc/'+otherTarget,identifier:otherTarget},earlier);
  store.updateCycle({initialized:true,amendmentsPreparedVersion:AMENDMENTS_VERSION,amendmentsPreparedDay:'2026-10-16',splitParserVersion:SPLIT_PARSER_VERSION,motionOutcomesDay:'2026-10-16',reportJoinsReady:true,procedureTitlesQueued:true});
  worker.initializeOutside=()=>{};worker.catchUp=()=>false;
  worker[download]=async(_url,{signal}={})=>new Promise((_,reject)=>{signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});started.resolve(signal);});
  const running=worker.run();
  assert.equal(await started.promise,worker.controller.signal);
  worker.stop();await beforeTimeout(running);
  assert.equal(worker.running,false);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM lease').get().n,0);
  const saved=store.db.prepare('SELECT body,done,attempts,error,retry_at FROM amendment_jobs WHERE generation=? AND key=?').get(generation,task.key);
  assert.equal(saved.done,0);assert.equal(saved.attempts,2);assert.equal(saved.error,'Retained retry state');assert.deepEqual(JSON.parse(saved.body),task.body);
  assert.equal(store.source(generation,'amendment:aliases:'+sitting),undefined);
  assert.equal(amendmentsPage(store).total,0);assert.equal(amendmentFailures(store).total,0);
});

test('decision joins use the exact target and amendment URI, preserving collective and split decisions',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[1,2,3,4].map(number=>amendment(number)));
  const split=request([part(1,'Text as a whole without the word: ‘old’'),part(2,'‘old’')]);
  const work=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt}],splitRequests:[split],decisions:[
    decision(1,['eli/dl/doc/'+targetId+'-AM-1','eli/dl/doc/'+targetId+'-AM-2'],'ADOPTED',{number_of_votes_favor:300,number_of_votes_against:200,number_of_votes_abstention:0}),
    decision(2,['eli/dl/doc/'+targetId+'-AM-3',split.created_a_realization_of[0].id],'REJECTED'),
    decision(3,['eli/dl/doc/'+targetId+'-AM-3',split.created_a_realization_of[1].id],'LAPSED',{decision_method:'def/ep-vote-methods/SHOW_HANDS'}),
    decision(4,['eli/dl/doc/'+otherTarget+'-AM-4'],'ADOPTED'),
    decision(5,['eli/dl/doc/'+targetId+'-AM-5'],'ADOPTED',{decision_method:'def/ep-vote-methods/SHOW_HANDS'}),
    decision(6,['eli/dl/doc/'+targetId],'ADOPTED'),
  ]});
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',work,fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const page=amendmentsPage(store,{document:targetId}),byNumber=new Map(page.items.map(item=>[item.number,item]));
  assert.equal(page.total,5);
  for(const number of [1,2]) {
    assert.equal(byNumber.get(number).outcome,'ADOPTED');
    assert.deepEqual(byNumber.get(number).decisions.map(vote=>vote.id),[sitting+'-DEC-1']);
    assert.deepEqual(byNumber.get(number).decisions[0].totals,{for:300,against:200,abstaining:0});
  }
  assert.equal(byNumber.get(3).outcome,'mixed');
  assert.deepEqual(byNumber.get(3).decisions.map(vote=>[vote.partNumber,vote.outcome]),[[1,'REJECTED'],[2,'LAPSED']]);
  assert.deepEqual(byNumber.get(3).decisions.map(vote=>vote.partId),split.created_a_realization_of.map(component=>component.id));
  assert.equal(byNumber.get(3).splitParts.length,2);
  assert(byNumber.get(3).splitParts.every(component=>component.grounding==='not_attempted'));
  assert(byNumber.get(3).gaps.some(gap=>gap.includes('have not been validated')));
  assert.equal(byNumber.get(4).outcome,'unavailable');
  assert.deepEqual(byNumber.get(4).decisions,[]);
  assert(byNumber.get(4).gaps.includes('No explicit amendment outcome is indexed.'));
  assert.equal(byNumber.get(5).originalText,null);
  assert.equal(byNumber.get(5).decisions[0].totals,null);
  assert(byNumber.get(5).gaps.includes('Amendment wording and authorship are unavailable.'));
  assert.deepEqual(byNumber.get(1).procedureIds,['2025-0233']);
  assert.equal(byNumber.get(1).topics[0].basis,'dossier');
  assert.equal(amendmentsPage(store,{document:otherTarget}).total,0);
  assert.equal(amendmentsPage(store,{procedure:'2025-0233'}).total,5);
  assert.equal(amendmentsPage(store,{procedure:'2025-9999'}).total,0);
  assert.equal(amendmentsPage(store,{outcome:'mixed'}).total,1);
  assert.equal(amendmentsPage(store,{limit:1,offset:1}).items[0].number,2);
});

test('split descriptions join on the full canonical URI rather than a shared document and event leaf',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1)]);
  const description=part(1,'‘selected wording’'),decisionPartId=description.id;
  description.id=description.id.replace('/doc/','/event/');
  const work=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt}],splitRequests:[request([description])],decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1',decisionPartId],'ADOPTED')]});
  assert.equal(work.parsedSplits[0].parts[0].status,'parsed');
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',work,fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.decisions[0].partId,decisionPartId);
  assert.deepEqual(item.splitParts,[]);
  assert(item.gaps.includes('A split component has no indexed description.'));
});

test('a refreshed decision replaces its prior split bindings while entirely absent decisions remain retained',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1)]);
  const description=part(1,'‘selected wording’'),documentPartId=description.id,eventPartId=documentPartId.replace('/doc/','/event/');
  const original=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt:earlier}],splitRequests:[request([description])],decisions:[
    decision(1,['eli/dl/doc/'+targetId+'-AM-1',documentPartId],'ADOPTED'),
    decision(2,['eli/dl/doc/'+targetId+'-AM-1'],'REJECTED'),
  ]});
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',original,earlier);
  rebuildAmendmentTarget(worker,generation,targetId);
  let [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.splitParts[0].id,documentPartId);
  assert.equal(item.decisions.find(vote=>vote.id===sitting+'-DEC-1').partId,documentPartId);
  const refreshed={...original,decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1',eventPartId],'LAPSED')],sources:[{url:sourceUrl,fetchedAt}]};
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',refreshed,fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  [item]=amendmentsPage(store,{document:targetId}).items;
  assert.deepEqual(item.splitParts,[]);
  assert.equal(item.decisions.length,2);
  const current=item.decisions.filter(vote=>vote.id===sitting+'-DEC-1');
  assert.equal(current.length,1);assert.equal(current[0].partId,eventPartId);assert.equal(current[0].outcome,'LAPSED');
  assert(!item.decisions.some(vote=>vote.partId===documentPartId));
  assert.equal(item.decisions.find(vote=>vote.id===sitting+'-DEC-2').outcome,'REJECTED');
  assert(item.gaps.includes('A split component has no indexed description.'));
});

test('fresh split parsing takes precedence when a retained absent decision references the same component',t=>{
  for(const previous of [{status:'unresolved',plan:null},{status:'parsed',plan:{type:'text',quote:'Old selection'}}]) {
    const {store,generation}=setup(t),partId=part(1,'unused').id;
    const oldPart={id:partId,number:1,description:'Old description',...previous};
    saveAmendmentRows(store,generation,metadata,[row(1,{decisions:[{id:sitting+'-DEC-2',outcome:'REJECTED',partId}],splitParts:[oldPart],sources:[]})],coverage);
    const freshPart={id:partId,number:1,description:'Fresh description',status:'parsed',plan:{type:'text',quote:'Fresh selection'}};
    saveAmendmentRows(store,generation,metadata,[row(1,{decisions:[{id:sitting+'-DEC-1',outcome:'ADOPTED',partId}],splitParts:[freshPart],sources:[]})],coverage);
    const [item]=amendmentsPage(store,{document:targetId}).items;
    assert.deepEqual(item.decisions.map(vote=>vote.id).sort(),[sitting+'-DEC-1',sitting+'-DEC-2']);
    assert.equal(item.outcome,'mixed');
    assert.deepEqual(item.splitParts,[freshPart]);
    assert(item.retainedComponents.includes('decisions'));
  }
});

test('fresh parsed split descriptions update retained votes even when no current decision attaches the component',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1)]);
  const oldPart=part(1,'Apply unpublished instructions');
  const original=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt:earlier}],splitRequests:[request([oldPart])],decisions:[decision(2,['eli/dl/doc/'+targetId+'-AM-1',oldPart.id],'ADOPTED')]});
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',original,earlier);
  rebuildAmendmentTarget(worker,generation,targetId);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].splitParts[0].status,'unresolved');
  const refreshed=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt}],splitRequests:[request([part(1,'‘Fresh selection’')])],decisions:[]});
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',refreshed,fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.deepEqual(item.decisions.map(vote=>vote.id),[sitting+'-DEC-2']);
  assert.equal(item.outcome,'ADOPTED');
  assert(!item.gaps.includes('No explicit amendment outcome is indexed.'));
  assert.equal(item.splitParts.length,1);assert.equal(item.splitParts[0].id,oldPart.id);
  assert.equal(item.splitParts[0].status,'parsed');assert.equal(item.splitParts[0].description,'‘Fresh selection’');
  assert.equal(item.splitParts[0].plan.quote,'Fresh selection');
  assert.equal(amendmentFailures(store,{status:'unresolved'}).total,0);
});

test('a fresh decision moving between amendment numbers invalidates its old binding even when old wording is retained',t=>{
  for(const missingOldText of [false,true]) {
    const {store,worker,generation}=setup(t);
    seedTarget(store,generation,[amendment(1),amendment(2),amendment(3)]);
    const oldPart=part(1,'‘old selected wording’');
    const original=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt:earlier}],splitRequests:[request([oldPart])],decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1',oldPart.id],'ADOPTED'),decision(2,['eli/dl/doc/'+targetId+'-AM-3'],'REJECTED')]});
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',original,earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    assert.equal(amendmentsPage(store,{document:targetId}).items[0].outcome,'ADOPTED');
    assert.equal(amendmentsPage(store,{document:targetId}).items[0].splitParts[0].id,oldPart.id);
    if(missingOldText)store.putSource(generation,'amendment:list:'+listId,'amendment-list',list([amendment(2),amendment(3)]),fetchedAt);
    const refreshed={...original,decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-2'],'LAPSED')]};
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',refreshed,fetchedAt);
    rebuildAmendmentTarget(worker,generation,targetId);
    const byNumber=new Map(amendmentsPage(store,{document:targetId}).items.map(item=>[item.number,item]));
    assert.equal(byNumber.get(1).proposedText,'Proposal 1');
    assert.equal(byNumber.get(1).outcome,'unavailable');assert.deepEqual(byNumber.get(1).decisions,[]);
    assert.deepEqual(byNumber.get(1).splitParts,[]);
    assert.equal(byNumber.get(2).outcome,'LAPSED');
    assert.deepEqual(byNumber.get(2).decisions.map(vote=>vote.id),[sitting+'-DEC-1']);
    assert.equal(byNumber.get(3).outcome,'REJECTED');
    assert.deepEqual(byNumber.get(3).decisions.map(vote=>vote.id),[sitting+'-DEC-2']);
  }
});

test('a fresh sitting decision moving to another target also rebuilds the previously referenced target',t=>{
  for(const legacyTargetMetadata of [false,true]) {
    const {store,worker,generation}=setup(t);
    seedTarget(store,generation,[amendment(1)]);
    const secondTarget={...target,id:'eli/dl/doc/'+otherTarget,identifier:otherTarget};
    store.putSource(generation,'/plenary-documents/'+otherTarget,'document',secondTarget,earlier);
    const secondListId=otherTarget+'-AM-001-001';
    store.putSource(generation,'amendment:list:'+secondListId,'amendment-list',list([amendment(1,{proposedText:'Other target wording'})],{id:'eli/dl/doc/'+secondListId,identifier:secondListId,targetDocumentId:otherTarget}),earlier);
    const original=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt:earlier}],splitRequests:[],decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1'],'ADOPTED')]});
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',original,earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    rebuildAmendmentTarget(worker,generation,otherTarget);
    if(legacyTargetMetadata) {
      const previous=JSON.parse(store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,targetId).body);
      delete previous.sittingIds;
      store.db.prepare('UPDATE amendment_targets SET body=? WHERE generation=? AND id=?').run(JSON.stringify(previous),generation,targetId);
    }
    const refreshed={...original,decisions:[decision(1,['eli/dl/doc/'+otherTarget+'-AM-1'],'LAPSED')]};
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',refreshed,fetchedAt);
    refreshSittingTargets(worker,generation,sitting,refreshed);
    const [oldItem]=amendmentsPage(store,{document:targetId}).items,[newItem]=amendmentsPage(store,{document:otherTarget}).items;
    assert.equal(oldItem.proposedText,'Proposal 1');
    assert.equal(oldItem.outcome,'unavailable');assert.deepEqual(oldItem.decisions,[]);
    assert.equal(newItem.proposedText,'Other target wording');assert.equal(newItem.outcome,'LAPSED');
    assert.deepEqual(newItem.decisions.map(vote=>vote.id),[sitting+'-DEC-1']);
  }
});

test('exact amendment decisions discover and persist a sitting absent from the target inverse links',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1)]);
  const unlinked={...target,inverse_based_on_a_realization_of:[],inverse_decided_on_a_realization_of:[]};
  store.putSource(generation,'/plenary-documents/'+targetId,'document',unlinked,earlier);
  store.putSource(generation,'/plenary-documents/'+otherTarget,'document',{...unlinked,id:'eli/dl/doc/'+otherTarget,identifier:otherTarget},earlier);
  const fresh=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt}],splitRequests:[],decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1'],'ADOPTED')]});
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',fresh,fetchedAt);
  refreshSittingTargets(worker,generation,sitting,fresh);
  let page=amendmentsPage(store,{document:targetId});
  assert.equal(page.items[0].outcome,'ADOPTED');assert.equal(page.items[0].decisions[0].sittingId,sitting);
  const savedTarget=JSON.parse(store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,targetId).body);
  assert(savedTarget.sittingIds.includes(sitting));
  rebuildAmendmentTarget(worker,generation,targetId);
  page=amendmentsPage(store,{document:targetId});
  assert.equal(page.items[0].outcome,'ADOPTED');
  assert.deepEqual(page.items[0].decisions.map(vote=>vote.id),[sitting+'-DEC-1']);
  assert.equal(store.db.prepare('SELECT 1 FROM amendment_targets WHERE generation=? AND id=?').get(generation,otherTarget),undefined);
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',{...completeSitting(),...fresh,results:completeSitting().results},earlier);
  scheduleAmendments(worker,generation,unlinked,fetchedAt,'/plenary-documents/'+targetId);
  const [queued]=outcomeJobs(store,generation);
  assert.equal(queued.key,motionSourceKey(sitting)+':2026-10-16');
  store.taskProgress(queued,{...JSON.parse(queued.body),offset:1000});
  scheduleAmendments(worker,generation,unlinked,fetchedAt,'/plenary-documents/'+targetId);
  assert.equal(outcomeJobs(store,generation).length,1);
  assert.equal(JSON.parse(outcomeJobs(store,generation)[0].body).offset,1000);
  assert.deepEqual(store.source(generation,'/plenary-documents/'+targetId).work.inverse_based_on_a_realization_of,[]);
});

test('the first local rebuild discovers cached exact amendment decisions without inverse sitting links',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1)]);
  store.putSource(generation,'/plenary-documents/'+targetId,'document',{...target,inverse_based_on_a_realization_of:[],inverse_decided_on_a_realization_of:[]},earlier);
  const cases=[
    [sitting,'eli/dl/doc/'+targetId+'-AM-1',AMENDMENTS_VERSION],
    ['MTG-PL-2026-10-08','eli/dl/event/'+targetId+'-AM-1',AMENDMENTS_VERSION],
    ['MTG-PL-2026-10-09','https://unrelated.example/eli/dl/doc/'+targetId+'-AM-1',AMENDMENTS_VERSION],
    ['MTG-PL-2026-10-10','eli/dl/doc/'+otherTarget+'-AM-1',AMENDMENTS_VERSION],
    ['MTG-PL-2026-10-11','eli/dl/doc/'+targetId+'-AM-1',0],
  ];
  for(const [sittingId,reference,version] of cases) {
    const vote={...decision(1,[reference],sittingId===sitting?'ADOPTED':'REJECTED'),id:'eli/dl/event/'+sittingId+'-DEC-1',activity_date:sittingId.slice(7)};
    store.putSource(generation,motionSourceKey(sittingId),'motion-outcomes',{amendmentVersion:version,splitRequests:[],parsedSplits:[],decisions:[vote],sources:[{url:sourceUrl.replace(sitting,sittingId),fetchedAt}]},fetchedAt);
  }
  rebuildAmendmentTarget(worker,generation,targetId);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.outcome,'ADOPTED');
  assert.deepEqual(item.decisions.map(vote=>[vote.id,vote.sittingId]),[[sitting+'-DEC-1',sitting]]);
  const saved=JSON.parse(store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,targetId).body);
  assert.deepEqual(saved.discoveredSittingIds,[sitting]);assert.deepEqual(saved.sittingIds,[sitting]);
});

test('missing or unrecognised decision relationships retain accepted bindings while an explicit whole-document reference clears them',t=>{
  const cases=[
    ['missing',undefined,true],
    ['empty',[],true],
    ['foreign URI',['https://unrelated.example/eli/dl/doc/'+targetId+'-AM-2'],true],
    ['bare fragment',[targetId+'-AM-2'],true],
    ['split component only',[part(1,'unused').id],true],
    ['explicit whole document',['eli/dl/doc/'+targetId],false],
  ];
  for(const [label,references,retain] of cases) {
    const {store,worker,generation}=setup(t);
    seedTarget(store,generation,[amendment(1)]);
    const original=parseSavedSplits(worker,{sources:[{url:sourceUrl,fetchedAt:earlier}],splitRequests:[],decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1'],'ADOPTED')]});
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',original,earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    const freshDecision=decision(1,references,'REJECTED');
    if(references===undefined)delete freshDecision.decided_on_a_realization_of;
    const refreshed={...original,decisions:[freshDecision]};
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',refreshed,fetchedAt);
    refreshSittingTargets(worker,generation,sitting,refreshed);
    const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
    assert.equal(item.proposedText,'Proposal 1',label);
    assert.equal(item.outcome,retain?'ADOPTED':'unavailable',label);
    assert.equal(item.decisions.length,retain?1:0,label);
    if(retain) {
      assert.equal(item.decisions[0].id,sitting+'-DEC-1',label);
      assert(item.retainedComponents.includes('decisions'),label);
      assert(page.coverage.gaps.some(gap=>gap.includes('retained')),label);
      assert.equal(page.coverage.complete,false,label);
    }
  }
});

test('voting aliases from the exact linked sitting resolve authors on their earlier tabling date',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1,{authors:['Bruno G.','Sérgio G.','Former MEP']})]);
  store.putSource(generation,'amendment:roster:'+tabled,'amendment-roster',{members:[
    {id:'101',givenName:'Bruno',familyName:'Gonçalves'},
    {id:'102',givenName:'Sérgio',familyName:'Gonçalves'},
  ],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+tabled,fetchedAt}]},fetchedAt);
  store.putSource(generation,'amendment:aliases:'+sitting,'amendment-aliases',{aliases:[
    {alias:'Bruno G.',personId:101,sittingDate:'2026-10-07',sourceUrl:'https://www.europarl.europa.eu/official-roll-call.xml',fetchedAt},
    {alias:'Sérgio G.',personId:102,sittingDate:'2026-10-07',sourceUrl:'https://www.europarl.europa.eu/official-roll-call.xml',fetchedAt},
    {alias:'Former MEP',personId:103,sittingDate:'2026-10-07',sourceUrl:'https://www.europarl.europa.eu/official-roll-call.xml',fetchedAt},
  ]},fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.deepEqual(item.authors.map(author=>author.personId),['101','102',null]);
  assert(item.authors.slice(0,2).every(author=>author.method==='official_voting_alias_active_mandate'));
  assert.equal(amendmentsPage(store,{member:'101'}).total,1);
  assert.equal(amendmentsPage(store,{member:'103'}).total,0);
  assert(item.gaps.includes('Some author identities are unresolved.'));
});

test('dated roster pagination keeps its cursor and publishes identities only after a valid terminating page',async t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1,{authors:['Bruno Gonçalves']})]);
  const offsets=[];
  worker.fetchRecord=async(endpoint,params)=>{
    assert.equal(endpoint,'/meps/show-current');assert.equal(params['mandate-date'],tabled);
    offsets.push(params.offset);
    return {fetchedAt,payload:{data:params.offset?[]:[{identifier:'101',givenName:'Bruno',familyName:'Gonçalves'}]}};
  };
  enqueueAmendment(store,generation,'roster','amendment-roster',{date:tabled,offset:0,members:[],sources:[]});
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(store.source(generation,'amendment:roster:'+tabled),undefined);
  assert.equal(nextAmendmentTask(store,generation).body.offset,1);
  await worker.task(nextAmendmentTask(store,generation));
  assert.deepEqual(offsets,[0,1]);
  assert.equal(nextAmendmentTask(store,generation),null);
  const saved=store.source(generation,'amendment:roster:'+tabled);
  assert.equal(saved.work.members[0].id,'101');assert.equal(saved.work.sources.length,2);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].authors[0].personId,'101');
});

test('dated rosters reject duplicate, zero and unsafe identities before accepting a page',async t=>{
  for(const identities of [['101','101'],['0'],['9007199254740993']]) {
    const {store,worker,generation}=setup(t);
    worker.fetchRecord=async()=>({fetchedAt,payload:{data:identities.map(identifier=>({identifier,givenName:'A',familyName:'Member'}))}});
    enqueueAmendment(store,generation,'roster','amendment-roster',{date:tabled,offset:0,members:[],sources:[]});
    await assert.rejects(worker.task(nextAmendmentTask(store,generation)),/invalid|repeated/i,identities.join(','));
    assert.equal(store.source(generation,'amendment:roster:'+tabled),undefined);
    assert.equal(nextAmendmentTask(store,generation).body.offset,0);
  }
});

test('a failed dated roster falls back to exact author profiles and their actual mandate intervals',async t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1,{authors:['Bruno Gonçalves']}),amendment(2,{authors:['Former Member']})]);
  rebuildAmendmentTarget(worker,generation,targetId);
  enqueueAmendment(store,generation,'dated-roster','amendment-roster',{date:tabled,offset:0,members:[],sources:[]},114);
  const failed={...nextAmendmentTask(store,generation),attempts:2};
  assert.equal(failAmendmentTask(worker,failed,Object.assign(new Error('EP roster HTTP 500'),{status:500})),true);
  assert.equal(store.get('amendmentMandateFallback'),true);
  const calls=[];
  worker.fetchRecord=async(endpoint,params)=>{
    calls.push([endpoint,params.offset]);
    if(endpoint==='/meps') {
      assert.equal(params['parliamentary-term'],10);
      return {fetchedAt,payload:{data:params.offset?[]:[{identifier:'101',givenName:'Bruno',familyName:'Gonçalves'},{identifier:'102',givenName:'Former',familyName:'Member'},{identifier:'103',givenName:'Unrelated',familyName:'Person'}]}};
    }
    assert(['/meps/101','/meps/102'].includes(endpoint));
    const id=endpoint.split('/').at(-1),active=id==='101';
    return {fetchedAt,payload:{data:[{identifier:id,givenName:active?'Bruno':'Former',familyName:active?'Gonçalves':'Member',hasMembership:[{role:'def/ep-roles/MEMBER_PARLIAMENT',memberDuring:{startDate:'2024-07-16',...(active?{}:{endDate:'2026-09-01'})}},{role:'def/ep-roles/CHAIR',memberDuring:{startDate:'2026-01-01'}}]}]}};
  };
  assert.equal(nextAmendmentTask(store,generation).kind,'amendment-members');
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(nextAmendmentTask(store,generation).body.offset,3);
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM amendment_jobs WHERE kind='amendment-member'").get().n,2);
  for(let n=0;n<2;n++)await worker.task(nextAmendmentTask(store,generation));
  assert.deepEqual(calls.slice(0,2),[['/meps',0],['/meps',3]]);
  assert(!calls.some(([endpoint])=>endpoint==='/meps/103'));
  const items=amendmentsPage(store,{document:targetId}).items;
  assert.equal(items[0].authors[0].personId,'101');
  assert.equal(items[1].authors[0].personId,null);assert.equal(items[1].authors[0].status,'inactive');
  const evidence=items[0].authors[0].evidence;
  assert(!evidence.some(item=>item.type==='dated_roster'||item.mandateObservedOn));
  const profileEvidence=evidence.find(item=>item.type==='full_name');
  assert.deepEqual(profileEvidence.activeMandate,{start:'2024-07-16',end:null});
  assert.deepEqual(profileEvidence.mandates,[{start:'2024-07-16',end:null}]);
  assert.equal(new URL(profileEvidence.sourceUrl).pathname,'/api/v2/meps/101');
  assert.equal(profileEvidence.fetchedAt,fetchedAt);
  assert.equal(store.source(generation,'amendment:roster:'+tabled),undefined);
});

test('the same amendment number in different lists retains variants and withholds an arbitrary author or wording',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1,{authors:['Bruno Gonçalves'],proposedText:'First wording'})]);
  rebuildAmendmentTarget(worker,generation,targetId);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].proposedText,'First wording');
  const revisionListId=targetId+'-AM-001-001';
  const revision=list([amendment(1,{authors:['Sérgio Gonçalves'],proposedText:'Second wording'})],{id:'eli/dl/doc/'+revisionListId,identifier:revisionListId});
  revision.extraction.sourceUrl='https://data.europarl.europa.eu/distribution/example/revision_en.docx';
  store.putSource(generation,'amendment:list:'+revisionListId,'amendment-list',revision,fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
  assert.equal(page.total,1);assert.equal(item.conflicted,true);
  assert.equal(item.originalText,null);assert.equal(item.proposedText,null);assert.equal(item.targetLabel,null);
  assert.equal(item.listId,null);assert.equal(item.language,null);assert.deepEqual(item.authors,[]);
  assert.equal(item.variants.length,2);
  assert.deepEqual(item.variants.map(variant=>variant.proposedText).sort(),['First wording','Second wording']);
  assert.deepEqual(item.variants.map(variant=>variant.listId).sort(),[listId,revisionListId].sort());
  assert.deepEqual(item.variants.flatMap(variant=>variant.authors.map(author=>author.name)).sort(),['Bruno Gonçalves','Sérgio Gonçalves']);
  assert.equal(page.coverage.complete,false);
  assert(page.coverage.gaps.some(gap=>/variant|conflict/i.test(gap)));
});

test('lists absent from current target relationships retain labelled evidence without establishing variant precedence',t=>{
  const {store,worker,generation}=setup(t),removedId=targetId+'-AM-001-002';
  const current=list([amendment(1,{proposedText:'Current wording'})],{foresees_change_of:[target.id]});
  const removed=list([amendment(1,{proposedText:'Obsolete competing wording'}),amendment(2,{proposedText:'Historical second amendment'})],{id:'eli/dl/doc/'+removedId,identifier:removedId,foresees_change_of:[target.id]});
  removed.extraction.sourceUrl='https://data.europarl.europa.eu/distribution/example/removed_list_en.docx';
  store.putSource(generation,'/plenary-documents/'+targetId,'document',{...target,inverse_foresees_change_of:[current,removed]},earlier);
  store.putSource(generation,'amendment:list:'+listId,'amendment-list',current,earlier);
  store.putSource(generation,'amendment:list:'+removedId,'amendment-list',removed,earlier);
  rebuildAmendmentTarget(worker,generation,targetId);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].conflicted,true);
  const refreshed=list([amendment(1,{proposedText:'Current refreshed wording'})],{foresees_change_of:[target.id]});
  store.putSource(generation,'/plenary-documents/'+targetId,'document',{...target,inverse_foresees_change_of:[refreshed]},fetchedAt);
  store.putSource(generation,'amendment:list:'+listId,'amendment-list',refreshed,fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const page=amendmentsPage(store,{document:targetId}),byNumber=new Map(page.items.map(item=>[item.number,item]));
  assert.equal(byNumber.get(1).proposedText,null);assert.equal(byNumber.get(1).originalText,null);
  assert.equal(byNumber.get(1).conflicted,true);
  assert.deepEqual(byNumber.get(1).variants.map(variant=>variant.proposedText).sort(),['Current refreshed wording','Obsolete competing wording']);
  assert(byNumber.get(1).sources.some(source=>source.url===removed.extraction.sourceUrl));
  assert.equal(byNumber.get(2).proposedText,'Historical second amendment');
  assert(byNumber.get(2).gaps.some(gap=>/relationship|no longer.*publish|not.*current|absent.*current|not.*linked/i.test(gap)));
  assert(byNumber.get(2).sources.some(source=>source.url===removed.extraction.sourceUrl));
  assert.equal(page.coverage.complete,false);
  assert(page.coverage.gaps.some(gap=>/relationship|no longer.*publish|not.*current|absent.*current|not.*linked/i.test(gap)));
});

test('missing, empty and partial list relationships preserve cached evidence with explicit incomplete coverage',t=>{
  for(const relationshipState of ['missing','empty','subset'])for(const conflicting of [false,true]) {
    const {store,worker,generation}=setup(t),secondId=targetId+'-AM-001-002';
    const first=list([amendment(1,{authors:['Alex Common'],proposedText:'First wording'})],{foresees_change_of:[target.id]});
    const secondAmendments=[...(conflicting?[amendment(1,{authors:['Alex Common'],proposedText:'Conflicting wording'})]:[]),amendment(2,{authors:['Alex Common'],proposedText:'Second wording'})];
    const second=list(secondAmendments,{id:'eli/dl/doc/'+secondId,identifier:secondId,foresees_change_of:[target.id]});
    second.extraction.sourceUrl='https://data.europarl.europa.eu/distribution/example/second_relationship_en.docx';
    const original={...target,inverse_foresees_change_of:[first,second]};
    store.putSource(generation,'/plenary-documents/'+targetId,'document',original,earlier);
    store.putSource(generation,'amendment:list:'+listId,'amendment-list',first,earlier);
    store.putSource(generation,'amendment:list:'+secondId,'amendment-list',second,earlier);
    store.putSource(generation,'amendment:roster:'+tabled,'amendment-roster',{members:[{id:'101',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+tabled,fetchedAt}]},fetchedAt);
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',{...completeSitting(),sources:[{url:sourceUrl.replace('/vote-results?','/decisions?'),fetchedAt}],parsedSplits:[],decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1','eli/dl/doc/'+targetId+'-AM-2'],'ADOPTED')]},fetchedAt);
    rebuildAmendmentTarget(worker,generation,targetId);
    assert.equal(amendmentsPage(store,{document:targetId}).coverage.complete,!conflicting);
    const fresh={...original};
    if(relationshipState==='missing')delete fresh.inverse_foresees_change_of;
    else fresh.inverse_foresees_change_of=relationshipState==='empty'?[]:[first];
    store.putSource(generation,'/plenary-documents/'+targetId,'document',fresh,fetchedAt);
    rebuildAmendmentTarget(worker,generation,targetId);
    const page=amendmentsPage(store,{document:targetId}),byNumber=new Map(page.items.map(item=>[item.number,item]));
    assert.equal(page.total,2);assert.equal(page.coverage.complete,false,relationshipState);
    assert(page.coverage.gaps.some(gap=>/relationship/i.test(gap)&&/unverified|not verified|unavailable|absent|missing/i.test(gap)),relationshipState);
    assert.equal(byNumber.get(2).proposedText,'Second wording');
    assert.equal(byNumber.get(2).listRelationship,relationshipState==='missing'?'unverified':'absent-current-relationship');
    assert(byNumber.get(2).gaps.some(gap=>/relationship/i.test(gap)),relationshipState);
    assert(byNumber.get(2).sources.some(source=>source.url===second.extraction.sourceUrl));
    if(conflicting) {
      assert.equal(byNumber.get(1).conflicted,true);assert.equal(byNumber.get(1).proposedText,null);
      assert.deepEqual(byNumber.get(1).variants.map(variant=>variant.proposedText).sort(),['Conflicting wording','First wording']);
    } else assert.equal(byNumber.get(1).proposedText,'First wording');
  }
});

test('split failures remain durable across publication and pruning, and a parser upgrade resolves the saved case',async t=>{
  const {store,worker,generation}=setup(t);
  const split=request([part(1,'‘old’')]);
  const parsed=parseSplitRequest(split,{sourceUrl,fetchedAt:earlier});
  saveAmendmentRows(store,generation,metadata,[row(1)],coverage);
  recordSplitResults(store,{...parsed,sourceUrl,fetchedAt:earlier,failures:[{partId:parsed.parts[0].id,description:'‘old’',language:'en',code:'legacy_unsupported',message:'An earlier grammar did not recognise this selector.',sourceUrl,fetchedAt:earlier}]});
  const savedWork={splitRequests:[split],splitParserVersion:SPLIT_PARSER_VERSION-1,sources:[{url:sourceUrl,fetchedAt:earlier}],decisions:[]};
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',savedWork,earlier);
  store.publish(generation);
  for(let n=0;n<2;n++) {const cycle=store.beginCycle();store.publish(cycle.generation);}
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendments WHERE generation=?').get(generation).n,0);
  let failures=amendmentFailures(store,{status:'unresolved'});
  assert.equal(failures.total,1);assert.equal(failures.items[0].count,1);
  assert.equal(failures.items[0].firstOccurrence,earlier);
  const cycle=store.beginCycle();
  prepareAmendments(worker,cycle);
  const reparse=nextAmendmentTask(store,cycle.generation);
  assert.equal(reparse.kind,'amendment-reparse');
  await worker.task(reparse);
  failures=amendmentFailures(store,{status:'resolved'});
  assert.equal(failures.total,1);assert.equal(failures.unresolved,0);
  assert.equal(failures.items[0].parserVersion,SPLIT_PARSER_VERSION);
  assert.equal(failures.items[0].firstOccurrence,earlier);
  assert.equal(failures.items[0].count,1);
  assert.equal(failures.items[0].sourceUrl,sourceUrl);
  assert(failures.items[0].resolvedAt);
  assert.equal(store.source(cycle.generation,motionSourceKey(sitting)).work.parsedSplits[0].parts[0].status,'parsed');
  const broken=request([part(1,'Unpublished voting instructions')]);broken.id+='-OTHER';
  parseSavedSplits(worker,{splitRequests:[broken],sources:[{url:sourceUrl,fetchedAt}]});
  assert.equal(amendmentFailures(store,{status:'resolved'}).total,1);
  assert.equal(amendmentFailures(store,{status:'unresolved'}).total,1);
  assert.equal(amendmentFailures(store,{limit:1}).items.length,1);
  assert.equal(amendmentFailures(store).summary.total,2);
  const reader=new ActivityStore(path.dirname(store.filename));
  try {assert.equal(amendmentFailures(reader).total,2);}finally {reader.close();}
});

test('partial amendment overlays reparse absent retained requests before adopting the current split parser version',t=>{
  for(const nestedOverlay of [false,true]) {
    const {store,worker}=setup(t),oldPage={url:sourceUrl+'&offset=50',fetchedAt:earlier},freshPage={url:sourceUrl+'&offset=0',fetchedAt};
    const retained={...request([part(1,'‘Retained older selector’')]),source:oldPage};
    const parsed=parseSplitRequest(retained,{sourceUrl:oldPage.url,fetchedAt:earlier});
    const legacy={...parsed,source:oldPage,sourceUrl:oldPage.url,fetchedAt:earlier,sourceCandidates:[],provenance:'exact',parts:parsed.parts.map(part=>({...part,status:'unresolved',plan:null,source:oldPage})),failures:[{partId:parsed.parts[0].id,description:parsed.parts[0].description,rawDescription:parsed.parts[0].rawDescription,language:'en',code:'legacy_unsupported',message:'The previous grammar did not recognise this selector.'}]};
    recordSplitResults(store,legacy);
    const prior={splitRequests:[retained],parsedSplits:[legacy],splitParserVersion:'1',decisions:[],sources:[{url:sourceUrl+'&offset=0',fetchedAt:earlier},oldPage]};
    const freshRequest={...request([part(1,'Unsupported fresh voting instructions')]),id:retained.id.replace('-SPLIT-1','-SPLIT-2'),source:freshPage};
    freshRequest.created_a_realization_of[0].id=freshRequest.created_a_realization_of[0].id.replace('-SPLIT-1','-SPLIT-2');
    const priorWork=nestedOverlay?{...completeSitting(),amendmentEvidence:prior}:prior;
    const result=parseSavedSplits(worker,{splitRequests:[freshRequest],decisions:[],sources:[freshPage],truncated:true},{priorWork});
    const evidence=result.amendmentEvidence;
    assert.equal(evidence.splitParserVersion,SPLIT_PARSER_VERSION);assert.equal(evidence.parsedSplits.length,2);
    const reparsed=evidence.parsedSplits.find(split=>split.requestId===retained.id);
    assert.equal(reparsed.parts[0].status,'parsed');assert.deepEqual(reparsed.parts[0].plan,{type:'text',quote:'Retained older selector',grounding:'not_attempted',selectionDomain:'text'});
    assert.deepEqual(reparsed.source,oldPage);assert.deepEqual(reparsed.parts[0].source,oldPage);assert.equal(reparsed.provenance,'exact');
    const resolved=amendmentFailures(store,{status:'resolved'}).items;
    assert.equal(resolved.length,1);assert.equal(resolved[0].requestId,retained.id);assert.equal(resolved[0].parserVersion,SPLIT_PARSER_VERSION);
    assert.equal(resolved[0].firstOccurrence,earlier);assert.equal(resolved[0].count,1);assert.deepEqual(resolved[0].source,oldPage);
    const freshFailure=amendmentFailures(store,{status:'unresolved'}).items;
    assert.equal(freshFailure.length,1);assert.equal(freshFailure[0].requestId,freshRequest.id);assert.equal(freshFailure[0].count,1);
    assert.deepEqual(freshFailure[0].source,freshPage);
  }
});

test('request-level split parse failures are retained even when the request has no components',t=>{
  const {store,worker}=setup(t);
  const split=request([]);
  const result=parseSavedSplits(worker,{splitRequests:[split],sources:[{url:sourceUrl,fetchedAt}]});
  assert.equal(result.parsedSplits[0].failures[0].code,'missing_parts');
  const failures=amendmentFailures(store,{status:'unresolved'});
  assert.equal(failures.total,1);
  assert.equal(failures.items[0].requestId,split.id);
  assert.equal(failures.items[0].code,'missing_parts');
  assert.equal(failures.items[0].sourceUrl,sourceUrl);
  parseSavedSplits(worker,{splitRequests:[request([part(1,'‘now published’')])],sources:[{url:sourceUrl,fetchedAt}]});
  assert.equal(amendmentFailures(store,{status:'unresolved'}).total,0);
  assert.equal(amendmentFailures(store,{status:'resolved'}).total,1);
});

test('missing component IDs retain distinct durable literals rather than overwriting each other or request-level failures',t=>{
  const {store,worker}=setup(t);
  const first=part(1,'‘First literal without an ID’'),second=part(2,'‘Second literal without an ID’');
  delete first.id;delete second.id;
  const malformed=request([first,second]);
  parseSavedSplits(worker,{splitRequests:[malformed],sources:[{url:sourceUrl,fetchedAt:earlier}]});
  let failures=amendmentFailures(store,{status:'unresolved'}).items;
  assert.equal(failures.length,2);assert.equal(new Set(failures.map(failure=>failure.registryPartKey)).size,2);
  assert(failures.every(failure=>failure.code==='missing_part_id'&&failure.partId===null&&failure.originalPartId===null&&failure.recordKind==='component'));
  assert.deepEqual(failures.map(failure=>failure.rawDescription).sort(),[first.expressionContent.en,second.expressionContent.en].sort());
  const identities=failures.map(failure=>failure.registryPartKey).sort();
  parseSavedSplits(worker,{splitRequests:[malformed],sources:[{url:sourceUrl,fetchedAt}]});
  failures=amendmentFailures(store,{status:'unresolved'}).items;
  assert.deepEqual(failures.map(failure=>failure.registryPartKey).sort(),identities);
  assert(failures.every(failure=>failure.count===2&&failure.firstOccurrence===earlier));
  parseSavedSplits(worker,{splitRequests:[request([])],sources:[{url:sourceUrl,fetchedAt}]});
  failures=amendmentFailures(store,{status:'all'}).items;
  assert.equal(failures.length,3);assert.equal(new Set(failures.map(failure=>failure.registryPartKey)).size,3);
  assert.equal(failures.filter(failure=>failure.code==='missing_parts').length,1);
  assert.equal(failures.filter(failure=>failure.code==='missing_part_id').length,2);
  assert.equal(failures.find(failure=>failure.recordKind==='request').registryPartKey,'__request__');
  assert(failures.every(failure=>failure.originalPartId===null));
});

test('paginated motion ingestion preserves the exact split request page through plans, serving parts and durable failures',async t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1)]);
  const firstAt='2026-10-16T16:58:00.000Z',secondAt='2026-10-16T16:59:00.000Z';
  const split=request([part(1,'‘A selected clause’'),part(2,'Apply unpublished instructions')]);
  const resultIds=Array.from({length:51},(_,index)=>'eli/dl/event/'+sitting+'-VOT-ITM-'+(100+index));
  const decisions=[decision(1,['eli/dl/doc/'+targetId+'-AM-1',split.created_a_realization_of[0].id],'ADOPTED'),decision(2,['eli/dl/doc/'+targetId+'-AM-1',split.created_a_realization_of[1].id],'REJECTED')].map(vote=>({...vote,had_activity_type:'def/ep-activities/PLENARY_OUTCOME'}));
  const results=resultIds.map((id,index)=>({id,had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',activity_date:'2026-10-07',based_on_a_realization_of:[target.id],consists_of:index===0?decisions.map(vote=>vote.id):[],inverse_consists_of:index===0?[{id:'eli/dl/event/'+sitting,consists_of:resultIds}]:[]}));
  const calls=[];
  worker.fetchRecord=async(endpoint,params)=>{
    calls.push([endpoint,params.offset]);
    if(endpoint.endsWith('/vote-results')) {
      assert([0,50].includes(params.offset));
      return {fetchedAt:params.offset===0?firstAt:secondAt,payload:{data:params.offset===0?results.slice(0,50):[results[50],split]}};
    }
    assert.equal(endpoint,'/meetings/'+sitting+'/decisions');assert.equal(params['filter-output'],'voters');
    return {fetchedAt,payload:{data:decisions}};
  };
  store.enqueue(generation,'paginated-sitting','motion-outcomes',{sittingId:sitting,stage:'results',offset:0,results:[],decisions:[],splits:[],sources:[]},113);
  await worker.task(store.nextTask(generation));
  assert.equal(store.nextTask(generation).body.offset,50);
  await worker.task(store.nextTask(generation));
  assert.equal(store.nextTask(generation).body.stage,'decisions');
  await worker.task(store.nextTask(generation));
  assert.deepEqual(calls,[['/meetings/'+sitting+'/vote-results',0],['/meetings/'+sitting+'/vote-results',50],['/meetings/'+sitting+'/decisions',0]]);
  const saved=store.source(generation,motionSourceKey(sitting)).work;
  const page=saved.sources.find(source=>source.url.includes('/vote-results?')&&new URL(source.url).searchParams.get('offset')==='50');
  const expected={url:page.url,fetchedAt:secondAt};
  assert.equal(saved.truncated,false);assert.equal(saved.results.length,51);
  assert.deepEqual(saved.splitRequests[0].source,expected);
  assert.deepEqual(saved.parsedSplits[0].source,expected);
  assert(saved.parsedSplits[0].parts.every(component=>JSON.stringify(component.source)===JSON.stringify(expected)));
  const failure=amendmentFailures(store,{status:'unresolved'}).items.find(item=>item.partId===split.created_a_realization_of[1].id);
  assert.equal(failure.sourceUrl,page.url);assert.equal(failure.fetchedAt,secondAt);
  assert.deepEqual(failure.source,expected);assert.deepEqual(failure.sourceCandidates,[]);assert.equal(failure.provenance,'exact');
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.splitParts.length,2);
  assert(item.splitParts.every(component=>JSON.stringify(component.source)===JSON.stringify(expected)));
});

test('legacy multi-page split requests expose unknown provenance and candidate pages instead of choosing the first page',t=>{
  const {store,worker}=setup(t);
  const pages=[{url:sourceUrl+'&offset=0',fetchedAt:earlier},{url:sourceUrl+'&offset=50',fetchedAt}];
  const split=request([part(1,'‘A selected clause’'),part(2,'Apply unpublished instructions')]);
  const parsed=parseSavedSplits(worker,{splitRequests:[split],sources:[...pages,{url:sourceUrl.replace('/vote-results?','/decisions?'),fetchedAt}]});
  const [result]=parsed.parsedSplits;
  assert.equal(result.source,null);assert.equal(result.provenance,'unavailable');assert.deepEqual(result.sourceCandidates,pages);
  assert(result.parts.every(component=>component.source===null));
  const failure=amendmentFailures(store,{status:'unresolved'}).items[0];
  assert.equal(failure.source,null);assert.equal(failure.sourceUrl,null);assert.equal(failure.fetchedAt,null);
  assert.equal(failure.provenance,'unavailable');assert.deepEqual(failure.sourceCandidates,pages);
  const single={...split,id:split.id+'-SINGLE'};
  const [one]=parseSavedSplits(worker,{splitRequests:[single],sources:[pages[0]]}).parsedSplits;
  assert.deepEqual(one.source,pages[0]);assert.equal(one.provenance,'single-page');
});

test('legacy single-page provenance survives retained split and decision chains while fresh node sources stay exact',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1),amendment(2)]);
  const oldResults={url:sourceUrl+'&offset=0',fetchedAt:earlier},oldDecisions={url:sourceUrl.replace('/vote-results?','/decisions?')+'&offset=0',fetchedAt:earlier};
  const freshResults={url:sourceUrl+'&offset=50',fetchedAt},freshDecisions={url:sourceUrl.replace('/vote-results?','/decisions?')+'&offset=50',fetchedAt};
  const oldRequest=request([part(1,'‘Legacy selected clause’'),part(2,'Unsupported legacy instructions')]);
  const legacy=parseSavedSplits(worker,{...completeSitting(),splitRequests:[oldRequest],sources:[oldResults,oldDecisions],decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1',oldRequest.created_a_realization_of[0].id],'ADOPTED')]});
  assert.equal(legacy.parsedSplits[0].provenance,'single-page');
  const freshRequest={...request([part(1,'‘Fresh selected clause’')]),id:oldRequest.id.replace('-SPLIT-1','-SPLIT-2'),source:freshResults};
  freshRequest.created_a_realization_of[0].id=freshRequest.created_a_realization_of[0].id.replace('-SPLIT-1','-SPLIT-2');
  const fresh={...completeSitting(),splitRequests:[freshRequest],sources:[freshResults,freshDecisions],truncated:true,decisions:[decision(2,['eli/dl/doc/'+targetId+'-AM-2',freshRequest.created_a_realization_of[0].id],'REJECTED',{source:freshDecisions})]};
  const retained=parseSavedSplits(worker,fresh,{priorWork:legacy});
  const inferredRequest=retained.amendmentEvidence.splitRequests.find(split=>split.id===oldRequest.id);
  assert.deepEqual(inferredRequest.source,oldResults);assert.equal(inferredRequest.provenance,'single-page');
  const reparsed=parseSavedSplits(worker,retained.amendmentEvidence);
  const chained=parseSavedSplits(worker,{...completeSitting(),splitRequests:[],decisions:[],sources:[],truncated:true},{priorWork:reparsed});
  const oldParsed=chained.amendmentEvidence.parsedSplits.find(split=>split.requestId===oldRequest.id);
  assert.deepEqual(oldParsed.source,oldResults);assert.equal(oldParsed.provenance,'single-page');
  assert(oldParsed.parts.every(component=>component.provenance==='single-page'));
  const failure=amendmentFailures(store,{status:'unresolved'}).items[0];
  assert.deepEqual(failure.source,oldResults);assert.equal(failure.provenance,'single-page');
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',chained,fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const items=new Map(amendmentsPage(store,{document:targetId}).items.map(item=>[item.number,item]));
  const oldVote=items.get(1).decisions[0],freshVote=items.get(2).decisions[0];
  assert.deepEqual(oldVote.source,oldDecisions);assert.equal(oldVote.provenance,'single-page');
  assert.equal(items.get(1).splitParts[0].provenance,'single-page');
  assert.deepEqual(freshVote.source,freshDecisions);assert.equal(freshVote.provenance,'exact');
  assert.deepEqual(items.get(2).splitParts[0].source,freshResults);assert.equal(items.get(2).splitParts[0].provenance,'exact');
});

test('paginated decisions retain the exact later page and retrieval time in the serving amendment decision',async t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1)]);
  const firstAt='2026-10-16T16:58:00.000Z',laterAt='2026-10-16T16:59:00.000Z';
  const decisions=Array.from({length:51},(_,index)=>({...decision(1000+index,['eli/dl/doc/'+(index===50?targetId+'-AM-1':otherTarget+'-AM-'+(index+1))],'ADOPTED'),had_activity_type:'def/ep-activities/PLENARY_OUTCOME'}));
  const result={id:'eli/dl/event/'+sitting+'-VOT-ITM-123',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',activity_date:'2026-10-07',based_on_a_realization_of:[target.id],consists_of:decisions.map(vote=>vote.id),inverse_consists_of:[{id:'eli/dl/event/'+sitting,consists_of:['eli/dl/event/'+sitting+'-VOT-ITM-123']}]};
  const calls=[];
  worker.fetchRecord=async(endpoint,params)=>{
    calls.push([endpoint,params.offset]);
    if(endpoint.endsWith('/vote-results'))return {fetchedAt:earlier,payload:{data:[result]}};
    assert.equal(endpoint,'/meetings/'+sitting+'/decisions');
    return {fetchedAt:params.offset===0?firstAt:laterAt,payload:{data:params.offset===0?decisions.slice(0,50):decisions.slice(50)}};
  };
  store.enqueue(generation,'decision-pages','motion-outcomes',{sittingId:sitting,stage:'results',offset:0,results:[],decisions:[],splits:[],sources:[]},113);
  await worker.task(store.nextTask(generation));
  await worker.task(store.nextTask(generation));
  assert.equal(store.nextTask(generation).body.offset,50);
  await worker.task(store.nextTask(generation));
  assert.deepEqual(calls,[['/meetings/'+sitting+'/vote-results',0],['/meetings/'+sitting+'/decisions',0],['/meetings/'+sitting+'/decisions',50]]);
  const saved=store.source(generation,motionSourceKey(sitting)).work;
  assert.equal(saved.truncated,false);assert.equal(saved.decisions.length,51);
  const later=saved.sources.find(source=>source.url.includes('/decisions?')&&new URL(source.url).searchParams.get('offset')==='50');
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.decisions.length,1);assert.equal(item.decisions[0].id,sitting+'-DEC-1050');
  assert.equal(item.decisions[0].source.url,later.url);assert.equal(item.decisions[0].source.fetchedAt,laterAt);
  assert.equal(item.decisions[0].provenance,'exact');assert.deepEqual(item.decisions[0].sourceCandidates,[]);
});

test('legacy multi-page decision caches expose candidate pages with an unavailable exact source',t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1)]);
  const pages=[{url:sourceUrl.replace('/vote-results?','/decisions?')+'&offset=0',fetchedAt:earlier},{url:sourceUrl.replace('/vote-results?','/decisions?')+'&offset=50',fetchedAt}];
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',{...completeSitting(),parsedSplits:[],sources:pages,decisions:[decision(1,['eli/dl/doc/'+targetId+'-AM-1'],'ADOPTED')]},fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const [item]=amendmentsPage(store,{document:targetId}).items,[vote]=item.decisions;
  assert.equal(vote.outcome,'ADOPTED');assert.equal(vote.source,null);
  assert.equal(vote.provenance,'unavailable');assert.deepEqual(vote.sourceCandidates,pages);
});

test('partial main-motion refreshes retain the accepted core graph while applying independently observed amendment corrections and failures',async t=>{
  const scenarios=[
    ['corrected',['eli/dl/doc/'+targetId+'-AM-2']],
    ['empty',[]],
    ['foreign',['https://unrelated.example/eli/dl/doc/'+targetId+'-AM-2']],
    ['unknown',[targetId+'-AM-2']],
    ['missing',undefined],
    ['absent',null],
  ];
  for(const [mode,references] of scenarios) {
    const {store,worker,generation}=setup(t);
    seedTarget(store,generation,[amendment(1),amendment(2),amendment(3)]);
    const oldDecisionSource={url:sourceUrl.replace('/vote-results?','/decisions?')+'&offset=0',fetchedAt:earlier};
    const oldDecisions=[decision(1,['eli/dl/doc/'+targetId+'-AM-1'],'ADOPTED',{source:oldDecisionSource}),decision(2,['eli/dl/doc/'+targetId+'-AM-3'],'LAPSED',{source:oldDecisionSource})];
    const acceptedResults=[{id:'eli/dl/event/'+sitting+'-VOT-ITM-123',consists_of:[oldDecisions[0].id],sittingResultIds:[]},{id:'eli/dl/event/'+sitting+'-VOT-ITM-999',consists_of:[oldDecisions[1].id],sittingResultIds:[]}];
    const accepted={...completeSitting(),results:acceptedResults,decisions:oldDecisions,parsedSplits:[],sources:[{url:sourceUrl+'&offset=0',fetchedAt:earlier},oldDecisionSource]};
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',accepted,earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    const malformed=request([{...part(1,'‘Fresh observation in a partial graph’'),id:'eli/dl/doc/'+sitting+'-VOT-ITM-123-SPLIT-77-1'}]);delete malformed.id;
    const freshDecision=decision(1,references,'REJECTED',{had_activity_type:'def/ep-activities/PLENARY_OUTCOME'});
    if(mode==='missing')delete freshDecision.decided_on_a_realization_of;
    const freshResult={...acceptedResults[0],had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',activity_date:'2026-10-07',inverse_consists_of:[{id:'eli/dl/event/'+sitting,consists_of:[acceptedResults[0].id]}]};
    worker.fetchRecord=async endpoint=>({fetchedAt,payload:{data:endpoint.endsWith('/vote-results')?[freshResult,malformed]:mode==='absent'?[]:[freshDecision]}});
    store.enqueue(generation,'partial-amendment-observation','motion-outcomes',{sittingId:sitting,stage:'results',offset:0,results:[],decisions:[],splits:[],sources:[]},113);
    await worker.task(store.nextTask(generation));await worker.task(store.nextTask(generation));
    const saved=store.source(generation,motionSourceKey(sitting));
    assert.deepEqual(saved.work.results,acceptedResults,mode);assert.deepEqual(saved.work.decisions,oldDecisions,mode);
    assert.equal(saved.fetchedAt,earlier);assert(saved.work.lastRefreshFailure,mode);
    const failure=amendmentFailures(store,{status:'unresolved'}).items[0];
    assert(failure,'The fresh malformed split must be recorded despite retaining the main-motion graph.');
    assert.equal(failure.code,'missing_request_id');assert.equal(failure.fetchedAt,fetchedAt);
    assert.equal(new URL(failure.source.url).pathname,'/api/v2/meetings/'+sitting+'/vote-results');
    assert.equal(failure.provenance,'exact');
    for(let rebuild=0;rebuild<2;rebuild++) {
      const page=amendmentsPage(store,{document:targetId}),items=new Map(page.items.map(item=>[item.number,item]));
      assert.equal(page.coverage.complete,false);
      assert.equal(items.get(3).outcome,'LAPSED');assert.deepEqual(items.get(3).decisions.map(vote=>vote.id),[sitting+'-DEC-2']);
      if(mode==='corrected') {
        assert.equal(items.get(1).outcome,'unavailable');assert.deepEqual(items.get(1).decisions,[]);
        assert.equal(items.get(2).outcome,'REJECTED');assert.equal(items.get(2).decisions[0].id,sitting+'-DEC-1');
        assert.equal(items.get(2).decisions[0].source.fetchedAt,fetchedAt);assert.equal(items.get(2).decisions[0].provenance,'exact');
        assert.equal(new URL(items.get(2).decisions[0].source.url).pathname,'/api/v2/meetings/'+sitting+'/decisions');
      } else {
        assert.equal(items.get(1).outcome,'ADOPTED',mode);assert.equal(items.get(1).decisions[0].source.fetchedAt,earlier);
        assert.equal(items.get(2).outcome,'unavailable');
        assert(items.get(1).gaps.includes(mode==='absent'?'An amendment decision is retained because it was absent from the latest source graph.':'A refreshed decision has unavailable amendment references; its accepted binding is retained.'),mode);
      }
      rebuildAmendmentTarget(worker,generation,targetId);
    }
  }
});

test('actual split ingestion preserves distinct missing-request observations and excludes explicit foreign IDs',async t=>{
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1)]);
  const firstAt='2026-10-16T16:58:00.000Z',laterAt='2026-10-16T16:59:00.000Z';
  const firstPart=part(1,'‘First request without an ID’'),secondPart={...part(1,'‘Second request without an ID’'),id:firstPart.id.replace('-SPLIT-1-','-SPLIT-2-')};
  const first=request([firstPart]),second=request([secondPart]),empty=request([]);delete first.id;delete second.id;delete empty.id;
  const foreign={...request([part(1,'‘Foreign host must be excluded’')]),id:'https://unrelated.example/eli/dl/event/'+sitting+'-VOT-ITM-123-SPLIT-99'};
  const wrongNamespace={...request([part(1,'‘Foreign namespace must be excluded’')]),id:'eli/dl/doc/'+sitting+'-VOT-ITM-123-SPLIT-98'};
  const resultIds=Array.from({length:51},(_,index)=>'eli/dl/event/'+sitting+'-VOT-ITM-'+(100+index));
  const vote={...decision(1,['eli/dl/doc/'+targetId+'-AM-1',firstPart.id],'ADOPTED'),had_activity_type:'def/ep-activities/PLENARY_OUTCOME'};
  const results=resultIds.map((id,index)=>({id,had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',activity_date:'2026-10-07',consists_of:index===0?[vote.id]:[],inverse_consists_of:index===0?[{id:'eli/dl/event/'+sitting,consists_of:resultIds}]:[]}));
  worker.fetchRecord=async(endpoint,params)=>endpoint.endsWith('/vote-results')?{fetchedAt:params.offset===0?firstAt:laterAt,payload:{data:params.offset===0?[...results.slice(0,50),first,empty,structuredClone(empty),foreign]:[results[50],second,wrongNamespace]}}:{fetchedAt,payload:{data:[vote]}};
  store.enqueue(generation,'missing-request-pages','motion-outcomes',{sittingId:sitting,stage:'results',offset:0,results:[],decisions:[],splits:[],sources:[]},113);
  for(let page=0;page<3;page++)await worker.task(store.nextTask(generation));
  const saved=store.source(generation,motionSourceKey(sitting)).work;
  assert.equal(saved.splitRequests.length,4);assert.equal(saved.parsedSplits.length,4);
  assert(saved.splitRequests.every(split=>split.id==null));
  assert.equal(new Set(saved.splitRequests.map(split=>split.observationKey)).size,4);
  assert.deepEqual(saved.splitRequests.map(split=>new URL(split.source.url).searchParams.get('offset')).sort(),['0','0','0','50']);
  const failures=amendmentFailures(store,{status:'unresolved'}).items;
  assert.equal(failures.length,4);assert(failures.every(failure=>failure.requestId===null));
  assert.equal(failures.filter(failure=>failure.code==='missing_parts').length,2);
  assert.deepEqual(failures.filter(failure=>failure.code==='missing_request_id').map(failure=>failure.rawDescription).sort(),[firstPart.expressionContent.en,secondPart.expressionContent.en].sort());
  assert.deepEqual(failures.map(failure=>failure.fetchedAt).sort(),[firstAt,firstAt,firstAt,laterAt].sort());
  assert(failures.every(failure=>failure.provenance==='exact'&&failure.sourceUrl===failure.source.url));
  assert.equal(new Set(failures.map(failure=>failure.registryRequestKey)).size,4);
  assert.equal(store.db.prepare('SELECT COUNT(DISTINCT request_id) AS n FROM amendment_split_failures').get().n,4);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.splitParts.length,1);assert.equal(item.splitParts[0].id,firstPart.id);
  assert.equal(item.splitParts[0].requestId,null);assert.equal(item.splitParts[0].status,'unresolved');assert.equal(item.splitParts[0].plan,null);
  assert.equal(item.splitParts[0].failure.code,'missing_request_id');
});

test('request-heavy results pages continue pagination and report bounded request coverage at the final offset',async t=>{
  for(const resumedAtCap of [false,true]) {
    const {store,worker,generation}=setup(t);
    seedTarget(store,generation,[amendment(1)]);
    const vote={...decision(1,['eli/dl/doc/'+targetId+'-AM-1'],'ADOPTED'),had_activity_type:'def/ep-activities/PLENARY_OUTCOME'};
    const result={id:'eli/dl/event/'+sitting+'-VOT-ITM-123',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',activity_date:'2026-10-07',consists_of:[vote.id],sittingResultIds:[]};
    const empty=()=>({had_activity_type:'def/ep-activities/REQUEST_VOTE_SPLIT',created_a_realization_of:[]});
    const later=request([part(1,'‘A request found after the full first page’')]);delete later.id;
    const calls=[];
    worker.fetchRecord=async(endpoint,params)=>{
      calls.push([endpoint,params.offset]);
      if(endpoint.endsWith('/decisions'))return {fetchedAt,payload:{data:[vote]}};
      assert.equal(endpoint,'/meetings/'+sitting+'/vote-results');
      const data=resumedAtCap?Array.from({length:50},empty):params.offset===0?[result,...Array.from({length:49},empty)]:[later];
      return {fetchedAt,payload:{data}};
    };
    const initial={sittingId:sitting,stage:'results',offset:resumedAtCap?950:0,results:resumedAtCap?[result]:[],decisions:[],splits:[],sources:resumedAtCap?[{url:sourceUrl+'&offset=0',fetchedAt:earlier}]:[],...(resumedAtCap?{amendmentProjectionVersion:2}:{})};
    store.enqueue(generation,'request-heavy-sitting','motion-outcomes',initial,113);
    await worker.task(store.nextTask(generation));
    if(resumedAtCap) {
      assert.equal(store.nextTask(generation).body.stage,'decisions');
      assert.equal(store.nextTask(generation).body.splitProjectionTruncated,true);
    } else {
      assert.equal(store.nextTask(generation).body.stage,'results');assert.equal(store.nextTask(generation).body.offset,50);
      await worker.task(store.nextTask(generation));
      assert.equal(store.nextTask(generation).body.stage,'decisions');
    }
    await worker.task(store.nextTask(generation));
    const expected=resumedAtCap?[['/meetings/'+sitting+'/vote-results',950],['/meetings/'+sitting+'/decisions',0]]:[['/meetings/'+sitting+'/vote-results',0],['/meetings/'+sitting+'/vote-results',50],['/meetings/'+sitting+'/decisions',0]];
    assert.deepEqual(calls,expected);
    const saved=store.source(generation,motionSourceKey(sitting)).work;
    assert.equal(saved.splitRequests.length,50);assert.equal(new Set(saved.splitRequests.map(split=>split.observationKey)).size,50);
    assert.equal(amendmentFailures(store,{status:'unresolved'}).total,50);
    assert.equal(saved.truncated,false);assert.equal(saved.splitProjectionTruncated,resumedAtCap);
    assert.deepEqual(saved.coverage,{missingResultIds:[],missingDecisionIds:[]});
    const page=amendmentsPage(store,{document:targetId});
    assert.equal(page.items[0].outcome,'ADOPTED');
    if(resumedAtCap)assert(page.coverage.gaps.some(gap=>/split-request pagination limit/i.test(gap)));
    else {
      const observed=saved.splitRequests.find(split=>split.created_a_realization_of.length);
      assert.equal(new URL(observed.source.url).searchParams.get('offset'),'50');
      assert.equal(observed.created_a_realization_of[0].expressionContent.en,later.created_a_realization_of[0].expressionContent.en);
    }
  }
});

test('repeated unparsed components retain the literal source and first occurrence',t=>{
  const {store,worker,advance}=setup(t);
  const split=request([part(1,'Apply the chairman’s unpublished oral instructions')]);
  parseSavedSplits(worker,{splitRequests:[split],sources:[{url:sourceUrl,fetchedAt:earlier}]});
  advance(1000);
  const nextAt='2026-10-16T17:00:01.000Z';
  parseSavedSplits(worker,{splitRequests:[split],sources:[{url:sourceUrl,fetchedAt:nextAt}]});
  const failure=amendmentFailures(store).items[0];
  assert.equal(failure.status,'unresolved');assert.equal(failure.count,2);
  assert.equal(failure.description,'Apply the chairman’s unpublished oral instructions');
  assert.equal(failure.rawDescription,split.created_a_realization_of[0].expressionContent.en);
  assert.equal(failure.firstOccurrence,earlier);assert.equal(failure.lastOccurrence,nextAt);
  assert.match(failure.sourceDescriptionHash,/^[a-f0-9]{64}$/);
});

test('amendment work has durable retries without changing legacy task progress or blocking its publication',t=>{
  const {store,generation,advance}=setup(t);
  store.enqueue(generation,'ordinary','document',{},10);
  const expected={total:1,completed:0,retrying:0};
  enqueueAmendment(store,generation,'amendment:one','amendment-extract',{listId},50);
  assert.deepEqual({...store.taskCounts(generation)},expected);
  let task=nextAmendmentTask(store,generation);
  assert(task.amendmentJob);assert.equal(task.key,'amendment:one');
  store.taskProgress(task,{listId,offset:10});
  task=nextAmendmentTask(store,generation);assert.equal(task.body.offset,10);
  store.failTask(task,new Error('Temporary amendment source failure'));
  assert.equal(nextAmendmentTask(store,generation),null);
  assert.deepEqual({...store.taskCounts(generation)},expected);
  advance(31_000);
  task=nextAmendmentTask(store,generation);assert.equal(task.attempts,1);
  store.finishTask(store.nextTask(generation));
  store.publish(generation);
  assert.equal(store.get('active'),generation);
  const next=store.beginCycle();
  const resumed=nextAmendmentTask(store,next.generation);
  assert.equal(resumed.body.offset,10);assert.equal(resumed.attempts,1);
  store.finishTask(resumed);assert.equal(nextAmendmentTask(store,next.generation),null);
});

test('report-only sittings refresh stale outcomes using recent and older sitting cache lifetimes',t=>{
  const cases=[
    [sitting,5*60*60_000,false],
    [sitting,7*60*60_000,true],
    ['MTG-PL-2026-09-01',6*24*60*60_000,false],
    ['MTG-PL-2026-09-01',8*24*60*60_000,true],
  ];
  for(const [sittingId,age,refresh] of cases) {
    const {store,worker,generation}=setup(t);
    const work={...target,inverse_based_on_a_realization_of:['eli/dl/event/'+sittingId+'-VOT-ITM-123']};
    store.putSource(generation,motionSourceKey(sittingId),'motion-outcomes',completeSitting(sittingId),new Date(Date.parse(fetchedAt)-age).toISOString());
    scheduleAmendments(worker,generation,work,fetchedAt,'/plenary-documents/'+targetId);
    const jobs=outcomeJobs(store,generation);
    assert.equal(jobs.length,refresh?1:0,sittingId+' age '+age);
    if(refresh) {
      assert.equal(jobs[0].key,motionSourceKey(sittingId)+':2026-10-16');
      assert.equal(JSON.parse(jobs[0].body).sittingId,sittingId);
      assert.equal(JSON.parse(jobs[0].body).stage,'results');
    }
  }
});

test('incomplete report sitting caches are refreshed even when their retrieval timestamp is fresh',t=>{
  const cases=[
    {truncated:true},
    {lastRefreshFailure:{attemptedAt:earlier}},
    {coverage:{missingResultIds:['eli/dl/event/missing-result'],missingDecisionIds:[]}},
    {coverage:{missingResultIds:[],missingDecisionIds:['eli/dl/event/missing-decision']}},
    {amendmentVersion:0},
    {amendmentProjectionVersion:undefined},
    {splitRequests:null},
    {results:[]},
    {decisions:[]},
  ];
  for(const incomplete of cases) {
    const {store,worker,generation}=setup(t);
    store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',{...completeSitting(),...incomplete},fetchedAt);
    scheduleAmendments(worker,generation,target,fetchedAt,'/plenary-documents/'+targetId);
    assert.equal(outcomeJobs(store,generation).length,1,JSON.stringify(incomplete));
  }
});

test('reports and motions reuse one sitting refresh and do not repeat a completed attempt on the same day',t=>{
  const {store,worker,generation}=setup(t);
  scheduleAmendments(worker,generation,target,fetchedAt,'/plenary-documents/'+targetId);
  worker.scheduleMotionOutcomes(generation,{...target,identifier:otherTarget,id:'eli/dl/doc/'+otherTarget,work_type:'def/ep-document-types/RESOLUTION_MOTION'});
  let jobs=outcomeJobs(store,generation);
  assert.equal(jobs.length,1);assert.equal(jobs[0].key,motionSourceKey(sitting)+':2026-10-16');
  store.finishTask(jobs[0]);
  scheduleAmendments(worker,generation,target,fetchedAt,'/plenary-documents/'+targetId);
  worker.scheduleMotionOutcomes(generation,target);
  jobs=outcomeJobs(store,generation);
  assert.equal(jobs.length,1);assert.equal(jobs[0].done,1);
});

test('compact discovery and capacity checkpoints keep amendment coverage honest across retained generation fallback',t=>{
  for(const kind of ['discovery','capacity'])for(const location of ['active','retained-source','new-active-source']) {
    const {store,generation}=setup(t);
    saveAmendmentRows(store,generation,metadata,[row(1)],coverage);
    store.publish(generation);
    if(location!=='active'){store.set('active',generation+1);store.set('sequence',generation+1);}
    assert.equal(amendmentsPage(store,{document:targetId}).coverage.complete,true);
    const checkpoint={tasks:[],discovery:kind==='discovery'?[{key:'deferred:report',kind:'document',endpoint:'/plenary-documents/'+targetId,priority:109}]:[],completed:[],capacityGap:kind==='capacity'?{count:3,message:'Additional untouched amendment discovery exceeded the bounded checkpoint and is deferred to normal catalogue refresh.'}:null};
    const checkpointGeneration=location==='new-active-source'?generation+1:generation;
    store.putSource(checkpointGeneration,'amendment:continuations','amendment-continuations',checkpoint,fetchedAt);
    const page=amendmentsPage(store,{document:targetId});
    assert.equal(page.coverage.servingGeneration,generation);assert.equal(page.coverage.pending,kind==='discovery',kind+' '+location);
    assert.equal(page.coverage.complete,false,kind+' '+location);assert.equal(page.items[0].outcome,'unavailable');
    if(kind==='capacity')assert(page.coverage.gaps.some(gap=>gap.includes(checkpoint.capacityGap.message)),location);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs').get().n,0);
    assert.deepEqual(store.source(checkpointGeneration,'amendment:continuations').work,checkpoint);
  }
});

test('sitting refreshes preserve matching compact discovery and completed checkpoints without suppressing another sitting',t=>{
  for(const mode of ['discovery','different-sitting','completed']) {
    const {store,worker,generation}=setup(t);
    const descriptor={key:motionSourceKey(sitting)+':old-discovery-key',kind:'motion-outcomes',sittingId:mode==='different-sitting'?'MTG-PL-2026-10-06':sitting,priority:72};
    const checkpoint={tasks:[],discovery:mode==='completed'?[]:[descriptor],completed:mode==='completed'?[{key:motionSourceKey(sitting)+':2026-10-16',kind:'motion-outcomes',sittingId:sitting}]:[],capacityGap:null};
    store.putSource(generation,'amendment:continuations','amendment-continuations',checkpoint,earlier);
    const before=store.db.prepare("SELECT body,fetched_at FROM sources WHERE generation=? AND key='amendment:continuations'").get(generation);
    assert.equal(scheduleSittingOutcomes(worker,generation,sitting),mode==='different-sitting',mode);
    assert.equal(outcomeJobs(store,generation).length,mode==='different-sitting'?1:0,mode);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs').get().n,0);
    assert.deepEqual(store.db.prepare("SELECT body,fetched_at FROM sources WHERE generation=? AND key='amendment:continuations'").get(generation),before);
    if(mode==='different-sitting')assert.equal(JSON.parse(outcomeJobs(store,generation)[0].body).sittingId,sitting);
  }
});

test('an existing sitting task under an older amendment key preserves its pagination and retry state',t=>{
  const {store,worker,generation}=setup(t);
  const key=motionSourceKey(sitting)+':amendments:2026-10-15';
  const body={sittingId:sitting,stage:'decisions',offset:1000,results:[{id:'saved-result'}],decisions:[{id:'saved-decision'}],splits:[{id:'saved-split'}],sources:[{url:sourceUrl,fetchedAt:earlier}]};
  store.enqueue(generation,key,'motion-outcomes',body,113);
  store.db.prepare('UPDATE tasks SET attempts=3,retry_at=?,error=? WHERE generation=? AND key=?').run(Date.parse(fetchedAt)+60_000,'Retained upstream failure',generation,key);
  const before=outcomeJobs(store,generation);
  scheduleAmendments(worker,generation,target,fetchedAt,'/plenary-documents/'+targetId);
  worker.scheduleMotionOutcomes(generation,target);
  assert.deepEqual(outcomeJobs(store,generation),before);
  assert.deepEqual(JSON.parse(outcomeJobs(store,generation)[0].body),body);
});

test('reparsing a legacy graph cannot stamp source projection completeness and one same-day upgrade preserves pending progress',t=>{
  const {store,worker,generation}=setup(t);
  const published=list([amendment(1,{authors:['Alex Common']})],{foresees_change_of:[target.id]});
  published.is_realized_by=[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:published.extraction.sourceUrl}]}];
  const document={...target,inverse_foresees_change_of:[published]};
  store.putSource(generation,'/plenary-documents/'+targetId,'document',document,fetchedAt);
  store.putSource(generation,'amendment:list:'+listId,'amendment-list',published,earlier);
  store.putSource(generation,'amendment:roster:'+tabled,'amendment-roster',{members:[{id:'101',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+tabled,fetchedAt}]},fetchedAt);
  store.putSource(generation,'amendment:aliases:'+sitting,'amendment-aliases',{aliases:[]},fetchedAt);
  const legacy={...completeSitting(),sources:[{url:sourceUrl.replace('/vote-results?','/decisions?'),fetchedAt}]};
  delete legacy.amendmentProjectionVersion;
  const reparsed=parseSavedSplits(worker,legacy);
  assert.equal(reparsed.amendmentProjectionVersion,undefined);
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',reparsed,fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const before=amendmentsPage(store,{document:targetId});
  assert.equal(before.coverage.complete,false);assert(before.coverage.gaps.some(gap=>/projection.*unverified|unverified.*projection/i.test(gap)));
  const oldKey=motionSourceKey(sitting)+':2026-10-16';
  store.enqueue(generation,oldKey,'motion-outcomes',{sittingId:sitting,stage:'results',offset:0,results:[],decisions:[],splits:[],sources:[]},113);
  store.finishTask(store.nextTask(generation));
  scheduleAmendments(worker,generation,document,fetchedAt,'/plenary-documents/'+targetId);
  worker.scheduleMotionOutcomes(generation,document);
  let jobs=outcomeJobs(store,generation);
  assert.equal(jobs.length,2);assert.equal(jobs.filter(job=>job.done===1).length,1);
  const pending=jobs.find(job=>job.done!==1);assert.match(pending.key,/:2026-10-16:amendments-v2$/);
  store.taskProgress(pending,{...JSON.parse(pending.body),stage:'decisions',offset:50});
  store.db.prepare('UPDATE tasks SET attempts=2,retry_at=?,error=? WHERE generation=? AND key=?').run(Date.parse(fetchedAt)+60_000,'Preserved upgrade retry',generation,pending.key);
  const checkpoint=outcomeJobs(store,generation);
  scheduleAmendments(worker,generation,document,fetchedAt,'/plenary-documents/'+targetId);
  worker.scheduleMotionOutcomes(generation,document);
  jobs=outcomeJobs(store,generation);assert.deepEqual(jobs,checkpoint);
  assert.equal(store.source(generation,motionSourceKey(sitting)).work.amendmentProjectionVersion,undefined);
  assert.equal(amendmentsPage(store,{document:targetId}).coverage.complete,false);
});

test('candidate workers recover retained amendment rows and cursors after a legacy worker advances core generations',t=>{
  for(const legacyCreatedWorking of [false,true]) {
    const {store,generation}=setup(t);
    seedTarget(store,generation,[amendment(1)]);
    saveAmendmentRows(store,generation,metadata,[row(1,{proposedText:'Accepted before rollback'})],coverage);
    enqueueAmendment(store,generation,'roster-cursor','amendment-roster',{date:tabled,offset:1000,members:[{id:'101'}],sources:[]});
    store.db.prepare('UPDATE amendment_jobs SET attempts=2,error=? WHERE generation=? AND key=?').run('Retained retry',generation,'roster-cursor');
    recordSplitResults(store,parseSplitRequest(request([part(1,'Unpublished instructions')]),{sourceUrl,fetchedAt}));
    store.publish(generation);
    // The released worker knows only core tables. Its cycle advances metadata
    // and copies sources without touching the additive amendment tables.
    store.db.prepare('INSERT INTO sources SELECT 2,key,kind,body,fetched_at,1 FROM sources WHERE generation=?').run(generation);
    const setMeta=store.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)');
    setMeta.run('active','2');setMeta.run('sequence','2');setMeta.run('previous',JSON.stringify(generation));
    if(legacyCreatedWorking) {
      store.db.prepare('INSERT INTO sources SELECT 3,key,kind,body,fetched_at,0 FROM sources WHERE generation=2').run();
      setMeta.run('sequence','3');
      setMeta.run('working',JSON.stringify({generation:3,initial:false,startedAt:earlier,phase:'discovering',requests:7,legacyCheckpoint:'retained'}));
    }
    const before=amendmentsPage(store,{document:targetId});
    assert.equal(before.coverage.servingGeneration,generation);
    assert.equal(before.items[0].proposedText,'Accepted before rollback');
    assert.equal(store.status().amendments.indexed,1);
    const recovered=store.beginCycle();
    assert.equal(recovered.generation,3);
    if(legacyCreatedWorking) {assert.equal(recovered.requests,7);assert.equal(recovered.legacyCheckpoint,'retained');}
    const after=amendmentsPage(store,{document:targetId});
    assert.equal(after.coverage.servingGeneration,3);
    assert.equal(after.items[0].proposedText,'Accepted before rollback');
    const job=nextAmendmentTask(store,3);
    assert.equal(job.key,'roster-cursor');assert.equal(job.body.offset,1000);
    assert.equal(job.attempts,2);assert.equal(job.error,'Retained retry');
    assert.deepEqual(job.body.members,[{id:'101'}]);
    assert.equal(amendmentFailures(store,{status:'unresolved'}).total,1);
    store.publish(3);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendments WHERE generation=?').get(generation).n,0);
    assert.equal(amendmentsPage(store,{document:targetId}).items[0].proposedText,'Accepted before rollback');
    assert.equal(nextAmendmentTask(store,3).body.offset,1000);
    assert.equal(amendmentFailures(store,{status:'unresolved'}).total,1);
  }
});

// A minimal real DOCX exercises extraction during a worker refresh without
// downloading any corpus or replacing the parser with an implementation stub.
function docx(xml) {
  const name=Buffer.from('word/document.xml'),body=Buffer.from(xml),compressed=deflateRawSync(body);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
  return Buffer.concat([local,name,compressed,central,name,end]);
}
function comparisonDocx(rows,{author='Bruno Gonçalves',language='en',date='2.10.2026',committee=null,extraAmendments=[],wrapSecondRow=false,symbolInFirstCell=false,wholeBodyAlternatives=false,structuralRevision=null}={}) {
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const paragraph=value=>'<w:p><w:r><w:t>'+escape(value)+'</w:t></w:r></w:p>';
  const tableRow=cells=>'<w:tr>'+cells.map(value=>'<w:tc>'+paragraph(value)+'</w:tc>').join('')+'</w:tr>';
  const comparisonRows=rows.map((cells,index)=>{
    let xml=symbolInFirstCell&&index===0?tableRow(cells).replace('</w:t>','</w:t><w:sym w:font="Symbol" w:char="F061"/>'):tableRow(cells);
    if(index===rows.length-1&&structuralRevision==='row')xml=xml.replace('<w:tr>','<w:tr><w:trPr><w:del w:id="7" w:author="Editor" w:date="2026-10-01T00:00:00Z"/></w:trPr>');
    if(index===rows.length-1&&structuralRevision==='cell')xml=xml.replace('<w:tc>','<w:tc><w:tcPr><w:cellDel w:id="8" w:author="Editor"/></w:tcPr>');
    if(index===0&&structuralRevision==='historical-cell')xml=xml.replace('<w:tc>','<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/><w:gridSpan w:val="1"/><w:tcPrChange w:id="9" w:author="Editor"><w:tcPr><w:cellDel w:id="8" w:author="Editor"/></w:tcPr></w:tcPrChange></w:tcPr>');
    return wrapSecondRow&&index===1?'<w:sdt><w:sdtContent>'+xml+'</w:sdtContent></w:sdt>':xml;
  }).join('');
  const heading=tableRow(['Text proposed by the Commission',language==='fr'?'Amendement':'Amendment']);
  const dateTag=date?'<Date>'+date+'</Date>':'';
  const section=paragraph('<Amend>'+dateTag+'<NumAm>1</NumAm>')+(author?paragraph('<Members>'+author+'</Members>'):'')+paragraph('<Article>Article 1</Article>')+'<w:tbl>'+heading+comparisonRows+'</w:tbl>'+paragraph('</Amend>')+extraAmendments.map(extra=>paragraph('<Amend>'+dateTag+'<NumAm>'+extra.number+'</NumAm>')+(extra.author?paragraph('<Members>'+extra.author+'</Members>'):'')+paragraph('<Article>Article '+extra.number+'</Article>')+'<w:tbl>'+heading+extra.rows.map(tableRow).join('')+'</w:tbl>'+paragraph('</Amend>')).join('');
  const content=wholeBodyAlternatives?'<compat:AlternateContent><compat:Choice Requires="w14">'+section+'</compat:Choice><compat:Fallback>'+section+'</compat:Fallback></compat:AlternateContent>':section;
  return docx('<w:document xmlns:w="urn:word" xmlns:compat="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>'+(committee?paragraph('<Committee>'+committee+'</Committee>'):'')+content+'</w:body></w:document>');
}

test('oversized legal columns are withheld together instead of being exposed as shortened complete text',t=>{
  for(const oversizedField of ['originalText','proposedText']) {
    const {store,worker,generation}=setup(t);
    seedTarget(store,generation,[amendment(1,{[oversizedField]:'x'.repeat(60001)})]);
    rebuildAmendmentTarget(worker,generation,targetId);
    const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
    assert.equal(item.originalText===null,true,oversizedField+' must withhold the original column');assert.equal(item.proposedText===null,true,oversizedField+' must withhold the proposed column');
    assert.equal(item.textIntegrity,'incomplete');
    assert(item.gaps.some(gap=>/size|limit|exceed|60[ ,]?000/i.test(gap)));
    assert.equal(page.coverage.complete,false);
  }
  const {store,worker,generation}=setup(t);
  seedTarget(store,generation,[amendment(1,{originalText:'o'.repeat(60000),proposedText:'p'.repeat(60000)})]);
  rebuildAmendmentTarget(worker,generation,targetId);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.originalText.length,60000);assert.equal(item.proposedText.length,60000);
  assert.equal(item.textIntegrity,'complete');
});

test('an oversized refresh retains only a known complete baseline and keeps its text provenance coherent',async t=>{
  for(const oversizedBaseline of [false,true]) {
    const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001';
    const oldUrl='https://data.europarl.europa.eu/distribution/example/size_baseline_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/size_refresh_en.docx';
    const baseline=extractAmendments(comparisonDocx([[oversizedBaseline?'b'.repeat(60001):'Accepted original','Accepted proposal']]),{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:oldUrl,fetchedAt:earlier});
    store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
    store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{...baseline,sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:AMENDMENT_EXTRACTION_VERSION}},earlier);
    if(oversizedBaseline)saveAmendmentRows(store,generation,metadata,[row(1,{originalText:'b'.repeat(60000),proposedText:'Accepted proposal',textIntegrity:'complete',splitParts:[],sources:[{url:oldUrl,fetchedAt:earlier}]})],coverage);
    worker.downloadAmendmentDocx=async()=>({buffer:comparisonDocx([['r'.repeat(60001),'Fresh proposal']])});
    enqueueAmendment(store,generation,'size-refresh','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
    await worker.task(nextAmendmentTask(store,generation));
    const saved=store.source(generation,'amendment:list:'+singleListId),[item]=amendmentsPage(store,{document:targetId}).items;
    if(oversizedBaseline) {
      assert.equal(saved.fetchedAt,fetchedAt);assert.equal(item.originalText===null,true);assert.equal(item.proposedText===null,true);
      assert.equal(item.textIntegrity,'incomplete');
    } else {
      assert.equal(saved.fetchedAt,fetchedAt);assert.equal(saved.work.extraction.sourceUrl,newUrl);
      assert.equal(item.originalText,'Accepted original');assert.equal(item.proposedText,'Accepted proposal');
      assert.equal(saved.work.extraction.lastRefreshFailure.sourceUrl,newUrl);
      assert.deepEqual(item.wordingSource,{url:oldUrl,fetchedAt:earlier,language:'en'});assert.equal(item.wordingRetained,true);
      assert.deepEqual(item.metadataSource,{url:newUrl,fetchedAt,language:'en'});
      assert(item.sources.some(source=>source.url===oldUrl&&source.fetchedAt===earlier));
      assert(item.sources.some(source=>source.url===newUrl&&source.fetchedAt===fetchedAt));
    }
  }
});

test('newly detected wrapped comparison loss cannot restore an apparently complete v3 baseline',async t=>{
  const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001';
  const oldUrl='https://data.europarl.europa.eu/distribution/example/wrapped_v3_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/wrapped_v4_en.docx';
  const apparent=amendment(1,{originalText:'Cached ordinary row',proposedText:'Cached proposal row',sources:[{url:oldUrl,fetchedAt:earlier}]});
  store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
  store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{amendments:[apparent],gaps:[],sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:'3'}},earlier);
  saveAmendmentRows(store,generation,metadata,[row(1,{originalText:apparent.originalText,proposedText:apparent.proposedText,textIntegrity:'complete',textParserVersion:'3',splitParts:[],sources:[{url:oldUrl,fetchedAt:earlier}]})],coverage);
  const wrapped=comparisonDocx([['Fresh ordinary row','Fresh proposed ordinary row'],['Wrapped original row','Wrapped proposed row']],{wrapSecondRow:true});
  const candidate=extractAmendments(wrapped,{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:newUrl,fetchedAt});
  assert(candidate.gaps.some(gap=>/wrapper|unsupported|structure/i.test(gap.code)));
  worker.downloadAmendmentDocx=async()=>({buffer:wrapped});
  enqueueAmendment(store,generation,'wrapped-upgrade','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
  await worker.task(nextAmendmentTask(store,generation));
  const saved=store.source(generation,'amendment:list:'+singleListId),page=amendmentsPage(store,{document:targetId}),[item]=page.items;
  assert.equal(saved.fetchedAt,fetchedAt);assert.equal(saved.work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
  assert.equal(item.originalText,null);assert.equal(item.proposedText,null);assert.equal(item.textIntegrity,'incomplete');
  assert.equal(page.coverage.complete,false);
});

test('v5 symbol loss and whole-body alternate branches cannot resurrect v4 cached wording during migration',async t=>{
  for(const scenario of ['symbol','whole-alternative']) {
    const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001';
    const oldUrl='https://data.europarl.europa.eu/distribution/example/'+scenario+'_v4_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/'+scenario+'_v5_en.docx';
    const apparent=amendment(1,{originalText:'Cached original with omitted content',proposedText:'Cached proposed text'});
    store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
    store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{amendments:[apparent],gaps:[],sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:'4'}},earlier);
    saveAmendmentRows(store,generation,metadata,[row(1,{listId:singleListId,originalText:apparent.originalText,proposedText:apparent.proposedText,textIntegrity:'complete',textParserVersion:'4',splitParts:[],sources:[{url:oldUrl,fetchedAt:earlier}]})],coverage);
    const damaged=comparisonDocx([['Visible original','Visible proposal']],scenario==='symbol'?{symbolInFirstCell:true}:{wholeBodyAlternatives:true});
    const parsed=extractAmendments(damaged,{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:newUrl,fetchedAt});
    if(scenario==='symbol') {
      assert(parsed.gaps.some(gap=>gap.code==='symbol-text-loss'&&gap.number===1));
      assert.equal(parsed.amendments[0].originalText,null);assert.equal(parsed.amendments[0].proposedText,null);
    } else {
      assert.deepEqual(parsed.amendments,[]);
      assert(parsed.gaps.some(gap=>gap.code==='comparison-structure'&&gap.scope==='document'));
    }
    worker.downloadAmendmentDocx=async()=>({buffer:damaged});
    enqueueAmendment(store,generation,'v5-migration','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
    await worker.task(nextAmendmentTask(store,generation));
    const saved=store.source(generation,'amendment:list:'+singleListId),page=amendmentsPage(store,{document:targetId}),[item]=page.items;
    assert.equal(saved.fetchedAt,fetchedAt);assert.equal(saved.work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
    assert.equal(saved.work.extraction.previousParserVersion,'4');
    assert.equal(item.originalText,null);assert.equal(item.proposedText,null);assert.equal(item.textIntegrity,'incomplete');
    assert.equal(page.coverage.complete,false);
  }
});

test('retained conflicted variants cannot restore incompatible wording when a parser migration loses the amendment number',t=>{
  for(const priorVersion of ['3',undefined]) {
    const {store,worker,generation}=setup(t),secondId=targetId+'-AM-001-002';
    const sources=[{url:'https://data.europarl.europa.eu/distribution/example/variant_one_v3_en.docx',fetchedAt:earlier},{url:'https://data.europarl.europa.eu/distribution/example/variant_two_v3_en.docx',fetchedAt:earlier}];
    const variants=[listId,secondId].map((id,index)=>({listId:id,...(priorVersion?{textParserVersion:priorVersion}:{}),originalText:'Legacy original '+index,proposedText:'Legacy proposal '+index,language:'en',sources:[sources[index]]}));
    const old=row(1,{listId:null,conflicted:true,originalText:null,proposedText:null,splitParts:[],variants,sources});
    // Simulate an aggregate already cached by the old implementation. Its own
    // listId is null; only the individual variants identify their source lists.
    store.db.prepare('INSERT INTO amendments VALUES (?,?,?,?,?,?)').run(generation,old.id,targetId,tabled,'unavailable',JSON.stringify(old));
    const lists=[listId,secondId].map(id=>list([],{id:'eli/dl/doc/'+id,identifier:id,foresees_change_of:[target.id],extraction:{amendments:[],gaps:[{code:'amendments-unavailable',message:'No supported amendment number was extracted.'}],parserVersion:AMENDMENT_EXTRACTION_VERSION,previousParserVersion:'3',sourceUrl:'https://data.europarl.europa.eu/distribution/example/'+id+'_v4_en.docx',fetchedAt,language:'en'}}));
    store.putSource(generation,'/plenary-documents/'+targetId,'document',{...target,inverse_foresees_change_of:lists},fetchedAt);
    for(const item of lists)store.putSource(generation,'amendment:list:'+item.identifier,'amendment-list',item,fetchedAt);
    rebuildAmendmentTarget(worker,generation,targetId);
    const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
    assert.equal(item.conflicted,true);assert.equal(item.listId,null);assert.equal(item.variants.length,2);
    assert.deepEqual(item.variants.map(variant=>variant.listId).sort(),[listId,secondId].sort());
    for(const variant of item.variants) {
      assert.equal(variant.originalText,null);assert.equal(variant.proposedText,null);assert.equal(variant.textIntegrity,'incomplete');
      assert(variant.gaps.some(gap=>/compatible|baseline|parser/i.test(gap)));
    }
    assert(sources.every(source=>item.sources.some(saved=>saved.url===source.url)));
    assert(sources.every(source=>item.variants.some(variant=>variant.sources.some(saved=>saved.url===source.url))));
    assert.equal(page.coverage.complete,false);
    assert(page.coverage.gaps.some(gap=>/wording|variant|baseline/i.test(gap)));
  }
});

test('an oversized retained variant is withheld without choosing between the remaining conflicting sources',t=>{
  const {store,generation}=setup(t),secondId=targetId+'-AM-001-002';
  const sources=[{url:'https://data.europarl.europa.eu/distribution/example/oversized_variant_en.docx',fetchedAt:earlier},{url:'https://data.europarl.europa.eu/distribution/example/complete_variant_en.docx',fetchedAt:earlier}];
  const variants=[{listId,textParserVersion:AMENDMENT_EXTRACTION_VERSION,originalText:'x'.repeat(60001),proposedText:'Oversized variant proposal',sources:[sources[0]]},{listId:secondId,textParserVersion:AMENDMENT_EXTRACTION_VERSION,originalText:'Complete original',proposedText:'Complete proposal',sources:[sources[1]]}];
  const old=row(1,{listId:null,conflicted:true,originalText:null,proposedText:null,splitParts:[],variants,sources});
  store.db.prepare('INSERT INTO amendments VALUES (?,?,?,?,?,?)').run(generation,old.id,targetId,tabled,'unavailable',JSON.stringify(old));
  saveAmendmentRows(store,generation,metadata,[],coverage,{textParserVersion:AMENDMENT_EXTRACTION_VERSION});
  const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
  assert.equal(item.conflicted,true);assert.equal(item.originalText,null);assert.equal(item.proposedText,null);assert.equal(item.variants.length,2);
  const oversized=item.variants.find(variant=>variant.listId===listId),complete=item.variants.find(variant=>variant.listId===secondId);
  assert.equal(oversized.originalText===null,true);assert.equal(oversized.proposedText,null);assert.equal(oversized.textIntegrity,'incomplete');
  assert(oversized.gaps.some(gap=>/size|limit|exceed|60[ ,]?000/i.test(gap)));
  assert.equal(complete.originalText,'Complete original');assert.equal(complete.proposedText,'Complete proposal');
  assert(sources.every(source=>item.sources.some(saved=>saved.url===source.url)));
  assert.equal(page.coverage.complete,false);
});

test('losing a comparison row within the same amendment retains its full accepted columns and source date',async t=>{
  const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001';
  const oldUrl='https://data.europarl.europa.eu/distribution/example/accepted_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/refreshed_en.docx';
  const accepted=extractAmendments(comparisonDocx([['Before one','After one'],['Before two','After two']]),{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:oldUrl,fetchedAt:earlier});
  const degraded=comparisonDocx([['Changed one','Changed proposal one'],['Before two','After two','Unsupported extra column']]);
  const fresh=extractAmendments(degraded,{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:newUrl,fetchedAt});
  assert.equal(fresh.amendments[0].number,1);assert.equal(fresh.amendments[0].proposedText,null);
  assert(fresh.gaps.some(gap=>gap.code==='comparison-columns'&&gap.number===1));
  store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
  store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{...accepted,sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:AMENDMENT_EXTRACTION_VERSION}},earlier);
  worker.downloadAmendmentDocx=async()=>({buffer:degraded});
  enqueueAmendment(store,generation,'degraded-comparison','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
  await worker.task(nextAmendmentTask(store,generation));
  const saved=store.source(generation,'amendment:list:'+singleListId);
  assert.equal(saved.fetchedAt,fetchedAt);assert.equal(saved.work.extraction.fetchedAt,fetchedAt);
  assert.equal(saved.work.extraction.sourceUrl,newUrl);
  assert.equal(saved.work.extraction.amendments[0].originalText,'Before one\nBefore two');
  assert.equal(saved.work.extraction.amendments[0].proposedText,'After one\nAfter two');
  assert.equal(saved.work.extraction.lastRefreshFailure.attemptedAt,fetchedAt);
  assert.equal(saved.work.extraction.lastRefreshFailure.sourceUrl,newUrl);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.originalText,'Before one\nBefore two');assert.equal(item.proposedText,'After one\nAfter two');
  assert.deepEqual(item.wordingSource,{url:oldUrl,fetchedAt:earlier,language:'en'});assert.equal(item.wordingRetained,true);
  assert.deepEqual(item.metadataSource,{url:newUrl,fetchedAt,language:'en'});
  assert(item.sources.some(source=>source.url===oldUrl&&source.fetchedAt===earlier));
});

test('damaged fresh wording cannot hide explicit proposer corrections or relabel retained wording provenance',async t=>{
  for(const mode of ['committee','named','missing']) {
    const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001';
    const oldUrl='https://data.europarl.europa.eu/distribution/example/proposer_old_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/proposer_new_en.docx';
    const baseline=extractAmendments(comparisonDocx([['Accepted original one','Accepted proposal one'],['Accepted original two','Accepted proposal two']],{author:'Alex Common'}),{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:oldUrl,fetchedAt:earlier});
    store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
    store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{...baseline,sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:AMENDMENT_EXTRACTION_VERSION}},earlier);
    store.putSource(generation,'amendment:roster:'+tabled,'amendment-roster',{members:[{id:'101',givenName:'Alex',familyName:'Common'},{id:'102',givenName:'New',familyName:'Member'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+tabled,fetchedAt:earlier}]},earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    assert.equal(amendmentsPage(store,{member:'101'}).total,1);
    const committee='Committee on the Environment, Climate and Food Safety';
    const freshOptions=mode==='committee'?{author:null,committee}:mode==='named'?{author:'New Member'}:{author:null};
    const damaged=comparisonDocx([['Fresh first row','Fresh proposed first row'],['Unsupported second row','Second proposed row','Extra cell']],freshOptions);
    const candidate=extractAmendments(damaged,{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:newUrl,fetchedAt});
    assert(candidate.gaps.some(gap=>gap.code==='comparison-columns'));
    worker.downloadAmendmentDocx=async()=>({buffer:damaged});
    enqueueAmendment(store,generation,'proposer-correction','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
    await worker.task(nextAmendmentTask(store,generation));
    const saved=store.source(generation,'amendment:list:'+singleListId),[item]=amendmentsPage(store,{document:targetId}).items;
    const oldSource={url:oldUrl,fetchedAt:earlier,language:'en'},newSource={url:newUrl,fetchedAt,language:'en'};
    assert.equal(saved.fetchedAt,fetchedAt);assert.equal(saved.work.extraction.sourceUrl,newUrl);
    assert.equal(item.originalText,'Accepted original one\nAccepted original two');assert.equal(item.proposedText,'Accepted proposal one\nAccepted proposal two');
    assert.deepEqual(item.wordingSource,oldSource);assert.equal(item.wordingRetained,true);assert.deepEqual(item.metadataSource,newSource);
    assert.equal(amendmentsPage(store,{member:'101'}).total,mode==='missing'?1:0);
    assert.equal(amendmentsPage(store,{member:'102'}).total,mode==='named'?1:0);
    if(mode==='committee') {assert.deepEqual(item.authors,[]);assert.equal(item.committeeProposer,committee);}
    if(mode==='named') {assert.equal(item.authors[0].personId,'102');assert.equal(item.committeeProposer,null);}
    if(mode==='missing') {
      assert.equal(item.authors[0].personId,'101');assert.equal(item.proposerRetained,true);assert.deepEqual(item.proposerSource,oldSource);
      assert(item.gaps.some(gap=>/proposer/i.test(gap)&&/retain/i.test(gap)));
    } else {assert.equal(item.proposerRetained,false);assert.deepEqual(item.proposerSource,newSource);}
  }
});

test('a mixed damaged refresh retains each old component independently while accepting changed and new amendments',async t=>{
  const {store,worker,generation}=setup(t);
  const oldUrl='https://data.europarl.europa.eu/distribution/example/mixed_old_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/mixed_new_en.docx';
  const baseline=extractAmendments(comparisonDocx([['Old original one','Old proposal one']],{author:'Alex Common',extraAmendments:[{number:2,author:'Alex Common',rows:[['Old original two','Old proposal two']]},{number:3,author:'Alex Common',rows:[['Old original three','Old proposal three']]}]}),{listId,targetDocumentId:targetId,language:'en',sourceUrl:oldUrl,fetchedAt:earlier});
  store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
  store.putSource(generation,'amendment:list:'+listId,'amendment-list',{...list([]),files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{...baseline,sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:AMENDMENT_EXTRACTION_VERSION}},earlier);
  store.putSource(generation,'amendment:roster:'+tabled,'amendment-roster',{members:[{id:'101',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+tabled,fetchedAt:earlier}]},earlier);
  rebuildAmendmentTarget(worker,generation,targetId);
  const fresh=comparisonDocx([['Damaged first row','Damaged proposed row'],['Extra','Unsupported','Column']],{author:'Alex Common',extraAmendments:[{number:2,author:'Alex Common',rows:[['Fresh original two','Fresh proposal two']]},{number:4,author:'Alex Common',rows:[['New original four','New proposal four']]}]});
  worker.downloadAmendmentDocx=async()=>({buffer:fresh});
  enqueueAmendment(store,generation,'mixed-refresh','amendment-extract',{listId,targetDocumentId:targetId});
  await worker.task(nextAmendmentTask(store,generation));
  const page=amendmentsPage(store,{document:targetId}),items=new Map(page.items.map(item=>[item.number,item]));
  const oldSource={url:oldUrl,fetchedAt:earlier,language:'en'},newSource={url:newUrl,fetchedAt,language:'en'};
  assert.equal(page.total,4);assert.equal(page.coverage.complete,false);
  assert.equal(items.get(1).proposedText,'Old proposal one');assert.equal(items.get(1).wordingRetained,true);assert.deepEqual(items.get(1).wordingSource,oldSource);assert.deepEqual(items.get(1).metadataSource,newSource);
  assert.equal(items.get(2).proposedText,'Fresh proposal two');assert.equal(items.get(2).wordingRetained,false);assert.deepEqual(items.get(2).wordingSource,newSource);
  assert.equal(items.get(3).proposedText,'Old proposal three');assert.equal(items.get(3).wordingRetained,true);assert.deepEqual(items.get(3).wordingSource,oldSource);assert(items.get(3).gaps.some(gap=>/missing|absent|retain/i.test(gap)));
  assert.equal(items.get(4).proposedText,'New proposal four');assert.equal(items.get(4).wordingRetained,false);assert.deepEqual(items.get(4).wordingSource,newSource);
  assert.equal(store.source(generation,'amendment:list:'+listId).fetchedAt,fetchedAt);
});

test('retained proposer evidence uses its original mandate date while fresh document metadata and explicit proposers use the new date',async t=>{
  for(const explicitFreshProposer of [false,true]) {
    const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001',freshDate='2026-10-06';
    const oldUrl='https://data.europarl.europa.eu/distribution/example/dated_proposer_old_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/dated_proposer_new_en.docx';
    const baseline=extractAmendments(comparisonDocx([['Accepted original','Accepted proposal']],{author:'Alex Common'}),{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:oldUrl,fetchedAt:earlier});
    store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
    store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{...baseline,sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:AMENDMENT_EXTRACTION_VERSION}},earlier);
    for(const [date,members] of [[tabled,[{id:'101',givenName:'Alex',familyName:'Common'}]],[freshDate,[{id:'102',givenName:'New',familyName:'Member'}]]])store.putSource(generation,'amendment:roster:'+date,'amendment-roster',{members,sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+date,fetchedAt:earlier}]},earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    const damaged=comparisonDocx([['Damaged first row','Damaged proposal'],['Extra','Unsupported','Column']],{author:explicitFreshProposer?'New Member':null,date:'6.10.2026'});
    worker.downloadAmendmentDocx=async()=>({buffer:damaged});
    enqueueAmendment(store,generation,'dated-proposer-refresh','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
    await worker.task(nextAmendmentTask(store,generation));
    const [item]=amendmentsPage(store,{document:targetId}).items,author=item.authors[0];
    assert.equal(item.date,freshDate);assert.equal(item.documentDate,freshDate);assert.equal(item.dateBasis,'individual-amendment-document');
    assert.equal(item.proposedText,'Accepted proposal');assert.equal(item.wordingSource.url,oldUrl);
    assert.equal(author.personId,explicitFreshProposer?'102':'101');
    const matched=author.evidence.find(evidence=>evidence.type==='full_name');
    assert.equal(matched.date,explicitFreshProposer?freshDate:tabled);
    assert.deepEqual(matched.activeMandate,{start:explicitFreshProposer?freshDate:tabled,end:explicitFreshProposer?freshDate:tabled});
    assert.equal(item.proposerSource.url,explicitFreshProposer?newUrl:oldUrl);assert.equal(item.proposerRetained,!explicitFreshProposer);
    assert.equal(amendmentsPage(store,{member:explicitFreshProposer?'102':'101'}).total,1);
  }
});

test('a parser migration retains supported proposer provenance independently of fresh wording and accepts an explicit replacement',async t=>{
  for(const mode of ['individual','committee','explicit-replacement']) {
    const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001',freshDate='2026-10-06';
    const oldUrl='https://data.europarl.europa.eu/distribution/example/proposer_v5_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/proposer_v6_en.docx',committee='Committee on the Environment, Climate and Food Safety';
    const baselineOptions=mode==='individual'?{author:'Alex Common'}:{author:null,committee};
    const baseline=extractAmendments(comparisonDocx([['Legacy original','Legacy proposal']],baselineOptions),{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:oldUrl,fetchedAt:earlier});
    store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
    store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{...baseline,sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:'5'}},earlier);
    for(const [date,members] of [[tabled,[{id:'101',givenName:'Alex',familyName:'Common'}]],[freshDate,[{id:'102',givenName:'New',familyName:'Member'}]]])store.putSource(generation,'amendment:roster:'+date,'amendment-roster',{members,sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+date,fetchedAt:earlier}]},earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    const fresh=comparisonDocx([['Fresh complete original','Fresh complete proposal']],{author:mode==='explicit-replacement'?'New Member':null,date:'6.10.2026'});
    worker.downloadAmendmentDocx=async()=>({buffer:fresh});
    enqueueAmendment(store,generation,'migration-proposer','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
    await worker.task(nextAmendmentTask(store,generation));
    const [item]=amendmentsPage(store,{document:targetId}).items;
    const oldSource={url:oldUrl,fetchedAt:earlier,language:'en'},newSource={url:newUrl,fetchedAt,language:'en'};
    assert.equal(item.originalText,'Fresh complete original');assert.equal(item.proposedText,'Fresh complete proposal');
    assert.deepEqual(item.wordingSource,newSource);assert.deepEqual(item.metadataSource,newSource);assert.equal(item.wordingRetained,false);
    assert.equal(item.documentDate,freshDate);assert.equal(item.dateBasis,'individual-amendment-document');
    if(mode==='explicit-replacement') {
      assert.equal(item.authors[0].personId,'102');assert.equal(item.committeeProposer,null);assert.equal(item.proposerRetained,false);assert.deepEqual(item.proposerSource,newSource);
      assert.equal(item.authors[0].evidence.find(evidence=>evidence.type==='full_name').date,freshDate);
    } else {
      assert.equal(item.proposerRetained,true);assert.deepEqual(item.proposerSource,oldSource);
      assert(item.gaps.some(gap=>/proposer/i.test(gap)&&/retain/i.test(gap)));
      if(mode==='individual') {
        assert.equal(item.authors[0].personId,'101');assert.equal(item.committeeProposer,null);
        assert.equal(item.authors[0].evidence.find(evidence=>evidence.type==='full_name').date,tabled);
      } else {assert.deepEqual(item.authors,[]);assert.equal(item.committeeProposer,committee);}
      assert.equal(store.source(generation,'amendment:list:'+singleListId).work.extraction.amendments[0].proposerDate,tabled);
    }
  }
});

test('parser 8 withholds legacy tracked-deletion caches through reads and refreshes while retaining valid proposer evidence',async t=>{
  assert.notEqual(AMENDMENT_EXTRACTION_VERSION,'7');
  for(const mode of ['row','cell','variants']) {
    const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001',secondListId=targetId+'-AM-001-002';
    const oldSource={url:'https://data.europarl.europa.eu/distribution/example/tracked_deletion_v7_en.docx',fetchedAt:earlier,language:'en'};
    const freshUrl='https://data.europarl.europa.eu/distribution/example/tracked_deletion_v8_en.docx';
    const legacyAmendment=amendment(1,{authors:['Alex Common'],originalText:'Visible original\nDeleted original',proposedText:'Visible proposal\nDeleted proposal'});
    const published=list([],{id:'eli/dl/doc/'+singleListId,identifier:singleListId,foresees_change_of:[target.id],files:[{format:'DOCX',language:'en',url:freshUrl}],extraction:{amendments:[legacyAmendment],parserVersion:'7',gaps:[],language:'en',sourceUrl:oldSource.url,fetchedAt:earlier}});
    const safeList=list([amendment(1,{authors:['Alex Common'],originalText:'',proposedText:'Safe current proposal'})],{id:'eli/dl/doc/'+secondListId,identifier:secondListId,foresees_change_of:[target.id]});
    const lists=mode==='variants'?[published,safeList]:[published];
    store.putSource(generation,'/plenary-documents/'+targetId,'document',{...target,inverse_foresees_change_of:lists},earlier);
    for(const item of lists)store.putSource(generation,'amendment:list:'+item.identifier,'amendment-list',item,earlier);
    store.putSource(generation,'amendment:roster:'+tabled,'amendment-roster',{members:[{id:'101',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+tabled,fetchedAt:earlier}]},earlier);
    const legacyRow=row(1,{listId:singleListId,textParserVersion:'7',textIntegrity:'complete',originalText:legacyAmendment.originalText,proposedText:legacyAmendment.proposedText,proposerSource:oldSource,wordingSource:oldSource,authors:[{name:'Alex Common',personId:'101',status:'resolved',evidence:[]}],sources:[oldSource]});
    const safeVariant={...row(1,{listId:secondListId,textIntegrity:'complete',originalText:'',proposedText:'Safe current proposal'}),authors:legacyRow.authors};
    const cached=mode==='variants'?{...legacyRow,listId:null,originalText:null,proposedText:null,authors:[],conflicted:true,variants:[legacyRow,safeVariant]}:legacyRow;
    saveAmendmentRows(store,generation,metadata,[row(1)],coverage);
    store.db.prepare('UPDATE amendments SET body=? WHERE generation=? AND id=?').run(JSON.stringify(cached),generation,cached.id);
    const sourceBody=store.db.prepare('SELECT body FROM sources WHERE generation=? AND key=?').get(generation,'amendment:list:'+singleListId).body;
    const indexedBody=store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,cached.id).body;
    const record=()=>{
      const page=amendmentsPage(store,{document:targetId}),item=page.items[0];
      assert.equal(page.coverage.complete,false);
      return mode==='variants'?item.variants.find(variant=>variant.listId===singleListId):item;
    };
    const assertWithheld=()=>{
      const item=record();assert.equal(item.originalText,null);assert.equal(item.proposedText,null);assert.equal(item.textIntegrity,'incomplete');
      assert.equal(item.authors[0].personId,'101');assert.equal(item.proposerDate,tabled);assert.equal(item.proposerDateBasis,'individual-amendment-document');
    };
    const assertUnchanged=()=>{
      assert.equal(store.db.prepare('SELECT body FROM sources WHERE generation=? AND key=?').get(generation,'amendment:list:'+singleListId).body,sourceBody);
      assert.equal(store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,cached.id).body,indexedBody);
    };
    assertWithheld();amendmentsPage(store,{member:'101'});assertUnchanged();
    if(mode==='variants') {
      const safe=amendmentsPage(store,{document:targetId}).items[0].variants.find(variant=>variant.listId===secondListId);
      assert.equal(safe.originalText,'');assert.equal(safe.proposedText,'Safe current proposal');assert.equal(safe.authors[0].personId,'101');
    }
    enqueueAmendment(store,generation,'tracked-deletion-upgrade','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
    assertWithheld();assertUnchanged();
    worker.downloadAmendmentDocx=async()=>{throw new Error('Offline v8 refresh failed');};
    await assert.rejects(worker.task(nextAmendmentTask(store,generation)),/Offline v8 refresh failed/);
    assertWithheld();assertUnchanged();
    worker.downloadAmendmentDocx=async()=>({buffer:comparisonDocx([['Visible original','Visible proposal'],['Deleted original','Deleted proposal']],{author:'Alex Common',structuralRevision:mode==='cell'?'cell':'row'})});
    await worker.task(nextAmendmentTask(store,generation));
    assertWithheld();
    const extraction=store.source(generation,'amendment:list:'+singleListId).work.extraction;
    assert.equal(extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);assert(extraction.gaps.some(gap=>gap.code==='structural-revision'&&gap.number===1));
    assert(extraction.amendments[0].gaps.some(gap=>gap.code==='structural-revision'&&gap.number===1));
    assert.equal(extraction.amendments[0].wordingRetained,false);
    enqueueAmendment(store,generation,'tracked-deletion-safe-refresh','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
    worker.downloadAmendmentDocx=async()=>({buffer:comparisonDocx([['','Safe current proposal']],{author:'Alex Common',structuralRevision:'historical-cell'})});
    await worker.task(nextAmendmentTask(store,generation));
    const safe=record();assert.equal(safe.originalText,'');assert.equal(safe.proposedText,'Safe current proposal');assert.equal(safe.textIntegrity,'complete');
    assert.equal(safe.authors[0].personId,'101');assert.equal(safe.proposerDate,tabled);assert.equal(safe.proposerDateBasis,'individual-amendment-document');
    assert.equal(safe.textParserVersion,AMENDMENT_EXTRACTION_VERSION);assert.equal(safe.wordingRetained,false);
  }
});

test('cached legacy wording and unsupported author links are sanitized immediately without rewriting rollback evidence',t=>{
  for(const mode of ['legacy-single','legacy-variants','current-empty']) {
    const {store,generation}=setup(t),oldSource={url:'https://data.europarl.europa.eu/distribution/example/cached_v6_en.docx',fetchedAt:earlier,language:'en'};
    saveAmendmentRows(store,generation,metadata,[row(1)],coverage);
    const unsupportedAuthor={name:'Alex Common',personId:'101',method:'full_name',status:'resolved',evidence:[]};
    const legacy={listId,originalText:'Apparent complete original',proposedText:'Apparent complete proposal',textParserVersion:'6',textIntegrity:'complete',documentDate:null,listDocumentDate:null,proposerDate:target.document_date,proposerDateBasis:null,authors:[unsupportedAuthor],gaps:[],sources:[oldSource],wordingSource:oldSource};
    const valid={listId:targetId+'-AM-001-002',originalText:'',proposedText:'',textParserVersion:AMENDMENT_EXTRACTION_VERSION,textIntegrity:'complete',proposerDate:tabled,proposerDateBasis:'individual-amendment-document',documentDate:tabled,authors:[],gaps:[],sources:[oldSource]};
    const cached=row(1,mode==='legacy-single'?legacy:mode==='current-empty'?valid:{...legacy,listId:null,originalText:null,proposedText:null,authors:[],conflicted:true,variants:[legacy,valid]});
    const raw=JSON.stringify(cached);
    store.db.prepare('UPDATE amendments SET body=? WHERE generation=? AND id=?').run(raw,generation,cached.id);
    const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
    if(mode==='current-empty') {
      assert.equal(item.originalText,'');assert.equal(item.proposedText,'');assert.equal(item.textIntegrity,'complete');assert.equal(page.coverage.complete,true);
    } else {
      const record=mode==='legacy-variants'?item.variants[0]:item;
      assert.equal(record.originalText,null);assert.equal(record.proposedText,null);assert.equal(record.textIntegrity,'incomplete');
      assert.equal(record.proposerDate,null);assert.equal(record.proposerDateBasis,null);assert.equal(record.authors[0].personId,null);assert.equal(record.authors[0].status,'missing_proposer_date');
      assert.equal(page.coverage.complete,false);assert(page.coverage.gaps.some(gap=>/wording|parser|unverified/i.test(gap)));
      if(mode==='legacy-variants'){assert.equal(item.variants[1].originalText,'');assert.equal(item.variants[1].proposedText,'');}
    }
    assert.equal(amendmentsPage(store,{member:'101'}).total,0);
    assert.equal(store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,cached.id).body,raw);
  }
});

test('rebuilding or delaying a failed extraction cannot serve apparently complete wording from parser v6',async t=>{
  for(const legacyLocation of ['extraction','record']) {
    const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001';
    const oldUrl='https://data.europarl.europa.eu/distribution/example/apparent_complete_v6_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/failed_v7_en.docx';
    const published=list([amendment(1)],{id:'eli/dl/doc/'+singleListId,identifier:singleListId,foresees_change_of:[target.id],files:[{format:'DOCX',language:'en',url:newUrl}]});
    published.extraction={...published.extraction,parserVersion:legacyLocation==='extraction'?'6':AMENDMENT_EXTRACTION_VERSION,amendments:published.extraction.amendments.map(amendment=>({...amendment,...(legacyLocation==='record'?{wordingParserVersion:'6'}:{})})),sourceUrl:oldUrl,gaps:[]};
    store.putSource(generation,'/plenary-documents/'+targetId,'document',{...target,inverse_foresees_change_of:[published]},earlier);
    store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',published,earlier);
    const sourceBefore=store.db.prepare('SELECT body FROM sources WHERE generation=? AND key=?').get(generation,'amendment:list:'+singleListId).body;
    const assertWithheld=()=>{
      const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
      assert.equal(item.originalText,null);assert.equal(item.proposedText,null);assert.equal(item.textIntegrity,'incomplete');assert.equal(page.coverage.complete,false);
    };
    rebuildAmendmentTarget(worker,generation,targetId);assertWithheld();
    enqueueAmendment(store,generation,'delayed-v7-extraction','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
    assertWithheld();
    worker.downloadAmendmentDocx=async()=>{throw new Error('Offline failed refresh');};
    await assert.rejects(worker.task(nextAmendmentTask(store,generation)),/Offline failed refresh/);
    rebuildAmendmentTarget(worker,generation,targetId);assertWithheld();
    assert.equal(store.db.prepare('SELECT body FROM sources WHERE generation=? AND key=?').get(generation,'amendment:list:'+singleListId).body,sourceBefore);
    worker.downloadAmendmentDocx=async()=>({buffer:comparisonDocx([['Damaged fresh original','Damaged fresh proposal'],['Unsupported','Extra','Column']],{author:null})});
    await worker.task(nextAmendmentTask(store,generation));
    assertWithheld();
    assert.equal(store.source(generation,'amendment:list:'+singleListId).work.extraction.amendments[0].wordingRetained,false);
  }
});

test('cached unsupported and invalid calendar dates agree between API sanitation and the member filter',t=>{
  for(const [proposerDate,proposerDateBasis] of [[target.document_date,null],['2026-02-30','individual-amendment-document']]) {
    const {store,generation}=setup(t);
    saveAmendmentRows(store,generation,metadata,[row(1)],coverage);
    const cached=row(1,{documentDate:null,listDocumentDate:null,proposerDate,proposerDateBasis,authors:[{name:'Alex Common',personId:'101',status:'resolved',evidence:[]}],originalText:'Current original',proposedText:'Current proposal'}),raw=JSON.stringify(cached);
    store.db.prepare('UPDATE amendments SET body=? WHERE generation=? AND id=?').run(raw,generation,cached.id);
    const [item]=amendmentsPage(store,{document:targetId}).items;
    assert.equal(item.proposerDate,null);assert.equal(item.proposerDateBasis,null);assert.equal(item.authors[0].personId,null);assert.equal(item.authors[0].status,'missing_proposer_date');
    assert.equal(item.originalText,'Current original');assert.equal(item.proposedText,'Current proposal');
    assert.equal(amendmentsPage(store,{member:'101'}).total,0);
    assert.equal(store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,cached.id).body,raw);
  }
});

test('saving retained proposer evidence preserves an unknown date rather than borrowing fresh documentary dates',t=>{
  const {store,generation}=setup(t),oldSource={url:'https://data.europarl.europa.eu/distribution/example/unknown_proposer_date_en.docx',fetchedAt:earlier,language:'en'},freshDate='2026-10-06';
  const accepted=row(1,{listId,documentDate:null,listDocumentDate:null,proposerDate:null,proposerDateBasis:null,authors:[{name:'Alex Common',personId:null,status:'missing_proposer_date',evidence:[]}],proposerSource:oldSource});
  saveAmendmentRows(store,generation,metadata,[accepted],{...coverage,complete:false});
  saveAmendmentRows(store,generation,metadata,[row(1,{listId,date:freshDate,documentDate:freshDate,listDocumentDate:freshDate,proposerDate:freshDate,proposerDateBasis:'individual-amendment-document',authors:[],proposerSource:{url:'https://data.europarl.europa.eu/distribution/example/fresh_without_proposers_en.docx',fetchedAt,language:'en'}})],coverage);
  const persisted=JSON.parse(store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,accepted.id).body);
  assert.equal(persisted.proposerDate,null);assert.equal(persisted.proposerDateBasis,null);assert.equal(persisted.proposerRetained,true);assert.deepEqual(persisted.proposerSource,oldSource);
  assert.equal(persisted.authors[0].personId,null);assert.equal(persisted.authors[0].status,'missing_proposer_date');
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.documentDate,freshDate);assert.equal(item.proposerDate,null);assert.equal(item.authors[0].personId,null);assert.equal(amendmentsPage(store,{member:'101'}).total,0);
});

test('a report date cannot substitute for missing amendment proposer dates, including conflicting variants',t=>{
  for(const conflicting of [false,true]) {
    const {store,worker,generation}=setup(t),firstId=targetId+'-AM-001-001',secondId=targetId+'-AM-001-002';
    const undated=id=>list([amendment(1,{date:null,proposerDate:null,authors:['Alex Common']})],{id:'eli/dl/doc/'+id,identifier:id,document_date:null,foresees_change_of:[target.id]});
    const lists=[undated(firstId),...(conflicting?[undated(secondId)]:[])];
    store.putSource(generation,'/plenary-documents/'+targetId,'document',{...target,inverse_foresees_change_of:lists},earlier);
    for(const published of lists)store.putSource(generation,'amendment:list:'+published.identifier,'amendment-list',published,earlier);
    store.putSource(generation,'amendment:roster:'+target.document_date,'amendment-roster',{members:[{id:'101',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+target.document_date,fetchedAt:earlier}]},earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    const [item]=amendmentsPage(store,{document:targetId}).items;
    assert.equal(item.proposerDate,null);assert.equal(amendmentsPage(store,{member:'101'}).total,0);
    for(const record of conflicting?item.variants:[item]) {
      assert.equal(record.documentDate,null);assert.equal(record.listDocumentDate,null);assert.equal(record.proposerDate,null);assert.equal(record.proposerDateBasis,null);
      assert.equal(record.authors[0].name,'Alex Common');assert.equal(record.authors[0].personId,null);assert.equal(record.authors[0].status,'missing_proposer_date');
      assert(record.gaps.some(gap=>/proposer.*date/i.test(gap)&&/missing|unavailable|not recorded/i.test(gap)));
    }
    const persisted=JSON.parse(store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,item.id).body);
    for(const record of conflicting?persisted.variants:[persisted]){assert.equal(record.proposerDate,null);assert.equal(record.proposerDateBasis,null);assert.equal(record.authors[0].personId,null);}
  }
});

test('an undated parser migration cannot persist a report-derived proposer date from a cached row or variant',async t=>{
  for(const conflicting of [false,true]) {
    const {store,worker,generation}=setup(t),firstId=targetId+'-AM-001-001',secondId=targetId+'-AM-001-002';
    const oldUrl='https://data.europarl.europa.eu/distribution/example/no_proposer_date_old_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/no_proposer_date_new_en.docx';
    const oldSource={url:oldUrl,fetchedAt:earlier,language:'en'},oldParserVersion=String(Number(AMENDMENT_EXTRACTION_VERSION)-1);
    const baseline=extractAmendments(comparisonDocx([['Old original','Old proposal']],{author:'Alex Common',date:null}),{listId:firstId,targetDocumentId:targetId,language:'en',sourceUrl:oldUrl,fetchedAt:earlier});
    const makeList=id=>({...list([]),id:'eli/dl/doc/'+id,identifier:id,document_date:null,foresees_change_of:[target.id],files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{...baseline,parserVersion:oldParserVersion}});
    const lists=[makeList(firstId),...(conflicting?[makeList(secondId)]:[])];
    store.putSource(generation,'/plenary-documents/'+targetId,'document',{...target,inverse_foresees_change_of:lists},earlier);
    for(const published of lists)store.putSource(generation,'amendment:list:'+published.identifier,'amendment-list',published,earlier);
    // An earlier model cached its report-date presentation fallback before a
    // roster was available. It is not dated amendment proposer evidence.
    const cachedVariant=id=>({listId:id,date:target.document_date,documentDate:null,listDocumentDate:null,proposerDate:target.document_date,proposerDateBasis:null,proposerSource:oldSource,authors:[],originalText:'Old original',proposedText:'Old proposal',textParserVersion:oldParserVersion,gaps:[],sources:[oldSource]});
    saveAmendmentRows(store,generation,metadata,[row(1,{...cachedVariant(firstId),...(conflicting?{listId:null,conflicted:true,variants:lists.map(published=>cachedVariant(published.identifier))}:{})})],{...coverage,complete:false});
    store.putSource(generation,'amendment:roster:'+target.document_date,'amendment-roster',{members:[{id:'101',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+target.document_date,fetchedAt:earlier}]},earlier);
    worker.downloadAmendmentDocx=async()=>({buffer:comparisonDocx([['Fresh original','Fresh proposal']],{author:null,date:null})});
    enqueueAmendment(store,generation,'undated-migration','amendment-extract',{listId:firstId,targetDocumentId:targetId});
    await worker.task(nextAmendmentTask(store,generation));
    const refreshed=store.source(generation,'amendment:list:'+firstId).work.extraction.amendments[0];
    assert.equal(refreshed.proposerDate,null);assert.deepEqual(refreshed.authors,['Alex Common']);assert.equal(refreshed.proposerRetained,true);
    const [item]=amendmentsPage(store,{document:targetId}).items;
    assert.equal(item.proposerDate,null);assert.equal(amendmentsPage(store,{member:'101'}).total,0);
    for(const record of conflicting?item.variants:[item]) {
      assert.equal(record.proposerDate,null);assert.equal(record.proposerDateBasis,null);assert.equal(record.authors[0].personId,null);assert.equal(record.authors[0].status,'missing_proposer_date');
      assert(record.gaps.some(gap=>/proposer.*date/i.test(gap)&&/missing|unavailable|not recorded/i.test(gap)));
    }
    const persisted=JSON.parse(store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,item.id).body);
    for(const record of conflicting?persisted.variants:[persisted]){assert.equal(record.proposerDate,null);assert.equal(record.proposerDateBasis,null);assert.equal(record.authors[0].personId,null);}
  }
});

test('finishing a dated roster rebuilds the target that retains its older proposer date after fresh dates change',async t=>{
  const {store,worker,generation}=setup(t),freshDate='2026-10-06',singleListId=targetId+'-AM-001-001';
  const oldSource={url:'https://data.europarl.europa.eu/distribution/example/retained_proposer_old_en.docx',fetchedAt:earlier,language:'en'};
  const published=list([amendment(1,{authors:['Alex Common'],date:freshDate,proposerDate:tabled,proposerDateBasis:'individual-amendment-document',proposerRetained:true,proposerSource:oldSource})],{id:'eli/dl/doc/'+singleListId,identifier:singleListId,document_date:freshDate,foresees_change_of:[target.id]});
  store.putSource(generation,'/plenary-documents/'+targetId,'document',{...target,inverse_foresees_change_of:[published]},earlier);
  store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',published,earlier);
  store.putSource(generation,'amendment:roster:'+freshDate,'amendment-roster',{members:[{id:'102',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+freshDate,fetchedAt:earlier}]},earlier);
  rebuildAmendmentTarget(worker,generation,targetId);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].authors[0].personId,null);
  const offsets=[];
  worker.fetchRecord=async(endpoint,params)=>{
    assert.equal(endpoint,'/meps/show-current');assert.equal(params['mandate-date'],tabled);offsets.push(params.offset);
    return {fetchedAt,payload:{data:params.offset?[]:[{identifier:'101',givenName:'Alex',familyName:'Common'}]}};
  };
  enqueueAmendment(store,generation,'retained-proposer-roster','amendment-roster',{date:tabled,offset:0,members:[],sources:[]},114);
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(store.source(generation,'amendment:roster:'+tabled),undefined);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].authors[0].personId,null);
  await worker.task(nextAmendmentTask(store,generation));
  assert.deepEqual(offsets,[0,1]);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.authors[0].personId,'101');assert.equal(item.proposerDate,tabled);assert.equal(item.proposerDateBasis,'individual-amendment-document');assert.deepEqual(item.proposerSource,oldSource);
  assert.equal(item.documentDate,freshDate);assert.equal(item.listDocumentDate,freshDate);assert.equal(item.proposerRetained,true);
  assert.equal(item.authors[0].evidence.find(evidence=>evidence.type==='full_name').date,tabled);
  assert.equal(amendmentsPage(store,{member:'101'}).total,1);assert.equal(amendmentsPage(store,{member:'102'}).total,0);
});

test('an accepted proposer snapshot cannot lend its date to a different source URL or retrieval',async t=>{
  for(const changed of ['url','fetchedAt']) {
    const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001',freshDate='2026-10-06';
    const oldSource={url:'https://data.europarl.europa.eu/distribution/example/proposer_snapshot_old_en.docx',fetchedAt:earlier,language:'en'};
    const observedSource={...oldSource,...(changed==='url'?{url:'https://data.europarl.europa.eu/distribution/example/proposer_snapshot_replaced_en.docx'}:{fetchedAt})};
    const downloadUrl='https://data.europarl.europa.eu/distribution/example/proposer_snapshot_refresh_en.docx';
    store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
    const published=list([amendment(1,{authors:['Alex Common'],date:null})],{id:'eli/dl/doc/'+singleListId,identifier:singleListId,document_date:freshDate,files:[{format:'DOCX',language:'en',url:downloadUrl}]});
    published.extraction={...published.extraction,sourceUrl:observedSource.url,fetchedAt:observedSource.fetchedAt};
    store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',published,observedSource.fetchedAt);
    saveAmendmentRows(store,generation,metadata,[row(1,{listId:singleListId,documentDate:null,listDocumentDate:tabled,proposerDate:tabled,proposerDateBasis:'amendment-list-metadata',proposerSource:oldSource,authors:[{name:'Alex Common',personId:'101',status:'resolved',evidence:[]}]})],coverage);
    for(const [date,id] of [[tabled,'101'],[freshDate,'102']])store.putSource(generation,'amendment:roster:'+date,'amendment-roster',{members:[{id,givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+date,fetchedAt:earlier}]},earlier);
    worker.downloadAmendmentDocx=async()=>({buffer:comparisonDocx([['Fresh original','Fresh proposal']],{author:null,date:null})});
    enqueueAmendment(store,generation,'changed-proposer-snapshot','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
    await worker.task(nextAmendmentTask(store,generation));
    const [item]=amendmentsPage(store,{document:targetId}).items;
    assert.equal(item.authors[0].personId,'102',changed);assert.equal(item.proposerDate,freshDate);assert.equal(item.proposerDateBasis,'amendment-list-metadata');
    assert.deepEqual(item.proposerSource,observedSource);assert.equal(item.proposerRetained,true);
    assert.equal(amendmentsPage(store,{member:'101'}).total,0);assert.equal(amendmentsPage(store,{member:'102'}).total,1);
    const persisted=JSON.parse(store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,item.id).body);
    assert.equal(persisted.proposerDate,freshDate);assert.equal(persisted.authors[0].personId,'102');
  }
});

test('an undated proposer retains the original list-date mandate basis across metadata changes and incompatible wording migration',async t=>{
  for(const evidenceKind of ['dated-roster','mandate-profile']) {
    const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001',newListDate='2026-10-06';
    const oldUrl='https://data.europarl.europa.eu/distribution/example/undated_proposer_v6_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/undated_proposer_v7_en.docx';
    const baseline=extractAmendments(comparisonDocx([['Legacy complete original','Legacy complete proposal']],{author:'Alex Common',date:null}),{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:oldUrl,fetchedAt:earlier});
    assert.equal(baseline.amendments[0].date,null);
    store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
    store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,document_date:tabled,files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{...baseline,sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:'6'}},earlier);
    if(evidenceKind==='dated-roster')for(const [date,id] of [[tabled,'101'],[newListDate,'102']])store.putSource(generation,'amendment:roster:'+date,'amendment-roster',{members:[{id,givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+date,fetchedAt:earlier}]},earlier);
    else for(const [id,start,end] of [['101','2024-07-16',tabled],['102',newListDate,null]])store.putSource(generation,'amendment:member:'+id,'amendment-member',{id,givenName:'Alex',familyName:'Common',hasMembership:[{role:'def/ep-roles/MEMBER_PARLIAMENT',memberDuring:{startDate:start,...(end?{endDate:end}:{})}}],sourceUrl:'https://data.europarl.europa.eu/api/v2/meps/'+id,fetchedAt:earlier},earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    assert.equal(amendmentsPage(store,{document:targetId}).items[0].authors[0].personId,'101');
    const old=store.source(generation,'amendment:list:'+singleListId);
    store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...old.work,document_date:newListDate},old.fetchedAt);
    const fresh=comparisonDocx([['Damaged new row','New proposal'],['Unsupported','Extra','Column']],{author:null,date:null});
    worker.downloadAmendmentDocx=async()=>({buffer:fresh});
    enqueueAmendment(store,generation,'undated-proposer-migration','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
    await worker.task(nextAmendmentTask(store,generation));
    const [item]=amendmentsPage(store,{document:targetId}).items;
    assert.notEqual(AMENDMENT_EXTRACTION_VERSION,'6');
    assert.equal(item.originalText,null);assert.equal(item.proposedText,null);assert.equal(item.textIntegrity,'incomplete');
    assert.equal(item.listDocumentDate,newListDate);assert.equal(item.documentDate,null);assert.equal(item.date,newListDate);
    assert.equal(item.authors[0].personId,'101');assert.equal(amendmentsPage(store,{member:'102'}).total,0);
    assert.equal(item.proposerDate,tabled);assert.equal(item.proposerRetained,true);
    assert.equal(item.proposerDateBasis,'amendment-list-metadata');
    assert.deepEqual(item.proposerSource,{url:oldUrl,fetchedAt:earlier,language:'en'});
    const matched=item.authors[0].evidence.find(evidence=>evidence.type==='full_name'&&evidence.personId===101);
    assert.equal(matched.date,tabled);assert(matched.activeMandate);
    if(evidenceKind==='mandate-profile')assert.equal(new URL(matched.sourceUrl).pathname,'/api/v2/meps/101');
    else assert(item.authors[0].evidence.some(evidence=>evidence.type==='dated_roster'&&evidence.mandateObservedOn===tabled));
    const persisted=JSON.parse(store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,item.id).body);
    assert.equal(persisted.proposerDate,tabled);assert.equal(persisted.proposerDateBasis,'amendment-list-metadata');assert.equal(persisted.authors[0].personId,'101');
  }
});

test('a failed v3 parse cannot resurrect structurally incomplete wording cached by extractor v2',async t=>{
  const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001';
  const oldUrl='https://data.europarl.europa.eu/distribution/example/partial_v2_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/refreshed_v3_en.docx';
  const structuralGap={code:'comparison-columns',number:1,message:'A comparison row does not contain exactly two columns.',sourceUrl:oldUrl};
  const cached=amendment(1,{originalText:'Cached first row only',proposedText:'Cached proposed first row only'});
  store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
  store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,files:[{format:'DOCX',language:'en',url:newUrl}],extraction:{amendments:[cached],gaps:[structuralGap],sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:'2'}},earlier);
  saveAmendmentRows(store,generation,metadata,[row(1,{originalText:cached.originalText,proposedText:cached.proposedText,splitParts:[],sources:[{url:oldUrl,fetchedAt:earlier}]})],{...coverage,complete:false});
  const damaged=comparisonDocx([['Fresh first row','Fresh proposed first row'],['Unsupported second row','Second proposal','Extra column']]);
  worker.downloadAmendmentDocx=async()=>({buffer:damaged});
  enqueueAmendment(store,generation,'v2-to-v3','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
  await worker.task(nextAmendmentTask(store,generation));
  const saved=store.source(generation,'amendment:list:'+singleListId);
  assert.equal(saved.fetchedAt,fetchedAt);assert.equal(saved.work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
  assert.equal(saved.work.extraction.amendments[0].originalText,null);assert.equal(saved.work.extraction.amendments[0].proposedText,null);
  assert(saved.work.extraction.gaps.some(gap=>gap.code==='comparison-columns'));
  const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
  assert.equal(item.originalText,null);assert.equal(item.proposedText,null);
  assert.equal(item.textIntegrity,'incomplete');
  assert.equal(page.coverage.complete,false);
});

test('missing authors or non-English text alone do not reject otherwise complete refreshed columns',async t=>{
  for(const options of [{author:null,language:'en'},{author:'Bruno Gonçalves',language:'fr'}]) {
    const {store,worker,generation}=setup(t),singleListId=targetId+'-AM-001-001';
    const oldUrl='https://data.europarl.europa.eu/distribution/example/accepted_en.docx',newUrl='https://data.europarl.europa.eu/distribution/example/refreshed_'+options.language+'.docx';
    const accepted=extractAmendments(comparisonDocx([['Before one','After one'],['Before two','After two']]),{listId:singleListId,targetDocumentId:targetId,language:'en',sourceUrl:oldUrl,fetchedAt:earlier});
    const complete=comparisonDocx([['Fresh original one','Fresh proposal one'],['Fresh original two','Fresh proposal two']],options);
    store.putSource(generation,'/plenary-documents/'+targetId,'document',target,earlier);
    store.putSource(generation,'amendment:list:'+singleListId,'amendment-list',{...list([]),id:'eli/dl/doc/'+singleListId,identifier:singleListId,files:[{format:'DOCX',language:options.language,url:newUrl}],extraction:{...accepted,sourceUrl:oldUrl,fetchedAt:earlier,language:'en',parserVersion:AMENDMENT_EXTRACTION_VERSION}},earlier);
    worker.downloadAmendmentDocx=async()=>({buffer:complete});
    enqueueAmendment(store,generation,'complete-comparison','amendment-extract',{listId:singleListId,targetDocumentId:targetId});
    await worker.task(nextAmendmentTask(store,generation));
    const saved=store.source(generation,'amendment:list:'+singleListId);
    assert.equal(saved.fetchedAt,fetchedAt);assert.equal(saved.work.extraction.sourceUrl,newUrl);
    assert.equal(saved.work.extraction.lastRefreshFailure,undefined);
    assert.equal(saved.work.extraction.amendments[0].originalText,'Fresh original one\nFresh original two');
    assert.equal(saved.work.extraction.amendments[0].proposedText,'Fresh proposal one\nFresh proposal two');
    assert.equal(saved.work.extraction.amendments[0].language,options.language);
    if(!options.author)assert(saved.work.extraction.gaps.some(gap=>gap.code==='authors-unavailable'));
    if(options.language==='fr')assert(amendmentsPage(store,{document:targetId}).items[0].gaps.some(gap=>gap.includes('English amendment text is unavailable')));
  }
});

test('a partial extraction refresh retains accepted wording and dates and reports the failed refresh',async t=>{
  const {store,worker,generation}=setup(t);
  const file={format:'DOCX',language:'en',url:'https://data.europarl.europa.eu/distribution/example/amendments_en.docx'};
  seedTarget(store,generation,[amendment(1),amendment(2)]);
  const previous=store.source(generation,'amendment:list:'+listId).work;
  store.putSource(generation,'amendment:list:'+listId,'amendment-list',{...previous,files:[file]},earlier);
  let downloads=0;
  worker.downloadAmendmentDocx=async url=>{assert.equal(url,file.url);downloads++;return {buffer:docx('<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>&lt;Amend&gt;&lt;Date&gt;2.10.2026&lt;/Date&gt;&lt;NumAm&gt;1&lt;/NumAm&gt;</w:t></w:r></w:p><w:p><w:r><w:t>&lt;/Amend&gt;</w:t></w:r></w:p></w:body></w:document>')};};
  enqueueAmendment(store,generation,'partial','amendment-extract',{listId,targetDocumentId:targetId});
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(downloads,1);
  const accepted=store.source(generation,'amendment:list:'+listId);
  assert.equal(accepted.fetchedAt,fetchedAt);
  assert.deepEqual(accepted.work.extraction.amendments.map(item=>item.number),[1,2]);
  assert.deepEqual(accepted.work.extraction.lastRefreshFailure.missingAmendmentNumbers,['2']);
  const page=amendmentsPage(store,{document:targetId});
  assert.deepEqual(page.items.map(item=>item.proposedText),['Proposal 1','Proposal 2']);
  assert(page.items.every(item=>item.wordingSource.fetchedAt===earlier&&item.wordingRetained));
  assert(page.coverage.gaps.some(gap=>/refresh|partial|extract/i.test(gap)));
  assert.equal(page.coverage.complete,false);
});

test('partial amendment refreshes retain accepted rows while the activity generation is still building',t=>{
  const {store,generation}=setup(t);
  saveAmendmentRows(store,generation,metadata,[row(1,{proposedText:'Accepted one'}),row(2,{proposedText:'Accepted two'})],coverage);
  store.publish(generation);
  const next=store.beginCycle();
  saveAmendmentRows(store,next.generation,metadata,[row(1,{proposedText:'Refreshed one'})],{...coverage,complete:false,gaps:['A source is unavailable.']});
  enqueueAmendment(store,next.generation,'pending','amendment-extract',{listId});
  const page=amendmentsPage(store,{document:targetId,language:'fr'});
  assert.equal(page.coverage.servingGeneration,next.generation);
  assert.equal(page.coverage.pending,true);assert.equal(page.coverage.complete,false);
  assert.deepEqual(page.items.map(item=>item.proposedText),['Refreshed one','Accepted two']);
  assert(page.items.every(item=>item.title==='Un rapport public'));
  store.finishTask(nextAmendmentTask(store,next.generation));
  store.publish(next.generation);
  const updated=amendmentsPage(store,{document:targetId});
  assert.equal(updated.total,2);
  assert.equal(updated.items[1].proposedText,'Accepted two');
  assert(updated.items[1].gaps.some(gap=>gap.includes('latest partial refresh')));
  assert.equal(updated.coverage.complete,false);
});

test('a same-ID incomplete refresh retains accepted components while an explicit empty legal cell remains valid',t=>{
  const {store,generation}=setup(t);
  const accepted=row(1,{originalText:'Before',proposedText:'After',targetLabel:'Article 1',language:'en',authors:[{name:'Bruno G.',personId:'101',status:'resolved'}],decisions:[{id:sitting+'-DEC-1',outcome:'ADOPTED'}],sources:[{url:sourceUrl,fetchedAt:earlier}]});
  saveAmendmentRows(store,generation,metadata,[accepted],coverage);
  saveAmendmentRows(store,generation,metadata,[row(1,{originalText:null,proposedText:null,authors:[{name:'Bruno G.',personId:null,status:'missing'}],sources:[]})],{...coverage,complete:false,gaps:['A source is unavailable.']});
  let page=amendmentsPage(store,{document:targetId});
  assert.equal(page.items[0].originalText,'Before');assert.equal(page.items[0].proposedText,'After');
  assert.equal(page.items[0].authors[0].personId,'101');
  assert.equal(page.items[0].outcome,'ADOPTED');
  assert(page.items[0].sources.some(source=>source.url===sourceUrl&&source.fetchedAt===earlier));
  assert.equal(page.coverage.complete,false);
  saveAmendmentRows(store,generation,metadata,[row(1,{originalText:'',proposedText:'Inserted wording',sources:[]})],coverage);
  page=amendmentsPage(store,{document:targetId});
  assert.equal(page.items[0].originalText,'');
  assert.equal(page.items[0].proposedText,'Inserted wording');
});

test('fresh conflicting or inactive author evidence clears an accepted link while missing evidence retains its history',t=>{
  const name='Alex Common',active={id:'101',givenName:'Alex',familyName:'Common',mandates:[{start:'2024-07-16',end:null}]};
  const resolve=members=>resolveAmendmentAuthors([name],{members,date:tabled}).map(author=>({...author,personId:author.personId==null?null:String(author.personId)}));
  const cases=[
    ['ambiguous',[active,{...active,id:'102'}],false],
    ['inactive',[{...active,mandates:[{start:'2024-07-16',end:'2026-09-01'}]}],false],
    ['missing',[],true],
    ['missing_mandate',[{...active,mandates:[]}],true],
  ];
  for(const [status,members,retain] of cases) {
    const {store,generation}=setup(t);
    saveAmendmentRows(store,generation,metadata,[row(1,{authors:resolve([active])})],coverage);
    assert.equal(amendmentsPage(store,{member:'101'}).total,1);
    const fresh=resolve(members);assert.equal(fresh[0].status,status);
    saveAmendmentRows(store,generation,metadata,[row(1,{authors:fresh})],{...coverage,complete:false});
    const [item]=amendmentsPage(store,{document:targetId}).items;
    assert.equal(item.authors[0].personId,retain?'101':null,status);
    assert.equal(amendmentsPage(store,{member:'101'}).total,retain?1:0,status);
    if(retain) {
      assert.equal(item.authors[0].latestResolution.status,status);
      assert(item.retainedComponents.includes('author identity'));
    } else {
      assert.equal(item.authors[0].status,status);
      assert.deepEqual(item.authors[0].evidence,fresh[0].evidence);
    }
  }
});

test('an explicit committee proposer correction clears individual author links while missing proposer evidence retains history',t=>{
  for(const committeeCorrection of [true,false]) {
    const {store,worker,generation}=setup(t);
    seedTarget(store,generation,[amendment(1,{authors:['Alex Common']})]);
    store.putSource(generation,'amendment:roster:'+tabled,'amendment-roster',{members:[{id:'101',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+tabled,fetchedAt:earlier}]},earlier);
    rebuildAmendmentTarget(worker,generation,targetId);
    assert.equal(amendmentsPage(store,{member:'101'}).total,1);
    const committee='Committee on the Environment, Climate and Food Safety';
    const corrected=amendment(1,{authors:[],...(committeeCorrection?{committeeProposer:committee}:{}),gaps:committeeCorrection?[]:[{code:'authors-unavailable',message:'No proposer evidence was available in this extraction.'}]});
    store.putSource(generation,'amendment:list:'+listId,'amendment-list',list([corrected]),fetchedAt);
    rebuildAmendmentTarget(worker,generation,targetId);
    const [item]=amendmentsPage(store,{document:targetId}).items;
    assert.equal(amendmentsPage(store,{member:'101'}).total,committeeCorrection?0:1);
    if(committeeCorrection) {
      assert.deepEqual(item.authors,[]);assert.equal(item.committeeProposer,committee);
    } else {
      assert.equal(item.authors[0].personId,'101');assert.equal(item.committeeProposer,null);
      assert(item.retainedComponents.includes('authors'));
      assert(item.gaps.some(gap=>gap.includes('retained')));
    }
  }
});

test('split failure and amendment writes require the existing index writer lease',t=>{
  const {store,generation}=setup(t);
  const result=parseSplitRequest(request([part(1,'Unpublished instructions')]),{sourceUrl,fetchedAt});
  store.release();
  assert.throws(()=>recordSplitResults(store,result),/writer lease/);
  assert.throws(()=>saveAmendmentRows(store,generation,metadata,[row(1)],coverage),/writer lease/);
  assert.equal(amendmentFailures(store).total,0);
  assert.equal(amendmentsPage(store).total,0);
});

test('empty pages explicitly report missing coverage and never imply an amendment count of zero is complete',t=>{
  const {store}=setup(t);
  const all=amendmentsPage(store),specific=amendmentsPage(store,{document:targetId});
  assert.equal(all.total,0);assert.equal(all.coverage.complete,false);
  assert(all.coverage.gaps.includes('Amendment discovery is incomplete.'));
  assert.equal(specific.coverage.complete,false);
  assert(specific.coverage.gaps.includes('This document has no indexed amendment records.'));
  assert.equal(amendmentOutcome([]),'unavailable');
  assert.equal(amendmentOutcome([{outcome:'ADOPTED'},{outcome:'unavailable'}]),'unavailable');
});

test('amendment discovery accepts only explicit list and target relationships',t=>{
  const {store,worker,generation}=setup(t);
  const linked={...list([]),foresees_change_of:[target.id]};
  const wrong={...linked,identifier:'A-10-2026-9999-AM-001-004',foresees_change_of:['eli/dl/doc/A-10-2026-9999']};
  const ambiguous={...linked,identifier:'A-10-2026-9998-AM-001-004',foresees_change_of:[]};
  const work={...target,inverse_foresees_change_of:[linked,wrong,ambiguous,'eli/dl/doc/'+listId]};
  assert.deepEqual(amendmentLists(work).map(item=>item.identifier),[listId]);
  store.putSource(generation,'/plenary-documents/'+targetId,'document',work,fetchedAt);
  scheduleAmendments(worker,generation,work,fetchedAt,'/plenary-documents/'+targetId);
  const jobs=store.db.prepare("SELECT body FROM amendment_jobs WHERE kind='amendment-extract'").all().map(job=>JSON.parse(job.body));
  assert.equal(jobs.length,1);assert.equal(jobs[0].listId,listId);
  assert.equal(amendmentReference('eli/dl/doc/'+targetId+'-AM-0'),null);
  assert.equal(amendmentReference('eli/dl/doc/'+targetId+'-AM-001-004'),null);
  assert.equal(amendmentReference('https://unrelated.example/eli/dl/doc/'+targetId+'-AM-1'),null);
  assert.equal(amendmentReference('eli/dl/event/'+targetId+'-AM-1'),null);
});

test('the published amendment-list processing limit remains an explicit gap after later target rebuilds',t=>{
  const {store,worker,generation}=setup(t);
  const publishedLists=Array.from({length:65},(_,index)=>{
    const number=index+1,padded=String(number).padStart(3,'0'),id=targetId+'-AM-'+padded+'-'+padded;
    const url='https://data.europarl.europa.eu/distribution/example/amendment-'+number+'_en.docx';
    return {id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/AMENDMENT_LIST',document_date:tabled,foresees_change_of:[target.id],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:url}]}]};
  });
  const work={...target,inverse_foresees_change_of:publishedLists};
  store.putSource(generation,'/plenary-documents/'+targetId,'document',work,fetchedAt);
  store.putSource(generation,'amendment:roster:'+tabled,'amendment-roster',{members:[{id:'101',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+tabled,fetchedAt}]},fetchedAt);
  for(const [index,published] of publishedLists.slice(0,64).entries()) {
    const stored={...published,targetDocumentId:targetId,extraction:{amendments:[amendment(index+1,{authors:['Alex Common']})],gaps:[],language:'en',sourceUrl:published.is_realized_by[0].is_embodied_by[0].is_exemplified_by,fetchedAt:earlier,parserVersion:AMENDMENT_EXTRACTION_VERSION}};
    store.putSource(generation,'amendment:list:'+published.identifier,'amendment-list',stored,earlier);
  }
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',{...completeSitting(),parsedSplits:[],sources:[{url:sourceUrl.replace('/vote-results?','/decisions?'),fetchedAt}],decisions:[decision(1,Array.from({length:64},(_,index)=>'eli/dl/doc/'+targetId+'-AM-'+(index+1)),'ADOPTED')]},fetchedAt);
  store.putSource(generation,'amendment:aliases:'+sitting,'amendment-aliases',{aliases:[]},fetchedAt);
  scheduleAmendments(worker,generation,work,fetchedAt,'/plenary-documents/'+targetId);
  let page=amendmentsPage(store,{document:targetId});
  assert.equal(page.total,64);assert.equal(page.coverage.pending,false);
  assert.equal(page.coverage.complete,false);
  assert(page.coverage.gaps.includes('This target exceeds the amendment-list processing limit.'));
  rebuildAmendmentTarget(worker,generation,targetId);
  page=amendmentsPage(store,{document:targetId});
  assert.equal(page.coverage.pending,false);assert.equal(page.coverage.complete,false);
  assert(page.coverage.gaps.includes('This target exceeds the amendment-list processing limit.'));
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM sources WHERE generation=? AND kind='amendment-list'").get(generation).n,64);
});

test('amendment and failure queries reject unsupported, repeated, malformed and unbounded inputs',()=>{
  const valid=amendmentQuery(new URLSearchParams({document:targetId,procedure:'2025-0233',member:'101',outcome:'mixed',lang:'fr',limit:'50',offset:'10'}));
  assert.equal(valid.document,targetId);assert.equal(valid.member,'101');assert.equal(valid.language,'fr');
  for(const query of ['document='+targetId+'&document='+targetId,'unknown=x','document='+targetId+'-AM-1','document=A-9-2024-0254','procedure=2025/0233','member=0','member=9007199254740993','outcome=adopted','limit=0','limit=51','limit=1.5','limit=01','offset=-1','offset=1000001','lang=not-a-language']) {
    assert.throws(()=>amendmentQuery(new URLSearchParams(query)),error=>error.status===400,query);
  }
  assert.equal(amendmentQuery(new URLSearchParams('status=unresolved&limit=1'),{failures:true}).status,'unresolved');
  for(const query of ['status=bogus','status=all&status=all','document='+targetId])assert.throws(()=>amendmentQuery(new URLSearchParams(query),{failures:true}),error=>error.status===400,query);
});
