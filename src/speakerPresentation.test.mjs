import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {personNameVariants} from '../server/speaker-identity.mjs';
import {speakerPresentation,speakerTerm} from './speakerPresentation.mjs';
const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/speaker-names-20261017.json',import.meta.url)));
const [greek,bulgarian]=fixture.examples.map(({person})=>({id:person.identifier,name:[person.officialGivenName,person.officialFamilyName].join(' '),nameVariants:personNameVariants(person)}));

test('UI script chooses only supplied forms and falls back when no matching transcription exists',()=>{
  for(const language of ['en','hu','fr','ro','pt'])assert.equal(speakerPresentation(greek,language).name.text,'Geadis Geadi');
  assert.equal(speakerPresentation(greek,'el').name.text,'Γεάδης Γεάδη');
  assert.equal(speakerPresentation(bulgarian,'bg').name.text,'Кристиан Вигенин');
  assert.equal(speakerPresentation(bulgarian,'en').name.text,'Kristian Vigenin');
  assert.equal(speakerPresentation(greek,'bg').name.text,'Geadis Geadi','no generated Cyrillic transcription');
  const supplied={...greek,nameVariants:[...greek.nameVariants,{value:'Предоставено име',script:'Cyrl',language:'bg',source:'api:xmlFragment/from/person'}]};
  assert.equal(speakerPresentation(supplied,'bg').name.text,'Предоставено име');
  assert.equal(speakerPresentation(greek,'en').name.language,'','names have no inferred natural language');
});

test('verified office and sitting role stay separate, and untranslated placeholders never become personal names',()=>{
  for(const language of ['en','ro','bg','el','hu']) {
    const result=speakerPresentation({id:'58766',name:'Nicolae Ștefănuță',sittingRole:'chair',office:{code:'vice-president-parliament'}},language);
    assert.equal(result.name.text,'Nicolae Ștefănuță');
    assert.deepEqual(result.roles,[speakerTerm('vice-president-parliament',language),speakerTerm('chair',language)]);
    for(const name of ['Președinte','President','Πρόεδρος','Председател']) {
      const missing=speakerPresentation({id:'1',name},language);
      assert.equal(missing.nameUnavailable,true);assert.equal(missing.name.text,speakerTerm('chair',language).text);
      assert.deepEqual(missing.roles,[speakerTerm('name-unavailable',language)]);
    }
  }
});

test('speaker roles use supplied language variants or translated exact institutional labels, preserving detailed source roles',()=>{
  const person={id:'2',name:'Guest',roleLabels:{en:{text:'Member of the Commission',language:'en'}}};
  assert.deepEqual(speakerPresentation(person,'bg').roles,[speakerTerm('commissioner','bg')]);
  person.roleLabels.hu={text:'a Bizottság tagja',language:'hu'};
  assert.deepEqual(speakerPresentation(person,'hu').roles,[person.roleLabels.hu]);
  person.roleLabels.en={text:'Commissioner for a specific portfolio',language:'en'};
  assert.deepEqual(speakerPresentation(person,'ro').roles,[person.roleLabels.en]);
});

test('every supported UI language has the full bundled speaker label set',()=>{
  for(const language of 'bg es cs da de et el en fr ga hr it lv lt hu mt nl pl pt ro sk sl fi sv'.split(' '))for(const key of ['chair','president-parliament','vice-president-parliament','name-unavailable','commissioner','president-commission','vice-president-commission','council-presidency']) {
    const term=speakerTerm(key,language);assert.equal(term.language,language);assert(term.text.trim());
  }
});

test('exact structured group capacity replaces redundant translated role wording without hiding institutional roles',()=>{
  // Public speech MTG-PL-2026-10-08-OTH-2017098235211 has this mistranslated BG role beside exact ECR.
  const person={id:'256986',name:'Geadis Geadi',roleLabels:{en:{text:'on behalf of the Group',language:'en'},bg:{text:'от името на групата Verts/ALE',language:'bg'}}};
  const intervention={speaker:{id:'256986'},onBehalfOf:[{id:'ECR',uri:'org/ECR',label:'ECR',politicalGroup:true,source:'participation_in_name_of'}]};
  assert.deepEqual(speakerPresentation(person,'bg',{intervention}).roles,[],'the existing exact ECR badge supplies this capacity');
  assert.deepEqual(speakerPresentation(person,'en',{intervention}).roles,[],'do not repeat a translated group-capacity line');
  for(const text of ['on behalf of the  Group','  On behalf of\t the\nGroup  ','on behalf of the\u00a0Group']) {
    const spaced={...person,roleLabels:{...person.roleLabels,en:{text,language:'en'}}};
    assert.deepEqual(speakerPresentation(spaced,'en',{intervention}).roles,[],'source whitespace does not duplicate the structured group badge');
    assert.deepEqual(speakerPresentation(spaced,'bg',{intervention}).roles,[]);
  }
  for(const context of [undefined,{...intervention,speaker:{id:'1',name:person.name}},{...intervention,onBehalfOf:[]},{...intervention,onBehalfOf:[{...intervention.onBehalfOf[0],source:'unverified'}]}]) {
    assert.deepEqual(speakerPresentation(person,'bg',{intervention:context}).roles,[person.roleLabels.bg],'only the same exact speaker and structured source can replace the raw role');
  }
  const commissioner={...person,roleLabels:{en:{text:'Member of the Commission',language:'en'}}};
  assert.deepEqual(speakerPresentation(commissioner,'bg',{intervention}).roles,[speakerTerm('commissioner','bg')]);
  const unspecific={...person,roleLabels:{bg:person.roleLabels.bg}};
  assert.deepEqual(speakerPresentation(unspecific,'bg',{intervention}).roles,[person.roleLabels.bg],'unclassified role text is not silently discarded');
});
