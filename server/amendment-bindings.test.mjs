import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityStore } from './activity-index-store.mjs';
import { ActivityWorker } from './activity-index-worker.mjs';
import { AMENDMENT_LINKS_VERSION } from './activity-index-model.mjs';
import { AMENDMENTS_VERSION, AMENDMENT_SITTING_PROJECTION_VERSION } from './amendments.mjs';
import { AMENDMENT_EXTRACTION_VERSION } from './amendment-documents.mjs';
import { amendmentsPage, amendmentFailures } from './amendments-store.mjs';
import { parseSavedSplits, rebuildAmendmentTarget } from './amendments-worker.mjs';
import { motionSourceKey } from './motion-outcomes.mjs';

const targetId='A-10-2026-0254',otherTarget='B-10-2026-0254',sitting='MTG-PL-2026-10-07';
const tabled='2026-10-02',fetchedAt='2026-10-16T17:00:00.000Z';
const source={url:'https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/decisions?format=application%2Fld%2Bjson',fetchedAt};
const splitSource={url:source.url.replace('/decisions?','/vote-results?'),fetchedAt};
const wordingSource={url:'https://data.europarl.europa.eu/distribution/example/bindings_en.docx',language:'en',fetchedAt};
const sourceDescriptor={url:wordingSource.url,language:'en',byteSize:null};
const sourceFreshness={version:1,status:'fresh',descriptor:sourceDescriptor,sourceDescriptor};
const amendmentId=(number,target=targetId)=>target+'-AM-'+number;
const amendmentRef=(number,target=targetId)=>'eli/dl/doc/'+amendmentId(number,target);
const component=(number)=>({id:'eli/dl/doc/'+sitting+'-VOT-ITM-123-SPLIT-1-'+number,number:String(number),numbering:number,expressionContent:{en:'<partValue>'+(number===1?'Text as a whole without the word: ‘old’':'‘old’')+'</partValue>'}});
const split=()=>({id:'eli/dl/event/'+sitting+'-VOT-ITM-123-SPLIT-1',had_activity_type:'def/ep-activities/REQUEST_VOTE_SPLIT',created_a_realization_of:[component(1),component(2)],source:splitSource});
const decision=(number,references,outcome='ADOPTED')=>({id:'eli/dl/event/'+sitting+'-DEC-'+number,decided_on_a_realization_of:references,activity_date:'2026-10-07',decision_outcome:'def/ep-statuses/'+outcome,decision_method:'def/ep-vote-methods/ROLL_CALL',referenceText:{en:'Public amendment vote'},number_of_votes_favor:300,number_of_votes_against:200,number_of_votes_abstention:0,source});
const author=(personId=101,extra={})=>({name:'Alex Common',personId,method:'exact_full_name_active_mandate',status:'resolved',evidence:[{type:'full_name',personId:101,date:tabled,activeMandate:{start:tabled,end:tabled}}],...extra});
const row=(number,extra={})=>({id:amendmentId(number),number,targetDocumentId:targetId,date:tabled,proposerDate:tabled,proposerDateBasis:'individual-amendment-document',documentDate:tabled,listDocumentDate:tabled,textParserVersion:AMENDMENT_EXTRACTION_VERSION,textIntegrity:'complete',originalText:'Original '+number,proposedText:'Proposal '+number,wordingSource,sourceFreshness,authors:[],decisions:[],splitParts:[],sources:[source],titles:{en:'Public report'},procedureIds:['2025-0233'],gaps:[],...extra});
const variant=(listId,extra={})=>({listId,date:tabled,proposerDate:tabled,proposerDateBasis:'individual-amendment-document',documentDate:tabled,listDocumentDate:tabled,textParserVersion:AMENDMENT_EXTRACTION_VERSION,textIntegrity:'complete',originalText:'Original variant',proposedText:'Proposal variant',wordingSource,sourceFreshness,authors:[author()],gaps:[],sources:[source],...extra});

