import test from 'node:test';
import assert from 'node:assert/strict';
import catalogue from './pocTerms.json' with {type:'json'};
import {interfaceTerm,compoundLanguage,summaryStage,voteScope} from './pocTerms.mjs';

test('the catalogue covers exactly the 24 UI languages with separate official and machine provenance',()=>{
  assert.equal(new Set(catalogue.languages).size,24);
  for(const [key,term] of Object.entries(catalogue.terms)) {
    assert.deepEqual(Object.keys(term.labels).sort(),[...catalogue.languages].sort(),key);
    assert(Object.values(term.labels).every(value=>typeof value==='string'&&value.trim()));
    if(['first-reading','second-reading'].includes(key)) {
      assert.equal(term.provenance,'official-published-labels');assert(term.conceptUri);assert(term.fetchedAt);
    } else {
      assert.equal(term.provenance,'machine-translation');assert.equal(term.sourceLanguage,'en');
      assert.equal(term.model,'gpt-6.1-sol');assert.equal(term.humanReviewed,false);
    }
  }
  assert.equal(catalogue.sources.parliamentaryContext.vote.conceptUri,'http://eurovoc.europa.eu/4762');
  assert.equal(catalogue.sources.parliamentaryContext.amendment.entryId,778614);
  for(const key of ['vote','amendment'])assert.equal(catalogue.terms[key].conceptUri,undefined,'context references do not turn adapted interface copy into published labels');
});

test('vote and amendment labels use the parliamentary sense rather than election ballots or generic changes',()=>{
  for(const [language,vote,amendment] of [
    ['de','Abstimmung','Änderungsantrag'],['da','Afstemning','Ændringsforslag'],
    ['lv','Balsošana','Grozījums'],['sv','Omröstning','Ändringsförslag'],
    ['fi','Äänestys','Tarkistus'],['sk','Hlasovanie','Pozmeňujúci návrh'],
    ['et','Hääletus','Muudatusettepanek'],
  ]) {
    assert.equal(interfaceTerm('vote',language).text,vote);
    assert.equal(interfaceTerm('amendment',language).text,amendment);
  }
});

test('terms follow the requested UI locale and retain an honest English fallback for unsupported languages',()=>{
  assert.deepEqual(interfaceTerm('first-reading','hu'),{text:'Első olvasat',language:'hu'});
  assert.deepEqual(interfaceTerm('first-reading','fr'),{text:'Première lecture',language:'fr'});
  assert.deepEqual(interfaceTerm('vote','hu-HU'),{text:'Szavazás',language:'hu'});
  assert.deepEqual(interfaceTerm('saved-question','fr'),{text:'Question enregistrée',language:'fr'});
  assert.deepEqual(interfaceTerm('saved-question','hu'),{text:'Mentett kérdés',language:'hu'});
  assert.deepEqual(interfaceTerm('final-text','hu'),{text:'Végleges szöveg',language:'hu'});
  for(const language of ['mul','und','xx',''])assert.deepEqual(interfaceTerm('final-text',language),{text:'Final text',language:'en'});
  assert.throws(()=>interfaceTerm('missing','hu'),RangeError);
});

test('localized UI terms do not invent a language for a compound source title or unrelated stage',()=>{
  assert.equal(compoundLanguage('fr','fr'),'fr');
  for(const source of ['en','mul','und','',null,undefined])assert.equal(compoundLanguage('fr',source),'');
  assert.deepEqual(summaryStage('first-reading','hu'),{text:'Első olvasat',language:'hu'});
  assert.deepEqual(summaryStage('final-act','hu'),{text:'Final act',language:'en'});
  assert.deepEqual(voteScope('amendment','fr'),{text:'Amendement',language:'fr'});
  assert.deepEqual(voteScope('unclassified','hu'),{text:'Szavazás',language:'hu'});
  assert.deepEqual(voteScope('procedural','fr'),{text:'Procedural vote',language:'en'});
  assert.deepEqual(voteScope('unknown-source-code','hu'),{text:'unknown-source-code',language:''});
});
