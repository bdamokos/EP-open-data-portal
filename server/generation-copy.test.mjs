import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {copyGenerationRows} from './generation-copy.mjs';

const rows=(db,generation)=>db.prepare('SELECT speech,person,body FROM t WHERE generation=? ORDER BY speech,person').all(generation).map(row=>({...row}));

test('batched generation copies match a single statement at every boundary',()=>{
  for(const count of [0,1,4,5,6,13]) {
    const db=new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (generation INTEGER, speech TEXT, person TEXT, body TEXT, PRIMARY KEY(generation,speech,person))');
    const insert=db.prepare('INSERT INTO t VALUES (1,?,?,?)');
    // Repeated speech values check that a range never splits one key.
    for(let i=0;i<count;i++)for(const person of ['a','b'])insert.run('s'+String(i%7).padStart(2,'0')+'-'+Math.floor(i/7),person,'body '+i+person);
    db.prepare('INSERT INTO t VALUES (9,?,?,?)').run('s00-0','a','other generation');
    copyGenerationRows(db,{table:'t',key:'speech',select:'INSERT INTO t SELECT ?,speech,person,body FROM t'},2,1,5);
    assert.deepEqual(rows(db,2),rows(db,1),'count '+count);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM t WHERE generation=9').get().n,1);
  }
});

test('a generation copy through JS trigger functions stays within a small heap',()=>{
  // One statement over these rows keeps every parsed body alive and exceeds
  // the 24 MiB limit; batched ranges release them between statements.
  const script=`
    import {DatabaseSync} from 'node:sqlite';
    import {copyGenerationRows} from ${JSON.stringify(new URL('./generation-copy.mjs',import.meta.url).href)};
    const db=new DatabaseSync(':memory:');
    db.exec('CREATE TABLE sources (generation INTEGER, key TEXT, body TEXT, PRIMARY KEY(generation,key)); CREATE TABLE reads (generation INTEGER, key TEXT, value TEXT)');
    db.function('compact',{deterministic:true},body=>{const value=JSON.parse(body);return JSON.stringify({id:value.id,count:value.items.length});});
    const body=JSON.stringify({id:'x',items:Array.from({length:400},(_,i)=>({a:i,b:'text '+i,c:[i,i+1]}))});
    const insert=db.prepare('INSERT INTO sources VALUES (1,?,?)');db.exec('BEGIN');for(let i=0;i<5000;i++)insert.run('k'+String(i).padStart(6,'0'),body);db.exec('COMMIT');
    db.exec("CREATE TRIGGER copy_reads AFTER INSERT ON sources BEGIN INSERT INTO reads VALUES (NEW.generation,NEW.key,compact(NEW.body)); END");
    db.exec('BEGIN');copyGenerationRows(db,{table:'sources',key:'key',select:'INSERT INTO sources SELECT ?,key,body FROM sources'},2,1);db.exec('COMMIT');
    process.stdout.write(String(db.prepare('SELECT COUNT(*) n FROM reads WHERE generation=2').get().n));`;
  assert.equal(execFileSync(process.execPath,['--max-old-space-size=24','--input-type=module','-e',script],{encoding:'utf8'}),'5000');
});

