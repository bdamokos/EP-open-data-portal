import test from 'node:test';
import assert from 'node:assert/strict';
import {outsidePerson, outsideSpeech} from './outside-model.mjs';

const personId = '424242';
const fetchedAt = '2026-10-16T06:00:00.000Z';
const commissionRole = 'President of the Commission';
const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

function contribution({date = '2026-10-14', number = '1', start, originals = ['ENG'], fragments}) {
  const id = `MTG-PL-${date}-OTH-${number}`;
  const activity = {
    activity_id: id,
    activity_date: date,
    activity_start_date: start,
    activity_label: {en:'Public fixture debate', hu:'Nyilvános tesztvita', fr:'Débat public de test'},
    had_activity_type: 'https://data.europarl.europa.eu/def/ep-activities/PLENARY_DEBATE_SPEECH',
    had_participation: [{participation_role:'https://data.europarl.europa.eu/def/ep-roles/SPEAKER', had_participant_person:[`https://data.europarl.europa.eu/person/${personId}`]}],
    recorded_in_a_realization_of: [{
      identifier: `CRE-10-${date}-OTH-${number}`,
      originalLanguage: originals.map(value => `http://publications.europa.eu/resource/authority/language/${value}`),
      'api:xmlFragment': Object.fromEntries(fragments.map(({key, tag = key, name = 'Fixture Guest', role = commissionRole}) => [key,
        `<oralStatements><speech><from${tag == null ? '' : ` xml:lang="${escapeXml(tag)}"`}><person refersTo="epdata:person/${personId}">${escapeXml(name)}</person>${role == null ? '' : `<role>${escapeXml(role)}</role>`}</from><blockContainer>Public fixture speech.</blockContainer></speech></oralStatements>`
      ])),
    }],
  };
  const speech = outsideSpeech(activity, fetchedAt, `https://data.europarl.europa.eu/api/v2/speeches/${id}?language=mul&include-output=xml_fragment`);
  assert(speech);
  return {...speech, personId, header:speech.headers[0]};
}

for (const {tag, original, role} of [
  {tag:'en', original:'ENG', role:commissionRole},
  {tag:'hu', original:'HUN', role:'a Bizottság elnöke'},
  {tag:'fr', original:'FRA', role:'présidente de la Commission'},
]) {
  test(`aggregate role language retains the selected ${tag} original header`, () => {
    const alternative = tag === 'en' ? 'fr' : 'en';
    const row = contribution({originals:[original], fragments:[{key:alternative, name:'Other-language name'}, {key:tag, role, name:'Original-language name'}]});
    const person = outsidePerson([row], new Map(), alternative);
    assert.equal(row.header.languageTag, tag);
    assert.equal(row.header.original, true);
    assert.equal(person.name, 'Original-language name');
    assert.equal(person.role, role);
    assert.equal(person.roleLanguageTag, tag);
    assert.equal(person.language, alternative);
  });
}

test('English header fallback remains independent of the requested language', () => {
  const row = contribution({originals:['DEU'], fragments:[{key:'fr'}, {key:'en', name:'English fallback'}, {key:'hu'}]});
  const person = outsidePerson([row], new Map(), 'hu');
  assert.equal(row.header.original, false);
  assert.equal(person.name, 'English fallback');
  assert.equal(person.role, commissionRole);
  assert.equal(person.roleLanguageTag, 'en');
  assert.equal(person.language, 'hu');
});

test('first observed header remains selected when neither original nor English is available', () => {
  const row = contribution({originals:['DEU'], fragments:[{key:'fr', role:'présidente de la Commission'}, {key:'hu', role:'a Bizottság elnöke'}]});
  const person = outsidePerson([row], new Map(), 'hu');
  assert.equal(row.header.original, false);
  assert.equal(person.role, 'présidente de la Commission');
  assert.equal(person.roleLanguageTag, 'fr');
});

test('translated, mixed and unknown header tags retain their exact source spelling', () => {
  for (const tag of ['en-t-fr', 'mul', 'und', 'FR-ca']) {
    const row = contribution({originals:['FRA'], fragments:[{key:'hu', tag}, {key:'fr-t-en', role:'présidente de la Commission'}]});
    const before = structuredClone(row);
    const person = outsidePerson([row], new Map(), 'fr');
    assert.equal(row.header.observations[0].fragmentKey, 'hu');
    assert.equal(row.header.languageTag, tag);
    assert.equal(row.header.original, false);
    assert.equal(person.roleLanguageTag, tag);
    assert.deepEqual(row, before);
  }
});

