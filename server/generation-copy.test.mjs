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
  // the 48 MiB limit; batched ranges release them between statements.
  const script=`
    import {DatabaseSync} from 'node:sqlite';
    import {copyGenerationRows} from ${JSON.stringify(new URL('./generation-copy.mjs',import.meta.url).href)};
    const db=new DatabaseSync(':memory:');
    db.exec('CREATE TABLE sources (generation INTEGER, key TEXT, body TEXT, PRIMARY KEY(generation,key)); CREATE TABLE reads (generation INTEGER, key TEXT, value TEXT)');
    db.function('compact',{deterministic:true},body=>{const value=JSON.parse(body);return JSON.stringify({id:value.id,count:value.items.length});});
    const body=JSON.stringify({id:'x',items:Array.from({length:400},(_,i)=>({a:i,b:'text '+i,c:[i,i+1]}))});
    const insert=db.prepare('INSERT INTO sources VALUES (1,?,?)');db.exec('BEGIN');for(let i=0;i<12000;i++)insert.run('k'+String(i).padStart(6,'0'),body);db.exec('COMMIT');
    db.exec("CREATE TRIGGER copy_reads AFTER INSERT ON sources BEGIN INSERT INTO reads VALUES (NEW.generation,NEW.key,compact(NEW.body)); END");
    db.exec('BEGIN');copyGenerationRows(db,{table:'sources',key:'key',select:'INSERT INTO sources SELECT ?,key,body FROM sources'},2,1);db.exec('COMMIT');
    process.stdout.write(String(db.prepare('SELECT COUNT(*) n FROM reads WHERE generation=2').get().n));`;
  assert.equal(execFileSync(process.execPath,['--max-old-space-size=48','--input-type=module','-e',script],{encoding:'utf8'}),'12000');
});
