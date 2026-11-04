import test from 'node:test';
import assert from 'node:assert/strict';
import {assertResolutionPointSimilarity} from './amendment-resolution-point-similarity-oracle.mjs';
const body='Support public authorities in managing water resources across borders, improving affordable access to safe water and sanitation for residents, and encouraging sustainable farming and responsible investment in effective local infrastructure.';
function input(){const paragraphs=['The European Parliament,','1. Recommends the following:','(n) '+body,'(o) Supports a separate programme for industrial pollution.','2. Next provision.','3. Closing provision.'];return {text:{textLanguage:'en',paragraphs,paragraphSources:paragraphs.map((_,ordinal)=>({ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphFormats:paragraphs.map((_,i)=>({indent:[2,3].includes(i)?360:0}))},wording:{language:'en',baseline:'motion-resolution',targetLabel:'Paragraph 1 – point n',originalText:'(n) '+body.replace('safe water','clean water'),proposedText:'(n) Revised wording.'},placement:{status:'placed',operation:'replace',span:{start:2,end:2}}};}
test('near wording needs the exact independent paragraph/point identity and complete extent',()=>{
 const a=input();assert.equal(assertResolutionPointSimilarity(a).status,'verified');
 for(const mutate of [a=>a.placement.span.start--,a=>a.placement.span.end++]){const a=input();mutate(a);assert.equal(assertResolutionPointSimilarity(a).status,'failed');}
 for(const mutate of [a=>a.wording.targetLabel='Paragraph 2 – point n',a=>a.text.paragraphSources[2].complete=false,a=>a.text.paragraphFormats[2].indent=0,a=>a.wording.originalText+='\n______\n1 Detached note.',a=>a.wording.proposedText='(m) Other point.']){const a=input();mutate(a);assert.equal(assertResolutionPointSimilarity(a).status,'unverified');}
});
test('equally similar complete and incomplete point competitors both prevent verification',()=>{
 for(const incomplete of [false,true]){const a=input();a.text.paragraphs[3]='(o) '+body.replace('safe water','clean water');a.text.paragraphSources[3].complete=!incomplete;assert.equal(assertResolutionPointSimilarity(a).status,'unverified');}
});

test('an incomplete similar point under another paragraph still competes',()=>{
 const a=input();a.text.paragraphs.splice(5,0,'(a) '+a.wording.originalText.slice(4));a.text.paragraphFormats.splice(5,0,{indent:360});a.text.paragraphSources=a.text.paragraphs.map((_,ordinal)=>({ordinal,container:'body',containerPath:'body',segment:0,complete:ordinal!==5}));assert.equal(assertResolutionPointSimilarity(a).status,'unverified');
});

test('a published decision comparison can verify the same exact point identity',()=>{
 const a=input();a.wording.baseline='unknown';
 a.wording.documentReferences=[{field:'DocAmend',raw:'Proposal for a decision'}];
 a.wording.baselineSource={headings:[{left:{raw:'Proposal for a decision'},right:{raw:'Amendment'}}]};
 assert.equal(assertResolutionPointSimilarity(a).status,'verified');
 a.wording.documentReferences=[];assert.equal(assertResolutionPointSimilarity(a).status,'unverified');
 a.wording.documentReferences=[{field:'DocAmend',raw:'Proposal for a decision'}];a.wording.baselineSource.headings[0].left.raw='Text proposed by the Commission';assert.equal(assertResolutionPointSimilarity(a).status,'unverified');
});
