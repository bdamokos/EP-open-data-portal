import test from 'node:test';import assert from 'node:assert/strict';
import {plenaryMonday,groupPlenaryWeeks,votePeriodWeek,voteWeekNeighbours,votePeriodTransition,validateVotePeriods} from './plenaryPeriods.mjs';
const weeks=[{week:'2026-10-19',sittings:[{sittingId:'MTG-PL-2026-10-19',date:'2026-10-19'}]},{week:'2026-10-05',sittings:[{sittingId:'MTG-PL-2026-10-06',date:'2026-10-06'}]}];
test('calendar grouping and fallback accept any valid day and snap across month/year boundaries',()=>{
 assert.equal(plenaryMonday('2026-10-07'),'2026-10-05');assert.equal(plenaryMonday('2026-01-01'),'2025-12-29');assert.equal(plenaryMonday('2026-02-30'),null);
 assert.deepEqual(groupPlenaryWeeks([{id:'a',date:'2026-10-07'},{id:'b',date:'2026-10-06'}]).map(w=>[w.week,w.sittings.map(s=>s.id)]),[['2026-10-05',['b','a']]]);
});
test('known week navigation has boundaries and sitting-only URLs resolve to their exact week',()=>{
 assert.deepEqual(voteWeekNeighbours(weeks,'2026-10-19'),{previous:'2026-10-05',next:null});assert.deepEqual(voteWeekNeighbours(weeks,'2026-10-05'),{previous:null,next:'2026-10-19'});
 assert.equal(votePeriodWeek({week:'latest',sittingId:'MTG-PL-2026-10-06'},null,weeks),'2026-10-05');
});
test('week and day changes clear all period-scoped state including the snapshot',()=>{
 const state={week:'latest',sittingId:null,snapshotId:'old',offset:50,decisionId:'selected',context:{documentId:'text'},expandedSubjectIds:['subject'],positions:'all'};
 const day=votePeriodTransition(state,'2026-10-05','MTG-PL-2026-10-06');assert.equal(day.positions,'all');assert.equal(day.sittingId,'MTG-PL-2026-10-06');
 for(const value of [day,votePeriodTransition(day,'2026-10-05')]){assert.equal(value.week,'2026-10-05');assert.equal(value.snapshotId,null);assert.equal(value.offset,0);assert.equal(value.decisionId,null);assert.equal(value.context,null);assert.deepEqual(value.expandedSubjectIds,[]);}
});
test('calendar validator rejects mismatched identities, weeks and duplicate observations',()=>{
 const data={version:2,weeks,coverage:{status:'partial',years:[{year:2026,state:'partial',sources:[]}]}};assert(validateVotePeriods(data));
 for(const patch of [{version:1},{weeks:[{...weeks[0],week:'2026-10-20'}]},{weeks:[{...weeks[0],sittings:[{sittingId:'MTG-PL-2026-10-20',date:'2026-10-19'}]}]},{weeks:[weeks[0],weeks[0]]}])assert.equal(validateVotePeriods({...data,...patch}),false);
});


test('calendar validator rejects malformed entries before inspecting their fields',()=>{
 const valid={version:2,weeks,coverage:{status:'partial',years:[{year:2026,state:'partial',sources:[]}]}};
 for(const value of [null,undefined,0,'text',[],true]){
  for(const data of [value,{...valid,coverage:value},{...valid,coverage:{...valid.coverage,years:[value]}},{...valid,weeks:[value]},{...valid,weeks:[{...weeks[0],sittings:[value]}]}]){
   assert.doesNotThrow(()=>validateVotePeriods(data));assert.equal(validateVotePeriods(data),false);
  }
 }
 for(const week of [null,undefined,4,{},[]])assert.equal(validateVotePeriods({...valid,weeks:[{week,sittings:weeks[0].sittings}]}),false);
});
