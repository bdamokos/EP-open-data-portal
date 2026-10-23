import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {XMLParser} from 'fast-xml-parser';
import {parseProposal,parseTargetLabel,unitLabel,normaliseForMatching,proposalCandidates} from './proposal-structure.mjs';
import {PROPOSAL_LANGUAGES,parseLabelSegment} from './proposal-labels.mjs';
import {ommlToMathML,isSafeMathML} from './proposal-math.mjs';
import {docxContent} from './document-text.mjs';
import {instructionOperation} from './proposal-instructions.mjs';
import {REGION_HEADINGS} from './proposal-regions.mjs';
import {quotationClosed} from './proposal-quotation.mjs';

function archive(documentXml,extra=[]) {
  const entries=[['word/document.xml',documentXml],...extra],locals=[],directory=[];let offset=0;
  for(const [filename,xml] of entries) {
    const name=Buffer.from(filename),body=Buffer.from(xml),compressed=deflateRawSync(body),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,name,compressed);directory.push(central,name);offset+=local.length+name.length+compressed.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,central,end]);
}
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const p=(text,style='')=>`<w:p>${style?`<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`:''}<w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`;
const body=xml=>`<w:document xmlns:w="urn:word" xmlns:m="urn:math"><w:body>${xml}</w:body></w:document>`;
const flat=units=>units.flatMap(unit=>[unit,...flat(unit.children)]);
const fixture=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8'));
const path=unit=>unit.path.map(segment=>`${segment.kind}:${segment.value}`).join('/');
const sourceUrl='https://publications.europa.eu/resource/cellar/731e787f-f4fb-11ef-b7db-01aa75ed71a1.0001.01/DOC_1';

test('24 language grammars parse real Commission article headings and all five real EP outer target labels',()=>{
  const examples=fixture('proposal-language-excerpts.json');
  assert.deepEqual(examples.languages.map(row=>row.language).sort(),[...PROPOSAL_LANGUAGES].sort());
  for(const row of examples.languages) {
    for(const [index,heading] of row.articleHeadings.entries()) {
      const actual=parseLabelSegment(heading,row.language);assert(actual,`${row.language}: ${heading}`);
      assert.equal(actual.kind,'article');assert.equal(actual.value,String(index+1));
      assert.equal(parseLabelSegment(unitLabel(actual,row.language),row.language).value,actual.value);
    }
    for(const text of row.targetLabels) {
      const target=parseTargetLabel(text,row.language);assert.equal(target.complete,true,`${row.language}: ${text}: ${target.unparsed}`);
      assert(target.segments.length>=3);assert(['article','annex'].includes(target.segments[0].kind));
      assert.equal(target.segments.at(-1).kind,'point');
    }
    const inserted=parseTargetLabel(row.underlyingLabels[3],row.language);
    assert(inserted.complete,`${row.language} inserted target: ${inserted.unparsed}`);
    assert(inserted.segments.at(-1).isNew,`${row.language} (new) qualifier`);
    assert(inserted.segments.at(-1).suffix,`${row.language} suffix is kept`);
    for(const sample of row.instructionSamples)assert.equal(instructionOperation(sample.text,row.language),sample.operation,`${row.language}: ${sample.text}`);
    for(const [index,text] of row.annexHeadings.entries()){const label=parseLabelSegment(text,row.language);assert(label,`${row.language}: ${text}`);assert.equal(label.kind,'annex');assert.equal(label.value,index===0?'I':'II');}
  }
  // Preserve published translation discrepancies, rather than silently making
  // Portuguese "Article I" into an annex or Dutch "1" into Roman "I".
  assert.equal(parseTargetLabel(examples.languages.find(row=>row.language==='pt').targetLabels[4],'pt').segments[0].kind,'article');
  assert.equal(parseTargetLabel(examples.languages.find(row=>row.language==='nl').targetLabels[4],'nl').segments[0].value,'1');
  assert.equal(parseTargetLabel(examples.languages.find(row=>row.language==='it').targetLabels[0],'it').segments.length,3,'missing paragraph is not invented');
});

test('target grammar preserves outer vs underlying labels, new suffixes, unsupported fragments and exact language',()=>{
  const p=parseTargetLabel('Article 1 – paragraph 1 – point 4 – point a\nRegulation (EU) 2023/956 — Article 6 – paragraph 1','en');
  assert.deepEqual(p.segments.map(segment=>[segment.kind,segment.value]),[['article','1'],['paragraph','1'],['point','4'],['point','a']]);
  assert.equal(p.underlyingLabel,'Regulation (EU) 2023/956 — Article 6 – paragraph 1');
  for(const suffix of ['1a','1 a'])assert.equal(parseTargetLabel(`Article ${suffix} (new)`,'en').segments[0].value,'1a');
  assert.equal(unitLabel(parseTargetLabel('Article 1 a (new)').segments[0]),'Article 1a (new)');
  assert.equal(parseTargetLabel('Article 1 – mysterious 8').complete,false);
  assert.equal(parseTargetLabel('Article 1 – paragraph 1','fr').complete,false);
  assert.throws(()=>parseTargetLabel('Article 1','xx'),/Unsupported proposal language/);
  assert.equal(parseTargetLabel('Άρθρο 1 α','el').segments[0].suffix,'α');
  assert.equal(parseTargetLabel('Член 1 а','bg').segments[0].suffix,'а');
  const greekRoman=parseTargetLabel('ΠΑΡΑΡΤΗΜΑ ΙΙ','el').segments[0];assert.equal(greekRoman.value,'II');assert.equal(greekRoman.sourceValue,'ΙΙ');
});

