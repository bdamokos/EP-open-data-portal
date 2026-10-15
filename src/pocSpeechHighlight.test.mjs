import test from 'node:test';
import assert from 'node:assert/strict';
import {speechHighlightParts} from './pocSpeechHighlight.mjs';

const matches=(text,term)=>speechHighlightParts(text,term).filter(part=>part.match).map(part=>part.text);
test('selected words match whole words without changing the transcript',()=>{
  const text='Islands, islanders and islands. These islands matter.';
  assert.deepEqual(matches(text,'islands'),['Islands','islands','islands']);
  assert.equal(speechHighlightParts(text,'islands').map(part=>part.text).join(''),text);
});
test('selected phrases match case and whitespace variants as one highlight',()=>{
  assert.deepEqual(matches('The DIGITAL SERVICES\nAct and Digital Services Act apply.','Digital Services Act'),['DIGITAL SERVICES\nAct','Digital Services Act']);
  assert.deepEqual(matches('digital services and another act','Digital Services Act'),[]);
});
test('Unicode letters and numbers prevent partial-word matches',()=>{
  assert.deepEqual(matches('EU éEU EU2 EU-China (EU)','EU'),['EU','EU','EU']);
  assert.deepEqual(matches('νησιά νησιάδα ΝΗΣΙΆ','νησιά'),['νησιά','ΝΗΣΙΆ']);
});
test('canonical accents and compatibility forms retain their original text',()=>{
  const text='K\u006f\u0308ze\u0301p-Europe and ﬁshing.';
  assert.deepEqual(matches(text,'Közép'),['Ko\u0308ze\u0301p']);
  assert.deepEqual(matches(text,'fishing'),['ﬁshing']);
  assert.equal(speechHighlightParts(text,'fishing').map(part=>part.text).join(''),text);
});
test('punctuation is literal rather than a regular expression',()=>{
  assert.deepEqual(matches('C++ and C++17; a.b and axb.','C++'),['C++']);
  assert.deepEqual(matches('a.b and axb.','a.b'),['a.b']);
});
test('missing terms and markup-like source text remain plain text',()=>{
  const text='<img src=x onerror=alert(1)> islands';
  assert.deepEqual(speechHighlightParts(text,null),[{text,match:false}]);
  assert.equal(speechHighlightParts(text,'islands').map(part=>part.text).join(''),text);
  assert.deepEqual(matches(text,'islands'),['islands']);
  assert.deepEqual(speechHighlightParts('', 'islands'),[{text:'',match:false}]);
});
