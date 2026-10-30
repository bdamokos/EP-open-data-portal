import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceAvailability,periodAvailability,availabilitySummary} from './source-availability.mjs';

const scope={start:'2026-10-01',end:'2026-10-24',today:'2026-10-24'};
const source=extra=>sourceAvailability({sourceKey:'questions',...scope,latestObservedDate:'2026-10-16',...extra});
const period=(start,end=start)=>({start,end});
test('a latest event date does not manufacture missing records in a checked selection',()=>{
  assert.equal(periodAvailability(period('2026-10-15'),source(),0).state,'observed');
  assert.equal(periodAvailability(period('2026-10-16'),source(),3).state,'observed');
  assert.equal(periodAvailability(period('2026-10-12','2026-10-18'),source(),3).state,'observed');
  assert.equal(periodAvailability(period('2026-10-17'),source(),0).observedCount,0);
  assert.equal(periodAvailability(period('2026-10-16'),source(),0).observedCount,0);
});
test('older and undated gaps never turn missing observations into zeroes',()=>{
  for(const gaps of [[{start:'2026-10-08',end:'2026-10-10'}],[{}]]) {
    assert.equal(periodAvailability(period('2026-10-09'),source({gaps}),0).observedCount,null);
    assert.deepEqual([periodAvailability(period('2026-10-09'),source({gaps}),2).state,periodAvailability(period('2026-10-09'),source({gaps}),2).observedCount],['partial',2]);
  }
});
test('different latest event dates are not failed dependencies; actual limits remain partial',()=>{
  const sources=[source(),source({sourceKey:'answers',latestObservedDate:'2026-10-09'})];
  const result=periodAvailability(period('2026-10-15'),sources,5);
  assert.equal(result.state,'observed');assert.equal(result.observedCount,5);
  assert.deepEqual(result.dependencies.map(d=>d.state),['observed','observed']);
  assert.equal(periodAvailability(period('2026-10-20'),source({limited:true}),2).state,'partial');
  assert.equal(periodAvailability(period('2026-10-20'),source({limited:true}),0).observedCount,null);
});
test('invalid/future or future-at-retrieval event dates cannot advance the frontier',()=>{
  const evidence=sourceAvailability({sourceKey:'speech',...scope,records:[{date:'2026-10-24',fetchedAt:'2026-10-22T12:00Z'},{date:'2026-02-30'},{date:'2026-10-25'},{date:'2026-10-21',fetchedAt:'2026-10-22T12:00Z'}]});
  assert.equal(evidence.latestObservedDate,'2026-10-21');
  assert.equal(periodAvailability(period('2026-10-25'),evidence,1,{today:scope.today}).observedCount,null);
});
test('unchecked ranges remain unknown while empty checked selections are observations',()=>{
  const evidence=source({checkedIntervals:[{start:'2026-10-01',end:'2026-10-07'},{start:'2026-10-10',end:'2026-10-24'}]});
  assert.equal(periodAvailability(period('2026-10-08','2026-10-12'),evidence,0).observedCount,null);
  assert.equal(periodAvailability(period('2026-10-08','2026-10-12'),evidence,2).state,'partial');
  assert.equal(periodAvailability(period('2026-10-22'),source(),0).observedCount,0);
  assert.equal(source().publicationMaturity,'unknown');
});
test('unknown maturity and an absent latest date are not known omissions',()=>{
  const evidence=source({latestObservedDate:null});
  assert.equal(availabilitySummary(evidence).partial,false);
  assert.equal(periodAvailability(period('2026-10-22'),evidence,0).state,'observed');
  assert.equal(periodAvailability(period('2026-10-22'),{...evidence,checkedIntervals:[]},0).observedCount,null);
});
test('a checked dependency does not turn an unchecked dependency into an observed zero',()=>{
  const sources=[source(),source({sourceKey:'oral',checkedIntervals:[]})];
  assert.equal(periodAvailability(period('2026-10-22'),sources,0).observedCount,null);
  assert.equal(periodAvailability(period('2026-10-22'),sources,2).state,'partial');
});
test('open-ended failures affect only their known side of the date range',()=>{
  assert.equal(periodAvailability(period('2026-10-09'),source({gaps:[{start:'2026-10-20'}]}),3).state,'observed');
  assert.equal(periodAvailability(period('2026-10-21'),source({gaps:[{start:'2026-10-20'}]}),3).state,'partial');
  assert.equal(periodAvailability(period('2026-10-21'),source({gaps:[{end:'2026-10-09'}]}),3).state,'observed');
});