test('an unnumbered source article keeps its own extent and an explicit unavailable label',()=>{
  const result=parseProposal(archive(body(p('Άρθρο 19','Titrearticle')+p('1. Before.')+p('Άρθρο\nΑυτόματη δημιουργία αρχείων καταγραφής','Titrearticle')+p('1. Unnumbered source article.')+p('Άρθρο 21','Titrearticle')+p('1. After.'))),{language:'el'});
  const articles=flat(result.units).filter(unit=>unit.kind==='article');assert.deepEqual(articles.map(unit=>unit.label.value),['19','?','21']);assert(articles[1].label.unavailable);assert(result.gaps.some(gap=>gap.code==='unlabelled-article'));assert.equal(proposalCandidates(result,'Άρθρο 20',{language:'el'}).length,0);
});

test('DOCX-derived plain text retains localized memorandum and financial regions in all 24 languages',()=>{
  for(const row of fixture('proposal-language-excerpts.json').languages){const headings=REGION_HEADINGS[row.language];const text=[headings.memorandum[0],'1. Memorandum context.','2025/0039 (COD)',headings['enacting-formula'][0],row.articleHeadings[0],'1. Legal provision.',headings['financial-statement'][0],'Article 99 financial example.'].join('\n');const result=parseProposal(text,{language:row.language}),units=flat(result.units);assert.equal(units.filter(unit=>unit.kind==='article').length,1,row.language);assert(units.some(unit=>unit.kind==='memorandum'&&!unit.normative),row.language);assert(units.some(unit=>unit.kind==='financial-statement'&&!unit.normative),row.language);assert(result.gaps.some(gap=>gap.code==='source-structure-unavailable'));}
});

