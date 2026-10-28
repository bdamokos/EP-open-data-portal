import {unthrottledUpstream} from './test-support/upstream.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { ActivityStore } from './activity-index-store.mjs';
import { ActivityWorker } from './activity-index-worker.mjs';
import { AMENDMENT_LINKS_VERSION } from './activity-index-model.mjs';
import { AMENDMENT_EXTRACTION_VERSION } from './amendment-documents.mjs';
import { AMENDMENTS_VERSION, AMENDMENT_SITTING_PROJECTION_VERSION, AMENDMENT_DISTRIBUTION_PROOF_VERSION, listWordingFreshness } from './amendments.mjs';
import { amendmentsPage, enqueueAmendment, nextAmendmentTask } from './amendments-store.mjs';
import { amendmentParserUpgradeDue, prepareAmendmentParserUpgrade, failAmendmentTask, prepareAmendments, rebuildAmendmentTarget, scheduleAmendments, AMENDMENT_PARSER_DOWNLOAD_PACE, amendmentParserDownloadsKey } from './amendments-worker.mjs';
import { SPLIT_PARSER_VERSION } from './amendment-splits.mjs';
import { amendmentSourceStore } from './amendment-source-store.mjs';
import {AMENDMENT_AUTHOR_NAMES_VERSION} from './amendment-author-names.mjs';
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

function amendmentDocx(proposed=oldProposed,author='Alex Common',number=1) {
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const paragraph=value=>'<w:p><w:r><w:t>'+escape(value)+'</w:t></w:r></w:p>';
  const row=values=>'<w:tr>'+values.map(value=>'<w:tc>'+paragraph(value)+'</w:tc>').join('')+'</w:tr>';
  const xml='<w:document xmlns:w="urn:word"><w:body>'+paragraph('<Amend><Date>2.10.2026</Date><NumAm>'+number+'</NumAm>')+
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
    is_embodied_by:[{format:'authority/DOCX',...(descriptor.byteSize==null?{}:{byteSize:descriptor.byteSize}),...(descriptor.issued?{issued:descriptor.issued}:{}),is_exemplified_by:descriptor.url}]}];
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
  let now=Date.parse(oldRetrievedAt),mono=0,detail,downloads=0;
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
  const worker=new ActivityWorker(store,{runUpstream:unthrottledUpstream,clock:()=>now,monotonic:()=>mono,
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
    advance:milliseconds=>{now+=milliseconds;mono+=Math.max(0,milliseconds);assert(store.acquire());},
    // Moves only the wall clock; monotonic time keeps running forward.
    shiftWallClock:milliseconds=>{now+=milliseconds;},
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
    const needsDetail=route==='expanded'&&['omitted','null'].includes(mode);
    assertAbsentDistribution(context,mode,route,{extraction,pending:needsDetail});
    if(needsDetail) {
      assert.equal(nextAmendmentTask(store,generation).kind,'amendment-list-detail');
      await worker.task(nextAmendmentTask(store,generation));
      assertAbsentDistribution(context,mode,'detail',{extraction});
    }
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

for(const route of ['expanded','detail'])test('normal document ingestion retains issued and invalidates source reuse and verification fingerprints: '+route,async t=>{
  const context=await fixture(t,{baseline:false}),{store,worker,generation,descriptor}=context;
  let downloads=0;
  worker.downloadAmendmentDocx=async url=>{assert.equal(url,descriptor.url);downloads++;return {buffer:amendmentDocx(downloads===1?oldProposed:freshProposed)};};
  async function ingest(issued) {
    const detail=listDetail({...descriptor,issued});
    const observation=route==='expanded'?detail:{id:detail.id,is_realized_by:detail.is_realized_by};
    const raw={...context.target,parliamentary_term:'org/ep-10',inverse_created_a_realization_of:[],inverse_foresees_change_of:[observation]};
    worker.fetchRecord=async endpoint=>{
      assert([targetKey,'/documents/'+listId].includes(endpoint));
      return {fetchedAt:context.at(),payload:{data:[endpoint===targetKey?raw:detail]}};
    };
    const key='test:issued:'+issued;
    store.enqueue(generation,key,'document',{endpoint:targetKey},180);
    const row=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(generation,key);
    await worker.task({...row,body:JSON.parse(row.body)});
    const projected=store.source(generation,targetKey).work.inverse_foresees_change_of[0];
    assert.equal(projected.is_realized_by[0].is_embodied_by[0].issued,issued);
    if(route==='detail') {
      const task=nextAmendmentTask(store,generation);assert.equal(task.kind,'amendment-list-detail','An issue-only change must invalidate recent detail verification.');
      await worker.task(task);
    }
    assert.equal(store.source(generation,listKey).work.distributionEvidence.descriptors[0].issued,issued);
    return store.source(generation,listKey).work.relationshipEvidence.fingerprint;
  }
  const first=await ingest('2026-10-02T17:04:06+02:00');
  await worker.task(nextAmendmentTask(store,generation));assert.equal(downloads,1);
  context.advance(1000);
  const second=await ingest('2026-10-02T17:04:07+02:00');
  assert.notEqual(first,second,'The published issue time participates in the relationship fingerprint.');
  assert.equal(listWordingFreshness(store.source(generation,listKey).work,{parserVersion:AMENDMENT_EXTRACTION_VERSION}).status,'pending');
  const task=nextAmendmentTask(store,generation);assert.equal(task.kind,'amendment-extract');
  await worker.task({...task,body:{...task.body,parserUpgrade:true}});
  const extraction=store.source(generation,listKey).work.extraction;
  assert.equal(downloads,2,'Parser work cannot reuse bytes from the older publication.');
  assert.equal(extraction.sourceDescriptor.issued,'2026-10-02T17:04:07+02:00');
  assert.equal(extraction.amendments[0].proposedText,freshProposed);
});

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

for(const stage of ['extract','metadata','failed-extract','missing-distribution'])for(const pressure of [false,true])test('parser '+stage+' rebuild preserves admission and report links; pressure='+pressure,async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  const saved=store.source(generation,listKey),report=store.source(generation,targetKey),buffers=new Map();
  const ids=Array.from({length:12},(_,i)=>targetId+'-AM-'+String(i+1).padStart(3,'0')+'-'+String(i+1).padStart(3,'0'));
  for(const [index,id] of ids.entries()) {
    const url='https://data.europarl.europa.eu/distribution/example/'+id+'_en.docx',buffer=amendmentDocx(freshProposed,'Alex Common',index+1);buffers.set(url,buffer);
    const work=JSON.parse(JSON.stringify(saved.work).replaceAll(listId,id).replaceAll(descriptor.url,url));
    work.extraction.parserVersion='10';work.extraction.amendments=work.extraction.amendments.map(amendment=>({...amendment,number:index+1}));
    work.distributionEvidence.descriptors[0].byteSize=buffer.length;work.extraction.sourceDescriptor.byteSize=buffer.length;
    if(stage==='metadata')delete work.distributionEvidence;
    store.putSource(generation,'amendment:list:'+id,'amendment-list',work,saved.fetchedAt);
  }
  worker.downloadAmendmentDocx=async url=>{assert(buffers.has(url));return {buffer:buffers.get(url)};};
  store.putSource(generation,targetKey,'document',{...report.work,inverse_foresees_change_of:ids.map(id=>'eli/dl/doc/'+id)},report.fetchedAt);
  context.advance(8*86400000);
  // Recovery must also avoid creating author-discovery work from missing dates.
  store.db.prepare("DELETE FROM sources WHERE generation=? AND kind='amendment-roster'").run(generation);store.set('amendmentMandateFallback',true);
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));
  const listJobs=()=>store.db.prepare("SELECT COUNT(*) n FROM amendment_jobs WHERE generation=? AND done=0 AND kind IN ('amendment-extract','amendment-list-detail')").get(generation).n;
  assert.equal(listJobs(),8);
  if(pressure) {
    for(let i=store.db.prepare('SELECT COUNT(*) n FROM amendment_jobs WHERE generation=?').get(generation).n;i<200;i++)enqueueAmendment(store,generation,'filler:'+i,'amendment-reparse',{},1);
    store.putSource(generation,'amendment:continuations','amendment-continuations',{tasks:Array.from({length:200},(_,i)=>({generation,key:'reserved:'+i,kind:'amendment-reparse',body:'{}',priority:1,done:0,attempts:0,retry_at:0,error:null}))},context.at());
  }
  const checkpoint=store.source(generation,'amendment:continuations'),marker=store.source(generation,targetKey).work.amendmentLinksVersion;
  const job=nextAmendmentTask(store,generation);assert.equal(job.kind,stage==='metadata'?'amendment-list-detail':'amendment-extract');
  if(stage==='missing-distribution') {
    const key='amendment:list:'+job.body.listId,source=store.source(generation,key);
    store.putSource(generation,key,'amendment-list',{...source.work,distributionEvidence:{version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,state:'unavailable',descriptors:[]}},source.fetchedAt);
  }
  if(stage==='metadata')worker.fetchRecord=async endpoint=>{
    const id=endpoint.split('/').at(-1),url='https://data.europarl.europa.eu/distribution/example/'+id+'_en.docx';
    return {fetchedAt:context.at(),payload:{data:[{...listDetail({url,language:'en',byteSize:buffers.get(url).length}),id:'eli/dl/doc/'+id,identifier:id}]}};
  };
  if(stage==='failed-extract')assert.equal(failAmendmentTask(worker,{...job,attempts:2},new Error('Offline DOCX failure.')),true);
  else await worker.task(job);
  assert(listJobs()<=8,'Recovery rebuilds cannot bypass the eight-job admission bound.');
  assert.equal(store.source(generation,targetKey).work.amendmentLinksVersion,marker);
  assert.deepEqual(store.source(generation,'amendment:continuations'),checkpoint,'Recovery must not fill reserves or create capacity gaps.');
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM amendment_jobs WHERE generation=? AND kind IN ('amendment-roster','amendment-members','amendment-member') AND done=0").get(generation).n,0);
  if(stage==='extract')assert.equal(store.source(generation,'amendment:list:'+job.body.listId).work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
});

