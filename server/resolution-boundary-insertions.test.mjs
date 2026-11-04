import test from 'node:test';import assert from 'node:assert/strict';
import {resolveAmendmentPlacement} from './document-context-model.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
import {resolutionBoundaryNative,boundaryParagraph} from '../scripts/fixtures/resolution-boundary-native.mjs';
const place=input=>resolveAmendmentPlacement(input.text,input.wording);
test('a new ordinal citation precedes the existing ordinal, preserving both labels',()=>{
 const input=resolutionBoundaryNative(),placement=place(input);assert.equal(placement.status,'placed',placement.reason);assert.equal(placement.insertBefore,2);assert.equal(placement.evidence.at(-1).basis,'citation-number-collision');assert.equal(verifyPlacement({...input,placement}).status,'verified');
});
test('a numeric first bis point in a lettered list follows the paragraph lead before its topic heading',()=>{
 const input=resolutionBoundaryNative({point:true}),placement=place(input);assert.equal(placement.status,'placed',placement.reason);assert.equal(placement.insertBefore,2);assert.equal(placement.evidence.at(-1).basis,'first-numeric-point-in-lettered-list');assert.equal(verifyPlacement({...input,placement}).status,'verified');
});
test('boundary placement requires complete predecessors, the printed new label and an agreeing reference',()=>{
 for(const point of [false,true])for(const mutate of [a=>a.text.paragraphSources[1].complete=false,a=>a.text.paragraphSources[2].ordinal+=2,a=>a.wording.proposedText='Unlabelled text']){const input=resolutionBoundaryNative({point});mutate(input);assert.equal(place(input).status,'unresolved',mutate.toString());}
 const referenced=resolutionBoundaryNative();referenced.wording.referenceText='After §4';assert.equal(place(referenced).status,'unresolved');
 for(const change of [xml=>xml.replace('<w:b/>',''),xml=>xml.replace('<w:i/>',''),xml=>xml.replace('a)','c)'),xml=>xml.replace('suivantes:','suivantes;')])assert.equal(place(resolutionBoundaryNative({point:true,change})).status,'unresolved');
});

test('multiline citation extents remain withheld by the ordinal insertion fallback',()=>{
 const input=resolutionBoundaryNative({change:xml=>xml.replace('first source,</w:t></w:r></w:p>','first source,</w:t></w:r></w:p>'+boundaryParagraph('continued source reference,'))});assert.equal(place(input).status,'unresolved');
});
