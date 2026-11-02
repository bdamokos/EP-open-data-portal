import {test} from 'node:test';
import assert from 'node:assert/strict';
import {speechWordTokens,speechWordLanguages,speechWordsQuery} from './insights-speech-words.mjs';
import {speechCloudQuery,analyzeSpeechCloud} from './speech-cloud.mjs';
import {speechTexts} from './corpus-worker.mjs';

test('Maltese is accepted for member, sitting and week clouds and speech words',()=>{
  assert(speechWordLanguages.includes('mt'));
  for(const scope of ['member=1','sitting=MTG-PL-2026-10-08','week=2026-10-05'])
    assert.equal(speechCloudQuery(new URLSearchParams(scope+'&lang=mt')).language,'mt');
  assert.equal(speechWordsQuery(new URLSearchParams('member=1&lang=mt')).language,'mt');
});

test('Maltese letters and apostrophes survive while articles and particles are filtered',()=>{
  assert.deepEqual(speechWordTokens("Aħna u huma li kienu qed fil-ġnien għall-ħaddiema l-ambjent it-tibdil ta' dan ta’ dik b’ċertezza f'ilma",'mt'),
    ['ġnien','ħaddiema','ambjent','tibdil','ċertezza','ilma']);
  assert.deepEqual(speechWordTokens('Ċittadini Ġustizzja Ħarsien Żgħażagħ'.normalize('NFD'),'mt'),['ċittadini','ġustizzja','ħarsien','żgħażagħ']);
  assert.deepEqual(speechWordTokens("ta' ma’ taʼ min minn tiegħu tagħha tagħna tagħhom",'mt'),[]);
  assert.deepEqual(speechWordTokens("‘ambjent’ 'ambjent' ambjent ta’ ma’ x’jiġri",'mt'),['ambjent','ambjent','ambjent',"x'jiġri"]);
  assert.deepEqual(speechWordTokens("Sema’ x’qal is-sema. Qata’ l-ħabel.",'mt'),["sema'","x'qal","sema","qata'","ħabel"],'a lexical final apostrophe keeps distinct words apart');
  assert.deepEqual(speechWordTokens("‘Is-sema’ u ‘ix-xogħol tal-politika’ — imma sema’ biss.",'mt'),["sema","xogħol","politika","sema'"],'closing quotes, including after several words, are not lexical');
  assert.deepEqual(speechWordTokens("‘Qata’ l-ħabel’ u ‘Il-politika’, 'il ġnien sema’.",'mt'),["qata'","ħabel","politika","ġnien","sema'"],'a lexical apostrophe inside a quotation and a quotation opening on an article');
  const words=analyzeSpeechCloud([{id:'one',text:'L-ambjent u l-ambjent.'},{id:'two',text:'Fl-ambjent.'}],'mt');
  assert.equal(words.find(w=>w.word==='ambjent').speechCount,2);
  assert.equal(words.find(w=>w.word==='ambjent').occurrences,3);
});

test('retained speech ingestion keeps Maltese originals and marked machine translations',()=>{
  const activity={activity_id:'MTG-PL-2026-10-08-OTH-1',activity_date:'2026-10-08',recorded_in_a_realization_of:[{
    originalLanguage:['http://publications.europa.eu/resource/authority/language/MLT'],
    'api:xmlFragment':{mt:'<speech xml:lang="mt"><p>L-ambjent.</p></speech>'},
  }]};
  const read=()=>speechTexts(activity,'https://example.test/speeches','2026-11-02T08:00:00Z');
  assert.deepEqual(read().texts.map(t=>[t.language,t.translationType,t.body]),[['mt','original','L-ambjent.']]);
  activity.recorded_in_a_realization_of[0]['api:xmlFragment'].mt='<speech xml:lang="en-t-mt-mtec"><p>L-ambjent.</p></speech>';
  assert.equal(read().texts[0].translationType,'machine');
});