function setup(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-bindings-'));
  const store=new ActivityStore(directory,{clock:()=>Date.parse(fetchedAt)});
  assert(store.acquire());
  const {generation}=store.beginCycle();
  const worker=new ActivityWorker(store,{clock:()=>Date.parse(fetchedAt),fetchRecord:async()=>{throw new Error('Unexpected upstream request in amendment binding test.');}});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,worker,generation};
}
function seedTarget({store,generation},numbers=[1],id=targetId) {
  const listId=id+'-AM-001-004';
  const list={id:'eli/dl/doc/'+listId,identifier:listId,targetDocumentId:id,document_date:tabled,work_type:'def/ep-document-types/AMENDMENT_LIST',foresees_change_of:['eli/dl/doc/'+id],extraction:{amendments:numbers.map(number=>({number,authors:[],date:tabled,targetLabel:'Article '+number,originalText:'Original '+number,proposedText:'Proposal '+number,language:'en',gaps:[]})),gaps:[],language:'en',sourceUrl:'https://data.europarl.europa.eu/distribution/example/'+listId+'_en.docx',fetchedAt,parserVersion:AMENDMENT_EXTRACTION_VERSION}};
  const target={id:'eli/dl/doc/'+id,identifier:id,amendmentLinksVersion:AMENDMENT_LINKS_VERSION,document_date:tabled,work_type:'def/ep-document-types/REPORT_PLENARY',title_dcterms:{en:'Public report'},inverse_foresees_change_of:[list],inverse_based_on_a_realization_of:['eli/dl/event/'+sitting+'-VOT-ITM-123']};
  store.putSource(generation,'/plenary-documents/'+id,'document',target,fetchedAt);
  store.putSource(generation,'amendment:list:'+listId,'amendment-list',list,fetchedAt);
}
function seedDecisions({store,worker,generation},decisions,requests=[]) {
  const work=parseSavedSplits(worker,{amendmentVersion:AMENDMENTS_VERSION,amendmentProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION,decisions,splitRequests:requests,coverage:{missingResultIds:[],missingDecisionIds:[]},truncated:false,lastRefreshFailure:null,sources:[source,splitSource]});
  store.putSource(generation,motionSourceKey(sitting),'motion-outcomes',work,fetchedAt);
}
function cacheRows({store,generation},rows) {
  store.db.prepare('INSERT OR REPLACE INTO amendment_targets VALUES (?,?,?)').run(generation,targetId,JSON.stringify({id:targetId,date:tabled,titles:{en:'Public report'},procedureIds:['2025-0233'],complete:true,gaps:[],lastUpdated:fetchedAt}));
  const insert=store.db.prepare('INSERT OR REPLACE INTO amendments VALUES (?,?,?,?,?,?)');
  for(const item of rows)insert.run(generation,item.id,targetId,item.date || '',item.outcome || 'unavailable',JSON.stringify(item));
}
const cachedSnapshot=store=>({
  amendments:store.db.prepare('SELECT generation,id,target,date,outcome,body FROM amendments ORDER BY generation,id').all(),
  targets:store.db.prepare('SELECT generation,id,body FROM amendment_targets ORDER BY generation,id').all(),
  sources:store.db.prepare('SELECT generation,key,body,fetched_at FROM sources ORDER BY generation,key').all(),
});

test('one recorded split vote does not establish an aggregate outcome or ownership of its unanswered sibling',t=>{
  const context=setup(t),{store,worker,generation}=context;
  seedTarget(context);
  const request=split(),[first,second]=request.created_a_realization_of;
  seedDecisions(context,[decision(1,[amendmentRef(1),first.id])],[request]);
  rebuildAmendmentTarget(worker,generation,targetId);
  const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
  assert.equal(page.total,1);
  assert.equal(item.outcome,'unavailable');
  assert.equal(item.outcomeProofVersion,1);assert.equal(item.splitCoverageComplete,false);
  assert.deepEqual(item.decisions.map(vote=>[vote.id,vote.partId,vote.outcome]),[[sitting+'-DEC-1',first.id,'ADOPTED']]);
  assert.equal(item.decisions[0].componentBinding,'single-amendment');
  assert.deepEqual(item.decisions[0].componentReferences,[first.id]);
  assert.deepEqual(item.decisions[0].totals,{for:300,against:200,abstaining:0});
  assert.deepEqual(item.splitParts.map(part=>part.id),[first.id]);
  assert(!item.splitParts.some(part=>part.id===second.id));
  assert.deepEqual(item.splitCoverage,[{requestId:request.id,registryRequestKey:request.id,componentCount:2,componentIds:[first.id,second.id],recordedComponentCount:1,recordedComponentIds:[first.id],boundComponentCount:1,boundComponentIds:[first.id],unboundComponentCount:1,complete:false}]);
  assert.equal(amendmentsPage(store,{document:targetId,outcome:'ADOPTED'}).total,0);
  assert.equal(amendmentsPage(store,{document:targetId,outcome:'unavailable'}).total,1);
  assert.equal(page.coverage.complete,false);
  assert.equal(amendmentFailures(store).total,0);
});

