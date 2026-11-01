import test from 'node:test';
import assert from 'node:assert/strict';
import {assertMaintainerPrinciple} from './amendment-maintainer-oracle.mjs';
const input=(proposedText,body,target='Article 1 – paragraph 1 – point 2')=>({proposal:{paragraphs:['Article 1','The act is amended as follows:',...body,'(3) Next paragraph is deleted:','Article 2'].map((text,index)=>({index,text,complete:true,source:{complete:true}}))},wording:{language:'en',targetLabel:target,proposedText,originalText:''},placement:{status:'placed',operation:'insert',insertBefore:body.length+2,insertAfter:body.length+1}});
test('single unnumbered quoted article is paragraph one, with a checked boundary',()=>{
 const i=input('(1a) New paragraph.',['(2) Article 4 is replaced by the following:','‘Article 4','Literacy','‘The Commission shall provide training.’;']);
 assert.equal(assertMaintainerPrinciple(i).status,'verified');i.placement.insertBefore--;assert.equal(assertMaintainerPrinciple(i).status,'failed');
});
test('negative instructions start before the existing quotation',()=>{
 const i=input('-1a. New instruction.',['(2) The second subparagraph is replaced by the following:','‘Published text.’']);i.placement.insertBefore=3;i.placement.insertAfter=2;
 assert.equal(assertMaintainerPrinciple(i).status,'verified');i.placement.insertBefore++;assert.equal(assertMaintainerPrinciple(i).status,'failed');
});
test('partial replacement keeps its subordinate points with the numbered paragraph',()=>{
 const i=input('2 b. New paragraph.',['(2) The second subparagraph is replaced by the following:','‘2. Conditions:','(a) First condition;','(b) Second condition.’']);assert.equal(assertMaintainerPrinciple(i).status,'verified');
});
