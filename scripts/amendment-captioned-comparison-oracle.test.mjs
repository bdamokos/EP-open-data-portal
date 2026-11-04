import test from 'node:test';import assert from 'node:assert/strict';
import {assertCaptionedComparison} from './amendment-captioned-comparison-oracle.mjs';
import {captionedComparisonNative} from './fixtures/captioned-comparison-native.mjs';
test('native full-width caption before the original heading independently binds both wording columns',()=>{
 const input=captionedComparisonNative();assert.equal(assertCaptionedComparison(input).status,'verified');
 for(const field of ['originalText','proposedText'])assert.equal(assertCaptionedComparison({...input,wording:{...input.wording,[field]:input.wording[field]+' altered'}}).status,'failed');
 for(const change of [a=>delete a.nativeQuoted.amendmentBuffer,a=>a.nativeQuoted.number++,a=>a.wording.targetLabel=a.wording.targetLabel.replace('Aluminium','Other'),a=>a.wording.documentReferences.push(a.wording.documentReferences[0])]){const a=captionedComparisonNative();change(a);assert.equal(assertCaptionedComparison(a).status,'unverified');}
});
test('caption order, repeated caption, exact section headings, legal grid and native visibility remain required',()=>{
 for(const change of [xml=>xml.replace('Aluminium','Other'),xml=>xml.replace(/Aluminium(?![\s\S]*Aluminium)/u,'Other'),xml=>xml.replace('Text proposed by the Commission','Unknown heading'),xml=>xml.replace('w:val="2"','w:val="3"'),xml=>xml.replace('<w:t>Aluminium','<w:vanish/><w:t>Aluminium'),xml=>xml.replace('<w:t>Aluminium','<w:object/><w:t>Aluminium'),xml=>xml.replace('<w:t>Aluminium','<w:t xmlns:w="urn:foreign">Aluminium'),xml=>xml.replace('</w:body>','<w:p><w:r><w:t>Amendment 7</w:t></w:r></w:p></w:body>')])assert.equal(assertCaptionedComparison(captionedComparisonNative({change})).status,'unverified',change.toString());
});
