// Exercise the actual overview reader, then replay its SQL in one fresh 2 MiB
// SQLite cache. OS cache eviction is deliberately outside this offline benchmark.
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from '../activity-index-store.mjs';
import {RecordTopics,writeTopicProjection} from '../topics-store.mjs';

export function measureOverview(filename,params,{summaryFile,Reader=RecordTopics}={}) {
 const db=new DatabaseSync(filename,{readOnly:true}),statements=[];
 const attach=summaryFile?"ATTACH '"+summaryFile.replaceAll("'","''")+"' AS optimized;":'';
 if(attach)db.exec(attach);
 const literal=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
 const traced={prepare(sql){if(summaryFile)sql=sql.replaceAll(/\b(record_topic_group_summary|record_topic_filtered_groups)\b/g,'optimized.$1');const statement=db.prepare(sql);return Object.fromEntries(['get','all','iterate'].map(method=>[method,(...args)=>{let i=0;statements.push(sql.replaceAll('?',()=>literal(args[i++])));return statement[method](...args);} ]));}};
 let value;
 try {db.exec('BEGIN');value=new Reader({db:traced,get:key=>JSON.parse(traced.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value||'null'),readSnapshot:fn=>fn()}).query(new URLSearchParams(params),'overview');db.exec('COMMIT');}finally{db.close();}
 const run=input=>execFileSync('sqlite3',['-readonly','-batch','-bail',filename],{input:attach+'\n'+input,encoding:'utf8',maxBuffer:32*1024*1024});
 const plan=[...new Set(run('.mode list\n.explain off\n'+statements.map(sql=>'EXPLAIN QUERY PLAN '+sql+';').join('\n')).trim().split('\n').map(line=>line.split('|').slice(3).join('|')))];
 const start=performance.now(),output=run('PRAGMA cache_size=-2048; PRAGMA mmap_size=0;\n.mode json\n.stats on\nBEGIN;\n'+statements.map(sql=>sql+';').join('\n')+'\nCOMMIT;');
 const sum=name=>[...output.matchAll(new RegExp(name+':\\s+(\\d+)','g'))].reduce((n,m)=>n+Number(m[1]),0);
 return {value,metrics:{pageFetches:sum('Page cache misses'),fullScanSteps:sum('Fullscan Steps'),rowsReturned:value.items?.length||0,plan,fullScanTables:plan.some(p=>/^SCAN (?:r|record_topic_records)\b/.test(p))?['record_topic_records']:[],wallClockMs:Math.round((performance.now()-start)*100)/100}};
}
export function runTopicsReadBenchmark(){
 const directory=mkdtempSync(path.join(tmpdir(),'topics-read-benchmark-')),store=new ActivityStore(directory,{initializeIndexes:true});
 try{
  store.acquire();store.set('active',1);
  const concepts=Array.from({length:200},(_,i)=>({key:'place:fixture-'+i,role:'place',labels:{en:'Place '+i}}));
  const records=Array.from({length:1200},(_,i)=>({id:'record-'+i,kind:'document',date:`2026-${String(1+Math.floor(i/200)).padStart(2,'0')}-01`,titles:{en:'Top '+i},procedural:i%7===0,assignments:[{key:concepts[i%200].key,role:'place',paths:[]}],padding:'x'.repeat(10000)}));
  // Unrelated keyword summaries must not be fetched by the place overview.
  for(let i=0;i<2000;i++){
   const key='eurovoc:fixture-'+i;concepts.push({key,role:'keyword',labels:{en:'Keyword '+i}});
   records.push({id:'unrelated-'+i,kind:'document',date:'2026-01-01',titles:{en:'Unrelated'},assignments:[{key,role:'keyword',paths:[]}],padding:'x'.repeat(10000)});
  }
  writeTopicProjection(store,{concepts,records});store.release();store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const scenarios=[];
  for(const askers of ['all','not-home'])scenarios.push({name:'topics.overview.place.'+askers,...measureOverview(store.filename,{role:'place',askers,lang:'en'}).metrics});
  store.acquire();
  for(const table of ['record_topic_group_summary','record_topic_filtered_groups'])store.db.exec(`UPDATE ${table} SET top=json_remove(top,'$.procedural') WHERE top IS NOT NULL`);
  store.release();store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  for(const askers of ['all','not-home'])scenarios.push({name:'topics.overview.legacy.place.'+askers,...measureOverview(store.filename,{role:'place',askers,lang:'en'}).metrics});
  return {scenarios};
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
}
