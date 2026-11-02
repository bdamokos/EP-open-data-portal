import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityBuckets,activityCounts,activityLevel,sumActivity} from './groupVoicesActivity.mjs';

test('activity strips bucket by calendar month across the period and by sitting day within a month',()=>{
  const people=[{days:{'2026-09-08':2,'2026-10-06':1}},{days:{'2026-10-06':3,'2026-10-21':1}},{}];
  const months=activityBuckets({from:'2026-08-20',to:'2026-10-24'},'term',people);
  assert.deepEqual(months,{unit:'month',keys:['2026-08','2026-09','2026-10']});
  assert.deepEqual(activityCounts(people[0].days,months),[0,2,1]);
  const days=activityBuckets({from:'2026-10-01',to:'2026-10-31'},'2026-10',people);
  assert.deepEqual(days,{unit:'day',keys:['2026-10-06','2026-10-21']});
  assert.deepEqual(activityCounts(people[1].days,days),[3,1]);
  assert.deepEqual(activityCounts(undefined,days),[0,0]);
  assert.deepEqual(sumActivity(people),{'2026-09-08':2,'2026-10-06':4,'2026-10-21':1});
  assert.deepEqual(activityBuckets({from:'2025-11-15',to:'2026-02-02'},'12m',[]).keys,['2025-11','2025-12','2026-01','2026-02']);
});
test('activity levels keep observed zero apart and share one scale',()=>{
  assert.equal(activityLevel(0,10),0);assert.equal(activityLevel(1,10),2);assert.equal(activityLevel(10,10),4);assert.equal(activityLevel(1,1),4);assert.equal(activityLevel(3,0),4);
});
