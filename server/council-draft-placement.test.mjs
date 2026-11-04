import test from 'node:test';import assert from 'node:assert/strict';
import {parseProposal,parseTargetLabel} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
const paragraphs=['Článek 1','Směrnice (EU) 2020/123 se mění takto:','1) Článek 7 se nahrazuje tímto:','„Článek 7 Ochrana','1. První původní odstavec.','2. Druhý původní odstavec.“','2) V článku 19 se doplňuje nový odstavec 3, který zní:','„3. Další původní odstavec.','Nativní pokračování.“','Článek 2','Závěrečné ustanovení.'];
function source(){return {sourceKind:'pdf',structureStatus:'extracted',paragraphs,paragraphSources:paragraphs.map((_,i)=>({part:'pdf',path:(i+1)+' 0 R',complete:true})),paragraphProperties:paragraphs.map((_,i)=>[0,3,9].includes(i)?{styleId:'Titrearticle',headingBasis:'native-first-line'}:{}),extractionGaps:[]};}
const wording=(raw='Čl. 7 – odst. 1')=>({language:'cs',baseline:'council-position',targetLabel:'Čl. 1 – odst. 1 – bod 1',targetPath:{language:'cs',proposal:[{raw:'Čl. 1 – odst. 1 – bod 1'}],underlying:[{document:'Směrnice (EU) 2020/123',raw}]},originalText:'1. První původní odstavec.',proposedText:'1. Nový odstavec.'});
test('PDF inner address stays under its named act and exact outer instruction',()=>{
 const items=[{kind:'act',proposal:parseProposal(source(),{language:'cs'})}],w=wording();
 const value=resolveProposalPlacement(items,w);assert.equal(value.status,'placed');assert.equal(value.span.start,4);assert(value.evidence.some(e=>e.basis==='council-quoted-owner'));
 for(const change of [w=>w.targetPath.proposal[0].raw='Čl. 1 – odst. 1 – bod 2',w=>w.targetPath.underlying[0].raw='Čl. 19 – odst. 1',w=>w.targetPath.underlying[0].document='Směrnice (EU) 2020/124']){const v=structuredClone(w);change(v);assert.equal(resolveProposalPlacement(items,v).status,'unresolved');}
 const missing=source();missing.paragraphSources[2].complete=false;assert.equal(resolveProposalPlacement([{kind:'act',proposal:parseProposal(missing,{language:'cs'})}],w).status,'unresolved');
});
test('a terminal quoted insertion uses the existing zero-width splice renderer contract',()=>{
 const w={...wording('Čl. 7 – odst. 2 a (nový)'),originalText:'',proposedText:'2a. Nový odstavec.'},value=resolveProposalPlacement([{kind:'act',proposal:parseProposal(source(),{language:'cs'})}],w);
 assert.equal(value.status,'placed');assert.equal(value.operation,'insert');assert.equal(value.splice.start.paragraph,5);assert.equal(value.splice.start.offset,paragraphs[5].indexOf('“'));assert.deepEqual(value.splice.start,value.splice.end);
});
test('a native paragraph insertion instruction supplies an omitted repeated article heading',()=>{
 const w={...wording('Čl. 19 – odst. 3 a (nový)'),originalText:'',proposedText:'Nový odstavec.'};w.targetLabel=w.targetPath.proposal[0].raw='Čl. 1 – odst. 1 – bod 2';
 const value=resolveProposalPlacement([{kind:'act',proposal:parseProposal(source(),{language:'cs'})}],w);assert.equal(value.status,'placed');assert.equal(value.splice.start.paragraph,8);
});
test('a missing space after a printed en dash does not merge legal selectors',()=>{
 const target=parseTargetLabel('Článek 13 –odst. 5 a (nový)','cs');assert.equal(target.complete,true);assert.deepEqual(target.segments.map(s=>s.value),['13','5a']);
 assert.equal(parseTargetLabel('Článek 13 –neznámé 5','cs').complete,false);
});
for(const instruction of ['1) Článek 91 se nahrazuje tímto:','1) Článek 7 se zrušuje takto:','1) Článek 7 se nenahrazuje tímto:','1) Článek 7 se možná nahrazuje tímto:'])test(`a quotation cannot override a contradictory instruction: ${instruction}`,()=>{
 const value=source();value.paragraphs=[...value.paragraphs];value.paragraphs[2]=instruction;
 assert.equal(resolveProposalPlacement([{kind:'act',proposal:parseProposal(value,{language:'cs'})}],wording()).status,'unresolved');
});

test('PDF point subparagraphs stay withheld until their labelled lead and nested-list ownership are proved',()=>{
 const data=source(),at=4;data.paragraphs=[...data.paragraphs];data.paragraphs[at]='1. Úvod.\n\nd) První pododstavec.\n\nDruhý pododstavec.\n\ne) Následující bod.';
 const items=[{kind:'act',proposal:parseProposal(data,{language:'cs'})}];
 for(const ordinal of [1,2]){const w=wording(`Čl. 7 – odst. 1 – písm. d – pododstavec ${ordinal}`);w.originalText='Druhý pododstavec.';assert.equal(resolveProposalPlacement(items,w).reason,'council_pdf_subparagraph_owner_unverified');}
});
