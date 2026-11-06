import assert from 'node:assert/strict';
import test from 'node:test';

import {voteOptionParts} from './voteTexts.mjs';
test('picker entries name the split part from the source link and add an ordinal only to identical entries',()=>{
  const entry=(id,subject,scope,method,decided)=>({id,subject,title:'t'+id,scope,method,decidedDocumentIds:decided});
  const parts=voteOptionParts([
    entry('a','§ 21','amendment','VOTE_ELECTRONIC_ROLLCALL',['MTG-PL-2026-10-22-VOT-ITM-993352-SPLIT-4-1']),
    entry('b','§ 21','amendment','VOTE_HAND',['MTG-PL-2026-10-22-VOT-ITM-993352-SPLIT-4-2']),
    entry('c','§ 21','amendment','VOTE_HAND',['MTG-PL-2026-10-22-VOT-ITM-993352-SPLIT-4-3']),
    entry('d','After § 19','amendment','VOTE_ELECTRONIC',[]),
    entry('e','§ 11','amendment','VOTE_HAND',[]),
    entry('f','§ 11','amendment','VOTE_HAND',[]),
    entry('g','§ 5/1','amendment','VOTE_HAND',['x-SPLIT-1-1']),
  ]);
  assert.deepEqual([...parts.values()].map(row=>row.text),['§ 21/1','§ 21/2','§ 21/3','After § 19','§ 11','§ 11','§ 5/1']);
  assert.equal(parts.get('b').ordinal,null);
  assert.deepEqual(parts.get('f').ordinal,{number:2,count:2});assert.equal(parts.get('d').ordinal,null);
});

import {votePosition} from './voteTexts.mjs';
test('a vote outside the list has no position instead of "Vote 0 of N"',()=>{
  const votes=[{id:'a'},{id:'b'},{id:'c'}];
  assert.deepEqual(votePosition(votes,'b'),{number:2,count:3});
  assert.equal(votePosition(votes,'gone'),null);
  assert.equal(votePosition(votes,''),null);
});