test('parser recovery reuses retained bytes at any age and downloads only a changed or missing source within its cold-download limit',async t=>{
  for(const mode of ['aged','changed','missing','cold-limit']) {
    const context=await fixture(t),{store,worker,generation,descriptor}=context;downgrade(context);
    context.advance(mode==='changed'?0:400*86400000);
    if(mode==='changed') {
      const saved=store.source(generation,listKey);
      store.putSource(generation,listKey,'amendment-list',{...saved.work,distributionEvidence:{...saved.work.distributionEvidence,descriptors:[{...descriptor,url:newUrl}]}},saved.fetchedAt);
    }
    if(mode==='missing'||mode==='cold-limit')store.db.prepare('DELETE FROM amendment_sources').run();
    if(mode==='cold-limit')store.set(amendmentParserDownloadsKey,Array.from({length:AMENDMENT_PARSER_DOWNLOAD_PACE.downloads},(_,i)=>({at:store.clock()-(AMENDMENT_PARSER_DOWNLOAD_PACE.downloads-1-i)*1000})));
    let downloads=0;worker.downloadAmendmentDocx=async url=>{assert.equal(url,mode==='changed'?newUrl:oldUrl);downloads++;return {buffer:amendmentDocx(freshProposed)};};
    prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));
    await worker.task(nextAmendmentTask(store,generation));
    if(mode==='cold-limit') {
      assert.equal(downloads,0);assert.equal(extractionJob(store,generation).done,0);assert.equal(extractionJob(store,generation).attempts,0);
      // The job waits only until the oldest paced download leaves the window.
      const slot=store.clock()-(AMENDMENT_PARSER_DOWNLOAD_PACE.downloads-1)*1000+AMENDMENT_PARSER_DOWNLOAD_PACE.windowMs;
      assert.equal(extractionJob(store,generation).retry_at,slot);
      assert.equal(nextAmendmentTask(store,generation),null);
      context.advance(slot-store.clock());await worker.task(nextAmendmentTask(store,generation));
    }
    const extraction=store.source(generation,listKey).work.extraction;
    assert.equal(extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
    if(mode==='aged') {
      // A year-old retrieval of the current descriptor still serves parser-only work.
      assert.equal(downloads,0);assert.equal(extraction.fetchedAt,oldRetrievedAt);assert.equal(extraction.amendments[0].proposedText,oldProposed);
    } else {assert.equal(downloads,1);assert.equal(extraction.fetchedAt,context.at());assert.equal(extraction.amendments[0].proposedText,freshProposed);}
  }
});

for(const [issued,expectedDownloads] of [['2026-10-19T00:00:00Z',0],['2026-10-20T00:00:00Z',0],['2026-10-25T00:00:00Z',1]])test('first legacy reuse requires retrieval at or after publication: '+issued,async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  const sources=amendmentSourceStore(store),retrievedAt='2026-10-20T00:00:00Z';
  await sources.save(descriptor,amendmentDocx(),retrievedAt);
  context.advance(10*86400000);await context.reverify({...descriptor,issued});downgrade(context);
  let downloads=0;
  const proposed='A new requirement.',zipped=amendmentDocx(proposed),buffer=Buffer.concat([zipped,Buffer.alloc(descriptor.byteSize-zipped.length)]);
  buffer.writeUInt16LE(descriptor.byteSize-zipped.length,zipped.length-2);
  worker.downloadAmendmentDocx=async()=>{downloads++;return {buffer};};
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));await worker.task(nextAmendmentTask(store,generation));
  const extraction=store.source(generation,listKey).work.extraction;
  assert.equal(downloads,expectedDownloads);
  assert.equal(extraction.sourceDescriptor.issued,issued);
  assert.equal(extraction.amendments[0].proposedText,expectedDownloads?proposed:oldProposed);
  assert.equal(extraction.fetchedAt,expectedDownloads?context.at():retrievedAt);
});

test('a raw-file write failure keeps the finished extraction and logs storage failure once',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context,sources=amendmentSourceStore(store);
  const buffer=amendmentDocx(freshProposed),file={...descriptor,url:newUrl,byteSize:buffer.length};
  const blocked=path.join(sources.directory,createHash('sha256').update(buffer).digest('hex')+'.docx');mkdirSync(blocked);
  const warnings=[];t.mock.method(console,'warn',message=>warnings.push(message));
  await context.reverify(file);
  worker.downloadAmendmentDocx=async()=>({buffer});
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(extractionJob(store,generation).done,1);
  assert.equal(store.source(generation,listKey).work.extraction.amendments[0].proposedText,freshProposed);
  assert.equal(await sources.save(file,buffer,context.at()),false);assert.equal(warnings.length,1);
  rmSync(blocked,{recursive:true});assert.equal(await sources.save(file,buffer,context.at()),true);
});

