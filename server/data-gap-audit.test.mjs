import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {auditIndex,auditMutableDocuments,dataGapAudit,reconcileQuestionFiles,compareGapAudits,failureClass} from './data-gap-audit.mjs';
import {auditOptions} from './data-gap-audit-cli.mjs';

test('audit includes serving and working queues, including NULL and outside pending states',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE tasks(generation,kind,done,retry_at,error);
      INSERT INTO meta VALUES('active','1'),('working','{"generation":2,"phase":"backfilling"}');
      INSERT INTO tasks VALUES(1,'motion-outcomes',NULL,0,NULL),(2,'outside-roster',-1,2000,'retry'),(2,'document',1,0,NULL);`);
    const result=auditIndex(db,1000);
    assert.equal(result.generations.length,2);
    assert.equal(result.generations[0].queues.tasks.byKind[0].pending,1);
    const outside=result.generations[1].queues.tasks.byKind.find(row=>row.kind==='outside-roster');
    assert.equal(outside.pending,1);assert.equal(outside.due,0);assert.equal(outside.retrying,1);
    assert.equal(result.generations[0].queues.amendment_jobs.state,'unavailable');
  } finally {db.close();}
});

test('baseline comparison uses exact missing identities and reports a changed denominator',()=>{
  const baseline={observedAt:'before',index:{activeGeneration:8,generations:[{generation:8,gapRecords:[{key:'old'},{key:'same'}]}]},corpus:{pendingTasks:[{key:'task'}]},questionFiles:{eligibleUrlDigest:'a',missing:[{url:'https://example.org/old'}]}};
  const current={observedAt:'after',index:{activeGeneration:9,generations:[{generation:9,gapRecords:[{key:'new'},{key:'same'}]}]},corpus:{pendingTasks:[]},questionFiles:{eligibleUrlDigest:'b',missing:[{url:'https://example.org/new'}]}};
  const result=compareGapAudits(current,baseline);
  assert.deepEqual(result.indexGaps,{state:'observed',previous:2,current:2,resolved:['old'],newlyMissing:['new'],retained:1});
  assert.deepEqual(result.corpusTasks.resolved,['task']);assert.equal(result.sameQuestionFileUniverse,false);
  assert.equal(compareGapAudits({},{}).questionFiles.state,'unavailable');
  assert.equal(failureClass('EP API returned 500 at /speeches'),'transient');
  assert.equal(failureClass('EP API returned 429'),'throttled');
  assert.equal(failureClass('EP API returned 404'),'missing-at-source');
  assert.equal(failureClass('Invalid DOCX archive'),'source-or-parser');
  assert.equal(failureClass('Dated amendment roster contains invalid or repeated identities.'),'source-or-parser');
  assert.equal(failureClass('EP document pagination repeated a page.'),'source-or-parser');
  assert.equal(failureClass('EP API returned 503'),'transient');
  assert.equal(failureClass('Unknown problem'),'unclassified');
});

test('mutable admission comparison tracks exact candidates without treating admission as retained-data success',()=>{
  const report=keys=>({index:{activeGeneration:1,generations:[{generation:1,mutableAdmission:{candidates:keys.map(key=>({key,nextCheck:200}))}}]}});
  const result=compareGapAudits(report(['same','new']),report(['same','queued']));
  assert.deepEqual(result.mutableAdmissionCandidates,{state:'observed',previous:2,current:2,resolved:['queued'],newlyMissing:['new'],retained:1});
  assert.match(result.note,/queued, not refreshed/);
});

test('mutable backlog audit measures due adopted share and oldest age without writes or invented types',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    assert.equal(auditMutableDocuments(db,1,1000),null);
    db.exec('CREATE TABLE mutable_documents(generation,key,next_check);');
    assert.equal(auditMutableDocuments(db,1,1000).dueAdoptedTexts,null,'an absent source table is unknown');
    db.exec(`CREATE TABLE sources(generation,key,body);
      INSERT INTO mutable_documents VALUES(1,'ta',200),(1,'ta-object',600),(1,'question',800),(1,'future',1200),(2,'other-generation',0);
      INSERT INTO sources VALUES(1,'ta','{"work_type":"def/ep-document-types/TEXT_ADOPTED"}'),
      (1,'ta-object','{"work_type":{"id":"https://data.europarl.europa.eu/def/ep-document-types/TEXT_ADOPTED"}}'),
      (1,'question','{"work_type":"def/ep-document-types/QUESTION_WRITTEN"}');`);
    const before=db.prepare('SELECT total_changes() n').get().n,result=auditMutableDocuments(db,1,1000);
    assert.deepEqual(result,{count:4,due:3,oldestDueAt:200,dueAdoptedTexts:2,dueUnknownTypes:0,dueAdoptedTextShare:2/3,oldestDueAgeMs:800});
    assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
    db.exec("INSERT INTO mutable_documents VALUES(1,'missing-source',900)");
    const unknown=auditMutableDocuments(db,1,1000);assert.equal(unknown.dueAdoptedTexts,2);assert.equal(unknown.dueUnknownTypes,1);assert.equal(unknown.dueAdoptedTextShare,null);
    const empty=auditMutableDocuments(db,3,1000);assert.equal(empty.due,0);assert.equal(empty.dueAdoptedTextShare,null);assert.equal(empty.oldestDueAgeMs,null);
  } finally {db.close();}
});

test('exact-URL audit distinguishes missing ownership, queued work, empty completed extraction and policy exclusions without writes',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'gap-audit-')),indexFile=path.join(dir,'index.sqlite'),corpusFile=path.join(dir,'corpus.sqlite');
  const index=new DatabaseSync(indexFile),corpus=new DatabaseSync(corpusFile);
  try {
    index.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO meta VALUES('active','1');CREATE TABLE question_files(generation,url,is_primary);
      INSERT INTO question_files VALUES(1,'retained',1),(1,'queued',1),(1,'orphan',1),(1,'empty',1),(1,'excluded',0),(1,'retained',0);`);
    corpus.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO meta VALUES('documentLanguages','"primary"');
      CREATE TABLE texts(source_url);INSERT INTO texts VALUES('retained');CREATE TABLE tasks(key,done,retry_at);
      INSERT INTO tasks VALUES('docx:queued',0,2000),('docx:empty',1,0);`);
    index.close();corpus.close();
    const before=await Promise.all([readFile(indexFile),readFile(corpusFile)]);
    const report=reconcileQuestionFiles(indexFile,corpusFile,{now:1000});
    assert.equal(report.state,'observed');
    assert.deepEqual(report.counts,{retained:1,queued:1,retryingLater:1,unowned:1,completedWithoutText:1,excludedByPolicy:1,permanentSourceIssue:0,satisfiedByAlternative:0});
    assert.deepEqual(report.examples.map(row=>row.state).sort(),['completedWithoutText','unowned']);
    assert.deepEqual(await Promise.all([readFile(indexFile),readFile(corpusFile)]),before);
    const missing=path.join(dir,'absent.sqlite');
    assert.equal(dataGapAudit({indexFile:missing}).index.state,'unavailable');
    await assert.rejects(readFile(missing),{code:'ENOENT'});
    assert.throws(()=>auditOptions(['--write'],{}));
  } finally {try{index.close();}catch{}try{corpus.close();}catch{}await rm(dir,{recursive:true,force:true});}
});
