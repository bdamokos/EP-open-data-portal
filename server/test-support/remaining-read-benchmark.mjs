import {bodyDiscoverySql,bodyDueSql,bodyUndatedDiscoverySql} from '../document-body-collector.mjs';
// Offline synthetic benchmark. Requires sqlite3 CLI for cold SQLite-cache page
// fetch counts; no production files, network calls or OS-cache eviction.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {measureRead} from './read-benchmark-metrics.mjs';
import {ActivityStore} from '../activity-index-store.mjs';
import {CorpusStore} from '../corpus-store.mjs';
import {prepareIndexes} from '../migrate-indexes.mjs';
import {activityOnly,motionDocuments} from '../activity-read-projections.mjs';
import {changedQuestionsSql,missingQuestionFilesSql} from '../question-discovery.mjs';

// Historical preview query retained only for this before/after projection benchmark.
const savedActivityPreviewSql=`SELECT preview.source_id,preview.date,
 (SELECT body FROM items INDEXED BY saved_activity_sources WHERE generation=? AND mep=? AND source_id=preview.source_id AND date IS preview.date AND ${activityOnly} LIMIT 1) AS body
 FROM (SELECT source_id,MAX(date) AS date FROM items INDEXED BY saved_activity_sources WHERE generation=? AND mep=? AND ${activityOnly} GROUP BY source_id ORDER BY date DESC,source_id DESC LIMIT 10) preview`;
