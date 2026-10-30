import test from 'node:test';
import assert from 'node:assert/strict';
import {declaredSpeechEvidence} from './declared-speech-evidence.mjs';

const id='MTG-PL-2024-10-07-OTH-101',parent='MTG-PL-2024-10-07-PVCRE-ITM-17',uri=id=>'eli/dl/event/'+id;
const speech=()=>({id:uri(id),activity_id:id,had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:[{had_participant_person:['person/42']}]});
const read=(nodes,parentDate=null)=>declaredSpeechEvidence({children:[id],parentId:parent,parentDate,nodes});
test('exact EP typed declarations establish people without turning bare references into speeches',()=>{
  assert.equal(read([uri(id),{id:uri(id)}]).speeches.size,0);
  const root=speech();root.had_activity_type='https://data.europarl.europa.eu/def/ep-activities/PLENARY_DEBATE_SPEECH';
  assert.deepEqual(read([root]).speeches.get(id),{kind:'PLENARY_DEBATE_SPEECH',people:['42'],date:null});
  assert.equal(read([{...root,had_activity_type:'def/ep-activities/PLENARY_PROCEEDING'}]).speeches.size,0);
});
for(const [name,change] of [
  ['foreign type',{had_activity_type:'https://foreign.invalid/PLENARY_DEBATE_SPEECH'}],
  ['foreign type with matching path',{had_activity_type:'https://foreign.invalid/def/ep-activities/PLENARY_DEBATE_SPEECH'}],
  ['conflicting URI',{id:uri(id+'0'),activity_id:id}],
  ['foreign URI',{id:'https://foreign.invalid/'+uri(id),activity_id:id}],
  ['conflicting activity identifier',{activity_id:id+'0'}],
  ['contradictory type',{had_activity_type:'def/ep-activities/PLENARY_PROCEEDING'}],
  ['invalid date',{activity_date:'2024-02-30'}],
  ['conflicting parent',{inverse_consists_of:[uri(parent+'0')]}],
])test('an additional '+name+' declaration cannot be discarded before reconciliation',()=>{
  const proof=read([speech(),{id:uri(id),...change}]);
  assert.equal(proof.speeches.size,0);assert(proof.conflicted.has(id));
});
test('child dates must agree even when the procedure omits its debate date',()=>{
  const proof=read([{...speech(),activity_date:'2024-10-07'},{id:uri(id),activity_date:'2024-10-08'}]);
  assert.equal(proof.speeches.size,0);assert(proof.conflicted.has(id));
  assert.equal(read([{...speech(),activity_date:'2024-10-08'}],'2024-10-07').speeches.size,0);
});

test('the dated event identity reconciles each supplied date without manufacturing one',()=>{
  for(const [nodes,date] of [[[ {...speech(),activity_date:'2024-10-08'} ],null],[[speech()],'2024-10-08']]){
    const proof=read(nodes,date);assert.equal(proof.speeches.size,0);assert(proof.conflicted.has(id));
  }
  assert.equal(read([speech()]).speeches.get(id).date,null);
});