test('proposal numbering continues shared abstract lists, honors explicit restarts and keeps independent lists separate',()=>{
  const level=id=>`<w:abstractNum w:abstractNumId="${id}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="(%1)"/></w:lvl></w:abstractNum>`;
  const number=(id,abstract,start='')=>`<w:num w:numId="${id}"><w:abstractNumId w:val="${abstract}"/>${start?`<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride>`:''}</w:num>`;
  const numbering=`<w:numbering xmlns:w="urn:word">${level(1)}${level(2)}${number(1,1,'1')}${number(2,1)}${number(3,1,'7')}${number(4,2)}</w:numbering>`;
  const styles='<w:styles xmlns:w="urn:word"><w:style w:styleId="Point0number" w:type="paragraph"><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style></w:styles>';
  const numbered=(text,id)=>`<w:p><w:pPr><w:pStyle w:val="Point0number"/>${id?`<w:numPr><w:numId w:val="${id}"/></w:numPr>`:''}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const buffer=archive(body(p('ANNEX I','Annexetitre')+numbered('First',1)+numbered('Second')+numbered('Third')+numbered('Restart at seven',3)+numbered('Continue eight')+numbered('Independent list',4)+numbered('Continue nine')),[['word/styles.xml',styles],['word/numbering.xml',numbering]]);
  const result=parseProposal(buffer,{item:'annex'});
  assert.deepEqual(result.paragraphs.slice(1).map(p=>p.properties.numberingLabel),['(1)','(2)','(3)','(7)','(8)','(1)','(9)']);
  assert.deepEqual(result.paragraphs.map(p=>p.text),docxContent(buffer).paragraphs,'proposal labels use the shared Word numbering resolver');
});

test('published CBAM DOCX numbering labels remain 1, 2, 3 with proposal metadata',()=>{
  const sample=fixture('docx-numbering-cbam.json');
  const buffer=archive(sample.documentXml,[['word/styles.xml',sample.stylesXml],['word/numbering.xml',sample.numberingXml]]);
  const parsed=parseProposal(buffer,{language:sample.language,item:'annex',sourceUrl:sample.sourceUrl});
  assert.deepEqual(parsed.paragraphs.map(paragraph=>paragraph.text),sample.expectedParagraphs);
  assert.deepEqual(parsed.paragraphs.map(paragraph=>paragraph.properties.numberingLabel),['(1)','(2)','(3)']);
  assert.deepEqual(parsed.paragraphs.map(paragraph=>paragraph.properties.numbering),[{id:'2',abstractId:'8',level:0,format:'decimal'},{id:'19',abstractId:'8',level:0,format:'decimal'},{id:'19',abstractId:'8',level:0,format:'decimal'}]);
});

test('localized numbered instruction text cannot be consumed as a dotted number suffix',()=>{
  for(const row of fixture('proposal-language-excerpts.json').languages) {
    const article9=unitLabel({kind:'article',value:'9'},row.language);
    const xml=body(p(row.articleHeadings[0],'Titrearticle')+p('Introductory provision:')+p(row.numberedInstruction,'Point0')+p('‘'+article9,'Titrearticle')+p('Replacement text.’;'));
    const result=parseProposal(archive(xml),{language:row.language,sourceUrl:row.sourceUrl}),units=flat(result.units);
    assert.equal(units.find(unit=>unit.kind==='point'&&unit.scope==='proposal').label.value,'7',row.language);
    assert.equal(units.find(unit=>unit.kind==='article'&&unit.label.value==='9').scope,'quoted',row.language);
    assert(!result.gaps.some(gap=>gap.code==='duplicate-label'),row.language);
  }
});

test('exact candidates expose true duplicates and their conflicts without choosing by wording or inventing aliases',()=>{
  const parsed=parseProposal(archive(body(p('Article 1')+p('The Regulation is amended as follows:')+p('(1) First exact instruction.','Point0')+p('(1) Second exact instruction.','Point0')+p('Article 2')+p('The Regulation is amended as follows:')+p('(1) Different parent.','Point0'))));
  const candidates=proposalCandidates(parsed,'Article 1 – paragraph 1 – point 1');
  assert.equal(candidates.length,2);assert(candidates.every(unit=>unit.pathConflict));
  assert.equal(new Set(candidates.map(unit=>unit.id)).size,2);
  assert.equal(proposalCandidates(parsed,'Article 2 – paragraph 1 – point 1').length,1);
  assert.equal(proposalCandidates(parsed,'Article 1 – paragraph 1 – point 2').length,0);
  const matching=candidates.filter(unit=>normaliseForMatching(unit.content.map(i=>parsed.paragraphs[i].text).join('\n'))===normaliseForMatching('First exact instruction.'));
  assert.equal(matching.length,1,'2C can retain this exact-candidate wording evidence');
});

test('parse cache uses exact content, parser version and context and cannot be mutated by consumers',()=>{
  const input={paragraphs:['Article 1','1. Cache example.']},identity={work:'exact-work'};
  const first=parseProposal(input,{identity}),again=parseProposal({...input},{identity:{...identity}});
  assert.equal(first,again);assert(Object.isFrozen(first));assert(Object.isFrozen(first.units[0]));
  assert.throws(()=>first.paragraphs.push({text:'altered'}),TypeError);
  assert(!Object.isFrozen(input));assert(!Object.isFrozen(identity));
  assert.notEqual(parseProposal({...input,paragraphs:['Article 1','1. Different wording.']},{identity}),first);
  assert.notEqual(parseProposal(input,{identity,item:'annex'}),first);
  assert.notEqual(parseProposal(input,{identity,sourceUrl}),first);
});

test('proposal tree nests replacements under instructions and preserves complete extents and quote targets',()=>{
  const xml=body(p('EXPLANATORY MEMORANDUM','Exposdesmotifstitre')+p('1. Context, not a legal paragraph.')+p('2025/0039 (COD)','Rfrenceinterinstitutionnelle')+
    p('REGULATION','Typedudocument')+p('Having regard to the Treaty,')+p('(1) A recital.','ManualConsidrant')+p('HAVE ADOPTED THIS REGULATION:','Formuledadoption')+
    p('Article 1','Titrearticle')+p('Amendments','Titrearticle')+p('Regulation (EU) 2023/956 is amended as follows:')+
    p('(1) Article 6 is amended as follows:','Point0')+p('(a) paragraph 1 is replaced by the following:','Point1')+
    p('‘1. Replacement lead-in:')+p('(a) first factor;','Point2')+p('(i) inner factor;','Point3')+p('Continuation of the inner factor.’;')+
    p('(b) paragraph 2 is deleted;','Point1')+p('(2) Article 9 is replaced by the following:','Point0')+p('‘Article 9','Titrearticle')+
    p('Replacement title','Titrearticle')+p('1. First replacement paragraph.')+p('Second subparagraph.’;')+p('Article 2','Titrearticle')+p('Entry into force','Titrearticle')+
    p('This Regulation enters into force.')+p('Done at Brussels,','Fait')+p('LEGISLATIVE FINANCIAL AND DIGITAL STATEMENT','Fichefinanciretitre')+p('Article 99 in a financial example.'));
  const result=parseProposal(archive(xml),{language:'en',sourceUrl});const units=flat(result.units);
  assert.deepEqual(units.filter(unit=>unit.kind==='article'&&unit.scope==='proposal').map(unit=>unit.label.value),['1','2']);
  const article1=units.find(unit=>path(unit)==='article:1'),instruction=units.find(unit=>path(unit)==='article:1/paragraph:1/point:1/point:a');
  assert(article1);assert(instruction);assert.equal(instruction.instruction.operation,'replace');
  const quoted=flat(instruction.children).find(unit=>unit.kind==='paragraph');assert(quoted);assert.equal(quoted.scope,'quoted');
  assert.deepEqual(quoted.instructionPath,instruction.path);assert.equal(quoted.underlyingPath.at(-1).value,'1');
  assert.deepEqual(quoted.underlyingPath.map(segment=>[segment.kind,segment.value]),[['article','6'],['paragraph','1']]);
  assert(flat(quoted.children).some(unit=>unit.label?.value==='i'));
  const sibling=units.find(unit=>path(unit)==='article:1/paragraph:1/point:1/point:b');assert(sibling);assert.equal(sibling.scope,'proposal');
  assert.equal(instruction.extent.end,sibling.extent.start);
  const innerArticle=units.find(unit=>unit.kind==='article'&&unit.label.value==='9');assert.equal(innerArticle.scope,'quoted');assert.equal(innerArticle.underlyingPath[0].value,'9');
  assert.equal(article1.extent.end,units.find(unit=>unit.kind==='article'&&unit.label.value==='2').extent.start);
  assert(units.filter(unit=>['memorandum','signature','financial-statement'].includes(unit.kind)).every(unit=>!unit.normative));
  assert.equal(result.complete,true);assert.equal(result.paragraphs.length,docxContent(archive(xml)).paragraphs.length);
  const owned=units.flatMap(unit=>unit.content);assert.equal(new Set(owned).size,result.paragraphs.length,'all paragraphs retained');
});

test('definition lists and manually dotted amending instructions remain points beneath their introductory paragraph',()=>{
  const definitions=parseProposal(archive(body(p('Artikel 3','Titrearticle')+p('Für die Zwecke dieser Verordnung bezeichnet der Ausdruck')+p('1. First definition.','ManualNumPar1')+p('2. Second definition.','ManualNumPar1'))),{language:'de'});
  assert.equal(proposalCandidates(definitions,'Artikel 3 – Absatz 1 – Nummer 1',{language:'de'}).length,1);assert(!definitions.gaps.some(gap=>gap.code==='duplicate-label'));
  const amended=parseProposal(archive(body(p('Artikel 81','Titrearticle')+p('Die Verordnung wird wie folgt geändert:')+p('1. In Artikel 17 wird folgender Absatz angefügt:')+p('„(3) A replacement paragraph.“;')+p('2. In Artikel 19 wird folgender Absatz angefügt:')+p('„(4) Another replacement paragraph.“;'))),{language:'de'});
  const units=flat(amended.units);assert.deepEqual(units.filter(unit=>unit.scope==='proposal'&&unit.kind==='point').map(unit=>unit.label.value),['1','2']);assert.equal(units.filter(unit=>unit.kind==='quotation').length,2);assert(!amended.gaps.length);
});

test('inline quotation slices, article suffixes, indents and stable paths retain original punctuation',()=>{
  const text='(a) paragraph 1 is replaced by the following: ‘1. Quoted text.’;';
  const buffer=archive(body(p('Article 1')+p(text,'Point1')+p('Article 1a')+p('1. Another paragraph.')+p('— first indent')+p('Article 2')));
  const parsed=parseProposal(buffer,{sourceUrl}),again=parseProposal(buffer,{sourceUrl}),units=flat(parsed.units);
  assert.deepEqual(units.map(unit=>unit.id),flat(again.units).map(unit=>unit.id));
  assert.deepEqual(units.filter(unit=>unit.kind==='article'&&unit.scope==='proposal').map(unit=>unit.label.value),['1','1a','2']);
  const quoted=units.find(unit=>unit.scope==='quoted'&&unit.kind==='paragraph'),parent=units.find(unit=>unit.instruction);
  assert(quoted);assert(parent);assert.equal(parent.spans[0].end,quoted.spans[0].start);
  assert.equal(parsed.paragraphs[quoted.content[0]].text.slice(quoted.spans[0].start), '‘1. Quoted text.’;');
  assert(units.some(unit=>unit.kind==='indent'));
});

test('tables remain ordered structured cells, including spans, merges, nested tables and math',()=>{
  const cell=(xml,props='')=>`<w:tc><w:tcPr>${props}</w:tcPr>${xml}</w:tc>`;
  const table=`<w:tbl><w:tr>${cell(p('A'),' <w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>')}${cell(p('B'))}</w:tr><w:tr>${cell(p('C'),'<w:vMerge/>')}${cell(`<w:tbl><w:tr>${cell(p('Nested'))}</w:tr></w:tbl>`)}</w:tr></w:tbl>`;
  const result=parseProposal(archive(body(p('ANNEX I','Annexetitre')+p('1. Table follows:')+table+p('2. After table.'))),{item:'annex',sourceUrl});
  const units=flat(result.units),unit=units.find(unit=>unit.kind==='table');assert(unit);assert.equal(unit.table.rows.length,2);
  assert.deepEqual(unit.table.rows[0].cells.map(cell=>cell.colSpan),[2,1]);assert.equal(unit.table.rows[1].cells[0].verticalMerge,'continue');
  assert.equal(unit.table.nestedTables.length,1);assert.equal(unit.content.map(index=>result.paragraphs[index].text).join('|'),'A|B|C|Nested');
  assert.equal(result.paragraphs[unit.extent.end].text,'2. After table.');assert(result.contentComplete);
});

test('CBAM real English outline retains recitals 1–30, 29 amending points, quoted articles, and Article 2',()=>{
  const excerpt=fixture('52025PC0087-act-excerpt.json'),parsed=parseProposal(excerpt,{language:'en',sourceUrl:excerpt.sourceUrl}),units=flat(parsed.units);
  assert.deepEqual(units.filter(unit=>unit.kind==='recital').map(unit=>unit.label.value),Array.from({length:30},(_,i)=>String(i+1)));
  assert.deepEqual(units.filter(unit=>unit.kind==='article'&&unit.scope==='proposal').map(unit=>unit.label.value),['1','2']);
  const outerPoints=units.filter(unit=>unit.kind==='point'&&unit.scope==='proposal'&&unit.path.length===3);
  assert.deepEqual(outerPoints.map(unit=>unit.label.value),Array.from({length:29},(_,i)=>String(i+1)));
  assert.deepEqual(units.filter(unit=>unit.kind==='article'&&unit.scope==='quoted').map(unit=>unit.label.value),['9','10','10a','25a']);
  for(const address of ['article:1/paragraph:1/point:4/point:a','article:1/paragraph:1/point:16/point:a','article:1/paragraph:1/point:21/point:a'])assert(units.some(unit=>path(unit)===address),address);
  assert(parsed.gaps.some(gap=>gap.code==='excerpted-source'));assert.equal(parsed.complete,false);
});

test('CBAM annex uses the official PDF/HTML 1–3 sequence, resolves amendment 8 uniquely, and retains all 20 equations',()=>{
  const excerpt=fixture('52025PC0087-annex-excerpt.json'),parsed=parseProposal(excerpt,{item:'annex',sourceUrl:excerpt.sourceUrl}),units=flat(parsed.units);
  assert.deepEqual(units.filter(unit=>unit.kind==='annex'&&unit.scope==='proposal').map(unit=>unit.label.value),['I','II']);
  assert.deepEqual(units.filter(unit=>unit.kind==='annex'&&unit.scope==='quoted').map(unit=>unit.label.value),['VII']);
  assert.equal(parsed.objects.filter(object=>object.kind==='math').length,20);
  assert(parsed.objects.filter(object=>object.kind==='math').every(object=>object.complete&&object.status==='converted'&&object.sourceUrl===excerpt.sourceUrl));
  assert(!parsed.gaps.some(gap=>gap.code==='duplicate-label'));
  const points=units.filter(unit=>unit.scope==='proposal'&&unit.kind==='point'&&unit.path.length===3&&unit.path[0].value==='I');
  assert.deepEqual(points.map(unit=>unit.label.value),['1','2','3']);
  const candidates=proposalCandidates(parsed,'Annex I – paragraph 1 – point 2 – point a');assert.equal(candidates.length,1);assert(!candidates[0].pathConflict);
  assert.equal(candidates[0].instruction.operation,'replace');assert(flat(candidates[0].children).some(unit=>unit.content.some(index=>parsed.paragraphs[index].text.includes('When reliable data'))));
  assert.equal(parsed.contentComplete,false);
});

test('AI Act real annex outline retains I–IX and the eight high-risk areas with nested points',()=>{
  const excerpt=fixture('52021PC0206-annex-excerpt.json'),parsed=parseProposal(excerpt,{item:'annex',sourceUrl:excerpt.sourceUrl}),units=flat(parsed.units);
  assert.deepEqual(units.filter(unit=>unit.kind==='annex'&&unit.scope==='proposal').map(unit=>unit.label.value),['I','II','III','IV','V','VI','VII','VIII','IX']);
  const annex=units.find(unit=>unit.kind==='annex'&&unit.label.value==='III');
  const points=flat(annex.children).filter(unit=>unit.kind==='point'&&unit.label.level===0);
  assert.equal(points.length,8);assert(points.every(unit=>unit.children.some(child=>child.kind==='point')));
  const annexII=units.find(unit=>unit.kind==='annex'&&unit.label.value==='II');assert.deepEqual(annexII.children.filter(unit=>unit.kind==='section').map(unit=>unit.label.value),['a','b']);
});

const mathParser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false});
const math=xml=>ommlToMathML(mathParser.parse(`<m:oMath xmlns:m="urn:math">${xml}</m:oMath>`),{sourceUrl});
const r=text=>`<m:r><m:t>${escape(text)}</m:t></m:r>`;
test('OMML subset converts fractions, scripts, radicals, n-ary, delimiters, matrices and text to allowlisted MathML',()=>{
  const cases=[
    [`<m:f><m:num>${r('1')}</m:num><m:den>${r('2')}</m:den></m:f>`,'mfrac'],
    [`<m:sSubSup><m:e>${r('x')}</m:e><m:sub>${r('i')}</m:sub><m:sup>${r('2')}</m:sup></m:sSubSup>`,'msubsup'],
    [`<m:rad><m:deg>${r('3')}</m:deg><m:e>${r('x')}</m:e></m:rad>`,'mroot'],
    [`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/> <m:e>${r('x')}</m:e></m:rad>`,'msqrt'],
    [`<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${r('i=1')}</m:sub><m:sup>${r('N')}</m:sup><m:e>${r('x')}</m:e></m:nary>`,'msubsup'],
    [`<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e>${r('a')}</m:e><m:e>${r('b')}</m:e></m:d>`,'mo'],
    [`<m:m><m:mr><m:e>${r('1')}</m:e><m:e>${r('2')}</m:e></m:mr></m:m>`,'mtable'],
    [r('chosen such that < target'),'mtext'],
  ];
  for(const [xml,tag] of cases){const out=math(xml);assert.equal(out.complete,true,JSON.stringify(out.unsupported));assert(isSafeMathML(out.math));assert(JSON.stringify(out.math).includes(`"tag":"${tag}"`));}
  assert.equal(math(`<m:sSup><m:e>${r('x')}</m:e><m:sup>${r('2')}</m:sup></m:sSup>`).complete,true);
  assert.equal(math(`<m:sSub><m:e>${r('x')}</m:e><m:sub>${r('i')}</m:sub></m:sSub>`).complete,true);
});
test('accents convert with allowlisted MathML attributes; unsupported objects retain safe official links',()=>{
  for(const character of ['\u0305','\u0302','\u0303','\u0307']){const converted=math(`<m:acc><m:accPr><m:chr m:val="${character}"/></m:accPr><m:e>${r('Q')}</m:e></m:acc>`);assert(converted.complete);assert(isSafeMathML(converted.math));assert(JSON.stringify(converted.math).includes('"accent":"true"'));}
  const unknown=math(`<m:phant><m:e>${r('Q')}</m:e></m:phant>`);assert.equal(unknown.math,null);assert.equal(unknown.complete,false);assert.deepEqual(unknown.unsupported,['m:phant']);assert.equal(unknown.sourceUrl,sourceUrl);
  assert.equal(ommlToMathML(mathParser.parse(`<m:oMath>${r('x')}</m:oMath>`),{sourceUrl:'javascript:alert(1)'}).sourceUrl,null);
  assert.equal(isSafeMathML({tag:'math',children:[{tag:'script',children:['alert(1)']}]}),false);
  assert.equal(isSafeMathML({tag:'math',children:[],onload:'alert(1)'}),false);
  assert.equal(isSafeMathML({tag:'math',children:[{tag:'mover',children:[],attributes:{onclick:'alert(1)'}}]}),false);
  const xml=body(p('ANNEX I','Annexetitre')+`<w:p><m:oMath><m:f><m:num>${r('1')}</m:num><m:den>${r('2')}</m:den></m:f></m:oMath></w:p><w:p><w:r><w:drawing/></w:r></w:p>`);
  const result=parseProposal(archive(xml),{item:'annex',sourceUrl});assert.equal(result.objects[0].status,'converted');assert(result.paragraphs[1].complete);assert.equal(result.objects[1].status,'unresolved');assert(!result.paragraphs[2].complete);assert(!result.complete);
});

test('normalisation aligns real CBAM amendments 5, 7 and 8 with explicit punctuation differences',()=>{
  for(const row of fixture('proposal-matching-excerpts.json').amendments){assert.notEqual(row.original.replace(/\s+/g,''),row.sourceText.replace(/\s+/g,''));assert.equal(normaliseForMatching(row.original),normaliseForMatching(row.sourceText),`amendment ${row.number}`);}
  assert.equal(normaliseForMatching('‘1.\u00a0The co\u00adoperator’s “claim”—and «word».’;'),`The cooperator's "claim"-and "word`);
  assert.notEqual(normaliseForMatching('By 31 August.'),normaliseForMatching('By 30 September.'));
  assert.notEqual(normaliseForMatching('all goods'),normaliseForMatching('All goods'));
  assert.notEqual(normaliseForMatching('cikk α'),normaliseForMatching('cikk a'));
  assert.equal(normaliseForMatching('(a) first;\n(b) second.'),'first second');
  assert.equal(normaliseForMatching('(a)first;\n1.Second.'),'first Second');
  assert.equal(normaliseForMatching('1. First.',{stripNumbering:false,stripTerminators:false}),'1. First.');
});

