import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {resolveProposalPlacement} from './proposal-placement.mjs';import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const {proposal,wording}=JSON.parse(readFileSync(new URL('./fixtures/proposal-ordinal-footnote.json',import.meta.url))),items=[{kind:'act',proposal}];
test('A0216 AM22 keeps ordinal th while matching its glued footnote 22',()=>{
 const placement=resolveProposalPlacement(items,wording);
 assert.equal(placement.status,'placed',placement.reason);assert.deepEqual(placement.span,{start:0,end:0});
 assert.equal(verifyPlacement({placement,items,wording}).status,'verified');
});
test('merged ordinal marker cannot hide an altered original or detached payload',()=>{
 for(const originalText of [wording.originalText.replace('28th22','28st22'),wording.originalText.replace('COM(2025) 30','COM(2025) 31')])assert.equal(resolveProposalPlacement(items,{...wording,originalText}).status,'unresolved');
 const moved={...proposal,anchors:proposal.anchors.map(a=>({...a,offset:a.offset+2}))};
 assert.equal(resolveProposalPlacement([{kind:'act',proposal:moved}],wording).status,'unresolved');
});
test('context placement preserves the established merged-ordinal note proof',async()=>{
 const {documentContextPlacement}=await import('./document-context-placement.mjs');
 const chosen={...wording,baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false},language:'en',targetLabelLanguage:'en'};
 const placement=documentContextPlacement({chosen,items,baseline:{language:'en'}});
 assert.equal(placement.status,'placed');assert.equal(placement.noteScope,undefined);assert.equal(verifyPlacement({placement,items,wording}).status,'verified');
});
