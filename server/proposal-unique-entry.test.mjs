import test from 'node:test';import assert from 'node:assert/strict';
import {uniqueEntryNative,uniqueEntryText} from '../scripts/fixtures/unique-entry-native.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const resolve=a=>resolveProposalPlacement(a.items,a.wording,{nativeProposalInputs:a.nativeQuoted.proposalBuffers});
test('unique entire cell under the inner point wins over conflicting outer point and caption',()=>{
 const a=uniqueEntryNative(),wording=structuredClone(a.wording),p=resolve(a);assert.equal(p.status,'placed');assert.deepEqual(p.span,a.placement.span);assert.deepEqual(p.splice,a.placement.splice);assert(p.evidence.some(e=>e.basis==='unique-entry-label-disagreement'));assert.equal(verifyPlacement({...a,placement:p}).status,'verified');assert.deepEqual(a.wording,wording);
});
test('native duplicates, wrong scope, partial entries, missing source and malformed labels stay withheld',()=>{
 for(const change of [a=>a.wording.originalText=uniqueEntryText.slice(4),a=>a.wording.targetLabel=a.wording.targetLabel.replace('Annex I – point 2','Annex II – point 2'),a=>a.wording.targetPath.underlying[0].raw='Annex I – point 99',a=>a.nativeQuoted.proposalBuffers[1]=null,a=>a.items[1].proposal.paragraphs[a.placement.span.start].complete=false]){const a=uniqueEntryNative();change(a);assert.notEqual(resolve(a).status,'placed');}
 for(const wrap of [p=>p,p=>'<w:sdt><w:sdtContent>'+p+'</w:sdtContent></w:sdt>']){const a=uniqueEntryNative({changeSource:s=>s.replace('</w:body>',wrap('<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>'+uniqueEntryText+'</w:t></w:r></w:p>')+'</w:body>')});assert.notEqual(resolve(a).status,'placed');}
});
