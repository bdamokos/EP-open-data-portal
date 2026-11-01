import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
test('read-only HTTP connections register projection functions and observe writer backfill without writing',t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'readonly-projection-')),writer=new ActivityStore(directory);
  t.after(()=>{writer.close();rmSync(directory,{recursive:true,force:true});});assert(writer.acquire());
  const key='/parliamentary-questions/E-10-2026-000001',at='2026-10-22T12:00:00Z';
  writer.putSource(1,key,'document',{identifier:'E-10-2026-000001',title_dcterms:{en:'Energy'},extraction:{text:'large'}},at);
  const reader=new ActivityStore(directory,{readOnly:true});t.after(()=>reader.close());
  assert.equal(reader.fastReadsReady(1),false);
  const fallback=reader.sourceMetadata(1,key);assert.equal(fallback.work.extraction,undefined);
  assert.throws(()=>reader.backfillFastReads(1),/writer|lease|readonly/i);
  assert.throws(()=>reader.set('unexpected',true),/readonly|read.only/i);
  while(writer.backfillFastReads(1)){}
  assert.equal(reader.fastReadsReady(1),true);assert.deepEqual(reader.sourceMetadata(1,key),fallback);
});
test('source projections preserve provenance, nested metadata and question titles across replacements and pruning',t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'fast-read-test-')),store=new ActivityStore(directory);
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});store.acquire();
  const key='/parliamentary-questions/E-10-2026-000001',at='2026-10-22T12:00:00Z';
  const put=store.db.prepare('INSERT OR REPLACE INTO sources VALUES (1,?,\'document\',?,?,1)');
  const work={identifier:'E-10-2026-000001',work_type:'def/QUESTION_WRITTEN',document_date:'2026-10-10',title_dcterms:{fr:'Énergie européenne'},inverse_answers_to:[{identifier:'answer',document_date:'2026-10-11',creator:['org/COM']}],inverse_foresees_change_of:[{id:'list',extraction:{amendments:['large']}}],extraction:{text:'x'.repeat(1_000_000)}};
  put.run(key,JSON.stringify(work),at);
  while(store.backfillFastReads(1)){}
  const metadata=store.sourceMetadata(1,key);assert.equal(metadata.fetchedAt,at);assert.equal(metadata.work.inverse_foresees_change_of[0].id,'list');assert.equal(metadata.work.inverse_foresees_change_of[0].extraction,undefined);
  assert.equal(store.source(1,key).work.extraction.text.length,1_000_000);
  const projected=JSON.parse(store.db.prepare('SELECT body FROM question_reads').get().body);assert.deepEqual(projected.inverse_answers_to,work.inverse_answers_to);
  const search=()=>store.db.prepare('SELECT rowid FROM question_title_search WHERE question_title_search MATCH ?').all('"energie"');assert.equal(search().length,1);
  put.run(key,JSON.stringify({...work,title_dcterms:{en:'Water safety'}}),at);assert.equal(search().length,0);
  store.db.prepare('DELETE FROM sources WHERE generation=1 AND key=?').run(key);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM question_reads').get().n,0);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM source_reads').get().n,0);
});

