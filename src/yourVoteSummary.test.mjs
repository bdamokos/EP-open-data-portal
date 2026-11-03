import test from 'node:test';
import assert from 'node:assert/strict';
import {ballotGroups,summarizeVotes,sessionDateRange} from './yourVoteSummary.mjs';
test('contiguous subjects form groups without merging a later repeated subject',()=>{
 const rows=['Recital 3','Recital 3','§ 13','Recital 3'].map((subject,i)=>({subject:[subject],key:String(i)}));
 assert.deepEqual(ballotGroups(rows).map(g=>g.rows.map(r=>r.key)),[['0','1'],['2'],['3']]);
});
test('agreement denominators exclude missing, tied and unrecorded positions',()=>{
 const entries=[{choice:'for',outcome:'ADOPTED',decisionId:'a'},{choice:'against',outcome:'REJECTED',decisionId:'b'},{choice:'for',outcome:'LAPSED',decisionId:'c'}];
 const comparisons={a:{integrity:'complete',majorities:[{id:'EPP',position:'for'},{id:'S&D',position:'against'}],voters:[{personId:'1',position:'for',status:'recorded'}]},b:{integrity:'complete',majorities:[{id:'EPP',position:null},{id:'S&D',position:'against'}],voters:[{personId:'1',position:'against',status:'conflicting'}]},c:{integrity:'partial',majorities:[{id:'EPP',position:'for'}],voters:[{personId:'1',position:'for',status:'recorded'}]}};
 const summary=summarizeVotes(entries,comparisons,[{id:'1',name:'Member'},{id:'2',name:'Absent'}]);
 assert.deepEqual(summary.result,{agreed:2,total:2});assert.deepEqual(summary.groups,[{id:'EPP',agreed:1,total:1},{id:'S&D',agreed:1,total:2}]);assert.deepEqual(summary.members,[{id:'1',name:'Member',agreed:1,total:1}]);
});
test('part-session dates use localized ranges rather than ISO keys',()=>{
 assert.equal(sessionDateRange(['2026-09-17','2026-09-14'],'en').replace(/\u2009/g,''),'14–17 September 2026');
 assert.match(sessionDateRange(['2026-09-14','2026-09-17'],'hu'),/szeptember/);
});
test('ballot admission uses the Brussels date across midnight',async()=>{
 const {ballotVisible,brusselsToday}=await import('./yourVoteSummary.mjs');const now=Date.parse('2026-11-02T23:30:00Z');assert.equal(brusselsToday(now),'2026-11-03');assert.equal(ballotVisible('MTG-PL-2026-11-02','tabled',now),false);assert.equal(ballotVisible('MTG-PL-2026-11-03','tabled',now),true);assert.equal(ballotVisible('MTG-PL-2026-09-15','retained',now),true);
});
