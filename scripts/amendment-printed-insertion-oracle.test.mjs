import test from 'node:test';import assert from 'node:assert/strict';
import {assertPrintedInsertion} from './amendment-printed-insertion-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
import {printedInsertionNative} from './fixtures/printed-insertion-native.mjs';
test('native printed 20a overrides label 20 only at the full outer instruction boundary',()=>{
 const input=printedInsertionNative();Object.defineProperty(input.items[0].proposal,'units',{get(){throw Error('No production units');}});Object.defineProperty(input.placement,'evidence',{get(){throw Error('No placement evidence');}});
 assert.equal(assertPrintedInsertion(input).status,'verified');assert.equal(verifyPlacement(input).status,'verified');
 for(const delta of [-4,-1,1])assert.equal(assertPrintedInsertion({...input,placement:{status:'placed',operation:'insert',itemIndex:0,insertBefore:input.placement.insertBefore+delta,insertAfter:input.placement.insertAfter+delta}}).status,'failed');
});
test('missing native inputs, mismatched comparison, ambiguous labels and incomplete projection withhold',()=>{
 for(const change of [a=>a.nativeQuoted.amendmentBuffer=null,a=>a.wording.proposedText+=' altered',a=>a.items[0].proposal.paragraphs[23].text='Clipped',a=>a.items[0].proposal.paragraphs[23].complete=false,a=>a.items[0].proposal.paragraphs[23].source.path='/invented']){const input=printedInsertionNative();change(input);assert.notEqual(assertPrintedInsertion(input)?.status,'verified');assert.notEqual(verifyPlacement(input).status,'verified');}
 for(const changeSource of [s=>s.replace('(21) Annex','(20a) Annex'),s=>s.replace('(19) Existing','(20) Existing'),s=>s.replace('(i) its nested detail;','<w:drawing/>'),s=>s.replace('Article 2','Missing end')])assert.equal(assertPrintedInsertion(printedInsertionNative({changeSource})).status,'unverified');
});