import {ParliamentSearch,parliamentSearchQuery} from './parliament-search.mjs';
import {savedProcedureEvents,legacyProcedureEvents} from './topic-trends.mjs';
import {sourceAvailability} from './source-availability.mjs';
test('decoded title and fallback identifier search agrees before and after resumable preparation',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'search-differential-')),store=new ActivityStore(directory);
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});store.acquire();store.set('active',1);
  const put=store.db.prepare("INSERT INTO sources VALUES (1,?,'document',?,?,1)");
  for(const [i,title] of ['Fish &amp; chips and caf&#233; policy','Énergie européenne','Plain unrelated'].entries()) {
    const id='E-10-2026-00000'+i;put.run('/parliamentary-questions/'+id,JSON.stringify({work_type:'def/QUESTION_WRITTEN',document_date:'2026-10-10',title_dcterms:{en:title}}),'2026-10-22T12:00:00Z');
  }
  const service=new ParliamentSearch(store),queries=['"Fish & chips"','café','cafe','énergie','europeenne','E-10-2026-000000','unrelated','absent'];
  const read=async()=>Promise.all(queries.map(q=>service.query(parliamentSearchQuery(new URLSearchParams({q,type:'question'}))).then(r=>r.sections[0].results.map(x=>x.id))));
  const old=await read();assert.equal(old[0].length,1);assert.equal(old[5].length,1);
  assert.equal(store.fastReadsReady(1),false);store.backfillFastReads(1,1);assert.equal(store.fastReadsReady(1),false);
  const cursor=store.db.prepare("SELECT cursor FROM fast_read_progress WHERE projection='sources'").get().cursor;
  store.release();store.acquire();assert.equal(store.db.prepare("SELECT cursor FROM fast_read_progress WHERE projection='sources'").get().cursor,cursor);
  while(store.backfillFastReads(1,1)){}assert.equal(store.fastReadsReady(1),true);assert.deepEqual(await read(),old);
});
test('topic frontier seeks preserve epoch/ISO chronology and old date admissibility',t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'frontier-differential-')),store=new ActivityStore(directory,{clock:()=>Date.parse('2026-11-01T12:00Z')});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});store.acquire();store.set('active',1);
  const put=store.db.prepare("INSERT INTO sources VALUES (1,?,'procedure',?,?,1)");
  for(const [i,at] of ['2026-10-01T12:00:00Z','1792670400000','invalid'].entries()) {
    const id='2026-000'+i;put.run('/procedures/'+id,JSON.stringify({id:'eli/dl/proc/'+id,consists_of:[{id:'eli/dl/event/TEST-'+i,had_activity_type:'def/PLENARY_VOTE',activity_date:i===2?'2026-02-30':'2026-10-20'}]}),at);
  }
  const selection={start:'2026-10-01',end:'2026-10-31'},old=legacyProcedureEvents(store,selection);
  while(store.backfillFastReads(1,1)){}
  const projected=savedProcedureEvents(store,selection);
  assert.deepEqual(projected.procedures,old.procedures);
  const frontier=rows=>sourceAvailability({records:rows,today:'2026-11-01'}).latestObservedDate;
  assert.equal(frontier(projected.frontiers.votes),'2026-10-20');assert.equal(frontier(projected.frontiers.votes),frontier(old.frontiers.votes));
  const plan=store.db.prepare('EXPLAIN QUERY PLAN SELECT admissible_date FROM procedure_event_reads INDEXED BY procedure_event_admissible WHERE generation=? AND type=? AND admissible_date<=? ORDER BY admissible_date DESC LIMIT 1').all(1,'votes','2026-11-01');
  assert.match(JSON.stringify(plan),/COVERING INDEX procedure_event_admissible/);assert.doesNotMatch(JSON.stringify(plan),/SCAN|TEMP B-TREE/);
});
test('startup DDL leaves retained rows for committed bounded background batches',t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'startup-projection-')),store=new ActivityStore(directory);
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});store.acquire();store.set('active',1);
  for(const name of ['insert','update','delete'])store.db.exec('DROP TRIGGER fast_reads_'+name);
  const insert=store.db.prepare("INSERT INTO sources VALUES (1,?,'document',?,'2026-10-22T12:00Z',1)");
  for(let i=0;i<70;i++)insert.run('retained-'+String(i).padStart(3,'0'),JSON.stringify({title_dcterms:{en:'Retained'},payload:'x'.repeat(2000)}));
  store.db.prepare("DELETE FROM meta WHERE key='fastReadSchemaVersion'").run();store.release();store.acquire();
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM source_reads').get().n,0);
  assert.equal(store.fastReadsReady(1),false);store.backfillFastReads(1,5);
  assert.equal(store.db.prepare("SELECT cursor FROM fast_read_progress WHERE projection='sources'").get().cursor,'retained-004');
  assert.equal(store.fastReadsReady(1),false);
  // A replacement behind the cursor is maintained inline; a new earlier key cannot be skipped.
  insert.run('aaa-new',JSON.stringify({title_dcterms:{en:'New'}}));
  while(store.backfillFastReads(1,5)){}assert.equal(store.fastReadsReady(1),true);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM sources WHERE generation=1").get().n,71);
});

import {amendmentsPage} from './amendments-store.mjs';
test('amendment pages preserve ordering and filters through background sort preparation',t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'amendment-sort-')),store=new ActivityStore(directory);
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});store.acquire();store.set('active',1);
  store.db.prepare("INSERT INTO amendment_targets VALUES (1,?,?)").run('A-10-2026-0001',JSON.stringify({id:'A-10-2026-0001',scope:'plenary',gaps:[]}));
  const insert=store.db.prepare('INSERT INTO amendments VALUES (1,?,?,?,?,?)');
  for(const number of [10,2,1])insert.run('AM-'+number,'A-10-2026-0001','2026-10-20','unavailable',JSON.stringify({id:'AM-'+number,number,targetDocumentId:'A-10-2026-0001',authors:[],gaps:[]}));
  const before=amendmentsPage(store,{document:'A-10-2026-0001'});
  while(store.backfillFastReads(1,1)){}
  assert.deepEqual(amendmentsPage(store,{document:'A-10-2026-0001'}),before);
  assert.deepEqual(before.items.map(row=>row.number),[1,2,10]);
});

import {ActivityWorker} from './activity-index-worker.mjs';
test('projection dispatch bounds both retained generations without draining either one',async()=>{
  const calls=[],ready=new Set();
  const worker=Object.create(ActivityWorker.prototype);
  Object.assign(worker,{store:{get:key=>key==='active'?1:{generation:2},fastReadsReady:g=>ready.has(g),backfillFastReads:g=>calls.push(g)},controller:new AbortController(),monotonic:()=>0,runDeadline:10,stopped:false});
  await worker.fillProjectionBatch();
  assert.deepEqual(calls,[1,2]);
  ready.add(1);await worker.fillProjectionBatch();assert.deepEqual(calls,[1,2,2]);
  worker.monotonic=()=>10;await worker.fillProjectionBatch();assert.deepEqual(calls,[1,2,2]);
});
