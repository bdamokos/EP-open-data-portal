import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { ActivityStore } from './activity-index-store.mjs';
import { ActivityWorker } from './activity-index-worker.mjs';
import { AMENDMENT_LINKS_VERSION, projectDocument } from './activity-index-model.mjs';
import { AMENDMENTS_VERSION, AMENDMENT_SITTING_PROJECTION_VERSION } from './amendments.mjs';
import { SPLIT_PARSER_VERSION } from './amendment-splits.mjs';
import { amendmentsPage, nextAmendmentTask } from './amendments-store.mjs';
import { rebuildAmendmentTarget } from './amendments-worker.mjs';
import { motionSourceKey } from './motion-outcomes.mjs';

const targetId='A-10-2026-0254',listId=targetId+'-AM-001-001',sittingId='MTG-PL-2026-10-07';
const targetKey='/plenary-documents/'+targetId,listKey='amendment:list:'+listId,listUri='eli/dl/doc/'+listId;
const at='2026-10-17T09:00:00.000Z',documentDate='2026-10-02';
const fileUrl='https://data.europarl.europa.eu/distribution/example/list_observations_en.docx';
const original='The original legal wording.',proposed='The accepted proposed wording.';
const projectionGap='Amendment-list observation coverage is unverified until the current document projection refreshes its source.';

function amendmentDocx() {
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const paragraph=value=>'<w:p><w:r><w:t>'+escape(value)+'</w:t></w:r></w:p>';
  const row=values=>'<w:tr>'+values.map(value=>'<w:tc>'+paragraph(value)+'</w:tc>').join('')+'</w:tr>';
  const xml='<w:document xmlns:w="urn:word"><w:body>'+paragraph('<Amend><Date>2.10.2026</Date><NumAm>1</NumAm>')+
    paragraph('<Members>Alex Common</Members>')+paragraph('<Article>Article 1</Article>')+'<w:tbl>'+
    row(['Text proposed by the Commission','Amendment'])+row([original,proposed])+'</w:tbl>'+paragraph('</Amend>')+'</w:body></w:document>';
  const name=Buffer.from('word/document.xml'),body=Buffer.from(xml),compressed=deflateRawSync(body);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
  return Buffer.concat([local,name,compressed,central,name,end]);
}
function targetRecord(store,generation) {
  return JSON.parse(store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(generation,targetId).body);
}
function snapshot(store) {
  return {
    sources:store.db.prepare('SELECT * FROM sources ORDER BY generation,key').all(),
    amendments:store.db.prepare('SELECT * FROM amendments ORDER BY generation,id').all(),
    targets:store.db.prepare('SELECT * FROM amendment_targets ORDER BY generation,id').all(),
    jobs:store.db.prepare('SELECT * FROM amendment_jobs ORDER BY generation,key').all(),
    tasks:store.db.prepare('SELECT * FROM tasks ORDER BY generation,key').all(),
    meta:store.db.prepare('SELECT * FROM meta ORDER BY key').all(),
  };
}
function retainedRecord(page) {
  assert.equal(page.total,1);assert.equal(page.coverage.pending,false);
  const [item]=page.items;
  assert.equal(item.originalText,original);assert.equal(item.proposedText,proposed);
  assert.equal(item.authors[0].name,'Alex Common');assert.equal(item.authors[0].personId,'101');
  assert.equal(item.outcome,'ADOPTED');assert.equal(item.decisions[0].id,sittingId+'-DEC-1');
  return item;
}
async function fixture(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-list-observations-'));
  const store=new ActivityStore(directory,{clock:()=>Date.parse(at)});
  assert(store.acquire());const {generation}=store.beginCycle();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const buffer=amendmentDocx(),calls={documents:0,details:0,downloads:0};
  const raw={id:'eli/dl/doc/'+targetId,identifier:targetId,type:'Work',work_type:'def/ep-document-types/REPORT_PLENARY',document_date:documentDate,title_dcterms:{en:'Public amendment report'},inverse_based_on_a_realization_of:['eli/dl/event/'+sittingId+'-VOT-ITM-123']};
  const detail={id:listUri,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',document_date:documentDate,foresees_change_of:[raw.id],is_realized_by:[{language:'http://publications.europa.eu/resource/authority/language/ENG',is_embodied_by:[{format:'authority/DOCX',byteSize:buffer.length,is_exemplified_by:fileUrl}]}]};
  let observation;
  const worker=new ActivityWorker(store,{clock:()=>Date.parse(at),fetchRecord:async endpoint=>{
    if(endpoint===targetKey){calls.documents++;return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:at,payload:{data:[observation]}};}
    assert.equal(endpoint,'/documents/'+listId,'Unexpected upstream request in list observation test.');calls.details++;
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:at,payload:{data:[detail]}};
  },downloadAmendmentDocx:async url=>{assert.equal(url,fileUrl);calls.downloads++;return {buffer};},downloadVotingXml:async()=>{throw new Error('Unexpected voting XML request.');}});
  store.putSource(generation,'amendment:roster:'+documentDate,'amendment-roster',{members:[{id:'101',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+documentDate,fetchedAt:at}]},at);
  const source={url:'https://data.europarl.europa.eu/api/v2/meetings/'+sittingId+'/decisions?format=application%2Fld%2Bjson',fetchedAt:at};
  const vote={id:'eli/dl/event/'+sittingId+'-DEC-1',decided_on_a_realization_of:['eli/dl/doc/'+targetId+'-AM-1'],activity_date:'2026-10-07',decision_outcome:'def/ep-statuses/ADOPTED',decision_method:'def/ep-vote-methods/ROLL_CALL',source};
  store.putSource(generation,motionSourceKey(sittingId),'motion-outcomes',{amendmentVersion:AMENDMENTS_VERSION,amendmentProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION,splitParserVersion:SPLIT_PARSER_VERSION,splitRequests:[],parsedSplits:[],truncated:false,coverage:{missingResultIds:[],missingDecisionIds:[]},sources:[source],decisions:[vote],results:[{id:'eli/dl/event/'+sittingId+'-VOT-ITM-123',consists_of:[vote.id],sittingResultIds:[]}]},at);
  store.putSource(generation,'amendment:aliases:'+sittingId,'amendment-aliases',{aliases:[]},at);
  const context={store,worker,generation,calls,async ingest(references) {
    observation={...raw,inverse_foresees_change_of:references};
    const key='test:list-observations:'+calls.documents;
    store.enqueue(context.generation,key,'document',{endpoint:targetKey},180);
    const task=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(context.generation,key);
    await worker.task({...task,body:JSON.parse(task.body)});
  }};
  await context.ingest([listUri]);
  const detailTask=nextAmendmentTask(store,generation);assert.equal(detailTask.kind,'amendment-list-detail');await worker.task(detailTask);
  const extractTask=nextAmendmentTask(store,generation);assert.equal(extractTask.kind,'amendment-extract');await worker.task(extractTask);
  const page=amendmentsPage(store,{document:targetId});retainedRecord(page);assert.equal(page.coverage.complete,true);
  assert.deepEqual(calls,{documents:1,details:1,downloads:1});
  assert.equal(targetRecord(store,generation).listProjectionVersion,AMENDMENT_LINKS_VERSION);
  return context;
}

