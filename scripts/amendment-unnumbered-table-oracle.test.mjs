import test from 'node:test';import assert from 'node:assert/strict';
import {unnumberedTableAddress,assertUnnumberedTable} from './amendment-unnumbered-table-oracle.mjs';
const wording={language:'en',baseline:'commission-proposal',originalText:'',targetLabel:'Annex – table – Cereals (new)',proposedText:'Cereals\nCode\tDescription\n10\tWheat'};
test('only a new captioned table without a stated position has the end policy',()=>{
 assert(unnumberedTableAddress(wording));
 for(const targetLabel of ['Annex – table 2 – Cereals (new)','Annex – table – Cereals (new) after table 2','Annex I – table – Cereals (new)'])assert.equal(unnumberedTableAddress({...wording,targetLabel}),null);
 assert.equal(unnumberedTableAddress({...wording,originalText:'Existing table'}),null);
 assert.equal(assertUnnumberedTable({wording,placement:{operation:'insert'}}).status,'unverified');
});