test('initialization failure does not block a completed extraction and maintenance retries later',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context,sources=amendmentSourceStore(store);
  const buffer=amendmentDocx(freshProposed);await context.reverify({...descriptor,url:newUrl,byteSize:buffer.length});
  const warnings=[];t.mock.method(console,'warn',message=>warnings.push(message));
  sources.schemaReady=false;
  const failed=t.mock.method(sources,'schema',()=>{throw Object.assign(new Error('Storage unavailable'),{code:'EIO'});});
  worker.downloadAmendmentDocx=async()=>({buffer});
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(extractionJob(store,generation).done,1);
  assert.equal(store.source(generation,listKey).work.extraction.amendments[0].proposedText,freshProposed);
  assert.equal(warnings.length,1);assert.equal(failed.mock.calls.length,1);
  failed.mock.restore();context.advance(60_001);assert.equal(await sources.initialize(),true);
});

test('a matching dated row retrieved before its publication downloads again without failing the list',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  const issued='2026-10-02T00:00:00Z';
  await context.reverify({...descriptor,issued});downgrade(context);
  // Simulate a dated row retained by the old implementation, which trusted its binding.
  store.db.prepare('UPDATE amendment_sources SET issued=?,retrieved_at=?').run(issued,'2026-10-01T00:00:00Z');
  let downloads=0;worker.downloadAmendmentDocx=async()=>{downloads++;return {buffer:amendmentDocx(freshProposed)};};
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));await worker.task(nextAmendmentTask(store,generation));
  assert.equal(downloads,1);assert.equal(extractionJob(store,generation).done,1);assert.equal(extractionJob(store,generation).attempts,0);
  const result=store.source(generation,listKey).work.extraction;
  assert.equal(result.amendments[0].proposedText,freshProposed);assert.equal(result.fetchedAt,context.at());
});

for(const mode of ['current','older-writer','missing-issue'])test('retained reuse records the observed issue time and later republication requires a download; '+mode,async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;downgrade(context);context.advance(30*86400000);
  const observe=issued=>{
    const saved=store.source(generation,listKey);
    store.putSource(generation,listKey,'amendment-list',{...saved.work,distributionEvidence:{...saved.work.distributionEvidence,descriptors:[{...descriptor,issued}]}},saved.fetchedAt);
  };
  let downloads=0;worker.downloadAmendmentDocx=async()=>{downloads++;return {buffer:amendmentDocx(freshProposed)};};
  // The retained baseline recorded no issue time, so a newly published one matches.
  observe('2026-10-02T17:04:06+02:00');
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));await worker.task(nextAmendmentTask(store,generation));
  assert.equal(downloads,0);assert.equal(store.source(generation,listKey).work.extraction.fetchedAt,oldRetrievedAt);
  // Successful reuse records the descriptor without changing the byte retrieval time.
  const sources=store.db.prepare('SELECT * FROM amendment_sources').all();assert.equal(sources.length,1);
  assert.equal(sources[0].issued,'2026-10-02T17:04:06+02:00');assert.equal(sources[0].retrieved_at,oldRetrievedAt);
  const saved=store.source(generation,listKey);
  assert.equal(listWordingFreshness({...saved.work,distributionEvidence:{...saved.work.distributionEvidence,descriptors:[{...descriptor,issued:'2026-10-02T15:04:06Z'}]}},{parserVersion:AMENDMENT_EXTRACTION_VERSION}).status,'fresh','The same instant in another notation is the same publication.');
  // Older writers left the row unissued even though extraction recorded T1.
  if(mode==='older-writer')store.db.prepare("UPDATE amendment_sources SET issued=''").run();
  if(mode==='missing-issue') {
    downgrade(context);observe(undefined);
    prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));await worker.task(nextAmendmentTask(store,generation));
    assert.equal(downloads,0);assert.deepEqual(store.db.prepare('SELECT issued FROM amendment_sources ORDER BY issued').all().map(row=>row.issued),['','2026-10-02T17:04:06+02:00']);
  }
  downgrade(context);observe('2026-10-20T09:00:00+02:00');
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));await worker.task(nextAmendmentTask(store,generation));
  const extraction=store.source(generation,listKey).work.extraction;
  assert.equal(downloads,1);assert.equal(extraction.fetchedAt,context.at());assert.equal(extraction.amendments[0].proposedText,freshProposed);
  assert.equal(extraction.sourceDescriptor.issued,'2026-10-20T09:00:00+02:00');
  assert.equal(listWordingFreshness(store.source(generation,listKey).work,{parserVersion:AMENDMENT_EXTRACTION_VERSION}).status,'fresh');
  assert.deepEqual(store.db.prepare('SELECT issued FROM amendment_sources ORDER BY retrieved_at').all().map(row=>row.issued),mode==='older-writer'?['2026-10-20T09:00:00+02:00']:['2026-10-02T17:04:06+02:00','2026-10-20T09:00:00+02:00']);
});

for(const mode of ['identical','different','evicted'])test('an undated normal download before same-size republication still requires new bytes; '+mode,async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  const t1='2026-10-02T17:04:06+02:00',t2='2026-10-25T09:00:00+02:00';
  const upgrade=async()=>{downgrade(context);prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));await worker.task(nextAmendmentTask(store,generation));};
  await context.reverify({...descriptor,issued:t1});await upgrade();
  const first=store.source(generation,listKey).work.extraction;
  assert.equal(first.sourceDescriptor.issued,t1);assert.equal(typeof first.sourceHash,'string');
  context.advance(8*86400000);await context.reverify(descriptor);
  if(mode==='evicted') {
    const sources=amendmentSourceStore(store),observation=store.source(generation,listKey);sources.maxBytes=1;
    // The list still references T1, so test the actual eligible eviction path
    // only after that generation stops publishing the list.
    store.db.prepare("DELETE FROM sources WHERE key=?").run(listKey);
    await sources.reserve(1);sources.maxBytes=1024*1024;
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM amendment_sources').get().n,0);
    // Restore only the list observation/extraction, as a later generation can.
    store.putSource(generation,listKey,'amendment-list',observation.work,observation.fetchedAt);
  }
  let downloads=0;
  worker.downloadAmendmentDocx=async()=>{downloads++;return {buffer:amendmentDocx(mode==='different'?'Different undated wording.':oldProposed)};};
  enqueueAmendment(store,generation,extractKey,'amendment-extract',{listId,targetDocumentId:targetId},112,true);
  await worker.task(nextAmendmentTask(store,generation));assert.equal(downloads,1);
  const undated=store.source(generation,listKey).work.extraction;
  assert.equal(undated.sourceDescriptor.issued,undefined,'Undated observations retain the descriptor actually observed.');
  assert.equal(Object.hasOwn(undated,'publicationBinding'),false);
  context.advance(2*86400000);await context.reverify({...descriptor,issued:t2});downloads=0;
  const proposed='A new requirement.',zipped=amendmentDocx(proposed),buffer=Buffer.concat([zipped,Buffer.alloc(descriptor.byteSize-zipped.length)]);
  buffer.writeUInt16LE(descriptor.byteSize-zipped.length,zipped.length-2);
  assert.equal(buffer.length,amendmentDocx().length);
  worker.downloadAmendmentDocx=async()=>{downloads++;return {buffer};};
  await upgrade();
  const result=store.source(generation,listKey).work.extraction;
  assert.equal(downloads,1);assert.equal(result.amendments[0].proposedText,proposed);
  assert.equal(result.sourceDescriptor.issued,t2);assert.equal(Object.hasOwn(result,'publicationBinding'),false);
});

