import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProposal} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
import {makeAnnexIndentCase} from '../scripts/fixtures/bare-annex-indent-native.mjs';
function input(indent=null){
 const a=makeAnnexIndentCase(),buffers=a.nativeQuoted.proposalBuffers,items=buffers.map((b,index)=>({kind:index?'annex':'act',proposal:parseProposal(b,{language:'en',item:index?'annex':'act'})})),row=items[1].proposal.paragraphs[indent?6+indent:6];
 return {...a,items,proposal:items[1].proposal,buffers,wording:{language:'en',baseline:'commission-proposal',targetLabel:'Annex I – point 3 – '+(indent?'indent '+indent:'introductory part'),targetPath:{proposal:[],underlying:[],language:'en'},originalText:indent?'– '+row.text.slice(2):row.text,proposedText:indent?'– Changed native bullet.':'(3) Changed introduction:'}};
}
const place=a=>resolveProposalPlacement(a.items,a.wording,{nativeProposalInputs:a.buffers});
test('a sole bare annex permits exact replacements only in the independently numbered point and row',()=>{
 for(const indent of [null,1,6,7]){const a=input(indent),placement=place(a);assert.equal(placement.status,'placed',String(indent));assert.deepEqual(placement.span,{start:indent?6+indent:6,end:indent?6+indent:6});assert.equal(verifyPlacement({items:a.items,wording:a.wording,placement,nativeQuoted:a.nativeQuoted}).status,'verified');}
});
test('the old row, proposed marker and complete private native source proof remain required',()=>{
 for(const mutate of [a=>a.wording.originalText+=' changed',a=>a.wording.proposedText='Unlabelled text',a=>a.wording.targetLabel=a.wording.targetLabel.replace('indent 6','indent 5'),a=>a.wording.targetLabel=a.wording.targetLabel.replace('Annex I','Annex II'),a=>a.wording.targetLabel+='\nRegulation (EU) 2026/1',a=>a.wording.targetPath.underlying=[{raw:'Article 1'}],a=>a.wording.language='fr',a=>a.wording.baseline='present-text',a=>a.buffers[1]=Buffer.from('wrong bytes')]){const a=input(6);mutate(a);assert.notEqual(place(a).status,'placed',mutate.toString());}
 const a=input();a.wording.proposedText='(2) Wrong intro:';assert.notEqual(place(a).status,'placed');
 const missing=input();assert.notEqual(resolveProposalPlacement(missing.items,missing.wording).status,'placed');
});
