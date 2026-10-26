import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {docxContent} from '../server/document-text.mjs';
import {reportAmendmentHeading} from './reportAmendmentHeading.mjs';

const report='A-10-2026-0257',list=report+'-AM-001-002';
function docx(xml) {
  const name=Buffer.from('word/document.xml'),body=Buffer.from(xml),compressed=deflateRawSync(body);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
  return Buffer.concat([local,name,compressed,central,name,end]);
}
const p=text=>'<w:p><w:r><w:t>'+text+'</w:t></w:r></w:p>';
for(const main of [false,true])for(const incomplete of [false,true])test(`table opinion ends the main sequence; main=${main}, incomplete=${incomplete}`,()=>{
  const opening=p('DRAFT EUROPEAN PARLIAMENT LEGISLATIVE RESOLUTION');
  const comparison=main?p('Amendment 1')+p('Main wording one.')+p('Amendment 2')+p('Main wording two.'):p('No main comparison.');
  const opinion='<w:tbl><w:tr><w:tc>'+p('Opinion of the Committee on Development')+'</w:tc></w:tr></w:tbl>'+p('Amendment 1')+p('Opinion wording one.')+p('Amendment 2')+p('Opinion wording two.')+p('PROCEDURE');
  const text={...docxContent(docx('<w:document xmlns:w="urn:word"><w:body>'+opening+comparison+opinion+'</w:body></w:document>')),textLanguage:'en'};
  const boundary=main?5:2;assert.equal(text.paragraphSources[boundary].container,'table-cell');
  if(incomplete)text.paragraphSources[boundary].complete=false;
  assert.equal(reportAmendmentHeading(text,report,report+'-AM-2',list),main?3:null);
});
