import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {overviewState} from './topics-overview-state.mjs';
import {observePublications} from './source-publications.mjs';
import {RECORD_TOPICS_VERSION} from './record-topics.mjs';
test('committed topic metadata changes emit publication notices even in the same active generation',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)');
 const store={db,get:key=>JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value||'null')},messages=[];
 const put=(key,value)=>db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key,JSON.stringify(value));
 const stop=observePublications(store,'activity',message=>messages.push(message));
 try{
  await new Promise(setImmediate);assert.equal(overviewState(store).ready,false);
  put('active',1);put('recordTopicProjection',{version:RECORD_TOPICS_VERSION,generation:1,askerSubsets:['all','not-home']});store.onCommit();
  await new Promise(setImmediate);const first=overviewState(store);assert.equal(first.ready,true);
  put('recordTopicCoverage',{generation:1,read:1});store.onCommit();await new Promise(setImmediate);
  assert.equal(messages.length,3);assert.equal(messages.at(-1).revision.active,1);
  assert.deepEqual(messages.at(-1).revision.recordTopicCoverage,{generation:1,read:1});
  assert.notEqual(overviewState(store).token,first.token);
  store.onCommit();await new Promise(setImmediate);assert.equal(messages.length,3,'unchanged commit sends no notice');
 }finally{stop();db.close();}
});