test('primary and alternate byline downloads and reuse share retrieval-time checks',async t=>{
  const context=await fixture(t,{baseline:false}),{store,worker,generation,descriptor}=context;
  const primary=amendmentDocx(oldProposed,'Данило Дела Вале'),alternate=amendmentDocx(oldProposed,'Danilo Della Valle');
  const otherUrl=oldUrl.replace('_en','_de'),files=[{...descriptor,language:'bg',byteSize:primary.length},{url:otherUrl,language:'de',byteSize:alternate.length}];
  let downloads=0;
  worker.downloadAmendmentDocx=async url=>{downloads++;assert([oldUrl,otherUrl].includes(url));return {buffer:url===oldUrl?primary:alternate};};
  const observe=issued=>{
    const saved=store.source(generation,listKey);
    store.putSource(generation,listKey,'amendment-list',{...saved.work,distributionEvidence:{...saved.work.distributionEvidence,descriptors:files.map(file=>({...file,...(issued?{issued}:{})}))}},saved.fetchedAt);
  };
  const extract=async parserUpgrade=>{
    enqueueAmendment(store,generation,extractKey,'amendment-extract',{listId,targetDocumentId:targetId,parserUpgrade},112,true);
    const task=extractionJob(store,generation);await worker.task({...task,amendmentJob:true,body:JSON.parse(task.body)});
  };
  observe();await extract(true);assert.equal(downloads,2);
  const t1='2026-10-02T17:04:06+02:00',t2='2026-10-25T09:00:00+02:00';
  observe(t1);downloads=0;await extract(true);assert.equal(downloads,0);
  let work=store.source(generation,listKey).work;
  assert.equal(work.extraction.sourceDescriptor.issued,t1);assert.equal(work.authorNames.descriptor.issued,t1);
  const roster=store.source(generation,'amendment:roster:'+documentDate);
  store.putSource(generation,'amendment:roster:'+documentDate,'amendment-roster',{...roster.work,nameVersion:1},roster.fetchedAt);
  context.advance(8*86400000);observe();downloads=0;await extract(false);assert.equal(downloads,2);
  work=store.source(generation,listKey).work;
  assert.equal(work.extraction.sourceDescriptor.issued,undefined);assert.equal(work.authorNames.descriptor.issued,undefined);
  assert.equal(Object.hasOwn(work.extraction,'publicationBinding'),false);assert.equal(Object.hasOwn(work.authorNames,'publicationBinding'),false);
  const originalDownload=worker.downloadAmendmentDocx;
  worker.downloadAmendmentDocx=async url=>{if(url===otherUrl)throw new Error('Alternate source unavailable');return originalDownload(url);};
  await extract(false);work=store.source(generation,listKey).work;
  assert.match(work.authorNames.error,/Alternate source unavailable/);
  assert.equal(store.db.prepare('SELECT retrieved_at FROM amendment_sources WHERE url=? AND issued=?').get(otherUrl,'').retrieved_at,context.at());
  worker.downloadAmendmentDocx=async url=>{assert.equal(url,oldUrl);return {buffer:alternate};};
  await extract(false);work=store.source(generation,listKey).work;
  assert.equal(work.authorNames,null,'A Latin-only parse no longer needs the alternate source.');
  assert.equal(work.extraction.sourceDescriptor.issued,undefined,'Different undated primary bytes remain unassigned.');
  assert.equal(store.db.prepare('SELECT retrieved_at FROM amendment_sources WHERE url=? AND issued=?').get(otherUrl,'').retrieved_at,context.at());
  worker.downloadAmendmentDocx=originalDownload;
  context.advance(86400000);observe(t2);downloads=0;await extract(true);assert.equal(downloads,2);
  work=store.source(generation,listKey).work;
  assert.equal(work.extraction.sourceDescriptor.issued,t2);assert.equal(work.authorNames.descriptor.issued,t2);
});

test('parser-upgrade extraction reads retained bytes off the main thread and paces consecutive lists',async t=>{
  const context=await fixture(t),{store,worker,generation}=context;downgrade(context);context.advance(90*86400000);
  const calls=[];const extract=worker.extractAmendmentList;
  worker.extractAmendmentList=async(...args)=>{calls.push(performance.now());return extract(...args);};
  worker.downloadAmendmentDocx=async()=>{throw new Error('Retained bytes should be reused.');};
  // A previous slice just ended and took 120 ms: the next one waits at least as long.
  worker.amendmentExtractionPace={endedAt:performance.now(),lastMs:120};
  const started=performance.now();
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));await worker.task(nextAmendmentTask(store,generation));
  assert.equal(calls.length,1);assert(calls[0]-started>=110,'The extraction slice yields to the event loop before parsing.');
  assert.equal(store.source(generation,listKey).work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
  assert(worker.amendmentExtractionPace.lastMs>0);
});

test('a successor writer re-extracts from bytes retained by its predecessor without downloading',async t=>{
  const context=await fixture(t),{store,generation}=context;downgrade(context);context.advance(30*86400000);
  store.release();
  const other=new ActivityStore(path.dirname(store.filename),{clock:()=>store.clock()});t.after(()=>other.close());assert(other.acquire());
  let downloads=0;
  const successor=new ActivityWorker(other,{runUpstream:unthrottledUpstream,clock:()=>other.clock(),monotonic:()=>0,downloadAmendmentDocx:async()=>{downloads++;throw new Error('Retained bytes should be reused.');}});
  prepareAmendmentParserUpgrade(successor,generation);
  await successor.task(nextAmendmentTask(other,generation));await successor.task(nextAmendmentTask(other,generation));
  const extraction=other.source(generation,listKey).work.extraction;
  assert.equal(downloads,0);assert.equal(extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);assert.equal(extraction.fetchedAt,oldRetrievedAt);
  // The former writer can no longer change the retained sources.
  await assert.rejects(amendmentSourceStore(store).save({url:oldUrl,language:'en',byteSize:1},Buffer.from('x'),context.at()),/writer lease was lost/);
});

// Stale lists whose extraction jobs run through the real admission and source-queue path.
function staleLists(context,count) {
  const {store,worker,generation,descriptor}=context,saved=store.source(generation,listKey),report=store.source(generation,targetKey);
  const ids=Array.from({length:count},(_,i)=>targetId+'-AM-'+String(i+2).padStart(3,'0')+'-'+String(i+2).padStart(3,'0')),buffers=new Map(),downloads=[];
  for(const [index,id] of ids.entries()) {
    const url='https://data.europarl.europa.eu/distribution/example/'+id+'_en.docx',buffer=amendmentDocx(freshProposed,'Alex Common',index+2);buffers.set(url,buffer);
    const work=JSON.parse(JSON.stringify(saved.work).replaceAll(listId,id).replaceAll(descriptor.url,url));
    work.extraction.parserVersion='10';work.extraction.amendments=work.extraction.amendments.map(amendment=>({...amendment,number:index+2}));
    work.distributionEvidence.descriptors[0].byteSize=buffer.length;work.extraction.sourceDescriptor.byteSize=buffer.length;
    store.putSource(generation,'amendment:list:'+id,'amendment-list',work,saved.fetchedAt);
  }
  store.putSource(generation,targetKey,'document',{...report.work,inverse_foresees_change_of:[...[report.work.inverse_foresees_change_of].flat().filter(Boolean),...ids.map(id=>'eli/dl/doc/'+id)]},report.fetchedAt);
  worker.downloadAmendmentDocx=async url=>{assert(buffers.has(url));downloads.push({url,at:store.clock()});return {buffer:buffers.get(url)};};
  const extract=async(id,target=worker)=>{
    const key='amendment:extract:'+id;
    enqueueAmendment(target.store,generation,key,'amendment-extract',{listId:id,targetDocumentId:targetId,parserUpgrade:true},112,true);
    const row=target.store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key);
    await target.task({...row,body:JSON.parse(row.body),amendmentJob:true});
    return target.store.db.prepare('SELECT done,retry_at FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key);
  };
  return {ids,downloads,extract};
}
const pace=AMENDMENT_PARSER_DOWNLOAD_PACE;