test('explicit decisions for all known parts allow the amendment aggregate outcome',t=>{
  const context=setup(t),{store,worker,generation}=context;
  seedTarget(context);
  const request=split(),[first,second]=request.created_a_realization_of;
  seedDecisions(context,[decision(1,[amendmentRef(1),first.id]),decision(2,[amendmentRef(1),second.id],'REJECTED')],[request]);
  rebuildAmendmentTarget(worker,generation,targetId);
  const [item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.outcome,'mixed');
  assert.equal(item.outcomeProofVersion,1);assert.equal(item.splitCoverageComplete,true);
  assert.deepEqual(item.splitParts.map(part=>part.id),[first.id,second.id]);
  assert.deepEqual(item.splitCoverage,[{requestId:request.id,registryRequestKey:request.id,componentCount:2,componentIds:[first.id,second.id],recordedComponentCount:2,recordedComponentIds:[first.id,second.id],boundComponentCount:2,boundComponentIds:[first.id,second.id],unboundComponentCount:0,complete:true}]);
  assert.equal(amendmentsPage(store,{document:targetId,outcome:'mixed'}).total,1);
  assert.equal(amendmentsPage(store,{document:targetId,outcome:'unavailable'}).total,0);
});

test('a collective split preserves the complete official subject set without assigning a component to each amendment',t=>{
  const context=setup(t),{store,worker,generation}=context;
  seedTarget(context,[1,2]);
  seedTarget(context,[1],otherTarget);
  const request=split(),first=request.created_a_realization_of[0];
  const subjects=[amendmentRef(1),amendmentRef(2),amendmentRef(1,otherTarget)];
  seedDecisions(context,[decision(1,[...subjects,subjects[0],first.id])],[request]);
  for(const id of [targetId,otherTarget])rebuildAmendmentTarget(worker,generation,id);
  const page=amendmentsPage(store,{limit:10});
  assert.equal(page.total,3);
  for(const item of page.items) {
    assert.equal(item.outcome,'unavailable');
    assert.equal(item.outcomeProofVersion,1);assert.equal(item.splitCoverageComplete,false);
    assert.deepEqual(item.splitParts,[]);
    assert.equal(item.decisions.length,1);
    const [vote]=item.decisions;
    assert.equal(vote.id,sitting+'-DEC-1');assert.equal(vote.outcome,'ADOPTED');assert.equal(vote.collective,true);
    assert.deepEqual(vote.amendmentIds,subjects.map(reference=>reference.replace('eli/dl/doc/','')));
    assert.deepEqual(vote.componentReferences,[first.id]);
    assert.equal(vote.componentBinding,'unresolved-collective');
    assert.equal(vote.partId,null);
    assert.equal(vote.partNumber,null);
  }
  assert.equal(amendmentsPage(store,{outcome:'ADOPTED'}).total,0);
  assert.equal(amendmentsPage(store,{outcome:'unavailable'}).total,3);
  assert.equal(amendmentFailures(store).total,0);
});

test('a whole collective decision remains an explicit outcome for all unique amendments across targets',t=>{
  const context=setup(t),{store,worker,generation}=context;
  seedTarget(context,[1,2]);seedTarget(context,[1],otherTarget);
  const subjects=[amendmentRef(1),amendmentRef(2),amendmentRef(1,otherTarget)];
  seedDecisions(context,[decision(1,[...subjects,subjects[0]])],[split()]);
  for(const id of [targetId,otherTarget])rebuildAmendmentTarget(worker,generation,id);
  const page=amendmentsPage(store,{outcome:'ADOPTED',limit:10});
  assert.equal(page.total,3);
  for(const item of page.items) {
    assert.equal(item.outcome,'ADOPTED');assert.deepEqual(item.splitParts,[]);
    assert.equal(item.outcomeProofVersion,1);assert.equal(item.splitCoverageComplete,true);assert.deepEqual(item.splitCoverage,[]);
    assert.equal(item.decisions.length,1);assert.equal(item.decisions[0].collective,true);
    assert.deepEqual(item.decisions[0].amendmentIds,subjects.map(reference=>reference.replace('eli/dl/doc/','')));
  }
});

