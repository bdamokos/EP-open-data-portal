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
