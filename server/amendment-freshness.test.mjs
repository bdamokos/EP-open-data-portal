import {unthrottledUpstream} from './test-support/upstream.mjs';
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
import { AMENDMENTS_VERSION, AMENDMENT_SITTING_PROJECTION_VERSION, AMENDMENT_DISTRIBUTION_PROOF_VERSION } from './amendments.mjs';
import { amendmentsPage, enqueueAmendment, nextAmendmentTask } from './amendments-store.mjs';
import { amendmentParserUpgradeDue, prepareAmendmentParserUpgrade, failAmendmentTask, prepareAmendments, rebuildAmendmentTarget, scheduleAmendments } from './amendments-worker.mjs';
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

function amendmentDocx(proposed=oldProposed,author='Alex Common') {
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const paragraph=value=>'<w:p><w:r><w:t>'+escape(value)+'</w:t></w:r></w:p>';
  const row=values=>'<w:tr>'+values.map(value=>'<w:tc>'+paragraph(value)+'</w:tc>').join('')+'</w:tr>';
  const xml='<w:document xmlns:w="urn:word"><w:body>'+paragraph('<Amend><Date>2.10.2026</Date><NumAm>1</NumAm>')+
    paragraph('<Members>'+author+'</Members>')+paragraph('<Article>Article 1</Article>')+'<w:tbl>'+
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

function distributionObservation(work,mode) {
  const observed={...work};
  if(mode==='omitted')delete observed.is_realized_by;
  else if(mode==='null')observed.is_realized_by=null;
  else if(mode==='empty')observed.is_realized_by=[];
  else if(mode==='pdf-only')observed.is_realized_by=[{language:'http://publications.europa.eu/resource/authority/language/ENG',
    is_embodied_by:[{format:'authority/PDF',is_exemplified_by:'https://data.europarl.europa.eu/distribution/example/freshness_en.pdf'}]}];
  return observed;
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

async function fixture(t,{byteSize,baseline=true,initialDistribution='available',explicitNullSize=false}={}) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-freshness-'));
  let now=Date.parse(oldRetrievedAt),detail,downloads=0;
  const store=new ActivityStore(directory,{clock:()=>now});
  assert(store.acquire());
  const {generation}=store.beginCycle();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const oldBuffer=amendmentDocx(),descriptor={url:oldUrl,language:'en',byteSize:byteSize===undefined?oldBuffer.length:byteSize};
  detail=distributionObservation(listDetail(descriptor),initialDistribution);
  if(explicitNullSize)detail.is_realized_by[0].is_embodied_by[0].byteSize=null;
  const target={id:'eli/dl/doc/'+targetId,identifier:targetId,amendmentLinksVersion:AMENDMENT_LINKS_VERSION,
    work_type:'def/ep-document-types/REPORT_PLENARY',document_date:documentDate,title_dcterms:{en:'Public implementation report'},
    inverse_created_a_realization_of:['eli/dl/proc/2025-0233'],inverse_foresees_change_of:[detail.id],
    inverse_based_on_a_realization_of:['eli/dl/event/'+sittingId+'-VOT-ITM-123']};
  const worker=new ActivityWorker(store,{runUpstream:unthrottledUpstream,clock:()=>now,
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
  if(baseline) {
    assert.equal(nextAmendmentTask(store,generation).kind,'amendment-extract');
    await worker.task(nextAmendmentTask(store,generation));
    const page=amendmentsPage(store,{document:targetId}),[record]=page.items;
    assert.equal(downloads,1);assert.equal(page.coverage.complete,true,'The otherwise complete baseline must isolate wording freshness.');
    assert.equal(record.originalText,oldOriginal);assert.equal(record.proposedText,oldProposed);
    assert.equal(record.documentDate,documentDate);assert.equal(record.authors[0].personId,'101');assert.equal(record.outcome,'ADOPTED');
  } else assert.equal(downloads,0);
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
    async observeDistribution(mode,{route='detail'}={}) {
      now+=1000;assert(store.renew());detail=distributionObservation(listDetail(descriptor,correctedListDate),mode);
      const observation=route==='expanded'?detail:{id:detail.id,document_date:detail.document_date,
        ...(Object.hasOwn(detail,'is_realized_by')?{is_realized_by:detail.is_realized_by}:{})};
      const freshTarget={...target,inverse_created_a_realization_of:[],inverse_foresees_change_of:[observation]};
      if(route==='expanded') {
        const originalFetch=worker.fetchRecord;
        worker.fetchRecord=async endpoint=>{
          assert.equal(endpoint,targetKey);return {fetchedAt:new Date(now).toISOString(),payload:{data:[freshTarget]}};
        };
        try {
          const key='test:expanded:'+mode+':'+now;
          store.enqueue(generation,key,'document',{endpoint:targetKey},180);
          const row=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key);
          await worker.task({...row,body:JSON.parse(row.body)});
        } finally {worker.fetchRecord=originalFetch;}
      } else {
        store.putSource(generation,targetKey,'document',freshTarget,new Date(now).toISOString());
        rebuildAmendmentTarget(worker,generation,targetId);
        const task=nextAmendmentTask(store,generation);assert.equal(task.kind,'amendment-list-detail');
        await worker.task(task);
      }
      return freshTarget;
    },
  };
}

function retainedWording(context) {
  const {store}=context,page=amendmentsPage(store,{document:targetId}),[record]=page.items;
  assert.equal(page.coverage.complete,false);
  assert.equal(record.originalText,oldOriginal);assert.equal(record.proposedText,oldProposed);
  assert.equal(record.wordingRetained,true);
  assert.equal(record.sourceFreshness.version,AMENDMENT_DISTRIBUTION_PROOF_VERSION);
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
    await prepareAmendments(worker,store.get('working'));
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
      assert.equal(page.items[0].sourceFreshness.version,AMENDMENT_DISTRIBUTION_PROOF_VERSION,mode);
      assert.notEqual(page.items[0].sourceFreshness.status,'fresh',mode);
      if(mode==='missing-proof'||mode==='incomplete-proof')assert.equal(page.items[0].sourceFreshness.status,'unverified',mode);
      assert.deepEqual(page.items[0].wordingSource,{url:oldUrl,language:'en',fetchedAt:oldRetrievedAt},mode);
      assert.equal(memberPage.total,1,mode);assert.equal(memberPage.coverage.complete,false,mode);
    }
    assert.deepEqual(persistedEvidence(store,generation),before,mode);
  }
});

