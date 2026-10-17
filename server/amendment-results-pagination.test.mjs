import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityStore } from './activity-index-store.mjs';
import { ActivityWorker } from './activity-index-worker.mjs';
import { AMENDMENT_LINKS_VERSION } from './activity-index-model.mjs';
import { AMENDMENT_SITTING_PROJECTION_VERSION, AMENDMENT_OUTCOME_PROOF_VERSION } from './amendments.mjs';
import { amendmentsPage, amendmentFailures } from './amendments-store.mjs';
import { parseSavedSplits, rebuildAmendmentTarget } from './amendments-worker.mjs';
import { motionSourceKey, projectMotionResults } from './motion-outcomes.mjs';

const targetId='A-10-2026-0254',sitting='MTG-PL-2026-10-07',amendmentId=targetId+'-AM-1';
const componentId='eli/dl/doc/'+sitting+'-VOT-ITM-123-SPLIT-1-1',requestId='eli/dl/event/'+sitting+'-VOT-ITM-123-SPLIT-1';
const resultsEndpoint='/meetings/'+sitting+'/vote-results',decisionsEndpoint='/meetings/'+sitting+'/decisions';
const firstAt='2026-10-17T09:00:00.000Z',laterAt='2026-10-17T09:01:00.000Z',decisionAt='2026-10-17T09:02:00.000Z';
const api='https://data.europarl.europa.eu/api/v2';
const vote=(number=1,{split=true,subject=true}={})=>({id:'eli/dl/event/'+sitting+'-DEC-'+number,had_activity_type:'def/ep-activities/PLENARY_OUTCOME',activity_date:'2026-10-07',decision_outcome:'def/ep-statuses/ADOPTED',decision_method:'def/ep-vote-methods/ROLL_CALL',decided_on_a_realization_of:subject?['eli/dl/doc/'+amendmentId,...(split?[componentId]:[])]:[],inverse_consists_of:['eli/dl/event/'+sitting+'-VOT-ITM-1']});
const result=(number=1,declared=[])=>({id:'eli/dl/event/'+sitting+'-VOT-ITM-'+number,had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',activity_date:'2026-10-07',based_on_a_realization_of:['eli/dl/doc/'+targetId],consists_of:number===1?[vote().id]:[],inverse_consists_of:declared.length?[{id:'eli/dl/event/'+sitting,consists_of:declared}]:[]});
const ignored=number=>({id:'eli/dl/event/'+sitting+'-VOT-ITM-1-ROLLCALL-'+number,had_activity_type:'def/ep-activities/REQUEST_VOTE_ROLLCALL'});
const splitRequest=(malformed=true)=>({id:requestId,had_activity_type:'def/ep-activities/REQUEST_VOTE_SPLIT',created_a_realization_of:[{id:componentId,number:'1',numbering:1,expressionContent:{en:malformed?'<partValue>Unclosed':'<partValue>Text as a whole</partValue>'}}]});

function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-results-pagination-'));
  const store=new ActivityStore(directory,{clock:()=>Date.parse(decisionAt)});
  assert(store.acquire());const {generation}=store.beginCycle();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const worker=new ActivityWorker(store,{clock:()=>Date.parse(decisionAt),fetchRecord:async()=>{throw new Error('Unexpected upstream request in pagination test.');}});
  store.putSource(generation,'/plenary-documents/'+targetId,'document',{id:'eli/dl/doc/'+targetId,identifier:targetId,work_type:'def/ep-document-types/REPORT_PLENARY',document_date:'2026-10-02',amendmentLinksVersion:AMENDMENT_LINKS_VERSION,inverse_foresees_change_of:[],inverse_based_on_a_realization_of:['eli/dl/event/'+sitting+'-VOT-ITM-1']},firstAt);
  return {store,worker,generation};
}
const taskRow=(store,generation,key)=>{
  const row=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key);
  return {...row,body:JSON.parse(row.body)};
};
async function ingest(context,pages,decisions=[vote()],{initial={},key='pagination'}={}) {
  const {store,worker,generation}=context,calls=[];
  worker.fetchRecord=async(endpoint,params)=>{
    calls.push([endpoint,params.offset]);assert.equal(params.limit,50);
    if(endpoint===decisionsEndpoint){assert.equal(params.offset,0);assert.equal(params['filter-output'],'voters');return {fetchedAt:decisionAt,payload:{data:decisions}};}
    assert.equal(endpoint,resultsEndpoint);assert(pages.has(params.offset),'Unexpected results offset '+params.offset);
    return {fetchedAt:params.offset===0?firstAt:laterAt,payload:{data:pages.get(params.offset)}};
  };
  store.enqueue(generation,key,'motion-outcomes',{sittingId:sitting,stage:'results',offset:0,results:[],decisions:[],splits:[],sources:[],...initial},180);
  const progress=[];
  for(let step=0;step<8;step++) {
    const task=taskRow(store,generation,key);
    if(task.done===1)return {calls,progress,saved:store.source(generation,motionSourceKey(sitting)).work};
    await worker.task(task);
    progress.push(taskRow(store,generation,key).body);
  }
  assert.fail('The bounded pagination fixture did not finish.');
}
function assertLaterFailure(context,saved,offset) {
  const {store}=context;
  assert.equal(saved.amendmentProjectionVersion,AMENDMENT_SITTING_PROJECTION_VERSION);
  assert.equal(saved.truncated,false);assert.equal(saved.splitProjectionTruncated,false);
  assert.deepEqual(saved.coverage,{missingResultIds:[],missingDecisionIds:[]});
  assert.equal(saved.results.length,1);assert.equal(saved.splitRequests.length,1);assert.equal(saved.parsedSplits.length,1);
  const [request]=saved.splitRequests;
  assert.equal(request.id,requestId);assert.equal(new URL(request.source.url).searchParams.get('offset'),String(offset));
  const failures=amendmentFailures(store,{status:'unresolved'});
  assert.equal(failures.total,1);
  const [failure]=failures.items;
  assert.equal(failure.code,'invalid_xml');assert.equal(failure.requestId,requestId);assert.equal(failure.partId,componentId);
  assert.equal(failure.rawDescription,splitRequest().created_a_realization_of[0].expressionContent.en);
  assert.equal(failure.fetchedAt,laterAt);assert.equal(failure.provenance,'exact');assert.equal(failure.sourceUrl,request.source.url);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.decisions[0].outcome,'ADOPTED');assert.equal(item.decisions[0].partId,componentId);
  assert.equal(item.splitParts.length,1);assert.equal(item.splitParts[0].status,'unresolved');assert.equal(item.splitParts[0].plan,null);
  assert.equal(item.splitParts[0].failure.code,'invalid_xml');assert.equal(item.splitParts[0].source.url,request.source.url);
}
const snapshot=store=>({
  sources:store.db.prepare('SELECT * FROM sources ORDER BY generation,key').all(),
  rows:store.db.prepare('SELECT * FROM amendments ORDER BY generation,id').all(),
  targets:store.db.prepare('SELECT * FROM amendment_targets ORDER BY generation,id').all(),
  tasks:store.db.prepare('SELECT * FROM tasks ORDER BY generation,key').all(),
  jobs:store.db.prepare('SELECT * FROM amendment_jobs ORDER BY generation,key').all(),
});

