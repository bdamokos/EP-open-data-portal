import test from 'node:test';import assert from 'node:assert/strict';
import {word,p,heading} from './test-support/nle-native-fixture.mjs';
import {nativeGuidelineAnnex} from './proposal-guideline-annex.mjs';
import {parseProposal,proposalCandidates} from './proposal-structure.mjs';
import {documentContextPlacement} from './document-context-placement.mjs';
const annex=word(p('Guideline 5: Demand')+p('First body.')+p('Second body.')+p('Guideline 6: Supply')+p('Third body.'));
const act=word(heading()+p('Article 1','Titrearticle')+p('The Guidelines, as set out in the Annex, are hereby adopted.'));
test('native sole guideline annex binds the act reference without inventing an ordinal',()=>{
 const proof=nativeGuidelineAnnex(act,annex);assert.equal(proof?.ordinal,null);assert.equal(proof?.paragraphs,3);
 assert.equal(nativeGuidelineAnnex(word(p('Memorandum')+p('The Guidelines, as set out in the Annex, are hereby adopted.')),annex),null);
 assert.equal(nativeGuidelineAnnex(act,word(p('Guideline 5: Demand')+p('First body.')+p('Guideline 7: Supply')+p('Third body.'))),null);
});
test('guideline paragraphs stay addressable across headings under a bare annex',()=>{
 const proposal=parseProposal(annex,{item:'annex'});assert.equal(proposalCandidates(proposal,'Annex – paragraph 3').length,1);
 const headings=proposalCandidates(proposal,'Annex – subheading 1');assert.equal(headings.length,1);assert.equal(headings[0].extent.start,0);
 const chosen={baseline:'commission-proposal',baselineSource:{category:'commission-proposal',conflicted:false},language:'en',targetLabelLanguage:'en',targetLabel:'Annex I – paragraph 3',originalText:'Third body.',proposedText:'Changed body.'};
 const proof=nativeGuidelineAnnex(act,annex),items=[{kind:'annex',proposal}];
 const baseline={evidence:[{kind:'native-procedure',status:'verified',procedure:'2027/0001(NLE)'},{kind:'native-nle-annex-part',legalPlacement:true,...proof}]};
 assert.equal(documentContextPlacement({chosen,items,baseline}).status,'placed');
 assert.equal(documentContextPlacement({chosen:{...chosen,targetLabel:'Annex I – subheading 2',originalText:'Guideline 5: Demand'},items,baseline}).status,'unresolved');
 assert.equal(documentContextPlacement({chosen,items,baseline:{evidence:[baseline.evidence[0],{kind:'native-nle-annex-part',legalPlacement:false,ordinal:null}]}}).reason,'proposal_annex_ordinal_unverified');
 assert.equal(documentContextPlacement({chosen:{...chosen,targetLabel:'Annex II – paragraph 3'},items,baseline}).status,'unresolved');
});
test('guideline layouts reject empty sections, ambiguous cover text and incomplete body objects',()=>{
 for(const bytes of [word(p('Guideline 5: Demand')+p('Guideline 6: Supply')+p('Third body.')),word(p('Unknown cover claim')+p('Guideline 5: Demand')+p('First body.')+p('Guideline 6: Supply')+p('Third body.')),word(p('Guideline 5: Demand')+p('First body.')+'<w:p><w:r><w:drawing/></w:r></w:p>'+p('Guideline 6: Supply')+p('Third body.'))])assert.equal(nativeGuidelineAnnex(act,bytes),null);
 assert.equal(nativeGuidelineAnnex(word(p('Article 1','Titrearticle')+p('The Guidelines, as set out in the Annex, are hereby adopted.')+p('Article 1','Titrearticle')),annex),null);
});
