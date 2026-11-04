import test from 'node:test';import assert from 'node:assert/strict';
import {printedInsertionNative} from '../scripts/fixtures/printed-insertion-native.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const resolve=a=>resolveProposalPlacement(a.items,a.wording,{nativeProposalInputs:a.nativeQuoted.proposalBuffers});
test('printed Na insertion follows the full N instruction and preserves the published labels',()=>{
 const a=printedInsertionNative(),w=structuredClone(a.wording),p=resolve(a);assert.equal(p.status,'placed');assert.equal(p.insertBefore,a.placement.insertBefore);assert.equal(p.insertAfter,a.placement.insertAfter);assert(p.evidence.some(e=>e.basis==='printed-new-point-label'&&e.label==='20'&&e.reference==='20a'));assert.equal(verifyPlacement({...a,placement:p}).status,'verified');assert.deepEqual(a.wording,w);
});
test('existing Na, duplicate N, wrong base, non-insertions and incomplete anchors stay withheld',()=>{
 for(const change of [a=>a.wording.proposedText=a.wording.proposedText.replace('(20a)','(19a)'),a=>a.wording.originalText='Existing text',a=>a.wording.baseline='present-text',a=>a.wording.targetPath.proposal.push({raw:'Article 2'}),a=>a.items[0].proposal.paragraphs[23].complete=false]){const a=printedInsertionNative();change(a);assert.notEqual(resolve(a).status,'placed');}
 for(const changeSource of [s=>s.replace('(21) Annex','(20a) Annex'),s=>s.replace('(19) Existing','(20) Existing')])assert.notEqual(resolve(printedInsertionNative({changeSource})).status,'placed');
});
