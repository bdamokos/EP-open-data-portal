import test from 'node:test';
import assert from 'node:assert/strict';
import {brusselsDate,plenaryAvailability} from './plenaryAvailability.mjs';

const detail=(date,extra={})=>({date,speeches:[],votes:[],voteCoverage:{error:null},coverage:{gaps:[]},...extra});
const today='2026-10-20';
test('future and same-day items are neutral even with a stale sitting phase',()=>{
  for(const kind of ['speech','vote']) {
    assert.equal(plenaryAvailability(detail('2026-10-21',{phase:'past'}),kind,today).state,'scheduled');
    assert.equal(plenaryAvailability(detail(today,{phase:'past'}),kind,today).state,'today');
    assert(!/unavailable|error/i.test(plenaryAvailability(detail(today),kind,today).message));
  }
  assert.equal(brusselsDate(Date.parse('2026-10-19T23:30:00Z')),today);
  assert.equal(brusselsDate(Date.parse('2026-10-25T23:30:00Z')),'2026-10-26');
});
test('waiting follows source evidence rather than the age of an empty selection',()=>{
  for(const kind of ['speech','vote']) {
    for(const day of ['2026-10-19','2026-10-17','2026-10-16'])assert.equal(plenaryAvailability(detail(day),kind,today).state,'unknown');
    const availability={[kind==='speech'?'speech':'vote']:{latestObservedDate:'2026-10-16'}};
    assert.equal(plenaryAvailability(detail('2026-10-17',{availability}),kind,today).state,'awaiting');
    assert.equal(plenaryAvailability(detail('2026-10-16',{availability}),kind,today).state,'unknown');
    assert.equal(plenaryAvailability(detail('unknown'),kind,today).state,'unknown');
  }
  assert.match(plenaryAvailability(detail('2026-10-16'),'vote',today).message,/Not every vote is a roll call/);
});
test('known source failures remain errors; linked records and previous debates retain their meaning',()=>{
  const failed=detail(today,{voteCoverage:{error:'429'},coverage:{gaps:[{source:'actual debate event',message:'timeout'}]}});
  assert.equal(plenaryAvailability(failed,'speech',today).state,'error');
  assert.equal(plenaryAvailability(failed,'vote',today).state,'error');
  assert.equal(plenaryAvailability({...failed,date:'2026-10-21'},'vote',today).state,'scheduled');
  assert.equal(plenaryAvailability({...failed,votes:[{date:today}]},'vote',today),null);
  assert.equal(plenaryAvailability({...failed,speeches:[{date:today}]},'speech',today),null);
  assert.equal(plenaryAvailability(detail(today,{speeches:[{date:'2026-10-07'}]}),'speech',today).state,'today');
  for(const kind of ['speech','vote']) {
    const availability={[kind]:{latestObservedDate:'2026-10-16',gaps:[{start:'2026-10-17',end:'2026-10-19'}]}};
    assert.equal(plenaryAvailability(detail('2026-10-18',{availability}),kind,today).state,'error');
    assert.equal(plenaryAvailability(detail('2026-10-19',{availability:{[kind]:{...availability[kind],gaps:[{}]}}}),kind,today).state,'error');
  }
});
