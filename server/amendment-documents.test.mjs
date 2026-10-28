import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { AMENDMENT_EXTRACTION_VERSION, extractAmendments } from './amendment-documents.mjs';
import { docxParts, downloadDocxBuffer, downloadDocx } from './document-text.mjs';
import { amendmentDownloads } from './amendments-worker.mjs';
import {amendmentOperation,resolveAmendmentPlacement} from './document-context-model.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';

// In-memory ZIPs keep tests offline while exercising the shared bounded reader.
function archive(documentXml,stylesXml='',extra={}) {
  const entries=[['word/document.xml',documentXml],...(stylesXml?[['word/styles.xml',stylesXml]]:[]),...Object.entries(extra)];
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

test('extractor preserves published localized deletion cells for both placement paths',()=>{
  const {examples}=JSON.parse(readFileSync(new URL('./fixtures/amendment-operation-excerpts.json',import.meta.url)));
  for(const {language,deletion} of examples) {
    const xml=body(p('<Amend><NumAm>5</NumAm>')+p('<Article>Recital 13</Article>')+table(row(cell(p(deletion.originalText)),cell(p(deletion.proposedText))))+p('</Amend>'));
    const [amendment]=extractAmendments(archive(xml),{language,listId:'A-10-2025-0150-AM-001-129'}).amendments;
    assert.equal(amendment.proposedText,deletion.proposedText,language);
    assert.equal(amendmentOperation(amendment),'delete',language);
    assert.equal(resolveProposalPlacement([],amendment).operation,'delete',language);
    assert.equal(resolveAmendmentPlacement(null,amendment).operation,'delete',language);
  }
});
const metadata=(number=1,{author='Bruno Gonçalves',date='2.10.2026',target='Paragraph 1'}={})=>p(`<Amend><Date>${date}</Date><NumAm>${number}</NumAm>`)+p(`<Members>${author}</Members>`)+p(`<Article>${target}</Article>`);
const options={listId:'B-10-2026-0424-AM-001-001',targetDocumentId:'B-10-2026-0424',language:'en',sourceUrl:'https://data.europarl.europa.eu/distribution/example/amendment_en.docx',fetchedAt:'2026-10-16T17:15:00Z'};

test('automatic list continuation also reaches wording extraction in a comparison cell',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/docx-numbering-cbam.json',import.meta.url),'utf8'));
  const paragraphs=fixture.documentXml.match(/<w:body>([\s\S]*)<\/w:body>/)[1];
  // Synthetic amendment wrapper; the list paragraphs and numbering are public
  // Commission source excerpts, not evidence of an affected EP amendment.
  const xml=body(metadata()+table(row(cell(p('')),cell(paragraphs)))+p('</Amend>'));
  const result=extractAmendments(archive(xml,fixture.stylesXml,{'word/numbering.xml':fixture.numberingXml}),options);
  assert.equal(result.amendments[0].proposedText,fixture.expectedParagraphs.join('\n'));
  assert.deepEqual(result.gaps,[]);
});

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
  assert.equal(AMENDMENT_EXTRACTION_VERSION,'17');
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
  assert.deepEqual(amendments.map(amendment=>amendment.gaps),[[],[]]);
});

test('first ingestion withholds both columns after a lost row and attaches the numbered evidence gap to its record',()=>{
  const supported=row(cell(p('First original row')),cell(p('First proposed row')));
  const unsupported=[
    {code:'comparison-columns',comparison:table(supported,row(cell(p('Lost original')),cell(p('Lost proposal')),cell(p('Unsupported third cell'))))},
    // An unsupported nested grid must remain a lost comparison row, even
    // when its surrounding cell has no visible paragraph.
    {code:'nested-table',comparison:table(supported,row(cell('<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>'+p('Nested legal text')+'</w:tc></w:tr></w:tbl>'),cell(p(''))))},
    {code:'comparison-header',comparison:table(supported)+'<w:tbl>'+row(cell(p('Unknown original heading')),cell(p('Unknown proposed heading')))+row(cell(p('Lost original')),cell(p('Lost proposal')))+'</w:tbl>'},
  ];
  for(const {code,comparison} of unsupported) {
    const xml=body(metadata()+comparison+p('</Amend>')+metadata(2)+table(row(cell(p('')),cell(p('A complete insertion.'))))+p('</Amend>'));
    const result=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
    const affected=result.amendments.find(amendment=>amendment.number===1);
    assert.equal(affected.originalText,null,code);assert.equal(affected.proposedText,null,code);
    assert(affected.gaps.some(gap=>gap.code===code&&gap.number===1&&gap.sourceUrl===options.sourceUrl),code);
    assert.deepEqual(affected.gaps,result.gaps.filter(gap=>gap.number===1));
    const intact=result.amendments.find(amendment=>amendment.number===2);
    assert.equal(intact.originalText,'');assert.equal(intact.proposedText,'A complete insertion.');assert.deepEqual(intact.gaps,[]);
  }
});

