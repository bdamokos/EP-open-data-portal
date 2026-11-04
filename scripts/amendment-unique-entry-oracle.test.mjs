import test from 'node:test';import assert from 'node:assert/strict';
import {uniqueEntryNative,uniqueEntryText} from './fixtures/unique-entry-native.mjs';
import {assertUniqueEntry} from './amendment-unique-entry-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
test('native unique full entry certifies its cell despite conflicting point and caption labels',()=>{
 const a=uniqueEntryNative();Object.defineProperty(a.items[1].proposal,'units',{get(){throw Error('No production units');}});Object.defineProperty(a.placement,'evidence',{get(){throw Error('No placer evidence');}});assert.equal(assertUniqueEntry(a).status,'verified');assert.equal(verifyPlacement(a).status,'verified');
 for(const delta of [-1,1]){const placement=structuredClone(uniqueEntryNative().placement);placement.span.start+=delta;placement.span.end+=delta;placement.splice.start.paragraph+=delta;placement.splice.end.paragraph+=delta;assert.equal(assertUniqueEntry({...a,placement}).status,'failed');}
 const b=uniqueEntryNative();b.placement.splice.end.offset--;assert.equal(assertUniqueEntry(b).status,'failed');
});
test('duplicate native entry, opaque competitors, merged cells and stale projections withhold',()=>{
 const escaped=uniqueEntryText.replaceAll('&','&amp;'),competitor='<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>'+escaped+'</w:t></w:r></w:p>';
 for(const changeSource of [s=>s.replace('</w:body>',competitor+'</w:body>'),s=>s.replace('</w:body>','<w:sdt><w:sdtContent>'+competitor+'</w:sdtContent></w:sdt></w:body>'),s=>s.replace('<w:tc>'+ '<w:p><w:r><w:t>'+escaped,'<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>'+escaped),s=>s.replace('ANNEX I</w:t>','ANNEX III</w:t>')])assert.equal(assertUniqueEntry(uniqueEntryNative({changeSource})).status,'unverified');
 for(const change of [a=>a.nativeQuoted.amendmentBuffer=null,a=>a.wording.targetPath.underlying[0].raw='Annex I – point 99',a=>a.wording.originalText+=' changed',a=>a.items[1].proposal.paragraphs[a.placement.span.start].text+=' clipped',a=>a.items[1].proposal.paragraphs[a.placement.span.start].source.path='/invented',a=>a.items[1].proposal.paragraphs[a.placement.span.start].complete=false,a=>a.wording.targetPath.proposal.push({raw:'Annex II'})]){const a=uniqueEntryNative();change(a);assert.notEqual(assertUniqueEntry(a)?.status,'verified');assert.notEqual(verifyPlacement(a).status,'verified');}
});
test('native instruction ownership is proved independently of the point label and projected units',()=>{
 const a=uniqueEntryNative({changeAmendment:s=>s.replace('Annex I – point 2','Annex I – point 3')});a.wording.targetLabel=a.wording.targetLabel.replace('Annex I – point 2','Annex I – point 3');a.wording.targetPath.underlying[0].raw=a.wording.targetPath.underlying[0].raw.replace('point 2','point 3');assert.equal(assertUniqueEntry(a).status,'unverified');
 const b=uniqueEntryNative({changeSource:s=>s.replace('<w:pPr><w:pStyle w:val="Point0number"/></w:pPr>','<w:pPr><w:pStyle w:val="Point0number"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="15"/></w:numPr></w:pPr>')});assert.equal(assertUniqueEntry(b).status,'unverified');
});