test('8 MiB DOCX-derived text parses within bounded time and a 256 MiB V8 heap',()=>{
  const module=new URL('./proposal-structure.mjs',import.meta.url).href;
  const script=`import{parseProposal}from ${JSON.stringify(module)};const line='Ordinary unnumbered provision with unchanged words. '.repeat(11).slice(0,500);let s='Article 1\\n'+Array.from({length:16000},()=>line).join('\\n')+'\\nArticle 2\\n';s+='x'.repeat(8*1024*1024-Buffer.byteLength(s));const before=performance.now();const result=parseProposal(s);if(result.paragraphs.length!==16003)throw Error('paragraph loss '+result.paragraphs.length);if(performance.now()-before>15000)throw Error('parse budget exceeded');console.log(JSON.stringify({bytes:Buffer.byteLength(s),ms:performance.now()-before,heap:process.memoryUsage().heapUsed}));`;
  const result=spawnSync(process.execPath,['--max-old-space-size=256','--input-type=module','-e',script],{encoding:'utf8',timeout:25000});
  assert.equal(result.status,0,result.stderr);const measured=JSON.parse(result.stdout);assert(measured.bytes>=8_000_000);assert(measured.heap<256*1024*1024);
});

test('inline replacement openings retain subsequent paragraphs and articles until their outer boundary',()=>{
  const instruction='(1) Article 6 is replaced by the following: ‘Article 6';
  const result=parseProposal(archive(body(p('Article 1')+p('The Regulation is amended as follows:')+p(instruction,'Point0')+
    p('1. Replacement text.')+p('Article 7')+p('1. A second replacement article.’;')+p('Article2')+p('Final provision.'))));
  assert.deepEqual(flat(result.units).filter(unit=>unit.kind==='article'&&unit.scope==='proposal').map(unit=>unit.label.value),['1','2']);
  assert.equal(proposalCandidates(result,'Article 7').length,0);
  const owner=proposalCandidates(result,'Article 1 – paragraph 1 – point 1')[0];
  const quote=owner.children.find(unit=>unit.kind==='quotation');
  assert.deepEqual(quote.children.filter(unit=>unit.kind==='article').map(unit=>unit.label.value),['6','7']);
  assert.equal(owner.extent.end,6);assert.equal(proposalCandidates(result,'Article 1')[0].extent.end,6);
  assert.equal(quote.children[0].spans[0].start,instruction.indexOf('‘'));
  assert.equal(result.complete,true);
  const unclosed=parseProposal(archive(body(p('Article 1')+p(instruction,'Point0')+p('1. No closing mark.')+p('Article 7'))));
  assert.equal(proposalCandidates(unclosed,'Article 7').length,0);
  assert(unclosed.gaps.some(gap=>gap.code==='unclosed-quotation'));assert.equal(unclosed.complete,false);
});

