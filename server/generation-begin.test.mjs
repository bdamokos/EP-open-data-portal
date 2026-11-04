import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {amendmentGeneration} from './amendments-store.mjs';
import {prepareIndexes} from './migrate-indexes.mjs';

const at='2026-11-02T02:00:00Z',instant=()=>Date.parse(at);
const FILE='activities-v1.sqlite';
const open=directory=>{const store=new ActivityStore(directory,{clock:instant});assert(store.acquire());return store;};

function seed(store,generation) {
  const {db}=store;
  for(let i=0;i<7;i++) {
    const id='E-10-2026-00000'+i;
    db.prepare("INSERT INTO sources VALUES (?,?,'document',?,?,1)").run(generation,'/parliamentary-questions/'+id,JSON.stringify({identifier:id,work_type:'def/QUESTION_WRITTEN',document_date:'2026-10-10',title_dcterms:{en:'Energy '+i}}),at);
    db.prepare("INSERT INTO items VALUES (?,?,?,'1','question','2026-10-10','{}')").run(generation,'/parliamentary-questions/'+id,id);
    db.prepare("INSERT INTO items VALUES (?,?,?,'2','question','2026-10-10','{}')").run(generation,'/parliamentary-questions/'+id,id);
    db.prepare('INSERT INTO question_file_sources VALUES (?,?,?)').run(generation,'/parliamentary-questions/'+id,'s'+i);
    db.prepare("INSERT INTO question_files VALUES (?,?,0,?,'en',1,'{}')").run(generation,'/parliamentary-questions/'+id,'https://example.test/'+id);
    db.prepare("INSERT INTO outside_contributions VALUES (?,?,'9','2026-10-10',?)").run(generation,'MTG-'+i,JSON.stringify({term:10}));
    db.prepare("INSERT INTO group_voice_observations VALUES (?,?,'2026-10-10','{}')").run(generation,'MTG-'+i);
    db.prepare("INSERT INTO group_voice_designations VALUES (?,?,'9','G','2026-10-10','s')").run(generation,'MTG-'+i);
    const authors=[{status:'resolved',personId:'person/1'},{status:'resolved',personId:'person/2'}];
    db.prepare("INSERT INTO amendments VALUES (?,?,'A-10-2026-0001','2026-10-10','adopted',?)").run(generation,'AM-'+i,JSON.stringify({number:i,authors,procedureIds:['2024-0001'],proposerDate:'2026-10-10',documentDate:'2026-10-10'}));
  }
  db.prepare("INSERT INTO amendment_targets VALUES (?,'A-10-2026-0001',?)").run(generation,JSON.stringify({procedureIds:['2024-0001']}));
  db.prepare('INSERT OR REPLACE INTO group_voice_state VALUES (?,1)').run(generation);
  db.prepare("INSERT INTO refresh_gaps(generation,key,kind,body,priority,attempts,failed_at,retry_at) VALUES (?,'/gap','document','{}',1,0,?,0)").run(generation,at);
}
// Two published generations with ready projections, as a live index has.
function base(t) {
  const directory=mkdtempSync(path.join(tmpdir(),'generation-begin-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const store=open(directory);
  for(const generation of [1,2]) {
    const cycle=store.beginCycle({batched:false});assert.equal(cycle.generation,generation);
    if(generation===2)store.db.exec('DELETE FROM sources; DELETE FROM items; DELETE FROM question_files; DELETE FROM question_file_sources; DELETE FROM outside_contributions; DELETE FROM group_voice_observations; DELETE FROM group_voice_designations; DELETE FROM amendments; DELETE FROM amendment_targets; DELETE FROM refresh_gaps;');
    seed(store,generation);store.publish(generation);
  }
  while(store.backfillFastReads(2)){/* ready projections */}
  store.set('questionFileBackfill:2',{version:1});
  store.db.prepare('INSERT OR REPLACE INTO fast_read_progress(projection,generation,cursor,ready) VALUES (\'targets\',1,\'\',1)').run();
  store.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();store.close();
  return directory;
}
function clone(t,directory) {
  const copy=mkdtempSync(path.join(tmpdir(),'generation-begin-clone-'));t.after(()=>rmSync(copy,{recursive:true,force:true}));
  copyFileSync(path.join(directory,FILE),path.join(copy,FILE));return copy;
}
// Every ordinary table, ignoring row order, plus meta except keys that record the path taken.
function dump(store) {
  const tables=store.db.prepare("SELECT name FROM pragma_table_list WHERE type='table' AND schema='main' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('meta','lease')").all().map(row=>row.name);
  const content=Object.fromEntries(tables.map(table=>[table,store.db.prepare(`SELECT * FROM ${table}`).all().map(row=>JSON.stringify(row)).sort()]));
  const meta=Object.fromEntries(store.db.prepare("SELECT key,value FROM meta WHERE key NOT IN ('generationBegin','amendmentMutationRevision')").all().map(row=>[row.key,row.value]));
  return {content,meta};
}
const expected=(t,directory)=>{
  const store=open(clone(t,directory));
  try {const cycle=store.beginCycle({batched:false});return {cycle,dump:dump(store)};}
  finally {store.close();}
};


test('a batched begin matches the single transaction in every table',t=>{
  const directory=base(t),atomic=expected(t,directory),store=open(clone(t,directory));
  try {
    const paused=[],cycle=store.beginCycle({batch:2,pause:ms=>paused.push(ms)});
    assert.deepEqual(cycle,atomic.cycle);assert.deepEqual(dump(store),atomic.dump);
    assert.ok(paused.length>20,'the rotation commits in small steps');
    for(const table of ['source_reads','question_reads','amendment_contributors','amendment_read_flags','amendment_page_reads','outside_directory_reads','amendment_targets','group_voice_observations'])assert.ok(store.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE generation=3`).get().n>0,table);
    assert.equal(store.get('generationBegin'),null);
    assert.equal(store.db.prepare("SELECT value FROM meta WHERE key='fastReadCopyGeneration'").get(),undefined);
    assert.equal(store.fastReadsReady(3,'sources'),true);
  } finally {store.close();}
});

test('an unsized begin adapts its batches and stays equal, with temporary rows in memory',t=>{
  const directory=base(t),atomic=expected(t,directory),store=open(clone(t,directory));
  try {
    assert.deepEqual(store.beginCycle({memoryTemp:true}),atomic.cycle);assert.deepEqual(dump(store),atomic.dump);
    assert.equal(store.db.prepare('PRAGMA temp_store').get().temp_store,1,'file-backed again for the rest of the transaction');
  } finally {store.close();}
});

test('a begin stopped after any commit resumes to the same result, invisible to readers until the end',t=>{
  const directory=base(t),atomic=expected(t,directory);
  const stop=new Error('stop');
  for(let commit=1,finished=false;!finished;commit++) {
    const working=clone(t,directory);
    let store=open(working),count=0;
    try {
      const before=store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=2').get().n;
      try {store.beginCycle({batch:2,pause:()=>{if(++count===commit)throw stop;}});finished=true;}
      catch(error) {
        assert.equal(error,stop);
        assert.equal(store.get('working'),null);assert.equal(store.get('active'),2);assert.equal(amendmentGeneration(store),2);
        assert.equal(store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=2').get().n,before);
        assert.ok(store.get('generationBegin'));
        store.close();store=open(working);
        assert.deepEqual(store.beginCycle({batch:2}),atomic.cycle);
      }
      assert.deepEqual(dump(store),atomic.dump,'stopped after commit '+commit);
    } finally {store.close();}
  }
});

test('an active generation that changed across a resume restarts the begin instead of publishing the copy',t=>{
  const directory=base(t),store=open(clone(t,directory)),stop=new Error('stop');
  try {
    assert.throws(()=>store.beginCycle({batch:2,pause:()=>{if(store.get('generationBegin')?.cursor&&store.db.prepare('SELECT 1 FROM items WHERE generation=3 LIMIT 1').get())throw stop;}}),/stop/);
    const copied=store.db.prepare('SELECT source_id FROM items WHERE generation=3 LIMIT 1').get().source_id;
    store.db.prepare('DELETE FROM items WHERE generation=2 AND source_id=?').run(copied);
    assert.throws(()=>store.beginCycle({batch:2}),/does not match/);
    assert.equal(store.get('generationBegin').discard,true);
    const cycle=store.beginCycle({batch:2});assert.equal(cycle.generation,4);
    const count=generation=>store.db.prepare('SELECT COUNT(*) n FROM items WHERE generation=?').get(generation).n;
    assert.equal(count(3),0);assert.equal(count(4),count(2));
  } finally {store.close();}
});

test('the single-transaction path of an older image clears a partly built generation',t=>{
  const directory=base(t),store=open(clone(t,directory)),stop=new Error('stop');
  try {
    const rows=store.db.prepare('SELECT COUNT(*) n FROM amendments WHERE generation=2').get().n;
    assert.throws(()=>store.beginCycle({batch:2,pause:()=>{if(store.db.prepare('SELECT 1 FROM amendments WHERE generation=3 LIMIT 1').get())throw stop;}}),/stop/);
    const cycle=store.beginCycle({batched:false});assert.equal(cycle.generation,4);
    for(const table of ['sources','items','amendments','outside_contributions'])assert.equal(store.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE generation=3`).get().n,0,table);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM amendments WHERE generation=4').get().n,rows);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM amendments WHERE generation=2').get().n,rows);
    store.publish(4);
    // The stale marker no longer matches and the next rotation starts clean.
    assert.equal(store.beginCycle({batch:2}).generation,5);assert.equal(store.get('generationBegin'),null);
  } finally {store.close();}
});

