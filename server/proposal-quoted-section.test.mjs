import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
import {quotedSectionNative} from '../scripts/fixtures/quoted-section-native.mjs';
const place=input=>resolveProposalPlacement([{kind:'annex',proposal:input.proposal}],input.wording,{nativeProposalInputs:[input.nativeQuoted.proposalBuffer]});
test('unparsed printed whole-section address places a last quoted letter sibling with independent verification',()=>{
 const input=quotedSectionNative(),placement=place(input);assert.equal(placement.status,'placed');assert.equal(placement.insertBefore,input.placement.insertBefore);assert.equal(verifyPlacement({items:[{kind:'annex',proposal:input.proposal}],wording:input.wording,placement,nativeQuoted:input.nativeQuoted}).status,'verified');
 assert.notEqual(resolveProposalPlacement([{kind:'annex',proposal:input.proposal}],input.wording).status,'placed','native bytes are required only by the new path');
});
test('the section path, complete native counter and final quoted point stay binding',()=>{
 const sources=[xml=>xml.replace('section 1.6 is replaced','section 1.7 is replaced'),xml=>xml.replace('1272/2008','1272/2009'),xml=>xml.replace('(b) Last','(c) Last'),xml=>xml.replace('Last supplier.’;','Last supplier;'),xml=>xml.replace('<w:t>(b) Last supplier.’;</w:t>','<w:fldSimple w:instr="INCLUDETEXT"><w:r><w:t>(b) Last supplier.’;</w:t></w:r></w:fldSimple>'),xml=>xml.replace('<w:t>(b) Last supplier.’;</w:t>','<w:t>(b) Last supplier.’;</w:t><w:unknown/>'),xml=>xml.replace('<w:t>(b) Last supplier.’;</w:t>','<w:rPr><w:vanish/></w:rPr><w:t>(b) Last supplier.’;</w:t>'),xml=>xml.replace('w:numId w:val="6"','w:numId w:val="7"')];
 for(const sourceChange of sources)assert.notEqual(place(quotedSectionNative({sourceChange})).status,'placed',sourceChange.toString());
 for(const numberingChange of [xml=>xml.replace('<w:startOverride w:val="1"/>','<w:startOverride w:val="2"/>'),xml=>xml.replace('(%1)','%1.'),xml=>xml.replace('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"','xmlns:w="urn:unsupported"')])assert.notEqual(place(quotedSectionNative({numberingChange})).status,'placed');
});
test('conflicting structured addresses, deeper/new targets and damaged projections cannot enter the new path',()=>{
 for(const mutate of [x=>x.wording.targetLabel=x.wording.targetLabel.replace('(b a)','(a a)'),x=>x.wording.targetLabel=x.wording.targetLabel.replace('section 1.6','section 1.7'),x=>x.wording.targetLabel=x.wording.targetLabel.replace('point 2','point 3'),x=>x.wording.targetPath.underlying=[{raw:'Annex II – point b'}],x=>x.wording.originalText='Old wording',x=>x.wording.baseline='present-text',x=>x.nativeQuoted.proposalBuffer=Buffer.from('wrong bytes'),x=>x.proposal.paragraphs[x.placement.insertAfter].source.complete=false,x=>x.proposal.paragraphs[x.placement.insertBefore].source.segment++]){
  const input=quotedSectionNative();input.proposal=structuredClone(input.proposal);mutate(input);assert.notEqual(place(input).status,'placed',mutate.toString());
 }
});