import {registerFastReads} from './fast-read-projections.mjs';
import {ActivityStore} from './activity-index-store.mjs';
import {copyProjectedGenerationRows} from './generation-copy.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('direct projections equal trigger replay, including frontiers, FTS and later writes',t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'copy-parity-')),store=new ActivityStore(directory);
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});store.acquire();
  const db=store.db,at='2026-10-20T12:00:00Z';
  for(const [key,kind,body] of [
    ['/parliamentary-questions/Q1','document',{work_type:'def/QUESTION_WRITTEN',title_dcterms:{en:'Energy policy'},document_date:'2026-10-19',extraction:{text:'omit'}}],
    ['/procedures/2026-0001','procedure',{id:'2026-0001',consists_of:[{id:'eli/dl/event/EV1',had_activity_type:'def/PLENARY_VOTE',activity_date:'2026-10-19'}]}],
    ['/other','document',{title_dcterms:{en:'Other'}}],
  ])db.prepare('INSERT INTO sources VALUES (1,?,?,?,?,0)').run(key,kind,JSON.stringify(body),at);
  db.prepare('INSERT INTO outside_contributions VALUES (1,?,?,?,?)').run('speech','person','2026-10-19',JSON.stringify({term:10,parentIds:['parent']}));
  db.prepare('INSERT INTO amendment_targets VALUES (1,?,?)').run('target',JSON.stringify({id:'target',procedureIds:['2026-0001'],scope:'committee'}));
  const specs=[
    {table:'sources',key:'key',select:'INSERT INTO sources SELECT ?,key,kind,body,fetched_at,0 FROM sources'},
    {table:'outside_contributions',key:'speech',select:'INSERT INTO outside_contributions SELECT ?,speech,person,date,body FROM outside_contributions'},
    {table:'amendment_targets',key:'id',select:'INSERT INTO amendment_targets SELECT ?,id,body FROM amendment_targets'},
  ];
  // Generation 2 uses triggers, including the incomplete-projection fallback.
  store.generationTransaction(()=>{for(const spec of specs)copyProjectedGenerationRows(db,spec,2,1);});
  while(store.backfillFastReads(1)){}
  const tables=['source_reads','question_reads','question_frontiers','procedure_event_reads','outside_directory_reads','amendment_target_reads'];
  const snapshot=(table,generation)=>db.prepare(`SELECT * FROM ${table} WHERE generation=?`).all(generation).map(({generation,...row})=>row);
  // Prove no JS projection function is called by the direct copy.
  db.function('compact_source_read',{varargs:true},()=>{throw new Error('projection replayed');});
  db.function('projection_event_date',()=>{throw new Error('date replayed');});
  store.generationTransaction(()=>{for(const spec of specs)copyProjectedGenerationRows(db,spec,3,1);});
  for(const table of tables)assert.deepEqual(snapshot(table,3),snapshot(table,2),table);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM question_title_search JOIN question_reads q ON q.rowid=question_title_search.rowid WHERE question_title_search MATCH 'Energy' AND q.generation=3").get().n,1);
  assert.equal(store.fastReadsReady(3),true);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='fastReadCopyGeneration'").get(),undefined);
  registerFastReads(db);
  db.prepare("UPDATE sources SET body=json_set(body,'$.title_dcterms.en','Updated policy') WHERE generation=3 AND key LIKE '/parliamentary-questions/%'").run();
  assert.match(db.prepare('SELECT body FROM question_reads WHERE generation=3').get().body,/Updated policy/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM question_title_search JOIN question_reads q ON q.rowid=question_title_search.rowid WHERE question_title_search MATCH 'Updated' AND q.generation=3").get().n,1);
  db.exec("CREATE TRIGGER fail_copy BEFORE INSERT ON question_reads WHEN NEW.generation=5 BEGIN SELECT RAISE(ABORT,'copy failed'); END");
  assert.throws(()=>store.generationTransaction(()=>copyProjectedGenerationRows(db,specs[0],5,1)),/copy failed/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sources WHERE generation=5').get().n,0);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='fastReadCopyGeneration'").get(),undefined);
  // A failed direct copy rolls back both base rows and guard, then normal
  // trigger maintenance remains available on the original generation.
  assert.throws(()=>store.generationTransaction(()=>{copyProjectedGenerationRows(db,specs[0],4,1);throw new Error('rollback');}),/rollback/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sources WHERE generation=4').get().n,0);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='fastReadCopyGeneration'").get(),undefined);
});

test('link invalidation and committee target preparation stay within a 24 MiB heap',()=>{
  const script=`
    import {DatabaseSync} from 'node:sqlite';
    import {prepareFastReads} from ${JSON.stringify(new URL('./fast-read-projections.mjs',import.meta.url).href)};
    import {amendmentsSchema,amendmentLinkIndexes,invalidateAmendmentLinks,prepareCommitteeAmendmentIndexes} from ${JSON.stringify(new URL('./amendments-store.mjs',import.meta.url).href)};
    const db=new DatabaseSync(':memory:');
    db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE sources(generation INTEGER,key TEXT,kind TEXT,body TEXT,fetched_at TEXT,touched INTEGER,PRIMARY KEY(generation,key)); CREATE TABLE outside_contributions(generation INTEGER,speech TEXT,person TEXT,date TEXT,body TEXT,PRIMARY KEY(generation,speech,person))');
    amendmentsSchema(db);
    const body=JSON.stringify({work_type:'def/REPORT_PLENARY',amendmentLinksVersion:1,padding:'x'.repeat(12000),procedureIds:['2026-0001']});
    const source=db.prepare("INSERT INTO sources VALUES (1,?,'document',?,'2026-10-20',0)"),target=db.prepare('INSERT INTO amendment_targets VALUES (1,?,?)');
    db.exec('BEGIN');for(let i=0;i<3000;i++){source.run('k'+String(i).padStart(5,'0'),body);target.run('t'+i,body);}db.exec('COMMIT');
    prepareFastReads(db);amendmentLinkIndexes(db);
    db.exec('BEGIN');const result=invalidateAmendmentLinks({db,assertWriter(){}},1);prepareCommitteeAmendmentIndexes(db);db.exec('COMMIT');
    if(result.changes!==3000 || db.prepare('SELECT COUNT(*) n FROM amendment_target_reads').get().n!==3000 || db.prepare('SELECT COUNT(*) n FROM amendment_procedure_targets').get().n!==3000)throw new Error('missing rows');
    if(invalidateAmendmentLinks({db,assertWriter(){}},1).changes!==0)throw new Error('repeated invalidation');
    process.stdout.write('ok');`;
  assert.equal(execFileSync(process.execPath,['--max-old-space-size=24','--input-type=module','-e',script],{encoding:'utf8'}),'ok');
});
