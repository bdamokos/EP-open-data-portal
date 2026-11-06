import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {procedureSteps} from './procedure-steps.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/reader-first-helpers.json',import.meta.url))).procedures;
const step=(result,key)=>result.steps.find(step=>step.key===key);
const event=(code,date,status='recorded')=>({types:[{code}],date,status});
const run=cellarEvents=>procedureSteps({reference:'2025/0001(COD)',cellarEvents,asOf:'2026-11-06'});

test('held Erasmus+ index and Cellar agree on position for talks, with OEIL proposal date',()=>{
  const result=procedureSteps(fixtures[0]);
  assert.equal(result.family,'COD');assert.equal(result.stage,'position-talks');
  assert.equal(step(result,'proposal').date,'2025-07-16');
  assert.equal(step(result,'committee').date,'2026-09-29');
  assert.equal(step(result,'parliament').date,'2026-10-22');
  assert.equal(step(result,'talks').state,'current');assert.equal(result.steps.length,9);
  const indexOnly=procedureSteps({...fixtures[0],cellarEvents:[],summaries:[]});
  assert.equal(indexOnly.stage,'position-talks');assert.equal(step(indexOnly,'parliament').state,'done');
});
test('held fisheries ignores all three cancelled Council rows and keeps recorded partial approach',()=>{
  const input=fixtures[1],result=procedureSteps(input);
  assert.equal(result.stage,'drafting');assert.equal(step(result,'committee').state,'current');assert.equal(step(result,'talks').state,'open');assert.deepEqual(step(result,'council'),{key:'council',state:'done',date:'2026-09-29',partial:true});
  for(const asOf of ['2026-06-22','2026-06-30','2026-09-28'])assert.notEqual(step(procedureSteps({...input,asOf}),'council').state,'done');
});
test('unknown codes never move steps; latest is original eligible row; future and cancelled ignored',()=>{
  const unknown=event('NOT_A_MILESTONE','2026-02-01');
  const result=run([unknown,event('PUB_OJ','2027-01-01'),event('SIGN_byEP_CONSIL','2026-03-01','cancelled')]);
  assert.equal(result.stage,'unknown');assert.equal(result.latest,unknown);assert.equal(step(result,'proposal').state,'current');
  assert.equal(result.steps.filter(s=>s.state==='done').length,0);
});
test('final requires an EP position after a deal, and journal drops skipped steps',()=>{
  assert.equal(step(run([event('ADP_R1_POS_byEP','2026-01-01'),event('ENDORSE_AGRPROV_COREPER_byCONSIL','2026-02-01')]),'final').state,'current');
  const result=run([event('ENDORSE_AGRPROV_COREPER_byCONSIL','2026-02-01'),event('ADP_R1_POS_byEP','2026-03-01')]);
  assert.equal(step(result,'final').state,'done');assert.equal(step(result,'signed').state,'current');assert.equal(result.stage,'position');
  const journal=run([event('ADP_PROPLEG_byCOM','2025-01-01'),event('PUB_OJ','2026-01-01')]);
  assert.equal(journal.stage,'journal');assert.deepEqual(journal.steps.map(s=>s.key),['proposal','journal']);
});
test('partial and full Council codes, approval, signature, and unsupported families',()=>{
  for(const code of ['PART_APPRGEN_byCONSIL','ADP_PARNEGM_byCOREPER'])assert.equal(step(run([event(code,'2026-01-01')]),'council').partial,true);
  for(const code of ['ADP_APPRGEN_byCONSIL','ADP_MAND_NGT_INST_COREPER_byCONSIL','APR_R1_byCONSIL'])assert.equal(step(run([event(code,'2026-01-01')]),'council').partial,false);
  assert.equal(run([event('APR_R1_byCONSIL','2026-01-01')]).stage,'council-approved');
  assert.equal(run([event('SIGN_byEP_CONSIL','2026-01-01')]).stage,'signed');
  for(const family of ['CNS','INI','RSP']){
    const result=procedureSteps({...fixtures[0],reference:`2025/0222(${family})`});
    assert.deepEqual(result.steps,[]);assert.equal(result.stage,'unknown');
  }
});
test('projection does not mutate held inputs',()=>{
  const before=JSON.stringify(fixtures);for(const fixture of fixtures)procedureSteps(fixture);assert.equal(JSON.stringify(fixtures),before);
});

