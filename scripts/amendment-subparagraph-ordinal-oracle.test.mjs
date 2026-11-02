import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSubparagraphOrdinal} from './amendment-subparagraph-ordinal-oracle.mjs';
// A proposal's own articles run from 1: prefix bare headings for 1…first-1.
const make=rows=>({paragraphs:rows.map((text,index)=>({index,text,complete:true,source:{container:'body',complete:true}}))});
// Enacting terms follow the enacting formula; quotations are scanned from there.
const own=(rows,first)=>{const prefix=['HAVE ADOPTED THIS REGULATION:',...Array.from({length:first-1},(_,i)=>'Article '+(i+1))];return {proposal:make([...prefix,...rows]),shift:prefix.length};};
const target=(articleValue,paragraph,number,suffix='a')=>({segments:[{kind:'article',value:String(articleValue),isNew:false},{kind:'paragraph',value:String(paragraph),isNew:false,suffix:''},{kind:'subparagraph',value:number+suffix,number,suffix,isNew:true}]});
const at=insertBefore=>({operation:'insert',insertBefore,insertAfter:insertBefore-1});
const status=(proposal,t,before)=>assertSubparagraphOrdinal({proposal,target:t,placement:at(before)}).status;
const programme=['Article 13','Third countries','1.\tThe Programme may be opened to:','(a)\tmembers of the EFTA;','(b)\tother third countries.','2.\tThe agreements shall:','(a)\tensure balance;','(b)\tnot confer powers.','For the purposes of point (b), access is granted.','Article 14','1.\tEligibility.'];

