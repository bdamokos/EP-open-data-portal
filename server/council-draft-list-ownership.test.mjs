import test from 'node:test';
import assert from 'node:assert/strict';
import {councilPdfLines,councilPdfListOwnership} from './council-draft-list-ownership.mjs';
import {parseProposal} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
function rows(){
 const text=['2. Parent introduces:','a) First;','b) Second;','c) Third.','Direct continuation.','Another continuation.','2. Repeated parent.'];
 return text.map((text,i)=>{const labelled=/^(?:\d+\.|[a-z]\))/u.test(text),numeric=/^\d/u.test(text),x=labelled?[numeric?20:50,numeric?50:80]:[50],parts=labelled?[text.split(' ')[0],text.slice(text.indexOf(' ')+1)]:[text],items=parts.map((str,j)=>({str,page:1,transform:[12,0,0,12,x[j],600-i*25]}));return {text,complete:true,attached:false,source:{path:'p'+i,role:i===0?'/LBody':'/P',complete:true,pages:[1],mcids:[{page:1,mcid:i}]},lines:councilPdfLines(items)};});
}
test('a bounded same-page MCID frame proves direct continuations after a lettered list',()=>{
 const proof=councilPdfListOwnership(rows());assert.equal(proof.length,1);assert.deepEqual(proof[0].points,[1,2,3]);assert.deepEqual(proof[0].continuations,[4,5]);assert.equal(proof[0].end,6);
});
for(const [name,change] of [
 ['rotated text',r=>{r[1].lines=councilPdfLines([{str:'a)',page:1,transform:[0,12,-12,0,50,575]}]);}],
 ['child continuation',r=>{r[4].lines[0].items[0].x=80;}],
 ['uncertain outdent',r=>{r[4].lines[0].items[0].x=51;}],
 ['missing label',r=>{r[2].text='c) Second;';}],
 ['nested label',r=>{r[4].text='i) Nested continuation.';}],
 ['unknown attachment',r=>{r[3].attached=true;}],
 ['incomplete next boundary',r=>{r.at(-1).complete=false;}],
 ['cross-page frame',r=>{r[4].source.pages=[2];}],
 ['skipped MCID',r=>{r[3].source.mcids[0].mcid=30;}],
 ['duplicate identity',r=>{r[3].source.path=r[2].source.path;}],
 ['reversed physical order',r=>{r[4].lines[0].y=700;}],
 ['unproved body coordinate',r=>{r[0].lines[0].items=[{text:r[0].text,x:20}];}],
])test('native list ownership fails closed on '+name,()=>{const r=rows();change(r);assert.deepEqual(councilPdfListOwnership(r),[]);});
function content(){
 const local=rows(),texts=['Článek 1','Směrnice (EU) 2020/123 se mění takto:','1) Článek 13 se nahrazuje tímto:','„Článek 13','Title','1. First paragraph.',...local.map(r=>r.text),'Other repeated-parent continuation.','3. Final paragraph.“','2) Článek 14 se nahrazuje tímto:','„Článek 14','1. Other article.“'],proof=councilPdfListOwnership(local)[0],shift=6;
 const c={sourceKind:'pdf',sourceHash:'a'.repeat(64),structureStatus:'extracted',paragraphs:texts,paragraphSources:texts.map((_,i)=>({path:'p'+i,role:i===shift?'/LBody':'/P',complete:true,pages:[1],mcids:[{page:1,mcid:i}]})),paragraphProperties:texts.map(text=>({notesComplete:true,annotationsComplete:true,...(/Článek \d+$/u.test(text)?{styleId:'Titrearticle',headingBasis:'native-first-line'}:{})})),paragraphFormats:texts.map(()=>({}))};
 c.paragraphProperties[shift].pdfListOwnership={...proof,start:proof.start+shift,end:proof.end+shift,points:proof.points.map(i=>i+shift),continuations:proof.continuations.map(i=>i+shift)};
 for(const i of proof.points)c.paragraphFormats[i+shift].indent=proof.pointIndent;
 for(const i of proof.continuations)c.paragraphFormats[i+shift].indent=proof.bodyIndent;
 return c;
}
const wording=(inner,originalText,proposedText)=>({language:'cs',baseline:'council-position',targetLabel:'Čl. 1 – odst. 1 – bod 1',originalText,proposedText,targetPath:{language:'cs',proposal:[{raw:'Čl. 1 – odst. 1 – bod 1'}],underlying:[{document:'Směrnice (EU) 2020/123',raw:inner}]}});
test('normal parsing closes point c and retains the duplicated printed paragraph labels as incomplete',()=>{
 const p=parseProposal(content(),{language:'cs'}),all=units=>units.flatMap(u=>[u,...all(u.children)]),parents=all(p.units).filter(u=>u.scope==='quoted'&&u.kind==='paragraph'&&u.label?.value==='2');
 assert.equal(parents.length,2);assert(parents.every(u=>u.pathConflict&&!u.complete));assert(parents[0].listOwnership);assert.equal(parents[0].children.find(u=>u.label?.value==='c').extent.end,10);assert.equal(parents[0].children.filter(u=>u.kind==='subparagraph').length,2);
});
test('an exact unique original selects the proved second subparagraph, without renumbering its parent',()=>{
 const p=parseProposal(content(),{language:'cs'}),result=resolveProposalPlacement([{kind:'act',proposal:p}],wording('Čl. 13 – odst. 2 – pododstavec 2','Direct continuation.','Changed continuation.'));
 assert.equal(result.status,'placed');assert.deepEqual(result.span,{start:10,end:10});assert.equal(p.complete,false);
});
test('a unique point c in the proved first subparagraph supplies the existing insertion cursor',()=>{
 const p=parseProposal(content(),{language:'cs'}),result=resolveProposalPlacement([{kind:'act',proposal:p}],wording('Čl. 13 – odst. 2 – pododstavec 1 – písm. c a (nové)','','ca) New point.'));
 assert.equal(result.status,'placed');assert.equal(result.insertAfter,9);assert.equal(result.insertBefore,10);assert.equal(p.complete,false);
});
test('missing proof retains both the subparagraph and insertion holds',()=>{
 const c=content();delete c.paragraphProperties[6].pdfListOwnership;const p=parseProposal(c,{language:'cs'});
 for(const w of [wording('Čl. 13 – odst. 2 – pododstavec 2','Direct continuation.','Changed.'),wording('Čl. 13 – odst. 2 – pododstavec 1 – písm. c a (nové)','','ca) New.')])assert.notEqual(resolveProposalPlacement([{kind:'act',proposal:p}],w).status,'placed');
});
test('a contradictory proposed point label cannot borrow a native list gap',()=>{
 const p=parseProposal(content(),{language:'cs'}),w=wording('Čl. 13 – odst. 2 – pododstavec 1 – písm. c a (nové)','','ba) Contradiction.');assert.notEqual(resolveProposalPlacement([{kind:'act',proposal:p}],w).status,'placed');
});
test('a contradictory published outer line cannot borrow targetPath evidence',()=>{
 const p=parseProposal(content(),{language:'cs'}),w=wording('Čl. 13 – odst. 2 – pododstavec 2','Direct continuation.','Changed.');w.targetLabel='Čl. 1 – odst. 1 – bod 2';assert.notEqual(resolveProposalPlacement([{kind:'act',proposal:p}],w).status,'placed');
});
test('a repeated original cannot disambiguate the two printed parent labels',()=>{
 const c=content();c.paragraphs[13]='Direct continuation.';const p=parseProposal(c,{language:'cs'}),w=wording('Čl. 13 – odst. 2 – pododstavec 2','Direct continuation.','Changed.');assert.notEqual(resolveProposalPlacement([{kind:'act',proposal:p}],w).status,'placed');
});
test('a duplicate inner article cannot inherit the local paragraph-list proof',()=>{
 const c=content();c.paragraphs.splice(14,0,'Článek 13','1. Repeated article.');c.paragraphSources.splice(14,0,...[90,91].map(mcid=>({path:'extra'+mcid,role:'/P',complete:true,pages:[1],mcids:[{page:1,mcid}]})));c.paragraphProperties.splice(14,0,{styleId:'Titrearticle',headingBasis:'native-first-line'},{});c.paragraphFormats.splice(14,0,{},{});const p=parseProposal(c,{language:'cs'}),w=wording('Čl. 13 – odst. 2 – pododstavec 2','Direct continuation.','Changed.');assert.notEqual(resolveProposalPlacement([{kind:'act',proposal:p}],w).status,'placed');
});
