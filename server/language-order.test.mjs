import test from 'node:test';
import assert from 'node:assert/strict';
import {languagePreference, amendmentLanguagePreference, LANGUAGE_FALLBACK_ORDER} from './language-order.mjs';

test('display preference puts the requested language first when available', () => {
  const available = ['bg', 'de', 'ga', 'fr', 'es', 'en', 'it'];
  assert.deepEqual(languagePreference(available, 'ga'), ['ga', 'en', 'fr', 'es', 'de', 'bg', 'it']);
  assert.deepEqual(available, ['bg', 'de', 'ga', 'fr', 'es', 'en', 'it']);
});
test('missing Irish falls back through English, French, Spanish, German, then ISO codes', () => {
  assert.deepEqual(languagePreference(['it', 'de', 'bg', 'es', 'fr', 'en'], 'ga'), ['en', 'fr', 'es', 'de', 'bg', 'it']);
  assert.deepEqual(languagePreference(['it', 'bg', 'de', 'es', 'fr'], 'ga'), ['fr', 'es', 'de', 'bg', 'it']);
  assert.deepEqual(languagePreference(['it', 'bg'], 'ga'), ['bg', 'it']);
});
test('empty and duplicate language lists stay bounded to available languages', () => {
  assert.deepEqual(languagePreference([], 'ga'), []);
  assert.deepEqual(languagePreference(['fr', 'fr', 'en', 'en'], 'fr'), ['fr', 'en']);
  assert.deepEqual(LANGUAGE_FALLBACK_ORDER, ['en', 'fr', 'es', 'de']);
});

test('shared amendment languages prefer requested, English, then ISO codes without original-language priority',()=>{
  assert.deepEqual(amendmentLanguagePreference(['fr','de','en','hu','de',null],'hu'),['hu','en','de','fr']);
  assert.deepEqual(amendmentLanguagePreference(['fr','de','es'],'ga',['fr']),['de','es','fr']);
});