test('parser download pacing survives a worker restart and a writer handoff',async t=>{
  const context=await fixture(t),{store,worker,generation}=context;context.advance(8*86400000);
  const {ids,downloads,extract}=staleLists(context,6);
  for(const id of ids.slice(0,pace.downloads))assert.equal((await extract(id)).done,1);
  assert.equal(downloads.length,pace.downloads);
  // A new worker in the same process has its own monotonic clock.
  const restarted=new ActivityWorker(store,{runUpstream:unthrottledUpstream,clock:()=>store.clock(),monotonic:()=>0,downloadAmendmentDocx:worker.downloadAmendmentDocx});
  context.advance(60_000);
  const deferred=await extract(ids[4],restarted);
  assert.equal(downloads.length,pace.downloads);assert.equal(deferred.done,0);
  assert.equal(deferred.retry_at,downloads[0].at+pace.windowMs);
  // A handoff opens the same database through a separate store and lease.
  store.release();
  const other=new ActivityStore(path.dirname(store.filename),{clock:()=>store.clock()});t.after(()=>other.close());
  assert(other.acquire());
  const successor=new ActivityWorker(other,{runUpstream:unthrottledUpstream,clock:()=>other.clock(),monotonic:()=>0,downloadAmendmentDocx:worker.downloadAmendmentDocx});
  assert.equal((await extract(ids[5],successor)).done,0);assert.equal(downloads.length,pace.downloads);
  context.shiftWallClock(pace.windowMs-60_000);assert(other.acquire());
  assert.equal((await extract(ids[5],successor)).done,1);assert.equal(downloads.length,pace.downloads+1);
  assert(other.get(amendmentParserDownloadsKey).length<=pace.downloads,'The persisted history stays bounded.');
});

test('parser download pacing debits when a queued download starts',async t=>{
  const context=await fixture(t),{worker}=context;context.advance(8*86400000);
  const {ids,downloads,extract}=staleLists(context,5);
  // The source queue holds the first operation through a cooldown longer than the window.
  let delayed=false;
  worker.runUpstream=async(operation)=>{if(!delayed){delayed=true;context.advance(pace.windowMs+1000);}return operation(new AbortController().signal);};
  for(const id of ids)await extract(id);
  assert.equal(downloads.length,pace.downloads);
  assert(downloads.every(download=>download.at===downloads[0].at),'All admitted downloads started after the queue delay.');
  const sorted=downloads.map(download=>download.at).sort((a,b)=>a-b);
  for(let index=pace.downloads;index<sorted.length;index++)assert(sorted[index]-sorted[index-pace.downloads]>=pace.windowMs);
});

// Holds queued source operations until the test opens the gate.
function gatedUpstream(worker,expected) {
  let open,arrived=0,reached;
  const gate=new Promise(resolve=>{open=resolve;}),ready=new Promise(resolve=>{reached=resolve;});
  worker.runUpstream=async operation=>{if(++arrived===expected)reached();await gate;return operation(new AbortController().signal);};
  return {ready,open};
}

test('concurrently queued parser downloads cannot both take the last pacing slot',async t=>{
  const context=await fixture(t),{worker}=context;context.advance(8*86400000);
  const {ids,downloads,extract}=staleLists(context,pace.downloads+1);
  for(const id of ids.slice(0,pace.downloads-1))assert.equal((await extract(id)).done,1);
  const upstream=gatedUpstream(worker,2);
  // Both jobs pass the queue-time check with one slot left.
  const pending=[extract(ids[pace.downloads-1]),extract(ids[pace.downloads])];
  await upstream.ready;upstream.open();
  const results=await Promise.all(pending);
  assert.equal(downloads.length,pace.downloads);
  assert.deepEqual(results.map(result=>result.done).sort(),[0,1]);
  assert.equal(results.find(result=>result.done===0).retry_at,downloads[0].at+pace.windowMs);
});

test('a parser download queued across writer-lease loss neither downloads nor records pacing',async t=>{
  const context=await fixture(t),{store,worker}=context;context.advance(8*86400000);
  const {ids,downloads,extract}=staleLists(context,1);
  const before=store.get(amendmentParserDownloadsKey) ?? null;
  const upstream=gatedUpstream(worker,1),pending=extract(ids[0]);
  await upstream.ready;
  // The lease expires while the download waits, and another writer takes over.
  context.shiftWallClock(91_000);
  const other=new ActivityStore(path.dirname(store.filename),{clock:()=>store.clock()});t.after(()=>other.close());
  assert(other.acquire());
  upstream.open();
  await assert.rejects(pending,/writer lease was lost/);
  assert.equal(downloads.length,0);
  assert.deepEqual(other.get(amendmentParserDownloadsKey) ?? null,before);
});

test('parser download pacing is conservative when the wall clock moves backward',async t=>{
  const context=await fixture(t),{store,worker}=context;context.advance(8*86400000);
  const {ids,downloads,extract}=staleLists(context,6);
  for(const id of ids.slice(0,pace.downloads))await extract(id);
  assert.equal(downloads.length,pace.downloads);
  context.shiftWallClock(-1000);
  assert.equal((await extract(ids[4])).done,0);assert.equal(downloads.length,pace.downloads);
  // Persisted timestamps read by another worker are clamped, not discarded.
  const restarted=new ActivityWorker(store,{runUpstream:unthrottledUpstream,clock:()=>store.clock(),monotonic:()=>0,downloadAmendmentDocx:worker.downloadAmendmentDocx});
  assert.equal((await extract(ids[5],restarted)).done,0);assert.equal(downloads.length,pace.downloads);
  assert(store.get(amendmentParserDownloadsKey).every(entry=>entry.at<=store.clock()));
  // Monotonic time alone frees this worker's own slots after the window.
  context.advance(pace.windowMs);context.shiftWallClock(-pace.windowMs);
  assert.equal((await extract(ids[4])).done,1);assert.equal(downloads.length,pace.downloads+1);
});