test('inner term quotes and apostrophes cannot close the outer replacement',()=>{
  for(const [language,open,close,innerOpen,innerClose] of [
    ['en','‘','’','“','”'],['en','“','”','‘','’'],['de','„','“','‚','‘'],
    ['fr','«','»','“','”'],['sv','”','”','‘','’'],['pl','„','”','«','»'],
    ['en','"','"',"'","'"],['en',"'","'",'“','”'],
  ]){
    const row=fixture('proposal-language-excerpts.json').languages.find(row=>row.language===language);
    const article=value=>unitLabel({kind:'article',value},language);
    const xml=body(p(article('1'))+p(row.numberedInstruction,'Point0')+p(open+article('6'))+
      p('1. The operator’s term means '+innerOpen+'operator'+innerClose)+p(article('7'))+p('1. Still inside.'+close+';')+p(article('2')));
    const result=parseProposal(archive(xml),{language});
    assert.equal(proposalCandidates(result,article('7')).length,0,language);
    assert.equal(proposalCandidates(result,article('2')).length,1,language);
    assert.equal(result.complete,true,language);
    const inline=parseProposal(archive(body(p(article('1'))+p(row.numberedInstruction+' '+open+article('6'),'Point0')+
      p('1. The operator’s term means '+innerOpen+'operator'+innerClose)+p(article('7'))+p('1. Still inside.'+close+';')+p(article('2')))),{language});
    assert.equal(proposalCandidates(inline,article('7')).length,0,'inline '+language);
    assert.equal(proposalCandidates(inline,article('2')).length,1,'inline '+language);
    assert.equal(inline.complete,true,'inline '+language);
    const state={marks:[],implicit:false};
    assert.equal(quotationClosed(open+'Article 6',state,language),false,language);
    assert.equal(quotationClosed('The operator’s term means '+innerOpen+'operator'+innerClose,state,language),false,language);
    assert.equal(quotationClosed('Article 7',state,language),false,language);
    assert.equal(quotationClosed('Text.'+close+';',state,language),true,language);
  }
});

