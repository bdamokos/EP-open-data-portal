import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {verifyAlternative} from './amendment-alternative-oracle.mjs';
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const p=value=>'<w:p><w:r><w:t>'+escape(value)+'</w:t></w:r></w:p>';
function zip(body) {
  const name=Buffer.from('word/document.xml'),raw=Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>'),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}
for(const language of ['en','es'])test('native alternative heading binds full replacement in '+language,()=>{
 const heading=language==='en'?'Motion for a resolution (Rule 188(3) of the Rules of Procedure) replacing non-legislative motion for a resolution A10-0001/2026':'Propuesta de Resolución alternativa (artículo 188, apartado 3, del Reglamento interno) a la propuesta de Resolución no legislativa A100001/2026';
 const proposed=language==='en'?'The European Parliament,\n1. Complete alternative.':'El Parlamento Europeo,\n1. Alternativa completa.';
 const buffer=zip(p('<Amend><NumAm>1</NumAm>')+p('<DocAmend>'+heading+'</DocAmend>')+p('<Article>Title</Article>')+proposed.split('\n').map(p).join('')+p('Or. <Original>en</Original>')+p('</Amend>'));
 const wording={number:1,targetDocumentId:'A-10-2026-0001',language,originalText:'',proposedText:proposed},placement={status:'document-operation',operation:'alternative-motion',scope:'motion-resolution'};
 assert.equal(verifyAlternative({buffer,wording,placement}).status,'verified');
 assert.equal(verifyAlternative({buffer,wording:{...wording,targetDocumentId:'A-10-2026-0002'},placement}),null);
 assert.equal(verifyAlternative({buffer,wording:{...wording,language:'de'},placement}),null);
 assert.equal(verifyAlternative({buffer,wording:{...wording,proposedText:'Shortened'},placement}).status,'unverified');
});