test('a target rebuild rewrites only amendment rows whose stored projection changed',async t=>{
  const context=await fixture(t),{store,worker,generation}=context;
  const saved=store.source(generation,listKey),second={...saved.work.extraction.amendments[0],number:2,originalText:'Second original.',proposedText:'Second proposal.'};
  store.putSource(generation,listKey,'amendment-list',{...saved.work,extraction:{...saved.work.extraction,amendments:[...saved.work.extraction.amendments,second]}},saved.fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId,{discover:false});
  store.db.exec('CREATE TEMP TABLE amendment_writes(id TEXT)');
  store.db.exec('CREATE TEMP TRIGGER amendment_write_count AFTER INSERT ON main.amendments BEGIN INSERT INTO amendment_writes VALUES (NEW.id); END');
  const writes=()=>store.db.prepare('SELECT id FROM amendment_writes ORDER BY id').all().map(row=>row.id);
  rebuildAmendmentTarget(worker,generation,targetId,{discover:false});
  assert.deepEqual(writes(),[]);
  const current=store.source(generation,listKey);
  store.putSource(generation,listKey,'amendment-list',{...current.work,extraction:{...current.work.extraction,amendments:current.work.extraction.amendments.map(amendment=>amendment.number===2?{...amendment,proposedText:'Second corrected proposal.'}:amendment)}},current.fetchedAt);
  rebuildAmendmentTarget(worker,generation,targetId,{discover:false});
  assert.deepEqual(writes(),[targetId+'-AM-2']);
  const page=amendmentsPage(store,{document:targetId});
  assert.deepEqual(page.items.map(item=>[item.number,item.proposedText]).sort(),[[1,oldProposed],[2,'Second corrected proposal.']]);
  // Each projected change writes exactly its rows, and the following unchanged
  // rebuild writes none.
  const both=[targetId+'-AM-1',targetId+'-AM-2'];
  const change=(label,update,expected,check)=>{
    store.db.exec('DELETE FROM amendment_writes');
    const list=store.source(generation,listKey);store.putSource(generation,listKey,'amendment-list',update(structuredClone(list.work)),list.fetchedAt);
    rebuildAmendmentTarget(worker,generation,targetId,{discover:false});
    assert.deepEqual(writes(),expected,label);
    const record=amendmentsPage(store,{document:targetId}).items.find(item=>item.number===2);check?.(record);
    store.db.exec('DELETE FROM amendment_writes');rebuildAmendmentTarget(worker,generation,targetId,{discover:false});
    assert.deepEqual(writes(),[],label+' settles');
  };
  const later='2026-10-17T09:00:00.000Z';
  change('retrieval date',work=>{work.extraction.fetchedAt=later;work.extraction.amendments=work.extraction.amendments.map(amendment=>({...amendment,wordingSource:{...amendment.wordingSource,fetchedAt:later}}));return work;},both,record=>assert.equal(record.wordingSource.fetchedAt,later));
  change('freshness',work=>{work.distributionEvidence.descriptors[0].byteSize+=1;work.files=work.files.map(file=>file.format==='DOCX'?{...file,byteSize:file.byteSize+1}:file);return work;},both,record=>assert.equal(record.sourceFreshness.status,'pending'));
  change('gaps',work=>{work.extraction.amendments=work.extraction.amendments.map(amendment=>amendment.number===2?{...amendment,gaps:[...(amendment.gaps || []),'A fixture gap.']}:amendment);return work;},[targetId+'-AM-2'],record=>assert(record.gaps.includes('A fixture gap.')));
  change('retained flags',work=>{work.extraction.amendments=work.extraction.amendments.map(amendment=>amendment.number===2?{...amendment,proposerRetained:true}:amendment);return work;},[targetId+'-AM-2'],record=>assert.equal(record.proposerRetained,true));
  change('missing row',work=>{work.extraction.amendments=work.extraction.amendments.filter(amendment=>amendment.number!==2);return work;},[targetId+'-AM-2'],record=>assert(record.gaps.includes('Source was absent from the latest partial refresh.')));
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
  context.advance(30*60_000);worker.requests=0;worker.budget=2;
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

test('unavailable current-schema metadata is reobserved even without report links',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  await context.observeDistribution('omitted');downgrade(context);
  const report=store.source(generation,targetKey);store.putSource(generation,targetKey,'document',{...report.work,inverse_foresees_change_of:[]},report.fetchedAt);
  let requests=0;worker.fetchRecord=async endpoint=>{assert.equal(endpoint,'/documents/'+listId);requests++;return {fetchedAt:context.at(),payload:{data:[listDetail(descriptor)]}};};
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));
  assert.equal(nextAmendmentTask(store,generation).kind,'amendment-list-detail');await worker.task(nextAmendmentTask(store,generation));
  assert.equal(requests,1);assert.equal(nextAmendmentTask(store,generation).kind,'amendment-extract');
  await worker.task(nextAmendmentTask(store,generation));assert.equal(store.source(generation,listKey).work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
});

for(const location of ['queue','tasks'])test('parser recovery adopts a delayed metadata retry in '+location+' without resetting progress',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  await context.observeDistribution('omitted');downgrade(context);
  const key='amendment:discover:'+targetId+':'+listId;
  const savedBody={listId,targetDocumentId:targetId,offset:3,sources:[{url:'https://data.europarl.europa.eu/example',fetchedAt:context.at()}]};
  enqueueAmendment(store,generation,key,'amendment-list-detail',savedBody,115,true);
  worker.fetchRecord=async()=>{throw new Error('Offline metadata failure.');};
  const retry=nextAmendmentTask(store,generation);
  await assert.rejects(worker.task(retry),/Offline metadata failure/);store.failTask(retry,new Error('Offline metadata failure.'));
  const before=store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key);
  assert(before.retry_at>store.clock());assert.equal(nextAmendmentTask(store,generation),null);
  if(location!=='queue') {
    store.putSource(generation,'amendment:continuations','amendment-continuations',{[location]:[before]},context.at());
    store.db.prepare('DELETE FROM amendment_jobs WHERE generation=? AND key=?').run(generation,key);
  }
  const report=store.source(generation,targetKey);
  store.putSource(generation,targetKey,'document',{...report.work,inverse_foresees_change_of:[]},report.fetchedAt);
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));
  const after=location==='queue'?store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key):store.source(generation,'amendment:continuations').work[location][0];
  assert.deepEqual(JSON.parse(after.body),{...savedBody,parserUpgrade:true});
  assert.deepEqual({...after,body:before.body},{...before},'Only recovery intent changes; retry state and priority survive.');
  if(location!=='queue') {
    worker.checkpointContinuations(generation,{includeCore:false});
    assert.deepEqual({...store.db.prepare('SELECT * FROM amendment_jobs WHERE generation=? AND key=?').get(generation,key)},{...after});
  }
  assert.equal(nextAmendmentTask(store,generation),null);context.advance(before.retry_at-store.clock());
  let requests=0;worker.fetchRecord=async endpoint=>{assert.equal(endpoint,'/documents/'+listId);requests++;return {fetchedAt:context.at(),payload:{data:[listDetail(descriptor)]}};};
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(requests,1);assert.equal(nextAmendmentTask(store,generation).kind,'amendment-extract');
  await worker.task(nextAmendmentTask(store,generation));assert.equal(store.source(generation,listKey).work.extraction.parserVersion,AMENDMENT_EXTRACTION_VERSION);
});

for(const mode of ['omitted','empty'])test('fresh '+mode+' metadata observes once and preserves its distinct retry state',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  await context.observeDistribution(mode);downgrade(context);
  let requests=0;const fetch=worker.fetchRecord;worker.fetchRecord=async(...args)=>{requests++;return fetch(...args);};
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));await worker.task(nextAmendmentTask(store,generation));
  assert.equal(requests,1);
  prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));
  for(let poll=0;poll<3;poll++)prepareAmendmentParserUpgrade(worker,generation);
  assert.equal(requests,1);assert.equal(nextAmendmentTask(store,generation),null);assert.equal(amendmentParserUpgradeDue(store,generation),false);
  const observed=store.source(generation,listKey).work.parserMetadataObservation;
  assert.equal(observed.retryAt,mode==='omitted'?store.clock()+86400000:null);
  if(mode==='omitted') {
    context.advance(86400000);assert.equal(amendmentParserUpgradeDue(store,generation),true);
    worker.fetchRecord=async()=>{requests++;return {fetchedAt:context.at(),payload:{data:[listDetail(descriptor)]}};};
    prepareAmendmentParserUpgrade(worker,generation);await worker.task(nextAmendmentTask(store,generation));await worker.task(nextAmendmentTask(store,generation));
    assert.equal(requests,2);assert.equal(nextAmendmentTask(store,generation).kind,'amendment-extract');
  }
});


