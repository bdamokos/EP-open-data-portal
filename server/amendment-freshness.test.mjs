import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { ActivityStore } from './activity-index-store.mjs';
import { ActivityWorker } from './activity-index-worker.mjs';
import { AMENDMENT_LINKS_VERSION } from './activity-index-model.mjs';
import { AMENDMENT_EXTRACTION_VERSION } from './amendment-documents.mjs';
import { AMENDMENTS_VERSION, AMENDMENT_SITTING_PROJECTION_VERSION } from './amendments.mjs';
import { amendmentsPage, nextAmendmentTask } from './amendments-store.mjs';
import { failAmendmentTask, prepareAmendments, rebuildAmendmentTarget, scheduleAmendments } from './amendments-worker.mjs';
import { SPLIT_PARSER_VERSION } from './amendment-splits.mjs';
import { motionSourceKey } from './motion-outcomes.mjs';

const targetId='A-10-2026-0254', listId=targetId+'-AM-001-001';
const sittingId='MTG-PL-2026-10-07', documentDate='2026-10-02', correctedListDate='2026-10-06';
const oldRetrievedAt='2026-10-16T16:00:00.000Z';
const oldUrl='https://data.europarl.europa.eu/distribution/example/freshness_en.docx';
const newUrl='https://data.europarl.europa.eu/distribution/example/freshness_corrected_en.docx';
const listKey='amendment:list:'+listId;
const extractKey='amendment:extract:'+listId;
const targetKey='/plenary-documents/'+targetId;
const oldOriginal='The original legal wording.';
const oldProposed='The previously verified proposed wording.';
const freshProposed='The corrected proposal sets a detailed requirement for an annual public implementation report.';

function amendmentDocx(proposed=oldProposed) {
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const paragraph=value=>'<w:p><w:r><w:t>'+escape(value)+'</w:t></w:r></w:p>';
  const row=values=>'<w:tr>'+values.map(value=>'<w:tc>'+paragraph(value)+'</w:tc>').join('')+'</w:tr>';
  const xml='<w:document xmlns:w="urn:word"><w:body>'+paragraph('<Amend><Date>2.10.2026</Date><NumAm>1</NumAm>')+
    paragraph('<Members>Alex Common</Members>')+paragraph('<Article>Article 1</Article>')+'<w:tbl>'+
    row(['Text proposed by the Commission','Amendment'])+row([oldOriginal,proposed])+'</w:tbl>'+paragraph('</Amend>')+'</w:body></w:document>';
  const name=Buffer.from('word/document.xml'), body=Buffer.from(xml), compressed=deflateRawSync(body);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
  return Buffer.concat([local,name,compressed,central,name,end]);
}

function realization(descriptor) {
  return [{language:'http://publications.europa.eu/resource/authority/language/'+(descriptor.language==='fr'?'FRA':'ENG'),
    is_embodied_by:[{format:'authority/DOCX',...(descriptor.byteSize==null?{}:{byteSize:descriptor.byteSize}),is_exemplified_by:descriptor.url}]}];
}

function listDetail(descriptor,date=documentDate) {
  return {id:'eli/dl/doc/'+listId,identifier:listId,work_type:'def/ep-document-types/AMENDMENT_LIST',document_date:date,
    foresees_change_of:['eli/dl/doc/'+targetId],is_realized_by:realization(descriptor)};
}

function deferred() {
  let resolve,reject;
  const promise=new Promise((accept,fail)=>{resolve=accept;reject=fail;});
  return {promise,resolve,reject};
}

function persistedEvidence(store,generation) {
  return {
    sources:store.db.prepare('SELECT key,kind,body,fetched_at FROM sources WHERE generation=? ORDER BY key').all(generation),
    amendments:store.db.prepare('SELECT * FROM amendments WHERE generation=? ORDER BY id').all(generation),
    targets:store.db.prepare('SELECT * FROM amendment_targets WHERE generation=? ORDER BY id').all(generation),
    jobs:store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? ORDER BY key').all(generation),
    failures:store.db.prepare('SELECT * FROM amendment_split_failures ORDER BY request_id,part_id,language').all(),
  };
}

function extractionJob(store,generation) {
  return store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,extractKey);
}

