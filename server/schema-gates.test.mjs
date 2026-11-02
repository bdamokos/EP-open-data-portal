import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ActivityStore,ACTIVITY_SCHEMA_GATES} from './activity-index-store.mjs';
import {CorpusStore,CORPUS_SCHEMA_GATES} from './corpus-store.mjs';
import {prepareIndexes} from './migrate-indexes.mjs';

const stores=[
  {kind:'activity',Store:ActivityStore,gates:ACTIVITY_SCHEMA_GATES,list:'ACTIVITY_SCHEMA_GATES',source:'activity-index-store.mjs',file:'activities-v1.sqlite'},
  {kind:'corpus',Store:CorpusStore,gates:CORPUS_SCHEMA_GATES,list:'CORPUS_SCHEMA_GATES',source:'corpus-store.mjs',file:'corpus-v1.sqlite'},
];
for(const {kind,Store,gates,list,source,file} of stores) {
  test(`${kind}: each missing schema gate triggers preparation and permits the normal writer`,async t=>{
    const directory=mkdtempSync(path.join(os.tmpdir(),`schema-gates-${kind}-`));
    t.after(()=>rmSync(directory,{recursive:true,force:true}));
    const prepare=()=>prepareIndexes({[kind+'Directory']:directory,log:()=>{}})[0];
    assert.equal(prepare().noop,false);
    assert.equal(prepare().noop,true);
    assert.equal(new Set(gates.map(gate=>gate.key)).size,gates.length);
    for(const gate of gates)await t.test(gate.key,()=>{
      const existingWriter=new Store(directory);
      const db=new DatabaseSync(path.join(directory,file));
      try {assert.equal(db.prepare('DELETE FROM meta WHERE key=?').run(gate.key).changes,1);}finally {db.close();}
      try {
        if(gate.writerGate!==false)assert.throws(()=>existingWriter.acquire(),/migrate-indexes/);
      }finally {existingWriter.close();}
      if(gate.constructorGate!==false)assert.throws(()=>new Store(directory),/migrate-indexes/);
      assert.equal(prepare().noop,false,'missing '+gate.key+' must not be a noop');
      const writer=new Store(directory);
      try {
        assert.equal(writer.get(gate.key),gate.value);
        assert.equal(writer.acquire(),true,'normal writer must acquire after preparing '+gate.key);
        writer.release();
      }finally {writer.close();}
      assert.equal(prepare().noop,true);
    });
  });

  test(`${kind}: startup rejection guards use only the schema gate list`,()=>{
    // Deliberately constrain these guards: adding an inline meta comparison,
    // even for an already listed key, must fail this test. Per-gate preparation
    // checks remain free to use their existing implementation and comparisons.
    const text=readFileSync(new URL(source,import.meta.url),'utf8').replace(/\s+/g,'');
    const compactGuards=[...text.matchAll(/if\(([^;{}]*?)\)thrownewError\('(Unprepared[^']*indexes\.|Runnodeserver\/migrate-indexes\.mjsbeforestartingtheapp\.)'\);/g)];
    assert.equal(compactGuards.length,2,'one constructor guard and one acquire guard');
    assert.deepEqual(compactGuards.map(match=>match[1]),[
      `${list}.some(gate=>gate.constructorGate!==false&&this.get(gate.key)!==gate.value)`,
      `!this.initializeIndexes&&${list}.some(gate=>gate.writerGate!==false&&this.get(gate.key)!==gate.value)`,
    ]);
    // Also catch a new rejection written with braces or a different condition.
    assert.equal((text.match(/migrate-indexes\.mjs/g)||[]).length,2,'all migration rejections must use the shared gates');
    assert.equal((text.match(/Unprepared[^']*indexes\./g)||[]).length,1);
  });
}
