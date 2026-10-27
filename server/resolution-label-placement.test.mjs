import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveAmendmentPlacement} from './document-context-model.mjs';
import {verifyPlacement} from '../scripts/amendment-benchmark-model.mjs';
const {examples}=JSON.parse(readFileSync(new URL('./fixtures/amendment-label-placement.json',import.meta.url)));
for(const example of examples)test(`official insertion boundary: ${example.id}`,()=>{
  const {text,wording,expected}=example,placement=resolveAmendmentPlacement(text,wording);
  assert.equal(placement.status,'placed',placement.reason);
  if(expected.span){assert.deepEqual(placement.span,expected.span);assert.equal(verifyPlacement({placement,wording,text}).status,'verified');return;}
  assert.equal(placement.insertAfter,expected.insertAfter);
  assert.equal(placement.insertBefore,expected.insertBefore);
  assert.equal(verifyPlacement({placement,wording,text}).status,'verified');
  const broken=structuredClone(text);
  broken.paragraphSources[expected.insertAfter].complete=false;
  assert.equal(resolveAmendmentPlacement(broken,wording).status,'unresolved');
  // Moving the result across the next sibling or heading must fail the raw-row oracle.
  assert.equal(verifyPlacement({placement:{...placement,insertAfter:expected.insertAfter+1,insertBefore:expected.insertBefore+1},wording,text}).status,'failed');
});
test('point insertion requires its exact published parent, including at a parent end',()=>{
  for(const id of ['A-10-2026-0085-AM-26','A-10-2026-0087-AM-42']) {
    const example=examples.find(example=>example.id===id);
    const wording={...example.wording,targetLabel:example.wording.targetLabel.replace(/^Paragraph \d+/,'Paragraph 999')};
    assert.equal(resolveAmendmentPlacement(example.text,wording).reason,'parent_target_not_found');
  }
});