test('mixed raw results pages advance by their full length and preserve later split failures through the API',async t=>{
  for(const length of [50,73]) {
    const context=setup(t),first=result();
    const pages=new Map([[0,[first,...Array.from({length:length-1},(_,index)=>ignored(index))]],[length,[splitRequest()]]]);
    const {calls,progress,saved}=await ingest(context,pages);
    assert.equal(progress[0].stage,'results');assert.equal(progress[0].offset,length);
    assert.deepEqual(calls,[[resultsEndpoint,0],[resultsEndpoint,length],[decisionsEndpoint,0]]);
    assertLaterFailure(context,saved,length);
  }
});

test('a full ignored results page continues even when neither projection grows',async t=>{
  const context=setup(t),pages=new Map([[0,Array.from({length:50},(_,index)=>ignored(index))],[50,[result(),splitRequest()]]]);
  const {calls,progress,saved}=await ingest(context,pages);
  assert.equal(progress[0].stage,'results');assert.equal(progress[0].offset,50);
  assert.deepEqual(progress[0].results,[]);assert.deepEqual(progress[0].splits,[]);
  assert.deepEqual(calls,[[resultsEndpoint,0],[resultsEndpoint,50],[decisionsEndpoint,0]]);
  assertLaterFailure(context,saved,50);
});

test('ordinary results pages keep exact child coverage and a full complete decisions response does not request another page',async t=>{
  const context=setup(t),ids=Array.from({length:51},(_,index)=>'eli/dl/event/'+sitting+'-VOT-ITM-'+(index+1));
  const results=ids.map((_,index)=>result(index+1,index===0?ids:[]));
  const decisions=[vote(1,{split:false}),...Array.from({length:49},(_,index)=>vote(index+2,{subject:false}))];
  const {calls,saved}=await ingest(context,new Map([[0,results.slice(0,50)],[50,results.slice(50)]]),decisions);
  assert.deepEqual(calls,[[resultsEndpoint,0],[resultsEndpoint,50],[decisionsEndpoint,0]]);
  assert.equal(saved.results.length,51);assert.equal(saved.decisions.length,50);
  assert.equal(saved.truncated,false);assert.equal(saved.splitProjectionTruncated,false);
  assert.deepEqual(saved.coverage,{missingResultIds:[],missingDecisionIds:[]});
  assert.equal(amendmentFailures(context.store).total,0);
  const adopted=amendmentsPage(context.store,{document:targetId,outcome:'ADOPTED'});
  assert.equal(adopted.total,1);assert.equal(adopted.items[0].decisions.length,1);
});

