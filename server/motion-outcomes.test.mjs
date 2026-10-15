import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityStore } from './activity-index-store.mjs';
import { ActivityWorker } from './activity-index-worker.mjs';
import { documentRows, projectDocument } from './activity-index-model.mjs';
import { motionOutcome, motionReference, motionSittings, motionSourceKey, motionVoteCoverage } from './motion-outcomes.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/motion-outcomes-live-20261015.json',import.meta.url),'utf8'));
const clock=()=>Date.parse('2026-10-15T12:00:00Z');
const fetchedAt=new Date(clock()).toISOString();
const work=id=>structuredClone(fixture.documents.find(document=>document.work.identifier===id).work);
const votes=()=>structuredClone(fixture.votes);
const resolve=(id,source=votes(),document=work(id))=>motionOutcome(document,fixture.retrievedAt,()=>source && {work:source,fetchedAt:fixture.retrievedAt});
function storeTest(t) {
  const directory=mkdtempSync(path.join(os.tmpdir(),'motion-outcomes-test-'));
  const store=new ActivityStore(directory,{clock});store.acquire();
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return store;
}
function seed(store) {
  const cycle=store.beginCycle();
  store.setMembers([{id:'257043',name:'Test member'}]);
  for(const {endpoint,work} of fixture.documents)store.putSource(cycle.generation,endpoint,'document',work,fixture.retrievedAt,documentRows(work,endpoint,fixture.retrievedAt).rows);
  return cycle;
}
const rawResults=()=>fixture.votes.results.map(result=>({...result,had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',inverse_consists_of:[{id:'eli/dl/event/'+fixture.sittingId,consists_of:result.sittingResultIds}]}));
const rawDecisions=()=>fixture.votes.decisions.map(decision=>({...decision,had_activity_type:'def/ep-activities/PLENARY_OUTCOME'}));

test('real original and joint motions have different outcomes within the same vote topic',()=>{
  const original=resolve('B-10-2026-0441'), joint=resolve('RC-10-2026-0441');
  assert.equal(original.status,'lapsed');assert.equal(original.decisionId,'MTG-PL-2026-10-08-DEC-197932');
  assert.equal(original.totals,null);
  assert.equal(joint.status,'adopted');assert.equal(joint.decisionId,'MTG-PL-2026-10-08-DEC-198216');
  assert.deepEqual(joint.totals,{for:482,against:41,abstaining:39});
  assert.equal(joint.date,'2026-10-08');assert.equal(joint.sources.at(-1).language,'en');
  assert.deepEqual(motionVoteCoverage(fixture.votes.results,fixture.votes.decisions),{missingResultIds:[],missingDecisionIds:[]});
});
test('a whole-motion show-of-hands decision is available without numerical totals or a roll call',()=>{
  const outcome=resolve('B-10-2026-0423');
  assert.equal(outcome.status,'adopted');assert.equal(outcome.method,'VOTE_HAND');assert.equal(outcome.totals,null);
  assert.equal(outcome.decisionId,'MTG-PL-2026-10-08-DEC-197660');
});
test('missing, ambiguous and incomplete evidence never becomes a rejected or pending motion',()=>{
  assert.equal(resolve('B-10-2026-0441',null).status,'unavailable');
  const missing=votes();missing.decisions=missing.decisions.filter(decision=>!decision.id.endsWith('DEC-197932'));
  assert.deepEqual(resolve('B-10-2026-0441',missing),{status:'unavailable',reason:'incomplete-source'});
  const ambiguous=votes(), final=ambiguous.decisions.find(decision=>decision.id.endsWith('DEC-197660'));
  const duplicate={...final,id:final.id+'-SECOND',decision_outcome:'def/ep-statuses/REJECTED'};
  ambiguous.decisions.push(duplicate);ambiguous.results.find(result=>result.id===final.inverse_consists_of[0]).consists_of.push(duplicate.id);
  assert.deepEqual(resolve('B-10-2026-0423',ambiguous),{status:'unavailable',reason:'ambiguous-decisions'});
});
test('a missing declared vote result or a later linked sitting prevents reusing an earlier outcome',()=>{
  const partial=votes();partial.results=partial.results.filter(result=>!result.id.endsWith('VOT-ITM-993191'));
  assert.equal(resolve('RC-10-2026-0441',partial).reason,'incomplete-source');
  const document=work('RC-10-2026-0441');document.inverse_based_on_a_realization_of.push('eli/dl/event/MTG-PL-2026-10-09-VOT-ITM-123');
  assert.equal(resolve('RC-10-2026-0441',votes(),document).reason,'incomplete-source');
});
test('amendments, similar titles, another document and an unlinked decision cannot supply the outcome',()=>{
  for(const change of [
    decision=>{decision.referenceText.en='Amendment 1';},
    decision=>{decision.headingLabel.en='A similar motion title';decision.activity_label.en='A similar motion title';},
    decision=>{decision.headingLabel.en='Motion for a resolution B10-9999/2026';},
    decision=>{decision.inverse_consists_of=['eli/dl/event/unrelated'];},
  ]) {
    const sample=votes();change(sample.decisions.find(decision=>decision.id.endsWith('DEC-197660')));
    assert.equal(resolve('B-10-2026-0423',sample).status,'unavailable');
  }
  const unrelated=work('B-10-2026-0423');unrelated.inverse_based_on_a_realization_of=['https://example.com/eli/dl/event/'+fixture.sittingId+'-VOT-ITM-993175'];
  assert.equal(resolve('B-10-2026-0423',votes(),unrelated).status,'unavailable');
});
test('rejected and withdrawn whole-motion outcomes use the explicit status, and missing counts remain null',()=>{
  for(const [status,expected] of [['REJECTED','rejected'],['WITHDRAWN','withdrawn']]) {
    const sample=votes();const decision=sample.decisions.find(decision=>decision.id.endsWith('DEC-198216'));
    decision.decision_outcome='def/ep-statuses/'+status;decision.number_of_votes_abstention=null;
    const outcome=resolve('RC-10-2026-0441',sample);
    assert.equal(outcome.status,expected);assert.equal(outcome.totals.abstaining,null);
  }
});
test('document projections preserve exact links and distinguish B and RC references',()=>{
  const document=projectDocument(work('RC-10-2026-0441'));
  assert.equal(document.motionLinksVersion,1);assert(document.is_derivative_of.includes('eli/dl/doc/B-10-2026-0441'));
  assert.deepEqual(motionSittings(document),[fixture.sittingId]);
  assert.equal(motionReference(document.identifier),'RC-B10-0441/2026');assert.equal(motionReference('B-10-2026-0441'),'B10-0441/2026');
});
test('saved activity pages enrich original and joint records, including a pinned selection, without upstream requests',t=>{
  const store=storeTest(t),cycle=seed(store);
  store.putSource(cycle.generation,motionSourceKey(fixture.sittingId),'motion-outcomes',fixture.votes,fixture.retrievedAt);
  const originalRows=store.db.prepare('SELECT mep FROM items WHERE source_id=?').all('B-10-2026-0441');
  const person=originalRows[0].mep;store.setMembers([{id:person,name:'Source author'}]);
  const page=store.page(person,{sourceId:'B-10-2026-0441',limit:1});
  const original=page.selectedItems.find(item=>item.sourceId==='B-10-2026-0441');
  assert.equal(original.resolutionOutcome.status,'lapsed');assert.equal(original.date,'2026-10-05');
  assert.equal(original.relatedJointMotions[0].sourceId,'RC-10-2026-0441');assert.equal(original.relatedJointMotions[0].outcome.status,'adopted');
  assert.match(original.relatedJointMotions[0].url,/^https:\/\/data\.europarl\.europa\.eu\/distribution\//);
  assert.equal(page.cache.complete,false);
});
test('both filtered motion categories retain the outcome badge data',t=>{
  const store=storeTest(t),cycle=store.beginCycle();
  const document=work('B-10-2026-0423'),person=document.workHadParticipation[0].had_participant_person[0].split('/').at(-1);
  store.setMembers([{id:person,name:'Source author'}]);
  store.putSource(cycle.generation,motionSourceKey(fixture.sittingId),'motion-outcomes',fixture.votes,fixture.retrievedAt);
  for(const [rule,category] of [['A149','individual-motions'],['A114','motions']]) {
    document.based_on=['eli/dl/doc/RULES-10-2026-05-18-ITM-'+rule];
    const endpoint='/plenary-documents/'+document.identifier;
    store.putSource(cycle.generation,endpoint,'document',document,fixture.retrievedAt,documentRows(document,endpoint,fixture.retrievedAt).rows);
    const page=store.page(person,{category});assert.equal(page.items.length,1);assert.equal(page.items[0].resolutionOutcome.status,'adopted');
  }
});
test('one sitting task serves all authors and methods, with one request per resumable stage',async t=>{
  const store=storeTest(t),cycle=seed(store),calls=[];
  const worker=new ActivityWorker(store,{clock,fetchRecord:async(endpoint,params)=>{
    calls.push({endpoint,params});assert(!('vote-method' in params));
    if(endpoint.endsWith('/decisions'))assert.equal(params['filter-output'],'voters');
    return {payload:{data:endpoint.endsWith('/vote-results')?rawResults():rawDecisions()},fetchedAt};
  }});
  for(const document of fixture.documents)worker.scheduleMotionOutcomes(cycle.generation,document.work);
  assert.equal(store.taskCounts(cycle.generation).total,1);
  await worker.task(store.nextTask(cycle.generation));assert.equal(calls.length,1);assert.equal(store.taskCounts(cycle.generation).completed,0);
  await worker.task(store.nextTask(cycle.generation));assert.equal(calls.length,2);assert.equal(store.taskCounts(cycle.generation).completed,1);
  const saved=store.source(cycle.generation,motionSourceKey(fixture.sittingId));
  assert.equal(saved.work.decisions.length,260);assert.equal(saved.work.truncated,false);
  assert.equal(resolve('B-10-2026-0423',saved.work).status,'adopted');
  worker.scheduleMotionOutcomes(cycle.generation,work('B-10-2026-0423'));assert.equal(store.taskCounts(cycle.generation).total,1);
});
test('partial/repeated decision pages stop safely and report gaps rather than fabricate a final result',async t=>{
  const store=storeTest(t),cycle=seed(store);
  const worker=new ActivityWorker(store,{clock,fetchRecord:async endpoint=>({payload:{data:endpoint.endsWith('/vote-results')?rawResults():rawDecisions().filter(decision=>!decision.id.endsWith('DEC-197660'))},fetchedAt})});
  worker.scheduleMotionOutcomes(cycle.generation,work('B-10-2026-0423'));
  for(let i=0;i<3;i++)await worker.task(store.nextTask(cycle.generation));
  assert.equal(store.taskCounts(cycle.generation).completed,1);
  const saved=store.source(cycle.generation,motionSourceKey(fixture.sittingId));assert.equal(saved.work.truncated,true);
  assert.equal(resolve('B-10-2026-0423',saved.work).reason,'incomplete-source');
});
test('upgrades enqueue retained motions without resetting a partial generation or touching another writer',t=>{
  const store=storeTest(t),cycle=seed(store);
  const document=work('B-10-2026-0441');delete document.motionLinksVersion;delete document.inverse_based_on_a_realization_of;
  store.putSource(cycle.generation,'/plenary-documents/'+document.identifier,'document',document,fixture.retrievedAt);
  store.enqueue(cycle.generation,'/plenary-documents/'+document.identifier,'document',{endpoint:'/plenary-documents/'+document.identifier});
  store.finishTask(store.nextTask(cycle.generation));
  const worker=new ActivityWorker(store,{clock});worker.prepareMotionOutcomes(cycle.generation);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind='document'").get().n,1);
  assert.equal(store.db.prepare("SELECT done FROM tasks WHERE kind='document'").get().done,0);
  assert.equal(store.get('working').generation,cycle.generation);
  store.release();assert.throws(()=>worker.prepareMotionOutcomes(cycle.generation),/lease/);
});
test('failed refreshes leave the published outcome and activity generation readable',async t=>{
  const store=storeTest(t),cycle=seed(store);
  store.putSource(cycle.generation,motionSourceKey(fixture.sittingId),'motion-outcomes',fixture.votes,'2026-10-01');store.publish(cycle.generation);
  const refresh=store.beginCycle(),worker=new ActivityWorker(store,{clock,fetchRecord:async()=>{throw new Error('Temporary upstream failure');}});
  worker.scheduleMotionOutcomes(refresh.generation,work('B-10-2026-0423'));
  const task=store.nextTask(refresh.generation);await assert.rejects(worker.task(task),/Temporary/);store.failTask(task,new Error('Temporary upstream failure'));
  assert.equal(store.status().servingGeneration,cycle.generation);
  assert.equal(resolve('RC-10-2026-0441',store.source(cycle.generation,motionSourceKey(fixture.sittingId)).work).status,'adopted');
  assert.equal(store.taskCounts(refresh.generation).retrying,1);
});
