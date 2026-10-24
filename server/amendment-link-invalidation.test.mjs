import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {AMENDMENT_LINKS_VERSION} from './activity-index-model.mjs';
import {enqueueAmendment,amendmentLinkIndexVersion} from './amendments-store.mjs';
import {prepareIndexes} from './migrate-indexes.mjs';

const stamp='2026-10-24T09:00:00.000Z';
const checkpointKey='amendment:continuations';
function fixture(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'amendment-link-invalidation-'));
  const store=new ActivityStore(directory,{clock:()=>Date.parse(stamp)});
  assert(store.acquire());
  const {generation}=store.beginCycle();
  const worker=new ActivityWorker(store,{clock:store.clock,fetchRecord:async()=>{throw new Error('No source requests are needed.');}});
  t.after(()=>{worker.stop();store.close();rmSync(directory,{recursive:true,force:true});});
  const put=(key,kind,work)=>store.db.prepare('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,1)').run(generation,key,kind,JSON.stringify(work),stamp);
  store.transaction(()=>{
    for(let index=0;index<1776;index++)put('/plenary-documents/A-10-2026-'+String(index).padStart(4,'0'),'document',{
      identifier:'A-10-2026-'+String(index).padStart(4,'0'),work_type:'def/ep-document-types/'+['REPORT_PLENARY','RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT'][index%3],
      amendmentLinksVersion:AMENDMENT_LINKS_VERSION,inverse_foresees_change_of:[],title_dcterms:{en:'Retained report '+index},
    });
    put('unrelated','document',{work_type:'def/ep-document-types/AMENDMENT_LIST',amendmentLinksVersion:AMENDMENT_LINKS_VERSION});
    const insert=store.db.prepare('INSERT INTO amendment_jobs VALUES (?,?,?,?,?,0,0,?,NULL)');
    for(let index=0;index<200;index++)insert.run(generation,'blocked:'+index,'amendment-reparse',JSON.stringify({sourceKey:'retained',offset:index}),10,store.clock()+60_000);
    const tasks=Array.from({length:200},(_,index)=>({generation,key:'snapshot:'+index,kind:'amendment-reparse',body:JSON.stringify({sourceKey:'retained',offset:index+200}),priority:10,done:0,attempts:1,retry_at:store.clock()+60_000,error:'Retained retry'}));
    put(checkpointKey,'amendment-continuations',{tasks});
  });
  // Count UPDATE trigger executions, including updates whose JSON is unchanged.
  store.db.exec("CREATE TABLE document_writes (n INTEGER NOT NULL); INSERT INTO document_writes VALUES (0); CREATE TEMP TRIGGER count_document_writes AFTER UPDATE ON sources WHEN NEW.kind='document' BEGIN UPDATE document_writes SET n=n+1; END");
  const plans=[],prepare=store.db.prepare.bind(store.db);
  t.mock.method(store.db,'prepare',sql=>{
    if(sql.startsWith('UPDATE sources')&&sql.includes('json_remove'))plans.push(prepare('EXPLAIN QUERY PLAN '+sql).all(generation).map(row=>row.detail).join('; '));
    return prepare(sql);
  });
  return {store,worker,generation,plans,writes:()=>store.db.prepare('SELECT n FROM document_writes').get().n};
}
function assertIndexed(plans) {
  assert(plans.length>0);
  for(const plan of plans){assert.match(plan,/SEARCH sources USING INDEX amendment_link_invalidation \(generation=\?\)/);assert.doesNotMatch(plan,/SCAN sources/);}
}

test('repeated admission overflow invalidates 1776 documents once, without repeating projection writes',t=>{
  const {store,generation,writes,plans}=fixture(t);
  const reject=()=>assert.equal(enqueueAmendment(store,generation,'overflow','amendment-extract',{listId:'A-10-2026-0001-AM-1',targetDocumentId:'A-10-2026-0001'},112),false);
  reject();assert.equal(writes(),1776);
  const retained=store.db.prepare("SELECT key,body,fetched_at FROM sources WHERE kind='document' ORDER BY key").all();
  for(let repeat=0;repeat<10;repeat++)reject();
  assert.equal(writes(),1776,'Already absent markers must not fire document projection triggers again.');
  assert.deepEqual(store.db.prepare("SELECT key,body,fetched_at FROM sources WHERE kind='document' ORDER BY key").all(),retained);
  assert.equal(store.source(generation,'unrelated').work.amendmentLinksVersion,AMENDMENT_LINKS_VERSION);
  assert.equal(store.source(generation,checkpointKey).work.capacityGap.count,11);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs').get().n,200);
  // A genuinely refreshed marker still needs invalidation while overflow remains.
  store.db.prepare("UPDATE sources SET body=json_set(body,'$.amendmentLinksVersion',?) WHERE generation=? AND key=?").run(AMENDMENT_LINKS_VERSION,generation,'/plenary-documents/A-10-2026-0001');
  const before=writes();reject();assert.equal(writes()-before,1);
  assertIndexed(plans);
});

test('repeated checkpoint overflow skips absent markers while preserving retained task cursors',t=>{
  const {store,worker,generation,writes,plans}=fixture(t);
  const queue=()=>{
    for(let index=0;index<401;index++)store.enqueue(generation,'discovery:'+index,'document',{endpoint:'/plenary-documents/A-10-2026-'+index},50);
    worker.checkpointContinuations(generation);
  };
  queue();assert.equal(writes(),1776);
  const saved=store.source(generation,checkpointKey).work;
  assert.equal(saved.tasks.length,200);assert.equal(saved.discovery.length,200);assert(saved.capacityGap.count>0);
  queue();assert.equal(writes(),1776,'A repeated capacity checkpoint must not rewrite unchanged document bodies.');
  assert.deepEqual(store.source(generation,checkpointKey).work.tasks,saved.tasks);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs').get().n,200);
  assertIndexed(plans);
});

test('link index preparation fences a live writer, preserves retained state and runs only once',t=>{
  const {store}=fixture(t),directory=path.dirname(store.filename);
  const snapshot=()=>['sources','tasks','amendment_jobs','amendments','amendment_targets'].map(table=>store.db.prepare('SELECT * FROM '+table+' ORDER BY generation').all());
  const before=snapshot(),working=store.get('working');
  store.db.exec('DROP INDEX amendment_link_invalidation');store.set('amendmentLinkIndexVersion',null);
  assert.throws(()=>new ActivityStore(directory,{clock:store.clock}),/migrate-indexes/);
  assert.throws(()=>prepareIndexes({activityDirectory:directory,clock:store.clock,log:()=>{}}),/writer lease is active/);
  store.release();
  const logs=[],prepare=()=>prepareIndexes({activityDirectory:directory,clock:store.clock,log:(...parts)=>logs.push(parts.join(' '))});
  assert.equal(prepare()[0].noop,false);
  assert(logs.some(line=>line.includes('CREATE INDEX IF NOT EXISTS amendment_link_invalidation')));
  assert.equal(store.get('amendmentLinkIndexVersion'),amendmentLinkIndexVersion);
  assert.deepEqual(snapshot(),before);assert.deepEqual(store.get('working'),working);
  const reopened=new ActivityStore(directory,{clock:store.clock});reopened.close();
  logs.length=0;assert.equal(prepare()[0].noop,true);
  assert(!logs.some(line=>line.includes('CREATE INDEX')));
});
