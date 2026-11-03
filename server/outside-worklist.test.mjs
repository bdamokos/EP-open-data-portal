import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './fixtures/outside-speaker-worklist.json' with {type:'json'};
import {matchOutsideName} from './outside-speaker-country.mjs';
test('the 19 public worklist observations replay the approved unique-human rule',()=>{
 assert.equal(fixture.cases.length,19);
 for(const c of fixture.cases){
  assert.match(c.epSource,/^https:\/\/www\.europarl\.europa\.eu\//);
  assert.notEqual(c.record.status,'unavailable',c.name);
  assert(c.record.sources.every(s=>s.url.startsWith('https://')&&s.fetchedAt));
  const actual=matchOutsideName({date:c.date,header:{name:c.name}},c.record);
  assert.equal(actual.status,c.expected.status,c.name);assert.equal(actual.country||null,c.expected.country,c.name);assert.equal(actual.reason||actual.basis,c.expected.reason,c.name);
 }
 const byName=new Map(fixture.cases.map(c=>[c.name,c.expected]));
 for(const [name,country] of [['María Corina Machado','VEN'],['Sviatlana Tsikhanouskaya','BLR'],['Jens-Frederik Nielsen','GRL']])assert.equal(byName.get(name).country,country);
 for(const name of ['Palina Sharenda-Panasiuk','Andrzej Poczobut'])assert.equal(byName.get(name).reason,'not-politician-or-office-holder');
 for(const name of ['Abdullah II','Felipe VI','Mark Carney'])assert.equal(byName.get(name).status,'ambiguous');
});