async function fixture(t,{byteSize}={}) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-freshness-'));
  let now=Date.parse(oldRetrievedAt),detail,downloads=0;
  const store=new ActivityStore(directory,{clock:()=>now});
  assert(store.acquire());
  const {generation}=store.beginCycle();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const oldBuffer=amendmentDocx(),descriptor={url:oldUrl,language:'en',byteSize:byteSize===undefined?oldBuffer.length:byteSize};
  detail=listDetail(descriptor);
  const target={id:'eli/dl/doc/'+targetId,identifier:targetId,amendmentLinksVersion:AMENDMENT_LINKS_VERSION,
    work_type:'def/ep-document-types/REPORT_PLENARY',document_date:documentDate,title_dcterms:{en:'Public implementation report'},
    inverse_created_a_realization_of:['eli/dl/proc/2025-0233'],inverse_foresees_change_of:[detail.id],
    inverse_based_on_a_realization_of:['eli/dl/event/'+sittingId+'-VOT-ITM-123']};
  const worker=new ActivityWorker(store,{clock:()=>now,
    fetchRecord:async endpoint=>{
      assert.equal(endpoint,'/documents/'+listId,'Unexpected network request in isolated amendment freshness test.');
      return {fetchedAt:new Date(now).toISOString(),payload:{data:[detail]}};
    },
    downloadAmendmentDocx:async url=>{assert.equal(url,oldUrl);downloads++;return {buffer:oldBuffer};},
    downloadVotingXml:async()=>{throw new Error('Unexpected voting XML download in amendment freshness test.');},
  });
  store.putSource(generation,targetKey,'document',target,oldRetrievedAt);
  store.putSource(generation,'/plenary-documents/B-10-2026-0424','document',{
    id:'eli/dl/doc/B-10-2026-0424',identifier:'B-10-2026-0424',amendmentLinksVersion:AMENDMENT_LINKS_VERSION,
    work_type:'def/ep-document-types/REPORT_PLENARY',document_date:documentDate,inverse_foresees_change_of:[],
  },oldRetrievedAt);
  for(const date of [documentDate,correctedListDate])store.putSource(generation,'amendment:roster:'+date,'amendment-roster',{
    date,members:[{id:'101',givenName:'Alex',familyName:'Common'}],
    sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?mandate-date='+date,fetchedAt:oldRetrievedAt}],
  },oldRetrievedAt);
  const decisionSource={url:'https://data.europarl.europa.eu/api/v2/meetings/'+sittingId+'/decisions?format=application%2Fld%2Bjson',fetchedAt:oldRetrievedAt};
  const decision={id:'eli/dl/event/'+sittingId+'-DEC-1',decided_on_a_realization_of:['eli/dl/doc/'+targetId+'-AM-1'],
    activity_date:'2026-10-07',decision_outcome:'def/ep-statuses/ADOPTED',decision_method:'def/ep-vote-methods/ROLL_CALL',source:decisionSource};
  store.putSource(generation,motionSourceKey(sittingId),'motion-outcomes',{
    amendmentVersion:AMENDMENTS_VERSION,amendmentProjectionVersion:AMENDMENT_SITTING_PROJECTION_VERSION,
    splitParserVersion:SPLIT_PARSER_VERSION,splitRequests:[],parsedSplits:[],truncated:false,
    coverage:{missingResultIds:[],missingDecisionIds:[]},sources:[decisionSource],decisions:[decision],
    results:[{id:'eli/dl/event/'+sittingId+'-VOT-ITM-123',consists_of:[decision.id],sittingResultIds:[]}],
  },oldRetrievedAt);
  store.putSource(generation,'amendment:aliases:'+sittingId,'amendment-aliases',{aliases:[]},oldRetrievedAt);
  rebuildAmendmentTarget(worker,generation,targetId);
  assert.equal(nextAmendmentTask(store,generation).kind,'amendment-list-detail');
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(nextAmendmentTask(store,generation).kind,'amendment-extract');
  await worker.task(nextAmendmentTask(store,generation));
  const page=amendmentsPage(store,{document:targetId}),[record]=page.items;
  assert.equal(downloads,1);assert.equal(page.coverage.complete,true,'The otherwise complete baseline must isolate wording freshness.');
  assert.equal(record.originalText,oldOriginal);assert.equal(record.proposedText,oldProposed);
  assert.equal(record.documentDate,documentDate);assert.equal(record.authors[0].personId,'101');assert.equal(record.outcome,'ADOPTED');
  return {store,worker,generation,descriptor,target,
    at:()=>new Date(now).toISOString(),
    advance:milliseconds=>{now+=milliseconds;assert(store.acquire());},
    async reverify(nextDescriptor,{date=correctedListDate}={}) {
      now+=1000;assert(store.renew());detail=listDetail(nextDescriptor,date);
      // This expanded observation omits the forward relation/type. It changes
      // the target fingerprint, so exact detail verification is still required.
      const observation={id:detail.id,document_date:date,is_realized_by:realization(nextDescriptor)};
      const freshTarget={...target,inverse_foresees_change_of:[observation]};
      store.putSource(generation,targetKey,'document',freshTarget,new Date(now).toISOString());
      rebuildAmendmentTarget(worker,generation,targetId);
      const task=nextAmendmentTask(store,generation);assert.equal(task.kind,'amendment-list-detail');
      await worker.task(task);
      assert.equal(store.source(generation,listKey).work.files[0].byteSize,nextDescriptor.byteSize);
      return freshTarget;
    },
  };
}

