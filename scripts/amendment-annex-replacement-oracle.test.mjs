import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBareAnnexReplacement} from './amendment-annex-replacement-oracle.mjs';
import {makeAnnexIndentCase} from './fixtures/bare-annex-indent-native.mjs';
function input(indent=null){const a=makeAnnexIndentCase(),index=indent?6+indent:6,row=a.proposal.paragraphs[index];a.wording={language:'en',baseline:'commission-proposal',targetLabel:'Annex I – point 3 – '+(indent?'indent '+indent:'introductory part'),originalText:indent?'– '+row.text.slice(2):row.text,proposedText:indent?'– Changed native bullet.':'(3) Changed introduction:'};a.placement={status:'placed',operation:'replace',itemIndex:1,span:{start:index,end:index},splice:{start:{paragraph:index,offset:0},end:{paragraph:index,offset:row.text.length}}};return a;}
test('native bare-annex replacement independently proves the exact intro or indent row',()=>{
 for(const indent of [null,1,6,7]){const a=input(indent);for(const item of a.items)Object.defineProperty(item.proposal,'units',{get(){throw Error('runtime units forbidden');}});assert.equal(assertBareAnnexReplacement(a).status,'verified');assert.equal(assertBareAnnexReplacement({...a,placement:{...a.placement,span:{start:a.placement.span.start+1,end:a.placement.span.end+1}}}).status,'failed');}
});
test('alias, ordinal, full wording, both native identities and complete extents remain required',()=>{
 for(const mutate of [a=>a.wording.targetLabel=a.wording.targetLabel.replace('Annex I','Annex II'),a=>a.wording.targetLabel=a.wording.targetLabel.replace('indent 6','indent 5'),a=>a.wording.originalText+=' changed',a=>a.wording.proposedText='Unlabelled proposed text',a=>a.items.push({kind:'annex'}),a=>a.proposal.sourceHash='wrong',a=>a.nativeQuoted.proposalBuffers.pop(),a=>a.proposal.paragraphs[13].source.complete=false,a=>a.placement.splice.end.offset--]){const a=input(6);mutate(a);assert.notEqual(assertBareAnnexReplacement(a).status,'verified',mutate.toString());}
 const a=input();a.wording.originalText=a.wording.originalText.replace('(3)','(2)');assert.equal(assertBareAnnexReplacement(a).status,'unverified');
 for(const targetPath of [{underlying:[{raw:'Article 1'}]},{language:'fr'},{proposal:[{raw:'Annex II – point 3 – indent 6'}]},{proposal:[{raw:'Annex I'},{raw:'Annex II'}]}]){const a=input(6);a.wording.targetPath=targetPath;assert.equal(assertBareAnnexReplacement(a).status,'unverified');}
});
