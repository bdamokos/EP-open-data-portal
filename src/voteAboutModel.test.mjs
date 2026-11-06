import assert from 'node:assert/strict';
import test from 'node:test';
import {textAdoptedId,quotedVote,withoutTally,aboutContent} from './voteAboutModel.mjs';

// Ids from the public EP record for MTG-PL-2026-10-22-OJ-ITM-V-52 (retrieved 2026-11-06): the vote on the
// Commission proposal (DEC-198405, 454/34/93) and a separate vote on part of an amendment (DEC-199360, 423/125/32)
// are two decisions. Neither carries a decided-on link to the adopted text T10-0361/2026.
const blocks=[{kind:'paragraph',text:'The European Parliament adopted by 454 votes to 34, with 93 abstentions, amendments to the proposal for a regulation.'},{kind:'paragraph',text:'The matter was referred back to the committee.'}];
const sitting='MTG-PL-2026-10-22-DEC-';
const votes=[{id:sitting+'198405',decidedDocumentIds:[],aggregateTotals:{for:454,against:34,abstaining:93}},{id:sitting+'199360',decidedDocumentIds:[sitting.replace('DEC-','VOT-ITM-993260-SPLIT-1-2'),'A-10-2026-0257-AM-4'],aggregateTotals:{for:423,against:125,abstaining:32}}];

test('the adopted-text reference maps to its document id exactly',()=>{
  assert.equal(textAdoptedId('T10-0361/2026'),'TA-10-2026-0361');
  assert.equal(textAdoptedId('COM(2025)0549'),null);assert.equal(textAdoptedId(null),null);
});
test('without an exact link to a decision the quoted figure is left out, whatever vote is viewed',()=>{
  assert.equal(quotedVote(votes,'T10-0361/2026'),null);
  for(const viewedId of [votes[0].id,votes[1].id]) {
    const shown=aboutContent({blocks,votes,viewedId,documentReference:'T10-0361/2026'});
    assert.equal(shown.whole,null);
    assert.equal(shown.blocks[0].text,'The European Parliament adopted amendments to the proposal for a regulation.');
    assert.doesNotMatch(JSON.stringify(shown.blocks),/454|93 abstentions/);
  }
  assert.equal(withoutTally('Nothing quoted here.'),'Nothing quoted here.');
});
test('with an exact link the figure stays, and points to that vote unless it is the one viewed',()=>{
  const linked=[{...votes[0],decidedDocumentIds:['TA-10-2026-0361']},votes[1]];
  assert.equal(quotedVote(linked,'T10-0361/2026').id,votes[0].id);
  const part=aboutContent({blocks,votes:linked,viewedId:votes[1].id,documentReference:'T10-0361/2026'});
  assert.equal(part.whole.id,votes[0].id);assert.equal(part.blocks,blocks);
  assert.equal(aboutContent({blocks,votes:linked,viewedId:votes[0].id,documentReference:'T10-0361/2026'}).whole,null);
  const twice=[{...votes[0],decidedDocumentIds:['TA-10-2026-0361']},{...votes[1],decidedDocumentIds:['TA-10-2026-0361']}];
  assert.equal(quotedVote(twice,'T10-0361/2026'),null,'two links name no single vote');
});
