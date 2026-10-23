import test from 'node:test';
import assert from 'node:assert/strict';
import {personNameIndex,personDisplayName} from './personNames.mjs';

const members=[
  {id:42,firstName:'Dan-Ştefan',lastName:'Motreanu'},
  {id:257043,firstName:'Mika',lastName:'Aaltola'},
  {id:43,firstName:'María-José',lastName:'de la Cruz McDonald'},
];
test('display names join numeric and string person IDs exactly, retaining structured spelling',()=>{
  const names=personNameIndex(members);
  assert.equal(personDisplayName(names,'42','Dan-Ştefan MOTREANU'),'Dan-Ştefan Motreanu');
  assert.equal(personDisplayName(names,257043,'Mika AALTOLA'),'Mika Aaltola');
  assert.equal(personDisplayName(names,43,'LABEL'),'María-José de la Cruz McDonald');
});
test('unknown, absent and malformed IDs never match by label or coerce to an ID',()=>{
  const names=personNameIndex(members);
  for(const id of [44,null,undefined,'042','42x',' 42','4.2e1'])assert.equal(personDisplayName(names,id,'Dan-Ştefan MOTREANU'),'Dan-Ştefan MOTREANU');
  assert.equal(personDisplayName(names,44,'Jean de MacDONALD'),'Jean de MacDONALD');
  assert.equal(personDisplayName(names,44,null),'');
});
test('partial or unavailable directory data keeps the raw label and never mutates records',()=>{
  const input={id:42,name:'Dan-Ştefan MOTREANU'};
  const names=personNameIndex([{id:42,firstName:'Dan-Ştefan',lastName:''}]);
  assert.equal(personDisplayName(names,input.id,input.name),input.name);
  assert.equal(personDisplayName(personNameIndex(),input.id,input.name),input.name);
  assert.deepEqual(input,{id:42,name:'Dan-Ştefan MOTREANU'});
});