const numbered=(text,id,level=0,style='')=>`<w:p><w:pPr>${style?`<w:pStyle w:val="${style}"/>`:''}<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${id}"/></w:numPr></w:pPr><w:r><w:t>${escape(text)}</w:t></w:r></w:p>`;
const listLevel=(level,format,pattern,start=1,restart='')=>`<w:lvl w:ilvl="${level}"><w:start w:val="${start}"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${pattern}"/>${restart!==''?`<w:lvlRestart w:val="${restart}"/>`:''}</w:lvl>`;
const listInstance=(id,override='')=>`<w:num w:numId="${id}"><w:abstractNumId w:val="1"/>${override}</w:num>`;

test('DOCX alphabetic c and d remain siblings while numbering levels establish Roman descendants',()=>{
  const numbering=`<w:numbering><w:abstractNum w:abstractNumId="1">${listLevel(0,'lowerLetter','(%1)')}${listLevel(1,'lowerRoman','(%2)')}</w:abstractNum>${listInstance(1)}</w:numbering>`;
  const xml=body(p('Article 1')+p('1. Introductory paragraph.')+['a','b','c','d','e'].map(value=>numbered('Point '+value,1)).join('')+
    numbered('Nested Roman one',1,1)+numbered('Nested Roman two',1,1)+numbered('Point f',1));
  const result=parseProposal(archive(xml,[['word/numbering.xml',numbering]]));
  for(const value of ['a','b','c','d','e','f'])assert.equal(proposalCandidates(result,'Article 1 – paragraph 1 – point '+value).length,1,value);
  const b=proposalCandidates(result,'Article 1 – paragraph 1 – point b')[0],c=proposalCandidates(result,'Article 1 – paragraph 1 – point c')[0];
  assert.equal(b.extent.end,c.extent.start);
  assert.equal(proposalCandidates(result,'Article 1 – paragraph 1 – point e – point i').length,1);
  assert.equal(proposalCandidates(result,'Article 1 – paragraph 1 – point e – point ii').length,1);
  assert.deepEqual(result.paragraphs[4].properties.numbering,{id:'1',abstractId:'1',level:0,format:'lowerLetter'});
  assert.equal(result.complete,true);
  const manual=parseProposal(archive(body(p('Article 1')+p('1. Intro.')+['a','b','c','d','e'].map(value=>p('('+value+') Sibling.')).join(''))));
  for(const value of ['a','b','c','d','e'])assert.equal(proposalCandidates(manual,'Article 1 – paragraph 1 – point '+value).length,1,value);
  const ambiguous=parseProposal(archive(body(p('Article 1')+p('1. Intro.')+p('(a) First.')+p('(i) Ambiguous depth.'))));
  assert(ambiguous.gaps.some(gap=>gap.code==='ambiguous-point-level'));assert.equal(ambiguous.complete,false);
});

