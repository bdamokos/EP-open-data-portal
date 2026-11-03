import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {resolveAmendmentPlacement} from './document-context-model.mjs';
const example=JSON.parse(readFileSync(new URL('./fixtures/resolution-detached-note-near-match.json',import.meta.url)));
test('A-10-2025-0261 AM1 cannot bypass failed detached-note validation through a near match',()=>{
 const placement=resolveAmendmentPlacement(example.text,example.wording);
 assert.equal(placement.status,'unresolved');assert.equal(placement.reason,'conflicting_target_evidence');
});