test('a decision-only amendment keeps unknown amendment dates separate from its target document date',t=>{
  const context=setup(t),{store,worker,generation}=context;
  seedTarget(context,[]);
  seedDecisions(context,[decision(1,[amendmentRef(5)])]);
  rebuildAmendmentTarget(worker,generation,targetId);
  const page=amendmentsPage(store,{document:targetId}),[item]=page.items;
  assert.equal(page.total,1);assert.equal(item.id,amendmentId(5));assert.equal(item.outcome,'ADOPTED');
  for(const field of ['date','documentDate','listDocumentDate','dateBasis','proposerDate','proposerDateBasis'])assert.equal(item[field],null,field);
  assert.equal(item.targetDocumentDate,tabled);
  assert.equal(item.decisions[0].date,'2026-10-07');
});

test('legacy and partial cached split bindings are withheld consistently by reads and outcome filters without rewriting evidence',t=>{
  for(const mode of ['legacy','current-partial']) {
    const context=setup(t),{store,worker,generation}=context;
    const first=component(1),vote={id:sitting+'-DEC-1',amendmentIds:[amendmentId(1)],collective:false,sittingId:sitting,date:'2026-10-07',outcome:'ADOPTED',partId:first.id,partNumber:1,source};
    if(mode==='legacy')cacheRows(context,[row(1,{outcome:'ADOPTED',decisions:[vote],splitParts:[{id:first.id,number:1,requestId:split().id,status:'parsed',grounding:'not_attempted',source:splitSource}]})]);
    else {
      seedTarget(context);seedDecisions(context,[decision(1,[amendmentRef(1),first.id])],[split()]);
      rebuildAmendmentTarget(worker,generation,targetId);
      const record=store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,amendmentId(1));
      store.db.prepare('UPDATE amendments SET outcome=?,body=? WHERE generation=? AND id=?').run('ADOPTED',JSON.stringify({...JSON.parse(record.body),outcome:'ADOPTED'}),generation,amendmentId(1));
    }
    const before=cachedSnapshot(store),[item]=amendmentsPage(store,{document:targetId}).items;
    assert.equal(item.outcome,'unavailable',mode);
    assert.equal(item.decisions[0].outcome,'ADOPTED',mode);
    assert.equal(amendmentsPage(store,{document:targetId,outcome:'ADOPTED'}).total,0,mode);
    const unavailable=amendmentsPage(store,{document:targetId,outcome:'unavailable'});
    assert.equal(unavailable.total,1,mode);assert.equal(unavailable.items[0].outcome,'unavailable',mode);
    assert.equal(unavailable.coverage.complete,false,mode);
    assert.deepEqual(cachedSnapshot(store),before,mode);
  }
});

test('a cached legacy collective split loses inferred per-amendment ownership on a pure read',t=>{
  const context=setup(t),{store}=context,first=component(1);
  const vote={id:sitting+'-DEC-1',amendmentIds:[amendmentId(1),amendmentId(2)],collective:true,sittingId:sitting,date:'2026-10-07',outcome:'ADOPTED',partId:first.id,partNumber:1,source};
  cacheRows(context,[row(1,{outcome:'ADOPTED',decisions:[vote],splitParts:[{id:first.id,number:1,requestId:split().id,status:'parsed',grounding:'not_attempted',source:splitSource}]})]);
  const before=cachedSnapshot(store),[item]=amendmentsPage(store,{document:targetId}).items;
  assert.equal(item.outcome,'unavailable');assert.deepEqual(item.splitParts,[]);
  assert.equal(item.decisions[0].partId,null);assert.equal(item.decisions[0].partNumber,null);
  assert.equal(item.decisions[0].componentBinding,'unresolved-collective');
  assert.deepEqual(item.decisions[0].componentReferences,[first.id]);
  assert.deepEqual(item.decisions[0].amendmentIds,[amendmentId(1),amendmentId(2)]);
  assert.equal(item.decisions[0].outcome,'ADOPTED');
  assert.equal(amendmentsPage(store,{outcome:'ADOPTED'}).total,0);
  assert.equal(amendmentsPage(store,{outcome:'unavailable'}).total,1);
  assert.deepEqual(cachedSnapshot(store),before);
});