export function runRemainingReadBenchmark({ci=false}={}) {
const scenarios=[];
const directory=mkdtempSync(path.join(tmpdir(),'remaining-benchmark-'));
const activityDirectory=path.join(directory,'activity'),corpusDirectory=path.join(directory,'corpus');
const clock=()=>Date.parse('2026-10-20T09:00:00Z'),fetched=new Date(clock()).toISOString();
const quote=s=>"'"+s.replaceAll("'","''")+"'";
let index,corpus;
try {
  index=new ActivityStore(activityDirectory,{clock});index.acquire();
  corpus=new CorpusStore(corpusDirectory,{clock});corpus.acquire();
  index.db.exec(`DROP TRIGGER motion_sitting_insert; DROP TRIGGER motion_sitting_update; DROP TRIGGER motion_sitting_delete; DROP TRIGGER question_files_delete;
    DROP TABLE motion_sitting_summary; DROP TABLE question_files; DROP TABLE question_file_sources;
    DROP INDEX motion_documents; DROP INDEX saved_activity_sources; DROP INDEX saved_answer_sources;`);
  index.set('activityReadVersion',null);corpus.set('questionDiscoveryVersion',null);corpus.db.exec('DROP TABLE question_discovery');
  const source=index.db.prepare('INSERT INTO sources VALUES (1,?,?,?,?,1)'),item=index.db.prepare('INSERT INTO items VALUES (1,?,?,?,?,?,?)');
  const questions=ci?1500:10529,otherDocuments=ci?2000:20000,motions=ci?50:150,sittings=ci?21:105,items=ci?5000:50000;
  const distribution=(id,lang)=>({language:lang,is_embodied_by:[{format:'DOCX',is_exemplified_by:`https://data.europarl.europa.eu/distribution/test/${id}_${lang}.docx`}]});
  for(let start=0;start<questions;start+=500)index.transaction(()=>{
    for(let n=start;n<Math.min(questions,start+500);n++) {
      const id='E-10-2026-'+String(n).padStart(6,'0');
      source.run('/parliamentary-questions/'+id,'document',JSON.stringify({identifier:id,work_type:'x/QUESTION_WRITTEN',originalLanguage:['hu'],document_date:'2026-01-01',
        is_realized_by:['en','fr','de','hu'].map(lang=>distribution(id,lang)),inverse_answers_to:[{identifier:id+'-ASW',is_realized_by:['en','fr'].map(lang=>distribution(id+'-ASW',lang))}],padding:'q'.repeat(12000)}),fetched);
    }
  });
  for(let start=0;start<otherDocuments;start+=1000)index.transaction(()=>{
    for(let n=start;n<Math.min(otherDocuments,start+1000);n++)source.run('/plenary-documents/other-'+n,'document',JSON.stringify({work_type:'x/REPORT_PLENARY',padding:'d'.repeat(8000)}),fetched);
  });
  index.transaction(()=>{
    for(let n=0;n<motions;n++)source.run('/plenary-documents/motion-'+n,'document',JSON.stringify({work_type:'x/RESOLUTION_MOTION',padding:'m'.repeat(8000)}),fetched);
    for(let n=0;n<sittings;n++) {
      const day=new Date(Date.UTC(2026,0,1+n)).toISOString().slice(0,10),id='MTG-PL-'+day;
      // Matching decision last reproduces the retained-array membership check.
      const decisions=Array.from({length:200},(_,j)=>({id:'eli/dl/event/'+(j===199?id:'MTG-PL-2025-01-01')+'-DEC-'+j,padding:'v'.repeat(2000)}));
      source.run('motion-outcomes:'+id,'motion-outcomes',JSON.stringify({decisions,decisionsUrl:'https://data.europarl.europa.eu/api/v2/meetings/'+id+'/decisions',decisionsFetchedAt:fetched}),fetched);
    }
  });
  for(let start=0;start<items;start+=1000)index.transaction(()=>{
    for(let n=start;n<Math.min(items,start+1000);n++)item.run('source-'+n,'source-'+Math.floor(n/2),'42',n%2?'oral-questions':'written-questions','2026-01-01',JSON.stringify({recordKind:n%5===0?'answer':'document',padding:'i'.repeat(2000)}));
  });
  const putDocument=corpus.db.prepare('INSERT INTO documents(source_id,kind) VALUES (?,?)');
  const putText=corpus.db.prepare(`INSERT INTO texts(document_id,language,source_key,translation_type,source_format,source_url,fetched_at,checked_at,sha256,chars,body) VALUES (?,?,?,'unspecified','docx',?,?,?,'synthetic',21,'Stored document text.')`);
  let retainedTexts=0;
  for(let start=0;start<questions;start+=500)corpus.transaction(()=>{
    for(let n=start;n<Math.min(questions,start+500);n++) {
      if(n%100===0)continue;
      const id='E-10-2026-'+String(n).padStart(6,'0');
      for(const [sourceId,kind,languages] of [[id,'question',['en','fr','de','hu']],[id+'-ASW','answer',['en','fr']]]) {
        const documentId=putDocument.run(sourceId,kind).lastInsertRowid;
        for(const language of languages){putText.run(documentId,language,language,`https://data.europarl.europa.eu/distribution/test/${sourceId}_${language}.docx`,fetched,fetched);retainedTexts++;}
      }
    }
  });
  index.set('active',1);index.release();corpus.release();
  index.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');corpus.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const indexFile=index.filename,corpusFile=corpus.filename;index.close();index=null;corpus.close();corpus=null;
  const fetches=(file,sql,attach='')=>{
    const result=measureRead(file,sql,attach);
    scenarios.push(result);
    return result.pageFetches;
  };
  const oldQuestions="SELECT sum(length(body)) FROM sources WHERE generation=1 AND kind='document' AND key>='/parliamentary-questions/' AND key<'/parliamentary-questions0' AND key LIKE '/parliamentary-questions/%'";
  const oldWeeks=`SELECT sum(length(json_extract(source.body,'$.decisionsUrl'))) FROM sources source WHERE source.generation=1 AND source.kind='motion-outcomes'
    AND EXISTS(SELECT 1 FROM json_each(source.body,'$.decisions') decision WHERE json_extract(decision.value,'$.id') LIKE 'eli/dl/event/' || substr(source.key,17) || '-DEC-%')`;
  const count='SELECT COUNT(DISTINCT source_id) FROM items WHERE generation=1 AND mep=\'42\' AND '+activityOnly;
  const oldMotions="SELECT sum(length(body)) FROM sources WHERE generation=1 AND kind='document'";
  const before=ci?null:{questions:fetches(indexFile,oldQuestions),weeks:fetches(indexFile,oldWeeks),savedCount:fetches(indexFile,count),motions:fetches(indexFile,oldMotions),savedPreviews:fetches(indexFile,"SELECT sum(length(body)) FROM (SELECT source_id,MAX(date) AS date,body FROM items WHERE generation=1 AND mep='42' AND "+activityOnly+' GROUP BY source_id ORDER BY date DESC,source_id DESC LIMIT 10)')};
  const results=prepareIndexes({activityDirectory,corpusDirectory,clock});
  // Runtime motion reads switch to the compact projection after writer backfill.
  index=new ActivityStore(activityDirectory,{clock});index.acquire();
  while(index.backfillFastReads(1)){}
  index.release();index.db.exec('PRAGMA main.wal_checkpoint(TRUNCATE)');index.close();index=null;
  const attach=`ATTACH ${quote(indexFile)} AS idx; PRAGMA idx.cache_size=-2048; PRAGMA idx.mmap_size=0;`;
  const bind=(sql,values)=>{let i=0;return sql.replaceAll('?',()=>typeof values[i]==='number'?String(values[i++]):quote(values[i++]));};
  const after={weeks:fetches(indexFile,'SELECT sum(length(source_url)) FROM motion_sitting_summary WHERE generation=1 AND decisions_present=1'),
    savedCount:fetches(indexFile,count.replace('FROM items WHERE','FROM items INDEXED BY saved_activity_sources WHERE')),
    motions:fetches(indexFile,'SELECT sum(length(body)) FROM source_reads INDEXED BY read_motion_documents WHERE generation=1 AND '+motionDocuments),
    savedPreviews:fetches(indexFile,'SELECT sum(length(body)) FROM ('+bind(savedActivityPreviewSql,[1,'42',1,'42'])+')')};
  // Measure initial file anti-join and subsequent no-change manifest discovery.
  after.initialQuestions=fetches(corpusFile,"SELECT sum(length(file.body)) FROM idx.question_files file WHERE generation=1 AND NOT EXISTS(SELECT 1 FROM texts text WHERE text.source_url=file.url)",attach);
  corpus=new CorpusStore(corpusDirectory,{indexFile:indexFile,clock});corpus.acquire();
  corpus.db.exec("INSERT INTO question_discovery SELECT source_key,signature,'all' FROM idx.question_file_sources WHERE generation=1");
  corpus.release();corpus.db.exec('PRAGMA main.wal_checkpoint(TRUNCATE)');corpus.close();corpus=null;
  after.questions=fetches(corpusFile,bind(changedQuestionsSql,[1,'','all']),attach);
  after.oneFileLookup=fetches(corpusFile,bind(missingQuestionFilesSql,[1,'/parliamentary-questions/E-10-2026-000001','all']),attach);
  const names=['weeks','savedCount','motions','savedPreviews','initialQuestions','questions','oneFileLookup'];
  const current=scenarios.slice(-names.length).map((result,i)=>({name:`remaining/${names[i]}`,...result}));
  current.push({name:'remaining/documentBodyDiscovery',...measureRead(indexFile,bind(bodyDiscoverySql,[1,'9999','zzzz','zzzz','zzzz']))});
  current.push({name:'remaining/documentBodyUndated',...measureRead(indexFile,bind(bodyUndatedDiscoverySql,[1,'zzzz','zzzz','zzzz']))});
  current.push({name:'remaining/documentBodyIdle',...measureRead(indexFile,bind(bodyDueSql,[clock()]))});
  return {scenarios:current,scale:{questions,otherDocuments,motions,sittings,items,retainedTexts},sqliteVersion:execFileSync('sqlite3',['-version'],{encoding:'utf8'}).trim(),before,after,preparation:results,totalBytes:statSync(indexFile).size+statSync(corpusFile).size};
} finally {index?.close();corpus?.close();rmSync(directory,{recursive:true,force:true});}

}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(runRemainingReadBenchmark(),null,2));
