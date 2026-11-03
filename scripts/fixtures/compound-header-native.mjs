import {deflateRawSync} from 'node:zlib';
export const compoundRun=text=>'<w:r><w:t>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t></w:r>';
export function compoundHeaderNative({target='Recital 17 a (new)',className='Proposal for a regulation',headerChange=xml=>xml,bodyChange=xml=>xml}={}) {
 const p=text=>'<w:p>'+compoundRun(text)+'</w:p>';
 const header='<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>'+className+'</w:t><w:br/><w:t>'+target+'</w:t></w:r></w:p>';
 const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+bodyChange(p('Amendment\t\t29')+headerChange(header)+'<w:tbl><w:tr><w:tc>'+p('Text proposed by the Commission')+'</w:tc><w:tc>'+p('Amendment')+'</w:tc></w:tr><w:tr><w:tc>'+p('')+'</w:tc><w:tc>'+p('(17a) Published addition.')+'</w:tc></w:tr></w:tbl>')+'</w:body></w:document>';
 const name=Buffer.from('word/document.xml'),raw=Buffer.from(xml),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
 return Buffer.concat([local,name,packed,central,name,end]);
}