function retainedWording(context) {
  const {store}=context,page=amendmentsPage(store,{document:targetId}),[record]=page.items;
  assert.equal(page.coverage.complete,false);
  assert.equal(record.originalText,oldOriginal);assert.equal(record.proposedText,oldProposed);
  assert.equal(record.wordingRetained,true);
  assert.equal(record.sourceFreshness.version,1);
  assert.notEqual(record.sourceFreshness.status,'fresh');
  assert.deepEqual(record.wordingSource,{url:oldUrl,language:'en',fetchedAt:oldRetrievedAt});
  assert.equal(record.documentDate,documentDate);assert.equal(record.proposerDate,documentDate);
  assert.equal(record.listDocumentDate,correctedListDate);assert.equal(record.authors[0].personId,'101');
  return page;
}

test('a changed published byte size at the same DOCX URL requires extraction after exact detail verification',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  const buffer=amendmentDocx(freshProposed),corrected={...descriptor,byteSize:buffer.length};
  assert.notEqual(corrected.byteSize,descriptor.byteSize);
  await context.reverify(corrected);
  assert.equal(retainedWording(context).coverage.pending,true);
  const task=nextAmendmentTask(store,generation);assert.equal(task.kind,'amendment-extract');
  let downloads=0;
  worker.downloadAmendmentDocx=async(url,{signal}={})=>{assert.equal(url,oldUrl);assert.equal(signal,worker.controller.signal);downloads++;return {buffer};};
  await worker.task(task);
  const saved=store.source(generation,listKey),page=amendmentsPage(store,{document:targetId}),[record]=page.items;
  assert.equal(downloads,1);assert.equal(saved.work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
  assert.deepEqual(saved.work.extraction.sourceDescriptor,corrected);
  assert.equal(saved.work.wordingRefreshFailure,undefined);
  assert.equal(page.coverage.complete,true);assert.equal(page.coverage.pending,false);
  assert.equal(record.proposedText,freshProposed);assert.equal(record.wordingRetained,false);
  assert.equal(record.sourceFreshness.status,'fresh');
  assert.deepEqual(record.sourceFreshness.descriptor,corrected);
  assert.deepEqual(record.sourceFreshness.sourceDescriptor,corrected);
  assert.deepEqual(record.wordingSource,{url:oldUrl,language:'en',fetchedAt:context.at()});
});

