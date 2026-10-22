import test from 'node:test';
import assert from 'node:assert/strict';
import {contributorOffice} from './speakerRoles.mjs';
import {legislationOffice,mergeSpeechSpeakers} from './legislationContributors.mjs';
const bg={text:'Член на Комисията',language:'bg'},en={text:'Member of the Commission',language:'en'},fr={text:'Membre de la Commission',language:'fr'};
const person={id:'220921',name:'Jessika Roswall',role:bg.text,roleLanguage:'bg',roleLabels:{bg,en,fr}};
const detail={speeches:[{sourceId:'s1',date:'2026-10-19',start:'2026-10-19T10:00:00Z',people:[{id:'220921'}]}]};
test('contributor uses supplied current-language labels, then English, never first-fragment Bulgarian',()=>{
  assert.deepEqual(contributorOffice(person,'en'),en);assert.deepEqual(contributorOffice(person,'fr'),fr);assert.deepEqual(contributorOffice(person,'bg'),bg);
  assert.deepEqual(contributorOffice(person,'hu'),en);
  assert.deepEqual(contributorOffice({...person,roleLabels:{bg}},'en'),{text:'Role translation unavailable',language:'en'});
  assert.deepEqual(contributorOffice({...person,roleLabels:{en:{...en,language:'bg'}}},'en'),{text:'Role translation unavailable',language:'en'});
});
test('callbacks preserve multilingual role/source/reuse evidence and remain idempotent',()=>{
  const reuse={speechId:'older',compared:[{language:'bg',current:bg.text,previous:bg.text}]},source={speechId:'s1',url:'https://data.europarl.europa.eu/api/v2/speeches/s1',fetchedAt:'2026-10-22T10:00:00Z'};
  const record={id:'s1',people:[{...person,roleSource:source,roleLabels:{bg,en:{...en,reuse}}}]};
  const headers=mergeSpeechSpeakers({},[record]);
  assert.deepEqual(headers.s1['220921'].roleLabels.en.reuse,reuse);assert.deepEqual(headers.s1['220921'].roleSource,source);
  assert.strictEqual(mergeSpeechSpeakers(headers,[record]),headers);
  assert.equal(legislationOffice(detail,headers,'220921','en').text,en.text);
  assert.equal(legislationOffice(detail,headers,'999','en'),null);
});
test('latest current-item evidence controls the office regardless of callback arrival order',()=>{
  const d={speeches:[...detail.speeches,{sourceId:'s2',date:'2026-10-20',start:null,people:[{id:'220921'}]}]},old={id:'s1',people:[person]},changed={id:'s2',people:[{...person,roleLabels:{bg:{text:'Друга роля',language:'bg'}}}]};
  for(const records of [[old,changed],[changed,old]]) {
    const headers=mergeSpeechSpeakers({},records);
    assert.equal(legislationOffice(d,headers,'220921','en').text,'Role translation unavailable');
    assert.equal(legislationOffice(detail,headers,'220921','en').text,en.text,'another item does not change this item');
  }
  assert.equal(legislationOffice(d,mergeSpeechSpeakers({},[old]),'220921','en').text,'Role translation unavailable','do not borrow from the earlier speech while latest is unread');
});

test('a newer header snapshot clears superseded labels and a late old response cannot restore them',()=>{
  const source=stamp=>({speechId:'s1',date:'2026-10-19',url:'https://data.europarl.europa.eu/api/v2/speeches/s1',fetchedAt:stamp});
  const old={id:'s1',people:[{...person,roleSource:source('2026-10-21T10:00:00Z')}]};
  const latest={id:'s1',people:[{...person,role:'Друга роля',roleLabels:{bg:{text:'Друга роля',language:'bg'}},roleSource:source('2026-10-22T10:00:00Z')}]};
  const updated=mergeSpeechSpeakers(mergeSpeechSpeakers({},[old]),[latest]);
  assert.equal(legislationOffice(detail,updated,'220921','en').text,'Role translation unavailable');
  assert.strictEqual(mergeSpeechSpeakers(updated,[old]),updated);
});