test('a full ignored final results page records incomplete split coverage without fetching offset 1000',async t=>{
  for(const offset of [900,950]) {
    const context=setup(t),whole=vote(1,{split:false}),initial={offset,results:projectMotionResults([result()],sitting),sources:[{url:api+resultsEndpoint+'?offset=0',fetchedAt:firstAt}],amendmentProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION};
    const pages=new Map([[950,Array.from({length:50},(_,index)=>ignored(index))]]);
    if(offset===900)pages.set(900,Array.from({length:73},(_,index)=>ignored(index)));
    const {calls,progress,saved}=await ingest(context,pages,[whole],{initial});
    if(offset===900){assert.equal(progress[0].stage,'results');assert.equal(progress[0].offset,950);}
    const final=progress[offset===900?1:0];
    assert.equal(final.stage,'decisions');assert.equal(final.offset,0);assert.equal(final.splitProjectionTruncated,true);
    assert.deepEqual(calls,[...(offset===900?[[resultsEndpoint,900]]:[]),[resultsEndpoint,950],[decisionsEndpoint,0]]);
    assert.equal(saved.splitProjectionTruncated,true);assert.equal(saved.truncated,false);
    assert.deepEqual(saved.coverage,{missingResultIds:[],missingDecisionIds:[]});
    const page=amendmentsPage(context.store,{document:targetId});
    assert.equal(page.items[0].outcome,'ADOPTED');assert.equal(page.coverage.complete,false);
    assert(page.coverage.gaps.some(gap=>gap.includes('split-request pagination limit')));
  }
});

test('legacy pagination proofs stay unavailable on pure reads and reparses until a complete current source is fetched',async t=>{
  const context=setup(t),{store,worker,generation}=context;
  const oldSource={url:api+resultsEndpoint+'?offset=0',fetchedAt:firstAt};
  const oldRequest={...splitRequest(false),amendmentProjectionVersion:3,source:oldSource};
  const oldVote={...vote(),source:{url:api+decisionsEndpoint+'?offset=0',fetchedAt:firstAt}};
  const old=parseSavedSplits(worker,{amendmentProjectionVersion:3,splitRequests:[oldRequest],results:projectMotionResults([result()],sitting),decisions:[oldVote],sources:[oldSource,oldVote.source],truncated:false,coverage:{missingResultIds:[],missingDecisionIds:[]}});
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',old,firstAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  const record=store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,amendmentId),cached=JSON.parse(record.body);
  const proof={...cached.decisions[0].requestCoverages[0],version:2,sourceComplete:true};
  const legacy={...cached,outcome:'ADOPTED',outcomeProofVersion:2,splitCoverageComplete:true,splitCoverage:cached.splitCoverage.map(value=>({...value,complete:true})),decisions:cached.decisions.map(value=>({...value,requestCoverages:[proof]})),splitParts:cached.splitParts.map(value=>({...value,requestCoverage:proof}))};
  store.db.prepare('UPDATE amendments SET outcome=?,body=? WHERE generation=? AND id=?').run('ADOPTED',JSON.stringify(legacy),generation,amendmentId);
  const before=snapshot(store),[read]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(read.outcome,'unavailable');assert.equal(read.outcomeProofVersion,AMENDMENT_OUTCOME_PROOF_VERSION);
  assert.equal(amendmentsPage(store,{document:targetId,outcome:'ADOPTED'}).total,0);
  assert.equal(amendmentsPage(store,{document:targetId,outcome:'unavailable'}).total,1);
  assert.deepEqual(snapshot(store),before);
  store.enqueue(generation,'legacy-pagination-reparse','amendment-reparse',{sourceKey:motionSourceKey(sitting)},180);
  await worker.task(taskRow(store,generation,'legacy-pagination-reparse'));
  const reparsed=store.source(generation,motionSourceKey(sitting));
  assert.equal(reparsed.work.amendmentProjectionVersion,3);assert.equal(reparsed.fetchedAt,firstAt);
  assert.equal(reparsed.work.parsedSplits[0].sourceProjectionVersion,3);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].outcome,'unavailable');
  const {calls,saved}=await ingest(context,new Map([[0,[result(),...Array.from({length:49},(_,index)=>ignored(index))]],[50,[splitRequest(false)]]]),[vote()],{key:'fresh-pagination-proof'});
  assert.deepEqual(calls,[[resultsEndpoint,0],[resultsEndpoint,50],[decisionsEndpoint,0]]);
  assert.equal(saved.amendmentProjectionVersion,AMENDMENT_SITTING_PROJECTION_VERSION);
  assert.equal(saved.parsedSplits[0].sourceProjectionVersion,AMENDMENT_SITTING_PROJECTION_VERSION);
  const adopted=amendmentsPage(store,{document:targetId,outcome:'ADOPTED'});
  assert.equal(adopted.total,1);assert.equal(adopted.items[0].splitCoverageComplete,true);
  assert.equal(adopted.items[0].outcomeProofVersion,AMENDMENT_OUTCOME_PROOF_VERSION);
});
