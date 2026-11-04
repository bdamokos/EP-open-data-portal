import test from 'node:test';import assert from 'node:assert/strict';
import {extractAmendments} from './amendment-documents.mjs';
import {assertCaptionedComparison} from '../scripts/amendment-captioned-comparison-oracle.mjs';
import {captionedComparisonNative} from '../scripts/fixtures/captioned-comparison-native.mjs';
const read=input=>extractAmendments(input.nativeQuoted.amendmentBuffer,{language:'en',listId:'A-10-2026-0001-AM-007-007',targetDocumentId:'A-10-2026-0001'}).amendments[0];
test('a caption preceding the first stacked heading stays on the original wording side',()=>{
 const input=captionedComparisonNative(),wording=read(input);assert.equal(wording.originalText,input.wording.originalText);assert.equal(wording.proposedText,input.wording.proposedText);assert.equal(assertCaptionedComparison({...input,wording}).status,'verified');assert(!wording.gaps.some(gap=>['comparison-grid','comparison-header','text-unavailable'].includes(gap.code)));
});
test('caption recovery requires exact repeated framing and supported grid geometry',()=>{
 for(const change of [xml=>xml.replace(/Aluminium(?![\s\S]*Aluminium)/u,'Other'),xml=>xml.replace('Text proposed by the Commission','Unknown heading'),xml=>xml.replace('w:val="2"','w:val="3"'),xml=>xml.replace('<w:t>Aluminium','<w:object/><w:t>Aluminium'),xml=>xml.replace('<w:t>Aluminium','<w:vanish/><w:t>Aluminium')]){const wording=read(captionedComparisonNative({change}));assert.equal(wording.originalText,null);assert.equal(wording.proposedText,null);}
});

test('native cell line breaks stay inside their cell when verifying a table-level placement',async()=>{
 const {tableContextNative}=await import('../scripts/fixtures/table-context-native.mjs'),{resolveProposalPlacement}=await import('./proposal-placement.mjs'),{verifyPlacement}=await import('../scripts/amendment-benchmark-model.mjs');
 const amendment=captionedComparisonNative({change:xml=>xml.replace('Native aluminium description','Native aluminium</w:t><w:br/><w:t>description')}),wording=read(amendment),source=tableContextNative({change:xml=>xml.replaceAll('Fertilisers','Aluminium').replaceAll('28342100','76069100').replaceAll('Nitrate of potassium','Native aluminium description')});
 const placement=resolveProposalPlacement(source.items,wording,{nativeProposalInputs:source.nativeProposalInputs});assert.equal(placement.status,'placed',placement.reason);assert.equal(placement.splice,undefined);assert.equal(verifyPlacement({...source,wording,placement,nativeQuoted:{...source.nativeQuoted,...amendment.nativeQuoted}}).status,'verified');
 const wrong={...wording,originalText:wording.originalText.replace('aluminium\ndescription','aluminium\t\ndescription')};assert.equal(resolveProposalPlacement(source.items,wrong,{nativeProposalInputs:source.nativeProposalInputs}).status,'unresolved');assert.notEqual(verifyPlacement({...source,wording:wrong,placement,nativeQuoted:{...source.nativeQuoted,...amendment.nativeQuoted}}).status,'verified');
});

test('caption recovery requires one explicit two-column grid, not an inferred width',()=>{
 for(const replacement of ['', '<w:tblGrid/>']){
  const wording=read(captionedComparisonNative({change:xml=>xml.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/u,replacement)}));
  assert.equal(wording.originalText,null);assert.equal(wording.proposedText,null);assert(!wording.documentReferences.some(ref=>ref.basis==='caption-before-original-heading'));
 }
});
