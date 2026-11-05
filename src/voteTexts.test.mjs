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
