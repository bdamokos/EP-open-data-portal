import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseProposal,proposalCandidates} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/proposal-subparagraph-points.json',import.meta.url)));
for(const fixture of fixtures)test(`official first-subparagraph point boundary: ${fixture.documentId}`,()=>{
 const proposal=parseProposal(fixture),items=[{kind:'act',index:1,proposal}],article=fixture.documentId.endsWith('0069')?'3':'2';
 const parent=proposalCandidates(proposal,`Article ${article} – paragraph 1`)[0];
 const last=parent.children.filter(c=>c.kind==='point').at(-1),continuation=parent.children.find(c=>c.kind==='subparagraph');
 assert.equal(last.extent.end,continuation.extent.start,'outdented sentence belongs to the paragraph');
 for(const point of parent.children.filter(c=>c.kind==='point')){
  const wording={language:'en',baseline:'commission-proposal',targetLabel:`Article ${article} – paragraph 1 – subparagraph 1 – point ${point.label.value}`,originalText:proposal.paragraphs[point.extent.start].text,proposedText:'New wording.'};
  const result=resolveProposalPlacement(items,wording);assert.equal(result.status,'placed',result.reason);assert.equal(verifyPlacement({placement:result,wording,items}).status,'verified');
 }
 for(const value of ['a',last.label.value]){
  const wording={language:'en',baseline:'commission-proposal',targetLabel:`Article ${article} – paragraph 1 – subparagraph 1 – point ${value} a (new)`,originalText:'',proposedText:'New point.'};
  const result=resolveProposalPlacement(items,wording);assert.equal(result.status,'placed',result.reason);
  assert.equal(verifyPlacement({placement:result,wording,items}).status,'verified');
  if(value===last.label.value)assert.equal(result.insertBefore,continuation.extent.start);
  assert.equal(verifyPlacement({placement:{...result,insertAfter:result.insertAfter+1,insertBefore:result.insertBefore+1},wording,items}).status,'failed');
  assert.equal(resolveProposalPlacement(items,{...wording,targetLabel:wording.targetLabel.replace('subparagraph 1','subparagraph 2')}).status,'unresolved');
 }
});
