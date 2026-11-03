import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateRawSync} from 'node:zlib';
import {parseProposal,proposalCandidates} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {docxContent} from './document-text.mjs';
import {assertRecastReading} from '../scripts/amendment-recast-oracle.mjs';

function archive(documentXml,stylesXml) {
  const entries=[['word/document.xml',documentXml],['word/styles.xml',stylesXml]],locals=[],directory=[];let offset=0;
  for(const [filename,xml] of entries) {
    const name=Buffer.from(filename),body=Buffer.from(xml),compressed=deflateRawSync(body),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,name,compressed);directory.push(central,name);offset+=local.length+name.length+compressed.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,central,end]);
}
// COM(2025)580 (A-10-2026-0161) native excerpts. The fixture keeps only the
// marker and title styles; these two definitions are copied unchanged from
// the same source's word/styles.xml.
const sample=JSON.parse(readFileSync(new URL('./fixtures/recast-subdivision-excerpts.json',import.meta.url),'utf8'));
const deleted='<w:style w:type="character" w:customStyle="1" w:styleId="CRDeleted"><w:name w:val="CR Deleted"/><w:basedOn w:val="DefaultParagraphFont"/><w:rsid w:val="00D41459"/><w:rPr><w:strike w:val="0"/><w:dstrike/></w:rPr></w:style>';
const reference='<w:style w:type="paragraph" w:customStyle="1" w:styleId="CRReference"><w:name w:val="CR Reference"/><w:basedOn w:val="Normal"/></w:style>';
const withStyles=(...styles)=>sample.stylesXml.replace('</w:styles>',styles.join('')+'</w:styles>');
const document=`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${sample.paragraphs.map(p=>p.xml).join('')}</w:body></w:document>`;
const recast=archive(document,withStyles(deleted,reference));

test('a declared recast reads without struck deletions, marker glyphs or source-reference rows',()=>{
  const parsed=parseProposal(recast,{language:'en',sourceUrl:sample.source.url});
  const texts=parsed.paragraphs.map(p=>p.text);
  assert(!texts.some(text=>/[ÖÕòð]/u.test(text)),'no Wingdings marker survives');
  assert(!texts.some(text=>/shall mean|millimetre/u.test(text)),'struck CR Deleted wording is omitted');
  assert(!texts.includes('ò new'),'the CR Reference row is omitted');
  assert(texts.some(text=>text.startsWith('2.\tSmoking tobacco')&&/1,5\s+mm\s+shall be deemed/u.test(text)));
  const [three]=proposalCandidates(parsed,'Article 5 – paragraph 3');
  assert(three);assert(parsed.paragraphs[three.extent.start].text.startsWith('3.\tProducts consisting'));
  const placed=resolveProposalPlacement([{kind:'act',index:0,proposal:parsed}],{targetLabel:sample.expectedBoundary.target,language:'en',originalText:'',proposedText:'2a. A separate new paragraph.'});
  assert.equal(placed.status,'placed');assert.equal(placed.insertBefore,three.extent.start);
  // Ordinary amendment and document readers keep every visible run.
  assert(docxContent(recast).paragraphs.some(text=>text.includes('shall mean')));
});

test('only struck CR Deleted styles and the CR Marker of a declared recast are omitted',()=>{
  const unstruck=archive(document,withStyles(deleted.replace('<w:strike w:val="0"/><w:dstrike/>',''),reference));
  const plain=parseProposal(unstruck,{language:'en'});
  assert(plain.paragraphs.some(p=>p.text.includes('shall mean')),'an unstruck style of that name is not a deletion');
  assert(plain.paragraphs.some(p=>p.text.startsWith('Ö')),'markers stay without a declared deletion style');
  const direct=archive(document.replace('<w:rStyle w:val="CRDeleted" />','<w:strike />'),withStyles(deleted,reference));
  assert(parseProposal(direct,{language:'en'}).paragraphs.some(p=>p.text.includes('shall mean')),'direct strike formatting is not a recast deletion');
});

test('the native recast oracle recomputes every touched row from the Word runs',()=>{
  const parsed=parseProposal(recast,{language:'en',sourceUrl:sample.source.url});
  const [two]=proposalCandidates(parsed,'Article 5 – paragraph 2');
  const placement={operation:'replace',status:'placed',itemIndex:0,span:{start:two.extent.start,end:two.extent.end-1}};
  assert.equal(assertRecastReading({proposal:parsed,placement,nativeQuoted:{proposalBuffer:recast}}).status,'verified');
  const changed=structuredClone(parsed);changed.paragraphs[two.extent.start].text=changed.paragraphs[two.extent.start].text.replace(/1,5\s+mm/u,'1,5 millimetre');
  assert.equal(assertRecastReading({proposal:changed,placement,nativeQuoted:{proposalBuffer:recast}}).status,'failed');
  const insert={operation:'insert',status:'placed',itemIndex:0,insertAfter:two.extent.end-1,insertBefore:two.extent.end};
  assert.equal(assertRecastReading({proposal:parsed,placement:insert,nativeQuoted:{proposalBuffer:recast}}).status,'verified');
  const ordinary=archive(document,sample.stylesXml);
  assert.equal(assertRecastReading({proposal:parseProposal(ordinary,{language:'en'}),placement,nativeQuoted:{proposalBuffer:ordinary}}),null);
});
