import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {MOTION_CLASSIFICATION_VERSION} from './activity-index-model.mjs';

const at='2026-11-02T02:00:00Z';
function fixture(t) {
  const directory=mkdtempSync(path.join(tmpdir(),'motion-pending-')),store=new ActivityStore(directory,{clock:()=>Date.parse(at)});
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});assert(store.acquire());
  const put=(generation,id,version,type='def/ep-document-types/RESOLUTION_MOTION')=>store.db.prepare("INSERT OR REPLACE INTO sources VALUES (?,?,'document',?,?,1)").run(generation,'/plenary-documents/'+id,JSON.stringify({identifier:id,work_type:type,...(version?{motionClassificationVersion:version}:{})}),at);
  // Counts statements that read document rows, whichever table answers.
  const statements=[],prepare=store.db.prepare.bind(store.db);
  store.db.prepare=sql=>{if(/motionClassificationVersion/.test(sql))statements.push(sql);return prepare(sql);};
  return {store,put,statements};
}

test('a clean generation is only scanned once, and through the projection once it is ready',t=>{
  const {store,put,statements}=fixture(t);
  put(1,'B-10-2026-0001',MOTION_CLASSIFICATION_VERSION);put(1,'A-10-2026-0002',undefined,'def/ep-document-types/REPORT_PLENARY');
  assert.equal(store.motionClassificationPending(1),false);
  assert.match(statements[0],/FROM sources/);
  assert.equal(store.motionClassificationPending(1),false);assert.equal(statements.length,1);
  store.motionsClassified=undefined;
  while(store.backfillFastReads(1)){/* ready */}
  assert.equal(store.motionClassificationPending(1),false);
  assert.match(statements.at(-1),/source_reads INDEXED BY read_motion_documents/);
});

test('an unclassified motion stays pending in both tables until it is reclassified',t=>{
  const {store,put,statements}=fixture(t);
  put(1,'B-10-2026-0001');put(1,'B-10-2026-0002',MOTION_CLASSIFICATION_VERSION);
  assert.equal(store.motionClassificationPending(1),true);
  while(store.backfillFastReads(1)){/* ready */}
  assert.equal(store.motionClassificationPending(1),true);
  assert.equal(store.motionClassificationPending(1),true,'pending is never remembered');
  store.set('working',{generation:1});
  assert.equal(store.reclassifyMotions(1),false);
  const scans=statements.length;
  assert.equal(store.reclassifyMotions(1),false);assert.equal(statements.length,scans,'a clean generation costs no further scan');
  assert.equal(store.motionClassificationPending(2),false,'another generation is checked separately');
});

test('startup repairs are checked until clean, then leave the tick alone',t=>{
  const {store}=fixture(t);
  const worker=new ActivityWorker(store,{clock:()=>Date.parse(at),fetchRecord:()=>{throw new Error('No network expected');}});
  store.set('active',1);store.set('lastSuccess',at);
  worker.repairOnStartup=true;
  assert.equal(worker.startupRepairDue(),true);assert.equal(worker.repairOnStartup,true,'still due, so still checked');
  store.set('groupHistoryRepairVersion',1);store.set('adoptedTextDiscovery',{version:1,throughYear:2026});
  assert.equal(worker.startupRepairDue(),false);assert.equal(worker.repairOnStartup,false);
  const statements=[],prepare=store.db.prepare.bind(store.db);
  store.db.prepare=sql=>{statements.push(sql);return prepare(sql);};
  assert.equal(worker.startupRepairDue(),false);assert.equal(worker.coreDue(),false);
  assert.ok(statements.every(sql=>!/adopted-texts/.test(sql)),'no adopted-text scan once clean');
});
