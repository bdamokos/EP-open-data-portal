import test from 'node:test';import assert from 'node:assert/strict';
import {extractAmendments} from './amendment-documents.mjs';
import {assertCompoundHeader} from '../scripts/amendment-compound-header-oracle.mjs';
import {compoundHeaderNative} from '../scripts/fixtures/compound-header-native.mjs';
const extract=(options={},language='en')=>{const buffer=compoundHeaderNative(options),wording=extractAmendments(buffer,{language,listId:'A-10-2026-0001-AM-001-029'}).amendments[0];return {buffer,wording};};
test('one physical Word line break separates a printed class and complete target',()=>{
 for(const target of ['Recital 17 a (new)','Recital 17 b (new)','Article 4 a – paragraph 5 (new)','Article 2 – paragraph 1']){
  const {buffer,wording}=extract({target});assert.equal(wording.targetLabel,target);assert.equal(wording.baseline,'commission-proposal');
  assert.equal(wording.documentReferences.filter(ref=>ref.basis==='native-line-break').length,2);
  assert.equal(assertCompoundHeader({wording,nativeQuoted:{number:29,amendmentBuffer:buffer}}).status,'verified');
 }
});
test('compound metadata recovery rejects opaque content and ambiguous physical headers',()=>{
 for(const headerChange of [
  xml=>xml.replace('<w:br/>','\n'),xml=>xml.replace('<w:br/>','<w:br/><w:br/>'),xml=>xml.replace('<w:br/>','<w:br w:type="page"/>'),
  xml=>xml.replace('<w:b/>','<w:b/><w:vanish/>'),xml=>xml.replace('<w:b/>','<w:b/><w:webHidden/>'),
  xml=>xml.replace('<w:br/>','<w:unknown/><w:br/>'),xml=>xml.replace('<w:br/>','<w:fldSimple/><w:br/>'),
  xml=>xml.replace('<w:br/>','<w:br/><w:t>Extra header</w:t><w:br/>'),xml=>xml.replace('Recital 17 a (new)','Unparsed location'),
  xml=>xml+'<w:p><w:r><w:t>Article 3</w:t></w:r></w:p>',
  xml=>xml.replace('<w:br/>','<w:br xmlns:w="urn:foreign"/>'),xml=>xml.replace('<w:p>','<w:p xmlns:w="urn:foreign">'),
  xml=>xml+'<w:p><w:r><w:drawing/></w:r></w:p>',xml=>xml+'<w:p><w:unknown/></w:p>',
 ]){const {wording}=extract({headerChange});assert.equal(wording.documentReferences.some(ref=>ref.basis==='native-line-break'),false,headerChange.toString());}
 for(const className of ['Motion for a resolution','Proposal for an unknown act'])assert.equal(extract({className}).wording.targetLabel,null);
 assert.equal(extract({},'fr').wording.targetLabel,null);
 assert.equal(extract({namespace:'urn:unrelated'}).wording.targetLabel,null);
});
test('hidden default and inherited styles cannot supply compound metadata',()=>{
 for(const hidden of ['vanish','webHidden'])for(const stylesXml of [
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:'+hidden+'/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Default" w:type="paragraph" w:default="1"><w:basedOn w:val="Hidden"/></w:style><w:style w:styleId="Hidden"><w:rPr><w:'+hidden+'/></w:rPr></w:style></w:styles>',
 ]){
  const {buffer,wording}=extract({stylesXml});assert.equal(wording.documentReferences.some(ref=>ref.basis==='native-line-break'),false);
  const plain=extract().wording;assert.equal(assertCompoundHeader({wording:plain,nativeQuoted:{number:29,amendmentBuffer:buffer}}).status,'unverified');
 }
});