test('a successful extraction records an explicitly unrecorded published size as null proof rather than inventing a size',async t=>{
  for(const explicitNullSize of [false,true]) {
    const {store,generation}=await fixture(t,{byteSize:null,explicitNullSize});
    const saved=store.source(generation,listKey);
    assert.deepEqual(saved.work.extraction.sourceDescriptor,{url:oldUrl,language:'en',byteSize:null});
    assert.deepEqual(saved.work.distributionEvidence.descriptors,[{url:oldUrl,language:'en',byteSize:null}]);
    assert.equal(amendmentsPage(store,{document:targetId}).coverage.complete,true);
  }
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

function assertAbsentDistribution(context,mode,route,{extraction=null,pending=false}={}) {
  const {store,generation}=context,saved=store.source(generation,listKey),state=['omitted','null'].includes(mode)?'unavailable':'empty';
  const url='https://data.europarl.europa.eu/api/v2'+(route==='expanded'?targetKey:'/documents/'+listId)+'?format=application%2Fld%2Bjson';
  assert.deepEqual(saved.work.distributionEvidence,{version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,state,descriptors:[],
    source:{url,fetchedAt:context.at(),language:null}});
  assert.deepEqual(saved.work.files.filter(file=>file.format==='DOCX'),[]);
  assert.equal(saved.work.files.some(file=>file.url===oldUrl),false);
  if(extraction) {
    assert.deepEqual(saved.work.extraction,extraction,'Current metadata cannot rewrite accepted extraction evidence.');
    assert.equal(saved.work.extraction.sourceUrl,oldUrl);assert.equal(saved.work.extraction.fetchedAt,oldRetrievedAt);
    const page=retainedWording(context);
    assert.equal(page.coverage.pending,pending);
    assert.equal(page.items[0].sourceFreshness.distributionState,state);
  }
  return saved;
}

async function assertNoDistributionChurn(context) {
  const {store,worker,generation}=context;
  // Preparation has its own durable job; establish it before comparing the
  // subsequent metadata/extraction queues for unwanted repeated admission.
  await prepareAmendments(worker,store.get('working'));
  const before=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? ORDER BY key').all(generation);
  for(let pass=0;pass<3;pass++) {
    rebuildAmendmentTarget(worker,generation,targetId);
    const current=store.source(generation,targetKey);
    scheduleAmendments(worker,generation,current.work,current.fetchedAt,targetKey);
    await prepareAmendments(worker,store.get('working'));
    assert.deepEqual(store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? ORDER BY key').all(generation),before);
    assert.equal(nextAmendmentTask(store,generation),null);
  }
}

for(const route of ['detail','expanded'])test(route+' ingestion distinguishes unavailable distributions from observed empty DOCX sets while retaining prior wording',async t=>{
  for(const mode of ['omitted','null','empty','pdf-only']) {
    const context=await fixture(t),{store,worker,generation}=context;
    const extraction=store.source(generation,listKey).work.extraction;
    let downloads=0;
    worker.downloadAmendmentDocx=async()=>{downloads++;throw new Error('An absent current distribution must not download retained wording.');};
    await context.observeDistribution(mode,{route});
    assertAbsentDistribution(context,mode,route,{extraction});
    assert.equal(extractionJob(store,generation).done,1);
    await assertNoDistributionChurn(context);
    assert.equal(downloads,0);
  }
});

test('initial unavailable or empty distributions stay incomplete without invented retained wording or extraction retries',async t=>{
  for(const mode of ['omitted','null','empty','pdf-only']) {
    const context=await fixture(t,{baseline:false,initialDistribution:mode}),{store,generation}=context;
    assertAbsentDistribution(context,mode,'detail');
    assert.equal(store.source(generation,listKey).work.extraction,undefined);
    assert.equal(extractionJob(store,generation),undefined);
    const page=amendmentsPage(store,{document:targetId});
    assert.equal(page.coverage.complete,false);assert.equal(page.coverage.pending,false);
    assert(page.coverage.gaps.length>0);
    for(const record of page.items) {
      assert.equal(record.originalText,null);assert.equal(record.proposedText,null);
      assert.equal(Boolean(record.wordingRetained),false);assert.equal(Boolean(record.wordingSource?.url),false);
    }
    await assertNoDistributionChurn(context);
  }
});

test('an initial DOCX that exhausts three downloads reports failure rather than pending or retained wording',async t=>{
  const context=await fixture(t,{baseline:false}),{store,worker,generation}=context;
  let downloads=0;
  worker.downloadAmendmentDocx=async()=>{downloads++;throw new Error('Offline initial DOCX unavailable.');};
  for(let attempt=0;attempt<3;attempt++) {
    const task=nextAmendmentTask(store,generation);assert.equal(task.kind,'amendment-extract');assert.equal(task.attempts,attempt);
    const failure=new Error('Offline initial DOCX unavailable.');
    await assert.rejects(worker.task(task),/Offline initial DOCX unavailable/);
    if(!failAmendmentTask(worker,task,failure))store.failTask(task,failure);
    if(attempt<2){const job=extractionJob(store,generation);context.advance(job.retry_at-store.clock()+1);}
  }
  const saved=store.source(generation,listKey),page=amendmentsPage(store,{document:targetId});
  assert.equal(downloads,3);assert.equal(saved.work.extraction,undefined);assert(saved.work.wordingRefreshFailure);
  assert.equal(extractionJob(store,generation).done,1);assert.equal(page.coverage.complete,false);assert.equal(page.coverage.pending,false);
  assert(page.coverage.gaps.some(gap=>/fail|unavailable|download/i.test(gap)));
  assert.equal(page.coverage.gaps.some(gap=>/extraction is pending/i.test(gap)),false);
  for(const record of page.items) {
    assert.equal(record.originalText,null);assert.equal(record.proposedText,null);assert.equal(Boolean(record.wordingRetained),false);
  }
  await assertNoDistributionChurn(context);assert.equal(downloads,3);
});

test('legacy distribution proofs upgrade through one exact detail observation without downloading an old DOCX',async t=>{
  for(const legacyVersion of [null,1]) {
    const context=await fixture(t),{store,worker,generation,descriptor}=context;
    const saved=store.source(generation,listKey),legacy={...saved.work};
    if(legacyVersion===null)delete legacy.distributionEvidence;
    else legacy.distributionEvidence={version:legacyVersion,state:'available',descriptors:[descriptor],source:{url:'https://data.europarl.europa.eu/api/v2/documents/'+listId,fetchedAt:oldRetrievedAt,language:null}};
    store.putSource(generation,listKey,'amendment-list',legacy,saved.fetchedAt);
    if(legacyVersion===1) {
      // Older projection synthesized [] even when upstream omitted the field.
      // Exact identity/type/target evidence alone cannot certify that absence.
      const expanded={...listDetail(descriptor),is_realized_by:[]};
      delete expanded.amendmentDistributionDeclared;
      const target=store.source(generation,targetKey);
      store.putSource(generation,targetKey,'document',{...target.work,inverse_foresees_change_of:[expanded]},target.fetchedAt);
    }
    context.advance(1000);
    let details=0,downloads=0;
    worker.fetchRecord=async endpoint=>{assert.equal(endpoint,'/documents/'+listId);details++;return {fetchedAt:context.at(),payload:{data:[distributionObservation(listDetail(descriptor,correctedListDate),'empty')]}};};
    worker.downloadAmendmentDocx=async()=>{downloads++;throw new Error('Legacy distribution discovery must precede any retained DOCX download.');};
    for(let pass=0;pass<3;pass++)rebuildAmendmentTarget(worker,generation,targetId);
    assert.deepEqual(store.source(generation,listKey).work.distributionEvidence,legacy.distributionEvidence,
      'Unmarked expanded metadata cannot stamp a current empty distribution observation.');
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=? AND kind='amendment-list-detail' AND done<>1").get(generation).n,1);
    assert.equal(downloads,0);
    const task=nextAmendmentTask(store,generation);assert.equal(task.kind,'amendment-list-detail');
    assert.equal(extractionJob(store,generation).done,1);
    await worker.task(task);
    assertAbsentDistribution(context,'empty','detail',{extraction:saved.work.extraction});
    await assertNoDistributionChurn(context);
    assert.equal(details,1);assert.equal(downloads,0);
  }
});

test('already queued extraction settles without a stale download after current distribution metadata disappears',async t=>{
  for(const [mode,route] of [['null','detail'],['empty','expanded']]) {
    const context=await fixture(t),{store,worker,generation,descriptor}=context;
    await context.reverify({...descriptor,url:newUrl});
    const queued=nextAmendmentTask(store,generation);assert.equal(queued.kind,'amendment-extract');
    const gapKey='amendment:gap:'+extractKey,gap={taskKey:extractKey,taskKind:queued.kind,taskBody:queued.body,priority:queued.priority,
      error:'A historical earlier download failure.',failedAt:oldRetrievedAt};
    store.putSource(generation,gapKey,'amendment-gap',gap,oldRetrievedAt);
    const extraction=store.source(generation,listKey).work.extraction;
    await context.observeDistribution(mode,{route});
    assertAbsentDistribution(context,mode,route,{extraction,pending:true});
    let downloads=0,finishes=0;
    worker.downloadAmendmentDocx=async()=>{downloads++;throw new Error('A queued task cannot download a distribution absent from current metadata.');};
    const finish=store.finishTask.bind(store);
    store.finishTask=task=>{if(task.key===extractKey)finishes++;return finish(task);};
    const requests=worker.requests;
    await worker.task(nextAmendmentTask(store,generation));
    assert.equal(downloads,0);assert.equal(worker.requests,requests);assert.equal(finishes,1);
    assert.equal(extractionJob(store,generation).done,1);assert.equal(store.source(generation,listKey).work.wordingRefreshFailure,undefined);
    assert.deepEqual(store.source(generation,gapKey),{work:gap,fetchedAt:oldRetrievedAt});
    assertAbsentDistribution(context,mode,route,{extraction});await assertNoDistributionChurn(context);
    assert.equal(finishes,1);
  }
});

test('absence preserves an exhausted descriptor cooldown while a changed restored descriptor permits actual extraction',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  const buffer=amendmentDocx(freshProposed),failedDescriptor={...descriptor,url:newUrl,byteSize:buffer.length};
  await context.reverify(failedDescriptor);
  worker.downloadAmendmentDocx=async()=>{throw new Error('Offline restored distribution failure.');};
  for(let attempt=0;attempt<3;attempt++) {
    const task=nextAmendmentTask(store,generation),failure=new Error('Offline restored distribution failure.');
    await assert.rejects(worker.task(task),/Offline restored distribution failure/);
    if(!failAmendmentTask(worker,task,failure))store.failTask(task,failure);
    if(attempt<2){const job=extractionJob(store,generation);context.advance(job.retry_at-store.clock()+1);}
  }
  const failure=store.source(generation,listKey).work.wordingRefreshFailure,exhausted=extractionJob(store,generation);
  assert(failure);assert(Date.parse(failure.retryAfter)>store.clock());
  await context.observeDistribution('empty');
  assert.deepEqual(store.source(generation,listKey).work.wordingRefreshFailure,failure);
  assert.equal(retainedWording(context).coverage.pending,false);
  await context.reverify(failedDescriptor);
  assert.deepEqual(store.source(generation,listKey).work.wordingRefreshFailure,failure);
  assert.deepEqual(extractionJob(store,generation),exhausted);
  assert.equal(nextAmendmentTask(store,generation),null);
  assert.equal(retainedWording(context).coverage.pending,false);
  const restored={...failedDescriptor,url:newUrl.replace('_corrected_','_second_')};
  await context.reverify(restored);
  const task=nextAmendmentTask(store,generation);assert.equal(task.kind,'amendment-extract');assert.equal(task.attempts,0);
  let downloads=0;
  worker.downloadAmendmentDocx=async url=>{assert.equal(url,restored.url);downloads++;return {buffer};};
  await worker.task(task);
  const saved=store.source(generation,listKey),page=amendmentsPage(store,{document:targetId}),[record]=page.items;
  assert.equal(downloads,1);assert.equal(saved.work.distributionEvidence.state,'available');
  assert.deepEqual(saved.work.distributionEvidence.descriptors,[restored]);assert.deepEqual(saved.work.extraction.sourceDescriptor,restored);
  assert.equal(saved.work.wordingRefreshFailure,undefined);assert.equal(page.coverage.complete,true);assert.equal(page.coverage.pending,false);
  assert.equal(record.proposedText,freshProposed);assert.equal(record.wordingRetained,false);assert.equal(record.documentDate,documentDate);
  assert.deepEqual(record.wordingSource,{url:restored.url,language:'en',fetchedAt:context.at()});
});

test('generation adoption preserves current absence, a pending page cursor and retained descriptor cooldown',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  const saved=store.source(generation,listKey),failure={descriptor,failedAt:context.at(),retryAfter:new Date(store.clock()+86400000).toISOString(),error:'Retained previous descriptor download failure.'};
  store.putSource(generation,listKey,'amendment-list',{...saved.work,wordingRefreshFailure:failure},saved.fetchedAt);
  await context.observeDistribution('omitted');
  const source=store.source(generation,listKey);
  enqueueAmendment(store,generation,'test:retained-roster-page','amendment-roster',{
    date:documentDate,offset:1000,members:[{id:'101',givenName:'Alex',familyName:'Common'}],sources:[{url:'https://data.europarl.europa.eu/api/v2/meps/show-current?offset=0',fetchedAt:oldRetrievedAt}],
  },114);
  store.db.prepare('UPDATE amendment_jobs SET attempts=2,retry_at=?,error=? WHERE generation=? AND key=?').run(store.clock()+120000,'Retained page retry',generation,'test:retained-roster-page');
  const pending=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,'test:retained-roster-page');
  store.publish(generation);
  store.db.prepare('INSERT INTO sources SELECT 2,key,kind,body,fetched_at,seen FROM sources WHERE generation=?').run(generation);
  // This fixture predates accepted refresh snapshots; accepted mismatches fail closed.
  store.set('refreshPolicyGeneration',null);store.set('active',2);store.set('sequence',2);store.set('previous',generation);
  const adopted=store.beginCycle();assert.equal(adopted.generation,3);
  rebuildAmendmentTarget(worker,adopted.generation,targetId);
  assert.deepEqual(store.source(adopted.generation,listKey),source);
  const actual=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(adopted.generation,'test:retained-roster-page');
  assert.deepEqual({...actual,generation},{...pending});
  assert.equal(JSON.parse(actual.body).offset,1000);
  assert.equal(store.source(adopted.generation,listKey).work.distributionEvidence.state,'unavailable');
  assert.deepEqual(store.source(adopted.generation,listKey).work.wordingRefreshFailure,failure);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM amendment_jobs WHERE generation=? AND kind='amendment-extract' AND done<>1").get(adopted.generation).n,0);
  const page=amendmentsPage(store,{document:targetId});
  assert.equal(page.coverage.complete,false);assert.equal(page.coverage.pending,true);assert.equal(page.items[0].wordingRetained,true);
  assert.equal(page.items[0].proposedText,oldProposed);assert.equal(page.items[0].documentDate,documentDate);
});


