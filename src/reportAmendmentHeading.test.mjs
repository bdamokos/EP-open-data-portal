import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {docxContent} from '../server/document-text.mjs';
import {reportAmendmentHeading} from './reportAmendmentHeading.mjs';

const report='A-10-2026-0257',list=report+'-AM-001-002';
const {editions}=JSON.parse(readFileSync(new URL('../server/fixtures/report-amendment-headings.json',import.meta.url)));
function excerpt(edition) {
  const rows=[edition.opening,...edition.amendmentOrdinals.map((ordinal,i)=>[ordinal,edition.amendmentOverrides?.[i+1]??edition.amendmentHeading.replace('{number}',String(i+1))]),...edition.ends];
  return {textLanguage:edition.language,structureStatus:'extracted',paragraphs:rows.map(row=>row[1]),
    paragraphSources:rows.map(([ordinal])=>({ordinal,container:'body',complete:true}))};
}
const anchor=(text,edition,number=2,listId=edition.listId)=>reportAmendmentHeading(text,edition.documentId,edition.documentId+'-AM-'+number,listId);

for(const edition of editions)test(`published ${edition.language} report headings retain the exact complete list sequence`,()=>{
  const text=excerpt(edition);
  assert.equal(edition.amendmentOrdinals.length,129);
  for(let number=1;number<=129;number++)assert.equal(anchor(text,edition,number),edition.language==='pt'?null:number);
  // The Portuguese source hides 37 with the template markers. Its visible
  // heading has no number: neither the list range nor another edition repairs it.
  if(edition.language==='pt')assert.equal(text.paragraphs[37],'Alteração');
  assert.equal(anchor(text,edition,2,edition.documentId+'-AM-001-128'),null);
  assert.equal(anchor(text,edition,2,edition.documentId+'-AM-002-129'),null);
  assert.equal(anchor(text,edition,130),null);
  assert.equal(anchor(text,edition,2,'A-10-2025-9999-AM-001-129'),null);
  assert.equal(reportAmendmentHeading(text,edition.documentId,'A-10-2025-9999-AM-2',edition.listId),null);
});

for(const edition of editions.filter(edition=>edition.language!=='pt'))test(`localized ${edition.language} scope rejects repeated, missing and incomplete headings`,()=>{
  for(const mutation of ['repeated-number','missing-number','incomplete-number','table-number','repeated-opening','contents-only','incomplete-opening','no-end','other-language','unknown-language']) {
    const text=excerpt(edition);
    if(mutation==='repeated-number')text.paragraphs[2]=text.paragraphs[1];
    if(mutation==='missing-number')text.paragraphs[2]='';
    if(mutation==='incomplete-number')text.paragraphSources[2].complete=false;
    if(mutation==='table-number')text.paragraphSources[2].container='table-cell';
    if(mutation==='repeated-opening'){text.paragraphs.push(text.paragraphs[0]);text.paragraphSources.push({...text.paragraphSources[0]});}
    if(mutation==='contents-only')text.paragraphs[0]+='\t5';
    if(mutation==='incomplete-opening')text.paragraphSources[0].complete=false;
    if(mutation==='no-end'){text.paragraphs=text.paragraphs.slice(0,130);text.paragraphSources=text.paragraphSources.slice(0,130);}
    if(mutation==='other-language')text.textLanguage=edition.language==='en'?'fr':'en';
    if(mutation==='unknown-language')text.textLanguage=null;
    assert.equal(anchor(text,edition),null,mutation);
  }
});

for(const edition of editions)test(`published ${edition.language} opinion numbering never supplies main-report anchors`,()=>{
  const text=excerpt(edition),opinion=edition.opinion;
  // Retain actual opinion rows, including their repeated 1/2 headings. These
  // controlled composites exercise the boundary without inventing legal text.
  for(const main of [false,true])for(const container of ['body','table-cell'])for(const complete of [false,true]) {
    const rows=[edition.opening,...(main?edition.amendmentOrdinals.map((ordinal,i)=>[ordinal,text.paragraphs[i+1]]):[]),opinion.heading,...opinion.amendments];
    const boundary=main?130:1;
    const source={textLanguage:edition.language,structureStatus:'extracted',paragraphs:rows.map(row=>row[1]),paragraphSources:rows.map(()=>({container:'body',complete:true}))};
    source.paragraphSources[boundary]={container,complete};
    assert.equal(anchor(source,edition),main&&edition.language!=='pt'?2:null);
  }
});
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