test('legacy split hints without an exact part ID cannot establish owned components or aggregate outcomes on a pure read',t=>{
  for(const mode of ['part-number-only','unverified-binding']) {
    const context=setup(t),{store}=context,first=component(1);
    const vote={id:sitting+'-DEC-1',amendmentIds:[amendmentId(1)],collective:false,sittingId:sitting,date:'2026-10-07',outcome:'ADOPTED',source,...(mode==='part-number-only'?{partNumber:1}:{componentBinding:'unverified'})};
    cacheRows(context,[row(1,{outcome:'ADOPTED',decisions:[vote],splitParts:[{id:first.id,number:1,requestId:split().id,status:'parsed',grounding:'not_attempted',source:splitSource}]})]);
    const before=cachedSnapshot(store),[item]=amendmentsPage(store,{document:targetId}).items;
    assert.equal(item.outcome,'unavailable',mode);assert.equal(item.splitCoverageComplete,false,mode);
    assert.deepEqual(item.splitParts,[],mode);
    assert.equal(item.decisions[0].outcome,'ADOPTED',mode);
    assert.equal(item.decisions[0].componentBinding,'unverified',mode);
    assert.equal(item.decisions[0].partId,null,mode);assert.equal(item.decisions[0].partNumber,null,mode);
    assert.deepEqual(item.decisions[0].componentReferences,[],mode);
    assert.equal(amendmentsPage(store,{document:targetId,outcome:'ADOPTED'}).total,0,mode);
    const unavailable=amendmentsPage(store,{document:targetId,outcome:'unavailable'});
    assert.equal(unavailable.total,1,mode);assert.equal(unavailable.items[0].outcome,'unavailable',mode);
    assert.equal(unavailable.coverage.complete,false,mode);
    assert.deepEqual(cachedSnapshot(store),before,mode);
  }
});

test('member matching includes own-date variants once and identifies the exact contributing lists',t=>{
  const context=setup(t),{store}=context;
  const listIds=[targetId+'-AM-001-001',targetId+'-AM-001-002'];
  cacheRows(context,[row(1,{listId:null,conflicted:true,authors:[],originalText:null,proposedText:null,variants:[variant(listIds[0],{authors:[author(101)]}),variant(listIds[1],{authors:[author('101')]})]}),row(2,{authors:[author('102')]})]);
  const before=cachedSnapshot(store);
  for(const member of [101,'101']) {
    const page=amendmentsPage(store,{document:targetId,member});
    assert.equal(page.total,1);assert.equal(page.items.length,1);assert.equal(page.items[0].id,amendmentId(1));
    assert.deepEqual(page.items[0].authors,[]);
    assert.deepEqual(page.items[0].authorMatch,{memberId:'101',basis:'variant',variantListIds:listIds});
  }
  const aggregate=amendmentsPage(store,{document:targetId,member:'102'});
  assert.equal(aggregate.total,1);assert.deepEqual(aggregate.items[0].authorMatch,{memberId:'102',basis:'aggregate',variantListIds:[]});
  assert.equal(amendmentsPage(store,{document:targetId,member:'103'}).total,0);
  assert.deepEqual(cachedSnapshot(store),before);
});

test('member matching rejects unsupported dates and explicitly inactive or unresolved cached identities',t=>{
  const context=setup(t),{store}=context;
  cacheRows(context,[
    row(1,{conflicted:true,authors:[],variants:[variant(targetId+'-AM-001-001',{documentDate:null,listDocumentDate:null,proposerDate:null,proposerDateBasis:null,authors:[author(101)]})]}),
    row(2,{conflicted:true,authors:[],variants:[variant(targetId+'-AM-002-002',{authors:[author('101',{status:'inactive',method:null})]})]}),
    row(3,{conflicted:true,authors:[],variants:[variant(targetId+'-AM-003-003',{authors:[author(101,{status:'ambiguous',method:null})]})]}),
    row(4,{authors:[author('101',{status:'inactive',method:null})]}),
  ]);
  const before=cachedSnapshot(store);
  const page=amendmentsPage(store,{document:targetId,member:'101'});
  assert.equal(page.total,0);assert.deepEqual(page.items,[]);
  assert.deepEqual(cachedSnapshot(store),before);
});

test('member matching combines supported aggregate and variant evidence without duplicating the canonical amendment',t=>{
  const context=setup(t),{store}=context,listId=targetId+'-AM-001-001';
  cacheRows(context,[row(1,{authors:[author(101)],variants:[variant(listId,{authors:[author('101')]})]})]);
  const before=cachedSnapshot(store),page=amendmentsPage(store,{document:targetId,member:'101'});
  assert.equal(page.total,1);assert.equal(page.items.length,1);
  assert.deepEqual(page.items[0].authorMatch,{memberId:'101',basis:'aggregate-and-variant',variantListIds:[listId]});
  assert.deepEqual(cachedSnapshot(store),before);
});
