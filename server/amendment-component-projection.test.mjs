import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityStore } from './activity-index-store.mjs';
import { ActivityWorker } from './activity-index-worker.mjs';
import { AMENDMENT_LINKS_VERSION } from './activity-index-model.mjs';
import { AMENDMENT_SITTING_PROJECTION_VERSION, AMENDMENT_OUTCOME_PROOF_VERSION, distributionEvidenceFor } from './amendments.mjs';
import { AMENDMENT_EXTRACTION_VERSION } from './amendment-documents.mjs';
import { amendmentsPage, amendmentFailures } from './amendments-store.mjs';
import { motionSourceKey } from './motion-outcomes.mjs';

const targetId='A-10-2026-0254',sitting='MTG-PL-2026-10-07',tabled='2026-10-02';
const fetchedAt='2026-10-16T17:00:00.000Z';
const fileUrl='https://data.europarl.europa.eu/distribution/example/components_en.docx';
const amendmentId=targetId+'-AM-1',amendmentReference='eli/dl/doc/'+amendmentId;
const requestId='eli/dl/event/'+sitting+'-VOT-ITM-123-SPLIT-1';
const componentId=number=>'eli/dl/doc/'+sitting+'-VOT-ITM-123-SPLIT-1-'+number;
const component=number=>({id:componentId(number),number:String(number),numbering:number,expressionContent:{en:'<partValue>‘A selected clause’</partValue>'}});
const split=components=>({id:requestId,had_activity_type:'def/ep-activities/REQUEST_VOTE_SPLIT',created_a_realization_of:components});

function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-component-projection-'));
  const store=new ActivityStore(directory,{clock:()=>Date.parse(fetchedAt)});
  assert(store.acquire());
  const {generation}=store.beginCycle();
  const worker=new ActivityWorker(store,{clock:()=>Date.parse(fetchedAt),fetchRecord:async()=>{throw new Error('Unexpected upstream request in component projection test.');}});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const listId=targetId+'-AM-001-001';
  const list={id:'eli/dl/doc/'+listId,identifier:listId,targetDocumentId:targetId,document_date:tabled,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+targetId],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'authority/DOCX',is_exemplified_by:fileUrl}]}],extraction:{amendments:[{number:1,authors:[],date:tabled,targetLabel:'Article 1',originalText:'Original wording',proposedText:'Proposed wording',language:'en',gaps:[]}],gaps:[],language:'en',sourceUrl:fileUrl,sourceDescriptor:{url:fileUrl,language:'en',byteSize:null},fetchedAt,parserVersion:AMENDMENT_EXTRACTION_VERSION}};
  list.amendmentDistributionDeclared=true;
  list.distributionEvidence=distributionEvidenceFor(list,{url:'https://data.europarl.europa.eu/api/v2/documents/'+listId,fetchedAt,language:null});
  const target={id:'eli/dl/doc/'+targetId,identifier:targetId,amendmentLinksVersion:AMENDMENT_LINKS_VERSION,document_date:tabled,work_type:'def/ep-document-types/REPORT_PLENARY',title_dcterms:{en:'A public report'},inverse_foresees_change_of:[list],inverse_based_on_a_realization_of:['eli/dl/event/'+sitting+'-VOT-ITM-123']};
  store.putSource(generation,'/plenary-documents/'+targetId,'document',target,fetchedAt);
  store.putSource(generation,'amendment:list:'+listId,'amendment-list',list,fetchedAt);
  return {store,worker,generation};
}

