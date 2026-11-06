import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultUi} from './uiDefault.mjs';
import {dayChipText,deadlineParts,nextDeadlines,pastCount,procedureReferences,resultLine,resultText,showCounts,sittingRange,tallyText,upcomingCount,visibleTopics,voteHref,weekMode,weekOfDate,weekStandouts,validWeekResults} from './weekSummaryPresentation.mjs';

const erasmus={agendaItemId:'MTG-PL-2026-10-22-OJ-ITM-V-52',voteCount:35,main:{id:'MTG-PL-2026-10-22-DEC-198405',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:454,against:34,abstaining:93}}};
const budget={agendaItemId:'MTG-PL-2026-10-21-OJ-ITM-V-71',voteCount:133,main:null};
const hands={agendaItemId:'x',voteCount:1,main:{id:'MTG-PL-2026-10-20-DEC-1',outcome:'ADOPTED',method:'VOTE_HAND',totals:{for:null,against:null,abstaining:null}}};
const topic=(id,kind,extra={})=>({id,kind,sittingId:id.slice(0,17),title:id,titleLanguage:'en',date:id.slice(7,17),documentIds:[],procedureIds:[],...extra});

test('a result line reads outcome, tally and vote count',()=>{
  assert.equal(resultText(resultLine(erasmus)),'Adopted · 454–34–93 · 35 votes');
  assert.equal(resultLine(erasmus).voteId,'MTG-PL-2026-10-22-DEC-198405');
  assert.equal(resultLine(erasmus).tallyLabel,'454 for, 34 against, 93 abstaining');
});

test('an item without a main vote has a count and no outcome word',()=>{
  assert.equal(resultText(resultLine(budget)),'133 votes');
  assert.equal(resultText(resultLine({...budget,voteCount:1})),'1 vote');
  assert.equal(resultLine(budget).voteId,null);
});

test('a show of hands reads as such and a missing tally is not a zero',()=>{
  assert.equal(resultText(resultLine(hands)),'Adopted · show of hands · 1 vote');
  assert.equal(tallyText({for:0,against:0,abstaining:null}),null);
  assert.equal(tallyText({for:0,against:0,abstaining:0}),'0–0–0');
  const electronic={...hands,main:{...hands.main,method:'VOTE_ELECTRONIC'}};
  assert.equal(resultText(resultLine(electronic)),'Adopted · 1 vote');
  assert.equal(resultText(resultLine({...hands,main:{...hands.main,outcome:'LAPSED'}})),'show of hands · 1 vote');
});

test('the past count states exact totals and omits an empty clause',()=>{
  const week={days:[{voteCount:5,rollCallCount:5,notConducted:0},{voteCount:38,rollCallCount:24,notConducted:21},{voteCount:354,rollCallCount:152,notConducted:45},{voteCount:155,rollCallCount:75,notConducted:49}],items:Array(28).fill(budget)};
  assert.equal(pastCount(week),'552 votes on 28 agenda items: 256 with names on record. 115 not put to a vote.');
  assert.equal(pastCount({days:[{voteCount:3,rollCallCount:0,notConducted:0}],items:[budget]}),'3 votes on 1 agenda item.');
});

test('the upcoming count follows the scheduled items',()=>{
  const items=[...Array(10).fill(0).map((_,i)=>topic('MTG-PL-2026-11-11-OJ-ITM-V-'+i,'PLENARY_VOTE')),...Array(9).fill(0).map((_,i)=>topic('MTG-PL-2026-11-12-OJ-ITM-D-'+i,'PLENARY_DEBATE'))];
  assert.equal(upcomingCount(items),'10 votes and 9 debates scheduled.');
  assert.equal(upcomingCount(items.slice(0,1)),'1 vote scheduled.');
  assert.equal(upcomingCount(items.slice(10,11)),'1 debate scheduled.');
  assert.equal(upcomingCount([]),null);
  assert.deepEqual(showCounts(items),{all:19,votes:10,debates:9});
});

test('the filter keeps source order and puts votes first only on days ahead',()=>{
  const d=topic('MTG-PL-2026-11-11-OJ-ITM-D-1','PLENARY_DEBATE'),v=topic('MTG-PL-2026-11-11-OJ-ITM-V-2','PLENARY_VOTE'),a=topic('MTG-PL-2026-11-11-OJ-ITM-X-3','PLENARY_ACTIVITY');
  assert.deepEqual(visibleTopics([d,v,a]).map(t=>t.id),[d.id,v.id,a.id]);
  assert.deepEqual(visibleTopics([d,v,a],{upcoming:true}).map(t=>t.id),[v.id,d.id,a.id]);
  assert.deepEqual(visibleTopics([d,v,a],{show:'votes'}).map(t=>t.id),[v.id]);
  assert.deepEqual(visibleTopics([d,v,a],{show:'debates'}).map(t=>t.id),[d.id,a.id]);
});