test('three corrected-URL download failures retain coherent old wording and finish the job once without same-turn reopening',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  const corrected={...descriptor,url:newUrl};
  const freshTarget=await context.reverify(corrected);
  assert.equal(retainedWording(context).coverage.pending,true);
  let downloads=0,finishes=0;
  const finish=store.finishTask.bind(store);
  store.finishTask=task=>{if(task.key===extractKey)finishes++;return finish(task);};
  worker.downloadAmendmentDocx=async url=>{assert.equal(url,newUrl);downloads++;throw Object.assign(new Error('Offline corrected DOCX unavailable.'),{status:503});};
  for(let attempt=0;attempt<3;attempt++) {
    const task=nextAmendmentTask(store,generation);assert.equal(task.kind,'amendment-extract');assert.equal(task.attempts,attempt);
    let failure;
    try {await worker.task(task);assert.fail('A failed download must not be accepted.');}catch(error){failure=error;}
    assert.match(failure.message,/Offline corrected DOCX unavailable/);
    if(!failAmendmentTask(worker,task,failure))store.failTask(task,failure);
    const saved=store.source(generation,listKey),job=extractionJob(store,generation);
    if(attempt===2) {
      assert(saved.work.wordingRefreshFailure,'Exhausted download failure evidence must be retained with the list.');
      assert.deepEqual(saved.work.wordingRefreshFailure.descriptor,corrected);
      assert.equal(saved.work.wordingRefreshFailure.failedAt,context.at());
      assert.equal(Date.parse(saved.work.wordingRefreshFailure.retryAfter),store.clock()+86400000);
      assert.match(saved.work.wordingRefreshFailure.error,/Offline corrected DOCX unavailable/);
    } else assert.equal(saved.work.wordingRefreshFailure,undefined);
    assert.deepEqual(saved.work.extraction.sourceDescriptor,descriptor);
    assert.equal(saved.work.extraction.sourceUrl,oldUrl);assert.equal(saved.work.extraction.fetchedAt,oldRetrievedAt);
    assert.equal(saved.work.document_date,correctedListDate);assert.equal(saved.work.files[0].url,newUrl);
    const page=retainedWording(context);
    assert.equal(page.items[0].sourceFreshness.status,attempt===2?'failed':'pending');
    assert.equal(page.coverage.pending,attempt<2);
    assert.equal(job.done,attempt===2?1:0);
    if(attempt<2){assert.equal(job.attempts,attempt+1);context.advance(job.retry_at-store.clock()+1);}
  }
  assert.equal(downloads,3);assert.equal(finishes,1);
  const exhausted=extractionJob(store,generation);
  for(let pass=0;pass<3;pass++) {
    rebuildAmendmentTarget(worker,generation,targetId);
    scheduleAmendments(worker,generation,freshTarget,context.at(),targetKey);
    prepareAmendments(worker,store.get('working'));
    assert.deepEqual(extractionJob(store,generation),exhausted,'Rebuild/scheduling must not reset an exhausted task in the same turn.');
    assert.equal(nextAmendmentTask(store,generation),null);
    assert.equal(retainedWording(context).coverage.pending,false);
  }
  assert.equal(downloads,3);assert.equal(finishes,1);
});

test('a successful retry stores the current descriptor proof and clears a previous wording download failure',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  const buffer=amendmentDocx(freshProposed),corrected={...descriptor,url:newUrl,byteSize:buffer.length};
  const freshTarget=await context.reverify(corrected);
  worker.downloadAmendmentDocx=async()=>{throw new Error('Offline initial refresh failure.');};
  for(let attempt=0;attempt<3;attempt++) {
    const failed=nextAmendmentTask(store,generation);
    await assert.rejects(worker.task(failed),/Offline initial refresh failure/);
    const failure=new Error('Offline initial refresh failure.');
    if(!failAmendmentTask(worker,failed,failure))store.failTask(failed,failure);
    const waiting=extractionJob(store,generation);
    if(attempt<2)context.advance(waiting.retry_at-store.clock()+1);
  }
  const failure=store.source(generation,listKey).work.wordingRefreshFailure;
  assert(failure);context.advance(Date.parse(failure.retryAfter)-store.clock()+1);
  const sitting=store.source(generation,motionSourceKey(sittingId));
  store.putSource(generation,motionSourceKey(sittingId),'motion-outcomes',sitting.work,context.at());
  scheduleAmendments(worker,generation,freshTarget,context.at(),targetKey);
  const retry=nextAmendmentTask(store,generation);assert.equal(retry.kind,'amendment-extract');assert.equal(retry.attempts,0);
  worker.downloadAmendmentDocx=async(url)=>{assert.equal(url,newUrl);return {buffer};};
  await worker.task(retry);
  const saved=store.source(generation,listKey),page=amendmentsPage(store,{document:targetId});
  assert.deepEqual(saved.work.extraction.sourceDescriptor,corrected);
  assert.equal(saved.work.wordingRefreshFailure,undefined);assert.equal(saved.work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
  assert.equal(page.coverage.complete,true);assert.equal(page.coverage.pending,false);assert.equal(page.items[0].wordingRetained,false);
  assert.equal(page.items[0].sourceFreshness.status,'fresh');
  assert.equal(page.items[0].proposedText,freshProposed);
  assert.deepEqual(page.items[0].wordingSource,{url:newUrl,language:'en',fetchedAt:context.at()});
});

