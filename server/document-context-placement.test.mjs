import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProposal} from './proposal-structure.mjs';
import {documentContextPlacement,proposalInstructionTarget} from './document-context-placement.mjs';

const source=(paragraphs,styles)=>({paragraphs,structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paragraphs.map((_,i)=>({styleId:styles[i]}))});
const proposalItems=[{kind:'act',index:1,proposal:parseProposal(source(
  ['Article 1','Regulation (EU) 2024/1689 is amended as follows:','(5)\tin Article 5, point (a) is replaced:','‘(a) text;’;','(6)\tin Article 6(4), paragraph 4 is replaced by the following:','Article 2','Entry into force.'],
  ['Titrearticle','','Point0','','Point0','Titrearticle','']))}];
// A-10-2026-0073 AM34: the comparison quotes Article 6(1) of the AI Act as
// present text, while the instruction itself is a new point 5b of Article 1.
const chosen={baseline:'present-text',baselineSource:{category:'present-text',conflicted:false},language:'en',targetLabelLanguage:'en',
  targetLabel:'Article 1 – paragraph 1 – point 5 b (new)',targetPath:{proposal:[],underlying:[{document:'Regulation (EU) 2024/1689',raw:'Article 6 – paragraph 1'}],language:'en'},
  originalText:'1. Irrespective of whether an AI system is placed on the market;',proposedText:'(5b)\tArticle 6(1) is amended as follows:\n"1.\tIrrespective of whether an AI system is placed on the market;"',documentReferences:[]};
const unavailable={status:'unresolved',gaps:['existing-law-source-not-in-snapshot']};

test('a new amending instruction is placed in the proposal when the consolidated law cannot place it',()=>{
  const placed=documentContextPlacement({chosen,items:[],baseline:unavailable,proposalItems});
  assert.equal(placed.status,'placed');assert.equal(placed.frame,'commission-proposal');assert.equal(placed.operation,'insert');
  assert.equal(placed.insertAfter,3);assert.equal(placed.insertBefore,4);
  assert.deepEqual(placed.evidence[0],{basis:'proposal-instruction-frame',label:'Article 1 – paragraph 1 – point 5 b (new)'});
  const gap=documentContextPlacement({chosen,items:[],baseline:unavailable});
  assert.equal(gap.status,'unresolved','without the proposal the gap remains');assert.equal(gap.frame,undefined);
  assert.equal(documentContextPlacement({chosen,proposalItems}).frame,'commission-proposal');
});

test('the proposal frame needs a new outer instruction printed with its own number',()=>{
  const at=(changes)=>proposalInstructionTarget({...chosen,...changes});
  assert.equal(at({}).raw,'Article 1 – paragraph 1 – point 5 b (new)');
  assert.equal(at({proposedText:'(-1)\tin Article 10a, paragraph 1 is replaced:',targetLabel:'Article 1 – paragraph 1 – point -1'}).label.value,'-1');
  assert.equal(at({proposedText:'Article 1 a (new)\nIn Article 1, paragraph 5a is replaced:',targetLabel:'Article 1 a (new)'}).label.value,'1a');
  // The complete printed number must match: '1 bis' is not '1 bis bis'.
  const french={language:'fr',targetLabelLanguage:'fr',targetPath:{...chosen.targetPath,language:'fr'},targetLabel:'Article 1 bis (nouveau)'};
  assert(at({...french,proposedText:'Article 1 bis (nouveau)\nÀ l’article 1, le paragraphe 5 bis est remplacé:'}));
  assert(at({...french,proposedText:'Article 1 bis\nLe texte suivant est inséré:'}),'a line break ends the printed number');
  assert.equal(at({...french,proposedText:'Article 1 bis bis (nouveau)\nÀ l’article 1:'}),null);
  assert.equal(at({proposedText:'Article 1 ab (new)\nIn Article 1:',targetLabel:'Article 1 a (new)'}),null);
  assert.equal(at({proposedText:'Article 12 (new)\nIn Article 1:',targetLabel:'Article 1 a (new)'}),null);
  for(const changes of [
    {proposedText:'(5c)\tArticle 6(1) is amended as follows:'},
    {proposedText:'Article 6(1) is amended as follows:'},
    {targetLabel:'Article 1 – paragraph 1 – point 5'},
    {targetLabel:'Regulation (EU) 2024/1689 — Article 6 – paragraph 1'},
    {targetLabel:'Artykuł 1 – akapit 1 – punkt 6 a – litera a (nowa)',language:'pl',targetLabelLanguage:'pl',proposedText:'6a)\tw art. 11 wprowadza się następujące zmiany:'},
    {baseline:'commission-proposal'},
    {targetPath:{...chosen.targetPath,language:'fr'}},
    // Nested points inside an existing instruction stay withheld (A-10-2026-0104 AM104).
    {targetLabel:'Article 2 – paragraph 1 – point 2 – point -a (new)',proposedText:'(-a)\tparagraph 1 is replaced by the following'},
    {targetLabel:'Article 1 – paragraph 1 – point 5 – point b a (new)',proposedText:'(ba)\tin point (b), the following is added:'},
    {targetLabel:'Article 1 – point 5 b (new)'},
    {targetLabel:'Article 1 – paragraph 1 a (new)',proposedText:'1a.\tNew paragraph.'},
  ])assert.equal(at(changes),null,JSON.stringify(changes));
  assert.equal(documentContextPlacement({chosen:{...chosen,proposedText:'(5c)\tArticle 6(1) is amended as follows:'},items:[],baseline:unavailable,proposalItems}).status,'unresolved');
});
