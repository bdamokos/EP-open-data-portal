import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertResolutionNumberingDrift} from './amendment-numbering-drift-oracle.mjs';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/resolution-numbering-drift.json',import.meta.url)));
const make=()=>({paragraphs:[...fixture.paragraphs],textLanguage:'en',structureStatus:'extracted',paragraphSources:fixture.paragraphs.map((_,ordinal)=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true}))});
const placement={status:'placed',operation:'replace',span:{start:3,end:3}};
const verify=(text=make(),wording=fixture.wording,voteReferences=fixture.voteReferences,p=placement)=>verifyPlacement({placement:p,text,wording,voteReferences});
test('native one-step numbering drift needs independent original and agreeing public vote',()=>{
  assert.equal(verify().status,'verified');
  assert.equal(verify(make(),{...fixture.wording,baseline:'unknown'}).status,'verified');
  assert.notEqual(verify(make(),{...fixture.wording,baseline:'commission-proposal'}).status,'verified');
  assert.equal(verify(make(),{...fixture.wording,proposedText:'deleted'},fixture.voteReferences,{...placement,operation:'delete'}).status,'verified');
  const text=make();text.paragraphs[3]=text.paragraphs[3].replace('progress already','progress alread');
  assert.equal(verify(text).status,'verified');
});
test('forced off-label placement cannot use absent, conflicting, relative or distant votes',()=>{
  for(const votes of [[],['§ 4'],['§ 5','§ 4'],['After § 5'],['§ 5','somewhere']])assert.notEqual(verify(make(),fixture.wording,votes).status,'verified');
  assert.notEqual(verify(make(),{...fixture.wording,targetLabel:'Paragraph 3'}).status,'verified');
  assert.notEqual(verify(make(),{...fixture.wording,targetLabel:'Paragraph 4 a (new)'}).status,'verified');
});
test('drift requires the unique complete whole paragraph, including damaged competitors',()=>{
  for(const incomplete of [false,true]){
    const text=make();text.paragraphs.push('7. '+fixture.wording.originalText,'8. End;');
    for(let i=5;i<7;i++)text.paragraphSources.push({path:'body/p'+i,ordinal:i,container:'body',containerPath:'body',segment:0,complete:!(incomplete&&i===5)});
    assert.notEqual(verify(text).status,'verified');
  }
  const text=make();text.paragraphSources[3].complete=false;assert.notEqual(verify(text).status,'verified');
  assert.notEqual(verify(make(),fixture.wording,fixture.voteReferences,{...placement,span:{start:3,end:4}}).status,'verified');
  assert.notEqual(verify(make(),{...fixture.wording,originalText:fixture.wording.originalText+'\n________\n1 Different note'}).status,'verified');
});

test('unsupported published labels decline drift verification and retain ordinary address checks',()=>{
  const text=make(),wording={...fixture.wording,targetLabel:'Unparsed heading'};
  assert.equal(assertResolutionNumberingDrift({text,wording,placement,voteReferences:fixture.voteReferences}),null);
  assert.equal(verify(text,wording).reason,'oracle-address-span-mismatch');
});