test('raw rows place a new subparagraph after the lead with its points, or after a later subparagraph',()=>{
 const {proposal,shift}=own(programme,13);
 assert.equal(status(proposal,target(13,2,1),shift+8),'verified');
 assert.equal(status(proposal,target(13,2,1,'b'),shift+8),'verified');
 assert.equal(status(proposal,target(13,2,2),shift+9),'verified');
 assert.equal(status(proposal,target(13,1,1),shift+5),'verified');
 assert.equal(status(proposal,target(13,2,2),shift+8),'failed');
});
test('a missing subparagraph or later points are not verified',()=>{
 const {proposal,shift}=own(programme,13);
 assert.equal(status(proposal,target(13,2,3),shift+9),'unverified');
 const later=own([...programme.slice(0,9),'(c)\tlater point;'],13).proposal;
 assert.equal(status(later,target(13,2,1),shift+8),'unverified');
});
test('headings with a title line and a following chapter heading bound the article',()=>{
 const {proposal,shift}=own(['Article 22\nSanctions','1.\tMember States shall lay down rules on sanctions.','Sanctions shall be imposed by the authority.','2.\tThe maximum amount is fixed.','3.\tSanctions shall be dissuasive.','CHAPTER IV – FINAL PROVISIONS','Article 23\nEntry into force'],22);
 assert.equal(status(proposal,target(22,1,1),shift+2),'verified');
 assert.equal(status(proposal,target(22,3,1),shift+5),'verified','the chapter heading is not a subparagraph');
 assert.equal(status(proposal,target(22,3,2),shift+6),'unverified');
});
test('quoted articles never certify an outer address, however the quotation is printed',()=>{
 const layouts=[
  ['Article 1','1.\tThe following Chapter is substituted:','‘Article 21\nReporting','1.\tReports shall be submitted.','Article 22\nSanctions','1.\tMember States shall provide sanctions.','Sanctions shall be imposed by the authority.’','Article 2','1.\tEntry into force.'],
  ['Article 1','1.\tThe following Chapter is substituted: ‘Article 21\nReporting','1.\tReports shall be submitted.','Article 22\nSanctions','1.\tMember States shall provide sanctions.','Sanctions shall be imposed.’','Article 2','1.\tEntry into force.'],
  ['Article 1','1.\tThe following Chapter is substituted:','‘Article 21\nReporting','1.\tThe responsible entity is the ‘operator’.','Article 22\nSanctions','1.\tMember States shall provide sanctions.','Sanctions shall be imposed.’','Article 2','1.\tEntry into force.'],
 ];
 for(const rows of layouts){
  const proposal=make(rows),head=rows.findIndex(row=>row.startsWith('Article 22'));
  assert.equal(status(proposal,target(22,1,1),head+2),'unverified',rows[1]);
 }
});
test('prose naming a chapter or annex is a subparagraph, not a heading',()=>{
 for(const prose of ['Chapter II shall apply to those sanctions.','CHAPTER II shall apply to those sanctions.','ANNEX I shall apply to those sanctions.']){
  const {proposal,shift}=own(['Article 22\nSanctions','1.\tMember States shall lay down rules.','Sanctions shall apply.',prose,'2.\tAmounts.'],22);
  assert.equal(status(proposal,target(22,1,2),shift+3),'verified',prose);
 }
});
test('a heading printed with a no-break space keeps its place in the article sequence',()=>{
 const {proposal,shift}=own(['Article\u00a022\nSanctions','1.\tMember States shall lay down rules.','Sanctions shall apply.','Article\u00a023\nEntry into force','1.\tIt enters into force.'],22);
 assert.equal(status(proposal,target(22,1,1),shift+2),'verified');
});
test('a consecutive quoted article opened inline, or an article inside an annex, is never certified',()=>{
 const rows=['Article 1','1.\tScope.','Article 2','1.\tThe following Chapter is substituted: ‘Article 2\nReporting','1.\tReports shall be submitted.','Article 3\nSanctions','1.\tMember States shall provide sanctions.','Sanctions shall be imposed.’'];
 assert.equal(status(make(rows),target(3,1,1),7),'unverified');
 const annex=make(['ANNEX','The following provisions apply:','‘Article 1\nScope','1.\tIt applies.','Sanctions apply.’']);
 assert.equal(status(annex,target(1,1,1),4),'unverified');
 const defined=own(['Article 3\nDefinitions','1.\t‘Programme’ means the Union programme.','Member States’ authorities shall apply it.'],3);
 assert.equal(status(defined.proposal,target(3,1,1),defined.shift+2),'verified','balanced defined terms and possessives pass');
});
test('possessives, double quotes and quotations opened before Article 1 never certify a quoted article',()=>{
 const run=(open,close,instruction='1.\tThe following Chapter on workers’ rights is substituted: ')=>make(['Article 1','1.\tScope.','Article 2',instruction+open+'Article 2\nReporting','1.\tReports shall be submitted.','Article 3\nSanctions','1.\tMember States shall provide sanctions.','Sanctions shall be imposed.'+close]);
 for(const [open,close] of [['‘','’'],['“','”'],['"','"']])assert.equal(status(run(open,close),target(3,1,1),7),'unverified',open);
 const before=make(['The Annex is replaced by the following: ‘REGULATION','Article 1\nScope','1.\tIt applies.','Sanctions apply.’']);
 assert.equal(status(before,target(1,1,1),3),'unverified');
});
test('without an enacting formula, or with a quotation opened inside the enacting terms, nothing is certified',()=>{
 const rows=['Article 1\nScope','1.\tIt applies.','Sanctions apply.'];
 assert.equal(status(make(rows),target(1,1,1),2),'unverified','no enacting formula');
 assert.equal(status(make(['HAVE ADOPTED THIS REGULATION:',...rows]),target(1,1,1),3),'verified');
 assert.equal(status(make(['HAVE ADOPTED THIS REGULATION: ‘','Article 1\nScope','1.\tIt applies.','Sanctions apply.’']),target(1,1,1),3),'unverified');
});
test('one closing mark cannot satisfy two openings, and a quoted heading is never a defined term',()=>{
 for(const row of ['1.\tThe following Chapter is substituted: ‘Article 2\nDefinition of ‘operator’','1.\tThe following Chapter is substituted: ‘Article 2\nWorkers’ rights']){
  const proposal=make(['HAVE ADOPTED THIS REGULATION:','Article 1','1.\tScope.','Article 2',row,'Article 3\nSanctions','1.\tMember States shall provide sanctions.','Sanctions shall be imposed.’']);
  assert.equal(status(proposal,target(3,1,1),7),'unverified',row);
 }
});
