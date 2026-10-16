import test from 'node:test';
import assert from 'node:assert/strict';
import {clusterOutsideDays} from './pocOutsideTimeline.mjs';
const day=(date,count=1)=>({date,contributions:count,itemIds:Array.from({length:count},(_,i)=>date+':'+i),formal:false,legislative:false});
test('adjacent commissioner dates share one pointer target without losing either sitting',()=>{
  const result=clusterOutsideDays([day('2026-01-20',2),day('2026-01-21',2),day('2026-10-06')],'2024-07-16','2026-10-15',776);
  assert.equal(result.length,2);assert.deepEqual(result[0].dates,['2026-01-20','2026-01-21']);assert.equal(result[0].items,4);assert(result[1].x-result[0].x>=34);
});
test('narrow tracks preserve every exact date and keep special and legislative marks',()=>{
  const input=[day('2021-11-24'),{...day('2023-09-13'),formal:true},{...day('2025-03-11'),legislative:true},day('2025-10-22')];
  const result=clusterOutsideDays(input,'2021-01-01','2026-10-15',180);
  assert.deepEqual(result.flatMap(m=>m.dates),input.map(d=>d.date));assert(result.some(m=>m.formal));assert(result.some(m=>m.legislative));assert(result.every(m=>m.x>=18&&m.x<=162));
});
test('monthly activity cannot chain into one cluster spanning an entire year',()=>{
  const days=Array.from({length:12},(_,i)=>day(`2025-${String(i+1).padStart(2,'0')}-15`));
  const marks=clusterOutsideDays(days,'2024-07-16','2026-10-15',747);
  assert(marks.length>=6);assert(marks.every(mark=>mark.dates.length<=2));
  assert(marks.slice(1).every((mark,i)=>mark.x-marks[i].x>=34));
});