test('DOCX numbering metadata follows exact source paths after omitted revision paragraphs',()=>{
  const numbering=`<w:numbering><w:abstractNum w:abstractNumId="1">${listLevel(0,'lowerLetter','(%1)')}${listLevel(1,'lowerRoman','(%2)')}</w:abstractNum>${listInstance(1)}</w:numbering>`;
  const result=parseProposal(archive(body(p('Article 1')+`<w:del>${p('Deleted paragraph.')}</w:del>`+p('1. Intro.')+numbered('Letter',1,0)+numbered('Roman',1,1)),[['word/numbering.xml',numbering]]));
  assert.equal(result.paragraphs.find(p=>p.text.includes('Letter')).properties.numbering.level,0);
  assert.equal(result.paragraphs.find(p=>p.text.includes('Roman')).properties.numbering.format,'lowerRoman');
  assert(!result.paragraphs.some(p=>p.text.includes('Deleted')));
});

test('explicit level override starts restart once, while formatting-only overrides continue',()=>{
  const levels=listLevel(0,'decimal','%1)');
  const override=(start='')=>`<w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0">${start!==''?`<w:start w:val="${start}"/>`:''}<w:numFmt w:val="decimal"/><w:lvlText w:val="%1)"/></w:lvl></w:lvlOverride>`;
  const numbering=`<w:numbering><w:abstractNum w:abstractNumId="1">${levels}</w:abstractNum>${listInstance(1)}${listInstance(2,override(7))}${listInstance(3,override())}</w:numbering>`;
  const result=parseProposal(archive(body(p('Article 1')+[1,1,2,2,3,1].map(id=>numbered('Item',id)).join('')),[['word/numbering.xml',numbering]]));
  assert.deepEqual(result.paragraphs.slice(1).map(p=>p.properties.numberingLabel),['1)','2)','7)','8)','9)','10)']);
});

