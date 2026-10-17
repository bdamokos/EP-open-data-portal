import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {outsideSpeech,outsideAgenda} from './outside-model.mjs';
import {recordOutside,outsideDirectory,initializeOutsideAgendaUpgrade} from './outside-store.mjs';
import {GROUP_VOICE_VERSION} from './group-voices-model.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/outside-agenda-conflict.json',import.meta.url),'utf8'));
function setup(t,count) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'outside-upgrade-'));
  let now=Date.parse('2026-10-17T12:00:00Z');const clock=()=>now;
  const store=new ActivityStore(directory,{clock}),records=new Map();
  store.acquire();const {generation}=store.beginCycle();
  store.putSource(generation,'outside:state','outside-state',{version:1},new Date(now).toISOString());
  store.db.prepare('INSERT INTO group_voice_state VALUES (?,?)').run(generation,GROUP_VOICE_VERSION);
  const day='2023-04-28';
  store.putSource(generation,'outside:roster:'+day,'outside-roster',{date:day,ids:[],sources:[]},new Date(now).toISOString());
  for(const row of fixture.agendas){const activity=JSON.parse(JSON.stringify(row.activity).replaceAll('2026-04-28',day).replaceAll('CRE-10-','CRE-9-'));store.putSource(generation,'outside:agenda:'+activity.activity_id,'outside-agenda',outsideAgenda(activity,row.retrievedAt,row.sourceUrl),row.retrievedAt);}
  for(let i=1;i<=count;i++) {
    const activity=JSON.parse(JSON.stringify(fixture.contributions[0].activity).replaceAll('2026-04-28',day).replaceAll('CRE-10-','CRE-9-'));
    activity.activity_id='MTG-PL-'+day+'-OTH-'+i;activity.id='eli/dl/event/'+activity.activity_id;
    activity.recorded_in_a_realization_of[0].identifier='CRE-9-'+day+'-OTH-'+i;
    records.set('/speeches/'+activity.activity_id,activity);
    const speech=outsideSpeech(activity,new Date(now).toISOString());
    speech.parentIds=speech.reportedParentIds;delete speech.reportedParentIds;delete speech.parentDocumentIds;delete speech.parentDocumentsComplete;
    store.putSource(generation,'/speeches/'+speech.id,'outside-speech',{id:speech.id,outside:speech},new Date(now).toISOString());
    recordOutside(store,generation,speech);
  }
  // A published index created by the old image has no upgrade requests yet.
  store.db.prepare('DELETE FROM tasks WHERE generation=?').run(generation);
  store.publish(generation);store.release();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return {store,generation,clock,advance:ms=>{now+=ms;},records};
}

test('450 historical verifications survive active-generation checkpoint capacity and show honest partial coverage',async t=>{
  const {store,generation,clock,records}=setup(t,450),calls=[];
  const worker=new ActivityWorker(store,{clock,budget:1,fetchRecord:async endpoint=>{
    calls.push(endpoint);assert(records.has(endpoint),'only the bounded legacy detail requests are allowed');
    return {fetchedAt:new Date(clock()).toISOString(),payload:{data:[records.get(endpoint)]}};
  }});
  await worker.run();
  assert.equal(calls.length,1);assert.equal(store.get('working'),null);
  const pending=store.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE generation=? AND done=-1 AND key LIKE 'outside:agenda-membership:%'").get(generation).n;
  assert.equal(pending,449);
  const coverage=outsideDirectory(store,{term:'all',language:'en'}).coverage;
  assert.equal(coverage.complete,false);assert.equal(coverage.pending,449);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM amendment_jobs').get().n,0);
  worker.budget=1000;await worker.run();
  assert.equal(calls.length,450);assert.equal(new Set(calls).size,450);
  assert.equal(outsideDirectory(store,{term:'all',language:'en'}).coverage.pending,0);
  assert.equal(outsideDirectory(store,{term:'all',language:'en'}).coverage.complete,true);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM outside_contributions WHERE json_array_length(body,'$.parentIds')<>1").get().n,0);
  assert.equal(worker.due(),false);
});

test('verification backoff survives active checkpoints and daily generation rollover',async t=>{
  const {store,generation,clock,records,advance}=setup(t,2);
  const worker=new ActivityWorker(store,{clock,budget:1,fetchRecord:async()=>{throw new Error('temporary verification failure');}});
  await worker.run();
  const task=store.db.prepare("SELECT * FROM tasks WHERE generation=? AND attempts=1 AND key LIKE 'outside:agenda-membership:%'").get(generation);
  assert(task.retry_at>clock());assert.equal(outsideDirectory(store,{term:'all',language:'en'}).coverage.complete,false);
  store.acquire();const next=store.beginCycle();initializeOutsideAgendaUpgrade(store,next.generation,new Date(clock()).toISOString());
  const copied=store.db.prepare('SELECT * FROM tasks WHERE generation=? AND key=?').get(next.generation,task.key);
  assert.equal(copied.retry_at,task.retry_at);assert.equal(copied.attempts,task.attempts);assert.equal(copied.error,task.error);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE generation=? AND key LIKE 'outside:agenda-membership:%'").get(next.generation).n,2);
  // Return to the accepted snapshot to exercise its delayed retry in isolation.
  store.set('working',null);store.release();advance(31_000);
  worker.budget=2;worker.fetchRecord=async endpoint=>({fetchedAt:new Date(clock()).toISOString(),payload:{data:[records.get(endpoint)]}});
  await worker.run();
  assert.equal(outsideDirectory(store,{term:'all',language:'en'}).coverage.pending,0);
  assert.equal(outsideDirectory(store,{term:'all',language:'en'}).coverage.complete,true);
});
