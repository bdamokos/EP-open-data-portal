import test from 'node:test';import assert from 'node:assert/strict';
import {resolveAmendmentPlacement} from './document-context-model.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
import {resolutionBoundaryNative,boundaryParagraph} from '../scripts/fixtures/resolution-boundary-native.mjs';
const example=()=>{
 const input=resolutionBoundaryNative({point:true,change:xml=>xml.replace(boundaryParagraph('b)\tdeuxième point;',{indent:300}),[...'bcdefghijklm'].map(l=>boundaryParagraph(l+')\tPublished point;',{indent:300})).join(''))});
 input.wording.addressEditions=[{language:'en',baseline:'motion-resolution',targetLabel:'Paragraph 1 – point l a (new)'},{language:'bg',baseline:'motion-resolution',targetLabel:'Параграф 1 – буква л а (нова)'}];
 return input;
};
test('a numeric address in a lettered list uses agreeing held editions',()=>{
 const input=example(),placement=resolveAmendmentPlacement(input.text,input.wording);
 assert.equal(placement.status,'placed',placement.reason);assert.deepEqual([placement.insertAfter,placement.insertBefore],[14,15]);assert.equal(verifyPlacement({...input,placement}).status,'verified');
 assert.match(input.wording.targetLabel,/point 1 bis/);
});
test('missing, disagreeing, unparsed or absent edition targets withhold',()=>{
 for(const change of [w=>delete w.addressEditions,w=>w.addressEditions[1].targetLabel='Параграф 1 – буква м а (нова)',w=>w.addressEditions[0].targetLabel='Paragraph 999 – point l a (new)',w=>w.addressEditions[0].targetLabel='Unknown']){
  const input=example();change(input.wording);assert.equal(resolveAmendmentPlacement(input.text,input.wording).status,'unresolved');
 }
});
