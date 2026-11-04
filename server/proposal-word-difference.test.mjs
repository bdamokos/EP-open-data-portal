import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProposal} from './proposal-structure.mjs';
import {resolveProposalPlacement,singleAlphabeticWordDifference} from './proposal-placement.mjs';

function fixture(){
 const paragraphs=['(1) First recital.','(2) Native national protection in 2026.','(3) Next recital.','Article 1','Operative text.'];
 const source={sourceKind:'pdf',structureStatus:'extracted',paragraphs,paragraphSources:paragraphs.map((_,i)=>({part:'pdf',path:i+' 0 R',complete:true,role:'/P'})),paragraphProperties:paragraphs.map(()=>({annotationsComplete:true}))};
 return {items:[{kind:'act',proposal:structuredClone(parseProposal(source,{language:'en'}))}],wording:{language:'en',baseline:'council-position',targetLabel:'Recital 2',originalText:paragraphs[1].replace('national','regional'),proposedText:'(2) Changed protection.'}};
}
test('one word difference reuses the exact complete recital placement and carries a note kind',()=>{
 const f=fixture(),p=resolveProposalPlacement(f.items,f.wording);assert.equal(p.status,'placed');assert.equal(p.originalDifference,'one-word');assert.deepEqual(p.span,{start:1,end:1});assert.deepEqual(p.splice,{start:{paragraph:1,offset:0},end:{paragraph:1,offset:f.items[0].proposal.paragraphs[1].text.length}});
});
test('word allowance preserves all punctuation, numbers and remaining words',()=>{
 for(const [a,b] of [['Alpha word.','Alpha term.'],['Česká národní ochrana.','Česká státní ochrana.'],['Alpha\u00a0word.','Alpha term.']])assert.equal(singleAlphabeticWordDifference(a,b),true);
 for(const [a,b] of [['Alpha word.','Alpha word.'],['Alpha word.','Beta term.'],['Alpha word.','Alpha word;'],['Alpha word 12.','Alpha term 13.'],['AB123 protects.','CD123 protects.'],['http://example.test/a','http://other.test/a'],['Alpha word.','Alpha new word.'],['Alpha word.','Alpha word-.']])assert.equal(singleAlphabeticWordDifference(a,b),false);
});
for(const [name,change] of [
 ['incomplete source',f=>f.items[0].proposal.paragraphs[1].source.complete=false],
 ['unproved annotations',f=>f.items[0].proposal.paragraphs[1].properties.annotationsComplete=false],
 ['native note',f=>f.items[0].proposal.anchors.push({paragraph:1,offset:10,note:'x',label:'1'})],
 ['wrong addressed unit',f=>f.wording.targetLabel='Recital 3'],
 ['other baseline',f=>f.wording.baseline='commission-proposal'],
 ['two words',f=>f.wording.originalText=f.wording.originalText.replace('protection','assistance')],
 ['changed digit',f=>f.wording.originalText=f.wording.originalText.replace('2026','2025')],
 ['changed punctuation',f=>f.wording.originalText=f.wording.originalText.replace('.',';')],
])test('word rule withholds '+name,()=>{const f=fixture();change(f);assert.notEqual(resolveProposalPlacement(f.items,f.wording).originalDifference,'one-word');});
