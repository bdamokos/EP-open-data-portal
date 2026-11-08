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
test('independent typo check: two changed words at most, never a number or label',async()=>{
 const {oracleTypo,assertTypoRows}=await import('./amendment-similarity-oracle.mjs');
 const act='Article 37b\n1)\tMember States may carry out inspection activities under Article 30(3).';
 assert.notEqual(oracleTypo('Article 37 b\n1.\tMember States may carry out inspection activities under Article 30(3).',act),null);
 assert.notEqual(oracleTypo('Article 37b\n1)\tMember States might carry out the inspection activities under Article 30(3).',act),null);
 assert.equal(oracleTypo('Article 37b\n1)\tMember States might carry out the inspection works under Article 30(3).',act),null);
 assert.equal(oracleTypo('Article 30b\n1)\tMember States may carry out inspection activities under Article 30(3).',act),null);
 assert.equal(oracleTypo('Article 37b\n1)\tMember States may carry out inspection activities under Article 37(3).',act),null);
 assert.equal(oracleTypo('Article 37b\n2)\tMember States may carry out inspection activities under Article 30(3).',act),null);
 assert.equal(oracleTypo('(a) The rules (apply) to (all) providers (today).','(a) The rules apply to all providers today.'),null);
 const rows=['Article 37b','1)\tMember States may carry out inspection activities under Article 30(3).','2)\tThe Commission may assign inspectors.'].map((text,index)=>({text,index}));
 const quoted='Article 37b\n1)\tMember States might carry out inspection activities under Article 30(3).\n2)\tThe Commission may assign inspectors.';
 assert.equal(assertTypoRows(rows,quoted,{start:0,end:2}),true);
 assert.equal(assertTypoRows(rows,quoted,{start:1,end:2}),false);
});
