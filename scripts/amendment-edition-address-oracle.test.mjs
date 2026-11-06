import test from 'node:test';import assert from 'node:assert/strict';
import {verifyPlacement} from './amendment-benchmark-model.mjs';
import {resolutionBoundaryNative} from './fixtures/resolution-boundary-native.mjs';
test('the former numeric-point boundary cannot be verified',()=>{
 const input=resolutionBoundaryNative({point:true});
 assert.notEqual(verifyPlacement(input).status,'verified');
});
test('all other held addresses must agree and the boundary follows their existing point',()=>{
 const input=resolutionBoundaryNative({point:true,change:xml=>xml.replace('b)','l)')});
 input.wording.addressEditions=[{language:'en',baseline:'motion-resolution',targetLabel:'Paragraph 1 – point l a (new)'},{language:'bg',baseline:'motion-resolution',targetLabel:'Параграф 1 – буква л а (нова)'}];
 assert.equal(verifyPlacement(input).status,'failed');
 const correct={...input,placement:{...input.placement,insertAfter:4,insertBefore:5}};
 assert.equal(verifyPlacement(correct).status,'verified');
 input.wording.addressEditions[1].targetLabel='Параграф 1 – буква м а (нова)';
 assert.notEqual(verifyPlacement(correct).status,'verified');
});
test('alphabetic working labels cannot hide disagreement in other held editions',()=>{
 const input=resolutionBoundaryNative({point:true,change:xml=>xml.replace('b)','r)')});
 input.wording={...input.wording,targetLabel:'Paragraphe 1 – point r bis (nouveau)',proposedText:'r bis) New.',addressEditions:[{language:'en',baseline:'motion-resolution',targetLabel:'Paragraph 1 – point s a (new)'},{language:'bg',baseline:'motion-resolution',targetLabel:'Параграф 1 – буква т а (нова)'}]};
 input.placement={status:'placed',operation:'insert',insertAfter:4,insertBefore:5};
 assert.equal(verifyPlacement(input).reason,'oracle-edition-address-disagreement');
});
test('the reviewed position table covers other Bulgarian base and suffix letters',async()=>{
 const {editionAddress}=await import('./amendment-edition-address-oracle.mjs');
 for(const [bg,en] of [['Параграф 1 – буква с а (нова)','Paragraph 1 – point r a (new)'],['Параграф 1 – буква аб в (нова)','Paragraph 1 – point ab c (new)']]){
  const path=(targetLabel,language)=>editionAddress({targetLabel,language,baseline:'motion-resolution'}).map(p=>[p.kind,p.value,p.isNew]);
  assert.deepEqual(path(bg,'bg'),path(en,'en'));
 }
 assert.equal(editionAddress({targetLabel:'Параграф 1 – буква ы а (нова)',language:'bg',baseline:'motion-resolution'}),null);
});
test('underlying-act disagreement is checked in the addressed frame',async()=>{
 const {oracleEditionTarget}=await import('./amendment-edition-address-oracle.mjs');
 const wording={language:'en',baseline:'present-text',targetLabel:'Article 1 – point 5\nRegulation 1272/2008 — Article 30 – paragraph 1',addressEditions:[{language:'cs',baseline:'present-text',targetLabel:'Čl. 1 – bod 5\nNařízení 1272/2008 — Čl. 31 – odst. 1'}]};
 const input={wording,placement:{status:'placed',operation:'replace'}};
 assert.equal(oracleEditionTarget(input).assertion.status,'unverified');
 wording.baseline='commission-proposal';wording.addressEditions[0].baseline='commission-proposal';
 assert.equal(oracleEditionTarget(input),null,'the outer proposal address agrees; amended-act headings do not choose that frame');
});
test('a new quoted subparagraph requires agreement on its parent address',async()=>{
 const {oracleEditionTarget}=await import('./amendment-edition-address-oracle.mjs');
 const wording={language:'en',baseline:'commission-proposal',originalText:'',targetLabel:'Article 1 – paragraph 1 – point 1\nDirective 2003/87/EC — Article 10 a – paragraph 2 a – subparagraph 2 b (new)',addressEditions:[{language:'nl',baseline:'commission-proposal',targetLabel:'Artikel 1 – alinea 1 – punt 1\nRichtlijn 2003/87/EG — Artikel 10 bis – lid 2 – alinea 2 ter (nieuw)'}]};
 assert.equal(oracleEditionTarget({wording,placement:{status:'placed',operation:'insert'}}).assertion.status,'unverified');
 wording.addressEditions[0].targetLabel=wording.addressEditions[0].targetLabel.replace('lid 2 –','lid 2 bis –');
 assert.equal(oracleEditionTarget({wording,placement:{status:'placed',operation:'insert'}}),null);
});