function downgrade(context,{proof=true}={}) {
  const {store,generation}=context,saved=store.source(generation,listKey);
  const work={...saved.work,extraction:{...saved.work.extraction,parserVersion:'10'}};
  if(!proof)delete work.distributionEvidence;
  store.putSource(generation,listKey,'amendment-list',work,saved.fetchedAt);
  // Recovery must not wait for the report's independent relationship upgrade.
  const report=store.source(generation,targetKey);
  store.putSource(generation,targetKey,'document',{...report.work,amendmentLinksVersion:'old'},report.fetchedAt);
}

test('parser-only upgrades reuse matching retained bytes, preserve retrieval provenance and settle once',async t=>{
  const context=await fixture(t),{store,worker,generation}=context;
  downgrade(context);context.advance(4*86400000);
  store.publish(generation);
  store.set('lastSuccess',context.at());assert.equal(worker.coreDue(),false);assert.equal(amendmentParserUpgradeDue(store,generation),true);assert.equal(worker.due(),true);
  // Keep the daily core refresh out of this optional-upgrade assertion.
  store.set('lastSuccess',context.at());
  let downloads=0;worker.downloadAmendmentDocx=async()=>{downloads++;throw Error('Retained bytes should be reused');};
  prepareAmendmentParserUpgrade(worker,generation);
  await worker.task(nextAmendmentTask(store,generation));
  const upgrade=nextAmendmentTask(store,generation);assert.equal(upgrade.kind,'amendment-extract');
  await worker.task(upgrade);
  const extraction=store.source(generation,listKey).work.extraction;
  assert.equal(downloads,0);assert.equal(extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
  assert.equal(extraction.previousParserVersion,'10');assert.equal(extraction.fetchedAt,oldRetrievedAt);
  assert.equal(extraction.amendments[0].proposedText,oldProposed);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].proposedText,oldProposed);
  assert.equal(amendmentParserUpgradeDue(store,generation),false);
  const before=persistedEvidence(store,generation);prepareAmendmentParserUpgrade(worker,generation);assert.deepEqual(persistedEvidence(store,generation),before);
});

