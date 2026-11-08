import test from 'node:test';
import assert from 'node:assert/strict';
import {brusselsDate,speechAvailability} from './plenaryAvailability.mjs';

const detail=(date,extra={})=>({date,speeches:[],coverage:{gaps:[]},...extra});
const today='2026-10-20';
test('future and same-day items are neutral even with a stale sitting phase',()=>{
  assert.equal(speechAvailability(detail('2026-10-21',{phase:'past'}),today).state,'scheduled');
  assert.equal(speechAvailability(detail(today,{phase:'past'}),today).state,'today');
  assert(!/unavailable|error/i.test(speechAvailability(detail(today),today).message));
  assert.equal(brusselsDate(Date.parse('2026-10-19T23:30:00Z')),today);
  assert.equal(brusselsDate(Date.parse('2026-10-25T23:30:00Z')),'2026-10-26');
});
test('waiting follows source evidence rather than the age of an empty selection',()=>{
  for(const day of ['2026-10-19','2026-10-17','2026-10-16'])assert.equal(speechAvailability(detail(day),today).state,'unknown');
  const availability={speech:{latestObservedDate:'2026-10-16'}};
  assert.equal(speechAvailability(detail('2026-10-17',{availability}),today).state,'awaiting');
  assert.equal(speechAvailability(detail('2026-10-16',{availability}),today).state,'unknown');
  assert.equal(speechAvailability(detail('unknown'),today).state,'unknown');
});
test('known source failures remain errors; linked records and previous debates retain their meaning',()=>{
  const failed=detail(today,{coverage:{gaps:[{source:'actual debate event',message:'timeout'}]}});
  assert.equal(speechAvailability(failed,today).state,'error');
  assert.equal(speechAvailability({...failed,date:'2026-10-21'},today).state,'scheduled');
  assert.equal(speechAvailability({...failed,speeches:[{date:today}]},today),null);
  assert.equal(speechAvailability(detail(today,{speeches:[{date:'2026-10-07'}]}),today).state,'today');
  const availability={speech:{latestObservedDate:'2026-10-16',gaps:[{start:'2026-10-17',end:'2026-10-19'}]}};
  assert.equal(speechAvailability(detail('2026-10-18',{availability}),today).state,'error');
  assert.equal(speechAvailability(detail('2026-10-19',{availability:{speech:{...availability.speech,gaps:[{}]}}}),today).state,'error');
});
