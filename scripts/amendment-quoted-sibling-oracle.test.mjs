import test from 'node:test';
import assert from 'node:assert/strict';
import {assertQuotedSibling} from './amendment-quoted-sibling-oracle.mjs';
function zip(xml){const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(raw.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(raw.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+raw.length,16);return Buffer.concat([local,name,raw,central,name,end]);}
function input(lead='(b)\tthe following paragraph 4a is inserted:'){
 const rows=['Article 1','The act is amended as follows:','(3)\tArticle 9 is amended as follows:',lead,'‘4a. Public provision.','Continued text.’',';','(4)\tNext instruction.','Article 2'];
 return {proposal:{paragraphs:rows.map((text,index)=>({index,text,source:{path:`/w:document[1]/w:body[1]/w:p[${index+1}]`}}))},wording:{language:'en',targetLabel:'Article 1 – paragraph 1 – point 3 – point b',proposedText:'The following paragraph 4aa is inserted:\n‘4aa. New text.’'},placement:{operation:'insert',insertAfter:5,insertBefore:6},nativeQuoted:{proposalBuffer:zip('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+rows.map(t=>'<w:p><w:r><w:t>'+t+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>')}};
}
test('raw oracle includes quoted continuations and stops before the instruction terminator',()=>{
 const arg=input();assert.equal(assertQuotedSibling(arg).status,'verified');
 arg.placement.insertBefore=5;arg.placement.insertAfter=4;assert.equal(assertQuotedSibling(arg).status,'failed');
});
test('a quoted subparagraph cannot establish a whole paragraph sibling',()=>assert.equal(assertQuotedSibling(input('(b)\tthe second subparagraph is replaced by the following:')).status,'unverified'));