const freshnessDay=86400000;
test('within the grace period an unchanged list still downloads weekly',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  context.advance(7*freshnessDay);
  await context.reverify(descriptor,{date:documentDate});
  const job=nextAmendmentTask(store,generation);assert.equal(job.kind,'amendment-extract');
  let downloads=0;worker.downloadAmendmentDocx=async()=>{downloads++;return {buffer:amendmentDocx()};};
  await worker.task(job);
  assert.equal(downloads,1);assert.equal(store.source(generation,listKey).work.extraction.fetchedAt,context.at());
});

test('settled unchanged metadata confirms the source without downloading or changing wording retrieval dates',async t=>{
  const context=await fixture(t),{store,generation,descriptor}=context;
  context.advance(90*freshnessDay);
  await context.reverify(descriptor,{date:documentDate});
  const saved=store.source(generation,listKey);
  assert.equal(extractionJob(store,generation).done,1);
  assert.equal(saved.work.lastConfirmedAt,context.at());
  assert.equal(saved.work.extraction.fetchedAt,oldRetrievedAt);
  const record=amendmentsPage(store,{document:targetId}).items[0];
  assert.equal(record.sourceFreshness.status,'fresh');assert.equal(record.wordingSource.fetchedAt,oldRetrievedAt);
  assert.equal(Object.hasOwn(record.sourceFreshness,'lastConfirmedAt'),false);
});

for(const change of ['url','byteSize','issued','missing-bytes'])test('settled list downloads a '+change+' source and keeps fresh provenance',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  await context.reverify(descriptor,{date:documentDate});
  context.advance(90*freshnessDay);
  const next={...descriptor};
  if(change==='missing-bytes') {
    const sources=amendmentSourceStore(store),row=sources.match(descriptor);unlinkSync(path.join(sources.directory,row.sha256+'.docx'));
  } else if(change==='url')next.url=newUrl;
  else if(change==='byteSize')next.byteSize+=1;
  else next.issued=context.at();
  const confirmedBefore=store.source(generation,listKey).work.lastConfirmedAt;
  await context.reverify(next,{date:documentDate});
  const job=nextAmendmentTask(store,generation);assert.equal(job.kind,'amendment-extract');
  let downloads=0;worker.downloadAmendmentDocx=async url=>{downloads++;assert.equal(url,next.url);return {buffer:amendmentDocx()};};
  await worker.task(job);
  assert.equal(downloads,1);const saved=store.source(generation,listKey);
  assert.equal(saved.work.extraction.fetchedAt,context.at());assert.equal(saved.work.lastConfirmedAt,change==='missing-bytes'?context.at():confirmedBefore);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].sourceFreshness.status,'fresh');
});

for(const age of [1,80])test('a new unused language is not downloaded and cannot fail English wording; age='+age,async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor,target}=context;
  context.advance(age*freshnessDay);
  const french={...descriptor,url:oldUrl.replace('_en','_fr'),language:'fr'};
  const expanded={...listDetail(descriptor),is_realized_by:[...realization(descriptor),...realization(french)],amendmentDistributionDeclared:true};
  store.putSource(generation,targetKey,'document',{...target,inverse_foresees_change_of:[expanded]},context.at());
  rebuildAmendmentTarget(worker,generation,targetId);
  const downloads=[];worker.downloadAmendmentDocx=async url=>{downloads.push(url);if(url===french.url)throw Object.assign(new Error('French edition unavailable'),{status:404});return {buffer:amendmentDocx()};};
  const job=nextAmendmentTask(store,generation);
  if(age===1)assert.equal(job,null,'A new unused language must not create download work during grace.');
  else assert.equal(job,null,'Settled English wording remains current without fetching the new edition.');
  // Even a separately admitted English refresh must never touch the extra edition.
  enqueueAmendment(store,generation,extractKey,'amendment-extract',{listId,targetDocumentId:targetId},112,true);
  await worker.task(nextAmendmentTask(store,generation));
  assert.deepEqual(downloads,age===1?[oldUrl]:[]);
  assert.equal(amendmentsPage(store,{document:targetId}).items[0].sourceFreshness.status,'fresh');
  assert.equal(store.source(generation,listKey).work.wordingRefreshFailure,undefined);
  assert.equal(amendmentSourceStore(store).has(french),false);
});

test('settled metadata confirmation and a pending byte repair survive writer handoff',async t=>{
  const context=await fixture(t),{store,generation,descriptor}=context;
  context.advance(90*freshnessDay);await context.reverify(descriptor,{date:documentDate});
  const sources=amendmentSourceStore(store),row=sources.match(descriptor);unlinkSync(path.join(sources.directory,row.sha256+'.docx'));
  rebuildAmendmentTarget(context.worker,generation,targetId);
  store.release();
  const other=new ActivityStore(path.dirname(store.filename),{clock:()=>store.clock()});t.after(()=>other.close());assert(other.acquire());
  let downloads=0;const successor=new ActivityWorker(other,{runUpstream:unthrottledUpstream,clock:()=>other.clock(),downloadAmendmentDocx:async()=>{downloads++;return {buffer:amendmentDocx()};}});
  await assert.rejects(context.worker.task(nextAmendmentTask(other,generation)),/writer lease was lost/);
  await successor.task(nextAmendmentTask(other,generation));
  assert.equal(downloads,1);assert.equal(other.source(generation,listKey).work.lastConfirmedAt,context.at());
  assert.equal(extractionJob(other,generation).done,1);
  rebuildAmendmentTarget(successor,generation,targetId);assert.equal(extractionJob(other,generation).done,1);
});

test('a full byte store defers repeated settled repairs instead of downloading on every rebuild',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor}=context;
  context.advance(90*freshnessDay);
  const sources=amendmentSourceStore(store),row=sources.match(descriptor);unlinkSync(path.join(sources.directory,row.sha256+'.docx'));
  t.mock.method(sources,'reserve',async()=>false);
  await context.reverify(descriptor,{date:documentDate});
  let downloads=0;worker.downloadAmendmentDocx=async()=>{downloads++;return {buffer:amendmentDocx()};};
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(downloads,1);assert.equal(extractionJob(store,generation).done,1);
  rebuildAmendmentTarget(worker,generation,targetId);assert.equal(extractionJob(store,generation).done,1);
  assert(Date.parse(store.source(generation,listKey).work.sourceRetentionRetryAt)>store.clock());
  context.advance(7*freshnessDay);rebuildAmendmentTarget(worker,generation,targetId);
  assert.equal(nextAmendmentTask(store,generation).kind,'amendment-extract');
});

for(const mode of ['omitted','null','empty','pdf-only'])test('unavailable '+mode+' metadata retains the last successful confirmation date',async t=>{
  const context=await fixture(t),{store,generation,descriptor}=context;
  await context.reverify(descriptor,{date:documentDate});const confirmed=store.source(generation,listKey).work.lastConfirmedAt;
  assert(confirmed);await context.observeDistribution(mode);
  assert.equal(store.source(generation,listKey).work.lastConfirmedAt,confirmed);
});