async function ingest(context,request) {
  const {store,worker,generation}=context;
  const vote={id:'eli/dl/event/'+sitting+'-DEC-1',had_activity_type:'def/ep-activities/PLENARY_OUTCOME',activity_date:'2026-10-07',decided_on_a_realization_of:[amendmentReference,componentId(1)],decision_outcome:'def/ep-statuses/ADOPTED',decision_method:'def/ep-vote-methods/ROLL_CALL',referenceText:{en:'Public amendment vote'}};
  const result={id:'eli/dl/event/'+sitting+'-VOT-ITM-123',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',activity_date:'2026-10-07',based_on_a_realization_of:['eli/dl/doc/'+targetId],consists_of:[vote.id],inverse_consists_of:[{id:'eli/dl/event/'+sitting,consists_of:['eli/dl/event/'+sitting+'-VOT-ITM-123']}]};
  const calls=[];
  worker.fetchRecord=async(endpoint,params)=>{
    calls.push([endpoint,params.offset]);
    assert.equal(params.offset,0);
    if(endpoint==='/meetings/'+sitting+'/vote-results')return {fetchedAt,payload:{data:[result,request]}};
    assert.equal(endpoint,'/meetings/'+sitting+'/decisions');
    assert.equal(params['filter-output'],'voters');
    return {fetchedAt,payload:{data:[vote]}};
  };
  store.enqueue(generation,'component-projection-sitting','motion-outcomes',{sittingId:sitting,stage:'results',offset:0,results:[],decisions:[],splits:[],sources:[]},113);
  await worker.task(store.nextTask(generation));
  const decisionsTask=store.nextTask(generation);
  assert.equal(decisionsTask.body.stage,'decisions');
  await worker.task(decisionsTask);
  assert.deepEqual(calls,[['/meetings/'+sitting+'/vote-results',0],['/meetings/'+sitting+'/decisions',0]]);
  const saved=store.source(generation,motionSourceKey(sitting)).work;
  assert.equal(saved.truncated,false);
  assert.equal(saved.amendmentProjectionVersion,AMENDMENT_SITTING_PROJECTION_VERSION);
  assert.equal(saved.splitRequests.length,1);
  assert.equal(saved.parsedSplits.length,1);
  const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
  assert.equal(page.total,1);
  assert.equal(item.outcomeProofVersion,AMENDMENT_OUTCOME_PROOF_VERSION);
  assert.equal(item.outcome,'unavailable');
  assert.equal(item.splitCoverageComplete,false);
  assert.equal(amendmentsPage(store,{document:targetId,outcome:'ADOPTED'}).total,0);
  assert.equal(amendmentsPage(store,{document:targetId,outcome:'unavailable'}).total,1);
  assert.equal(item.decisions.length,1);
  assert.equal(item.decisions[0].outcome,'ADOPTED');
  assert.equal(item.decisions[0].partId,componentId(1));
  assert.deepEqual(item.decisions[0].componentReferences,[componentId(1)]);
  return {saved,item,failures:amendmentFailures(store,{status:'unresolved',limit:50}).items};
}

test('actual sitting ingestion retains a URI-only sibling and cannot promote its one recorded component to a complete outcome',async t=>{
  const rawReference='https://data.europarl.europa.eu/'+componentId(2);
  const {saved,item,failures}=await ingest(setup(t),split([component(1),rawReference]));
  const [request]=saved.splitRequests,[parsed]=saved.parsedSplits;
  assert.equal(request.created_a_realization_of.length,2);
  assert.equal(request.created_a_realization_of[1].id,componentId(2));
  assert.equal(request.created_a_realization_of[1].sourceComponentObservation,rawReference);
  assert.equal(parsed.parts.length,2);
  const unresolved=parsed.parts.find(part=>part.id===componentId(2));
  assert.equal(unresolved.status,'unresolved');assert.equal(unresolved.plan,null);
  assert.equal(unresolved.sourceComponentObservation,rawReference);
  assert.deepEqual(item.splitParts.map(part=>part.id),[componentId(1)]);
  assert.deepEqual(item.splitCoverage,[{requestId,registryRequestKey:requestId,componentCount:2,componentIds:[componentId(1),componentId(2)],recordedComponentCount:1,recordedComponentIds:[componentId(1)],boundComponentCount:1,boundComponentIds:[componentId(1)],unboundComponentCount:1,complete:false}]);
  assert.equal(failures.length,1);
  assert.equal(failures[0].requestId,requestId);assert.equal(failures[0].partId,componentId(2));
  assert.equal(failures[0].status,'unresolved');
  assert.equal(failures[0].sourceComponentObservation,rawReference);
  assert.equal(failures[0].sourceUrl,request.source.url);
  assert.deepEqual(failures[0].source,request.source);
});

test('actual sitting ingestion counts malformed and foreign components without granting official identities or ownership',async t=>{
  const invalid=[null,17,false,'a malformed component',{id:'https://unrelated.example/'+componentId(2),number:'2',expressionContent:{en:'<partValue>‘Foreign host’</partValue>'}},'https://unrelated.example/'+componentId(3)];
  const {saved,item,failures}=await ingest(setup(t),split([component(1),...invalid]));
  const [request]=saved.splitRequests,[parsed]=saved.parsedSplits;
  assert.equal(request.created_a_realization_of.length,invalid.length+1);
  for(const [index,raw] of invalid.entries()) {
    const observed=request.created_a_realization_of[index+1];
    assert.equal(observed.id,null);
    assert(Object.hasOwn(observed,'sourceComponentObservation'));
    const expected=raw&&typeof raw==='object'?{id:raw.id}:raw;
    assert.deepEqual(observed.sourceComponentObservation,expected);
    if(raw&&typeof raw==='object') {
      assert.equal(observed.number,raw.number);
      assert.deepEqual(observed.expressionContent,raw.expressionContent);
    }
    const parsedPart=parsed.parts.find(part=>part.componentIndex===index+1);
    assert(Object.hasOwn(parsedPart,'sourceComponentObservation'));
    assert.deepEqual(parsedPart.sourceComponentObservation,expected);
    const failure=failures.find(failure=>failure.componentIndex===index+1);
    assert(Object.hasOwn(failure,'sourceComponentObservation'));
    assert.deepEqual(failure.sourceComponentObservation,expected);
  }
  assert.equal(parsed.parts.length,invalid.length+1);
  assert.deepEqual(parsed.parts.filter(part=>part.id).map(part=>part.id),[componentId(1)]);
  assert(parsed.parts.filter(part=>part.id==null).every(part=>part.status==='unresolved'&&part.plan===null));
  assert.deepEqual(item.splitParts.map(part=>part.id),[componentId(1)]);
  assert.equal(item.splitCoverage.length,1);
  assert.equal(item.splitCoverage[0].componentCount,invalid.length+1);
  assert.deepEqual(item.splitCoverage[0].componentIds,[componentId(1)]);
  assert.equal(item.splitCoverage[0].boundComponentCount,1);
  assert.equal(item.splitCoverage[0].unboundComponentCount,invalid.length);
  assert.equal(failures.length,invalid.length);
  assert(failures.every(failure=>failure.requestId===requestId&&failure.partId===null&&failure.status==='unresolved'));
  assert.equal(new Set(failures.map(failure=>failure.registryPartKey)).size,invalid.length);
});

test('actual sitting ingestion preserves the 257th raw component sentinel instead of filtering malformed entries below the parser limit',async t=>{
  const {saved,item,failures}=await ingest(setup(t),split([component(1),...Array(256).fill(null)]));
  const [request]=saved.splitRequests,[parsed]=saved.parsedSplits;
  assert.equal(request.created_a_realization_of.length,257);
  assert(request.created_a_realization_of.slice(1).every(part=>Object.hasOwn(part,'sourceComponentObservation')&&part.sourceComponentObservation===null&&part.id===null));
  assert.deepEqual(parsed.parts,[]);
  assert.equal(parsed.failures.length,1);
  assert.equal(parsed.failures[0].scope,'request');assert.equal(parsed.failures[0].code,'too_many_parts');
  assert.equal(failures.length,1);
  assert.equal(failures[0].requestId,requestId);assert.equal(failures[0].partId,null);
  assert.equal(failures[0].recordKind,'request');assert.equal(failures[0].code,'too_many_parts');
  assert.equal(failures[0].sourceUrl,request.source.url);
  assert.deepEqual(item.splitParts,[]);
});
