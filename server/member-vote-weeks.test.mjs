import {initializeActivityReads} from './activity-read-projections.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {memberVoteWeeks} from './member-vote-weeks.mjs';

test('stored week hints group exact retained decisions in the serving generation without claiming complete coverage',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE sources(generation INTEGER,key TEXT,kind TEXT,body TEXT,fetched_at TEXT)');
    db.exec('CREATE TABLE items(generation INTEGER,mep TEXT,source_id TEXT,date TEXT,body TEXT)');
    initializeActivityReads(db);
    const add=(date,{generation=2,decisions=[{id:'eli/dl/event/MTG-PL-'+date+'-DEC-1'}],fetchedAt='2026-10-19T10:00:00Z'}={})=>db.prepare('INSERT INTO sources VALUES (?,?,?,?,?)').run(generation,'motion-outcomes:MTG-PL-'+date,'motion-outcomes',JSON.stringify({decisions,decisionsUrl:'https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-'+date+'/decisions?format=application%2Fld%2Bjson',decisionsFetchedAt:fetchedAt}),fetchedAt);
    add('2026-10-06');add('2026-10-07');add('2026-09-16');
    add('2026-09-23',{generation:1});add('2026-09-30',{decisions:[]});
    add('2026-09-29',{decisions:[{id:'eli/dl/event/MTG-PL-2026-09-28-DEC-1'}]});
    add('2026-10-20');add('2024-07-15');add('2026-02-30');add('2026-08-12',{fetchedAt:'unavailable'});
    const result=memberVoteWeeks({db,get:key=>key==='active'?2:null},{now:Date.parse('2026-10-19T12:00:00Z')});
    assert.deepEqual(result.weeks.map(item=>item.week),['2026-10-05','2026-09-14']);
    assert.deepEqual(result.weeks[0].sittings.map(item=>item.id),['MTG-PL-2026-10-07','MTG-PL-2026-10-06']);
    assert.equal(result.weeks[0].sittings[0].retrievedAt,'2026-10-19T10:00:00Z');
    assert.equal(result.weeks[0].sittings[0].sourceUrl,'https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-10-07/decisions?format=application%2Fld%2Bjson');
    assert.equal(result.coverage.status,'partial');assert.equal(result.coverage.termWide,false);
    assert.equal(result.coverage.truncated,false);
    assert.equal(memberVoteWeeks({db,get:()=>null}).weeks.length,0);
    assert.equal(memberVoteWeeks({db,get:key=>key==='working'?{generation:2}:null},{now:Date.parse('2026-10-19T12:00:00Z')}).weeks.length,2);
  } finally {db.close();}
});