test('actual document ingestion retains malformed list observations without losing accepted amendment evidence',async t=>{
  const context=await fixture(t),{store,generation,calls}=context;
  await context.ingest([listUri,null,42,false]);
  const saved=store.source(generation,targetKey);
  assert.deepEqual(saved.work.inverse_foresees_change_of,[listUri,null,42,false]);
  assert.equal(saved.work.amendmentLinksVersion,AMENDMENT_LINKS_VERSION);
  const target=targetRecord(store,generation),page=amendmentsPage(store,{document:targetId});
  assert.equal(target.linkedListCount,1);assert.equal(target.linkedListObservationCount,4);assert.equal(target.unresolvedListObservationCount,3);
  retainedRecord(page);assert.equal(page.coverage.complete,false);
  assert(page.coverage.gaps.includes('Some linked amendment-list records have no usable exact EP document reference.'));
  assert.deepEqual(calls,{documents:2,details:1,downloads:1});
  assert.equal(nextAmendmentTask(store,generation),null);
});

test('malformed observations count before the list processing bound without inventing lookup jobs',async t=>{
  const context=await fixture(t),{store,generation,calls}=context;
  const malformed=Array.from({length:70},(_,index)=>[null,42,false][index%3]),references=[listUri,...malformed];
  await context.ingest(references);
  assert.deepEqual(store.source(generation,targetKey).work.inverse_foresees_change_of,references);
  const target=targetRecord(store,generation),page=amendmentsPage(store,{document:targetId});
  assert.equal(target.linkedListCount,1);assert.equal(target.linkedListObservationCount,71);assert.equal(target.unresolvedListObservationCount,70);
  retainedRecord(page);assert.equal(page.coverage.complete,false);
  assert(page.coverage.gaps.includes('This target exceeds the amendment-list processing limit.'));
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=? AND kind='amendment-list-detail'").get(generation).n,1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM sources WHERE generation=? AND kind='amendment-list'").get(generation).n,1);
  assert.deepEqual(calls,{documents:2,details:1,downloads:1});
  assert.equal(nextAmendmentTask(store,generation),null);
});

