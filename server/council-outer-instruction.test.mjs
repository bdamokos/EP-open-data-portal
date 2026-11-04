import test from 'node:test';import assert from 'node:assert/strict';
import {parseProposal} from './proposal-structure.mjs';import {resolveProposalPlacement} from './proposal-placement.mjs';
const flat=units=>units.flatMap(u=>[u,...flat(u.children)]);
function fixture(){
 const paragraphs=['HA ADOPTADO LA PRESENTE DIRECTIVA:','Artículo 1','La Directiva (UE) 2020/123 se modifica como sigue:','1) El artículo 7 se sustituye por el texto siguiente:','«Artículo 7','1. Protección original.».','2) Se añade un artículo posterior:','«Artículo 20','1. Texto posterior.».','Artículo 2','Disposición final.'];
 const source={sourceKind:'pdf',sourceHash:'f'.repeat(64),structureStatus:'extracted',paragraphs,paragraphSources:paragraphs.map((_,i)=>({part:'pdf',path:'p'+i,role:'/P',pages:[1],mcids:[{page:1,mcid:i}],complete:i!==8})),paragraphProperties:paragraphs.map((_,i)=>({notesComplete:true,annotationsComplete:true,...([1,4,7,9].includes(i)?{styleId:'Titrearticle',headingBasis:'native-first-line'}:{})}))};
 return {items:[{kind:'act',proposal:structuredClone(parseProposal(source,{language:'es'}))}],wording:{language:'es',baseline:'council-position',originalText:'',proposedText:'-1) Se añade el considerando siguiente:\n«(15 bis) Nueva disposición.».',targetLabel:'Artículo 1 – párrafo 1 – punto -1',targetPath:{language:'es',proposal:[{raw:'Artículo 1 – párrafo 1 – punto -1'}],underlying:[{document:'Directiva (UE) 2020/123',raw:'Considerando 15 bis (nuevo)'}]}}};
}
test('a bounded native prefix reuses first-sibling insertion without completing its parent',()=>{
 const f=fixture(),parent=flat(f.items[0].proposal.units).find(u=>u.kind==='paragraph'&&u.path.length===2&&u.path[0].value==='1');assert.equal(parent.complete,false);
 const p=resolveProposalPlacement(f.items,f.wording);assert.equal(p.status,'placed');assert.equal(p.operation,'insert');assert.equal(p.insertAfter,2);assert.equal(p.insertBefore,3);assert(p.evidence.some(e=>e.basis==='first-sibling-start'));assert.equal(parent.complete,false);
});
for(const [name,change] of [
 ['contradicting published address',f=>f.wording.targetLabel='Artículo 2 – párrafo 1 – punto -1'],
 ['different source language',f=>f.items[0].proposal.language='cs'],
 ['wrong act',f=>f.wording.targetPath.underlying[0].document='Directiva (UE) 2020/124'],
 ['different introduced recital',f=>f.wording.proposedText=f.wording.proposedText.replace('15 bis','16 bis')],
 ['contradictory operation',f=>f.wording.proposedText=f.wording.proposedText.replace('Se añade','Se suprime')],
 ['not a new recital',f=>f.wording.targetPath.underlying[0].raw='Considerando 15 bis'],
 ['nonblank original',f=>f.wording.originalText='Old text.'],
 ['incomplete prefix',f=>f.items[0].proposal.paragraphs[2].complete=false],
 ['unproved page',f=>f.items[0].proposal.paragraphs[2].source.complete=false],
 ['unowned annotation',f=>f.items[0].proposal.paragraphs[2].properties.annotationsComplete=false],
 ['unowned note',f=>f.items[0].proposal.paragraphs[2].properties.notesComplete=false],
 ['nonconsecutive MCID',f=>f.items[0].proposal.paragraphs[2].source.mcids[0].mcid=10],
 ['prefix is not the page start',f=>{for(const row of f.items[0].proposal.paragraphs)row.source.mcids[0].mcid+=4;}],
 ['another page',f=>f.items[0].proposal.paragraphs[2].source.pages=[2]],
 ['duplicate source P',f=>f.items[0].proposal.paragraphs[4].source.path='p2'],
 ['unexpected object',f=>f.items[0].proposal.paragraphs[2].objects.push({offset:0})],
 ['unexpected link',f=>f.items[0].proposal.links.push({paragraph:2,start:0,end:1,url:'https://example.test'})],
 ['another source',f=>f.items.push(structuredClone(f.items[0]))],
])test('outer insertion withholds '+name,()=>{const f=fixture();change(f);assert.equal(resolveProposalPlacement(f.items,f.wording).status,'unresolved');});
