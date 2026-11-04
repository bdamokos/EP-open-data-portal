import {deflateRawSync} from 'node:zlib';
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const p=value=>'<w:p><w:r><w:t>'+escape(value)+'</w:t></w:r></w:p>';
function zip(body) {
  const name=Buffer.from('word/document.xml'),raw=Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>'),packed=deflateRawSync(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+packed.length,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}
export function provisionalFixture({report='A10-0001/2026',number=3,label='–',body='This is the complete published agreement text. '.repeat(5)}={}) {
 const documentId='A-10-2026-0001',id=documentId+'-AM-3',listId=documentId+'-AM-003-003';
 return {id,amendmentId:id,documentId,listId,buffer:zip(p('<Amend><NumAm>'+number+'</NumAm>')+p('<TitreType>Report</TitreType>'+report)+p('<Article>'+label+'</Article>')+p(body)+p('<Original>en</Original></Amend>')),decisions:[{id:'decision-3',reference:'Provisional agreement',amendmentIds:[id],source:{url:'https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-01-01/decisions',fetchedAt:'2026-01-01T12:00:00Z'}}],source:{url:'https://data.europarl.europa.eu/distribution/reds_iPlRp_Amd/'+listId+'/'+listId+'_en.docx',language:'en',fetchedAt:'2026-01-01T12:00:00Z'}};
}
