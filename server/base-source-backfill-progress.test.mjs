import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {BaseSourceBackfill} from './base-source-backfill.mjs';
import {BaseSourceStore} from './base-source-store.mjs';
import {AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
const now=()=>Date.parse('2026-11-02T16:30:00Z');
async function fixture(t,{lists=2088,cold=true}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'base-progress-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new ActivityStore(path.join(directory,'index'),{clock:now});store.acquire();t.after(()=>store.close());
 let elapsed=0,stats=0;
 const retention=new BaseSourceStore(path.join(directory,'cache','base-sources-v1'),{io:{
  // A deterministic cold-inventory fixture: 5,932 directory entries, at 2 ms
  // simulated stat cost each. No live files or source requests are involved.
  readdir:async()=>cold?Array.from({length:5932},(_,i)=>'saved-file-'+i):[],
  stat:async()=>{elapsed+=2;stats++;return {size:1};},
  readFile:()=>assert.fail('no descriptor body is needed in this inventory fixture'),
  unlink:()=>assert.fail('unknown files must not be removed'),
 }});
 const insert=store.db.prepare("INSERT INTO sources(generation,key,kind,body,fetched_at) VALUES (22,?,'amendment-list',?,?)");
 store.transaction(()=>{
  store.set('active',22);store.set('lastSuccess',new Date(now()).toISOString());store.set('refreshPolicyGeneration',22);store.set('sequence',23);
  store.set('working',{generation:23,initial:false,initialized:true,startedAt:new Date(now()).toISOString(),phase:'refreshing',requests:490,membershipScheduled:true,groupHistoryScheduled:true,reportJoinsReady:true,procedureTitlesQueued:true,procedureTypesQueued:true,motionOutcomesDay:'2026-11-02'});
  for(let n=1;n<=lists;n++){
   const target='B-10-2025-'+String(n).padStart(4,'0'),id=target+'-AM-001-001';
   insert.run('amendment:list:'+id,JSON.stringify({id:'eli/dl/doc/'+id,identifier:id,targetDocumentId:target,extraction:{language:'en',parserVersion:AMENDMENT_EXTRACTION_VERSION,amendments:[{number:1,originalText:'Before',proposedText:'After'}]}}),new Date(now()).toISOString());
  }
  // The in-progress generation is intentionally a different source catalogue.
  store.db.prepare("INSERT INTO sources(generation,key,kind,body) VALUES (23,'amendment:list:working-only','amendment-list',?)").run(JSON.stringify({targetDocumentId:'B-10-2026-9999'}));
  for(let n=0;n<600;n++)store.enqueue(23,'fixture-core-'+n,'fixture-core',{},100);
 });
 const logs=[],backfill=new BaseSourceBackfill(store,{directory:path.join(directory,'cache'),retention,log:s=>logs.push(s)});
 let collected=0;backfill.collect=async()=>{collected++;return {status:'available'};};
 const worker=new ActivityWorker(store,{clock:now,monotonic:()=>elapsed,budget:360,maxDuration:90*60000,fetchRecord:()=>assert.fail('no upstream request')});
 worker.baseBackfill=backfill;worker.projectionGenerations=()=>[];worker.questionFileGenerations=()=>[];worker.fillProjectionBatch=async()=>{};worker.documentBodies={due:()=>false};
 worker.task=async task=>{worker.requests++;elapsed+=1000;store.finishTask(task);};
 return {store,worker,backfill,retention,logs,stats:()=>stats,collected:()=>collected,elapsed:()=>elapsed};
}
test('a cold inventory and 2,088 active lists progress during one long refreshing iteration',async t=>{
 const f=await fixture(t);
 await f.worker.run();
 assert.equal(f.store.get('active'),22);assert.equal(f.store.get('working').generation,23);assert.equal(f.store.get('working').phase,'refreshing');
 assert.equal(f.store.get('baseBackfillListSourcesCursor'),'amendment:list:B-10-2025-2088-AM-001-001','the cursor must advance beyond the first 100 rows during this refresh');
 assert.equal(f.store.get('baseBackfillListSourcesVersion'),1);
 assert.equal(f.store.get('baseBackfillSeeded'),true);
 assert.equal(f.store.get('baseBackfillListSourcesGeneration'),22);
 assert.equal(f.store.get('baseBackfillGeneration'),22);
 assert(f.store.get('baseBackfillListSourcesCursor').endsWith('2088-AM-001-001'));
 assert(f.collected()>=10,'repeated acquisition turns must run before this refresh iteration ends');
 assert.equal(f.stats(),5932);assert(f.elapsed()>10000);
 assert(f.logs.some(s=>s.phase==='list-discovery'));assert(f.logs.some(s=>s.phase==='inventory'));assert(f.logs.some(s=>s.phase==='acquisition'));
 assert.equal(f.logs.find(s=>s.phase==='list-discovery').bytes,null,'unreconciled storage is unknown, not zero');
 assert(f.store.db.prepare("SELECT COUNT(*) n FROM base_backfill_jobs WHERE state='done'").get().n>0);
 assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM base_backfill_jobs WHERE target='B-10-2026-9999'").get().n,0);
});
test('discovery batches do not inventory disk, resume the saved cursor, and pin the published generation',async t=>{
 const f=await fixture(t,{lists:205});
 assert.equal(await f.backfill.step(),true);
 assert.equal(f.stats(),0,'local seeding must not wait for the retained-byte inventory');
 const cursor=f.store.get('baseBackfillListSourcesCursor');assert(cursor.endsWith('0100-AM-001-001'));
 f.store.set('active',23);f.store.set('refreshPolicyGeneration',23);
 const restarted=new BaseSourceBackfill(f.store,{directory:'fixture-cache',retention:f.retention,log:()=>{}});
 assert.equal(restarted.due(),true);assert.equal(await restarted.step(),true);
 assert(f.store.get('baseBackfillListSourcesCursor').endsWith('0200-AM-001-001'));
 assert.equal(f.store.get('baseBackfillListSourcesGeneration'),22);assert.equal(f.stats(),0);
 assert.doesNotThrow(()=>f.store.transaction(()=>restarted.seedListSources()));
 assert.equal(f.store.get('baseBackfillListSourcesVersion'),1);
});

test('idle writer capacity drains discovery and acquisition without waiting for another tick',async t=>{
 const f=await fixture(t,{lists:105});f.worker.due=()=>false;
 await f.worker.run();
 assert.equal(f.store.get('baseBackfillSeeded'),true);
 assert.equal(f.backfill.due(),false);
 assert.equal(f.collected(),210); // One list source and one base document per target.
 assert.equal(f.stats(),5932);
});
test('native-input recovery requeues at most 100 jobs per turn',async t=>{
 const f=await fixture(t,{lists:0});
 f.store.set('baseBackfillListSourcesVersion',1);f.store.set('baseBackfillSeeded',true);
 const insert=f.store.db.prepare("INSERT INTO base_backfill_jobs(key,target,body,state,reason) VALUES (?,? ,?,'unresolved','native-nle-report-reference-unavailable')");
 f.store.transaction(()=>{for(let n=0;n<201;n++)insert.run('old-'+n,'B-10-2025-0001',JSON.stringify({kind:'document',target:'B-10-2025-0001',language:'en'}));});
 const pending=()=>f.store.db.prepare("SELECT COUNT(*) n FROM base_backfill_jobs WHERE state='pending'").get().n;
 await f.backfill.step();
 assert.equal(pending(),100);assert.equal(f.store.get('baseBackfillNativeInputsVersion'),null);assert.equal(f.stats(),0);
 await f.backfill.step();assert.equal(pending(),200);assert.equal(f.store.get('baseBackfillNativeInputsVersion'),null);
 await f.backfill.step();assert.equal(f.store.get('baseBackfillNativeInputsVersion'),1);assert.equal(f.collected(),1);
});
