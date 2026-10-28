import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {proposalNumber,parseLabelSegment,parseTargetLabel,unitLabel} from './proposal-labels.mjs';
import {parseProposal,proposalCandidates} from './proposal-structure.mjs';
import {resolveProposalPlacement} from './proposal-placement.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/greek-serial-points.json',import.meta.url)));

test('DGT three-letter Greek serials are whole labels, preserving script and language',()=>{
  for(const value of fixture.guidance.labels) {
    const number=proposalNumber(value,'el');assert.equal(number.value,value);assert.equal(number.suffix,'');assert.equal(number.number,null);assert.equal(number.base,undefined);
    const label=parseLabelSegment('σημείο '+value,'el');assert.equal(label.value,value);
    assert.equal(parseLabelSegment(unitLabel(label,'el'),'el').value,value);
    assert.equal(parseTargetLabel('Άρθρο 1 – παράγραφος 1 – σημείο '+value,'el').complete,true);
    assert.equal(proposalNumber(value,'en'),null);
  }
  for(const value of ['αβγ','ιστx','ist','ιςτ','ι στ'])assert.equal(proposalNumber(value,'el'),null,value);
});

test('Regulation 1217/2010 point ιστ has its own source extent and replacement target',()=>{
  const paragraphs=fixture.source.paragraphs;
  const proposal=parseProposal({paragraphs,structureStatus:'extracted',sourceUrl:fixture.source.url,coverage:{complete:false},paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map(()=>({styleId:'Normal',numberingComplete:true,notesComplete:true}))},{language:'el'});
  const target='Άρθρο 1 – παράγραφος 1 – σημείο ιστ',candidate=proposalCandidates(proposal,target,{language:'el'});
  assert.equal(candidate.length,1);assert.deepEqual(candidate[0].extent,{start:3,end:4});
  const previous=proposalCandidates(proposal,'Άρθρο 1 – παράγραφος 1 – σημείο ιε',{language:'el'})[0];
  assert.equal(previous.extent.end,3,'the previous point cannot absorb ιστ');
  const placed=resolveProposalPlacement([{kind:'act',index:1,proposal}],{language:'el',targetLabel:target,originalText:paragraphs[3],proposedText:paragraphs[3]+' Νέα διατύπωση.'});
  assert.equal(placed.status,'placed',placed.reason);assert.equal(placed.originalText,paragraphs[3]);assert.deepEqual(placed.span,{start:3,end:3});
  assert.notEqual(proposalCandidates(proposal,'Άρθρο 1 – παράγραφος 1 – σημείο p',{language:'el'})[0],candidate[0],'no cross-language identifier alias');
});
