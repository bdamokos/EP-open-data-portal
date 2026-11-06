import test from 'node:test';
import assert from 'node:assert/strict';
import {isHomeQuery,headlineState,defaultAgendaWeek,agendaDays,votePicks,unreadRows,procedureReference,HOME_COUNTRIES} from './homeModel.mjs';

const query = value => new URLSearchParams(value);
const week = (week,sittings) => ({week,sittings:sittings.map(([date,location]) => ({sittingId:'MTG-PL-'+date,date,location:location||null}))});

test('Home owns only the bare URL',()=>{
  assert.equal(isHomeQuery(query('')),true);
  assert.equal(isHomeQuery(query('lang=fr')),true);
  assert.equal(isHomeQuery(query('global-fts-search=climate&global-fts-page=2')),true);
  assert.equal(isHomeQuery(query('view=meps')),false);
  assert.equal(isHomeQuery(query('member=197490')),false);
  assert.equal(isHomeQuery(query('country=FR')),false);
  assert.equal(isHomeQuery(query('group=SD')),false);
  assert.equal(isHomeQuery(query('committee=AFET')),false);
  assert.equal(isHomeQuery(query('view=legislation')),false);
  assert.equal(isHomeQuery(query('pl-mode=cloud')),false);
  assert.equal(isHomeQuery(query('agenda-topic=x')),false);
  assert.equal(isHomeQuery(query('q-country=FR')),false);
  assert.equal(isHomeQuery(query('topic=eurovoc:1236')),false);
  assert.equal(isHomeQuery(query('lang=fr&member=1')),false);
});

test('headline covers sitting today, later this week, next date and no future date',()=>{
  const weeks=[week('2026-10-19',[['2026-10-21','Strasbourg'],['2026-10-22','Strasbourg']])];
  assert.deepEqual(headlineState('2026-10-21',weeks,[]),{case:'sitting-today',city:'Strasbourg'});
  assert.deepEqual(headlineState('2026-10-20',weeks,[]),{case:'sitting-later-this-week',city:'Strasbourg',nextDate:'2026-10-21'});
  assert.deepEqual(headlineState('2026-10-19',weeks,[]),{case:'sitting-later-this-week',city:'Strasbourg',nextDate:'2026-10-21'});
  const upcoming=[week('2026-11-09',[['2026-11-11','Brussels'],['2026-11-12','Brussels']])];
  assert.deepEqual(headlineState('2026-10-22',weeks,upcoming),{case:'sitting-today',city:'Strasbourg'});
  assert.deepEqual(headlineState('2026-10-25',weeks,upcoming),{case:'next-known',city:'Brussels',nextDate:'2026-11-11'});
  assert.deepEqual(headlineState('2026-10-25',weeks,[]),{case:'no-future-date'});
  assert.deepEqual(headlineState('2026-10-25',[],[]),{case:'no-future-date'});
  // An unknown city stays null rather than inventing a place.
  assert.deepEqual(headlineState('2026-10-21',[week('2026-10-19',[['2026-10-21']])],[]),{case:'sitting-today',city:null});
  assert.deepEqual(headlineState('nonsense',weeks,[]),{case:'unknown'});
});

test('headline day rolls over at Brussels midnight: the last sitting day is still today',()=>{
  const weeks=[week('2026-10-19',[['2026-10-19','Strasbourg'],['2026-10-20','Strasbourg']])];
  // 2026-10-20 is the last day of the sitting; 2026-10-20 23:30 UTC is already 2026-10-21 in Brussels.
  const brussels=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(Date.parse('2026-10-20T23:30:00Z'));
  assert.equal(brussels,'2026-10-21');
  assert.equal(headlineState(brussels,weeks,[]).case,'no-future-date');
  const withNext=[...weeks,week('2026-11-09',[['2026-11-10','Brussels']])];
  // A held week still named next in the same list is treated as a known future date only when it is one.
  assert.deepEqual(headlineState('2026-10-21',withNext,[week('2026-11-09',[['2026-11-10','Brussels']])]),{case:'next-known',city:'Brussels',nextDate:'2026-11-10'});
  const duringDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(Date.parse('2026-10-20T10:00:00Z'));
  assert.equal(headlineState(duringDay,weeks,[]).case,'sitting-today');
});

