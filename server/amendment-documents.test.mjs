import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { AMENDMENT_EXTRACTION_VERSION, extractAmendments } from './amendment-documents.mjs';
import { docxParts, downloadDocxBuffer, downloadDocx } from './document-text.mjs';

// In-memory ZIPs keep tests offline while exercising the shared bounded reader.
function archive(documentXml,stylesXml='') {
  const entries=[['word/document.xml',documentXml],...(stylesXml?[['word/styles.xml',stylesXml]]:[])];
  const locals=[],directory=[];let offset=0;
  for(const [filename,xml] of entries) {
    const name=Buffer.from(filename),body=Buffer.from(xml),compressed=deflateRawSync(body);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,name,compressed);directory.push(central,name);offset+=local.length+name.length+compressed.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,central,end]);
}
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const run=text=>`<w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
const p=(...text)=>`<w:p>${text.map(run).join('')}</w:p>`;
const cell=(...paragraphs)=>`<w:tc>${paragraphs.join('')}</w:tc>`;
const row=(...cells)=>`<w:tr>${cells.join('')}</w:tr>`;
const table=(...rows)=>`<w:tbl>${row(cell(p('Motion for a resolution')),cell(p('Amendment')))}${rows.join('')}</w:tbl>`;
const body=text=>`<w:document xmlns:w="urn:word"><w:body>${text}</w:body></w:document>`;
const metadata=(number=1,{author='Bruno Gonçalves',date='2.10.2026',target='Paragraph 1'}={})=>p(`<Amend><Date>${date}</Date><NumAm>${number}</NumAm>`)+p(`<Members>${author}</Members>`)+p(`<Article>${target}</Article>`);
const options={listId:'B-10-2026-0424-AM-001-001',targetDocumentId:'B-10-2026-0424',language:'en',sourceUrl:'https://data.europarl.europa.eu/distribution/example/amendment_en.docx',fetchedAt:'2026-10-16T17:15:00Z'};

test('public DOCX excerpts preserve exact author names, target hierarchy, dates and both columns',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-docx-excerpts-20261016.json',import.meta.url),'utf8'));
  for(const doc of fixture.documents) {
    const result=extractAmendments(archive(doc.documentXml,doc.stylesXml),{...options,...doc});
    assert.equal(result.amendments.length,doc.expected.length);
    for(const expected of doc.expected) {
      const actual=result.amendments.find(amendment=>amendment.number===expected.number);
      for(const [key,value] of Object.entries(expected))assert.deepEqual(actual[key],value,`${doc.listId} amendment ${expected.number}: ${key}`);
      assert.equal(actual.sources[0].url,doc.sourceUrl);assert.equal(actual.sources[0].fetchedAt,options.fetchedAt);
      assert.equal(actual.sources[0].date,expected.date);assert.equal(actual.sources[0].language,'en');
      assert(!actual.authors.includes('Antonio Decaro'));assert(!actual.authors.includes('Hilde Vautmans'));
    }
    // These deliberately selected excerpts retain their source list IDs, so
    // omitted numbers remain explicit rather than implying full list coverage.
    assert.deepEqual([...new Set(result.gaps.map(g=>g.code))],['list-coverage']);
  }
});

test('public Czech committee headings and Danish columns retain actual language, proposer scope and document dates',()=>{
  assert.equal(AMENDMENT_EXTRACTION_VERSION,'2');
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-docx-layouts-20261016.json',import.meta.url),'utf8'));
  for(const doc of fixture.documents) {
    const result=extractAmendments(archive(doc.documentXml,doc.stylesXml),{...options,...doc});
    assert.equal(result.amendments.length,doc.expected.length);
    for(const expected of doc.expected) {
      const actual=result.amendments.find(amendment=>amendment.number===expected.number);
      for(const [key,value] of Object.entries(expected))assert.deepEqual(actual[key],value,`${doc.language} amendment ${expected.number}: ${key}`);
      assert.equal(actual.language,doc.language);assert.equal(actual.sources[0].language,doc.language);
      assert.equal(actual.documentDate,expected.date);assert.equal(actual.sources[0].dateBasis,actual.dateBasis);
      assert.equal(actual.sources[0].url,doc.sourceUrl);
      if(doc.language==='cs') {
        assert.deepEqual(actual.authors,[]);assert.equal(actual.committeeProposer,'Výbor pro občanské svobody, spravedlnost a\u00a0vnitřní věci');
        assert.equal(actual.dateBasis,'amendment-list-document');assert.equal(actual.onBehalfOf,null);
        assert(result.gaps.some(g=>g.code==='authors-unavailable'&&g.number===actual.number));
        assert.doesNotMatch(JSON.stringify(actual.authors),/Lena Düpont/);
        assert.equal(actual.targetLabel,actual.number===1?'Bod odůvodnění 2':'Čl. 1 – odst. 1 – bod 10');
      } else {
        assert.equal(actual.dateBasis,'individual-amendment-document');assert.equal(actual.committeeProposer,null);
        assert.deepEqual(actual.authors,['Marina Kaljurand','Ana Catarina Mendes','Birgit Sippel']);
        assert.equal(actual.justification,'I overensstemmelse med Parlamentets holdning, der blev vedtaget med et flertal i 2024.');
      }
    }
    assert(!result.gaps.some(g=>['comparison-header','text-unavailable','date-unavailable','target-unavailable'].includes(g.code)));
  }
});

test('localized numeric text cannot create an amendment without the explicit source heading style',()=>{
  const xml=body(p('<Date>6.10.2026</Date><Committee>A source committee</Committee>')+p('Pozměňovací návrh1')+table(row(cell(p('Old')),cell(p('New')))));
  const result=extractAmendments(archive(xml),options);
  assert.deepEqual(result.amendments,[]);assert(result.gaps.some(g=>g.code==='amendments-unavailable'));
});

test('styled text runs concatenate without inserting spaces or damaging decimal separators',()=>{
  const xml=body(metadata()+table(row(cell(p('Rate: ', '59','.','58','%')),cell(p('Rate: ', '59',',','58','%'))))+p('</Amend>'));
  const {amendments,gaps}=extractAmendments(archive(xml),options);
  assert.equal(amendments[0].originalText,'Rate: 59.58%');assert.equal(amendments[0].proposedText,'Rate: 59,58%');
  assert.deepEqual(gaps,[]);
});

test('empty insertion cells and multirow deletions remain distinct from unavailable text',()=>{
  const xml=body(metadata()+table(row(cell(p('')),cell(p('New paragraph.'))))+p('</Amend>')+metadata(2)+table(row(cell(p('First line')),cell(p('deleted'))),row(cell(p('Second line')),cell(p(''))))+p('</Amend>'));
  const {amendments,gaps}=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
  assert.equal(amendments[0].originalText,'');assert.equal(amendments[0].proposedText,'New paragraph.');
  assert.equal(amendments[1].originalText,'First line\nSecond line');assert.equal(amendments[1].proposedText,'deleted');
  assert.deepEqual(gaps,[]);
});

test('a missing proposer is explicit and a rapporteur or responsible group cannot replace one',()=>{
  const xml=body(metadata().replace(p('<Members>Bruno Gonçalves</Members>'),'')+p('<Rapporteur>PPE</Rapporteur>')+table(row(cell(p('Old')),cell(p('New'))))+p('</Amend>'));
  const result=extractAmendments(archive(xml),options);
  assert.deepEqual(result.amendments[0].authors,[]);
  assert(result.gaps.some(g=>g.code==='authors-unavailable'&&g.number===1));
});

test('duplicate numbers are withheld and partial list coverage is reported',()=>{
  const section=metadata()+table(row(cell(p('Old')),cell(p('New'))))+p('</Amend>');
  const result=extractAmendments(archive(body(section+section)),options);
  assert.deepEqual(result.amendments,[]);
  assert(result.gaps.some(g=>g.code==='duplicate-amendment'));
  assert(result.gaps.some(g=>g.code==='list-coverage'));
});

test('conflicting source numbers, invalid dates and out-of-range identities cannot become silent joins',()=>{
  const comparison=table(row(cell(p('Old')),cell(p('New'))))+p('</Amend>');
  const conflict=extractAmendments(archive(body(metadata()+p('Amendment<NumAm>2</NumAm>')+comparison)),options);
  assert.deepEqual(conflict.amendments,[]);assert(conflict.gaps.some(g=>g.code==='number-conflict'));
  const outside=extractAmendments(archive(body(metadata(2)+comparison)),options);
  assert.deepEqual(outside.amendments,[]);assert(outside.gaps.some(g=>g.code==='number-outside-list'));
  for(const date of ['31.2.2026','{01/10/2026}2.10.2026']) {
    const invalidDate=extractAmendments(archive(body(metadata(1,{date})+comparison)),options);
    assert.equal(invalidDate.amendments[0].date,null);assert(invalidDate.gaps.some(g=>g.code==='date-unavailable'));
  }
});

test('hidden and deleted text is omitted from legal columns, with visible angle brackets retained',()=>{
  const old='<w:p>'+run('Visible < 5 ')+`<w:r><w:rPr><w:rStyle w:val="Hidden"/></w:rPr><w:t>HIDDEN</w:t></w:r><w:del>${run('DELETED')}</w:del><w:r><w:instrText>FIELD</w:instrText></w:r>`+'</w:p>';
  const styles='<w:styles><w:style w:styleId="Hidden"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>';
  const result=extractAmendments(archive(body(metadata()+table(row(cell(old),cell(p('Visible {braces}'))))+p('</Amend>')),styles),options);
  assert.equal(result.amendments[0].originalText,'Visible < 5');assert.equal(result.amendments[0].proposedText,'Visible {braces}');
});

test('justification follows its own heading and stops before original-language metadata',()=>{
  const xml=body(metadata()+table(row(cell(p('Old')),cell(p('New'))))+p('Justification')+p('A reason ', 'with styled runs.')+p('Or. <Original>{EN}en</Original>')+p('</Amend>'));
  const result=extractAmendments(archive(xml),options);
  assert.equal(result.amendments[0].justification,'A reason with styled runs.');
});

test('unknown column orientation and footnote omissions produce explicit extraction gaps',()=>{
  const unknown='<w:tbl>'+row(cell(p('Unknown header')),cell(p('Unknown proposal')))+row(cell(p('Old')),cell(p('New')))+'</w:tbl>';
  const noHeader=extractAmendments(archive(body(metadata()+unknown+p('</Amend>'))),options);
  assert.equal(noHeader.amendments[0].originalText,null);assert.equal(noHeader.amendments[0].proposedText,null);
  assert(noHeader.gaps.some(g=>g.code==='comparison-header'));assert(noHeader.gaps.some(g=>g.code==='text-unavailable'));
  const footnote='<w:p>'+run('Old')+'<w:r><w:footnoteReference w:id="2"/></w:r></w:p>';
  const notes=extractAmendments(archive(body(metadata()+table(row(cell(footnote),cell(p('New'))))+p('</Amend>'))),options);
  assert(notes.gaps.some(g=>g.code==='notes-unavailable'));
});

test('invalid archives and XML entities are rejected by the same bounded DOCX reader',()=>{
  assert.throws(()=>extractAmendments(Buffer.from('not a ZIP'),options));
  assert.throws(()=>extractAmendments(archive('<!DOCTYPE x><w:document/>'),options));
  assert.throws(()=>docxParts(archive('<w:document>broken')),/Invalid DOCX/);
});

test('buffer downloader keeps the original official DOCX URL allowlist',async()=>{
  for(const download of [downloadDocxBuffer,downloadDocx])await assert.rejects(download('https://example.com/private.docx'),/Unapproved official document download URL/);
});
