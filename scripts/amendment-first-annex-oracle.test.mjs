import test from 'node:test';import assert from 'node:assert/strict';
import {assertFirstAnnex} from './amendment-first-annex-oracle.mjs';
import {firstAnnexNative,firstAnnexZip} from './fixtures/first-annex-native.mjs';
import {createHash} from 'node:crypto';
import {quotedWordParts} from './amendment-benchmark-quoted-oracle.mjs';
import {makeAnnexIndentCase} from './fixtures/bare-annex-indent-native.mjs';
test('first annex binds the complete native signature and separate financial statement',()=>{
 const input=firstAnnexNative();Object.defineProperty(input.proposal,'units',{get(){throw Error('Production hierarchy accessed');}});assert.equal(assertFirstAnnex(input).status,'verified');
 for(const target of ['Annex I - Indicators','Annex - Indicators','Annex'])assert.equal(assertFirstAnnex(firstAnnexNative({target})).status,'verified');
 for(const label of ['Amendment1','AMENDMENT 1'])assert.equal(assertFirstAnnex(firstAnnexNative({amendmentChange:xml=>xml.replace('Amendment\t\t1',label)})).status,'verified');
});
test('first-annex boundary cannot shift or lose its complete native coordinates',()=>{
 for(const mutate of [x=>x.placement.insertBefore++,x=>x.placement.insertAfter--,x=>x.placement.itemIndex=1]){const input=firstAnnexNative();mutate(input);assert.equal(assertFirstAnnex(input)?.status,'failed');}
 for(const mutate of [x=>x.proposal.sourceHash='wrong',x=>x.nativeQuoted.proposalBuffer=Buffer.from('wrong'),x=>x.nativeQuoted.amendmentBuffer=undefined,x=>x.proposal.paragraphs[x.placement.insertAfter].complete=false,x=>x.proposal.paragraphs[x.placement.insertAfter].source.ordinal++]){const input=firstAnnexNative();mutate(input);assert.notEqual(assertFirstAnnex(input)?.status,'verified');}
});
test('native annexes and hidden or wrapped signature competitors remain evidence',()=>{
 for(const text of ['ANNEX I','Done at Brussels,','The President\tThe President','LEGISLATIVE FINANCIAL AND DIGITAL STATEMENT'])for(const wrap of [p=>p,p=>'<w:sdt><w:sdtContent>'+p+'</w:sdtContent></w:sdt>']){
  const extra=wrap('<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:ins><w:t>'+text+'</w:t></w:ins></w:r></w:p>');assert.notEqual(assertFirstAnnex(firstAnnexNative({sourceChange:xml=>xml.replace('</w:body>',extra+'</w:body>')})).status,'verified');
 }
});
test('the complete original/proposed comparison and its first-annex frame are mandatory',()=>{
 for(const amendmentChange of [xml=>xml.replace('Published complete','Changed complete'),xml=>xml.replace('<w:tc>','<w:tc><w:unknown/>'),xml=>xml.replace('gridSpan w:val="2"','gridSpan w:val="3"'),xml=>xml.replace('<w:t>ANNEX</w:t>','<w:t>TABLE</w:t>'),xml=>xml.replace('<w:t>ANNEX</w:t>','<w:t>ANNEX II</w:t>')]){const input=firstAnnexNative({amendmentChange});input.wording=firstAnnexNative().wording;assert.notEqual(assertFirstAnnex(input)?.status,'verified');}
 for(const sourceChange of [xml=>xml.replace('Fait','Other'),xml=>xml.replace('<w:t>Done at Brussels,</w:t>','<w:unknown/><w:t>Done at Brussels,</w:t>'),xml=>xml.replace('<w:t>Article 1</w:t>','<w:fldSimple><w:r><w:t>Article 1</w:t></w:r></w:fldSimple>'),xml=>xml.replace('<w:t>Done at Brussels,</w:t>','<w:t xmlns:w="urn:foreign">Done at Brussels,</w:t>'),xml=>xml.replace('The President\tThe President','Other signatory')])assert.notEqual(assertFirstAnnex(firstAnnexNative({sourceChange}))?.status,'verified');
});
test('inspected empty payload paragraphs are layout, opaque paragraphs remain unavailable',()=>{
 const input=firstAnnexNative({amendmentChange:xml=>xml.replace('<w:t>INDICATORS</w:t></w:r></w:p>','<w:t>INDICATORS</w:t></w:r></w:p><w:p/>')});assert.equal(assertFirstAnnex(input).status,'verified');
 const opaque=firstAnnexNative({amendmentChange:xml=>xml.replace('<w:t>INDICATORS</w:t></w:r></w:p>','<w:t>INDICATORS</w:t></w:r></w:p><w:p><w:unknown/></w:p>')});opaque.wording=firstAnnexNative().wording;assert.notEqual(assertFirstAnnex(opaque)?.status,'verified');
});
test('paragraph and run properties cannot hide additional proposed wording',()=>{
 for(const amendmentChange of [xml=>xml.replace('<w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>INDICATORS','<w:pPr><w:pStyle w:val="Normal"/><w:t>Opaque text</w:t></w:pPr><w:r><w:t>INDICATORS'),xml=>xml.replace('<w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>INDICATORS','<w:pPr><w:pStyle w:val="Normal"/><w:r><w:t>Opaque text</w:t></w:r></w:pPr><w:r><w:t>INDICATORS'),xml=>xml.replace('<w:r><w:t>INDICATORS','<w:r><w:rPr><w:t>Opaque text</w:t></w:rPr><w:t>INDICATORS')]){const input=firstAnnexNative({amendmentChange});input.wording=firstAnnexNative().wording;assert.notEqual(assertFirstAnnex(input)?.status,'verified');}
});
test('deleted and field text cannot hide competing native annex evidence',()=>{
 for(const tag of ['w:delText','w:instrText']){const extra='<w:p><w:r><'+tag+'>ANNEX I</'+tag+'></w:r></w:p>',input=firstAnnexNative({sourceChange:xml=>xml.replace('</w:body>',extra+'</w:body>')});assert.notEqual(assertFirstAnnex(input)?.status,'verified');}
});