test('wrapped comparison rows, cells and embedded body content cannot disappear behind a complete first row',()=>{
  const supported=row(cell(p('First original row')),cell(p('First proposed row')));
  const contentControl=content=>`<w:sdt><w:sdtPr><w:tag w:val="source-control"/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
  const second=row(cell(p('Second original row')),cell(p('Second proposed row')));
  const variants=[
    ['content-controlled row',contentControl(second)],
    ['custom XML row',`<w:customXml>${second}</w:customXml>`],
    ['content-controlled cell',row(contentControl(cell(p('Second original row'))),cell(p('Second proposed row')))],
    ['custom XML cell',row(cell(p('Second original row')),`<w:customXml>${cell(p('Second proposed row'))}</w:customXml>`)],
    ['content-controlled cell paragraphs',row(cell(contentControl(p('Second original row'))),cell(p('Second proposed row')))],
    ['unsupported external cell body',row(cell('<w:altChunk r:id="external-body"/>'),cell(p('Second proposed row')))],
    ['alternate row branches',`<mc:AlternateContent><mc:Choice Requires="w14">${second}</mc:Choice><mc:Fallback>${second}</mc:Fallback></mc:AlternateContent>`],
    ['alternate inline branches',row(cell('<w:p><mc:AlternateContent><mc:Choice Requires="w14">'+run('Second original row')+'</mc:Choice><mc:Fallback>'+run('Fallback original')+'</mc:Fallback></mc:AlternateContent></w:p>'),cell(p('Second proposed row')))],
  ];
  for(const [description,wrapped] of variants) {
    const xml=body(metadata()+table(supported,wrapped)+p('</Amend>')+metadata(2)+table(row(cell(p('')),cell(p('A complete insertion.'))))+p('</Amend>')).replace('xmlns:w="urn:word"','xmlns:w="urn:word" xmlns:r="urn:relationships" xmlns:mc="urn:compatibility"');
    const result=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
    const affected=result.amendments.find(amendment=>amendment.number===1);
    assert.equal(affected.originalText,null,description);assert.equal(affected.proposedText,null,description);
    assert(affected.gaps.some(gap=>gap.code==='comparison-structure'&&gap.number===1&&gap.sourceUrl===options.sourceUrl),description);
    assert(result.gaps.some(gap=>gap.code==='comparison-structure'&&gap.number===1),description);
    const intact=result.amendments.find(amendment=>amendment.number===2);
    assert.equal(intact.originalText,'',description);assert.equal(intact.proposedText,'A complete insertion.',description);assert.deepEqual(intact.gaps,[]);
  }
});

test('body-level choice and fallback comparison tables are never concatenated, even after a supported table',()=>{
  const alternatives='<mc:AlternateContent><mc:Choice Requires="w14">'+table(row(cell(p('Selected original')),cell(p('Selected proposal'))))+'</mc:Choice><mc:Fallback>'+table(row(cell(p('Fallback original')),cell(p('Fallback proposal'))))+'</mc:Fallback></mc:AlternateContent>';
  for(const prefix of ['',table(row(cell(p('First supported original')),cell(p('First supported proposal'))))]) {
    const xml=body(metadata()+prefix+alternatives+p('</Amend>')+metadata(2)+table(row(cell(p('')),cell(p('A complete insertion.'))))+p('</Amend>')).replace('xmlns:w="urn:word"','xmlns:w="urn:word" xmlns:mc="urn:compatibility"');
    const result=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
    const affected=result.amendments.find(amendment=>amendment.number===1);
    assert.equal(affected.originalText,null);assert.equal(affected.proposedText,null);
    assert(affected.gaps.some(gap=>gap.code==='comparison-structure'&&gap.number===1));
    const intact=result.amendments.find(amendment=>amendment.number===2);
    assert.equal(intact.originalText,'');assert.equal(intact.proposedText,'A complete insertion.');assert.deepEqual(intact.gaps,[]);
  }
});

test('whole alternate amendment branches do not invent identities and retain document-level unavailable evidence',()=>{
  const section=(number,label)=>metadata(number)+table(row(cell(p(label+' original')),cell(p(label+' proposal'))))+p('</Amend>');
  const alternatives='<compat:AlternateContent><compat:Choice Requires="w14">'+section(1,'Selected')+'</compat:Choice><compat:Fallback>'+section(1,'Fallback')+'</compat:Fallback></compat:AlternateContent>';
  for(const prefix of ['',section(2,'Supported')]) {
    const xml=body(prefix+alternatives).replace('xmlns:w="urn:word"','xmlns:w="urn:word" xmlns:compat="urn:compatibility"');
    const result=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
    assert(!result.amendments.some(amendment=>amendment.number===1));
    assert(result.gaps.some(gap=>gap.code==='comparison-structure'&&gap.number==null&&gap.scope==='document'&&gap.sourceUrl===options.sourceUrl));
    assert(result.gaps.some(gap=>gap.code==='list-coverage'));
    if(prefix)assert.equal(result.amendments[0].originalText,'Supported original');
    else {assert.deepEqual(result.amendments,[]);assert(result.gaps.some(gap=>gap.code==='amendments-unavailable'));}
  }
});

test('a visible legacy font symbol withholds legal wording on first ingestion and after supported rows',()=>{
  const symbol='<w:r><w:sym w:font="Symbol" w:char="F061"/></w:r>';
  const symbolParagraph='<w:p>'+run('Rate')+symbol+run(' applies')+'</w:p>';
  for(const prefix of ['',row(cell(p('First original row')),cell(p('First proposed row')))]) {
    const xml=body(metadata()+table(prefix,row(cell(symbolParagraph),cell(p('Proposed wording'))))+p('</Amend>')+metadata(2)+table(row(cell(p('')),cell(p('Supported insertion.'))))+p('</Amend>'));
    const result=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
    const affected=result.amendments.find(amendment=>amendment.number===1);
    assert.equal(affected.originalText,null);assert.equal(affected.proposedText,null);
    assert(affected.gaps.some(gap=>gap.code==='symbol-text-loss'&&gap.number===1&&gap.sourceUrl===options.sourceUrl));
    const intact=result.amendments.find(amendment=>amendment.number===2);
    assert.equal(intact.originalText,'');assert.equal(intact.proposedText,'Supported insertion.');assert.deepEqual(intact.gaps,[]);
  }
});

test('hidden and deleted font symbols do not invalidate supported visible comparison text',()=>{
  const symbols='<w:r><w:rPr><w:vanish/></w:rPr><w:sym w:font="Symbol" w:char="F061"/></w:r><w:del><w:r><w:sym w:font="Symbol" w:char="F062"/></w:r></w:del>';
  const xml=body(metadata()+table(row(cell('<w:p>'+run('Rate')+symbols+run(' applies')+'</w:p>'),cell(p('Proposed wording'))))+p('</Amend>'));
  const result=extractAmendments(archive(xml),options);
  assert.equal(result.amendments[0].originalText,'Rate applies');assert.equal(result.amendments[0].proposedText,'Proposed wording');assert.deepEqual(result.gaps,[]);
});

test('a visible positional tab preserves separation between adjacent legal words',()=>{
  const paragraph='<w:p>'+run('shall')+'<w:r><w:ptab w:alignment="left" w:relativeTo="indent" w:leader="none"/></w:r>'+run('not apply')+'</w:p>';
  const result=extractAmendments(archive(body(metadata()+table(row(cell(paragraph),cell(p('A proposal'))))+p('</Amend>'))),options);
  assert.equal(result.amendments[0].originalText,'shall\tnot apply');assert.equal(result.amendments[0].proposedText,'A proposal');assert.deepEqual(result.gaps,[]);
});

const ruby='<w:ruby><w:rubyPr/><w:rt><w:r><w:t>2</w:t></w:r></w:rt><w:rubyBase><w:r><w:t>10</w:t></w:r></w:rubyBase></w:ruby>';
test('ruby annotations and opaque inline content never flatten into complete legal wording',()=>{
  const opaque=[ruby,'<opaque:content>'+run('not')+'</opaque:content>','<w:pgNum/>'];
  for(const content of opaque)for(const prefix of ['',row(cell(p('First original')),cell(p('First proposal')))]) {
    const paragraph='<w:p>'+run('The value ')+content+run(' applies.')+'</w:p>';
    const xml=body(metadata()+table(prefix,row(cell(paragraph),cell(p('Proposed wording'))))+p('</Amend>')+metadata(2)+table(row(cell(p('')),cell(p('A complete insertion.'))))+p('</Amend>')).replace('xmlns:w="urn:word"','xmlns:w="urn:word" xmlns:opaque="urn:opaque"');
    const result=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
    const affected=result.amendments.find(amendment=>amendment.number===1);
    assert.equal(affected.originalText,null);assert.equal(affected.proposedText,null);
    assert(affected.gaps.some(gap=>gap.code==='inline-content-loss'&&gap.number===1&&gap.sourceUrl===options.sourceUrl));
    const intact=result.amendments.find(amendment=>amendment.number===2);
    assert.equal(intact.originalText,'');assert.equal(intact.proposedText,'A complete insertion.');assert.deepEqual(intact.gaps,[]);
  }
});

test('supported visible containers retain text while properties and layout markers remain non-text',()=>{
  const text=run(' not apply');
  const wrappers=[`<w:hyperlink>${text}</w:hyperlink>`,`<w:ins>${text}</w:ins>`,`<w:moveTo>${text}</w:moveTo>`,`<w:smartTag><w:smartTagPr/>${text}</w:smartTag>`,`<w:customXml><w:customXmlPr/>${text}</w:customXml>`,`<w:sdt><w:sdtPr><w:alias w:val="metadata"/></w:sdtPr><w:sdtContent>${text}</w:sdtContent><w:sdtEndPr/></w:sdt>`,`<w:fldSimple w:instr="SOURCE FIELD">${text}</w:fldSimple>`];
  for(const wrapper of wrappers) {
    const paragraph='<w:p><w:bookmarkStart w:id="1"/>'+run('shall')+'<w:r><w:lastRenderedPageBreak/><w:fldChar w:fldCharType="begin"/><w:instrText>field instruction</w:instrText></w:r>'+wrapper+'<w:bookmarkEnd w:id="1"/></w:p>';
    const result=extractAmendments(archive(body(metadata()+table(row(cell(paragraph),cell(p('Proposed wording'))))+p('</Amend>'))),options);
    assert.equal(result.amendments[0].originalText,'shall not apply');assert.equal(result.amendments[0].proposedText,'Proposed wording');assert.deepEqual(result.gaps,[]);
  }
});

test('hidden and deleted ruby or opaque inline content do not invalidate visible wording',()=>{
  const hidden='<w:r><w:rPr><w:vanish/></w:rPr>'+ruby+'<opaque:content>'+run('hidden')+'</opaque:content></w:r>';
  const paragraph='<w:p>'+run('shall')+hidden+'<w:del>'+ruby+'</w:del>'+run(' not apply')+'</w:p>';
  const xml=body(metadata()+table(row(cell(paragraph),cell(p('Proposed wording'))))+p('</Amend>')).replace('xmlns:w="urn:word"','xmlns:w="urn:word" xmlns:opaque="urn:opaque"');
  const result=extractAmendments(archive(xml),options);
  assert.equal(result.amendments[0].originalText,'shall not apply');assert.equal(result.amendments[0].proposedText,'Proposed wording');assert.deepEqual(result.gaps,[]);
});

const math='<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>';
const drawing='<w:drawing><wp:inline><a:graphic><a:graphicData><a:blip r:embed="formula1"/></a:graphicData></a:graphic></wp:inline></w:drawing>';
const mathematicalBody=text=>body(text).replace('xmlns:w="urn:word"','xmlns:w="urn:word" xmlns:m="urn:math" xmlns:wp="urn:drawing" xmlns:a="urn:graphic" xmlns:v="urn:vml" xmlns:r="urn:relationships"');
const formattedRun=(properties,text)=>'<w:r><w:rPr>'+properties+'</w:rPr><w:t>'+escape(text)+'</w:t></w:r>';

test('visible equations, formula images and embedded objects cannot become plain or omitted legal wording',()=>{
  const cases=[
    ['OMML exponent',math],
    ['drawing formula','<w:r>'+drawing+'</w:r>'],
    ['VML formula','<w:r><w:pict><v:shape><v:imagedata r:id="formula2"/></v:shape></w:pict></w:r>'],
    ['embedded formula','<w:r><w:object><v:shape/></w:object></w:r>'],
  ];
  for(const [description,formula] of cases)for(const prefix of ['',row(cell(p('First original')),cell(p('First proposal')))]) {
    const formulaParagraph='<w:p>'+run('The value ')+formula+run(' applies.')+'</w:p>';
    const xml=mathematicalBody(metadata()+table(prefix,row(cell(formulaParagraph),cell(p('Proposed wording'))))+p('</Amend>')+metadata(2)+table(row(cell(p('')),cell(p('A complete insertion.'))))+p('</Amend>'));
    const result=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
    const affected=result.amendments.find(amendment=>amendment.number===1);
    assert.equal(affected.originalText,null,description);assert.equal(affected.proposedText,null,description);
    assert(affected.gaps.some(gap=>gap.code==='non-text-content'&&gap.number===1&&gap.sourceUrl===options.sourceUrl),description);
    const intact=result.amendments.find(amendment=>amendment.number===2);
    assert.equal(intact.originalText,'');assert.equal(intact.proposedText,'A complete insertion.');assert.deepEqual(intact.gaps,[]);
  }
});

test('superscript, subscript and raised text retain plain wording and exact ranges',()=>{
  for(const properties of ['<w:vertAlign w:val="superscript"/>','<w:vertAlign w:val="subscript"/>','<w:position w:val="6"/>'])for(const prefix of ['',row(cell(p('First original')),cell(p('First proposal')))]) {
    const xml=body(metadata()+table(prefix,row(cell('<w:p>'+run('10')+formattedRun(properties,'3')+'</w:p>'),cell(p('Proposed wording'))))+p('</Amend>'));
    const result=extractAmendments(archive(xml),options);
    assert.match(result.amendments[0].originalText,/103$/);assert.match(result.amendments[0].proposedText,/Proposed wording$/);
    const end=result.amendments[0].originalText.length;
    assert.deepEqual(result.amendments[0].originalFormatting,[{start:end-1,end,kind:properties.includes('subscript')?'subscript':'superscript'}]);assert.deepEqual(result.gaps,[]);
  }
});

test('inherited character, paragraph and default vertical formatting retains exact spans',()=>{
  const cases=[
    {styles:'<w:style w:styleId="Super"><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style><w:style w:styleId="Inherited"><w:basedOn w:val="Super"/></w:style>',paragraph:'<w:p>'+run('10')+formattedRun('<w:rStyle w:val="Inherited"/>','3')+'</w:p>'},
    {styles:'<w:style w:styleId="Raised"><w:rPr><w:position w:val="6"/></w:rPr></w:style><w:style w:styleId="Inherited"><w:basedOn w:val="Raised"/></w:style>',paragraph:'<w:p>'+run('10')+formattedRun('<w:rStyle w:val="Inherited"/>','3')+'</w:p>'},
    {styles:'<w:style w:styleId="Super"><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Inherited"><w:basedOn w:val="Super"/></w:style>',paragraph:'<w:p><w:pPr><w:pStyle w:val="Inherited"/></w:pPr>'+run('103')+'</w:p>'},
    {styles:'<w:docDefaults><w:rPrDefault><w:rPr><w:vertAlign w:val="subscript"/></w:rPr></w:rPrDefault></w:docDefaults>',paragraph:p('103')},
    {styles:'<w:style w:type="character" w:default="1" w:styleId="DefaultRaised"><w:rPr><w:position w:val="6"/></w:rPr></w:style>',paragraph:p('103')},
  ];
  for(const {styles,paragraph} of cases) {
    const xml=body(metadata()+table(row(cell(paragraph),cell(p('Proposed wording'))))+p('</Amend>'));
    const result=extractAmendments(archive(xml,'<w:styles>'+styles+'</w:styles>'),options);
    assert.match(result.amendments[0].originalText,/103$/);assert.match(result.amendments[0].proposedText,/Proposed wording$/);
    assert(result.amendments[0].originalFormatting.length>0);assert.deepEqual(result.gaps,[]);
  }
});

test('explicit and inherited baseline resets keep supported text instead of retaining superscript styling',()=>{
  const styles='<w:styles><w:style w:styleId="Super"><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style><w:style w:styleId="Reset"><w:basedOn w:val="Super"/><w:rPr><w:vertAlign w:val="baseline"/></w:rPr></w:style><w:style w:styleId="Raised"><w:rPr><w:position w:val="6"/></w:rPr></w:style></w:styles>';
  const cases=[
    '<w:p>'+run('10')+formattedRun('<w:rStyle w:val="Super"/><w:vertAlign w:val="baseline"/>','3')+'</w:p>',
    '<w:p>'+run('10')+formattedRun('<w:rStyle w:val="Reset"/>','3')+'</w:p>',
    '<w:p>'+run('10')+formattedRun('<w:rStyle w:val="Raised"/><w:position w:val="0"/>','3')+'</w:p>',
    '<w:p><w:pPr><w:pStyle w:val="Super"/></w:pPr>'+formattedRun('<w:vertAlign w:val="baseline"/>','103')+'</w:p>',
  ];
  for(const paragraph of cases) {
    const result=extractAmendments(archive(body(metadata()+table(row(cell(paragraph),cell(p('Proposed wording'))))+p('</Amend>')),styles),options);
    assert.equal(result.amendments[0].originalText,'103');assert.equal(result.amendments[0].proposedText,'Proposed wording');assert.deepEqual(result.gaps,[]);
  }
});

test('hidden and deleted math, drawings and vertical text leave supported visible wording unchanged',()=>{
  const hidden='<w:r><w:rPr><w:vanish/><w:vertAlign w:val="superscript"/></w:rPr><w:t>3</w:t>'+drawing+math+'<w:object/></w:r>';
  const deleted='<w:del>'+formattedRun('<w:vertAlign w:val="subscript"/>','3')+'<w:r>'+drawing+'</w:r>'+math+'</w:del>';
  const paragraph='<w:p>'+run('Rate')+hidden+deleted+run(' applies')+'</w:p>';
  const result=extractAmendments(archive(mathematicalBody(metadata()+table(row(cell(paragraph),cell(p('Proposed wording'))))+p('</Amend>'))),options);
  assert.equal(result.amendments[0].originalText,'Rate applies');assert.equal(result.amendments[0].proposedText,'Proposed wording');assert.deepEqual(result.gaps,[]);
});

test('body-level mathematical blocks are numbered when scoped and explicitly document-level when unscoped',()=>{
  const block='<m:oMathPara>'+math+'</m:oMathPara>';
  const scoped=extractAmendments(archive(mathematicalBody(metadata()+block+table(row(cell(p('Original')),cell(p('Proposal'))))+p('</Amend>'))),options);
  assert.equal(scoped.amendments[0].originalText,null);assert.equal(scoped.amendments[0].proposedText,null);
  assert(scoped.amendments[0].gaps.some(gap=>gap.code==='non-text-content'&&gap.number===1));
  const unscoped=extractAmendments(archive(mathematicalBody(block)),options);
  assert.deepEqual(unscoped.amendments,[]);
  assert(unscoped.gaps.some(gap=>gap.code==='non-text-content'&&gap.number==null&&gap.scope==='document'&&gap.sourceUrl===options.sourceUrl));
  assert(unscoped.gaps.some(gap=>gap.code==='amendments-unavailable'));
});

test('ordinary table properties and positional annotation markers do not invalidate supported columns',()=>{
  const header=row(cell(p('Motion for a resolution')),cell(p('Amendment')));
  const comparison='<w:tbl><w:tblPr/><w:tblGrid/><w:bookmarkStart w:id="1"/>'+header+'<w:tr><w:trPr/><w:tblPrEx/><w:commentRangeStart w:id="2"/><w:tc><w:tcPr/>'+p('Original')+'</w:tc><w:tc><w:tcPr/>'+p('Proposal')+'</w:tc><w:commentRangeEnd w:id="2"/></w:tr><w:bookmarkEnd w:id="1"/></w:tbl>';
  const result=extractAmendments(archive(body(metadata()+comparison+p('</Amend>'))),options);
  assert.equal(result.amendments[0].originalText,'Original');assert.equal(result.amendments[0].proposedText,'Proposal');assert.deepEqual(result.gaps,[]);
});

test('unsupported comparison geometry withholds both columns with a numbered gap while another amendment remains intact',()=>{
  assert.equal(AMENDMENT_EXTRACTION_VERSION,'17');
  const grid=widths=>'<w:tblGrid>'+widths.map(width=>`<w:gridCol${width==null?'':` w:w="${width}"`}/>`).join('')+'</w:tblGrid>';
  const propsCell=(text,properties='')=>'<w:tc><w:tcPr>'+properties+'</w:tcPr>'+p(text)+'</w:tc>';
  const header=row(propsCell('Motion for a resolution'),propsCell('Amendment'));
  const original=propsCell('Original wording'),proposal=propsCell('Proposed wording');
  const comparison=(rows,definition=grid(['3000','3000']),head=header)=>'<w:tbl>'+definition+head+rows+'</w:tbl>';
  const shifted=(properties)=>'<w:tr><w:trPr>'+properties+'</w:trPr>'+original+proposal+'</w:tr>';
  const variants=[
    ['review reproduction: third grid column, spanning header and shifted content',comparison(shifted('<w:gridBefore w:val="1"/>'),grid(['3000','1500','1500']),row(propsCell('Motion for a resolution'),propsCell('Amendment','<w:gridSpan w:val="2"/>')))],
    ['one declared column',comparison(row(original,proposal),grid(['6000']))],
    ['three declared columns',comparison(row(original,proposal),grid(['3000','1500','1500']))],
    ['wrapped grid columns',comparison(row(original,proposal),'<w:tblGrid><w:customXml><w:gridCol/><w:gridCol/></w:customXml></w:tblGrid>')],
    ['duplicate grid declarations',comparison(row(original,proposal),'<w:tblGrid/>'+grid(['3000','3000']))],
    ['malformed grid width',comparison(row(original,proposal),grid(['invalid','3000']))],
    ['negative grid width',comparison(row(original,proposal),grid(['-1','3000']))],
    ['spanning header',comparison(row(original,proposal),grid(['3000','3000']),row(propsCell('Motion for a resolution'),propsCell('Amendment','<w:gridSpan w:val="2"/>')))],
    ['shifted header',comparison(row(original,proposal),grid(['3000','3000']),'<w:tr><w:trPr><w:gridAfter w:val="1"/></w:trPr>'+propsCell('Motion for a resolution')+propsCell('Amendment')+'</w:tr>')],
    ['missing second header cell',comparison(row(original,proposal),grid(['3000','3000']),row(propsCell('Amendment')))],
    ['offset before content',comparison(shifted('<w:gridBefore w:val="1"/>'))],
    ['offset after content',comparison(shifted('<w:gridAfter w:val="1"/>'))],
    ...['<w:gridBefore/>','<w:gridAfter w:val="invalid"/>','<w:gridBefore w:val="-1"/>','<w:gridAfter w:val="0.0"/>','<w:gridBefore w:val="0"/><w:gridBefore w:val="0"/>'].map(properties=>['malformed row offset '+properties,comparison(shifted(properties))]),
    ['duplicate row property blocks',comparison('<w:tr><w:trPr/><w:trPr/>'+original+proposal+'</w:tr>')],
    ...['<w:gridSpan w:val="2"/>','<w:gridSpan w:val="0"/>','<w:gridSpan/>','<w:gridSpan w:val="invalid"/>','<w:gridSpan w:val="-1"/>','<w:gridSpan w:val="1.0"/>','<w:gridSpan w:val="1"/><w:gridSpan w:val="1"/>','<w:gridSpan w:val="1"><w:gridSpan w:val="2"/></w:gridSpan>','<w:hMerge/>','<w:hMerge w:val="restart"/>','<w:vMerge/>','<w:vMerge w:val="continue"/>'].map(properties=>['unsupported current cell geometry '+properties,comparison(row(propsCell('Original wording',properties),proposal))]),
    ['duplicate cell property blocks',comparison(row('<w:tc><w:tcPr/><w:tcPr/>'+p('Original wording')+'</w:tc>',proposal))],
    ['empty row without cells',comparison(row(original,proposal)+row())],
    ['blank row with three cells',comparison(row(original,proposal)+row(propsCell(''),propsCell(''),propsCell('')))],
    ['blank one-cell row without its explicit two-column span',comparison(row(original,proposal)+row(propsCell('')))],
    ['blank spanning cell with a current merge',comparison(row(original,proposal)+row(propsCell('','<w:gridSpan w:val="2"/><w:vMerge/>')))],
    ['blank spanning cell with an offset',comparison(row(original,proposal)+'<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>'+propsCell('','<w:gridSpan w:val="2"/>')+'</w:tr>')],
    ['nonblank one-cell span is not a spacer',comparison(row(original,proposal)+row(propsCell('Additional legal wording','<w:gridSpan w:val="2"/>')))],
    ['hidden content is not the public blank spacer',comparison(row(original,proposal)+row('<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden legal wording</w:t></w:r></w:p></w:tc>'))],
  ];
  for(const [description,comparisonXml] of variants) {
    const xml=body(metadata()+comparisonXml+p('</Amend>')+metadata(2)+table(row(cell(p('')),cell(p('A complete insertion.'))))+p('</Amend>'));
    const result=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
    const affected=result.amendments.find(amendment=>amendment.number===1);
    assert.equal(affected.originalText,null,description);assert.equal(affected.proposedText,null,description);
    assert(affected.gaps.some(gap=>gap.code==='comparison-grid'&&gap.number===1&&gap.sourceUrl===options.sourceUrl),description);
    assert(result.gaps.some(gap=>gap.code==='comparison-grid'&&gap.number===1),description);
    assert.deepEqual(affected.gaps,result.gaps.filter(gap=>gap.number===1),description);
    const intact=result.amendments.find(amendment=>amendment.number===2);
    assert.equal(intact.originalText,'',description);assert.equal(intact.proposedText,'A complete insertion.',description);assert.deepEqual(intact.gaps,[],description);
  }
});

test('ordinary two-column geometry, blank cells and exact public blank span-two spacers remain supported',()=>{
  const cellWith=(text,properties='')=>'<w:tc><w:tcPr>'+properties+'</w:tcPr>'+p(text)+'</w:tc>';
  const header=row(cellWith('Motion for a resolution','<w:gridSpan w:val="1"/>'),cellWith('Amendment'));
  const blank=row(cellWith(''),cellWith(''));
  const spacer='<w:tr><w:trPr><w:gridBefore w:val="0"/><w:gridAfter w:val="00"/></w:trPr>'+cellWith('','<w:gridSpan w:val="2"/>')+'</w:tr>';
  const original=cellWith('Original wording','<w:gridSpan w:val="01"/>'),proposal=cellWith('Proposed wording');
  for(const definition of ['', '<w:tblGrid/>', '<w:tblGrid><w:gridCol/><w:gridCol w:w="3000"/></w:tblGrid>']) {
    const comparison='<w:tbl>'+definition+spacer+blank+header+spacer+'<w:tr><w:trPr><w:gridBefore w:val="0"/><w:gridAfter w:val="0"/></w:trPr>'+original+proposal+'</w:tr>'+blank+spacer+'</w:tbl>';
    const result=extractAmendments(archive(body(metadata()+comparison+p('</Amend>'))),options);
    assert.equal(result.amendments[0].originalText,'Original wording');assert.equal(result.amendments[0].proposedText,'Proposed wording');assert.deepEqual(result.gaps,[]);
  }
});

test('historical table, row and cell geometry changes do not replace the current two-column layout',()=>{
  const pastGrid='<w:tblGridChange w:id="1"><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid></w:tblGridChange>';
  const pastTable='<w:tblPr><w:tblPrChange w:id="2"><w:tblPr><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid></w:tblPr></w:tblPrChange></w:tblPr>';
  const pastRow='<w:trPr><w:gridBefore w:val="0"/><w:trPrChange w:id="3"><w:trPr><w:gridBefore w:val="1"/><w:gridAfter w:val="invalid"/></w:trPr></w:trPrChange></w:trPr>';
  const pastCell='<w:tcPr><w:gridSpan w:val="1"/><w:tcPrChange w:id="4"><w:tcPr><w:gridSpan w:val="3"/><w:hMerge/><w:vMerge w:val="restart"/></w:tcPr></w:tcPrChange></w:tcPr>';
  const spacer='<w:tr>'+pastRow+'<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcPrChange w:id="5"><w:tcPr><w:gridSpan w:val="invalid"/><w:vMerge/></w:tcPr></w:tcPrChange></w:tcPr>'+p('')+'</w:tc></w:tr>';
  const header=row(cell(p('Motion for a resolution')),cell(p('Amendment')));
  for(const definition of ['<w:tblGrid><w:gridCol/><w:gridCol/>'+pastGrid+'</w:tblGrid>','<w:tblGrid>'+pastGrid+'</w:tblGrid>']) {
    const comparison='<w:tbl>'+pastTable+definition+header+spacer+'<w:tr>'+pastRow+'<w:tc>'+pastCell+p('Original wording')+'</w:tc>'+cell(p('Proposed wording'))+'</w:tr></w:tbl>';
    const result=extractAmendments(archive(body(metadata()+comparison+p('</Amend>'))),options);
    assert.equal(result.amendments[0].originalText,'Original wording');assert.equal(result.amendments[0].proposedText,'Proposed wording');assert.deepEqual(result.gaps,[]);
  }
});

test('tracked row and cell revisions cannot silently join accepted comparison wording',()=>{
  const changedRow=(properties,cells)=>'<w:tr>'+properties+cells+'</w:tr>';
  const original=cell(p('Revised original')),proposal=cell(p('Revised proposal'));
  const stamp='w:id="7" w:author="Editor" w:date="2026-10-01T00:00:00Z"';
  const variants=[
    ['deleted row',changedRow('<w:trPr><w:del '+stamp+'/></w:trPr>',original+proposal)],
    ['inserted row',changedRow('<w:trPr><w:ins '+stamp+'/></w:trPr>',original+proposal)],
    ['deleted cell',row('<w:tc><w:tcPr><w:cellDel '+stamp+'/></w:tcPr>'+p('Revised original')+'</w:tc>',proposal)],
    ['inserted cell',row(original,'<w:tc><w:tcPr><w:cellIns '+stamp+'/></w:tcPr>'+p('Revised proposal')+'</w:tc>')],
    ['tracked cell merge',row('<w:tc><w:tcPr><w:cellMerge '+stamp+' w:vMerge="rest" w:vMergeOrig="cont"/></w:tcPr>'+p('Revised original')+'</w:tc>',proposal)],
    ['moved row','<w:moveFromRangeStart '+stamp+' w:name="move1"/>'+row(original,proposal)+'<w:moveFromRangeEnd w:id="7"/>'],
    ['moved cell',changedRow('', '<w:moveToRangeStart '+stamp+' w:name="move2"/>'+original+proposal+'<w:moveToRangeEnd w:id="7"/>')],
  ];
  for(const [description,revision] of variants)for(const prefix of ['',row(cell(p('Visible original')),cell(p('Visible proposal')))]) {
    const xml=body(metadata()+table(prefix,revision)+p('</Amend>')+metadata(2)+table(row(cell(p('')),cell(p('A complete insertion.'))))+p('</Amend>'));
    const result=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
    const affected=result.amendments.find(amendment=>amendment.number===1);
    assert.equal(affected.originalText,null,description);assert.equal(affected.proposedText,null,description);
    assert(affected.gaps.some(gap=>gap.code==='structural-revision'&&gap.number===1&&gap.sourceUrl===options.sourceUrl),description);
    const intact=result.amendments.find(amendment=>amendment.number===2);
    assert.equal(intact.originalText,'');assert.equal(intact.proposedText,'A complete insertion.');assert.deepEqual(intact.gaps,[]);
  }
});

test('historical property snapshots and ordinary hidden or deleted inline text do not create current structural revisions',()=>{
  const pastRow='<w:trPr><w:trPrChange w:id="1"><w:trPr><w:del w:id="2"/><w:ins w:id="3"/></w:trPr></w:trPrChange><w:jc w:val="left"/></w:trPr>';
  const pastCell='<w:tcPr><w:tcPrChange w:id="4"><w:tcPr><w:cellDel w:id="5"/><w:cellIns w:id="6"/><w:cellMerge w:id="7"/></w:tcPr></w:tcPrChange><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>';
  const inline='<w:p>'+run('Visible')+'<w:r><w:rPr><w:vanish/></w:rPr><w:t> hidden</w:t></w:r><w:del>'+run(' deleted')+'</w:del><w:ins>'+run(' inserted')+'</w:ins><w:moveFrom>'+run(' moved away')+'</w:moveFrom><w:moveTo>'+run(' current')+'</w:moveTo></w:p>';
  const comparison=table('<w:tr>'+pastRow+'<w:tc>'+pastCell+inline+'</w:tc>'+cell(p('Proposal'))+'</w:tr>');
  const result=extractAmendments(archive(body(metadata()+comparison+p('</Amend>'))),options);
  assert.equal(result.amendments[0].originalText,'Visible inserted current');assert.equal(result.amendments[0].proposedText,'Proposal');assert.deepEqual(result.gaps,[]);
});

test('current paragraph-mark revisions cannot turn ambiguous decimal boundaries into accepted wording',()=>{
  assert.equal(AMENDMENT_EXTRACTION_VERSION,'17');
  for(const marker of ['del','ins','moveFrom','moveTo']) {
    const first='<w:p><w:pPr><w:rPr><w:'+marker+' w:id="9" w:author="Editor" w:date="2026-10-01T00:00:00Z"/></w:rPr></w:pPr>'+run('Rate: 1')+'</w:p>';
    const xml=body(metadata()+table(row(cell(first,p('0%')),cell(p('A proposal'))))+p('</Amend>')+metadata(2)+table(row(cell(p('')),cell(p('Supported insertion.'))))+p('</Amend>'));
    const result=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
    const affected=result.amendments.find(amendment=>amendment.number===1);
    assert.equal(affected.originalText,null,marker);assert.equal(affected.proposedText,null,marker);
    assert(affected.gaps.some(gap=>gap.code==='structural-revision'&&gap.number===1&&gap.sourceUrl===options.sourceUrl),marker);
    assert.notEqual(affected.originalText,'Rate: 1\n0%');assert.notEqual(affected.originalText,'Rate: 10%');
    const intact=result.amendments.find(amendment=>amendment.number===2);
    assert.equal(intact.originalText,'');assert.equal(intact.proposedText,'Supported insertion.');assert.deepEqual(intact.gaps,[]);
  }
});

test('historical paragraph-mark properties and ordinary paragraph boundaries remain supported',()=>{
  const props='<w:pPr><w:rPr><w:b/><w:rPrChange w:id="1"><w:rPr><w:del w:id="2"/></w:rPr></w:rPrChange></w:rPr><w:pPrChange w:id="3"><w:pPr><w:rPr><w:del w:id="4"/><w:ins w:id="5"/></w:rPr></w:pPr></w:pPrChange></w:pPr>';
  const first='<w:p>'+props+run('Rate: 1')+'</w:p>';
  const result=extractAmendments(archive(body(metadata()+table(row(cell(first,p('0%')),cell(p('A proposal'))))+p('</Amend>'))),options);
  assert.equal(result.amendments[0].originalText,'Rate: 1\n0%');assert.equal(result.amendments[0].proposedText,'A proposal');assert.deepEqual(result.gaps,[]);
  const ordinary='<w:p>'+run('Rate: 1')+'<w:del>'+run(' removed')+'</w:del>'+run('0%')+'</w:p>';
  const inlineDeletion=extractAmendments(archive(body(metadata()+table(row(cell(ordinary),cell(p('A proposal'))))+p('</Amend>'))),options);
  assert.equal(inlineDeletion.amendments[0].originalText,'Rate: 10%');assert.deepEqual(inlineDeletion.gaps,[]);
});

test('an unscoped numbering failure withholds wording and exposes the document-scoped gap on every amendment',()=>{
  const unsupportedNumbering='<w:p><w:pPr><w:numPr><w:numId w:val="77"/></w:numPr></w:pPr>'+run('A paragraph whose legal number cannot be read.')+'</w:p>';
  const xml=body(metadata()+table(row(cell(unsupportedNumbering),cell(p('Proposed wording'))))+p('</Amend>')+metadata(2)+table(row(cell(p('Other original')),cell(p('Other proposal'))))+p('</Amend>'));
  const result=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
  assert.deepEqual(result.amendments.map(amendment=>amendment.number),[1,2]);
  assert(result.gaps.some(gap=>gap.code==='numbering-warning'&&gap.number==null));
  for(const amendment of result.amendments) {
    assert.equal(amendment.originalText,null);assert.equal(amendment.proposedText,null);
    assert(amendment.gaps.some(gap=>gap.code==='numbering-warning'&&gap.number===amendment.number&&gap.scope==='document'));
  }
});

test('a missing proposer is explicit and a rapporteur or responsible group cannot replace one',()=>{
  const xml=body(metadata().replace(p('<Members>Bruno Gonçalves</Members>'),'')+p('<Rapporteur>PPE</Rapporteur>')+table(row(cell(p('Old')),cell(p('New'))))+p('</Amend>'));
  const result=extractAmendments(archive(xml),options);
  assert.deepEqual(result.amendments[0].authors,[]);
  assert(result.gaps.some(g=>g.code==='authors-unavailable'&&g.number===1));
  assert(result.amendments[0].gaps.some(g=>g.code==='authors-unavailable'&&g.number===1));
  assert.equal(result.amendments[0].originalText,'Old');assert.equal(result.amendments[0].proposedText,'New');
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
  assert(notes.amendments[0].gaps.some(g=>g.code==='notes-unavailable'&&g.number===1));
  assert.equal(notes.amendments[0].originalText,'Old');assert.equal(notes.amendments[0].proposedText,'New');
});

test('invalid archives and XML entities are rejected by the same bounded DOCX reader',()=>{
  assert.throws(()=>extractAmendments(Buffer.from('not a ZIP'),options));
  assert.throws(()=>extractAmendments(archive('<!DOCTYPE x><w:document/>'),options));
  assert.throws(()=>docxParts(archive('<w:document>broken')),/Invalid DOCX/);
});

test('buffer downloader keeps the original official DOCX URL allowlist',async()=>{
  for(const download of [downloadDocxBuffer,downloadDocx])await assert.rejects(download('https://example.com/private.docx'),/Unapproved official document download URL/);
});

test('raw DOCX, reading-text and voting XML downloads forward caller cancellation to HTTPS', {timeout:1500}, async t=>{
  let transportSignal,started,request;
  t.mock.method(https,'get',(url,{signal})=>{
    assert.match(String(url),/^https:\/\/data\.europarl\.europa\.eu\/distribution\//);
    transportSignal=signal;request=new EventEmitter();
    signal.addEventListener('abort',()=>request.emit('error',signal.reason),{once:true});
    started();return request;
  });
  const downloads=[
    [downloadDocxBuffer,options.sourceUrl],
    [downloadDocx,options.sourceUrl],
    [amendmentDownloads.downloadVotingXml,options.sourceUrl.replace(/\.docx$/,'.xml')],
  ];
  for(const [download,url] of downloads) {
    const controller=new AbortController(),reason=new Error('The source owner stopped.');
    const reached=new Promise(resolve=>started=resolve);
    const rejected=assert.rejects(download(url,{signal:controller.signal}),error=>error===reason);
    await reached;
    assert.equal(transportSignal.aborted,false);
    controller.abort(reason);
    await rejected;
    assert.equal(transportSignal.aborted,true);assert.equal(transportSignal.reason,reason);
  }
});


test('proposal-level document target distinguishes resolution wording from Commission proposal wording',()=>{
  const fixtures=JSON.parse(readFileSync(new URL('./fixtures/amendment-docx-excerpts-20261016.json',import.meta.url),'utf8'));
  for(const fixture of fixtures.documents){
    const parsed=extractAmendments(archive(fixture.documentXml,fixture.stylesXml),fixture);
    for(const amendment of parsed.amendments)assert.equal(amendment.baseline,fixture.targetDocumentId==='A-10-2025-0085'?'commission-proposal':'motion-resolution');
  }
});


test('vertical ranges retain typed footnote markers and scientific notation through whitespace, cells and rows',()=>{
  const sup=value=>formattedRun('<w:vertAlign w:val="superscript"/>',value),sub=value=>formattedRun('<w:vertAlign w:val="subscript"/>',value);
  const original='<w:p>'+run('  😀 Citation ')+sup('4')+run('  ')+ '<w:br/>'+run('CO')+sub('2')+run('  ')+'</w:p>';
  const proposed='<w:p>'+run('Citation ')+sup('1a')+run(' mg/m')+sup('3')+run('(')+sup('5')+run(')')+'</w:p>';
  const xml=body(metadata()+table(row(cell(original,p('______'),p('4 Source note')),cell(proposed)),row(cell('<w:p>'+formattedRun('<w:position w:val="-4"/>','y')+'</w:p>'),cell('<w:p>'+formattedRun('<w:position w:val="4"/>','z')+'</w:p>')))+p('</Amend>'));
  const {amendments:[a],gaps}=extractAmendments(archive(xml),options);
  assert.equal(a.originalText,'😀 Citation 4\nCO2\n______\n4 Source note\ny');
  assert.equal(a.proposedText,'Citation 1a mg/m3(5)\nz');
  assert.deepEqual(a.originalFormatting,[{start:12,end:13,kind:'superscript'},{start:16,end:17,kind:'subscript'},{start:a.originalText.length-1,end:a.originalText.length,kind:'subscript'}]);
  assert.deepEqual(a.proposedFormatting,[{start:9,end:11,kind:'superscript'},{start:16,end:17,kind:'superscript'},{start:18,end:19,kind:'superscript'},{start:21,end:22,kind:'superscript'}]);
  assert.deepEqual(gaps,[]);
  // Removing only presentation properties yields identical placement input.
  const plain=xml.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g,'');
  const oracle=extractAmendments(archive(plain),options).amendments[0];
  assert.equal(a.originalText,oracle.originalText);assert.equal(a.proposedText,oracle.proposedText);
});

test('real footnote references keep their existing omission and notes gap, never a typed-marker span',()=>{
  const xml=body(metadata()+table(row(cell('<w:p>'+run('Citation')+'<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="4"/></w:r></w:p>'),cell(p('New'))))+p('</Amend>'));
  const {amendments:[a],gaps}=extractAmendments(archive(xml),options);
  assert.equal(a.originalText,'Citation');assert.deepEqual(a.originalFormatting,[]);
  assert(gaps.some(gap=>gap.code==='notes-unavailable'));assert(!gaps.some(gap=>gap.code==='vertical-formatting-loss'));
});

test('unknown vertical properties withhold wording with the narrower formatting gap',()=>{
  const xml=body(metadata()+table(row(cell('<w:p>'+formattedRun('<w:position w:val="invalid"/>','4')+'</w:p>'),cell(p('New'))))+p('</Amend>'));
  const {amendments:[a]}=extractAmendments(archive(xml),options);
  assert.equal(a.originalText,null);assert.deepEqual(a.originalFormatting,[]);assert(a.gaps.some(gap=>gap.code==='vertical-formatting-loss'));
});


test('FR/HU/RO published document classes remain metadata before the real committee target',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-document-class.json',import.meta.url),'utf8'));
  for(const doc of fixture.documents) {
    const {amendments}=extractAmendments(archive(doc.documentXml,doc.stylesXml),doc);
    assert.deepEqual(amendments.map(a=>a.number),[1,13]);
    for(const expected of doc.expected) {
      const actual=amendments.find(a=>a.number===expected.number);
      assert.equal(actual.targetLabel,expected.targetLabel,doc.language+' AM'+expected.number);
      assert.deepEqual(actual.documentReferences.filter(r=>r.field==='DocumentClass'),[{field:'DocumentClass',raw:expected.documentClass,sourceRaw:expected.documentClass,scope:'amendment'}]);
      assert.equal(actual.language,doc.language);assert.equal(actual.sources[0].url,doc.sourceUrl);
      assert(actual.originalText!==null&&actual.proposedText!==null);
    }
  }
});

test('Croatian A-10-2025-0150 amendments 3 and 4 retain distinct unstyled boundaries and bold targets',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-croatian-unstyled.json',import.meta.url),'utf8'));
  const result=extractAmendments(archive(fixture.documentXml,fixture.stylesXml),fixture);
  assert.deepEqual(result.amendments.map(a=>a.number),[3,4]);
  for(const expected of fixture.expected) {
    const actual=result.amendments.find(a=>a.number===expected.number);
    for(const [key,value] of Object.entries(expected))assert.equal(actual[key],value,`AM${expected.number}: ${key}`);
    assert.equal(actual.committeeProposer,'Odbor za ribarstvo');
    assert.equal(actual.date,'2026-09-10');assert.equal(actual.sources[0].url,fixture.sourceUrl);
    assert(!actual.targetLabel.includes('Amandman'));assert(!actual.targetLabel.includes('Prijedlog uredbe'));
  }
});

test('Croatian target lines use inherited bold formatting and honor direct non-bold runs',()=>{
  const styles='<w:styles><w:style w:styleId="Parent"><w:rPr><w:b/></w:rPr></w:style><w:style w:styleId="Child"><w:basedOn w:val="Parent"/></w:style></w:styles>';
  const target='<w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr>'+run('Uvodna izjava 3.a (nova)')+'</w:p>';
  const ordinary='<w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>Ordinary metadata</w:t></w:r></w:p>';
  const xml=body(p('<Committee>Odbor za ribarstvo</Committee>')+p('Amandman3')+ordinary+target+table(row(cell(p('')),cell(p('Published new recital.')))));
  const result=extractAmendments(archive(xml,styles),{...options,listId:'A-10-2025-0150-AM-001-129',language:'hr'});
  assert.equal(result.amendments[0].targetLabel,'Uvodna izjava 3.a (nova)');
});


test('Croatian amendment 13 retains plain underlying-act metadata after its bold proposal target',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-croatian-unstyled.json',import.meta.url),'utf8'));
  const cover=p('<Committee>Odbor za ribarstvo</Committee><Procedure>Prijedlog uredbe</Procedure>');
  const xml=body(cover+p('Amandman13')+fixture.underlyingTargetParagraphsXml+table(row(cell(p('')),cell(p('Test comparison.')))));
  const {amendments}=extractAmendments(archive(xml,fixture.stylesXml),fixture);
  assert.equal(amendments[0].targetLabel,fixture.underlyingTargetLabel);
});

test('published rejection, modification and stacked-annex layouts keep explicit wording sides',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-comparison-layouts.json',import.meta.url),'utf8'));
  for(const doc of fixture.documents) {
    const result=extractAmendments(archive(doc.documentXml,doc.stylesXml,doc.numberingXml?{'word/numbering.xml':doc.numberingXml}:{}),doc),amendment=result.amendments.find(row=>doc.id.endsWith('-AM-'+row.number));
    assert(amendment,doc.id);
    if(doc.language==='hu') {
      // This real horizontal instruction spans BOTH comparison columns. Its
      // wording has no unique side, so the whole amendment remains withheld.
      assert.equal(amendment.originalText,null);assert(amendment.gaps.some(g=>g.code==='comparison-grid'));continue;
    }
    assert.equal(typeof amendment.proposedText,'string',doc.id);
    assert(!amendment.gaps.some(g=>['comparison-header','comparison-grid'].includes(g.code)),doc.id);
    if(['fr','it'].includes(doc.language)||doc.id==='A-10-2026-0048-AM-2') {
      assert.equal(amendment.originalText,'');assert.equal(amendment.baseline,'unknown');
      assert.equal(amendment.proposedText,{en:'The European Parliament rejects the Commission proposal.',fr:'Le Parlement européen rejette la proposition de la Commission.',it:'Il Parlamento europeo respinge la proposta della Commissione.'}[doc.language]);
    } else {
      assert.equal(amendment.baseline,'commission-proposal');
      if(doc.id==='A-10-2026-0202-AM-88') {
        assert.equal(amendment.baselineSource.headings[0].left.raw,'Commission proposal');
        assert.equal(amendment.baselineSource.headings[0].right.raw,'Modification');
        assert.equal(amendment.originalText,'');assert.match(amendment.proposedText,/^\(3a\)\tIt should be emphasised/);
      } else {
        assert.match(amendment.originalText,/Iron and [Ss]teel/);assert.match(amendment.proposedText,/Iron and [Ss]teel/);
        assert(amendment.originalText.includes('CN code\tGreenhouse gas'));
        assert(amendment.proposedText.includes('\tCarbon dioxide'));
      }
    }
  }
});

test('stacked sections require both exact headings and retain tab-delimited table columns and formatting',()=>{
  const full=text=>row('<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>'+p(text)+'</w:tc>');
  const start=full('Text proposed by the Commission'),end=full('Amendment');
  const original=row(cell(p('CN code')),cell(p('Greenhouse gas'))),proposed=row(cell('<w:p><w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>CO2</w:t></w:r></w:p>'),cell(p('Changed')));
  const tbl=rows=>'<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>'+rows+'</w:tbl>';
  for(const tables of [tbl(start+original+end+proposed),tbl(start+original)+tbl(end+proposed)]) {
    const amendment=extractAmendments(archive(body(metadata()+tables+p('</Amend>'))),options).amendments[0];
    assert.equal(amendment.originalText,'CN code\tGreenhouse gas');assert.equal(amendment.proposedText,'CO2\tChanged');
    assert.deepEqual(amendment.proposedFormatting,[{start:0,end:3,kind:'subscript'}]);
  }
  for(const rows of [start+original,start+original+full('Unidentified proposal')+proposed,start+original+end+proposed+end+proposed]) {
    const amendment=extractAmendments(archive(body(metadata()+tbl(rows)+p('</Amend>'))),options).amendments[0];
    assert.equal(amendment.originalText,null);assert.equal(amendment.proposedText,null);
    assert(amendment.gaps.some(g=>g.code==='comparison-header'));
  }
});

test('official nested-cell and budget-annex tables retain wording on their explicitly headed sides',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/amendment-nested-tables.json',import.meta.url),'utf8'));
  for(const doc of fixture.documents) {
    const result=extractAmendments(archive(doc.documentXml,doc.stylesXml,doc.numberingXml?{'word/numbering.xml':doc.numberingXml}:{}),doc);
    const amendment=result.amendments.find(row=>doc.id.endsWith('-AM-'+row.number));
    assert.equal(typeof amendment.originalText,'string',doc.id);assert.equal(typeof amendment.proposedText,'string',doc.id);
    assert(!amendment.gaps.some(gap=>['nested-table','comparison-grid','comparison-header'].includes(gap.code)),doc.id);
    if(doc.id==='B-10-2026-0469-AM-2') {
      assert.equal(amendment.originalText,'');
      assert.equal(amendment.proposedText,'7a. Calls on the Commission to ensure the convergence towards the highest standards between the Union and its partners in free trade agreements and in agri-food imports and exports;');
    } else if(/AM-(112|136)$/.test(doc.id)) {
      assert.match(amendment.originalText,/7602 Aluminium waste and scrap except post-consumer scrap\tCarbon dioxide/);
      assert.match(amendment.proposedText,/7602 Aluminium waste and scrap\tCarbon dioxide/);
    } else if(doc.id==='A-10-2026-0201-AM-113') {
      assert.equal(amendment.originalText,'');assert.match(amendment.proposedText,/threshold referred to in Article 2a shall be set at 5 tonnes/);
    } else if(doc.id==='A-10-2026-0073-AM-120') {
      assert.equal(amendment.baseline,'present-text');assert.match(amendment.originalText,/Directive 2006\/42\/EC/);assert.match(amendment.proposedText,/\(31a\)/);
    } else {
      assert.equal(amendment.originalText,'');assert.match(amendment.proposedText,/Title\tChapter\tArticle\tItem\tDescription/);
    }
  }
});

test('nested wording retains source order and formatting; unsupported inner grids and objects still withhold',()=>{
  const nested='<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid>'+row(cell('<w:p><w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r></w:p>'))+'</w:tbl>';
  const complete=metadata()+table(row(cell(p('')),cell(p('CO'),nested,p('after'))))+p('</Amend>');
  const wording=extractAmendments(archive(body(complete)),options).amendments[0];
  assert.equal(wording.proposedText,'CO\n2\nafter');assert.deepEqual(wording.proposedFormatting,[{start:3,end:4,kind:'subscript'}]);
  for(const content of [nested.replace('<w:gridCol/>','<w:gridCol/><w:gridCol/>'),nested.replace('<w:tc>','<w:tc><w:tcPr><w:vMerge/></w:tcPr>'),nested.replace('<w:t>2</w:t>','<w:drawing/>')]) {
    const result=extractAmendments(archive(body(metadata()+table(row(cell(p('')),cell(content)))+p('</Amend>'))),options).amendments[0];
    assert.equal(result.originalText,null);assert.equal(result.proposedText,null);
    assert(result.gaps.some(gap=>['nested-table','non-text-content'].includes(gap.code)));
  }
});
