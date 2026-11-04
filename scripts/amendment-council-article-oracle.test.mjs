import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCouncilDraftArticleText} from './amendment-council-article-oracle.mjs';
const raw=`Article 1
Directive (EU) 2020/123 is amended as follows:

1) Article 7 is replaced by the following:

‘Article 7
Protection

1. First native paragraph.

2. Second native paragraph.’

2) Article 8 is replaced by the following:

‘Article 8
Other provision

1. Other native paragraph.

2. Last native paragraph.’
Article 2
Final provision.`;
const text='1. First native paragraph.';
const fixture=()=>({wording:{language:'en',targetLabel:'Article 1 – paragraph 1 – point 1',targetPath:{proposal:[{raw:'Article 1 – paragraph 1 – point 1'}],underlying:[{document:'Directive (EU) 2020/123',raw:'Article 7 – paragraph 1'}]},originalText:text},items:[{proposal:{paragraphs:raw.split(/\n\s*\n/u).map(text=>({text:text.replace(/\s+/gu,' ').trim()}))}}],placement:{status:'placed',operation:'replace',itemIndex:0,span:{start:3,end:3},splice:{start:{paragraph:3,offset:0},end:{paragraph:3,offset:text.length}}}});
test('native article oracle binds outer point, named act, inner article and paragraph',()=>{
 assert.equal(assertCouncilDraftArticleText(raw,fixture()).status,'verified');
 const compact=fixture();compact.wording.targetPath.underlying[0].raw='Article 7 –paragraph 1';
 assert.equal(assertCouncilDraftArticleText(raw,compact).status,'verified');
});
for(const [name,mutate] of [
 ['outer owner',v=>v.wording.targetPath.proposal[0].raw='Article 1 – paragraph 1 – point 2'],
 ['inner article',v=>v.wording.targetPath.underlying[0].raw='Article 8 – paragraph 1'],
 ['inner paragraph',v=>v.wording.targetPath.underlying[0].raw='Article 7 – paragraph 2'],
 ['act identifier',v=>v.wording.targetPath.underlying[0].document='Directive (EU) 2020/124'],
 ['start offset',v=>v.placement.splice.start.offset=1],
 ['end offset',v=>v.placement.splice.end.offset--],
 ['splice paragraph',v=>v.placement.splice.end.paragraph=4],
])test(`native article oracle rejects a changed ${name}`,()=>{
 const v=fixture();mutate(v);assert.notEqual(assertCouncilDraftArticleText(raw,v).status,'verified');
});
test('native article oracle independently proves consecutive insertion siblings',()=>{
 const v=fixture();v.wording.originalText='';v.wording.targetPath.underlying[0].raw='Article 7 – paragraph 1 a (new)';v.placement={status:'placed',operation:'insert',itemIndex:0,insertAfter:3,insertBefore:4};
 assert.equal(assertCouncilDraftArticleText(raw,v).status,'verified');
 v.placement.insertAfter=4;v.placement.insertBefore=5;
 assert.notEqual(assertCouncilDraftArticleText(raw,v).status,'verified');
});
test('terminal insertion must splice immediately before the native closing delimiter',()=>{
 const v=fixture(),row=v.items[0].proposal.paragraphs[4].text,offset=row.indexOf('’');
 v.wording.originalText='';v.wording.targetPath.underlying[0].raw='Article 7 – paragraph 2 a (new)';
 v.placement={status:'placed',operation:'insert',itemIndex:0,insertAfter:4,insertBefore:5,splice:{start:{paragraph:4,offset},end:{paragraph:4,offset}}};
 assert.equal(assertCouncilDraftArticleText(raw,v).status,'verified');
 v.placement.splice.start.offset--;v.placement.splice.end.offset--;
 assert.equal(assertCouncilDraftArticleText(raw,v).status,'failed');
 delete v.placement.splice;assert.notEqual(assertCouncilDraftArticleText(raw,v).status,'verified');
});

for(const instruction of ['Article 91 is replaced by the following:','Article 7 is deleted as follows:','Article 7 is not replaced by the following:','Article 7 might be replaced by the following:'])test(`contradictory or unsupported instruction is withheld: ${instruction}`,()=>{
 const changed=raw.replace('Article 7 is replaced by the following:',instruction);
 assert.notEqual(assertCouncilDraftArticleText(changed,fixture()).status,'verified');
});
test('a duplicated original outside its native owner cannot certify a moved splice',()=>{
 const v=fixture(),wrong=v.items[0].proposal.paragraphs.length;v.items[0].proposal.paragraphs.push({text});
 v.placement.span={start:wrong,end:wrong};v.placement.splice={start:{paragraph:wrong,offset:0},end:{paragraph:wrong,offset:text.length}};
 assert.equal(assertCouncilDraftArticleText(raw,v).status,'failed');
});
test('duplicated or reordered native frames cannot certify unchanged body text',()=>{
 const v=fixture(),rows=v.items[0].proposal.paragraphs;rows.push(...structuredClone(rows));
 assert.equal(assertCouncilDraftArticleText(raw,v).status,'failed');
 const w=fixture();[w.items[0].proposal.paragraphs[3],w.items[0].proposal.paragraphs[4]]=[w.items[0].proposal.paragraphs[4],w.items[0].proposal.paragraphs[3]];
 assert.equal(assertCouncilDraftArticleText(raw,w).status,'failed');
});
