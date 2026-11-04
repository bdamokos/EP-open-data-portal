import test from 'node:test';
import assert from 'node:assert/strict';
import {councilPdfNumberFrame,councilPdfArticleFrame} from './council-draft-number-geometry.mjs';
import {parseProposal} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
const line=(y,items)=>({page:1,y,items:items.map(([text,x,right])=>({text,x,right}))});
function content(){
 const paragraphs=['Článek 1','Směrnice (EU) 2020/123 se mění takto:','1) Článek 7 se nahrazuje tímto:','„Článek 7 Preparedness','1. First.','2. Earlier.','2. Repeated.','3. Penultimate.','4. Final.“','2) Článek 8 se nahrazuje tímto:','„Článek 8','1. Other.“'],properties=paragraphs.map((_,i)=>({notesComplete:true,annotationsComplete:true,...([0,3,10].includes(i)?{styleId:'Titrearticle',headingBasis:'native-first-line'}:{})}));
 for(const i of [2,4,5,6,7,8,9]){const prefix=/^\d+[.)]/u.exec(paragraphs[i])[0],outer=prefix.endsWith(')'),x=outer?20:50,body=outer?50:80;properties[i].pdfNumberFrame=councilPdfNumberFrame([line(700-i*25,[[prefix,x,x+10],[paragraphs[i].slice(prefix.length).trim(),body,body+100]])],paragraphs[i]);}
 properties[3].pdfArticleFrame=councilPdfArticleFrame([line(625,[['„Článek 7',110,152]]),line(615,[['Preparedness',95,167]])]);
 return {sourceKind:'pdf',sourceHash:'a'.repeat(64),structureStatus:'extracted',paragraphs,paragraphProperties:properties,paragraphSources:paragraphs.map((_,i)=>({path:'p'+i,role:'/P',complete:true,pages:[1],mcids:[{page:1,mcid:i}]}))};
}
const wording=()=>({language:'cs',baseline:'council-position',targetLabel:'Čl. 1 – odst. 1 – bod 1',targetPath:{language:'cs',proposal:[{raw:'Čl. 1 – odst. 1 – bod 1'}],underlying:[{document:'Směrnice (EU) 2020/123',raw:'Čl. 7 – odst. 4 a (nový)'}]},originalText:'',proposedText:'4a. New paragraph.'});
test('the existing resolver inserts inside the native terminal quote without completing its parent',()=>{
 const p=parseProposal(content(),{language:'cs'}),r=resolveProposalPlacement([{kind:'act',proposal:p}],wording());assert.equal(r.status,'placed');assert.equal(r.insertAfter,8);assert.equal(r.insertBefore,9);assert.deepEqual(r.splice,{start:{paragraph:8,offset:9},end:{paragraph:8,offset:9}});assert.equal(p.complete,false);assert(r.evidence.some(e=>e.basis==='native-terminal-paragraph-order'));
});
for(const [name,change] of [
 ['missing terminal geometry',c=>{delete c.paragraphProperties[8].pdfNumberFrame;}],
 ['missing earlier peer geometry',c=>{delete c.paragraphProperties[4].pdfNumberFrame;}],
 ['nested numeric family',c=>{for(const i of [4,5,6,7,8]){c.paragraphProperties[i].pdfNumberFrame.x+=30;c.paragraphProperties[i].pdfNumberFrame.bodyX+=30;}}],
 ['nested terminal number',c=>{c.paragraphProperties[8].pdfNumberFrame.x+=30;}],
 ['wrong heading number',c=>{c.paragraphProperties[3].pdfArticleFrame.number='8';}],
 ['missing centered heading',c=>{delete c.paragraphProperties[3].pdfArticleFrame;}],
 ['duplicate anchor',c=>{c.paragraphs[7]='4. Other anchor.';}],
 ['descending prefix',c=>{c.paragraphs[7]='1. Earlier number.';}],
 ['source hash unavailable',c=>{c.sourceHash='invalid';}],
 ['incomplete terminal page',c=>{c.paragraphSources[8].complete=false;}],
 ['incomplete boundary annotations',c=>{c.paragraphProperties[9].annotationsComplete=false;}],
 ['boundary on another page',c=>{c.paragraphProperties[9].pdfNumberFrame.page=2;c.paragraphSources[9].pages=[2];}],
 ['boundary nested',c=>{c.paragraphProperties[9].pdfNumberFrame.x+=30;}],
 ['boundary MCID skipped',c=>{c.paragraphSources[9].mcids[0].mcid=99;}],
 ['peer geometry page mismatch',c=>{c.paragraphProperties[6].pdfNumberFrame.page=2;}],
 ['heading MCID gap',c=>{c.paragraphSources[3].mcids[0].mcid=99;}],
 ['peer physical order reversed',c=>{c.paragraphProperties[6].pdfNumberFrame.y=650;}],
 ['terminal attachment',c=>{c.links=[{paragraph:8,start:3,end:4,url:'https://example.test'}];}],
 ['closing delimiter missing',c=>{c.paragraphs[8]='4. Final.';}],
])test('terminal native order withholds '+name,()=>{const c=content();change(c);const p=parseProposal(c,{language:'cs'});assert.notEqual(resolveProposalPlacement([{kind:'act',proposal:p}],wording()).status,'placed');});
test('a wrong proposed label cannot borrow the terminal gap',()=>{const p=parseProposal(content(),{language:'cs'}),w=wording();w.proposedText='3a. Wrong paragraph.';assert.notEqual(resolveProposalPlacement([{kind:'act',proposal:p}],w).status,'placed');});
test('number geometry requires an independent label/body and aligned wrapped lines',()=>{
 const a=line(100,[['4.',50,60],['Body',80,100]]),b=line(80,[['Wrapped',80,120]]);assert(councilPdfNumberFrame([a,b],'4. Body Wrapped'));
 b.items[0].x=81;assert.equal(councilPdfNumberFrame([a,b],'4. Body Wrapped'),null);assert.equal(councilPdfNumberFrame([line(100,[['4. Body',50,120]])],'4. Body'),null);
});
test('article title geometry fails closed without finite aligned centers',()=>{
 const a=line(100,[['Článek 7',110,152]]),b=line(80,[['Preparedness',95,167]]);assert(councilPdfArticleFrame([a,b]));b.items[0].right=171;assert.equal(councilPdfArticleFrame([a,b]),null);delete b.items[0].right;assert.equal(councilPdfArticleFrame([a,b]),null);
});
