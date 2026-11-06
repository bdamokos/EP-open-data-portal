import test from 'node:test';
import assert from 'node:assert/strict';
import {memberOverviewItems,memberOverviewVotesRoute} from './memberOverviewModel.mjs';

const row=(indexedCount,status='available')=>({status,indexedCount,total:status==='available'?indexedCount:null,reason:null});
const activities=overrides=>({categoryCoverage:{'plenary-contributions':row(21),'reports-rapporteur':row(0),'reports-shadow':row(3),'opinions-rapporteur':row(0),'opinions-shadow':row(0),'written-questions':row(4),'oral-questions':row(1),motions:row(0),...overrides}});
const votes={coverage:{status:'complete'},period:{week:'2026-10-19'},alignmentCounts:{with:240,against:10,abstained:3,unclassified:2},pagination:{recordedTotal:255}};

test('items follow the page order and hide zero counts except speeches and votes',()=>{
  const items=memberOverviewItems({activities:activities(),votes});
  assert.deepEqual(items.map(item=>[item.key,item.count]),[['speeches',21],['reports-shadow',3],['questions',5],['votes',255]]);
  assert.equal(items.at(-1).against,10);assert.equal(items.at(-1).week,'2026-10-19');
  assert.equal(memberOverviewItems({activities:activities({'plenary-contributions':row(0)}),votes})[0].count,0);
});

test('a category that is not available is unknown, never zero',()=>{
  const items=memberOverviewItems({activities:activities({'plenary-contributions':row(0,'backfilling'),'reports-shadow':row(7,'incomplete-joins'),'oral-questions':row(0,'source-not-verified')}),votes});
  assert.deepEqual(items.map(item=>item.key),['votes']);
});

test('questions open the single category when only one kind exists',()=>{
  const only=memberOverviewItems({activities:activities({'oral-questions':row(0)}),votes:null}).find(item=>item.key==='questions');
  assert.equal(only.category,'written-questions');
  assert.equal(memberOverviewItems({activities:activities(),votes:null}).find(item=>item.key==='questions').category,'');
});

test('votes need a complete read with an exact recorded and against count',()=>{
  assert.equal(memberOverviewItems({activities:null,votes:{...votes,coverage:{status:'partial'}}}).length,0);
  assert.equal(memberOverviewItems({activities:null,votes:{...votes,alignmentCounts:null}}).length,0);
  assert.equal(memberOverviewItems({activities:null,votes:{...votes,pagination:{recordedTotal:null}}}).length,0);
  assert.equal(memberOverviewItems({activities:null,votes:{...votes,pagination:{recordedTotal:0},alignmentCounts:{with:0,against:0,abstained:0,unclassified:0}}})[0].count,0);
  assert.equal(memberOverviewItems({activities:null,votes:null}).length,0);
});

test('the vote summary is read for the latest week',()=>{
  assert.equal(memberOverviewVotesRoute(113523),'member-votes/113523?week=latest&view=summary');
});
