import test from 'node:test';import assert from 'node:assert/strict';
import {assertCompoundHeader} from './amendment-compound-header-oracle.mjs';
import {compoundHeaderNative} from './fixtures/compound-header-native.mjs';
const target='Recital 17 a (new)',sourceRaw='Proposal for a regulation\n'+target;
const wording=()=>({number:29,language:'en',baseline:'commission-proposal',targetLabel:target,documentReferences:[{field:'DocumentClass',raw:'Proposal for a regulation',sourceRaw,scope:'amendment',basis:'native-line-break'},{field:'Article',raw:target,sourceRaw,scope:'amendment',basis:'native-line-break'}]});
const check=(options={},w=wording())=>assertCompoundHeader({wording:w,nativeQuoted:{number:29,amendmentBuffer:compoundHeaderNative(options)}});
test('independent native compound header binds the exact class, target and amendment',()=>{
 assert.equal(check().status,'verified');const w=wording();Object.defineProperty(w,'units',{get(){throw Error('Production tree accessed');}});assert.equal(check({},w).status,'verified');
 for(const field of ['targetLabel','number','language','baseline']){const w=wording();w[field]='wrong';assert.equal(check({},w).status,'unverified');}
 const changed=wording();changed.documentReferences[1].sourceRaw='different';assert.equal(check({},changed).status,'unverified');
 assert.equal(assertCompoundHeader({wording:{documentReferences:[]}}),null);
});
test('independent header rejects fake breaks, hidden/opaque content, extra metadata and competing headings',()=>{
 for(const headerChange of [
  xml=>xml.replace('<w:br/>','\n'),xml=>xml.replace('<w:br/>','<w:br/><w:br/>'),xml=>xml.replace('<w:br/>','<w:br w:type="page"/>'),
  xml=>xml.replace('<w:b/>','<w:b/><w:vanish/>'),xml=>xml.replace('<w:br/>','<w:fldSimple/><w:br/>'),xml=>xml.replace('<w:br/>','<w:unknown/><w:br/>'),
  xml=>xml.replace('<w:br/>','<w:br/><w:t>Extra</w:t><w:br/>'),xml=>xml.replace('Recital 17 a','Recital 18 a'),
  xml=>xml+'<w:p><w:r><w:t>Recital 20 a (new)</w:t></w:r></w:p>',
  xml=>xml+'<w:p><w:r><w:t>Amendment 29</w:t></w:r></w:p>',
 ])assert.equal(check({headerChange}).status,'unverified');
 assert.equal(check({className:'Motion for a resolution'}).status,'unverified');
});
test('native namespace bindings and opaque text-empty intervening paragraphs are inspected',()=>{
 for(const headerChange of [
  xml=>xml.replace('<w:br/>','<w:br xmlns:w="urn:foreign"/>'),xml=>xml.replace('<w:p>','<w:p xmlns:w="urn:foreign">'),
  xml=>xml+'<w:p><w:r><w:drawing/></w:r></w:p>',xml=>xml+'<w:p><w:unknown/></w:p>',xml=>xml+'<w:p><w:r><w:fldSimple/></w:r></w:p>',
  xml=>xml+'<w:p><w:r><w:br/></w:r></w:p>',
 ])assert.equal(check({headerChange}).status,'unverified');
 assert.equal(check({headerChange:xml=>xml+'<w:p/>'}).status,'verified');
 assert.equal(check({headerChange:xml=>xml.replace('<w:br/>','<w:br xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')}).status,'verified');
});
