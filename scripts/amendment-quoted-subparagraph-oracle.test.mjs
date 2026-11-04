import test from 'node:test';
import assert from 'node:assert/strict';
import {assertQuotedSubparagraph} from './amendment-quoted-subparagraph-oracle.mjs';
function zip(xml){const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(raw.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(raw.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(local.length+name.length+raw.length,42);central.writeUInt32LE(0,42);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+raw.length,16);return Buffer.concat([local,name,raw,central,name,end]);}
const rows=['Article 1','Regulation (EU) 2023/956 is amended as follows:','(20)\tin Article 30(6), the second subparagraph is replaced by the following:','‘Before 2028 the Commission shall report on:','(a) an assessment of:','(i) leakage;','(ii) sectors;','(b) an assessment of:','(i) governance;','(ii) scope;','(iia) acts;','(iii) circumvention;','(iv) penalties;','(v) thresholds;','(c) results;','(d) information.;’','(21)\tAnnex I is amended.','Article 2'];
const input=(raw,insertBefore,proposedText='(x) New.')=>({proposal:{paragraphs:rows.map((text,index)=>({index,text,source:{path:`/w:document[1]/w:body[1]/w:p[${index+1}]`}}))},
 wording:{language:'en',targetLabel:'Article 1 – paragraph 1 – point 20\nRegulation (EU) 2023/956 — '+raw,targetPath:{underlying:[{document:'Regulation (EU) 2023/956',raw}]},proposedText},
 placement:{operation:'insert',insertAfter:insertBefore-1,insertBefore},
 nativeQuoted:{proposalBuffer:zip('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+rows.map(t=>'<w:p><w:r><w:t xml:space="preserve">'+t.replace(/\t/gu,'</w:t><w:tab/><w:t xml:space="preserve">')+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>')}});
test('native quoted subparagraph rows locate new Roman points, letter points and a following subparagraph',()=>{
 assert.equal(assertQuotedSubparagraph(input('Article 30 – paragraph 6 – subparagraph 2 – point b – point iii a (new)',12)).status,'verified');
 for(const raw of ['Article 30 – paragraph 6 – second subparagraph – point b – point va (new)','Article 30 – paragraph 6 – subparagraph 2 – point (b)(va)','Article 30 – paragraph 6 – subparagraph 2 – point b(va)','Article 30 – paragraph 6 – subparagraph 2 – point (ba) new'])
  assert.equal(assertQuotedSubparagraph(input(raw,14)).status,'verified',raw);
 assert.equal(assertQuotedSubparagraph(input('Article 30 – paragraph 6 – third subparagraph (new)',16)).status,'verified');
 assert.equal(assertQuotedSubparagraph(input('Article 30 – paragraph 6 – subparagraph 2 – point b – point iii a (new)',13)).status,'failed');
});
test('existing labels, another article or another subparagraph are not verified',()=>{
 for(const raw of ['Article 31 – paragraph 6 – subparagraph 2 – point b – point iii a (new)','Article 30 – paragraph 6 – subparagraph 1 – point b – point iii a (new)','Article 30 – paragraph 6 – fourth subparagraph (new)'])
  assert.equal(assertQuotedSubparagraph(input(raw,12)).status,'unverified',raw);
});

test('colliding new Roman numbers follow their base before existing suffixed peers',()=>{
 for(const suffix of ['a','b','c','d']) {
  const raw='Article 30 – paragraph 6 – subparagraph 2 – point b – point ii '+suffix+' (new)';
  assert.equal(assertQuotedSubparagraph(input(raw,10,'(ii'+suffix+') New.')).status,'verified');
  assert.equal(assertQuotedSubparagraph(input(raw,11,'(ii'+suffix+') New.')).status,'failed');
 }
 assert.equal(assertQuotedSubparagraph(input('Article 30 – paragraph 6 – subparagraph 2 – point b – point ii a',10)).status,'unverified');
});
