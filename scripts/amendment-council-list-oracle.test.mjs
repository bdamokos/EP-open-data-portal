import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCouncilListSubparagraphs} from './amendment-council-list-oracle.mjs';
import {assertCouncilDraftArticleText} from './amendment-council-article-oracle.mjs';
function fixture(){
 const lines=[['2. Paragraph introduces:',[20,50,95]],['a) First point;',[50,80,110]],['b) Second point.',[50,80,115]],['Parent continuation.',[50,100]],['2. Another paragraph.',[20,50,95]]];
 const words=lines.flatMap(([text,x],i)=>text.split(' ').map((text,j)=>({text,x:x[j],right:x[j]+10,top:30+i*20,bottom:40+i*20,page:1})));
 return {raw:lines.slice(0,-1).map(x=>x[0]).join('\n\n'),words,boundaryText:lines.at(-1)[0]};
}
test('outdented native continuation follows the complete lead and flat list',()=>{
 const {raw,words,boundaryText}=fixture(),proof=nativeCouncilListSubparagraphs(raw,words,boundaryText);
 assert.deepEqual(proof?.map(x=>x.text),['2. Paragraph introduces:\n\na) First point;\n\nb) Second point.','Parent continuation.']);
 assert.equal(proof[1].offset,'2.Paragraphintroduces:a)Firstpoint;b)Secondpoint.'.length);
});
for(const [name,change] of [
 ['child continuation',f=>f.words.filter(w=>w.top===90).forEach(w=>{w.x+=30;w.right+=30;})],
 ['ambiguous indent',f=>f.words.filter(w=>w.top===90).forEach(w=>{w.x+=1;w.right+=1;})],
 ['shifted list body',f=>{f.words.find(w=>w.text==='Second').x+=1;}],
 ['cross-page continuation',f=>f.words.filter(w=>w.top===90).forEach(w=>w.page=2)],
 ['nonconsecutive labels',f=>{f.raw=f.raw.replace('b)','c)');f.words.find(w=>w.text==='b)').text='c)';}],
 ['noncolon lead',f=>{f.raw=f.raw.replace('introduces:','introduces.');f.words.find(w=>w.text==='introduces:').text='introduces.';}],
 ['nested roman lead',f=>{f.raw=f.raw.replace('Parent continuation.','i) Nested continuation.');f.words=f.words.filter(w=>w.top!==90).concat([{text:'i)',x:50,right:60,top:90,bottom:100,page:1},{text:'Nested',x:80,right:95,top:90,bottom:100,page:1},{text:'continuation.',x:110,right:130,top:90,bottom:100,page:1}]);}],
 ['duplicate native passage',f=>{f.words.push(...structuredClone(f.words).map(w=>({...w,page:2})));}],
 ['missing native word',f=>{f.words=f.words.filter(w=>w.text!=='continuation.');}],
 ['invalid geometry',f=>{f.words[0].x=NaN;}],
])test('native list proof withholds '+name,()=>{const f=fixture();change(f);assert.equal(nativeCouncilListSubparagraphs(f.raw,f.words,f.boundaryText),null);});
function addressed(){
 const f=fixture(),rows=['Článek 1','Směrnice (EU) 2020/123 se mění takto:','1) Článek 13 se nahrazuje tímto:','„Článek 13','Title','1. First paragraph.',...f.raw.split('\n\n'),'2. Another paragraph.','Different continuation.','3. Final paragraph.“','2) Článek 14 se nahrazuje tímto:','„Článek 14','1. Other article.“'];
 const raw=rows.join('\n\n'),at=rows.indexOf('Parent continuation.'),wording={language:'cs',targetLabel:'Čl. 1 – odst. 1 – bod 1',originalText:'Parent continuation.',proposedText:'Revised continuation.',targetPath:{language:'cs',proposal:[{raw:'Čl. 1 – odst. 1 – bod 1'}],underlying:[{document:'Směrnice (EU) 2020/123',raw:'Čl. 13 – odst. 2 – pododstavec 2'}]}},items=[{kind:'act',proposal:{paragraphs:rows.map(text=>({text,complete:true}))}}],placement={status:'placed',operation:'replace',itemIndex:0,span:{start:at,end:at},splice:{start:{paragraph:at,offset:0},end:{paragraph:at,offset:rows[at].length}}};
 return {raw,wording,items,placement,nativeBodyWords:f.words};
}
test('native list ownership proves the addressed second subparagraph across a repeated parent label',()=>{const f=addressed();assert.equal(assertCouncilDraftArticleText(f.raw,f).status,'verified');});
test('native geometry is required, rather than flat filtering of labelled blocks',()=>{const f=addressed();delete f.nativeBodyWords;assert.notEqual(assertCouncilDraftArticleText(f.raw,f).status,'verified');});
test('the actual splice cannot move to another continuation under the repeated label',()=>{const f=addressed(),at=f.items[0].proposal.paragraphs.findIndex(p=>p.text==='Different continuation.');f.placement.span={start:at,end:at};f.placement.splice={start:{paragraph:at,offset:0},end:{paragraph:at,offset:f.wording.originalText.length}};assert.notEqual(assertCouncilDraftArticleText(f.raw,f).status,'verified');});
test('shifted start coordinates do not pass a list subparagraph proof',()=>{const f=addressed();f.placement.splice.start.offset=1;assert.notEqual(assertCouncilDraftArticleText(f.raw,f).status,'verified');});
test('a contradicted published outer line cannot borrow native ownership',()=>{const f=addressed();f.wording.targetLabel='Čl. 1 – odst. 1 – bod 2';assert.notEqual(assertCouncilDraftArticleText(f.raw,f).status,'verified');});
test('native list insertion checks the printed new point as well as the addressed gap',()=>{
 const f=addressed(),at=f.items[0].proposal.paragraphs.findIndex(p=>p.text==='Parent continuation.');
 f.wording.targetPath.underlying[0].raw='Čl. 13 – odst. 2 – pododstavec 1 – písm. b a (nové)';f.wording.originalText='';f.wording.proposedText='ba) New point.';f.placement={status:'placed',operation:'insert',itemIndex:0,insertAfter:at-1,insertBefore:at};assert.equal(assertCouncilDraftArticleText(f.raw,f).status,'verified');
 f.wording.proposedText='ca) Different point.';assert.notEqual(assertCouncilDraftArticleText(f.raw,f).status,'verified');
});
test('a deeper point path cannot inherit the direct paragraph list proof',()=>{
 const f=addressed(),at=f.items[0].proposal.paragraphs.findIndex(p=>p.text==='Parent continuation.');f.wording.targetPath.underlying[0].raw='Čl. 13 – odst. 2 – pododstavec 1 – písm. b – písm. b a (nové)';f.wording.originalText='';f.wording.proposedText='ba) New point.';f.placement={status:'placed',operation:'insert',itemIndex:0,insertAfter:at-1,insertBefore:at};assert.notEqual(assertCouncilDraftArticleText(f.raw,f).status,'verified');
});
test('a list cannot supply its own numeric closing boundary',()=>{const f=fixture();assert.equal(nativeCouncilListSubparagraphs(f.raw,f.words),null);assert.equal(nativeCouncilListSubparagraphs(f.raw,f.words,'3. Another paragraph.'),null);});
for(const insertion of [false,true])for(const [name,change] of [
 ['next page',f=>f.nativeBodyWords.filter(w=>w.top===110).forEach(w=>w.page=2)],
 ['nested boundary',f=>f.nativeBodyWords.filter(w=>w.top===110).forEach(w=>{w.x+=30;w.right+=30;})],
 ['missing boundary',f=>{f.nativeBodyWords=f.nativeBodyWords.filter(w=>w.top!==110);f.nativeBodyWords.push({text:'unrelated',x:20,right:60,top:110,bottom:120,page:1});}],
 ['wrong numeric label',f=>{f.nativeBodyWords.find(w=>w.top===110&&w.text==='2.').text='3.';}],
 ['missing body geometry',f=>{f.nativeBodyWords=f.nativeBodyWords.filter(w=>!(w.top===110&&w.text==='Another'));}],
 ['shifted body indent',f=>{f.nativeBodyWords.find(w=>w.top===110&&w.text==='Another').x+=30;}],
 ['reversed boundary order',f=>f.nativeBodyWords.filter(w=>w.top===110).forEach(w=>{w.top=10;w.bottom=20;})],
])test((insertion?'insertion':'replacement')+' withholds a closing numeric boundary with '+name,()=>{
 const f=addressed();if(insertion){const at=f.items[0].proposal.paragraphs.findIndex(p=>p.text==='Parent continuation.');f.wording.targetPath.underlying[0].raw='Čl. 13 – odst. 2 – pododstavec 1 – písm. b a (nové)';f.wording.originalText='';f.wording.proposedText='ba) New point.';f.placement={status:'placed',operation:'insert',itemIndex:0,insertAfter:at-1,insertBefore:at};}
 assert.equal(assertCouncilDraftArticleText(f.raw,f).status,'verified');change(f);assert.notEqual(assertCouncilDraftArticleText(f.raw,f).status,'verified');
});
