import test from 'node:test';import assert from 'node:assert/strict';import {oracleSimilarity,assertSimilarityRows,oracleSingleWord} from './amendment-similarity-oracle.mjs';
test('character distance preserves words and digits after whitespace and quote normalization',()=>{assert.equal(oracleSimilarity('A  “word”','A "word"'),1);assert.equal(oracleSimilarity('1234567890','1234567891'),.9);});
test('unique best passage and margin are required',()=>{const text='A provider shall document the assessment before placing the system on the market.';const rows=[{index:0,text}];assert.equal(assertSimilarityRows(rows,text.replace('system','systen'),{start:0,end:0}),true);assert.equal(assertSimilarityRows([...rows,{index:1,text}],text,{start:0,end:0}),false);});
test('one alphabetic word may differ while numbers, punctuation and substitutions remain exact',async()=>{
 const {oracleSingleWord}=await import('./amendment-similarity-oracle.mjs');
 assert(oracleSingleWord('uchyla się art. 17;','uchyla się art. 17 rozporządzenia;'));
 assert(oracleSingleWord('ex 7602 Aluminium waste and scrap','7602 Aluminium waste and scrap'));
 for(const [a,b] of [['7602 Aluminium waste','7603 Aluminium waste'],['7602 Aluminium waste','Aluminium waste'],['The repeal applies.','The repeal applies;'],['One extra word here.','One replaced word here.'],['Two extra added words.','Two words.']])assert.equal(oracleSingleWord(a,b),false);
});

test('one-word fallback compares quote marks literally',()=>{
 assert.equal(oracleSingleWord('A “rule” applies.','A "new rule" applies.'),false);
 assert.equal(oracleSingleWord("A ‘rule’ applies.","A 'new rule' applies."),false);
});
