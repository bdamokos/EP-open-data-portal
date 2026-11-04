import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {amendmentsCopy,amendmentsPrune} from './amendments-store.mjs';
import {prepareGenerationPrune} from './generation-prune.mjs';

const tables=['amendments','amendment_targets','amendment_contributors','amendment_procedure_targets','amendment_read_flags','amendment_page_reads','amendment_target_reads'];
function fixture(t,recursive) {
  const directory=mkdtempSync(path.join(tmpdir(),'generation-prune-')),store=new ActivityStore(directory);store.acquire();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  const db=store.db;db.exec('PRAGMA recursive_triggers='+recursive);
  for(const g of [1,2]) {
    db.prepare('INSERT INTO amendment_targets VALUES (?,?,?)').run(g,'target',JSON.stringify({procedureIds:['p'],scope:'committee'}));
    for(let i=0;i<3;i++)db.prepare('INSERT INTO amendments VALUES (?,?,?,?,?,?)').run(g,'a'+i,'target','2026-10-20','unknown',JSON.stringify({number:i,procedureIds:['p'],documentDate:'2026-10-20',authors:[{personId:'123',status:'resolved'}],variants:[{documentDate:'2026-10-21',authors:[{personId:'456',status:'resolved'}]}]}));
  }
  return {store,db};
}
const snapshot=db=>Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY generation,2`).all()]));
const guard=db=>db.prepare("SELECT value FROM meta WHERE key='amendmentPruneGeneration'").get();
const revision=db=>Number(db.prepare("SELECT value FROM meta WHERE key='amendmentMutationRevision'").get().value);
for(const recursive of ['OFF','ON'])test('old-generation copy and prune parity, recursive triggers '+recursive,t=>{
  const {store,db}=fixture(t,recursive);
  const before=snapshot(db);
  // The reference uses the original trigger maintenance, with no bulk guard.
  store.transaction(()=>{for(const table of ['amendments','amendment_targets'])db.prepare(`DELETE FROM ${table} WHERE generation=1`).run();amendmentsCopy(db,3,2);});
  const expected=snapshot(db);
  store.transaction(()=>{for(const table of [...tables].reverse())db.exec('DELETE FROM '+table);for(const table of ['amendments','amendment_targets'])for(const row of before[table])db.prepare(`INSERT INTO ${table} VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));});
  store.transaction(()=>amendmentsCopy(db,3,2));
  assert.deepEqual(snapshot(db),expected);
  store.transaction(()=>amendmentsPrune(db,3,3));
  assert.deepEqual(snapshot(db),Object.fromEntries(Object.entries(expected).map(([table,rows])=>[table,rows.filter(row=>row.generation===3)])));
  for(const table of tables)assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE generation<>3`).get().n,0,table);
  assert.equal(guard(db),undefined);
  let rev=revision(db);
  db.exec("UPDATE amendments SET body=json_set(body,'$.authors[0].personId','789') WHERE generation=3 AND id='a0'");
  assert.ok(revision(db)>rev);assert.equal(db.prepare("SELECT count(*) n FROM amendment_contributors WHERE generation=3 AND amendment_id='a0' AND person_id='789'").get().n,1);
  rev=revision(db);db.exec("DELETE FROM amendments WHERE generation=3 AND id='a0'");assert.ok(revision(db)>rev);
  for(const table of ['amendment_contributors','amendment_read_flags','amendment_page_reads'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE generation=3 AND ${table==='amendment_contributors'?'amendment_id':'id'}='a0'`).get().n,0);
});

