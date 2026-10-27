import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseTargetLabel,parseLabelSegment,unitLabel} from './proposal-labels.mjs';
import {placementReference} from './document-context-model.mjs';
const {examples}=JSON.parse(readFileSync(new URL('./fixtures/amendment-label-grammar.json',import.meta.url)));
for(const example of examples)test(`published ${example.language} label: ${example.id}`,()=>{
  const {label,language,expected}=example;
  if(example.grammar==='resolution') {
    const ref=placementReference(label,language);
    assert(ref,label);assert.equal(ref.kind,expected.kind);assert.equal(ref.label,expected.value);
  } else {
    const target=parseTargetLabel(label,language);
    assert(target.complete,JSON.stringify(target));
    assert.equal(target.segments.at(-1).kind,expected.kind);
    assert.equal(target.segments.at(-1).value,expected.value);
  }
});
test('Hungarian and Latvian negative point labels retain the sign through terminal-dot display',()=>{
  // Negative point addresses occur in the corpus (AM1/AM40/AM13); both
  // languages' existing display grammar appends a dot to the same address.
  for(const language of ['hu','lv'])for(const value of ['-a','-1']) {
    const label={kind:'point',value,number:value==='-1'?1:null,suffix:'',isNew:true,negative:true};
    const parsed=parseLabelSegment(unitLabel(label,language),language);
    assert.equal(parsed.value,value);assert.equal(parsed.negative,true);
  }
});
test('a numeric recital label alone never selects an operative paragraph',()=>{
  const cs=examples.find(example=>example.id==='A-10-2026-0254-AM-2');
  assert.equal(placementReference(cs.label,'cs','(2a)\tJe třeba se poučit').kind,'recital');
  // B-10-2026-0423 AM2 prints the operative number despite its "Recital" label.
  assert.equal(placementReference('Recital 6 b (new)','en','6b.\tExpresses concern').kind,'paragraph');
});
