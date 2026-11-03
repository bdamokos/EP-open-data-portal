import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {documentContextPlacement} from './document-context-placement.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/resolution-numbering-drift.json',import.meta.url)));
const source=()=>({paragraphs:[...fixture.paragraphs],structureStatus:'extracted',textLanguage:'en',paragraphSources:fixture.paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})),paragraphProperties:fixture.paragraphs.map(()=>({styleId:'Normal',numberingComplete:true,notesComplete:true}))});
const place=(text=source(),wording=fixture.wording,votes=fixture.voteReferences)=>documentContextPlacement({text,chosen:{...wording,targetLabelLanguage:'en'},referenceTexts:votes,resolutionDocument:true});
test('native paragraph 4 label yields to unique original paragraph 5 plus agreeing vote',()=>{
  for(const proposedText of [fixture.wording.proposedText,'deleted']){
    const text=source(),wording={...fixture.wording,proposedText},placement=place(text,wording);
    assert.equal(placement.status,'placed',placement.reason);assert.deepEqual(placement.span,{start:3,end:3});
    assert.equal(verifyPlacement({text,wording,placement,voteReferences:fixture.voteReferences}).status,'verified');
  }
});
test('drift allows small native transcription damage but needs all vote references to agree',()=>{
  const text=source();text.paragraphs[3]=text.paragraphs[3].replace('progress already','progress alread');
  assert.equal(place(text).status,'placed');
  for(const votes of [[],['§ 4'],['§ 6'],['§ 5','§ 4'],['After § 5']])assert.equal(place(source(),fixture.wording,votes).status,'unresolved');
  assert.equal(place(source(),{...fixture.wording,targetLabel:'Paragraph 3'}).status,'unresolved');
});
test('drift preserves complete, unique whole-unit original and detached-note guards',()=>{
  for(const incomplete of [false,true]){
    const text=source();text.paragraphs.push('7. '+fixture.wording.originalText,'8. End;');
    for(let i=5;i<7;i++){text.paragraphSources.push({path:'body/p'+i,ordinal:i,container:'body',containerPath:'body',segment:0,complete:!(incomplete&&i===5)});text.paragraphProperties.push({styleId:'Normal',numberingComplete:true,notesComplete:true});}
    assert.equal(place(text).status,'unresolved');
  }
  const text=source();text.paragraphSources[3].complete=false;assert.equal(place(text).status,'unresolved');
  assert.equal(place(source(),{...fixture.wording,originalText:fixture.wording.originalText+'\n________\n1 Different note'}).status,'unresolved');
  assert.equal(place(source(),{...fixture.wording,originalText:fixture.wording.originalText.slice(0,400)+' Changed ending;'}).status,'unresolved');
});
test('label priority remains when the original matches the label and vote disagrees',()=>{
  const text=source(),wording={...fixture.wording,originalText:text.paragraphs[2].replace(/^4\.\s*/u,'')};
  const placement=place(text,wording);assert.equal(placement.status,'placed',placement.reason);assert.deepEqual(placement.span,{start:2,end:2});assert.ok(placement.finalPlacementCheck);
});
