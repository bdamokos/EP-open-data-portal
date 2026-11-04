import test from 'node:test';import assert from 'node:assert/strict';
import {inspectCouncilOuterInsertion} from './amendment-council-outer-oracle.mjs';
function fixture(){
 const texts=['HA ADOPTADO LA PRESENTE DIRECTIVA:','Artículo 1','La Directiva (UE) 2020/123 se modifica como sigue:','1) El artículo 7 se sustituye por el texto siguiente:'],structure=texts.map((_,i)=>({ref:'p'+i,note:false,pages:[4],mcids:[{page:4,mcid:i}]})),paragraphs=texts.map((text,i)=>({text,complete:true,source:{path:'p'+i,role:'/P',complete:true,pages:[4],mcids:structure[i].mcids}}));
 return {geometry:{words:texts.flatMap(text=>text.split(' ').map(text=>({text,page:4})))},structure,items:[{kind:'act',proposal:{sourceKind:'pdf',paragraphs}}],placement:{status:'placed',operation:'insert',itemIndex:0,insertAfter:2,insertBefore:3},wording:{language:'es',targetLabel:'Artículo 1 – párrafo 1 – punto -1',originalText:'',proposedText:'-1) Se añade el considerando siguiente:\n«(15 bis) Nueva disposición.».',targetPath:{language:'es',proposal:[{raw:'Artículo 1 – párrafo 1 – punto -1'}],underlying:[{document:'Directiva (UE) 2020/123',raw:'Considerando 15 bis (nuevo)'}]}}};
}
test('native ordered P identities and printed prefix prove the first outer insertion cursor',()=>assert.equal(inspectCouncilOuterInsertion(fixture()).status,'verified'));
test('a proved initial cursor does not declare later unsupported paragraphs complete',()=>{const f=fixture();f.items[0].proposal.paragraphs.push({text:'Later unsupported text.',complete:false,source:{path:'unproved-later'}});assert.equal(inspectCouncilOuterInsertion(f).status,'verified');assert.equal(f.items[0].proposal.paragraphs.at(-1).complete,false);});
test('a copied prefix with different real P identities cannot borrow the native first occurrence',()=>{
 const f=fixture(),copies=structuredClone(f.items[0].proposal.paragraphs);
 for(const [i,row] of copies.entries()){row.source.path='p'+(i+4);row.source.mcids=[{page:4,mcid:i+4}];f.structure.push({ref:row.source.path,note:false,pages:[4],mcids:row.source.mcids});}
 f.items[0].proposal.paragraphs.push(...copies);f.geometry.words.push({text:'Other native body text.',page:4});f.placement.insertAfter=6;f.placement.insertBefore=7;
 assert.notEqual(inspectCouncilOuterInsertion(f).status,'verified');
});
for(const [name,change] of [
 ['annex wrapper',f=>f.items[0].kind='annex'],
 ['duplicate act',f=>f.items.push(structuredClone(f.items[0]))],
 ['different item',f=>f.placement.itemIndex=1],
 ['contradicting published address',f=>f.wording.targetLabel='Artículo 2 – párrafo 1 – punto -1'],
 ['wrong act',f=>f.wording.targetPath.underlying[0].document='Directiva (UE) 2020/124'],
 ['wrong recital',f=>f.wording.proposedText=f.wording.proposedText.replace('15 bis','16 bis')],
 ['contradictory instruction',f=>f.wording.proposedText=f.wording.proposedText.replace('Se añade','Se suprime')],
 ['nonblank original',f=>f.wording.originalText='Old text.'],
 ['different outer article',f=>f.wording.targetPath.proposal[0].raw='Artículo 2 – párrafo 1 – punto -1'],
 ['different parent',f=>f.wording.targetPath.proposal[0].raw='Artículo 1 – párrafo 2 – punto -1'],
 ['moved cursor',f=>{f.placement.insertAfter--;f.placement.insertBefore--;}],
 ['nonconsecutive cursor',f=>f.placement.insertBefore++],
 ['unexpected splice',f=>f.placement.splice={start:{paragraph:2,offset:0},end:{paragraph:2,offset:0}}],
 ['incomplete prefix',f=>f.items[0].proposal.paragraphs[2].complete=false],
 ['different source page',f=>f.items[0].proposal.paragraphs[2].source.pages=[5]],
 ['wrong MCID',f=>f.items[0].proposal.paragraphs[2].source.mcids=[{page:4,mcid:20}]],
 ['wrong native order',f=>f.structure.reverse()],
 ['missing native words',f=>f.geometry.words.splice(8,1)],
 ['earlier peer instruction',f=>f.geometry.words.unshift({text:'0)',page:4})],
 ['copied prefix',f=>{const rows=structuredClone(f.items[0].proposal.paragraphs);f.items[0].proposal.paragraphs.push(...rows);f.placement.insertAfter=6;f.placement.insertBefore=7;}],
])test('outer native cursor rejects '+name,()=>{const f=fixture();change(f);assert.notEqual(inspectCouncilOuterInsertion(f).status,'verified');});
