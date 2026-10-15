import test from 'node:test';
import assert from 'node:assert/strict';
import {filterCountry,matchesCountry} from './pocCountries.mjs';
test('Greece survives directory validation and both ISO and EU deep links select the same MEPs',()=>{
 const directory=[{countryCode:'GR'},{countryCode:'ES'}];
 for(const input of ['GR','EL']){
   const selected=filterCountry(input);
   assert.equal(selected,'EL');
   assert(directory.some(m=>matchesCountry(selected,m.countryCode)));
   assert.deepEqual(directory.filter(m=>matchesCountry(selected,m.countryCode)),[{countryCode:'GR'}]);
 }
 assert(matchesCountry('', 'GR'));assert(!matchesCountry('ES','GR'));
 assert.deepEqual([...new Set(['GR','EL','ES'].map(filterCountry))],['EL','ES']);
 assert.equal(filterCountry(null),'');assert.equal(filterCountry('ES'),'ES');
});