test('parser upgrade obtains current distribution proof directly when report metadata cannot refresh',async t=>{
  const context=await fixture(t),{store,worker,generation}=context;
  downgrade(context,{proof:false});
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));
  const detail=nextAmendmentTask(store,generation);assert.equal(detail.kind,'amendment-list-detail');assert.equal(detail.body.parserUpgrade,true);
  await worker.task(detail);
  assert.equal(nextAmendmentTask(store,generation).kind,'amendment-extract');
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(store.source(generation,listKey).work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
});

test('parser recovery downloads an expired or changed source and respects its bounded cold-download limit',async t=>{
  for(const mode of ['expired','changed','cold-limit']) {
    const context=await fixture(t),{store,worker,generation,descriptor}=context;downgrade(context);
    if(mode==='expired')context.advance(8*86400000);
    if(mode==='changed') {
      const saved=store.source(generation,listKey);
      store.putSource(generation,listKey,'amendment-list',{...saved.work,distributionEvidence:{...saved.work.distributionEvidence,descriptors:[{...descriptor,url:newUrl}]}},saved.fetchedAt);
    }
    if(mode==='cold-limit'){context.advance(8*86400000);worker.amendmentParserDownloads=4;}
    let downloads=0;worker.downloadAmendmentDocx=async url=>{assert.equal(url,mode==='changed'?newUrl:oldUrl);downloads++;return {buffer:amendmentDocx(freshProposed)};};
    prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));
    await worker.task(nextAmendmentTask(store,generation));
    if(mode==='cold-limit') {
      assert.equal(downloads,0);assert.equal(extractionJob(store,generation).done,0);assert.equal(extractionJob(store,generation).attempts,0);
      assert.equal(extractionJob(store,generation).retry_at,store.clock()+30*60_000);
      context.advance(30*60_000);worker.amendmentParserDownloads=0;await worker.task(nextAmendmentTask(store,generation));
    }
    assert.equal(downloads,1);assert.equal(store.source(generation,listKey).work.extraction.amendments[0].proposedText,freshProposed);
  }
});

