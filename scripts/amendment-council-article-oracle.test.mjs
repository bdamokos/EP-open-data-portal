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

const repeatedRaw=`Article 1
Directive (EU) 2020/123 is amended as follows:

1) Articles 7 and 8 are replaced by the following:

‘Article 7
First provision

1. First paragraph.

d) Repeated native sentence.

e) Next native sentence.

2. Second paragraph.

d) Repeated native sentence.

e) Next native sentence.

Article 8
Second provision

1. First paragraph.

d) Repeated native sentence.

e) Next native sentence.’

2) Article 9 is replaced by the following:

‘Article 9
Other provision

1. Last native paragraph.’`;
function repeatedFixture(article,paragraph=1){
 const paragraphs=repeatedRaw.split(/\n\s*\n/u).map(text=>({text:text.replace(/\s+/gu,' ').trim()}));
 const indexes=paragraphs.flatMap((p,i)=>p.text==='d) Repeated native sentence.'?[i]:[]),at=article===8?indexes[2]:indexes[paragraph-1];
 return {wording:{language:'en',targetPath:{proposal:[{raw:'Article 1 – paragraph 1 – point 1'}],underlying:[{document:'Directive (EU) 2020/123',raw:`Article ${article} – paragraph ${paragraph} – point d`}]},originalText:'d) Repeated native sentence.'},items:[{proposal:{paragraphs}}],placement:{status:'placed',operation:'replace',itemIndex:0,span:{start:at,end:at},splice:{start:{paragraph:at,offset:0},end:{paragraph:at,offset:'d) Repeated native sentence.'.length}}},indexes};
}
for(const [article,paragraph] of [[8,1],[7,2]])test(`repeated wording binds the native inner article ${article} paragraph ${paragraph} occurrence`,()=>{
 const {indexes,...f}=repeatedFixture(article,paragraph);assert.equal(assertCouncilDraftArticleText(repeatedRaw,f).status,'verified');
 f.placement.span={start:indexes[0],end:indexes[0]};f.placement.splice.start.paragraph=indexes[0];f.placement.splice.end.paragraph=indexes[0];
 assert.equal(assertCouncilDraftArticleText(repeatedRaw,f).status,'failed');
});
test('repeated insertion predecessors bind their addressed native parent',()=>{
 const {indexes,...f}=repeatedFixture(7,2);f.wording.originalText='';f.wording.targetPath.underlying[0].raw='Article 7 – paragraph 2 – point d a (new)';
 f.placement={status:'placed',operation:'insert',itemIndex:0,insertAfter:indexes[1],insertBefore:indexes[1]+1};
 assert.equal(assertCouncilDraftArticleText(repeatedRaw,f).status,'verified');
 f.placement.insertAfter=indexes[0];f.placement.insertBefore=indexes[0]+1;
 assert.equal(assertCouncilDraftArticleText(repeatedRaw,f).status,'failed');
});

test('an unsupported point subparagraph cannot promote its continuation to the first ordinal',()=>{
 const native=raw.replace('1. First native paragraph.','1. First native paragraph.\n\nd) First subparagraph of point d.\n\nSecond subparagraph of point d.\n\ne) Following point.');
 const paragraphs=native.split(/\n\s*\n/u).map(text=>({text:text.replace(/\s+/gu,' ').trim()}));
 for(const [ordinal,text] of [[1,'Second subparagraph of point d.'],[1,'d) First subparagraph of point d.'],[2,'Second subparagraph of point d.']]){
  const v=fixture(),at=paragraphs.findIndex(p=>p.text===text);v.items[0].proposal.paragraphs=paragraphs;v.wording.originalText=text;v.wording.targetPath.underlying[0].raw=`Article 7 – paragraph 1 – point d – subparagraph ${ordinal}`;v.placement.span={start:at,end:at};v.placement.splice={start:{paragraph:at,offset:0},end:{paragraph:at,offset:text.length}};
  assert.notEqual(assertCouncilDraftArticleText(native,v).status,'verified');
 }
});

test('paragraph subparagraphs with nested list subtrees remain withheld, including unlabelled child continuations',()=>{
 for(const [a,b] of [['a)','b)'],['i)','ii)'],['(a)','(b)'],['a.','b.'],['1)','2)']])for(const separator of ['\n\n','\n']){
  const body=`1. Paragraph lead:${separator}${a} First list item.\n\nContinuation belonging to the first list item.\n\n${b} Second list item.\n\nActual parent continuation.`;
  const native=raw.replace('1. First native paragraph.',body),paragraphs=native.split(/\n\s*\n/u).map(text=>({text:text.replace(/\s+/gu,' ').trim()}));
  for(const text of ['Continuation belonging to the first list item.','Actual parent continuation.']){
   const v=fixture(),at=paragraphs.findIndex(p=>p.text===text);v.items[0].proposal.paragraphs=paragraphs;v.wording.originalText=text;v.wording.targetPath.underlying[0].raw='Article 7 – paragraph 1 – subparagraph 2';v.placement.span={start:at,end:at};v.placement.splice={start:{paragraph:at,offset:0},end:{paragraph:at,offset:text.length}};
   assert.notEqual(assertCouncilDraftArticleText(native,v).status,'verified',`${a} with ${JSON.stringify(separator)}`);
  }
 }
});
test('a plain paragraph continuation keeps its native ordinal',()=>{
 const text='Direct second subparagraph.',native=raw.replace('1. First native paragraph.','1. First native paragraph.\n\n'+text),v=fixture();v.items[0].proposal.paragraphs=native.split(/\n\s*\n/u).map(text=>({text:text.replace(/\s+/gu,' ').trim()}));const at=v.items[0].proposal.paragraphs.findIndex(p=>p.text===text);v.wording.originalText=text;v.wording.targetPath.underlying[0].raw='Article 7 – paragraph 1 – subparagraph 2';v.placement.span={start:at,end:at};v.placement.splice={start:{paragraph:at,offset:0},end:{paragraph:at,offset:text.length}};
 assert.equal(assertCouncilDraftArticleText(native,v).status,'verified');
});
