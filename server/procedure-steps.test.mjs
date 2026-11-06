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
  assert.equal(result.stage,'drafting');assert.deepEqual(step(result,'council'),{key:'council',state:'done',date:'2026-09-29',partial:true});
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
  assert.equal(step(result,'final').state,'done');assert.equal(step(result,'signed').state,'current');
  const journal=run([event('ADP_PROPLEG_byCOM','2025-01-01'),event('PUB_OJ','2026-01-01')]);
  assert.equal(journal.stage,'journal');assert.deepEqual(journal.steps.map(s=>s.key),['proposal','journal']);
});
test('partial and full Council codes, approval, signature, and unsupported families',()=>{
  for(const code of ['PART_APPRGEN_byCONSIL','ADP_PARNEGM_byCOREPER'])assert.equal(step(run([event(code,'2026-01-01')]),'council').partial,true);
  for(const code of ['ADP_APPRGEN_byCONSIL','ADP_MAND_NGT_INST_COREPER_byCONSIL','APR_R1_byCONSIL'])assert.equal(step(run([event(code,'2026-01-01')]),'council').partial,false);
  assert.equal(run([event('APR_R1_byCONSIL','2026-01-01')]).stage,'council-approved');
  assert.equal(run([event('SIGN_byEP_CONSIL','2026-01-01')]).stage,'signed');
  for(const family of ['CNS','INI','RSP'])assert.deepEqual(procedureSteps({...fixtures[0],reference:`2025/0222(${family})`}).steps,[]);
});
test('projection does not mutate held inputs',()=>{
  const before=JSON.stringify(fixtures);for(const fixture of fixtures)procedureSteps(fixture);assert.equal(JSON.stringify(fixtures),before);
});
