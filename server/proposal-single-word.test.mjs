import test from 'node:test';import assert from 'node:assert/strict';
import {parseProposal} from './proposal-structure.mjs';import {resolveProposalPlacement} from './proposal-placement.mjs';import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';import {singleWordDifference} from './proposal-similarity.mjs';
const make=()=>{const paragraphs=['Artykuł 1','W dyrektywie wprowadza się następujące zmiany:','(10)\tuchyla się art. 17;','(11)\tuchyla się art. 21;','Artykuł 2'];return parseProposal({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map((_,i)=>({styleId:i===0||i===4?'Titrearticle':i===2||i===3?'Point0':'Normal',numberingComplete:true,notesComplete:true}))},{language:'pl'});};
const w={language:'pl',baseline:'commission-proposal',targetLabel:'Artykuł 1 – akapit 1 – punkt 10',originalText:'10)\tuchyla się art. 17 rozporządzenia;',proposedText:'skreśla się'};
test('one extra word on a uniquely addressed complete native instruction places with evidence',()=>{
 const proposal=make(),items=[{kind:'act',proposal}],placement=resolveProposalPlacement(items,w);assert.equal(placement.status,'placed');assert.deepEqual(placement.span,{start:2,end:2});assert.equal(placement.evidence.at(-1).basis,'single-word-original-difference');assert.equal(verifyPlacement({items,wording:w,placement}).status,'verified');
 for(const mutate of [p=>p.paragraphs[2].complete=false,p=>{const all=units=>units.flatMap(u=>[u,...all(u.children)]),target=all(p.units).find(u=>u.kind==='point'&&u.label.value==='10');p.units.push(structuredClone(target));}]){const p=structuredClone(make());mutate(p);assert.notEqual(resolveProposalPlacement([{kind:'act',proposal:p}],w).status,'placed');}
});
test('numbers and punctuation cannot be the omitted token',()=>{
 assert(singleWordDifference('ex 7602 Aluminium waste and scrap','7602 Aluminium waste and scrap'));
 for(const [a,b] of [['Aluminium 7602 waste','Aluminium waste'],['A rule applies;','A rule applies.'],['one added word here','one replacement word here']])assert.equal(singleWordDifference(a,b),false);
});

test('one-word fallback compares quote marks literally',()=>{
 assert.equal(singleWordDifference('A “rule” applies.','A "new rule" applies.'),false);
 assert.equal(singleWordDifference("A ‘rule’ applies.","A 'new rule' applies."),false);
});
