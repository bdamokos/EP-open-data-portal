import test from 'node:test';import assert from 'node:assert/strict';
import {assertResolutionBoundaryInsertion} from './amendment-resolution-boundary-oracle.mjs';
import {resolutionBoundaryNative,boundaryParagraph} from './fixtures/resolution-boundary-native.mjs';
test('native citation ordinal and paragraph lead independently establish the insertion boundary',()=>{
 for(const point of [false,true]){const input=resolutionBoundaryNative({point});assert.equal(assertResolutionBoundaryInsertion(input).status,'verified');assert.equal(assertResolutionBoundaryInsertion({...input,placement:{...input.placement,insertAfter:2,insertBefore:3}}).status,'failed');}
});
test('incomplete, nonnative and ambiguous boundary evidence never verifies',()=>{
 for(const point of [false,true])for(const mutate of [a=>delete a.text.nativeBuffer,a=>a.text.paragraphSources[1].complete=false,a=>a.text.paragraphs[1]+=' altered',a=>a.wording.originalText='Existing text',a=>a.wording.proposedText='Unlabelled new text']){const input=resolutionBoundaryNative({point});mutate(input);assert.notEqual(assertResolutionBoundaryInsertion(input).status,'verified',mutate.toString());}
 for(const change of [xml=>xml.replace('The European Parliament,','Other opener'),xml=>xml.replace('</w:body>',boundaryParagraph('The European Parliament,')+'</w:body>'),xml=>xml.replace('<w:t>–','<w:object/><w:t>–')])assert.notEqual(assertResolutionBoundaryInsertion(resolutionBoundaryNative({change})).status,'verified');
 for(const change of [xml=>xml.replace('<w:b/>',''),xml=>xml.replace('<w:i/>',''),xml=>xml.replace('a)','c)'),xml=>xml.replace('suivantes:','suivantes;'),xml=>xml.replace('w:left="300"','w:left="100"')])assert.notEqual(assertResolutionBoundaryInsertion(resolutionBoundaryNative({point:true,change})).status,'verified');
});
test('native note references preserve citation ordinals while visible objects cannot',()=>{
 const input=resolutionBoundaryNative({note:true});assert.equal(assertResolutionBoundaryInsertion(input).status,'verified');
 const object=resolutionBoundaryNative({change:xml=>xml.replace('first source,</w:t>','first source,</w:t><w:object/>')});assert.notEqual(assertResolutionBoundaryInsertion(object).status,'verified');
});
