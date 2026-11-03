import {deflateRawSync} from 'node:zlib';
export const compoundRun=text=>'<w:r><w:t>'+text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</w:t></w:r>';
export function compoundHeaderNative({target='Recital 17 a (new)',className='Proposal for a regulation',headerChange=xml=>xml,bodyChange=xml=>xml,stylesXml='',namespace='http://schemas.openxmlformats.org/wordprocessingml/2006/main'}={}) {
 const p=text=>'<w:p>'+compoundRun(text)+'</w:p>';
 const header='<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>'+className+'</w:t><w:br/><w:t>'+target+'</w:t></w:r></w:p>';
 const xml='<w:document xmlns:w="'+namespace+'"><w:body>'+bodyChange(p('Amendment\t\t29')+headerChange(header)+'<w:tbl><w:tr><w:tc>'+p('Text proposed by the Commission')+'</w:tc><w:tc>'+p('Amendment')+'</w:tc></w:tr><w:tr><w:tc>'+p('')+'</w:tc><w:tc>'+p('(17a) Published addition.')+'</w:tc></w:tr></w:tbl>')+'</w:body></w:document>';
 const entries=[['word/document.xml',xml],...(stylesXml?[['word/styles.xml',stylesXml]]:[])],locals=[],directory=[];let offset=0;
 for(const [file,xml] of entries){
  const name=Buffer.from(file),raw=Buffer.from(xml),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  locals.push(local,name,packed);directory.push(central,name);offset+=local.length+name.length+packed.length;
 }
 const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,central,end]);
}