test('default agenda week picks the current week, then the next, then the most recent',()=>{
  const weeks=[week('2026-10-19',[['2026-10-21','Strasbourg']]),week('2026-10-05',[['2026-10-07','Strasbourg']])];
  const upcoming=[week('2026-11-09',[['2026-11-11','Brussels']])];
  assert.equal(defaultAgendaWeek('2026-10-21',weeks,upcoming),'2026-10-19','today inside a sitting week');
  assert.equal(defaultAgendaWeek('2026-10-19',weeks,upcoming),'2026-10-19','week started today');
  assert.equal(defaultAgendaWeek('2026-11-05',weeks,upcoming),'2026-11-09','no sitting this week: next week');
  assert.equal(defaultAgendaWeek('2026-12-24',weeks,upcoming),'2026-10-19','nothing ahead: most recent held week');
  assert.equal(defaultAgendaWeek('2026-12-24',[],[]),null,'no calendar at all');
  assert.equal(defaultAgendaWeek('invalid',weeks,upcoming),null);
});

test('agenda days skip past days, keep agenda order and cap each day',()=>{
  const topics=[
    {id:'MTG-PL-2026-11-11-OJ-ITM-D-2',date:'2026-11-11',order:2,title:'Second'},
    {id:'MTG-PL-2026-11-11-OJ-ITM-D-1',date:'2026-11-11',order:1,title:'First'},
    {id:'MTG-PL-2026-11-10-OJ-ITM-D-1',date:'2026-11-10',order:1,title:'Held yesterday'},
    ...[1,2,3,4,5,6].map(n=>({id:'MTG-PL-2026-11-12-OJ-ITM-V-'+n,date:'2026-11-12',order:n,sittingId:'MTG-PL-2026-11-12',kind:'PLENARY_VOTE'})),
  ];
  const days=agendaDays(topics,'2026-11-11');
  assert.deepEqual(days.map(day=>[day.day,day.rows.length,day.more]),[['2026-11-11',2,0],['2026-11-12',4,2]]);
  assert.deepEqual(days[0].rows.map(topic=>topic.title),['First','Second']);
  assert.equal(days[1].sittingId,'MTG-PL-2026-11-12');
  assert.deepEqual(agendaDays(topics,'2026-11-13'),[],'a finished week shows no rows');
  assert.deepEqual(agendaDays(null,'2026-11-11'),[]);
});

test('vote picks follow the fixed rules, never repeat a vote and never pad',()=>{
  // Invented fixture rows in the /api/latest-results shape.
  const vote=(id,forCount,against,{differing=null,date='2026-10-22'}={})=>({id,date,title:'Title '+id,topicId:'T-'+id,sittingId:'MTG-PL-'+date,outcome:'ADOPTED',totals:{for:forCount,against,abstaining:5},differing});
  const votes=[vote('A',300,280,{differing:12,date:'2026-10-21'}),vote('B',500,100,{differing:40,date:'2026-10-22'}),vote('C',340,330,{differing:3,date:'2026-10-23'})];
  assert.deepEqual(votePicks(votes).map(pick=>[pick.rule,pick.vote.id]),[['closest','C'],['split','B']],'closest is C, biggest split is B, and the most recent (C) is already shown');
  const more=[...votes,vote('D',500,20,{differing:1,date:'2026-10-24'})];
  assert.deepEqual(votePicks(more).map(pick=>[pick.rule,pick.vote.id]),[['closest','C'],['split','B'],['recent','D']]);
  // Unknown splits are never zero: no split card without the data.
  assert.deepEqual(votePicks(votes.map(v=>({...v,differing:null}))).map(pick=>pick.rule),['closest']);
  assert.deepEqual(votePicks(votes.map(v=>({...v,differing:0}))).map(pick=>pick.rule),['closest']);
  // A single vote fills a single card; ties resolve to the most recent.
  assert.deepEqual(votePicks([votes[0]]).map(pick=>pick.rule),['closest']);
  assert.equal(votePicks([vote('E',300,290,{date:'2026-10-20'}),vote('F',310,300,{date:'2026-10-22'})])[0].vote.id,'F');
  // Rows without published totals are ignored.
  assert.deepEqual(votePicks([{id:'X',date:'2026-10-22',totals:{for:null,against:3,abstaining:1}},null]),[]);
  assert.deepEqual(votePicks(null),[]);
});

