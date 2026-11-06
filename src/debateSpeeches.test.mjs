import test from 'node:test';
import assert from 'node:assert/strict';
import {listedSpeakerName,speechPanelCounts,speechPanelDate} from './debateSpeeches.mjs';

const speech=(kind,date,...ids)=>({kind,date,people:ids.map(id=>({id}))});
test('speeches, written statements and speakers are counted by kind from the listed rows',()=>{
  const rows=[speech('PLENARY_DEBATE_SPEECH','2026-10-21','1'),speech('PLENARY_DEBATE_SPEECH','2026-10-21','1','2'),speech('PLENARY_DEBATE_WRITTEN_STATEMENT','2026-10-21','3')];
  assert.deepEqual(speechPanelCounts(rows),{speeches:2,statements:1,speakers:2});
  assert.deepEqual(speechPanelCounts([]),{speeches:0,statements:0,speakers:0});
});
test('the debate date is shown only when every listed speech shares it',()=>{
  assert.equal(speechPanelDate([speech('a','2026-10-21'),speech('a','2026-10-21')]),'2026-10-21');
  assert.equal(speechPanelDate([speech('a','2026-10-21'),speech('a','2026-10-22')]),null);
  assert.equal(speechPanelDate([]),null);
});
test('a header role word never replaces the listed speaker name',()=>{
  assert.equal(listedSpeakerName('Martin Hojsík','Presiding'),'Martin Hojsík');
  assert.equal(listedSpeakerName('Martin Hojsík',undefined),'Martin Hojsík');
  assert.equal(listedSpeakerName('Martin Hojsík','Martin HOJSÍK'),'Martin HOJSÍK','a specific header name still wins');
  assert.equal(listedSpeakerName(null,'Presiding'),null);
});
