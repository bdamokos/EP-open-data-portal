import test from 'node:test';
import {crc32} from 'node:zlib';
import assert from 'node:assert/strict';
import {languageQuotedSibling} from './amendment-language-quoted-oracle.mjs';
import {rawDocument,rawExpected,verifyLanguagePlacement} from './amendment-language-oracle.mjs';
import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
function zip(xml){const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(crc32(raw),14);local.writeUInt32LE(raw.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(crc32(raw),16);central.writeUInt32LE(raw.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+raw.length,16);return Buffer.concat([local,name,raw,central,name,end]);}
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const p=s=>'<w:p><w:r><w:t>'+escape(s)+'</w:t></w:r></w:p>';
const doc=s=>zip('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+s+'</w:body></w:document>');
function input(mutate=rows=>rows){
 const rows=mutate(['Article 2\nAmendments to Regulation (EU) No 2024/1234','Regulation (EU) 2024/1234 is amended as follows:','(8) Articles 10 and 11 are replaced by the following:','“Article 10','First title','1. First article.','Article 11','Second title','1. First paragraph.','2. Last paragraph.','','(9) Article 12 is replaced by the following:']);
 const proposalBuffer=doc(rows.map(p).join(''));
 const amendmentBuffer=doc(['Amendment 6','Proposal for a regulation','Article 2 – paragraph 1 – point 8','Regulation (EU) No 2024/1234','Article 11 – paragraph 2 a (new)'].map(p).join('')+'<w:tbl><w:tr><w:tc>'+p('Text proposed by the Commission')+'</w:tc><w:tc>'+p('Amendment')+'</w:tc></w:tr><w:tr><w:tc>'+p('')+'</w:tc><w:tc>'+p('2a. New provision.')+'</w:tc></w:tr></w:tbl>'+p('</Amend>'));
 const expected=rawExpected(rawDocument(amendmentBuffer).amendments[0],'en');
 const paragraphs=quotedWordBody(proposalBuffer).filter(r=>r.text.trim()).map((r,index)=>({index,text:r.text.trim(),source:{path:r.path}}));
 return {expected,proposal:{paragraphs},placement:{status:'placed',operation:'insert',insertAfter:9,insertBefore:10},nativeQuoted:{proposalBuffer,amendmentBuffer,number:6}};
}
test('native whole-article instruction proves a final paragraph sibling without a closing quote',()=>{
 const arg=input();assert.equal(languageQuotedSibling(arg).status,'verified');
 const verified=verifyLanguagePlacement({...arg,items:[{proposal:arg.proposal}],rawItems:[rawDocument(arg.nativeQuoted.proposalBuffer)],placement:{...arg.placement,itemIndex:0}});
 assert.equal(verified.status,'verified');
 for(const before of [9,11])assert.equal(languageQuotedSibling({...arg,placement:{...arg.placement,insertBefore:before,insertAfter:before-1}}).status,'failed');
});
test('native address, whole extent, next instruction and exact projection are mandatory',()=>{
 for(const mutate of [
  r=>r.map(t=>t.replace('Articles 10 and 11 are replaced','Article 11, paragraph 2 is replaced')),
  r=>r.map(t=>t.replace('Article 11','Article 13')),
  r=>r.filter(t=>!t.startsWith('(9)')),
  r=>r.map(t=>t.replace('(9)','(10)')),
  r=>[...r.slice(0,10),'Continued text.',...r.slice(10)],
  r=>r.map(t=>t.replace('1. First paragraph.','3. First paragraph.')),
  r=>[...r.slice(0,9),'(a) Subordinate point.',...r.slice(9)],
 ])assert.equal(languageQuotedSibling(input(mutate)).status,'unverified');
 const arg=input();arg.proposal.paragraphs[9].text='Different text.';assert.equal(languageQuotedSibling(arg).status,'unverified');
 const different=input();different.expected.underlyingSection='Regulation (EU) No 2024/9999';assert.equal(languageQuotedSibling(different).status,'unverified');
 const hidden=input();hidden.nativeQuoted.proposalBuffer=doc(quotedWordBody(hidden.nativeQuoted.proposalBuffer).map(r=>p(r.text).replace('<w:r>','<w:r><w:rPr><w:vanish/></w:rPr>')).join(''));assert.equal(languageQuotedSibling(hidden).status,'unverified');
});
