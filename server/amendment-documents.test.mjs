import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { AMENDMENT_EXTRACTION_VERSION, extractAmendments } from './amendment-documents.mjs';
import { docxParts, downloadDocxBuffer, downloadDocx } from './document-text.mjs';
import { amendmentDownloads } from './amendments-worker.mjs';

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
  assert.equal(AMENDMENT_EXTRACTION_VERSION,'6');
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
    // A nested-only row has no flattened outer-cell text. It must still count
    // as a lost comparison row rather than an ignorable blank separator.
    {code:'nested-table',comparison:table(supported,row(cell(table(row(cell(p('Nested legal text')),cell(p('Nested proposal'))))),cell(p(''))))},
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

test('superscript, subscript and raised text cannot silently turn 10 and 3 into 103',()=>{
  for(const properties of ['<w:vertAlign w:val="superscript"/>','<w:vertAlign w:val="subscript"/>','<w:position w:val="6"/>'])for(const prefix of ['',row(cell(p('First original')),cell(p('First proposal')))]) {
    const xml=body(metadata()+table(prefix,row(cell('<w:p>'+run('10')+formattedRun(properties,'3')+'</w:p>'),cell(p('Proposed wording'))))+p('</Amend>'));
    const result=extractAmendments(archive(xml),options);
    assert.equal(result.amendments[0].originalText,null);assert.equal(result.amendments[0].proposedText,null);
    assert(result.amendments[0].gaps.some(gap=>gap.code==='vertical-text-loss'&&gap.number===1));
  }
});

test('inherited character, paragraph and default baseline formatting remains explicit text loss',()=>{
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
    assert.equal(result.amendments[0].originalText,null);assert.equal(result.amendments[0].proposedText,null);
    assert(result.amendments[0].gaps.some(gap=>gap.code==='vertical-text-loss'&&gap.number===1));
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

test('an unscoped numbering failure withholds wording and exposes the document-scoped gap on every amendment',()=>{
  const unsupportedNumbering='<w:p><w:pPr><w:numPr><w:numId w:val="77"/></w:numPr></w:pPr>'+run('A paragraph whose legal number cannot be read.')+'</w:p>';
  const xml=body(metadata()+table(row(cell(unsupportedNumbering),cell(p('Proposed wording'))))+p('</Amend>')+metadata(2)+table(row(cell(p('Other original')),cell(p('Other proposal'))))+p('</Amend>'));
  const result=extractAmendments(archive(xml),{...options,listId:'B-10-2026-0424-AM-001-002'});
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
