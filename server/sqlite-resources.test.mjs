import {bootstrapAmendmentDependencies} from './amendments-store.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {CorpusWorker} from './corpus-worker.mjs';
import {GROUP_VOICE_VERSION} from './group-voices-model.mjs';
import {INTERVENTION_CLASSIFICATION_VERSION} from './speech-interventions.mjs';
import {observeSqlite,loopTimer} from './sqlite-observability.mjs';
import {AMENDMENT_EXTRACTION_VERSION} from './amendment-documents.mjs';
import {AMENDMENT_DISTRIBUTION_PROOF_VERSION} from './amendments.mjs';
import {amendmentsPage} from './amendments-store.mjs';
import {prepareIndexes} from './migrate-indexes.mjs';

const instant=()=>Date.parse('2026-10-19T09:00:00Z');
function fixture(t,Store) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'sqlite-resources-'));
  const store=new Store(directory,{clock:instant});store.acquire();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return store;
}
function plans(t,store) {
  const records=[],prepare=store.db.prepare.bind(store.db);
  t.mock.method(store.db,'prepare',sql=>{
    const statement=prepare(sql);
    if(/^SELECT/.test(sql))for(const method of ['get','all','iterate']) {
      const execute=statement[method].bind(statement);
      statement[method]=(...args)=>{records.push({sql,plan:prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail).join('; ')});return execute(...args);};
    }
    return statement;
  });
  return records;
}
test('pending selection seeks due retries, preserves priority ties and avoids completed task bodies',t=>{
  const store=fixture(t,ActivityStore),records=plans(t,store);
  store.enqueue(1,'complete','document',{padding:'x'.repeat(10000)},999);
  store.finishTask(store.nextTask(1));
  store.enqueue(1,'future','document',{},999);
  store.db.prepare('UPDATE tasks SET retry_at=? WHERE key=?').run(instant()+10000,'future');
  store.enqueue(1,'a','document',{},20);store.enqueue(1,'b','document',{},20);
  store.enqueue(1,'outside','outside-detail',{},10);store.enqueue(1,'motion','motion-outcomes',{},5);
  for(const key of ['b','a','outside','motion']) {const task=store.nextTask(1);assert.equal(task.key,key);store.finishTask(task);}
  assert.equal(store.nextTask(1),undefined);
  for(const record of records.filter(r=>r.sql.includes('retry_at<=?'))) {
    assert.match(record.plan,/task_pending_(order|due)/);assert.doesNotMatch(record.plan,/TEMP B-TREE/);
  }
  store.taskCounts(1);
  assert.match(records.find(r=>r.sql.includes('SUM(CASE')).plan,/COVERING INDEX task_counts/);
});
test('corpus queue uses separate due and priority indexes with deterministic ties',t=>{
  const store=fixture(t,CorpusStore),records=plans(t,store);
  for(const key of ['a','b'])store.enqueue(key,'speech',{},1);
  assert.equal(store.nextTask().key,'b');store.finishTask(store.nextTask());
  assert.equal(store.nextTask().key,'a');store.failTask(store.nextTask(),new Error('later'));
  assert.equal(store.nextTask(),undefined);
  for(const record of records.filter(r=>r.sql.includes('retry_at<=?'))) {
    assert.match(record.plan,/task_pending_(order|due)/);assert.doesNotMatch(record.plan,/TEMP B-TREE/);
  }
});
for(const Store of [ActivityStore,CorpusStore])test(Store.name+' initialization survives a build longer than the lease TTL',t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'sqlite-slow-build-'));let now=instant();
  const store=new Store(directory,{clock:()=>now}),exec=store.db.exec.bind(store.db);let advanced=false;
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  t.mock.method(store.db,'exec',sql=>{const result=exec(sql);if(!advanced&&sql.startsWith('CREATE INDEX')){now+=31*60_000;advanced=true;}return result;});
  assert(store.acquire());assert(advanced);assert.doesNotThrow(()=>store.assertWriter());
  assert.equal(store.get('resourceIndexes'),1);
});
test('report relationships track exact references through replacements, deletes and generation copy',t=>{
  const store=fixture(t,ActivityStore),records=plans(t,store);
  const report=refs=>({work_type:'x/REPORT_PLENARY',inverse_created_a_realization_of:refs});
  store.putSource(1,'report','document',report(['eli/dl/proc/2026-0001',{id:'https://data.europarl.europa.eu/eli/dl/proc/2026-0002'}]),'2026-10-19');
  assert.equal([...store.reportsForProcedure(1,'2026-0001')].length,1);
  assert.equal([...store.reportsForProcedure(1,'2026-0002')].length,1);
  store.putSource(1,'report','document',report(['http://data.europarl.europa.eu/eli/dl/proc/2026-0003']),'2026-10-19');
  assert.equal([...store.reportsForProcedure(1,'2026-0001')].length,0);
  store.db.prepare('INSERT INTO sources SELECT 2,key,kind,body,fetched_at,seen FROM sources WHERE generation=1').run();
  assert.equal([...store.reportsForProcedure(2,'2026-0003')].length,1);
  store.db.prepare('DELETE FROM sources WHERE generation=1').run();
  assert.equal([...store.reportsForProcedure(1,'2026-0003')].length,0);
  for(const record of records.filter(r=>r.sql.includes('FROM report_procedures'))) {
    assert.match(record.plan,/SEARCH link USING COVERING INDEX/);assert.doesNotMatch(record.plan,/SCAN source/);
  }
});
test('idle workers and deferred retries do not acquire leases, discover or compute status',async t=>{
  const store=fixture(t,ActivityStore);
  store.set('active',1);store.set('lastSuccess',new Date(instant()).toISOString());
  store.db.prepare('INSERT INTO group_voice_state VALUES (?,?)').run(1,GROUP_VOICE_VERSION);
  // A retained generation is idle only after its local projection fill finishes.
  while(store.backfillFastReads(1)){}
  while(!bootstrapAmendmentDependencies(store,1)){}
  store.release();
  const activityWorker=new ActivityWorker(store,{clock:instant});
  assert.equal(activityWorker.questionFileGenerations().length,1);
  await activityWorker.run();
  assert.equal(activityWorker.questionFileGenerations().length,0);
  assert.equal(activityWorker.requests,0);
  t.mock.method(store,'status',()=>assert.fail('idle status aggregate'));
  t.mock.method(store,'acquire',()=>assert.fail('idle writer lease'));
  await new ActivityWorker(store,{clock:instant}).run();
  const corpus=fixture(t,CorpusStore);
  corpus.set('speechLanguages','all');corpus.set('speechInterventionClassificationVersion',INTERVENTION_CLASSIFICATION_VERSION);
  corpus.set('discoveryCheckedAt',instant());
  corpus.enqueue('deferred','speech',{},1);corpus.failTask(corpus.task('deferred'),new Error('later'));corpus.release();
  const worker=new CorpusWorker(corpus,{clock:instant});
  t.mock.method(corpus,'acquire',()=>assert.fail('idle corpus lease'));
  t.mock.method(worker,'discover',()=>assert.fail('idle discover'));
  await worker.run();
});
test('due checks find ready continuations in the working generation while direct tasks wait',t=>{
  const store=fixture(t,ActivityStore);
  store.set('active',1);store.set('lastSuccess',new Date(instant()).toISOString());
  store.set('working',{generation:2,initialized:true,reportJoinsReady:true,procedureTitlesQueued:true,motionOutcomesDay:'2026-10-19',startedAt:new Date(instant()).toISOString()});
  store.db.prepare('INSERT INTO group_voice_state VALUES (?,?)').run(2,GROUP_VOICE_VERSION);
  store.enqueue(2,'deferred','document',{},1);store.failTask(store.nextTask(2),new Error('later'));
  store.putSource(2,'amendment:continuations','amendment-continuations',{discovery:[{key:'ready',kind:'document',endpoint:'/plenary-documents/A-10-2026-0001',priority:100}]},'2026-10-19');
  const worker=new ActivityWorker(store,{clock:instant});
  assert.equal(worker.due(),true);worker.checkpointContinuations(2,{includeCore:false});
  assert.equal(store.db.prepare('SELECT key FROM amendment_jobs WHERE generation=2 AND key=?').get('ready').key,'ready');
});
test('amendment reads report initialization until the writer publishes the proof projection',t=>{
  const store=fixture(t,ActivityStore);
  store.set('amendmentReadVersion',null);store.release();
  assert.throws(()=>new ActivityStore(path.dirname(store.filename),{clock:instant}),/migrate-indexes/);
  const other=new ActivityStore(path.dirname(store.filename),{clock:instant,initializeIndexes:true});
  t.after(()=>other.close());assert(other.acquire());
  store.set('amendmentReadVersion',null);
  assert.equal(store.acquire(),false);
  assert.throws(()=>amendmentsPage(store),error=>error.status===503&&error.code==='activity_index_initializing');
  other.release();assert(store.acquire());assert.equal(amendmentsPage(store).total,0);
});
test('offline preparation refuses a live writer, prepares before serving and becomes a no-op',t=>{
  const store=fixture(t,ActivityStore),directory=path.dirname(store.filename),logs=[];
  store.set('resourceIndexes',null);store.db.exec('DROP INDEX source_identifier');
  assert.throws(()=>new ActivityStore(directory,{clock:instant}),/migrate-indexes/);
  assert.throws(()=>prepareIndexes({activityDirectory:directory,clock:instant,log:(...parts)=>logs.push(parts)}),/writer lease is active/);
  assert.equal(store.get('resourceIndexes'),null);store.release();
  const first=prepareIndexes({activityDirectory:directory,clock:instant,log:(...parts)=>logs.push(parts)});
  assert.equal(first[0].noop,false);assert(logs.some(parts=>parts.join(' ').includes('CREATE INDEX')));
  const ready=new ActivityStore(directory,{clock:instant});ready.close();logs.length=0;
  const second=prepareIndexes({activityDirectory:directory,clock:instant,log:(...parts)=>logs.push(parts)});
  assert.equal(second[0].noop,true);assert(!logs.some(parts=>parts.join(' ').includes('CREATE INDEX')));
});
test('corpus initialization checkpoints only main with the activity database attached read-only',t=>{
  const index=fixture(t,ActivityStore),directory=mkdtempSync(path.join(os.tmpdir(),'corpus-attached-index-'));
  const store=new CorpusStore(directory,{clock:instant,indexFile:index.filename});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  assert(store.acquire());assert.equal(store.get('resourceIndexes'),1);assert(store.indexAttached);
});
test('amendment proof flags follow direct writes, replacements and deletions without weakening stale guards',t=>{
  const store=fixture(t,ActivityStore),put=store.db.prepare('INSERT OR REPLACE INTO amendments VALUES (?,?,?,?,?,?)');
  const flags=()=>store.db.prepare('SELECT target,wording,proposer,freshness FROM amendment_read_flags WHERE generation=1 AND id=?').get('am');
  put.run(1,'am','A-10-2026-0001','2026-10-01','unknown',JSON.stringify({originalText:'old',authors:[{personId:'42'}]}));
  assert.deepEqual({...flags()},{target:'A-10-2026-0001',wording:1,proposer:1,freshness:1});
  put.run(1,'am','B-10-2026-0002','2026-10-01','unknown',JSON.stringify({originalText:'current',textParserVersion:AMENDMENT_EXTRACTION_VERSION,
    sourceFreshness:{version:AMENDMENT_DISTRIBUTION_PROOF_VERSION,status:'fresh'}}));
  assert.deepEqual({...flags()},{target:'B-10-2026-0002',wording:0,proposer:0,freshness:0});
  store.db.prepare('DELETE FROM amendments WHERE generation=1 AND id=?').run('am');assert.equal(flags(),undefined);
});
test('corpus completion settles when the last task exactly consumes the run budget',async t=>{
  const store=fixture(t,CorpusStore);
  store.set('speechLanguages','all');store.set('speechInterventionClassificationVersion',INTERVENTION_CLASSIFICATION_VERSION);
  store.set('discoveryCheckedAt',instant());store.set('discoveredPublished',true);
  store.enqueue('last','speech',{},1);store.release();
  const worker=new CorpusWorker(store,{clock:instant,budget:1});
  t.mock.method(worker,'task',async task=>store.finishTask(task));
  await worker.run();
  assert.equal(store.get('phase'),'ready');assert.equal(store.get('backfilledAt'),new Date(instant()).toISOString());
  t.mock.method(store,'acquire',()=>assert.fail('settled idle lease'));await worker.run();
});
test('SQLite memory limits and slow logs exclude bindings and caller time between rows',()=>{
  const logs=[];let tick=0,step=0;
  const db=observeSqlite(new DatabaseSync(':memory:'),'test',{enabled:true,threshold:250,now:()=>{const value=tick;tick+=step;return value;},log:(...parts)=>logs.push(parts)});
  assert.equal(db.prepare('PRAGMA cache_size').get().cache_size,-2048);
  assert.equal(db.prepare('PRAGMA temp_store').get().temp_store,1);
  const get=db.prepare('SELECT ? value');
  get.get('binding-secret');assert.equal(logs.length,0);
  step=251;get.get('binding-secret');step=0;
  assert.equal(logs.length,1);assert.equal(logs[0][0],'[sqlite-slow]');assert.equal(JSON.stringify(logs).includes('binding-secret'),false);logs.length=0;
  const rows=db.prepare('SELECT 1 UNION ALL SELECT 2');
  for(const row of rows.iterate()){assert(row);tick+=1000;}
  assert.equal(logs.length,0);
  const finish=loopTimer('test',{now:()=>tick,log:(...parts)=>logs.push(parts)});tick+=251;finish();
  assert.equal(logs.length,1);assert.equal(logs[0][0],'[background-slow]');
  db.close();
});
