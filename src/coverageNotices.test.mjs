import {test} from 'node:test';
import assert from 'node:assert/strict';
import {coverageNotices} from './coverageNotices.mjs';
import {sourceAvailability} from '../server/source-availability.mjs';

const source=gaps=>sourceAvailability({sourceKey:'oral',family:'speeches',start:'2024-07-16',end:'2026-10-30',gaps});
test('metadata, worker and transcript aliases describe one missing speech',()=>{
  const id='MTG-PL-2026-03-11-OTH-2017066173880';
  const gaps=['recovery:/speeches/','speech:','speech-metadata-detail:','group-voices:1:recovery:'].map(prefix=>({start:'2026-03-11',end:'2026-03-11',sourceId:prefix+id}));
  assert.deepEqual(coverageNotices([source(gaps),source(gaps)]),[{kind:'speech-records',count:1,dates:['2026-03-11']}]);
});
test('known dated omissions stay within the selected interval, with open ranges preserved',()=>{
  const gaps=[{start:'2023-11-21',end:'2023-11-21',sourceId:'outside:gap:outside:roster:2023-11-21'},
    {start:'2026-10-27',sourceId:'catchup:2026-10-30:speeches'}];
  assert.deepEqual(coverageNotices(source(gaps)),[{kind:'speech-list',start:'2026-10-27',end:null}]);
  assert.deepEqual(coverageNotices(source(gaps),{end:'2026-10-20'}),[]);
});
test('repeated question subtype gaps retain one exact human-link candidate',()=>{
  const gap={sourceId:'/parliamentary-questions/E-10-2026-001715'},question=sourceAvailability({sourceKey:'written',family:'questions',gaps:[gap]});
  assert.deepEqual(coverageNotices([question,question,question]),[{kind:'question',id:'E-10-2026-001715',sourceUrl:'https://data.europarl.europa.eu/api/v2/parliamentary-questions/E-10-2026-001715'}]);
});
test('unknown or malformed identities cannot become invented record links or dates',()=>{
  assert.deepEqual(coverageNotices(source([{},{sourceId:'https://foreign.invalid/E-10-2026-001715'},{sourceId:'/parliamentary-questions/E-10-2026-001715?x=1'},{start:'2026-02-30'}])),[]);
});
test('record filters preserve overlapping collection failures without pulling in other records or dates',()=>{
  const evidence=sourceAvailability({sourceKey:'questions',family:'questions',start:'2026-10-01',end:'2026-10-30',gaps:[
    {sourceId:'/parliamentary-questions/E-10-2026-001715',start:'2026-10-03',end:'2026-10-03'},
    {sourceId:'feed:/parliamentary-questions',start:'2026-10-27'},
    {sourceId:'catchup:old:questions',start:'2024-10-01',end:'2024-10-07'},
  ]});
  assert.deepEqual(coverageNotices(evidence,{sourceIds:[],onlyRelevant:true}),[{kind:'question-list',start:'2026-10-27',end:null}]);
  assert.deepEqual(coverageNotices(evidence,{sourceIds:[],onlyRelevant:true,end:'2026-10-20'}),[]);
});