test('legacy or mismatched descriptor proofs are never made fresh by pure API reads and leave retained JSON unchanged',async t=>{
  for(const mode of ['missing-proof','incomplete-proof','changed-byte-size','changed-language','changed-url']) {
    const context=await fixture(t,mode==='incomplete-proof'?{byteSize:null}:{}),{store,generation,descriptor}=context;
    const saved=store.source(generation,listKey),work=structuredClone(saved.work);
    if(mode==='missing-proof')delete work.extraction.sourceDescriptor;
    else if(mode==='incomplete-proof')delete work.extraction.sourceDescriptor.byteSize;
    else {
      const changed={...descriptor,...(mode==='changed-byte-size'?{byteSize:descriptor.byteSize+1}:mode==='changed-language'?{language:'fr'}:{url:newUrl})};
      work.files=work.files.map(file=>({...file,...changed}));work.is_realized_by=realization(changed);
    }
    store.putSource(generation,listKey,'amendment-list',work,saved.fetchedAt);
    // Legacy indexed snapshots have no source-freshness proof. Normal detail
    // ingestion rebuilds rows synchronously, as the worker controls above prove.
    const indexed=store.db.prepare('SELECT body FROM amendments WHERE generation=? AND id=?').get(generation,targetId+'-AM-1');
    const legacy=JSON.parse(indexed.body);delete legacy.sourceFreshness;
    store.db.prepare('UPDATE amendments SET body=? WHERE generation=? AND id=?').run(JSON.stringify(legacy),generation,legacy.id);
    const before=persistedEvidence(store,generation);
    for(let read=0;read<3;read++) {
      const page=amendmentsPage(store,{document:targetId}),memberPage=amendmentsPage(store,{document:targetId,member:'101'});
      assert.equal(page.coverage.complete,false,mode);assert.equal(page.coverage.pending,false,mode);
      assert.equal(page.items[0].originalText,oldOriginal,mode);assert.equal(page.items[0].proposedText,oldProposed,mode);
      assert.equal(page.items[0].wordingRetained,true,mode);
      assert.equal(page.items[0].sourceFreshness.version,1,mode);
      assert.notEqual(page.items[0].sourceFreshness.status,'fresh',mode);
      if(mode==='missing-proof'||mode==='incomplete-proof')assert.equal(page.items[0].sourceFreshness.status,'unverified',mode);
      assert.deepEqual(page.items[0].wordingSource,{url:oldUrl,language:'en',fetchedAt:oldRetrievedAt},mode);
      assert.equal(memberPage.total,1,mode);assert.equal(memberPage.coverage.complete,false,mode);
    }
    assert.deepEqual(persistedEvidence(store,generation),before,mode);
  }
});

test('a successful extraction records an explicitly unrecorded published size as null proof rather than inventing a size',async t=>{
  const {store,generation}=await fixture(t,{byteSize:null});
  assert.deepEqual(store.source(generation,listKey).work.extraction.sourceDescriptor,{url:oldUrl,language:'en',byteSize:null});
  assert.equal(amendmentsPage(store,{document:targetId}).coverage.complete,true);
});

test('controller cancellation accepts neither late refreshed wording nor late download failure evidence',async t=>{
  for(const lateOutcome of ['success','failure']) {
    const context=await fixture(t),{store,worker,generation,descriptor}=context;
    await context.reverify({...descriptor,url:newUrl});
    const task=nextAmendmentTask(store,generation),started=deferred(),reply=deferred();
    const before=persistedEvidence(store,generation);
    worker.running=true;
    worker.downloadAmendmentDocx=async(url,{signal}={})=>{assert.equal(url,newUrl);started.resolve(signal);return reply.promise;};
    const pending=worker.task(task),rejected=assert.rejects(pending,error=>error===worker.controller.signal.reason);
    const signal=await started.promise;assert.equal(signal,worker.controller.signal);
    worker.stop();
    if(lateOutcome==='success')reply.resolve({buffer:amendmentDocx(freshProposed)});
    else reply.reject(new Error('Late failed refresh after cancellation.'));
    await rejected;worker.running=false;
    assert.equal(failAmendmentTask(worker,task,new Error('A cancelled refresh must not record this failure.')),false);
    assert.deepEqual(persistedEvidence(store,generation),before,lateOutcome);
    assert.equal(store.source(generation,listKey).work.wordingRefreshFailure,undefined);
    assert.equal(extractionJob(store,generation).done,0);
  }
});