test('verified parser-upgrade metadata survives extraction admission pressure without another source request',async t=>{
  const context=await fixture(t),{store,worker,generation}=context;downgrade(context,{proof:false});
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));
  const detail=nextAmendmentTask(store,generation);
  store.db.prepare('DELETE FROM amendment_jobs WHERE generation=? AND key=?').run(generation,extractKey);
  for(let i=store.db.prepare('SELECT COUNT(*) n FROM amendment_jobs').get().n;i<200;i++)enqueueAmendment(store,generation,'pressure:'+i,'amendment-reparse',{},100);
  store.db.prepare('UPDATE amendment_jobs SET done=0 WHERE generation=?').run(generation);
  store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:Array.from({length:200},(_,i)=>({key:'reserve:'+i}))},context.at());
  let requests=0;const fetch=worker.fetchRecord;worker.fetchRecord=async(...args)=>{requests++;return fetch(...args);};
  await worker.task(detail);
  assert.equal(requests,1);assert.equal(store.db.prepare('SELECT done FROM amendment_jobs WHERE generation=? AND key=?').get(generation,detail.key).done,0);
  store.db.prepare("DELETE FROM amendment_jobs WHERE key LIKE 'pressure:%'").run();store.db.prepare("DELETE FROM sources WHERE key='amendment:continuations'").run();
  await worker.task(detail);assert.equal(requests,1);
  assert.equal(extractionJob(store,generation).done,0);
  assert.equal(store.db.prepare('SELECT done FROM amendment_jobs WHERE generation=? AND key=?').get(generation,detail.key).done,1);
});

