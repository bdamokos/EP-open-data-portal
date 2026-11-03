import test from 'node:test';
import assert from 'node:assert/strict';
import {assertWholeAnnexInstruction} from './amendment-whole-instruction-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
import {wholeInstructionNative} from './fixtures/whole-instruction-native.mjs';
test('native first instruction and its complete quoted table establish the full replacement extent',()=>{
 const input=wholeInstructionNative();Object.defineProperty(input.proposal,'units',{get(){throw Error('Production units forbidden');}});
 assert.equal(assertWholeAnnexInstruction(input).status,'verified');assert.equal(verifyPlacement(input).status,'verified');
 const otherOldLaw=wholeInstructionNative({sourceChange:xml=>xml.replace('7204 Old material','9999 Different existing law')});assert.equal(assertWholeAnnexInstruction(otherOldLaw).status,'verified','the exact instruction, not elided old-law cells, owns the replacement');
});
test('clipped instructions and quotations fail the independently established full span',()=>{
 for(const mutate of [x=>x.placement.span.start++,x=>x.placement.span.end--,x=>x.placement.splice.start.offset=0,x=>x.placement.splice.end.offset=0,x=>x.placement.splice.end.paragraph--]){const input=wholeInstructionNative();mutate(input);assert.equal(assertWholeAnnexInstruction(input).status,'failed');}
});
test('native scope, counter, complete source and amendment comparison are mandatory',()=>{
 for(const sourceChange of [xml=>xml.replace('ANNEX I</w:t>','ANNEX III</w:t>'),xml=>xml.replace('Annex I is amended as follow:','Annex II is amended as follow:'),xml=>xml.replace('in point 2, the table','in point 3, the table'),xml=>xml.replace('<w:t>’</w:t>','<w:t>Unclosed</w:t>'),xml=>xml.replace('<w:t>7204 Old material</w:t>','<w:fldSimple w:instr="INCLUDETEXT"><w:r><w:t>7204 Old material</w:t></w:r></w:fldSimple>'),xml=>xml.replace('<w:t>7204 Old material</w:t>','<w:t>7204 Old material</w:t><w:unknown/>'),xml=>xml.replace('</w:tc>','<w:sdt><w:sdtContent><w:p><w:r><w:t>Opaque text</w:t></w:r></w:p></w:sdtContent></w:sdt></w:tc>'),xml=>xml.replace('<w:tc>','<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>')])assert.notEqual(assertWholeAnnexInstruction(wholeInstructionNative({sourceChange})).status,'verified',sourceChange.toString());
 for(const numberingChange of [xml=>xml.replace('startOverride w:val="1"','startOverride w:val="2"'),xml=>xml.replace('(%1)','%1.'),xml=>xml.replace('numFmt w:val="decimal"','numFmt w:val="lowerLetter"')])assert.notEqual(assertWholeAnnexInstruction(wholeInstructionNative({numberingChange})).status,'verified');
 for(const amendmentChange of [xml=>xml.replace('73 - New material','74 - Changed material'),xml=>xml.replace('<w:t>Amendment</w:t>','<w:t>Other heading</w:t>'),xml=>xml.replace('</w:tc>','<w:sdt><w:sdtContent><w:p><w:r><w:t>Opaque proposed text</w:t></w:r></w:p></w:sdtContent></w:sdt></w:tc>'),xml=>xml.replace('gridSpan w:val="2"','gridSpan w:val="3"')])assert.notEqual(assertWholeAnnexInstruction(wholeInstructionNative({amendmentChange})).status,'verified');
});
test('target identities, native hashes and complete projection correspondence cannot drift',()=>{
 for(const mutate of [x=>x.wording.targetLabel=x.wording.targetLabel.replace('point 1','point 2'),x=>x.wording.targetPath.underlying[0].raw='Annex II',x=>x.wording.targetPath.language='pl',x=>x.wording.proposedText+='\n…',x=>x.wording.number=43,x=>x.proposal.sourceHash='wrong',x=>x.nativeQuoted.proposalBuffers=[],x=>x.nativeQuoted.amendmentBuffer=undefined]){const input=wholeInstructionNative();mutate(input);assert.notEqual(assertWholeAnnexInstruction(input)?.status,'verified');}
 for(const mutate of [x=>x.proposal.paragraphs[x.placement.span.end].text='changed',x=>x.proposal.paragraphs[x.placement.span.start+2].source.complete=false,x=>x.proposal.paragraphs[x.placement.span.start+2].source.ordinal++]){const input=wholeInstructionNative();input.proposal=structuredClone(input.proposal);input.items[1].proposal=input.proposal;mutate(input);assert.notEqual(assertWholeAnnexInstruction(input).status,'verified');}
});
