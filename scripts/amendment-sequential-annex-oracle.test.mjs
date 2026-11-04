import test from 'node:test';import assert from 'node:assert/strict';
import {sequentialAnnexNative} from './fixtures/sequential-annex-native.mjs';
import {assertSequentialAnnex} from './amendment-first-annex-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
test('second annex retains its native frame and table, after the preceding new first annex',()=>{const a=sequentialAnnexNative();Object.defineProperty(a.proposal,'units',{get(){throw Error('production units forbidden');}});assert.equal(assertSequentialAnnex(a).status,'verified');assert.equal(verifyPlacement(a).status,'verified');});
test('missing, reordered or altered preceding annex cannot establish the sequence',()=>{
 for(const change of [x=>x.replace('Amendment\t\t1','Amendment\t\t3'),x=>x.replace('Annex 1 - Indicators','Annex 3 - Indicators'),x=>x.replace('>ANNEX<','>BODY<'),x=>x.replace('Published complete indicator wording.','…'),x=>x.replace('Amendment\t\t2','Amendment\t\t1')])assert.equal(assertSequentialAnnex(sequentialAnnexNative({change})).status,'unverified');
});
test('current frame, introductory words, table cells and placement are independently checked',()=>{
 for(const edit of [a=>a.wording.proposedText=a.wording.proposedText.replace('ANNEX\n',''),a=>a.wording.proposedText=a.wording.proposedText.replace('these','borrowed'),a=>a.wording.proposedText=a.wording.proposedText.replace('Published budget','Other budget'),a=>a.placement.insertBefore++,a=>a.placement.insertAfter--]){const a=sequentialAnnexNative();edit(a);assert.equal(assertSequentialAnnex(a).status,'failed');}
});
test('native hidden words, grid damage and wrong source boundaries withhold',()=>{
 for(const change of [x=>x.replace('>The programme','><w:vanish/>The programme'),x=>x.replace('<w:tblGrid><w:gridCol/></w:tblGrid>','<w:tblGrid/>'),x=>x.replace('>Description<','><w:drawing/>Description'),x=>x.replace('>The programme',' xmlns:w="wrong">The programme')])assert.equal(assertSequentialAnnex(sequentialAnnexNative({change})).status,'unverified');
 const a=sequentialAnnexNative({sourceChange:x=>x.replace('>Done at Brussels,<','>Different signature<')});assert.notEqual(assertSequentialAnnex(a).status,'verified');
});
test('declared order and input identity cannot replace native proof',()=>{
 for(const edit of [a=>a.wording.documentReferences[1].raw='9',a=>a.wording.documentReferences[1].sourceRaw='Annex 1 - Other',a=>a.wording.originalText='Original',a=>a.wording.number=3,a=>delete a.nativeQuoted]){const a=sequentialAnnexNative();edit(a);assert.notEqual(assertSequentialAnnex(a)?.status,'verified');}
});

test('ordinary Annex 2 amendments do not opt in through their label alone',()=>{const a=sequentialAnnexNative();a.wording.documentReferences=a.wording.documentReferences.filter(r=>r.field!=='PrecedingAnnex');assert.equal(assertSequentialAnnex(a),null);});