test('array observations and non-string object identifiers cannot be coerced into exact list references',async t=>{
  const context=await fixture(t),{store,generation,calls}=context;
  const malformed=[[listUri],{id:[listUri]},{id:42},{},true],references=[listUri,...malformed];
  await context.ingest(references);
  assert.deepEqual(store.source(generation,targetKey).work.inverse_foresees_change_of,references);
  const target=targetRecord(store,generation),page=amendmentsPage(store,{document:targetId});
  assert.equal(target.linkedListCount,1);assert.equal(target.linkedListObservationCount,6);assert.equal(target.unresolvedListObservationCount,5);
  retainedRecord(page);assert.equal(page.coverage.complete,false);
  assert(page.coverage.gaps.includes('Some linked amendment-list records have no usable exact EP document reference.'));
  assert.deepEqual(calls,{documents:2,details:1,downloads:1});
  assert.equal(nextAmendmentTask(store,generation),null);
});

test('legacy cropped list projections remain incomplete across pure reads and generation copies until a fresh document is ingested',async t=>{
  for(const proof of ['missing',2]) {
    const context=await fixture(t),{store,worker,calls}=context;
    const source=store.source(context.generation,targetKey),cropped=projectDocument({...source.work,amendmentLinksVersion:2,inverse_foresees_change_of:[listUri]});
    assert.equal(cropped.amendmentLinksVersion,2);
    store.putSource(context.generation,targetKey,'document',cropped,source.fetchedAt);
    const target=targetRecord(store,context.generation);target.complete=true;target.gaps=[];
    if(proof==='missing')delete target.listProjectionVersion;else target.listProjectionVersion=proof;
    store.db.prepare('UPDATE amendment_targets SET body=? WHERE generation=? AND id=?').run(JSON.stringify(target),context.generation,targetId);
    const before=snapshot(store),page=amendmentsPage(store,{document:targetId});
    retainedRecord(page);assert.equal(page.coverage.complete,false);assert(page.coverage.gaps.includes(projectionGap));
    assert.equal(amendmentsPage(store,{document:targetId,member:'101',outcome:'ADOPTED'}).total,1);
    assert.deepEqual(snapshot(store),before);
    const oldSourceBody=store.db.prepare('SELECT body FROM sources WHERE generation=? AND key=?').get(context.generation,targetKey).body;
    const oldTargetBody=store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(context.generation,targetId).body;
    store.publish(context.generation);context.generation=store.beginCycle().generation;
    assert.equal(store.db.prepare('SELECT body FROM sources WHERE generation=? AND key=?').get(context.generation,targetKey).body,oldSourceBody);
    assert.equal(store.db.prepare('SELECT body FROM amendment_targets WHERE generation=? AND id=?').get(context.generation,targetId).body,oldTargetBody);
    const adopted=snapshot(store),adoptedPage=amendmentsPage(store,{document:targetId});
    retainedRecord(adoptedPage);assert.equal(adoptedPage.coverage.complete,false);assert(adoptedPage.coverage.gaps.includes(projectionGap));
    assert.deepEqual(snapshot(store),adopted);
    rebuildAmendmentTarget(worker,context.generation,targetId);
    assert.equal(store.source(context.generation,targetKey).work.amendmentLinksVersion,2);
    assert.equal(targetRecord(store,context.generation).listProjectionVersion,2);
    const rebuilt=amendmentsPage(store,{document:targetId});retainedRecord(rebuilt);assert.equal(rebuilt.coverage.complete,false);
    assert.deepEqual(calls,{documents:1,details:1,downloads:1});
    await context.ingest([listUri]);
    const fresh=amendmentsPage(store,{document:targetId});retainedRecord(fresh);assert.equal(fresh.coverage.complete,true);
    assert.equal(store.source(context.generation,targetKey).work.amendmentLinksVersion,AMENDMENT_LINKS_VERSION);
    assert.equal(targetRecord(store,context.generation).listProjectionVersion,AMENDMENT_LINKS_VERSION);
    assert.deepEqual(calls,{documents:2,details:1,downloads:1});
  }
});
