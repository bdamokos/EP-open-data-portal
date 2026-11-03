import test from 'node:test';
import assert from 'node:assert/strict';
import {word,p} from '../server/test-support/nle-native-fixture.mjs';
import {assertGuidelineAnnex} from './amendment-guideline-oracle.mjs';
const texts=['Guideline 5: Demand','First body.','Second body.','Guideline 6: Supply','Third body.'];
const fixture=(rows=texts)=>({nativeQuoted:{proposalBuffer:word(rows.map(t=>p(t)).join(''))},proposal:{item:'annex',paragraphs:rows.map((text,index)=>({index,text,complete:true,source:{complete:true,path:`/w:document[1]/w:body[1]/w:p[${index+1}]`}}))}});
const wording={language:'en',targetLabel:'Annex I – paragraph 3',originalText:'Third body.'};
const placement={operation:'replace',span:{start:4,end:4},splice:{start:{paragraph:4,offset:0},end:{paragraph:4,offset:11}}};
test('guideline oracle counts body paragraphs across headings independently',()=>{
 const input={...fixture(),wording,placement};assert.equal(assertGuidelineAnnex(input).status,'verified');
 assert.equal(assertGuidelineAnnex({...input,placement:{...placement,span:{start:2,end:2}}}).status,'failed');
 assert.equal(assertGuidelineAnnex({...input,wording:{...wording,targetLabel:'Annex II – paragraph 3'}}).status,'unverified');
});
test('guideline oracle verifies terminal insertion and rejects unsafe/native structure',()=>{
 const input={...fixture(),wording:{...wording,targetLabel:'Annex I – paragraph 3 a (new)',originalText:''},placement:{operation:'insert',insertAfter:4,insertBefore:5}};
 assert.equal(assertGuidelineAnnex(input).status,'verified');
 assert.equal(assertGuidelineAnnex({...input,placement:{...input.placement,insertAfter:3}}).status,'failed');
 for(const rows of [['Guideline 5: Demand','First body.','Guideline 7: Supply','Third body.'],['Guideline 5: Demand','First body.','Guideline 6: Supply']])assert.equal(assertGuidelineAnnex({...input,...fixture(rows)}).status,'unverified');
 const nativeQuoted={proposalBuffer:word(texts.map((t,i)=>p(t,'Normal',i===2)).join(''))};assert.equal(assertGuidelineAnnex({...input,nativeQuoted}).status,'unverified');
});
test('native bookmarks and whitespace do not manufacture or hide a body paragraph',()=>{
 const input=fixture(),xml='<w:p><w:pPr><w:pStyle w:val="Pagedecouverture"/></w:pPr><w:r><w:pict/></w:r></w:p><w:bookmarkEnd w:id="0"/>'+texts.map(t=>p(t+' ')).join('');
 const proposal={...input.proposal,paragraphs:input.proposal.paragraphs.map((row,i)=>({...row,source:{...row.source,path:`/w:document[1]/w:body[1]/w:p[${i+2}]`}}))};
 assert.equal(assertGuidelineAnnex({...input,proposal,nativeQuoted:{proposalBuffer:word(xml)},wording,placement}).status,'verified');
 const appended=xml+'<w:p><w:r><w:drawing/></w:r></w:p>';
 assert.equal(assertGuidelineAnnex({...input,proposal,nativeQuoted:{proposalBuffer:word(appended)},wording,placement}).status,'unverified');
});
test('guideline subheading addresses count headings independently from body paragraphs',()=>{
 const input={...fixture(),wording:{...wording,targetLabel:'Annex I – subheading 1',originalText:texts[0]},placement:{operation:'replace',span:{start:0,end:0},splice:{start:{paragraph:0,offset:0},end:{paragraph:0,offset:texts[0].length}}}};
 assert.equal(assertGuidelineAnnex(input).status,'verified');
 assert.equal(assertGuidelineAnnex({...input,wording:{...input.wording,targetLabel:'Annex I – subheading 2'}}).status,'failed');
});

test('guideline verification rejects splice paragraphs outside the native addressed row',()=>{
 const input={...fixture(),wording,placement};
 for(const key of ['start','end']){
  const moved={...placement,splice:{...placement.splice,[key]:{...placement.splice[key],paragraph:3}}};
  assert.equal(assertGuidelineAnnex({...input,placement:moved}).status,'failed');
 }
});
