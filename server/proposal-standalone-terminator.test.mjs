import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseProposal,proposalCandidates} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/proposal-standalone-terminator.json',import.meta.url)));
test('A0104 AM76–79 follow the standalone semicolon that terminates point b',()=>{
 const proposal=parseProposal(fixture),items=[{kind:'act',index:1,proposal}],semicolon=fixture.paragraphSources.findIndex(source=>source.path.endsWith('/w:p[307]'));
 assert.equal(proposal.paragraphs[semicolon].text,';');assert.match(proposal.paragraphs[semicolon+1].text,/^\(10\)/u);
 const point=proposalCandidates(proposal,'Article 3 – paragraph 1 – point 9 – point b')[0];assert.equal(point.extent.end,semicolon+1);
 for(const suffix of ['a','b','c','d']){
  const result=resolveProposalPlacement(items,{language:'en',targetLabel:`Article 3 – paragraph 1 – point 9 – point b ${suffix} (new)`,originalText:'',proposedText:'New point.'});
  assert.equal(result.status,'placed',result.reason);assert.equal(result.insertAfter,semicolon);assert.equal(result.insertBefore,semicolon+1);
 }
});
