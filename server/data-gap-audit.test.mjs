import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {auditIndex,dataGapAudit,reconcileQuestionFiles,compareGapAudits,failureClass} from './data-gap-audit.mjs';
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
  assert.equal(failureClass('Unknown problem'),'unclassified');
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
    assert.deepEqual(report.counts,{retained:1,queued:1,retryingLater:1,unowned:1,completedWithoutText:1,excludedByPolicy:1});
    assert.deepEqual(report.examples.map(row=>row.state).sort(),['completedWithoutText','unowned']);
    assert.deepEqual(await Promise.all([readFile(indexFile),readFile(corpusFile)]),before);
    const missing=path.join(dir,'absent.sqlite');
    assert.equal(dataGapAudit({indexFile:missing}).index.state,'unavailable');
    await assert.rejects(readFile(missing),{code:'ENOENT'});
    assert.throws(()=>auditOptions(['--write'],{}));
  } finally {try{index.close();}catch{}try{corpus.close();}catch{}await rm(dir,{recursive:true,force:true});}
});
