// Offline page-read and plan benchmark; fresh 2 MiB SQLite caches, mmap disabled.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from '../activity-index-store.mjs';
import {QuestionInsights,insightQuery} from '../insights-store.mjs';
import {savedProcedureEvents} from '../topic-trends.mjs';
const directory=mkdtempSync(path.join(tmpdir(),'slow-read-benchmark-'));
let store;
try {
  store=new ActivityStore(directory);store.acquire(3600_000);store.set('active',1);store.setMembers([{id:'42',name:'Member'}]);store.db.exec('PRAGMA synchronous=OFF;');
  // These unrelated validation projections are exercised by their own tests.
  store.db.exec('DROP TRIGGER amendment_read_insert; DROP TRIGGER amendment_contributor_insert;');
  const source=store.db.prepare('INSERT INTO sources VALUES (1,?,?,?,?,1)'),amendment=store.db.prepare('INSERT INTO amendments VALUES (1,?,?,?,?,?)');
  const questions=11000,procedures=10000,amendments=40000,outside=10000;
  for(let start=0;start<questions;start+=100)store.transaction(()=>{
    for(let i=start;i<Math.min(questions,start+100);i++) {
      const id='E-10-2026-'+String(i).padStart(6,'0');
      source.run('/parliamentary-questions/'+id,'document',JSON.stringify({id:'eli/dl/doc/'+id,identifier:id,work_type:'def/QUESTION_WRITTEN',document_date:'2026-10-10',title_dcterms:{en:i%100?'Public transport safety':'Unique fisheries phrase'},creator:['person/42'],padding:'x'.repeat(12000)}),'2026-10-22T12:00:00Z');
    }
  });
  for(let start=0;start<procedures;start+=100)store.transaction(()=>{
    for(let i=start;i<Math.min(procedures,start+100);i++) {
      const id='2026-'+String(i).padStart(4,'0'),day=i<9000?'2026-01-01':'2026-10-10';
      source.run('/procedures/'+id,'procedure',JSON.stringify({id:'eli/dl/proc/'+id,process_title:{en:'Public procedure'},consists_of:[{id:'eli/dl/event/MTG-PL-'+day+'-VOT-ITM-'+i,had_activity_type:'def/PLENARY_VOTE',activity_date:day}],padding:'p'.repeat(16000)}),'2026-10-22T12:00:00Z');
    }
  });
  for(let start=0;start<amendments;start+=100)store.transaction(()=>{
    for(let i=start;i<Math.min(amendments,start+100);i++)amendment.run('AM-'+i,'A-10-2026-'+String(i%100).padStart(4,'0'),'2026-10-10','unavailable',JSON.stringify({number:i,originalText:'a'.repeat(4096),proposedText:'b'.repeat(4096)}));
  });
  store.transaction(()=>{
    const observation=store.db.prepare('INSERT INTO source_observations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for(let i=0;i<20000;i++)observation.run('observation-'+i,'source-'+i,'questions','QUESTION_WRITTEN','metadata','en',null,'2026-01-01','2026-01-01','2026-01-01','2026-01-01','2026-01-01','baseline','https://data.europarl.europa.eu/');
    source.run('motion-outcomes:MTG-PL-2026-10-10','motion-outcomes',JSON.stringify({results:[],decisions:[],amendmentEvidence:{text:'x'.repeat(4_000_000)}}),'2026-10-22T12:00:00Z');
    source.run('list','amendment-list',JSON.stringify({extraction:{parserVersion:1,padding:'x'.repeat(1_000_000)}}),'2026-10-22T12:00:00Z');
    source.run('motion','document',JSON.stringify({work_type:'def/RESOLUTION_MOTION',padding:'x'.repeat(1_000_000)}),'2026-10-22T12:00:00Z');
    const put=store.db.prepare('INSERT INTO outside_contributions VALUES (1,?,?,?,?)');
    for(let i=0;i<outside;i++)put.run('speech-'+i,String(i),'2026-10-10',JSON.stringify({term:10,parentIds:[],header:{name:'Speaker'},padding:'x'.repeat(4096)}));
  });
  store.release();store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const queries={
    oldSource:"SELECT body,fetched_at FROM sources WHERE generation=1 AND key='motion-outcomes:MTG-PL-2026-10-10'",
    source:"SELECT body,fetched_at FROM source_reads WHERE generation=1 AND key='motion-outcomes:MTG-PL-2026-10-10'",
    questionWindow:"SELECT key,body,fetched_at FROM question_reads INDEXED BY read_question_window WHERE generation=1 AND kind='document' AND (json_extract(body,'$.work_type') LIKE '%/QUESTION_WRITTEN' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_WRITTEN_PRIORITY' OR json_extract(body,'$.work_type') LIKE '%/QUESTION_ORAL') AND json_extract(body,'$.document_date') BETWEEN '2026-10-01' AND '2026-10-22' ORDER BY json_extract(body,'$.document_date') DESC,key LIMIT 5000",
    questionSearch:`SELECT key FROM question_reads WHERE generation=1 AND rowid IN (SELECT rowid FROM question_title_search WHERE question_title_search MATCH '"unique fisheries"')`,
    amendmentPage:"SELECT body FROM amendments WHERE generation=1 AND target NOT GLOB 'committee:*' ORDER BY date DESC,target,CAST(json_extract(body,'$.number') AS INTEGER),id LIMIT 20",
    oldAmendmentBodies:"SELECT id,date,outcome,body FROM amendments WHERE generation=1 AND target='A-10-2026-0001'",
    amendmentIds:"SELECT id,date,outcome FROM amendments WHERE generation=1 AND target='A-10-2026-0001'",
    parserUpgrade:"SELECT 1 FROM sources INDEXED BY parser_upgrade_due WHERE generation=1 AND kind='amendment-list' AND json_type(body,'$.extraction')='object' AND COALESCE(json_extract(body,'$.extraction.parserVersion'),'')<>999 LIMIT 1",
    motions:"SELECT key,body,fetched_at FROM source_reads INDEXED BY read_motion_documents WHERE generation=1 AND kind='document' AND (COALESCE(json_extract(body,'$.work_type.id'),json_extract(body,'$.work_type')) IN ('RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT') OR COALESCE(json_extract(body,'$.work_type.id'),json_extract(body,'$.work_type')) GLOB '*/RESOLUTION_MOTION' OR COALESCE(json_extract(body,'$.work_type.id'),json_extract(body,'$.work_type')) GLOB '*/RESOLUTION_MOTION_JOINT')",
    procedureSelection:"SELECT source_key,MAX(date) date FROM procedure_event_reads WHERE generation=1 AND date BETWEEN '2026-10-01' AND '2026-10-22' GROUP BY source_key ORDER BY date DESC,source_key LIMIT 601",
    outsideDirectory:"SELECT body FROM outside_directory_reads WHERE generation=1 AND term=10 ORDER BY date DESC,speech LIMIT 50001",
    outsideDates:"SELECT DISTINCT date FROM outside_contributions INDEXED BY outside_unresolved_dates WHERE generation=1 AND (json_extract(body,'$.header.name') IS NULL OR json_array_length(body,'$.parentIds')=0) LIMIT 501",
    pruneAge:"DELETE FROM source_observations WHERE identity IN (SELECT identity FROM source_observations WHERE last_observed_at<'2026-10-01' LIMIT 64)",
    pruneEvent:"DELETE FROM source_observations WHERE identity IN (SELECT identity FROM source_observations WHERE event_date<'2026-10-01' LIMIT 64)",
    observationCount:'SELECT n FROM observation_count WHERE id=1',
  };
  const results={};
  for(const [name,sql] of Object.entries(queries)) {
    const output=execFileSync('sqlite3',[store.filename],{input:`PRAGMA cache_size=-2048; PRAGMA mmap_size=0;\n.timer on\n.output /dev/null\n${sql};\n.output stdout\n.stats\n`,encoding:'utf8',maxBuffer:2*1024*1024});
    const at=performance.now();const rows=store.db.prepare(sql).all();const ms=performance.now()-at;
    results[name]={rows:rows.length,ms:Math.round(ms*100)/100,pageReads:Number(/Page cache misses:\s+(\d+)/.exec(output)?.[1]),plan:store.db.prepare('EXPLAIN QUERY PLAN '+sql).all().map(row=>row.detail)};
  }
  const questionStart=performance.now();const questionResult=await new QuestionInsights(store,{clock:()=>Date.parse('2026-10-22T12:00:00Z'),loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()}).query(insightQuery(new URLSearchParams('from=2026-10-01&to=2026-10-22'),{now:Date.parse('2026-10-22T12:00:00Z')}));
  const questionMs=performance.now()-questionStart;
  const at=performance.now(),trend=savedProcedureEvents(store,{start:'2026-10-01',end:'2026-10-22'});
  console.log(JSON.stringify({scale:{questions,procedures,amendments,outside,questionPadding:12000,procedurePadding:16000,amendmentText:8192},results,questionInsights:{ms:questionMs,analyzed:questionResult.counts.analyzedQuestions},topicTrends:{ms:performance.now()-at,procedures:trend.procedures.length,truncated:trend.truncated}},null,2));
} finally {store?.close();rmSync(directory,{recursive:true,force:true});}