test('a fragment key supplies the existing header language only when xml:lang is absent', () => {
  const row = contribution({originals:['HUN'], fragments:[{key:'hu', tag:null, role:'a Bizottság elnöke'}]});
  assert.equal(row.header.languageTag, 'hu');
  assert.equal(row.header.original, true);
  assert.equal(outsidePerson([row], new Map(), 'fr').roleLanguageTag, 'hu');
});

test('aggregate metadata follows the exact role row rather than a duplicate role, newer name or nameless header', () => {
  const older = contribution({date:'2026-10-12', fragments:[{key:'en', name:'Earlier Guest'}]});
  const selected = contribution({date:'2026-10-13', originals:['FRA'], fragments:[{key:'fr', name:'Role Guest'}]});
  const newestName = contribution({date:'2026-10-14', originals:['HUN'], fragments:[{key:'hu', name:'Newest Guest', role:'Prime Minister'}]});
  const nameless = contribution({date:'2026-10-15', originals:['HUN'], fragments:[{key:'hu'}]});
  nameless.header = {...nameless.header, name:null};
  const rows = [newestName, older, nameless, selected];
  const before = structuredClone(rows);
  const {roleLanguageTag, ...legacyPerson} = outsidePerson(rows, new Map(), 'hu');

  assert.equal(roleLanguageTag, 'fr');
  assert.deepEqual(legacyPerson, {
    id:personId, name:'Newest Guest', role:commissionRole, capacity:'commission', contributions:4,
    appearances:0, unlinkedContributions:4, sittingDays:4, first:'2026-10-12', last:'2026-10-15', terms:[10],
    days:['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map(date => ({date, contributions:1, itemIds:[], items:[], formal:false, legislative:false})),
    roleConflicts:[], roles:[commissionRole, 'Prime Minister'], language:'hu',
  });
  assert.deepEqual(rows, before);
});

test('missing selected role tags remain null despite another header with the identical role text', () => {
  const older = contribution({date:'2026-10-12', fragments:[{key:'en'}]});
  for (const tag of [undefined, null, '']) {
    const selected = contribution({date:'2026-10-13', originals:['FRA'], fragments:[{key:'fr'}]});
    if (tag === undefined) delete selected.header.languageTag;
    else selected.header.languageTag = tag;
    const person = outsidePerson([older, selected], new Map(), 'en');
    assert.equal(person.role, commissionRole);
    assert.equal(person.roleLanguageTag, null);
  }
});

test('a known header language does not label an absent aggregate role', () => {
  const row = contribution({originals:['HUN'], fragments:[{key:'hu', role:null}]});
  const person = outsidePerson([row], new Map(), 'fr');
  assert.equal(row.header.languageTag, 'hu');
  assert.equal(person.role, null);
  assert.equal(person.roleLanguageTag, null);
});

test('same-day start and identifier ordering still choose the exact role header', () => {
  const first = contribution({number:'1', start:'2026-10-14T09:00:00Z', originals:['HUN'], fragments:[{key:'hu'}]});
  const earlierId = contribution({number:'2', start:'2026-10-14T10:00:00Z', originals:['ENG'], fragments:[{key:'en'}]});
  const last = contribution({number:'3', start:'2026-10-14T10:00:00Z', originals:['FRA'], fragments:[{key:'fr'}]});
  const person = outsidePerson([last, first, earlierId], new Map(), 'hu');
  assert.equal(person.role, commissionRole);
  assert.equal(person.roleLanguageTag, 'fr');
  assert.equal(person.contributions, 3);
  assert.equal(person.sittingDays, 1);
});

test('capacity count ties retain their existing winner and its role language', () => {
  const commission = contribution({date:'2026-10-12', originals:['FRA'], fragments:[{key:'fr'}]});
  const council = contribution({date:'2026-10-13', originals:['HUN'], fragments:[{key:'hu', role:'a Tanács soros elnöke'}]});
  const person = outsidePerson([council, commission], new Map(), 'hu');
  assert.equal(person.capacity, 'commission');
  assert.equal(person.name, 'Fixture Guest');
  assert.equal(person.role, commissionRole);
  assert.equal(person.roleLanguageTag, 'fr');
});