test('parser recovery respects retained cooldowns and wakes after expiry without a core refresh',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;downgrade(context);
  const saved=store.source(generation,listKey),retryAt=store.clock()+86400000;
  store.putSource(generation,listKey,'amendment-list',{...saved.work,wordingRefreshFailure:{descriptor,failedAt:context.at(),retryAfter:new Date(retryAt).toISOString(),error:'Retained download failure.'}},saved.fetchedAt);
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));
  assert.equal(amendmentParserUpgradeDue(store,generation),false);assert.equal(extractionJob(store,generation).done,1);
  context.advance(86400000);assert.equal(amendmentParserUpgradeDue(store,generation),true);
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));
  assert.equal(nextAmendmentTask(store,generation).kind,'amendment-extract');
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(store.source(generation,listKey).work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);assert.equal(store.source(generation,listKey).work.wordingRefreshFailure,undefined);
});

for(const migration of [true,false])test('an alternate byline deferred by the request budget resumes using retained primary bytes; migration='+migration,async t=>{
  const context=await fixture(t),{store,worker,generation}=context;downgrade(context);context.advance(8*86400000);
  const saved=store.source(generation,listKey),primary={url:oldUrl,language:'bg',byteSize:null},alternate={url:newUrl,language:'de',byteSize:null};
  if(!migration)saved.work.extraction.parserVersion=AMENDMENT_EXTRACTION_VERSION;
  store.putSource(generation,listKey,'amendment-list',{...saved.work,distributionEvidence:{...saved.work.distributionEvidence,descriptors:[primary,alternate]}},saved.fetchedAt);
  const downloads=[];worker.downloadAmendmentDocx=async url=>{downloads.push(url);return {buffer:amendmentDocx(freshProposed,url===oldUrl?'Данило Дела Вале':'Danilo Della Valle')};};
  if(migration){prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));}
  else enqueueAmendment(store,generation,extractKey,'amendment-extract',{listId,targetDocumentId:targetId},112,true);
  worker.requests=0;worker.budget=1;await worker.task(nextAmendmentTask(store,generation));
  assert.deepEqual(downloads,[oldUrl]);assert.equal(worker.requests,1);assert.equal(extractionJob(store,generation).done,0);
  assert.equal(store.source(generation,listKey).work.extraction.parserVersion,migration?'10':AMENDMENT_EXTRACTION_VERSION);
  context.advance(30*60_000);worker.requests=0;worker.budget=2;worker.amendmentParserDownloads=0;
  await worker.task(nextAmendmentTask(store,generation));
  assert.deepEqual(downloads,[oldUrl,newUrl]);assert.equal(worker.requests,1);assert.equal(extractionJob(store,generation).done,1);
  assert.equal(store.source(generation,listKey).work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
  assert.equal(store.source(generation,listKey).work.authorNames.source.url,newUrl);
});

