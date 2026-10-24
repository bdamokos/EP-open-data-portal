import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceAvailability,periodAvailability} from './source-availability.mjs';

const scope={start:'2026-10-01',end:'2026-10-24',today:'2026-10-24'};
const source=extra=>sourceAvailability({sourceKey:'questions',...scope,latestObservedDate:'2026-10-16',...extra});
const period=(start,end=start)=>({start,end});
test('frontier day is partial, trailing dates null, and checked older zeroes are observations',()=>{
  assert.equal(periodAvailability(period('2026-10-15'),source(),0).state,'observed');
  assert.equal(periodAvailability(period('2026-10-16'),source(),3).state,'partial');
  assert.equal(periodAvailability(period('2026-10-12','2026-10-18'),source(),3).state,'partial');
  assert.equal(periodAvailability(period('2026-10-17'),source(),0).observedCount,null);
  assert.equal(periodAvailability(period('2026-10-16'),source(),0).observedCount,0);
});
test('older and undated gaps never turn missing observations into zeroes',()=>{
  for(const gaps of [[{start:'2026-10-08',end:'2026-10-10'}],[{}]]) {
    assert.equal(periodAvailability(period('2026-10-09'),source({gaps}),0).observedCount,null);
    assert.deepEqual([periodAvailability(period('2026-10-09'),source({gaps}),2).state,periodAvailability(period('2026-10-09'),source({gaps}),2).observedCount],['partial',2]);
  }
});
test('positive records survive slower dependencies while each dependency keeps its state',()=>{
  const sources=[source(),source({sourceKey:'answers',latestObservedDate:'2026-10-09'})];
  const result=periodAvailability(period('2026-10-15'),sources,5);
  assert.equal(result.state,'partial');assert.equal(result.observedCount,5);
  assert.deepEqual(result.dependencies.map(d=>d.state),['observed','unavailable']);
  assert.equal(periodAvailability(period('2026-10-20'),source({limited:true}),0).dependencies[0].state,'unavailable');
});
test('invalid/future or future-at-retrieval event dates cannot advance the frontier',()=>{
  const evidence=sourceAvailability({sourceKey:'speech',...scope,records:[{date:'2026-10-24',fetchedAt:'2026-10-22T12:00Z'},{date:'2026-02-30'},{date:'2026-10-25'},{date:'2026-10-21',fetchedAt:'2026-10-22T12:00Z'}]});
  assert.equal(evidence.latestObservedDate,'2026-10-21');
  assert.equal(periodAvailability(period('2026-10-25'),evidence,1,{today:scope.today}).observedCount,null);
});
test('checked ranges must cover the period and empty catalogues do not settle event dates',()=>{
  const evidence=source({checkedIntervals:[{start:'2026-10-01',end:'2026-10-07'},{start:'2026-10-10',end:'2026-10-24'}]});
  assert.equal(periodAvailability(period('2026-10-08','2026-10-12'),evidence,0).observedCount,null);
  assert.equal(periodAvailability(period('2026-10-08','2026-10-12'),evidence,2).state,'partial');
  assert.equal(periodAvailability(period('2026-10-22'),source(),0).observedCount,null);
  assert.equal(source().publicationMaturity,'unknown');
});
