import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCouncilDraftNativeText} from './amendment-council-draft-oracle.mjs';

const text='(8) Native Council recital, with its final punctuation.';
const native=`Public draft\n${text}\n(9) Next recital.\nArticle 1\nOperative text.`;
const input=()=>({wording:{targetLabel:'Recital 8',originalText:text},items:[{proposal:{paragraphs:[{text}]}}],placement:{status:'placed',operation:'replace',itemIndex:0,span:{start:0,end:0},splice:{start:{paragraph:0,offset:0},end:{paragraph:0,offset:text.length}}}});
test('native oracle proves the exact whole-recital splice',()=>{
 assert.equal(assertCouncilDraftNativeText(native,input()).status,'verified');
});
for(const [label,mutate] of [
 ['shifted text',p=>p.splice.start.offset=20],
 ['shifted punctuation',p=>p.splice.start.offset=1],
 ['truncated punctuation',p=>p.splice.end.offset--],
 ['negative offset',p=>p.splice.start.offset=-1],
 ['out-of-range offset',p=>p.splice.end.offset++],
 ['fractional offset',p=>p.splice.start.offset=0.5],
 ['wrong start paragraph',p=>p.splice.start.paragraph=1],
 ['wrong end paragraph',p=>p.splice.end.paragraph=1],
 ['reversed span',p=>p.span.start=1],
 ['missing splice',p=>delete p.splice],
])test(`native oracle rejects ${label} despite matching enclosing text`,()=>{
 const value=input();mutate(value.placement);
 assert.deepEqual(assertCouncilDraftNativeText(native,value),{status:'failed',reason:'oracle-council-pdf-splice-mismatch'});
});
test('native oracle refuses a source whose original text is absent',()=>{
 assert.equal(assertCouncilDraftNativeText(native.replace(text,'(8) Different recital.'),input()).status,'unverified');
});

test('existing suffixed recitals bind their full native passage and ordered predecessor',()=>{
 const text='(8a) Existing native recital.',raw='(8) Base native recital.\n'+text+'\n(9) Next recital.\nArticle 1\nOperative text.',v={wording:{targetLabel:'Recital 8a',originalText:text},items:[{proposal:{paragraphs:[{text:'(8) Base native recital.'},{text},{text:'(9) Next recital.'}]}}],placement:{status:'placed',operation:'replace',itemIndex:0,span:{start:1,end:1},splice:{start:{paragraph:1,offset:0},end:{paragraph:1,offset:text.length}}}};
 assert.equal(assertCouncilDraftNativeText(raw,v).status,'verified');
 for(const mutate of [x=>x.placement.splice.start.offset++,x=>x.placement.splice.end.offset--,x=>x.wording.targetLabel='Recital 8b',x=>x.items[0].proposal.paragraphs[0].text='(7) Wrong predecessor.']){const x=structuredClone(v);mutate(x);assert.notEqual(assertCouncilDraftNativeText(raw,x).status,'verified');}
 const copied=structuredClone(v);copied.items[0].proposal.paragraphs.push({text});copied.placement.span={start:3,end:3};copied.placement.splice.start.paragraph=3;copied.placement.splice.end.paragraph=3;assert.notEqual(assertCouncilDraftNativeText(raw,copied).status,'verified');
 assert.notEqual(assertCouncilDraftNativeText(raw.replace('(9)',text+'\n(9)'),v).status,'verified');
 const insertion=structuredClone(v);insertion.placement={status:'placed',operation:'insert',itemIndex:0,insertAfter:0,insertBefore:1};assert.notEqual(assertCouncilDraftNativeText(raw,insertion).status,'verified');
});

test('native body geometry separates an intervening owned note from a suffixed recital predecessor',()=>{
 const base='(8) Base native recital.',text='(8a) Existing native recital.',next='(9) Next recital.',raw=base+'\n99 Unrelated native citation.\n'+text+'\n'+next+'\nArticle 1\nBody.',v={wording:{targetLabel:'Recital 8a',originalText:text},items:[{proposal:{paragraphs:[{text:base},{text},{text:next}]}}],placement:{status:'placed',operation:'replace',itemIndex:0,span:{start:1,end:1},splice:{start:{paragraph:1,offset:0},end:{paragraph:1,offset:text.length}}}};
 assert.notEqual(assertCouncilDraftNativeText(raw,v).status,'verified');
 const words=[base,text,next].flatMap(s=>s.split(' ').map(text=>({text})));assert.equal(assertCouncilDraftNativeText(raw,{...v,nativeBodyWords:words}).status,'verified');
 assert.notEqual(assertCouncilDraftNativeText(raw,{...v,nativeBodyWords:words.filter(w=>w.text!=='(8)')}).status,'verified');
});

test('one alphabetic word may differ only in the whole independently addressed native recital',()=>{
 const first='(1) First recital.',text='(2) Native national protection in 2026.',next='(3) Next recital.',raw=first+'\n'+text+'\n'+next+'\nArticle 1\nBody.',words=[first,text,next].flatMap(s=>s.split(' ').map(text=>({text}))),v={wording:{targetLabel:'Recital 2',originalText:text.replace('national','regional')},items:[{proposal:{paragraphs:[{text:first},{text,complete:true},{text:next}]}}],placement:{status:'placed',operation:'replace',originalDifference:'one-word',itemIndex:0,span:{start:1,end:1},splice:{start:{paragraph:1,offset:0},end:{paragraph:1,offset:text.length}}},nativeBodyWords:words};
 assert.equal(assertCouncilDraftNativeText(raw,v).status,'verified');
 for(const original of [text,text.replace('2026','2025'),text.replace('2026.','2026;'),text.replace('national','regional').replace('protection','assistance'),text.replace('national','national regional'),text.replace('national','national-'),text.replace('national','national2')]){
  const f=structuredClone(v);f.wording.originalText=original;assert.notEqual(assertCouncilDraftNativeText(raw,f).status,'verified',original);
 }
 for(const change of [f=>delete f.nativeBodyWords,f=>f.placement.splice.start.offset++,f=>f.placement.splice.end.offset--,f=>f.items[0].proposal.paragraphs[1].complete=false,f=>f.wording.targetLabel='Recital 3',f=>delete f.placement.originalDifference]){const f=structuredClone(v);change(f);assert.notEqual(assertCouncilDraftNativeText(raw,f).status,'verified');}
 const moved=structuredClone(v);moved.items[0].proposal.paragraphs.push({text,complete:true});moved.placement.span={start:3,end:3};moved.placement.splice.start.paragraph=3;moved.placement.splice.end.paragraph=3;assert.notEqual(assertCouncilDraftNativeText(raw,moved).status,'verified');
 for(const fragment of ['AB123','http://example.test/a','name@example.test']){const f=structuredClone(v);f.items[0].proposal.paragraphs[1].text=text.replace('national',fragment);f.placement.splice.end.offset=f.items[0].proposal.paragraphs[1].text.length;f.nativeBodyWords=[first,f.items[0].proposal.paragraphs[1].text,next].flatMap(s=>s.split(' ').map(text=>({text})));f.wording.originalText=f.items[0].proposal.paragraphs[1].text.replace(/AB|example/u,'other');assert.notEqual(assertCouncilDraftNativeText(raw,f).status,'verified');}
});
