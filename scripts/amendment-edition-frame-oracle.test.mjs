import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixtureZip} from './fixtures/bare-annex-indent-native.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';

const outer='Article 1 – paragraph 1 – point 1';
const inner=parent=>`Article 10 a – paragraph ${parent} – subparagraph 2 b (new)`;
const esc=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;');
const p=text=>'<w:p><w:r><w:t>'+esc(text)+'</w:t></w:r></w:p>';
const zip=body=>fixtureZip({'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>'});
function fixture({parents=['2a','2b'],support=true,column=false}={}) {
  const proposed=column?inner('2 a')+'\nAdditional provision.':'Additional provision.';
  const values=['Article 1','Directive 2003/87/EC is amended as follows:',`(1)\tin Article 10a, the following paragraphs ${parents.join(' and ')} are inserted after paragraph 1:`];
  for(const [i,name] of parents.entries())values.push((i?'':'‘')+name+'. First subparagraph.',...(i<parents.length-1?['Second subparagraph.']:[]));
  values[values.length-1]+='’';values.push('Article 2');
  const proposalBuffer=zip(values.map(p).join(''));
  const amendmentBuffer=zip(p('<Amend><NumAm>1</NumAm>')+p('<Article>'+outer+'</Article>')+p('<DocAmend2>Directive 2003/87/EC</DocAmend2>')+p('<Article2>'+inner('2 a')+'</Article2>')+p('<Original>{EN}en</Original>')+'<w:tbl><w:tr><w:tc>'+p('Text proposed by the Commission')+'</w:tc><w:tc>'+p('Amendment')+'</w:tc></w:tr><w:tr><w:tc>'+p('')+'</w:tc><w:tc>'+proposed.split('\n').map(p).join('')+'</w:tc></w:tr></w:tbl>'+p('</Amend>'));
  const wording={language:'en',baseline:'commission-proposal',originalText:'',proposedText:proposed,targetLabel:outer+'\nDirective 2003/87/EC — '+inner('2 a'),addressEditions:[...(support?[{language:'bg',baseline:'commission-proposal',targetLabel:'Член 1 – параграф 1 – точка 1\nДиректива 2003/87/ЕО — Член 10 а – параграф 2 а – алинея 2 б (нова)'}]:[]),{language:'nl',baseline:'commission-proposal',targetLabel:'Artikel 1 – alinea 1 – punt 1\nRichtlijn 2003/87/EG — Artikel 10 bis – lid 2 – alinea 2 ter (nieuw)'}]};
  const proposal={sourceHash:createHash('sha256').update(proposalBuffer).digest('hex'),paragraphs:values.map((text,index)=>({text,index,complete:true,source:{path:`/w:document[1]/w:body[1]/w:p[${index+1}]`,complete:true}}))};
  Object.defineProperty(proposal,'units',{get(){throw Error('placer units forbidden');}});
  const placement={status:'placed',operation:'insert',itemIndex:0,insertAfter:4,insertBefore:5};
  Object.defineProperty(placement,'evidence',{get(){throw Error('placer evidence forbidden');}});
  return {wording,placement,items:[{proposal}],nativeQuoted:{proposalBuffer,amendmentBuffer,number:1}};
}

test('one uniquely fitting native address supported by two editions verifies the boundary',()=>{
  const result=verifyPlacement(fixture());assert.equal(result.status,'verified',result.reason);assert.equal(result.reason,'oracle-native-edition-frame-fit');
  assert.deepEqual(result.assertion.languages,['en','bg']);
});
test('no held address fitting the native frame stays unverified',()=>{
  assert.equal(verifyPlacement(fixture({parents:['3a','3b']})).status,'unverified');
});
test('two distinct addresses fitting the frame stay unverified even if one matches the placement',()=>{
  assert.equal(verifyPlacement(fixture({parents:['2','2a','2b']})).status,'unverified');
});
test('one fitting edition without independent native column labels stays unverified',()=>{
  assert.equal(verifyPlacement(fixture({support:false})).status,'unverified');
});
test('working edition plus native full-address column label supports the unique fit',()=>{
  const result=verifyPlacement(fixture({support:false,column:true}));assert.equal(result.status,'verified',result.reason);assert.equal(result.assertion.nativeColumnSupport,true);
});
test('a unique source fit cannot verify a different boundary or incomplete native frame',()=>{
  const input=fixture();input.placement.insertBefore=6;assert.equal(verifyPlacement(input).status,'failed');
  const damaged=fixture();damaged.items[0].proposal.sourceHash='0'.repeat(64);assert.equal(verifyPlacement(damaged).status,'unverified');
});