test('unread rows list only fresh entries, newest first',()=>{
  const now=Date.parse('2026-11-05T12:00:00Z');
  const items=[
    {id:'mep:1',title:'Mika Aaltola',entries:[
      {id:'a1',kind:'activity',readAt:null,discoveredAt:now-3600_000,date:'2026-11-04'},
      {id:'a2',kind:'activity',readAt:now-7200_000,discoveredAt:now-86_400_000,date:'2026-11-03'},
    ]},
    {id:'mep:2',title:'Jane Doe',entries:[{id:'b1',kind:'answer',readAt:null,discoveredAt:now-60_000,date:'2026-11-05'}]},
    {id:'mep:3',title:'Read out',entries:[{id:'c1',kind:'activity',readAt:now-1000,discoveredAt:now-5000,date:'2026-11-05'}]},
    {id:'mep:4',title:'Stale',entries:[{id:'d1',kind:'activity',readAt:null,discoveredAt:now-25*3600_000,date:'2026-11-03'}]},
  ];
  const rows=unreadRows(items,now);
  assert.deepEqual(rows.map(row=>row.entry.id),['b1','a1']);
  assert.equal(rows[0].item.title,'Jane Doe');
  assert.deepEqual(unreadRows([],now),[]);
  assert.deepEqual(unreadRows(null,now),[]);
});

test('procedure reference needs exactly one year-number id', () => {
  assert.equal(procedureReference(['2025-0385']), '2025/0385');
  assert.equal(procedureReference([]), null);
  assert.equal(procedureReference(['2025-0385', '2025-0386']), null);
  assert.equal(procedureReference(['abc']), null);
});

test('home country list has 27 distinct codes', () => {
  assert.equal(new Set(HOME_COUNTRIES).size, 27);
});

test('every existing deep link stays outside Home and the directory view keeps the wall filters', async () => {
  const {publicExplorerView,memberWallView} = await import('./publicFeatures.ts').catch(() => import('./publicFeatures.mjs'));
  for (const view of ['legislation','questions','geopolitics','outside','groups','hemicycle','saved','meps']) {
    assert.equal(publicExplorerView(view), view);
    assert.equal(isHomeQuery(query('view=' + view)), false);
  }
  assert.equal(memberWallView('meps'), true);
  assert.equal(memberWallView(null), true);
  assert.equal(memberWallView('legislation'), false);
});

test('an older directory link with filters and no view opens the directory, so clearing a filter does not land on Home', async () => {
  const {explorerViewFromQuery} = await import('./publicFeatures.ts').catch(() => import('./publicFeatures.mjs'));
  for (const search of ['country=CZ', 'group=Renew', 'committee=6587', 'organization=7035', 'role=MEMBER_SUBSTITUTE', 'country=CZ&lang=hu']) assert.equal(explorerViewFromQuery(query(search)), 'meps', search);
  assert.equal(explorerViewFromQuery(query('view=questions&country=CZ')), 'questions');
  assert.equal(explorerViewFromQuery(query('member=840&country=CZ')), null);
  assert.equal(explorerViewFromQuery(query('')), null);
  assert.equal(explorerViewFromQuery(query('role=both')), null);
  assert.equal(explorerViewFromQuery(query('lang=hu&global-fts-search=x')), null);
});
