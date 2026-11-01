import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {compareReads} from './read-benchmark.mjs';
import {measureRead} from '../server/test-support/read-benchmark-metrics.mjs';

const row=(overrides={})=>({name:'example',pageFetches:100,plan:['SEARCH items USING INDEX lookup (mep=?)'],fullScanTables:[],wallClockMs:1,...overrides});
const compare=(old,current)=>compareReads({scenarios:[old]},{scenarios:[current]});
test('read gate tolerates slack, improvements, timing noise and non-scan plan changes',()=>{
  for(const overrides of [{pageFetches:130},{pageFetches:1},{wallClockMs:999999},{plan:['SEARCH items USING INDEX another (mep=?)']}])
    assert.deepEqual(compare(row(),row(overrides)).failures,[]);
  assert.match(compare(row(),row({pageFetches:80})).markdown,/-20/);
});
test('read gate catches page growth and newly scanned tables independently',()=>{
  assert.equal(compare(row(),row({pageFetches:131})).failures.length,1);
  assert.equal(compare(row(),row({fullScanTables:['items']})).failures.length,1);
  assert.equal(compare(row({fullScanTables:['items']}),row({fullScanTables:['items','sources']})).failures.length,1);
  assert.deepEqual(compare(row({fullScanTables:['items']}),row({fullScanTables:['items']})).failures,[]);
});
test('missing, duplicate and invalid scenarios cannot silently disable the gate',()=>{
  assert.equal(compareReads({scenarios:[row()]},{scenarios:[]}).failures.length,1);
  assert.equal(compareReads({scenarios:[]},{scenarios:[row()]}).failures.length,1);
  assert.throws(()=>compareReads({scenarios:[]},{scenarios:[row(),row()]}),/Duplicate/);
  assert.throws(()=>compare(row(),row({pageFetches:NaN})),/Invalid/);
});
test('CLI metrics detect an actual lost index without scanstatus support',t=>{
  try{execFileSync('sqlite3',['--version']);}catch(error){
    if(error.code==='ENOENT'){t.skip('sqlite3 CLI unavailable');return;}throw error;
  }
  const directory=mkdtempSync(path.join(tmpdir(),'read-metrics-test-')),file=path.join(directory,'fixture.sqlite');
  try {
    execFileSync('sqlite3',[file],{input:`CREATE TABLE items(mep TEXT,body TEXT);
      WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000)
      INSERT INTO items SELECT CAST(x AS TEXT),zeroblob(1000) FROM n;
      CREATE INDEX lookup ON items(mep);`});
    const sql="SELECT body FROM items entry WHERE entry.mep='42'";
    const indexed=measureRead(file,sql);
    execFileSync('sqlite3',[file,'DROP INDEX lookup']);
    const scanned=measureRead(file,sql);
    assert.equal(indexed.rowsReturned,1);
    assert.equal(indexed.fullScanLargeTable,false);
    assert.deepEqual(scanned.fullScanTables,['items']);
    assert.ok(scanned.pageFetches>indexed.pageFetches*1.2+10);
    assert.ok(scanned.fullScanSteps>0);
    assert.equal(compare({...indexed,name:'lost-index'},{...scanned,name:'lost-index'}).failures.length,2);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
