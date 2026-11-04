import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeTerminalParagraphFrame} from './amendment-council-terminal-oracle.mjs';
import {assertCouncilDraftArticleText} from './amendment-council-article-oracle.mjs';
const key=s=>s.normalize('NFC').replace(/\s/gu,'');
function fixture(){
 const lead='1) Článek 7 se nahrazuje tímto:',nextInstruction='2) Článek 8 se nahrazuje tímto:',texts=['1. First.','2. Earlier.','2. Repeated.','3. Penultimate.','4. Final.“'],section='„Článek 7\nPreparedness\n\n'+texts.join('\n\n'),point=lead+'\n\n'+section;
 const lines=[[lead,20,50],['„Článek 7',110,145],['Preparedness',95,null],...texts.map(t=>[t,50,80]),[nextInstruction,20,50]],words=[];
 for(const [i,[text,x,body]] of lines.entries()){
  let at=x;for(const [j,textWord] of text.split(' ').entries()){if(j===1&&body!==null)at=body;const right=textWord==='Preparedness'?167:textWord==='7'?152:at+textWord.length*4;words.push({text:textWord,x:at,right,top:30+i*25,bottom:40+i*25,page:1});at=right+4;}
 }
 const siblings=texts.map(text=>({value:/^\d+/u.exec(text)[0],text,blocks:[text],offset:key(section.slice(0,section.indexOf(text))).length}));
 return {point,section,siblings,nextInstruction,article:'7',number:4,words};
}
test('a unique terminal number retains its native level after repeated lower labels',()=>assert.equal(nativeTerminalParagraphFrame(fixture()),true));
for(const [name,change] of [
 ['nested terminal paragraph',f=>f.words.filter(w=>w.top===205).forEach(w=>{w.x+=30;w.right+=30;})],
 ['all numeric peers nested one level',f=>f.words.filter(w=>w.top>=105&&w.top<=205).forEach(w=>{w.x+=30;w.right+=30;})],
 ['misaligned title',f=>f.words.filter(w=>w.text==='Preparedness').forEach(w=>{w.x+=2;w.right+=2;})],
 ['missing title',f=>{f.words=f.words.filter(w=>w.text!=='Preparedness');}],
 ['wrong article',f=>{f.article='8';}],
 ['number gap',f=>{f.siblings.at(-1).value='5';f.number=5;}],
 ['duplicate anchor',f=>{f.siblings[3].value='4';}],
 ['descending prefix',f=>{f.siblings[3].value='1';}],
 ['missing closing instruction',f=>{f.nextInstruction='';}],
 ['closing boundary across pages',f=>f.words.filter(w=>w.top===230).forEach(w=>w.page=2)],
 ['closing boundary at nested indent',f=>f.words.filter(w=>w.top===230).forEach(w=>{w.x+=30;w.right+=30;})],
 ['closing boundary absent from geometry',f=>{f.words=f.words.filter(w=>w.top!==230);}],
 ['partial closing boundary',f=>{f.nextInstruction='2) Článek';}],
 ['duplicate native point',f=>{f.words.push(...structuredClone(f.words).map(w=>({...w,page:2})));}],
])test('terminal numeric geometry withholds '+name,()=>{const f=fixture();change(f);assert.equal(nativeTerminalParagraphFrame(f),false);});
function addressed(){
 const f=fixture(),rows=['Článek 1','Směrnice (EU) 2020/123 se mění takto:',...f.point.split('\n\n'),f.nextInstruction,'„Článek 8','1. Other.“'],raw=rows.join('\n\n'),at=rows.findIndex(t=>t.startsWith('4.')),offset=rows[at].indexOf('“'),hash='a'.repeat(64);
 return {raw,nativePdfHash:hash,nativeBodyWords:f.words,items:[{kind:'act',proposal:{sourceKind:'pdf',nativeSourceHash:hash,paragraphs:rows.map(text=>({text,complete:true}))}}],wording:{language:'cs',targetLabel:'Čl. 1 – odst. 1 – bod 1',targetPath:{language:'cs',proposal:[{raw:'Čl. 1 – odst. 1 – bod 1'}],underlying:[{document:'Směrnice (EU) 2020/123',raw:'Čl. 7 – odst. 4 a (nový)'}]},originalText:'',proposedText:'4a. New paragraph.'},placement:{status:'placed',operation:'insert',itemIndex:0,insertAfter:at,insertBefore:at+1,splice:{start:{paragraph:at,offset},end:{paragraph:at,offset}}}};
}
test('terminal proof certifies the actual cursor inside the native closing quote',()=>{const f=addressed();assert.equal(assertCouncilDraftArticleText(f.raw,f).status,'verified');});
for(const [name,change] of [
 ['wrong byte hash',f=>{f.nativePdfHash='b'.repeat(64);}],
 ['missing byte hash',f=>{delete f.nativePdfHash;}],
 ['missing geometry',f=>{delete f.nativeBodyWords;}],
 ['wrong proposed number',f=>{f.wording.proposedText='3a. New paragraph.';}],
 ['nonblank original',f=>{f.wording.originalText='Some text';}],
 ['extra item',f=>{f.items.push(structuredClone(f.items[0]));}],
 ['annex wrapper',f=>{f.items[0].kind='annex';}],
 ['cursor after closing quote',f=>{f.placement.splice.start.offset++;f.placement.splice.end.offset++;}],
 ['shifted paragraph',f=>{f.placement.insertAfter--;f.placement.insertBefore--;}],
 ['subparagraph target',f=>{f.wording.targetPath.underlying[0].raw='Čl. 7 – odst. 4 – pododstavec 1 a (nový)';}],
])test('terminal ownership rejects '+name,()=>{const f=addressed();change(f);assert.notEqual(assertCouncilDraftArticleText(f.raw,f).status,'verified');});