test('lvlRestart uses its one-based trigger, with zero, defaults, invalid values and ignored override restart',()=>{
  const sequence=[0,1,2,2,1,2,0,2];
  for(const [restart,last,afterTop] of [['1','iii)','i)'],['2','i)','i)'],['0','iii)','iv)'],['','i)','i)'],['9','i)','i)']]){
    const levels=listLevel(0,'decimal','%1)')+listLevel(1,'lowerLetter','%2)')+listLevel(2,'lowerRoman','%3)',1,restart);
    const override=`<w:lvlOverride w:ilvl="2">${listLevel(2,'lowerRoman','%3)',1,'0')}</w:lvlOverride>`;
    const numbering=`<w:numbering><w:abstractNum w:abstractNumId="1">${levels}</w:abstractNum>${listInstance(1,override)}</w:numbering>`;
    const result=parseProposal(archive(body(p('Article 1')+sequence.map(level=>numbered('Item',1,level)).join('')),[['word/numbering.xml',numbering]]));
    const labels=result.paragraphs.slice(1).map(p=>p.properties.numberingLabel);
    assert.deepEqual(labels.slice(0,5),['1)','a)','i)','ii)','b)'],restart);
    assert.equal(labels[5],last,restart);assert.equal(labels[7],afterTop,restart);
  }
});

test('normalisation preserves parenthetical words and strips multiletter labels only with exact prefix evidence',()=>{
  for(const word of ['net','not','all','mix','civil'])assert.notEqual(normaliseForMatching('('+word+') emissions.'),normaliseForMatching('emissions.'),word);
  assert.equal(normaliseForMatching('(net) emissions.'),'(net) emissions');
  assert.equal(normaliseForMatching('(iii) Third.',{numberingPrefixes:['(iii) ']}),'Third');
  assert.equal(normaliseForMatching('(net) emissions.',{numberingPrefixes:['(iii) ']}),'(net) emissions');
  assert.equal(normaliseForMatching('(iii) Third.',{stripNumbering:false,numberingPrefixes:['(iii) ']}),'(iii) Third');
});

test('cache identity uses the effective official source URL in either call order',()=>{
  for(const rejectedFirst of [true,false]){
    const projection={paragraphs:['Article 1',rejectedFirst?'First cache order.':'Reverse cache order.'],sourceUrl};
    const options={sourceUrl:'https://example.org/unofficial'};
    const calls=rejectedFirst?[options,{}]:[{},options];
    const first=parseProposal(projection,calls[0]),second=parseProposal(projection,calls[1]);
    const ordinary=rejectedFirst?second:first,rejected=rejectedFirst?first:second;
    assert.equal(ordinary.sourceUrl,sourceUrl);assert.equal(rejected.sourceUrl,null);assert.notEqual(ordinary,rejected);
    assert.equal(parseProposal(projection),ordinary);assert.equal(parseProposal(projection,options),rejected);
    assert.notEqual(ordinary.units[0].id,rejected.units[0].id);
  }
  const projection={paragraphs:['Article 1','Resolved URL fallback.'],resolvedSourceUrl:sourceUrl};
  assert.equal(parseProposal(projection).sourceUrl,sourceUrl);
  assert.equal(parseProposal(projection),parseProposal(projection,{sourceUrl}));
});

test('compact Article2 is a separate source boundary without conflating article 1, 10 or suffixed labels',()=>{
  const result=parseProposal(archive(body(p('Article1')+p('First source text.')+p('Article2')+p('Final source text.'))));
  const first=proposalCandidates(result,'Article 1')[0],second=proposalCandidates(result,'Article 2')[0];
  assert(first);assert(second);assert.equal(first.extent.end,second.extent.start);assert.equal(second.extent.start,2);
  assert.equal(parseTargetLabel('Article1a (new)').segments[0].value,'1a');
  assert.equal(parseLabelSegment('ArticleTwo'),null);assert.equal(parseLabelSegment('Article2 wording'),null);
  for(const row of fixture('proposal-language-excerpts.json').languages){
    for(const value of ['1','10','1a']){
      const heading=unitLabel({kind:'article',value},row.language);
      assert.equal(parseLabelSegment(heading,row.language).value,value,row.language+': '+heading);
    }
  }
});

test('replacement instructions with an omitted opener retain nested terms until an unmatched closing delimiter',()=>{
  for(const [innerOpen,innerClose,close] of [['“','”','’'],['«','»','"']]){
    const result=parseProposal(archive(body(p('Article 1')+p('Article 6 is replaced by the following:')+p('Article 6')+
      p('1. The term means '+innerOpen+'operator'+innerClose)+p('Article 7')+p('1. Final text.'+close+';')+p('Article 2'))));
    assert.equal(proposalCandidates(result,'Article 7').length,0);assert.equal(proposalCandidates(result,'Article 2').length,1);assert.equal(result.complete,true);
  }
});
