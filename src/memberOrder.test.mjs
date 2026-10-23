import test from 'node:test';
import assert from 'node:assert/strict';
import {compareMembers} from './memberOrder.mjs';
import {memberSummary} from '../server/odp.mjs';

const person=(id,firstName,lastName,sortLabel)=>memberSummary({identifier:String(id),givenName:firstName,familyName:lastName,sortLabel});
test('displayed surnames precede given names regardless of EP concatenated sort labels',()=>{
  const members=[person(1,'Stefan','Berger','BERGERS'),person(2,'Sibylle','Berg','BERGS'),
    person(3,'Asger','Christensen','CHRISTENSENA'),person(4,'Marie-Sophie','Christ','CHRISTMS'),
    person(5,'Nicolas','Bay','BAY'),person(6,'Christophe','Bay','BAYC')];
  assert.deepEqual(members.sort(compareMembers).map(m=>m.id),[6,5,2,1,4,3]);
});
test('surname particles remain part of the displayed surname and accents use English collation',()=>{
  const members=[person(1,'Pilar','del Castillo Vera','CASTILLOVERAP'),person(2,'Zoe','Delfino'),
    person(3,'Alex','Deutsch'),person(4,'Alex','Éclair'),person(5,'Alex','Eclair'),person(6,'Alex','Zulu')];
  assert.deepEqual(members.sort(compareMembers).map(m=>m.id),[1,2,3,5,4,6]);
});
test('case and canonically equivalent accents tie by given name then numeric member ID',()=>{
  const members=[person(20,'Zoë','BÉRG'),person(10,'Ana','Be\u0301rg'),person(2,'ana','Bérg')];
  for(const input of [members,[...members].reverse()])assert.deepEqual(input.sort(compareMembers).map(m=>m.id),[2,10,20]);
  assert.equal(compareMembers(members[0],members[0]),0);
});
test('missing displayed name parts are safe and never replaced with sortLabel',()=>{
  const members=[person(2,'Alex',undefined,'ZZZ'),person(1,'Alex',undefined,'AAA')];
  assert.deepEqual(members.sort(compareMembers).map(m=>m.id),[1,2]);
});
