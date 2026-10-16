import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {speechSpeakers,speakerNameIsSpecific,speakerIsChair} from './speech-speakers.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/chair-headers-20261015.json',import.meta.url)));

test('public English fragments retain German chair headers and distinguish the Council speaker',()=>{
  const [chair,introduction,council]=fixture.examples.map(({activity,headerXml})=>speechSpeakers(activity,headerXml)[0]);
  assert.equal(chair.id,'96756');assert.equal(chair.name,'Die Präsidentin');assert.equal(chair.role,'Chairing the sitting');
  assert.equal(introduction.role,'Chairing the sitting');
  assert.equal(council.id,'275105');assert.equal(council.role,'President-in-Office of the Council');
  assert.equal(speakerIsChair(council.name),false);
});
test('chair aliases are exact header labels, not personal names, offices or body salutations',()=>{
  for(const name of ['President','The Chair','Die Präsidentin','La présidente','El Presidente','Az elnök','De voorzitter']) {
    assert(speakerIsChair(name),name);assert.equal(speakerNameIsSpecific(name),false,name);
  }
  for(const name of ['Roberta Metsola','Katarina Barley','Executive Vice-President','President-in-Office of the Council'])assert.equal(speakerIsChair(name),false,name);
  const {activity,headerXml}=fixture.examples[2];
  assert.equal(speechSpeakers(activity,headerXml.replace('</speech>','<p>Madam President, thank you.</p></speech>'))[0].role,'President-in-Office of the Council');
  assert.deepEqual(speechSpeakers({...activity,had_participation:{had_participant_person:['person/96756']}},headerXml),[]);
});