test('style definitions are required to certify proposal and amendment visibility',()=>{
 for(const key of ['proposalBuffer','amendmentBuffer']){
  const input=firstAnnexNative(),parts=quotedWordParts(input.nativeQuoted[key]);parts.delete('word/styles.xml');input.nativeQuoted[key]=firstAnnexZip(Object.fromEntries(parts));
  if(key==='proposalBuffer')input.proposal.sourceHash=createHash('sha256').update(input.nativeQuoted[key]).digest('hex');
  assert.notEqual(assertFirstAnnex(input)?.status,'verified');
 }
});

test('Word namespace aliases cannot hide annex, style or numbering evidence',()=>{
 const URI='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 for(const prefix of ['x','word']){
  const extra=`<${prefix}:p xmlns:${prefix}="${URI}"><${prefix}:r><${prefix}:t>ANNEX I</${prefix}:t></${prefix}:r></${prefix}:p>`;
  assert.notEqual(assertFirstAnnex(firstAnnexNative({sourceChange:xml=>xml.replace('</w:body>',extra+'</w:body>')})).status,'verified');
  assert.notEqual(assertFirstAnnex(firstAnnexNative({stylesChange:xml=>xml.replace('w:styleId="Fait" w:type="paragraph"/>',`w:styleId="Fait" w:type="paragraph" xmlns:${prefix}="${URI}"><w:rPr><${prefix}:vanish/></w:rPr></w:style>`)})).status,'verified');
 }
 const input=firstAnnexNative(),parts=quotedWordParts(input.nativeQuoted.proposalBuffer);parts.set('word/numbering.xml',`<x:numbering xmlns:x="${URI}"><x:abstractNum x:abstractNumId="1"><x:lvl x:ilvl="0"><x:lvlText x:val="ANNEX %1"/></x:lvl></x:abstractNum></x:numbering>`);input.nativeQuoted.proposalBuffer=firstAnnexZip(Object.fromEntries(parts));input.proposal.sourceHash=createHash('sha256').update(input.nativeQuoted.proposalBuffer).digest('hex');assert.notEqual(assertFirstAnnex(input).status,'verified');
 const canonical=firstAnnexNative({sourceChange:xml=>xml.replace('<w:t>Done at Brussels,',`<w:t xmlns:w="${URI}">Done at Brussels,`)});assert.equal(assertFirstAnnex(canonical).status,'verified');
});
test('every empty layout paragraph must be visible and inspectable',()=>{
 for(const content of ['<w:drawing/>','<w:unknown/>','<w:fldChar w:fldCharType="begin"/>','<w:fldSimple w:instr="INCLUDETEXT"/>']){
  const input=firstAnnexNative({amendmentChange:xml=>xml.replace('<w:t></w:t>','<w:t></w:t>'+content)});input.wording=firstAnnexNative().wording;assert.notEqual(assertFirstAnnex(input).status,'verified');
 }
});
test('native amendment-number uniqueness includes wrapped and hidden paragraphs',()=>{
 const p='<w:p><w:r><w:t>Amendment 1</w:t></w:r></w:p>';
 for(const wrap of [p=>'<w:sdt><w:sdtContent>'+p+'</w:sdtContent></w:sdt>',p=>'<w:ins w:id="999">'+p+'</w:ins>',p=>'<w:tbl><w:tr><w:tc>'+p+'</w:tc></w:tr></w:tbl>'])for(const hidden of [false,true]){
  const extra=wrap(hidden?p.replace('<w:r>','<w:r><w:rPr><w:vanish/></w:rPr>'):p),input=firstAnnexNative({amendmentChange:xml=>xml.replace('<w:body>','<w:body>'+extra)});input.wording=firstAnnexNative().wording;assert.notEqual(assertFirstAnnex(input).status,'verified');
 }
});

test('interior annex amendments stay outside the first-annex oracle',()=>{
 assert.equal(assertFirstAnnex(makeAnnexIndentCase()),null);
});
