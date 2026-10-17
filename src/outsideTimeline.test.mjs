import test from 'node:test';
import assert from 'node:assert/strict';
import {clusterOutsideDays,filterOutsidePeople} from './outsideTimeline.mjs';
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

test('a mixed marker targets the exact special item, including a later sitting and same-day debates',()=>{
  const input=[
    {...day('2026-04-28'),items:[{id:'debate-1',kind:'PLENARY_DEBATE',legislative:true}]},
    {...day('2026-04-29',2),formal:true,items:[{id:'debate-2',kind:'PLENARY_DEBATE',legislative:false},{id:'special-3',kind:'PLENARY_ACTIVITY',legislative:false}]},
  ];
  for(const width of [180,747]) {
    const [mark]=clusterOutsideDays(input,'2024-07-16','2026-10-15',width);
    assert.deepEqual(mark.dates,['2026-04-28','2026-04-29']);
    assert.deepEqual(mark.target,{date:'2026-04-29',itemId:'special-3'});
  }
  const filtered=filterOutsidePeople([{id:'1',name:'Guest',capacity:'commission',days:input}],{kind:'debate'});
  assert.deepEqual(clusterOutsideDays(filtered[0].days,'2024-07-16','2026-10-15',747)[0].target,{date:'2026-04-28',itemId:'debate-1'});
});

test('markers without item metadata retain an exact date destination for their special cue',()=>{
  const [mark]=clusterOutsideDays([day('2026-04-28'),{...day('2026-04-29'),formal:true}],'2024-07-16','2026-10-15',180);
  assert.deepEqual(mark.target,{date:'2026-04-29'});
});

test('repeat appearances include two agenda items on one day and exclude repeated speeches in one item',()=>{
  const one={id:'1',name:'Guest',capacity:'other',days:[day('2025-03-11',1)]};
  const multi={id:'2',name:'Commissioner',capacity:'commission',days:[day('2025-03-11',2)]};
  const speeches={...one,id:'3',days:[{...day('2025-03-11'),contributions:3}]};
  const result=filterOutsidePeople([one,multi,speeches],{repeat:true});
  assert.deepEqual(result.map(person=>person.id),['2']);assert.equal(result[0].sittingDays,1);assert.equal(result[0].appearances,2);
});
test('event and capacity filters recompute repeat appearances from the selected exact items',()=>{
  const person={id:'42',name:'Mária Guest',capacity:'commission',days:[{...day('2025-03-11',3),items:[{id:'debate-1',kind:'PLENARY_DEBATE',legislative:true},{id:'debate-2',kind:'PLENARY_DEBATE',legislative:false},{id:'formal',kind:'PLENARY_ACTIVITY',legislative:false}]}]};
  assert.equal(filterOutsidePeople([person],{kind:'special',repeat:true}).length,0);
  const result=filterOutsidePeople([person],{kind:'debate',group:'commission',repeat:true,search:'Maria'});
  assert.equal(result.length,1);assert.equal(result[0].appearances,2);assert.deepEqual(result[0].days[0].itemIds,['debate-1','debate-2']);
  assert.equal(filterOutsidePeople([person],{group:'leaders'}).length,0);
});