test('settled parser checks avoid JSON scans and a later incompatible list invalidates the marker',async t=>{
  const context=await fixture(t),{store,worker,generation}=context;
  let scans=0;const prepare=store.db.prepare.bind(store.db);
  t.mock.method(store.db,'prepare',sql=>{if(sql.includes("json_extract(body,'$.extraction.parserVersion')"))scans++;return prepare(sql);});
  assert.equal(amendmentParserUpgradeDue(store,generation),true);
  prepareAmendmentParserUpgrade(worker,generation);assert.equal(scans,1);
  for(let poll=0;poll<10;poll++){assert.equal(amendmentParserUpgradeDue(store,generation),false);prepareAmendmentParserUpgrade(worker,generation);}
  assert.equal(scans,1);
  const saved=store.source(generation,listKey);store.putSource(generation,listKey,'amendment-list',saved.work,saved.fetchedAt);
  assert.equal(amendmentParserUpgradeDue(store,generation),false,'A compatible update cannot introduce upgrade work.');
  const other=listId.replace('001-001','002-002'),legacy={...saved.work,id:'eli/dl/doc/'+other,identifier:other,extraction:{...saved.work.extraction,parserVersion:'10'}};
  store.putSource(generation,'amendment:list:'+other,'amendment-list',legacy,saved.fetchedAt);
  assert.equal(amendmentParserUpgradeDue(store,generation),true);
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));
  assert.equal(store.db.prepare('SELECT done FROM amendment_jobs WHERE generation=? AND key=?').get(generation,'amendment:extract:'+other).done,0);
});