test('unrecorded Council, deal and signature events never establish a step or latest',()=>{
  const proposal=event('ADP_PROPLEG_byCOM','2025-01-01');
  for(const status of ['projected','unknown','cancelled']){
    const result=run([proposal,event('ADP_APPRGEN_byCONSIL','2026-01-01',status),event('ENDORSE_AGRPROV_COREPER_byCONSIL','2026-02-01',status),event('SIGN_byEP_CONSIL','2026-03-01',status)]);
    assert.equal(result.stage,'proposal');assert.equal(result.latest,proposal);
    for(const key of ['council','deal','signed'])assert.equal(step(result,key).state,'open');
    assert.equal(step(result,'committee').state,'current');
  }
});
test('Council approval makes signature current without a referral or deal',()=>{
  const result=run([event('ADP_R1_POS_byEP','2026-01-01'),event('APR_R1_byCONSIL','2026-02-01')]);
  assert.equal(result.stage,'council-approved');assert.equal(step(result,'signed').state,'current');assert.equal(step(result,'talks').state,'open');
});
test('post-deal final vote and same-day index position keep the original mandate date',()=>{
  const result=procedureSteps({reference:'2025/0001(COD)',asOf:'2026-11-06',
    indexEvents:[{had_activity_type:'def/ep-activities/PLENARY_ADOPT_POSITION',activity_date:'2026-03-01'}],
    cellarEvents:[event('REF_toCMT_NGTINST_byEP_PLEN','2025-06-01'),event('ENDORSE_AGRPROV_COREPER_byCONSIL','2026-02-01'),event('ADP_R1_POS_byEP','2026-03-01')],
  });
  assert.equal(step(result,'parliament').date,'2025-06-01');assert.equal(step(result,'final').date,'2026-03-01');assert.equal(result.stage,'position');
  assert.equal(step(result,'signed').state,'current');
});

test('a post-deal position completes Parliament even without a prior mandate row',()=>{
  const events=[event('ADP_PROPLEG_byCOM','2025-01-01'),event('ADP_REP_byEP_CMT','2025-06-01'),event('ENDORSE_AGRPROV_COREPER_byCONSIL','2026-02-01'),event('ADP_R1_POS_byEP','2026-03-01')];
  const result=run(events);
  assert.equal(result.stage,'position');assert.equal(step(result,'parliament').state,'done');assert.equal(step(result,'parliament').date,'2026-03-01');
  assert.equal(step(result,'final').state,'done');
  const published=run([...events,event('PUB_OJ','2026-04-01')]);
  assert.equal(step(published,'parliament').state,'done');
});

test('Council retains earliest mandate while exposing approval separately',()=>{
  const result=run([event('ADP_APPRGEN_byCONSIL','2025-05-01'),event('ADP_MAND_NGT_INST_COREPER_byCONSIL','2025-06-01'),event('APR_R1_byCONSIL','2026-04-01')]);
  assert.equal(step(result,'council').date,'2025-05-01');assert.deepEqual(result.councilApproval,{date:'2026-04-01'});assert.equal(result.stage,'council-approved');assert.equal(step(result,'signed').state,'current');
  const approvalOnly=run([event('APR_R1_byCONSIL','2026-04-01')]);
  assert.equal(step(approvalOnly,'council').date,'2026-04-01');assert.deepEqual(approvalOnly.councilApproval,{date:'2026-04-01'});
  assert.equal(run([]).councilApproval,null);
});
test('positions without referral or recorded deal have no current step',()=>{
  for(const council of ['PART_APPRGEN_byCONSIL','ADP_APPRGEN_byCONSIL']){
    const result=run([event(council,'2025-05-01'),event('ADP_R1_POS_byEP','2026-03-01')]);
    assert.equal(result.stage,'position');assert(!result.steps.some(step=>step.state==='current'));assert.equal(step(result,'deal').state,'open');
  }
});
test('held index negotiation endorsement establishes talks; committee agreement completes it',()=>{
  const source=JSON.parse(readFileSync(new URL('./fixtures/procedure-milestones-live-20261016.json',import.meta.url)));
  const record=source.records.find(record=>record.work.id==='eli/dl/proc/2025-0176');
  assert(record);
  const indexEvents=record.work.consists_of;
  const runIndex=asOf=>procedureSteps({reference:'2025/0176(COD)',asOf,indexEvents});
  const endorsement=indexEvents.find(row=>row.had_activity_type.endsWith('/PLENARY_ENDORSE_COMMITTEE_INTERINSTITUTIONAL_NEGOTIATIONS'));
  assert(endorsement);assert.equal(step(runIndex(endorsement.activity_date),'talks').state,'current');
  const deal=indexEvents.find(row=>row.had_activity_type.endsWith('/COMMITTEE_APPROVE_PROVISIONAL_AGREEMENT'));
  assert(deal);
  const result=runIndex(deal.activity_date);
  assert.equal(result.stage,'deal');assert.equal(step(result,'deal').date,deal.activity_date);assert.equal(step(result,'talks').state,'done');assert.equal(step(result,'talks').date,null);
  const voted=runIndex('2026-11-06');
  assert.equal(voted.stage,'position');
  assert.equal(step(voted,'final').state,'done');assert.equal(step(voted,'final').date,'2026-09-16');
  assert.equal(step(voted,'parliament').date,'2026-01-21');assert.equal(step(voted,'signed').state,'current');
});
