import test from 'node:test';
import assert from 'node:assert/strict';
import {parliamentaryService} from './parliamentary-service.mjs';
const membership=(term,start,end=null,id='m-'+term)=>({id,organization:'org/ep-'+term,role:'def/ep-roles/MEMBER_PARLIAMENT',memberDuring:{startDate:start,...(end?{endDate:end}:{})}});
const service=hasMembership=>parliamentaryService({hasMembership},'2026-10-19');
test('Omarjee’s consecutive published mandates yield 4 January 2012, preserving all exact source periods',()=>{
  // https://data.europarl.europa.eu/api/v2/meps/30482, retrieved 2026-10-19.
  const rows=[membership(7,'2012-01-04','2014-06-30','membership/30482-m-14855'),membership(10,'2024-07-16',null,'membership/30482-m-16991'),membership(9,'2019-07-02','2024-07-15','membership/30482-m-16246'),membership(8,'2014-07-01','2019-07-01','membership/30482-m-15161')];
  const before=JSON.stringify(rows),value=service(rows);
  assert.equal(value.currentSince,'2012-01-04');assert.equal(value.periods.length,1);assert.equal(value.periods[0].observations.length,4);assert.equal(value.complete,true);assert.equal(JSON.stringify(rows),before);
});
test('Mažylis’s return starts a new spell instead of implying continuous service since 2019',()=>{
  // https://data.europarl.europa.eu/api/v2/meps/197841, retrieved 2026-10-19.
  const value=service([membership(9,'2019-07-02','2024-07-15','membership/197841-m-16623'),membership(10,'2024-12-05',null,'membership/197841-m-17558')]);
  assert.equal(value.currentSince,'2024-12-05');assert.equal(value.periods.length,2);assert.equal(value.periods[0].end,'2024-07-15');
});
test('committee and party membership dates never establish Parliament service',()=>{
  const value=service([{...membership(10,'2024-07-16'),role:'def/ep-roles/MEMBER'},{...membership(10,'2024-07-16'),organization:'org/6572'}]);
  assert.equal(value.currentSince,null);assert.equal(value.complete,false);
});
test('invalid dates, reversed periods, unknown bodies and ambiguous overlapping active mandates remain gaps',()=>{
  for(const bad of [membership(8,'2024-02-30'),membership(8,'2024-07-16','2024-07-15'),{...membership(8,'2014-07-01'),organization:'org/unknown'}]) {
    const value=service([bad,membership(10,'2024-07-16')]);assert.equal(value.complete,false);assert(value.error);assert.equal(value.currentSince,null);assert.equal(value.rejected[0].membershipId,bad.id);assert.equal(value.rejected[0].start,bad.memberDuring.startDate);assert.equal(value.rejected[0].end,bad.memberDuring.endDate??null);
  }
  const ambiguous=service([membership(9,'2019-07-02'),membership(10,'2024-07-16')]);assert.equal(ambiguous.currentSince,null);assert.equal(ambiguous.complete,false);
});
test('unknown potentially active mandates and historical overlaps withhold a definitive since date',()=>{
  const unknown={...membership(9,undefined),id:'membership/unknown-start'};
  const missing=service([unknown,membership(10,'2024-07-16')]);assert.equal(missing.currentSince,null);assert.equal(missing.rejected[0].reason,'invalid_date');assert.equal(missing.rejected[0].membershipId,'membership/unknown-start');
  const overlapping=service([membership(8,'2014-07-01','2020-01-01'),membership(9,'2019-07-02','2024-07-15'),membership(10,'2024-07-16')]);
  assert.equal(overlapping.currentSince,null);assert.equal(overlapping.complete,false);assert.equal(overlapping.overlaps,true);assert.equal(overlapping.periods.flatMap(p=>p.observations).length,3);
});
test('future mandates cannot establish a current since date and an ended mandate includes its last day',()=>{
  assert.equal(service([membership(11,'2030-01-01')]).currentSince,null);
  const value=parliamentaryService({hasMembership:[membership(9,'2019-07-02','2024-07-15')]},'2024-07-15');assert.equal(value.currentSince,'2019-07-02');
  assert.equal(service([]).currentSince,null);
});
