import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAmendmentPlacement} from './document-context-model.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const original='Calls on the Commission and the Member States to develop a common definition to recognise and address discrimination across the Union;';
const source=paras=>({paragraphs:paras,structureStatus:'extracted',textLanguage:'en',paragraphSources:paras.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:paras.map(()=>({styleId:'Normal',numberingComplete:true,notesComplete:true}))});
const wording={originalText:original,proposedText:'Changed;',targetLabel:'Paragraph 1',language:'en',baseline:'motion-resolution'};
test('resolution accepts unique small damage and replaced endings with independent verification',()=>{
 for(const value of [original.replace('Commission','Commissio'),original.slice(0,100)+' a different ending;']) {
  const text=source(['The European Parliament,','1. '+value,'2. An unrelated provision;']);
  const result=resolveAmendmentPlacement(text,wording);
  assert.equal(result.status,'placed',result.reason);assert.deepEqual(result.span,{start:1,end:1});
  assert.equal(verifyPlacement({placement:result,wording,text}).status,'verified');
 }
});
test('resolution near matches preserve completeness and competing-match guards',()=>{
 const text=source(['The European Parliament,','1. '+original.replace('Commission','Commissio'),'2. '+original]);
 assert.equal(resolveAmendmentPlacement(text,wording).status,'unresolved');
 text.paragraphs[2]='2. Unrelated;';text.paragraphSources[1].complete=false;
 assert.equal(resolveAmendmentPlacement(text,wording).status,'unresolved');
});
