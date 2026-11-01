import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {documentContextPlacement} from './document-context-placement.mjs';
const cases=JSON.parse(readFileSync(new URL('../scripts/fixtures/amendment-rejection-oracle.json',import.meta.url)));
test('twenty attested whole-document rejection cells retain scope without paragraph coordinates',()=>{
  assert.equal(cases.length,20);
  for(const row of cases){
    const chosen={language:row.language,originalText:'',proposedText:row.text,targetLabel:'–'};
    const result=documentContextPlacement({chosen});
    assert.equal(result.status,'document-operation',row.id);assert.equal(result.operation,'reject');assert.equal(result.scope,row.scope);
    assert(!Object.hasOwn(result,'span'));assert(!Object.hasOwn(result,'insertAfter'));
  }
});
test('dash, unavailable wording and whole-text replacements do not establish rejection',()=>{
  const base={language:'en',originalText:'',proposedText:'The European Parliament rejects the Commission proposal.',targetLabel:'–'};
  for(const fields of [{proposedText:null},{originalText:null},{proposedText:'Replacement legal text.'},{originalText:'Existing provision.'},{gaps:[{code:'text-unavailable'}]},{language:'de'}])assert.notEqual(documentContextPlacement({chosen:{...base,...fields}}).status,'document-operation');
});