test('deadlines use the end and type, never the labels, and show Brussels time',()=>{
  const now=Date.parse('2026-11-06T10:00:00Z'),late={id:'late',end:'2026-11-10T18:00:00Z',type:'def/ep-activities/TABLING_PLENARY',labels:{de:'Frist'}};
  const items=[
    topic('MTG-PL-2026-11-11-OJ-ITM-V-1','PLENARY_VOTE',{deadlines:[late,{id:'past',end:'2026-11-05T18:00:00Z',type:'TABLING_PLENARY',labels:{}},{id:'other',end:'2026-11-09T18:00:00Z',type:'def/ep-activities/TABLING_AMENDMENT',labels:{en:'tabling deadline'}},{id:'obj',end:'2026-11-09T08:00:00Z',type:{id:'TABLING_PLENARY'},labels:{}},{id:'none',end:null,type:'TABLING_PLENARY',labels:{}}]}),
  ];
  assert.deepEqual(nextDeadlines(items,now).map(row=>row.id),['obj','late']);
  assert.deepEqual(deadlineParts(late.end,'en'),{date:'10 Nov',time:'19:00'});
});

test('week headings and day chips read as dates',()=>{
  assert.equal(weekOfDate('2026-10-19'),'Oct 19, 2026');
  assert.equal(dayChipText('2026-10-19'),'Mon 19');
  assert.equal(sittingRange(['2026-11-12','2026-11-11']),'Nov 11–12');
  assert.equal(sittingRange(['2026-11-11']),'Nov 11');
  assert.equal(sittingRange([]),null);
});

test('the week is past, upcoming or mixed by its days',()=>{
  assert.equal(weekMode([{phase:'past'},{phase:'today'}]),'past');
  assert.equal(weekMode([{phase:'upcoming'},{phase:'upcoming'}]),'upcoming');
  assert.equal(weekMode([{phase:'past'},{phase:'upcoming'}]),'mixed');
});

test('links use the fixed vote-page route and exact procedure identifiers',()=>{
  assert.equal(voteHref('MTG-PL-2026-10-22-DEC-198405','fr'),'?view=legislation&pl-mode=vote&pl-vote=MTG-PL-2026-10-22-DEC-198405&lang=fr');
  assert.deepEqual(procedureReferences(topic('MTG-PL-2026-11-11-OJ-ITM-V-1','PLENARY_VOTE',{procedureIds:['2025-0235','eli/dl/proc/x','2025-0222A']})),['2025/0235','2025/0222A']);
});

const standouts={closest:{voteId:'MTG-PL-2026-10-22-DEC-1',agendaItemId:'MTG-PL-2026-10-22-OJ-ITM-V-52',outcome:'ADOPTED',totals:{for:321,against:319,abstaining:5}},split:{voteId:'MTG-PL-2026-10-21-DEC-2',agendaItemId:'MTG-PL-2026-10-21-OJ-ITM-V-71',differing:48}};
const week=extra=>({version:2,week:'2026-10-19',location:null,days:[],items:[],standouts,...extra});

test('the week-results contract requires standouts with known counts',()=>{
  assert.equal(validWeekResults(week()),true);
  assert.equal(validWeekResults(week({standouts:{closest:null,split:null}})),true);
  for(const bad of [undefined,null,{closest:null},{closest:null,split:{...standouts.split,differing:0}},{closest:{...standouts.closest,totals:{for:null,against:2,abstaining:0}},split:null},{closest:{...standouts.closest,voteId:4},split:null}])assert.equal(validWeekResults(week({standouts:bad})),false);
});

test('a standout fact is shown only with the agenda row it belongs to',()=>{
  const topics=[topic('MTG-PL-2026-10-22-OJ-ITM-V-52','PLENARY_VOTE'),topic('MTG-PL-2026-10-21-OJ-ITM-V-71','PLENARY_VOTE')];
  assert.deepEqual(weekStandouts(week(),topics).map(fact=>[fact.kind,fact.voteId,fact.topic.id]),[['closest','MTG-PL-2026-10-22-DEC-1','MTG-PL-2026-10-22-OJ-ITM-V-52'],['split','MTG-PL-2026-10-21-DEC-2','MTG-PL-2026-10-21-OJ-ITM-V-71']]);
  assert.deepEqual(weekStandouts(week(),topics.slice(0,1)).map(fact=>fact.kind),['closest']);
  assert.deepEqual(weekStandouts(week({standouts:{closest:null,split:null}}),topics),[]);
  assert.deepEqual(weekStandouts(null,topics),[]);
});
