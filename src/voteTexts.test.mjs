import assert from 'node:assert/strict';
import test from 'node:test';
import {votedDocumentId} from './voteTexts.mjs';

// Ids from the public EP decisions record for MTG-PL-2026-10-22-OJ-ITM-V-72 (retrieved 2026-11-05).
const documents=['B-10-2026-0476','B-10-2026-0483','RC-10-2026-0476'];
test('the text voted on is the item document that the votes decide on, by exact id',()=>{
  const votes=[{decidedDocumentIds:['RC-10-2026-0476-AM-3']},{decidedDocumentIds:['RC-10-2026-0476-AM-5','MTG-PL-2026-10-22-VOT-ITM-993352-SPLIT-4-2']},{decidedDocumentIds:[]},{}];
  assert.equal(votedDocumentId(votes,documents),'RC-10-2026-0476');
});
test('a vote on the text itself counts; unknown or missing links give no answer',()=>{
  assert.equal(votedDocumentId([{decidedDocumentIds:['B-10-2026-0483']}],documents),'B-10-2026-0483');
  assert.equal(votedDocumentId([{decidedDocumentIds:['A-10-2026-0001-AM-1']}],documents),null);
  assert.equal(votedDocumentId(null,documents),null);
});

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
