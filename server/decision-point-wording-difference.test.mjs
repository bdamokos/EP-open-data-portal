import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveAmendmentPlacement} from './document-context-model.mjs';
import {assertResolutionPointSimilarity} from '../scripts/amendment-resolution-point-similarity-oracle.mjs';
const native=JSON.parse(readFileSync(new URL('./fixtures/decision-point-wording-difference.json',import.meta.url)));
function input(){
 const paragraphs=['The European Parliament,','1. First provision.','2. Decides the following:','(a) First point.','(b) Second point.',native.nativePoint,'(d) Next point.','3. Closing provision.'];
 const text={structureStatus:'extracted',language:'en',textLanguage:'en',paragraphs,paragraphFormats:paragraphs.map((_,i)=>({indent:i>=3&&i<=6?360:0})),paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))};
 const wording={targetLabel:native.targetLabel,language:'en',baseline:'unknown',resolutionDocument:true,documentReferences:[{field:'DocAmend',raw:'Proposal for a decision'}],baselineSource:{headings:[{left:{raw:'Proposal for a decision'},right:{raw:'Amendment'}}]},originalText:native.original,proposedText:native.proposed};
 return {text,wording};
}
test('native decision point wording differences need the complete unique address',()=>{
 const {text,wording}=input(),placement=resolveAmendmentPlacement(text,wording);
 assert.equal(placement.status,'placed',placement.reason);assert.deepEqual(placement.span,{start:5,end:5});assert.equal(placement.evidence.at(-1).basis,'decision-point-original-difference');
 assert.equal(assertResolutionPointSimilarity({text,wording,placement}).status,'verified');
 const forced={status:'placed',operation:'replace',span:{start:5,end:5}};
 for(const mutate of [a=>a.wording.baseline='motion-resolution',a=>a.wording.targetLabel='Paragraph 1 – point c',a=>a.text.paragraphSources[5].complete=false,a=>a.wording.originalText=a.wording.originalText.replace('2027','2028'),a=>a.text.paragraphs[4]='(b) '+native.original.slice(4)]){
  const a=input();mutate(a);assert.equal(resolveAmendmentPlacement(a.text,a.wording).status,'unresolved',String(mutate));assert.notEqual(assertResolutionPointSimilarity({...a,placement:forced}).status,'verified',String(mutate));
 }
});