test('a partly built generation from a different copy plan is restarted, not resumed',t=>{
  const directory=base(t),store=open(clone(t,directory)),stop=new Error('stop');
  try {
    assert.throws(()=>store.beginCycle({batch:2,pause:()=>{if(store.get('generationBegin')?.cursor)throw stop;}}),/stop/);
    store.set('generationBegin',{...store.get('generationBegin'),plan:'older-plan'});
    assert.equal(store.beginCycle({batch:2}).generation,4);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sources WHERE generation=3').get().n,0);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sources WHERE generation=4').get().n,store.db.prepare('SELECT COUNT(*) n FROM sources WHERE generation=2').get().n);
  } finally {store.close();}
});

const rowCount=(store,table,generation)=>store.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE generation=?`).get(generation).n;
const stopWhen=(store,ready)=>()=>{if(ready(store))throw new Error('stop');};
const copied=(table,generation=3)=>store=>rowCount(store,table,generation)>0;

test('a discarded copy stays out of adoption until its rows are gone, and the active snapshot survives',t=>{
  for(const reason of ['changed-source','ineligible']) {
    const directory=base(t),store=open(clone(t,directory));
    try {
      assert.throws(()=>store.beginCycle({batch:2,pause:stopWhen(store,copied('amendment_page_reads'))}),/stop/);
      const victim=store.db.prepare('SELECT id FROM amendments WHERE generation=2 LIMIT 1').get().id;
      if(reason==='changed-source') {
        store.db.prepare('DELETE FROM amendments WHERE generation=2 AND id=?').run(victim);
        assert.throws(()=>store.beginCycle({batch:2}),/does not match/);
        assert.equal(store.get('generationBegin').discard,true);
        assert.equal(amendmentGeneration(store),2,'the excluded rows are not read');
      } else {
        store.db.prepare("DELETE FROM fast_read_progress WHERE projection='amendments' AND generation=2").run();
        store.set('generationBegin',{...store.get('generationBegin'),plan:'older-plan'});
      }
      const active=rowCount(store,'amendments',2);
      assert.equal(store.beginCycle({batch:2}).generation,4);
      assert.equal(store.get('generationBegin'),null);
      for(const table of ['sources','amendments','amendment_contributors','amendment_page_reads','group_voice_observations'])assert.equal(rowCount(store,table,3),0,reason+' '+table);
      assert.equal(rowCount(store,'amendments',2),active,reason+' active');
      assert.equal(rowCount(store,'amendments',4),active,reason+' new');
      if(reason==='changed-source')assert.equal(store.db.prepare('SELECT COUNT(*) n FROM amendments WHERE generation=4 AND id=?').get(victim).n,0,'the deleted row stays deleted');
    } finally {store.close();}
  }
});

test('a discard stopped partway finishes on the next begin, still excluded',t=>{
  const directory=base(t),store=open(clone(t,directory));
  try {
    assert.throws(()=>store.beginCycle({batch:2,pause:stopWhen(store,copied('amendment_page_reads'))}),/stop/);
    store.set('generationBegin',{...store.get('generationBegin'),discard:true});
    let commits=0;
    assert.throws(()=>store.beginCycle({batch:2,pause:()=>{if(++commits===2)throw new Error('stop');}}),/stop/);
    assert.equal(store.get('generationBegin').discard,true);assert.equal(amendmentGeneration(store),2);
    assert.equal(store.beginCycle({batch:2}).generation,4);assert.equal(rowCount(store,'sources',3),0);
  } finally {store.close();}
});

test('a source changed after its table finished is caught before the generation opens',t=>{
  const directory=base(t),store=open(clone(t,directory));
  try {
    assert.throws(()=>store.beginCycle({batch:2,pause:stopWhen(store,copied('items'))}),/stop/);
    store.db.prepare("INSERT INTO sources VALUES (2,'/plenary-documents/late','document','{}',?,1)").run(at);
    assert.throws(()=>store.beginCycle({batch:2}),/sources does not match/);
    assert.equal(store.get('working'),null);
    assert.equal(store.beginCycle({batch:2}).generation,4);
    assert.equal(rowCount(store,'sources',4),rowCount(store,'sources',2));
  } finally {store.close();}
});

test('any other writer iteration ends the resume, even when row counts still match',t=>{
  const directory=base(t),store=open(clone(t,directory));
  try {
    assert.throws(()=>store.beginCycle({batch:2,pause:stopWhen(store,copied('items'))}),/stop/);
    store.db.prepare("UPDATE sources SET fetched_at='changed' WHERE generation=2").run();
    store.set('documentBodyTurn',(store.get('documentBodyTurn')||0)+1);
    assert.equal(store.beginCycle({batch:2}).generation,4);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM sources WHERE generation=4 AND fetched_at='changed'").get().n,rowCount(store,'sources',2));
  } finally {store.close();}
});

test('startup preparation that replays projections discards the partial generation',t=>{
  const directory=base(t),working=clone(t,directory);
  let store=open(working);
  try {
    assert.throws(()=>store.beginCycle({batch:2,pause:stopWhen(store,copied('amendments'))}),/stop/);
    store.set('committeeAmendmentIndexVersion',0);store.close();
    prepareIndexes({activityDirectory:working,clock:instant,log:()=>{}});
    store=open(working);
    assert.equal(store.get('generationBegin').discard,true);
    assert.equal(store.beginCycle({batch:2}).generation,4);
    assert.equal(rowCount(store,'amendments',3),0);assert.equal(rowCount(store,'amendment_contributors',3),0);
    assert.equal(rowCount(store,'amendment_contributors',4),rowCount(store,'amendment_contributors',2));
  } finally {store.close();}
});

test('batches stay bounded: a keyless projection pages, and large rows split by bytes',t=>{
  const directory=base(t),store=open(clone(t,directory));
  try {
    store.db.prepare('DELETE FROM procedure_event_reads').run();
    const event=store.db.prepare("INSERT INTO procedure_event_reads VALUES (2,?,'2026-10-10','t',?,'2026-10-10')");
    for(let i=0;i<20;i++)event.run('/procedures/'+String(i).padStart(4,'0'),at);
    const large=JSON.stringify({pad:'x'.repeat(1024*1024)}),row=store.db.prepare("INSERT INTO items VALUES (2,'/s',?,'9','question','2026-10-10',?)");
    for(let i=0;i<6;i++)row.run('big-'+i,large);
    let events=0,items=0;
    const counts=()=>[rowCount(store,'procedure_event_reads',3),rowCount(store,'items',3)];
    let before=[0,0];
    store.beginCycle({batch:1,batchBytes:1024*1024,pause:()=>{const now=counts();events=Math.max(events,now[0]-before[0]);items=Math.max(items,now[1]-before[1]);before=now;}});
    assert.equal(rowCount(store,'procedure_event_reads',3),20);assert.equal(rowCount(store,'items',3),rowCount(store,'items',2));
    assert.equal(events,1,'one event row per commit');assert.ok(items<=2,'large rows are not copied together');
    const bytes=open(clone(t,directory));
    try {
      const big=bytes.db.prepare("INSERT INTO items VALUES (2,'/s',?,'9','question','2026-10-10',?)");
      for(let i=0;i<6;i++)big.run('big-'+i,large);
      let most=0,seen=0;
      bytes.beginCycle({batch:100,batchBytes:1024*1024,pause:()=>{const n=rowCount(bytes,'items',3);most=Math.max(most,n-seen);seen=n;}});
      assert.ok(most<100,'the byte bound ends a batch before its row bound');
    } finally {bytes.close();}
  } finally {store.close();}
});

test('an unfinished question-file backfill keeps the single-transaction path',t=>{
  const directory=base(t),store=open(clone(t,directory));
  try {
    store.db.prepare("DELETE FROM meta WHERE key='questionFileBackfill:2'").run();
    let paused=0;assert.equal(store.beginCycle({batch:2,pause:()=>paused++}).generation,3);assert.equal(paused,0);
  } finally {store.close();}
});

test('indexes without ready projections keep the single-transaction path',t=>{
  const directory=base(t),store=open(clone(t,directory));
  try {
    store.db.prepare("DELETE FROM fast_read_progress WHERE projection='amendments' AND generation=2").run();
    let paused=0;assert.equal(store.beginCycle({batch:2,pause:()=>paused++}).generation,3);assert.equal(paused,0);
  } finally {store.close();}
});

test('the writer resumes a stopped begin before anything else can write',async t=>{
  const directory=base(t),working=clone(t,directory);
  let store=open(working);const stop=new Error('stop');
  assert.throws(()=>store.beginCycle({batch:2,pause:()=>{throw stop;}}),/stop/);
  store.release();store.close();store=new ActivityStore(working,{clock:instant});t.after(()=>store.close());
  const calls=[],worker=new ActivityWorker(store,{clock:instant,budget:0,fetchRecord:()=>{throw new Error('No network expected');}});
  worker.generationExecutor=async operation=>{calls.push([operation,store.get('generationBegin')?.generation]);const cycle=store.beginCycle();worker.stopped=true;return cycle;};
  assert.equal(worker.due(),true);
  await worker.run();
  assert.deepEqual(calls,[['begin',3]]);
  assert.equal(store.get('working').generation,3);assert.equal(store.get('generationBegin'),null);
});
