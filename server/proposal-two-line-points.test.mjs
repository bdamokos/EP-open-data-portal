import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseProposal} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/proposal-two-line-points.json',import.meta.url)));
const resolve=(a,projection=fixture.proposal)=>resolveProposalPlacement([{kind:'act',proposal:parseProposal(projection,{language:'en'})}],a);
test('AI Act AM113 and AM114 use both target lines and the native e/f boundary',()=>{
  for(const a of fixture.amendments){
    const placed=resolve(a);
    assert.equal(placed.status,'placed');
    assert(fixture.proposal.paragraphs[placed.insertAfter].startsWith('(e)'));
    assert(fixture.proposal.paragraphs[placed.insertBefore].startsWith('(f)'));
    assert.equal(placed.evidence.find(e=>e.basis==='two-line-act-target').label,'Regulation (EU) 2024/1689');
  }
});
test('missing or conflicting act/article/paragraph evidence cannot select the boundary',()=>{
  for(const change of [a=>{a.targetPath.underlying=[];},a=>{a.targetPath.underlying[0].document='Regulation (EU) 2023/956';},a=>{a.targetPath.underlying[0].raw=a.targetPath.underlying[0].raw.replace('Article 4 a','Article 2');},a=>{a.targetPath.underlying[0].raw=a.targetPath.underlying[0].raw.replace('paragraph 1','paragraph 2');}]){
    const a=structuredClone(fixture.amendments[0]);change(a);assert.equal(resolve(a).status,'unresolved');
  }
});
test('the same amendment must print its own proposed point label',()=>{
  const a=structuredClone(fixture.amendments[0]);a.proposedText=fixture.amendments[1].proposedText;
  assert.equal(resolve(a).reason,'conflicting_target_evidence');
});
test('the native list and source completeness are required',()=>{
  for(const mutate of [p=>{const i=p.paragraphs.findIndex(t=>t.startsWith('(f)'));p.paragraphSources[i].complete=false;},p=>{const i=p.paragraphs.findIndex(t=>t.startsWith('(d)'));p.paragraphs[i]=p.paragraphs[i].replace('(d)','(e)');}]){
    const p=structuredClone(fixture.proposal);mutate(p);assert.equal(resolve(fixture.amendments[0],p).status,'unresolved');
  }
});
