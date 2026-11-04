import test from 'node:test';import assert from 'node:assert/strict';
import {parseProposal,proposalCandidates,parseTargetLabel} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
const flat=units=>units.flatMap(u=>[u,...flat(u.children)]);
function source(){const paragraphs=['(8) Base recital.','(8a) Existing additional recital.','(9) Next recital.','Article 1','Operative text.'];return {sourceKind:'pdf',structureStatus:'extracted',paragraphs,paragraphSources:paragraphs.map((_,i)=>({part:'pdf',path:i+' 0 R',complete:true})),paragraphProperties:paragraphs.map(()=>({}))};}
test('a printed suffixed recital in the preamble is an existing recital, independently of heading styles',()=>{
 const p=parseProposal(source(),{language:'en'}),units=flat(p.units),r=units.find(u=>u.kind==='recital'&&u.label.value==='8a');assert(r);assert.equal(r.label.isNew,false);assert.equal(r.extent.start,1);
 const w={language:'en',baseline:'council-position',targetLabel:'Recital 8a',originalText:'(8a) Existing additional recital.',proposedText:'(8a) Amended recital.'},placed=resolveProposalPlacement([{kind:'act',proposal:p}],w);assert.equal(placed.status,'placed');assert.equal(placed.operation,'replace');assert.deepEqual(placed.span,{start:1,end:1});
 assert.equal(proposalCandidates(p,parseTargetLabel('Recital 8b','en')).length,0);
});
test('parenthesized labels in the operative body do not become recitals',()=>{
 const s=source();s.paragraphs.push('(1a) Body point.');s.paragraphSources.push({part:'pdf',path:'last',complete:true});s.paragraphProperties.push({});const p=parseProposal(s,{language:'en'});assert(!flat(p.units).some(u=>u.kind==='recital'&&u.label.value==='1a'));
});
test('an unstyled suffixed label in frontmatter needs a preamble before it can be a recital',()=>{
 const s=source();s.paragraphs.unshift('(7a) Cover reference.');s.paragraphSources.unshift({part:'pdf',path:'cover',complete:true});s.paragraphProperties.unshift({});const p=parseProposal(s,{language:'en'});assert(!flat(p.units).some(u=>u.kind==='recital'&&u.label.value==='7a'));assert(flat(p.units).some(u=>u.kind==='recital'&&u.label.value==='8a'));
});