test('an exact settled detail check is due after 90 days despite newer expanded parent observations',async t=>{
  const context=await fixture(t),{store,worker,generation,descriptor,target}=context;
  const original=store.source(generation,listKey).work.metadataCheckedAt;
  const observe=()=>{
    const expanded={...listDetail(descriptor),amendmentDistributionDeclared:true};
    store.putSource(generation,targetKey,'document',{...target,inverse_foresees_change_of:[expanded]},context.at());
    rebuildAmendmentTarget(worker,generation,targetId);
  };
  context.advance(89*freshnessDay);observe();assert.equal(nextAmendmentTask(store,generation),null);
  assert.equal(store.source(generation,listKey).work.metadataCheckedAt,original);
  context.advance(freshnessDay);observe();const job=nextAmendmentTask(store,generation);
  assert.equal(job.kind,'amendment-list-detail');
  const before=store.source(generation,listKey).work;const fetch=worker.fetchRecord;
  worker.fetchRecord=async()=>{throw new Error('Offline metadata failure');};
  await assert.rejects(worker.task(job),/Offline metadata failure/);
  assert.equal(store.source(generation,listKey).work.lastConfirmedAt,before.lastConfirmedAt);
  assert.equal(store.source(generation,listKey).work.metadataCheckedAt,original);
  worker.fetchRecord=fetch;await worker.task(job);
  assert.equal(store.source(generation,listKey).work.metadataCheckedAt,context.at());
  assert.equal(store.source(generation,listKey).work.lastConfirmedAt,context.at());
  assert.equal(extractionJob(store,generation).done,1);
  observe();assert.equal(nextAmendmentTask(store,generation),null);
});

async function authorLanguageFixture(t) {
  const context=await fixture(t),{store,worker,generation}=context;
  const saved=store.source(generation,listKey),primary={url:oldUrl,language:'bg',byteSize:null},alternate={url:newUrl,language:'de',byteSize:null};
  const rosterKey='amendment:roster:'+documentDate,roster=store.source(generation,rosterKey);
  store.putSource(generation,rosterKey,'amendment-roster',{...roster.work,nameVersion:AMENDMENT_AUTHOR_NAMES_VERSION},roster.fetchedAt);
  store.putSource(generation,listKey,'amendment-list',{...saved.work,distributionEvidence:{...saved.work.distributionEvidence,descriptors:[primary,alternate]}},saved.fetchedAt);
  const buffer=url=>amendmentDocx(oldProposed,url===oldUrl?'Данило Дела Вале':'Danilo Della Valle');
  worker.downloadAmendmentDocx=async url=>({buffer:buffer(url)});
  enqueueAmendment(store,generation,extractKey,'amendment-extract',{listId,targetDocumentId:targetId},112,true);
  await worker.task(nextAmendmentTask(store,generation));
  assert.equal(store.source(generation,listKey).work.authorNames.descriptor.url,newUrl);
  context.advance(80*freshnessDay);
  return {...context,primary,alternate,buffer};
}

test('settled primary and author-language bytes are both reused with their original retrieval dates',async t=>{
  const context=await authorLanguageFixture(t),{store,worker,generation}=context;
  const prior=store.source(generation,listKey).work;
  rebuildAmendmentTarget(worker,generation,targetId);assert.equal(nextAmendmentTask(store,generation),null);
  worker.downloadAmendmentDocx=async()=>{throw new Error('Settled retained author wording must not download.');};
  enqueueAmendment(store,generation,extractKey,'amendment-extract',{listId,targetDocumentId:targetId},112,true);
  await worker.task(nextAmendmentTask(store,generation));
  const current=store.source(generation,listKey).work;
  assert.equal(current.extraction.fetchedAt,prior.extraction.fetchedAt);
  assert.equal(current.authorNames.source.fetchedAt,prior.authorNames.source.fetchedAt);
  assert.equal(current.sourceRetentionRetryAt,null);
});

for(const failure of ['storage-full','download-failed'])test('settled author-language '+failure+' backs off without failing the primary wording',async t=>{
  const context=await authorLanguageFixture(t),{store,worker,generation,alternate,buffer}=context;
  const sources=amendmentSourceStore(store),row=sources.match(alternate);unlinkSync(path.join(sources.directory,row.sha256+'.docx'));
  if(failure==='storage-full')t.mock.method(sources,'reserve',async()=>false);
  let downloads=0;worker.downloadAmendmentDocx=async url=>{
    assert.equal(url,newUrl);downloads++;
    if(failure==='download-failed')throw Object.assign(new Error('Author-language unavailable'),{status:404});
    return {buffer:buffer(url)};
  };
  rebuildAmendmentTarget(worker,generation,targetId);await worker.task(nextAmendmentTask(store,generation));
  assert.equal(downloads,1);assert.equal(amendmentsPage(store,{document:targetId}).items[0].sourceFreshness.status,'fresh');
  const retryAt=store.source(generation,listKey).work.sourceRetentionRetryAt;
  assert.equal(Date.parse(retryAt),store.clock()+7*freshnessDay);
  context.advance(freshnessDay);rebuildAmendmentTarget(worker,generation,targetId);
  assert.equal(extractionJob(store,generation).done,1,'Daily preparation must not re-download an unretainable author language.');
  context.advance(6*freshnessDay);rebuildAmendmentTarget(worker,generation,targetId);
  assert.equal(nextAmendmentTask(store,generation).kind,'amendment-extract');
});

test('a changed author-language descriptor is retrieved even during an older retention backoff',async t=>{
  const context=await authorLanguageFixture(t),{store,worker,generation,alternate,buffer}=context;
  const saved=store.source(generation,listKey),changed={...alternate,issued:context.at()};
  store.putSource(generation,listKey,'amendment-list',{...saved.work,sourceRetentionRetryAt:new Date(store.clock()+7*freshnessDay).toISOString(),distributionEvidence:{...saved.work.distributionEvidence,descriptors:saved.work.distributionEvidence.descriptors.map(file=>file.url===alternate.url?changed:file)}},saved.fetchedAt);
  let downloads=0;worker.downloadAmendmentDocx=async url=>{assert.equal(url,newUrl);downloads++;return {buffer:buffer(url)};};
  rebuildAmendmentTarget(worker,generation,targetId);await worker.task(nextAmendmentTask(store,generation));
  assert.equal(downloads,1);assert.equal(store.source(generation,listKey).work.authorNames.descriptor.issued,changed.issued);
});

test('the occasional settled detail check detects a same-URL issue change after writer restart',async t=>{
  const context=await fixture(t),{store,generation,descriptor}=context;
  await context.reverify(descriptor,{date:documentDate});
  const prior=store.source(generation,listKey).work;
  context.advance(90*freshnessDay);rebuildAmendmentTarget(context.worker,generation,targetId);
  const due=nextAmendmentTask(store,generation);assert.equal(due.kind,'amendment-list-detail');
  store.release();
  const other=new ActivityStore(path.dirname(store.filename),{clock:()=>store.clock()});t.after(()=>other.close());assert(other.acquire());
  const changed={...descriptor,issued:context.at()};let metadata=0,downloads=0;
  const successor=new ActivityWorker(other,{runUpstream:unthrottledUpstream,clock:()=>other.clock(),fetchRecord:async endpoint=>{
    assert.equal(endpoint,'/documents/'+listId);metadata++;return {fetchedAt:context.at(),payload:{data:[listDetail(changed)]}};
  },downloadAmendmentDocx:async url=>{assert.equal(url,descriptor.url);downloads++;return {buffer:amendmentDocx()};}});
  await successor.task(nextAmendmentTask(other,generation));
  assert.equal(metadata,1);assert.equal(other.source(generation,listKey).work.metadataCheckedAt,context.at());
  assert.equal(other.source(generation,listKey).work.lastConfirmedAt,prior.lastConfirmedAt);
  assert.equal(nextAmendmentTask(other,generation).kind,'amendment-extract');
  await successor.task(nextAmendmentTask(other,generation));assert.equal(downloads,1);
  assert.equal(amendmentsPage(other,{document:targetId}).items[0].sourceFreshness.status,'fresh');
});
