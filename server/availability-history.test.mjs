import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {CorpusStore} from './corpus-store.mjs';
import {ActivityWorker} from './activity-index-worker.mjs';
import {cataloguePage,observeCheck,observeSource,finishAvailabilityWrite,AVAILABILITY_HISTORY_LIMITS} from './availability-history.mjs';

const date='2026-10-20',at=date+'T12:00:00.000Z',url='https://data.europarl.europa.eu/api/v2/speeches';
function fixture(t,Type=ActivityStore){
  const dir=mkdtempSync(path.join(os.tmpdir(),'availability-history-'));let now=Date.parse(at);
  const store=new Type(dir,{clock:()=>now});
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  return {store,dir,advance:ms=>now+=ms};
}
const row=extra=>({sourceId:'MTG-PL-2026-10-20-OTH-1',family:'speeches',date,fetchedAt:at,url,acquisition:'incremental',...extra});

test('history is optional for readers and only the leased writer creates it',t=>{
  const {store,dir}=fixture(t);
  assert.equal(store.status().availabilityHistory.startedAt,null);
  assert.equal(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='source_observations'").get(),undefined);
  assert(store.acquire());
  const other=new ActivityStore(dir,{clock:store.clock});t.after(()=>other.close());
  assert.equal(other.acquire(),false);
  assert.throws(()=>other.transaction(()=>observeSource(other,row())),/lease/);
  assert.throws(()=>observeSource(store,row()),/commit with its source/);
});

test('text, exact variants and observation history commit or roll back together',t=>{
  const {store}=fixture(t,CorpusStore);store.acquire();
  const document={sourceId:'MTG-PL-2026-10-20-OTH-1',kind:'speech',date,term:10};
  const text={language:'en',sourceKey:'en',translationType:'original',sourceFormat:'xml-fragment',sourceUrl:url,fetchedAt:at,body:'Observed words',raw:null};
  store.db.exec("CREATE TRIGGER reject_test_text BEFORE INSERT ON texts BEGIN SELECT RAISE(ABORT,'rejected text'); END");
  assert.throws(()=>store.putDocument(document,[text]),/rejected text/);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM documents').get().n,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM source_observations').get().n,0);
  store.db.exec('DROP TRIGGER reject_test_text');
  store.putDocument(document,[text,{...text,sourceKey:'en-mtec',translationType:'machine'}],{acquisition:'incremental'});
  assert.deepEqual(store.db.prepare('SELECT variant,language,stage,acquisition FROM source_observations ORDER BY variant').all().map(r=>({...r})),[
    {variant:'en',language:'en',stage:'text',acquisition:'incremental'},
    {variant:'en-mtec',language:'en',stage:'text',acquisition:'incremental'}
  ]);
});

test('generation copies are not observations and cached retrieval time stays separate from local discovery',t=>{
  const {store,advance}=fixture(t);store.acquire();const first=store.beginCycle();store.setMembers([{id:'42',name:'Speaker'}]);
  const work={identifier:'E-10-2026-000001',document_date:date,work_type:'def/ep-document-types/QUESTION_WRITTEN'};
  store.putSource(first.generation,'/parliamentary-questions/'+work.identifier,'document',work,at,[],{acquisition:'backfill'});
  const before={...store.db.prepare('SELECT * FROM source_observations').get()};
  store.publish(first.generation);advance(86400_000);assert(store.acquire());
  const second=store.beginCycle();
  assert.deepEqual({...store.db.prepare('SELECT * FROM source_observations').get()},before);
  store.putSource(second.generation,'/parliamentary-questions/'+work.identifier,'document',work,at,[],{acquisition:'incremental'});
  const after=store.db.prepare('SELECT * FROM source_observations').get();
  assert.equal(after.first_observed_at,before.first_observed_at);assert.equal(after.first_source_at,at);
  assert.equal(after.last_source_at,at);assert.notEqual(after.last_observed_at,after.last_source_at);
  assert.equal(after.acquisition,'backfill');
});

test('completed enumeration records scope and retrieval bounds without clearing detail failures',t=>{
  const {store}=fixture(t);store.acquire();const {generation}=store.beginCycle();
  store.enqueue(generation,'detail','document',{endpoint:'/parliamentary-questions/E-10-2026-000001'},50);
  store.failTask(store.nextTask(generation),new Error('missing detail'));
  const body={};body.availabilityCheck=cataloguePage(body,{fetchedAt:at},{sourceKey:'questions',endpoint:'/parliamentary-questions',params:{offset:0,limit:250},acquisition:'recovery'});
  const check=cataloguePage(body,{fetchedAt:'2026-10-21T12:00:00Z'},{sourceKey:'questions',endpoint:'/parliamentary-questions',params:{offset:250,limit:250},acquisition:'incremental',complete:true});
  const revision=store.get('availabilityRevision');
  store.transaction(()=>observeCheck(store,check));
  const saved=store.db.prepare('SELECT * FROM source_checks').get();
  assert.equal(saved.pages,2);assert.deepEqual(JSON.parse(saved.scope).params,{});
  assert.equal(saved.first_source_at,at);assert.equal(saved.last_source_at,'2026-10-21T12:00:00.000Z');
  assert.equal(saved.acquisition,'recovery');assert(store.get('availabilityRevision')>revision);
  assert.equal(store.db.prepare("SELECT done,error FROM tasks WHERE key='detail'").get().done,0);
});

test('coverage-only task changes and bounded history pruning invalidate evidence',t=>{
  const {store,advance}=fixture(t);store.acquire();const {generation}=store.beginCycle();
  store.enqueue(generation,'check','catalog',{endpoint:'/parliamentary-questions'},50);
  let revision=store.get('availabilityCoverageRevision');store.finishTask(store.nextTask(generation));
  assert(store.get('availabilityCoverageRevision')>revision);
  store.transaction(()=>{observeSource(store,row());finishAvailabilityWrite(store);});
  advance((AVAILABILITY_HISTORY_LIMITS.days+1)*86400_000);store.acquire();
  revision=store.get('availabilityCoverageRevision');
  store.transaction(()=>finishAvailabilityWrite(store));
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM source_observations').get().n,0);
  assert(store.get('availabilityHistoryLimitedAt'));assert(store.get('availabilityCoverageRevision')>revision);
  assert.equal(store.status().availabilityHistory.basis,'first-retained-observation');
});

test('optional group ingestion retains the actual catalogue URL and acquisition mode atomically',t=>{
  const {store}=fixture(t);store.acquire();const {generation}=store.beginCycle();
  const worker=new ActivityWorker(store,{clock:store.clock});
  const sourceUrl=url+'?sitting-date=2026-10-20&offset=250';
  const activity={activity_id:'MTG-PL-2026-10-20-OTH-1',activity_date:date,had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:[{participation_role:'def/ep-roles/SPEAKER',had_participant_person:['person/42'],participation_in_name_of:['org/PPE']}]};
  const revision=store.get('availabilityRevision');
  worker.saveSpeech(generation,activity,at,false,sourceUrl,true,{acquisition:'recovery'});
  const observed=store.db.prepare('SELECT source_url,acquisition FROM source_observations').get();
  assert.equal(observed.source_url,sourceUrl);assert.equal(observed.acquisition,'recovery');
  assert(store.get('availabilityRevision')>revision);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM group_voice_observations').get().n,1);
});