test('a repeated failure after byline progress still exhausts three attempts',async t=>{
  const context=await fixture(t),{store,worker,generation}=context;downgrade(context);context.advance(8*86400000);
  const saved=store.source(generation,listKey),primary={url:oldUrl,language:'bg',byteSize:null},alternate={url:newUrl,language:'de',byteSize:null};
  store.putSource(generation,listKey,'amendment-list',{...saved.work,distributionEvidence:{...saved.work.distributionEvidence,descriptors:[primary,alternate]}},saved.fetchedAt);
  worker.downloadAmendmentDocx=async url=>({buffer:amendmentDocx(freshProposed,url===oldUrl?'Данило Дела Вале':'Danilo Della Valle')});
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));
  const put=store.putSource.bind(store),failure=new Error('Persistent failure publishing extracted byline evidence.');
  t.mock.method(store,'putSource',(g,k,kind,work,...rest)=>{if(k===listKey&&work.extraction?.parserVersion===AMENDMENT_EXTRACTION_VERSION)throw failure;return put(g,k,kind,work,...rest);});
  for(let attempt=0;attempt<3;attempt++) {
    const task=nextAmendmentTask(store,generation);assert.equal(task.kind,'amendment-extract');assert.equal(task.attempts,attempt);
    await assert.rejects(worker.task(task),error=>error===failure);
    const exhausted=failAmendmentTask(worker,task,failure);assert.equal(exhausted,attempt===2);
    if(!exhausted){store.failTask(task,failure);context.advance(extractionJob(store,generation).retry_at-store.clock()+1);}
  }
  assert.equal(extractionJob(store,generation).done,1);assert(store.source(generation,listKey).work.wordingRefreshFailure);
});
