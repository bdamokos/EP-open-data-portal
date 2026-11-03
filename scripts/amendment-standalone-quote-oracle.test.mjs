import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {deflateRawSync} from 'node:zlib';
import {assertStandaloneQuote} from './amendment-standalone-quote-oracle.mjs';import {quotedWordBody} from './amendment-benchmark-quoted-oracle.mjs';
function zip(xml){
  const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}
const p=text=>'<w:p><w:r><w:t>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t></w:r></w:p>';
const wrap=s=>'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+s+'</w:body></w:document>';
const input=(close='’')=>{const targetLabel='Annex III – paragraph 1 a (new)',proposedText='New threshold.';
 const proposalBuffer=zip(wrap(['ANNEX III','The following Annex VIII is added:','‘ANNEX VIII','Published annex text.',close].map(p).join('')));
 const amendmentBuffer=zip(wrap(p('<Amend><NumAm>1</NumAm>')+p('<Article>'+targetLabel+'</Article>')+p('<Original>{EN}en</Original>')+'<w:tbl><w:tr><w:tc>'+p('Text proposed by the Commission')+'</w:tc><w:tc>'+p('Amendment')+'</w:tc></w:tr><w:tr><w:tc>'+p('')+'</w:tc><w:tc>'+p(proposedText)+'</w:tc></w:tr></w:tbl>'+p('</Amend>')));
 const paragraphs=quotedWordBody(proposalBuffer).map((r,index)=>({text:r.text,index,complete:true,source:{path:r.path,complete:true}}));
 return {proposal:{sourceHash:createHash('sha256').update(proposalBuffer).digest('hex'),paragraphs,units:[{poison:true}]},wording:{language:'en',baseline:'commission-proposal',targetLabel,originalText:'',proposedText},placement:{status:'placed',operation:'insert',insertAfter:4,insertBefore:5},nativeQuoted:{proposalBuffer,amendmentBuffer,number:1}};
};
test('native packages certify a complete annex quotation closed in its own paragraph',()=>{const x=input();assert.equal(assertStandaloneQuote(x).status,'verified');x.placement.insertBefore=4;assert.equal(assertStandaloneQuote(x).status,'failed');});
test('inline possessives, different packages and unmatched amendment text stay unverified',()=>{for(const x of [input('Member States’ authorities'),input('Members’'),input('’ further text')])assert.equal(assertStandaloneQuote(x).status,'unverified');const x=input();x.wording.proposedText='Other.';assert.equal(assertStandaloneQuote(x).status,'unverified');const y=input();y.proposal.sourceHash='wrong';assert.equal(assertStandaloneQuote(y).status,'unverified');});