test('bulk guard clears on statement failure, transaction rollback and success; other generations keep triggers',t=>{
  const {store,db}=fixture(t,'ON'),before=snapshot(db),rev=revision(db);
  db.exec("CREATE TRIGGER reject_prune BEFORE DELETE ON amendments WHEN OLD.generation=1 BEGIN SELECT RAISE(ABORT,'failed prune'); END");
  assert.throws(()=>store.transaction(()=>amendmentsPrune(db,2,2)),/failed prune/);
  assert.equal(guard(db),undefined);assert.deepEqual(snapshot(db),before);assert.equal(revision(db),rev);
  // Also inspect cleanup before the caller rolls back the failed transaction.
  db.exec('BEGIN');assert.throws(()=>amendmentsPrune(db,2,2),/failed prune/);assert.equal(guard(db),undefined);db.exec('ROLLBACK');
  db.exec('DROP TRIGGER reject_prune');
  assert.throws(()=>store.transaction(()=>{amendmentsPrune(db,2,2);throw new Error('rollback');}),/rollback/);
  assert.deepEqual(snapshot(db),before);assert.equal(guard(db),undefined);assert.equal(revision(db),rev);
  db.exec("CREATE TRIGGER other_generation BEFORE DELETE ON amendments WHEN OLD.generation=1 BEGIN DELETE FROM amendments WHERE generation=2 AND id=OLD.id; END");
  store.transaction(()=>amendmentsPrune(db,2,2));
  assert.equal(guard(db),undefined);assert.ok(revision(db)>rev);
  assert.equal(db.prepare('SELECT count(*) n FROM amendment_contributors').get().n,0);
});

test('additive preparation repairs legacy indexes without replay and plans seek exact identities',t=>{
  const {db}=fixture(t,'ON'),before=snapshot(db),rev=revision(db);
  db.exec('DROP INDEX amendment_contributor_identity; DROP INDEX amendment_procedure_target');
  const sql='DELETE FROM amendment_contributors WHERE generation=1 AND amendment_id=\'a0\'';
  assert.match(db.prepare('EXPLAIN QUERY PLAN '+sql).get().detail,/\(generation=\?\)/);
  prepareGenerationPrune(db);prepareGenerationPrune(db);
  assert.match(db.prepare('EXPLAIN QUERY PLAN '+sql).get().detail,/generation=\? AND amendment_id=\?/);
  assert.match(db.prepare("EXPLAIN QUERY PLAN DELETE FROM amendment_procedure_targets WHERE generation=1 AND target='target'").get().detail,/generation=\? AND target=\?/);
  assert.deepEqual(snapshot(db),before);assert.equal(revision(db),rev);
});

test('beginCycle removes an older generation and working resume preserves the retained pair',t=>{
  const {store,db}=fixture(t,'OFF');
  db.exec("INSERT INTO fast_read_progress VALUES ('amendments',1,'',1),('targets',1,'',1),('sources',1,'',1)");
  store.set('active',2);store.set('sequence',2);
  const cycle=store.beginCycle();assert.equal(cycle.generation,3);
  const expected=snapshot(db);
  assert.equal(db.prepare("SELECT count(*) n FROM fast_read_progress WHERE generation=1 AND projection IN ('amendments','targets')").get().n,0);
  assert.equal(db.prepare("SELECT ready FROM fast_read_progress WHERE generation=1 AND projection='sources'").get().ready,1);
  assert.deepEqual([...new Set(expected.amendments.map(row=>row.generation))],[2,3]);
  assert.deepEqual(store.beginCycle(),cycle);assert.deepEqual(snapshot(db),expected);assert.equal(guard(db),undefined);
});

test('all per-row trigger deletes seek an identity, except singleton continuation cleanup',t=>{
  const {db}=fixture(t,'ON');
  const triggers=db.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger'").all().filter(row=>['amendments','amendment_targets','sources','outside_contributions','items'].includes(row.tbl_name)&&/AFTER (DELETE|UPDATE)/.test(row.sql));
  for(const trigger of triggers)for(const [statement] of trigger.sql.matchAll(/DELETE FROM [^;]+/g)) {
    const sql=statement.replace(/(?:NEW|OLD)\.generation/g,'1').replace(/(?:NEW|OLD)\.\w+/g,"'x'");
    const plans=db.prepare('EXPLAIN QUERY PLAN '+sql).all().map(row=>row.detail).join('; ');
    if(statement.includes('DELETE FROM continuation_sittings')) {
      assert.match(statement,/(?:NEW|OLD)\.key='amendment:continuations'/);
    } else assert.match(plans,/generation=\? AND \w+=\?/,trigger.name+': '+plans);
  }
});
