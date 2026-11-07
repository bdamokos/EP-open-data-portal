import test from 'node:test';
import assert from 'node:assert/strict';
import {ballotGroups,ballotSittings,debateBallots,summarizeVotes,sessionDateRange} from './yourVoteSummary.mjs';
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
test('ballots for a debate item come from its sitting and the rest of the part-session',()=>{
 const sittings=[['2026-11-11'],['2026-11-12'],['2026-11-23']].map(([date])=>({id:'MTG-PL-'+date,date}));
 const now=Date.parse('2026-11-07');
 assert.deepEqual(ballotSittings('MTG-PL-2026-11-11',sittings,now),['MTG-PL-2026-11-11','MTG-PL-2026-11-12']);
 assert.deepEqual(ballotSittings('MTG-PL-2026-11-12',sittings,now),['MTG-PL-2026-11-12']);
 assert.deepEqual(ballotSittings('MTG-PL-2026-09-15',[{id:'MTG-PL-2026-09-15',date:'2026-09-15'}],now),[]);
});
test('a debate item shows ballots it can read and at most one failure',()=>{
 const ids=['MTG-PL-2026-11-11','MTG-PL-2026-11-12'],now=Date.parse('2026-11-07'),ballot={id:'D-37',documentId:'A'},failed={status:'rejected'},empty={status:'fulfilled',value:{items:[]}};
 assert.deepEqual(debateBallots(ids,[failed,{status:'fulfilled',value:{items:[ballot]}}],'D-37',true,now),{items:[ballot],failed:false});
 assert.deepEqual(debateBallots(ids,[failed,failed],'D-37',true,now),{items:[],failed:true});
 assert.deepEqual(debateBallots(ids,[failed,failed],'D-51',false,now),{items:[],failed:false});
 assert.deepEqual(debateBallots(ids,[empty,empty],'D-37',true,now),{items:[],failed:false});
 assert.deepEqual(debateBallots(ids,[failed,empty],'D-37',true,Date.parse('2026-12-20')),{items:[],failed:false});
 assert.deepEqual(debateBallots(['s'],[{status:'fulfilled',value:{items:[{id:'V',alsoOn:['D-3']}]}}],'D-3',false,now).items.length,1);
});
