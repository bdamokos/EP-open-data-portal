import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {documentContextPlacement} from './document-context-placement.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
import {wholeInstructionNative} from '../scripts/fixtures/whole-instruction-native.mjs';
const place=input=>resolveProposalPlacement(input.items,input.wording,{nativeProposalInputs:input.nativeQuoted.proposalBuffers});
test('whole first instruction replacement preserves its native point label and removes the entire quote',()=>{
 const input=wholeInstructionNative(),placed=place(input);assert.equal(placed.status,'placed');assert.deepEqual(placed.span,input.placement.span);assert.deepEqual(placed.splice,input.placement.splice);assert.equal(placed.originalText.startsWith('in point 2,'),true);assert.equal(placed.originalText.endsWith('’'),true);assert.equal(verifyPlacement({...input,placement:placed}).status,'verified');
 const selected=documentContextPlacement({chosen:input.wording,items:input.items,baseline:{kind:'commission-proposal',status:'available'},nativeProposalInputs:input.nativeQuoted.proposalBuffers});assert.deepEqual(selected,placed);
 assert.equal(resolveProposalPlacement(input.items,input.wording).status,'unresolved','missing native bytes withhold only this new family');
});
test('complete proposed cells and exact instruction identity are required without old-law cell matching',()=>{
 assert.equal(place(wholeInstructionNative({sourceChange:xml=>xml.replace('7204 Old material','9999 Different old law')})).status,'placed');
 for(const mutate of [x=>x.wording.proposedText+='\n…',x=>x.wording.proposedText=x.wording.proposedText.replace('\tCarbon dioxide','\t'),x=>x.wording.proposedText=x.wording.proposedText.replace('73 - New','Unnumbered New'),x=>x.wording.originalText=x.wording.originalText.replace('in point 2','in point 3'),x=>x.wording.targetLabel=x.wording.targetLabel.replace('2023/956','2023/957'),x=>x.wording.targetPath.underlying[0].raw='Annex II',x=>x.wording.targetPath.language='pl',x=>x.wording.documentReferences[0].basis='published-heading',x=>x.wording.documentReferences=[]]){const input=wholeInstructionNative();mutate(input);assert.equal(place(input).status,'unresolved',mutate.toString());}
});
test('opaque native source content and unknown table structures cannot create new placements',()=>{
 for(const sourceChange of [xml=>xml.replace('<w:t>7204 Old material</w:t>','<w:fldSimple w:instr="INCLUDETEXT"><w:r><w:t>7204 Old material</w:t></w:r></w:fldSimple>'),xml=>xml.replace('<w:t>7204 Old material</w:t>','<w:t>7204 Old material</w:t><w:unknown/>'),xml=>xml.replace('<w:t>7204 Old material</w:t>','<w:rPr><w:vanish/></w:rPr><w:t>7204 Old material</w:t>'),xml=>xml.replace('</w:tc>','<w:sdt><w:sdtContent><w:p><w:r><w:t>Additional table content</w:t></w:r></w:p></w:sdtContent></w:sdt></w:tc>'),xml=>xml.replace('<w:tbl>','<w:tbl><w:tblPr><w:unknown/></w:tblPr>'),xml=>xml.replace('<w:t>’</w:t>','<w:t>Not a close</w:t>')])assert.equal(place(wholeInstructionNative({sourceChange})).status,'unresolved',sourceChange.toString());
 for(const numberingChange of [xml=>xml.replace('startOverride w:val="1"','startOverride w:val="2"'),xml=>xml.replace('(%1)','%1.'),xml=>xml.replace('numFmt w:val="decimal"','numFmt w:val="lowerLetter"')])assert.equal(place(wholeInstructionNative({numberingChange})).status,'unresolved');
 for(const actChange of [xml=>xml.replace('2023/956','2023/957'),xml=>xml.replace('is amended as follows:','is not amended:'),xml=>xml.replace('<w:t>Regulation','<w:unknown/><w:t>Regulation')])assert.equal(place(wholeInstructionNative({actChange})).status,'unresolved');
});
test('clipped and conflicting projection evidence remains withheld',()=>{
 for(const mutate of [x=>x.items[1].proposal.paragraphs[x.placement.span.end].complete=false,x=>x.items[1].proposal.paragraphs[x.placement.span.start+2].source.ordinal++,x=>x.items[1].proposal.sourceHash='wrong',x=>x.nativeQuoted.proposalBuffers[1]=Buffer.from('wrong'),x=>x.items.push(x.items[1])]){const input=wholeInstructionNative();mutate(input);assert.equal(place(input).status,'unresolved');}
});
