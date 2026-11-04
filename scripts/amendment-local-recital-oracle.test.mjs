import test from 'node:test';import assert from 'node:assert/strict';import {assertLocalRecitalBoundary} from './amendment-local-recital-oracle.mjs';
// Missing native bytes or an incomplete identity never borrows producer evidence.
test('local recital oracle requires native source, amendment and exact new label',()=>{
 for(const wording of [{},{language:'en',baseline:'commission-proposal',targetLabel:'Recital 1a (new)',originalText:'',proposedText:'(1a) Added.'}])assert.equal(assertLocalRecitalBoundary({proposal:{},wording,placement:{operation:'insert',insertBefore:2},nativeQuoted:null}).status,'unverified');
});
import {fixtureZip} from './fixtures/bare-annex-indent-native.mjs';
const p=text=>'<w:p><w:r><w:t>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t></w:r></w:p>';
const zip=body=>fixtureZip({'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>'});
function example(){const texts=['Whereas:','(1) First recital.','(2) Second recital.','(11) Old numbering.','(11) New numbering.','HAVE ADOPTED THIS DIRECTIVE:'];return {proposal:{paragraphs:texts.map((text,index)=>({text,index,complete:true,source:{path:`/w:document[1]/w:body[1]/w:p[${index+1}]`}}))},wording:{language:'en',baseline:'commission-proposal',targetLabel:'Recital 1 a (new)',originalText:'',proposedText:'(1a) Added.'},placement:{operation:'insert',insertAfter:1,insertBefore:2},nativeQuoted:{number:19,proposalBuffer:zip(texts.map(p).join('')),amendmentBuffer:zip(p('<Amend><NumAm>19</NumAm>')+p('<Article>Recital 1 a (new)</Article>')+'<w:tbl><w:tr><w:tc>'+p('Text proposed by the Commission')+'</w:tc><w:tc>'+p('Amendment')+'</w:tc></w:tr><w:tr><w:tc>'+p('')+'</w:tc><w:tc>'+p('(1a) Added.')+'</w:tc></w:tr></w:tbl>'+p('</Amend>'))}};}
test('native adjacent recitals certify their own boundary despite later duplicate numbers',()=>{
 assert.equal(assertLocalRecitalBoundary(example()).status,'verified');
 const moved=example();moved.placement.insertBefore++;assert.equal(assertLocalRecitalBoundary(moved).status,'failed');
 for(const mutate of [a=>a.proposal.paragraphs[2].complete=false,a=>a.wording.targetLabel='Recital 9 a (new)',a=>a.wording.proposedText='(1a) Other text.']){const a=example();mutate(a);assert.equal(assertLocalRecitalBoundary(a).status,'unverified');}
});
