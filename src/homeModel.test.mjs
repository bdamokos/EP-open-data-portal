import test from 'node:test';
import assert from 'node:assert/strict';
import {isHomeQuery,headlineState,defaultAgendaWeek,agendaRows,votePicks,unreadRows,procedureReference,HOME_COUNTRIES} from './homeModel.mjs';

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

test('agenda rows group by day, skip past days, cap the count and keep agenda order',()=>{
  const topics=[
    {id:'MTG-PL-2026-11-11-OJ-ITM-D-2',date:'2026-11-11',order:2,title:'Second'},
    {id:'MTG-PL-2026-11-11-OJ-ITM-D-1',date:'2026-11-11',order:1,title:'First'},
    {id:'MTG-PL-2026-11-10-OJ-ITM-D-1',date:'2026-11-10',order:1,title:'Held yesterday'},
    {id:'MTG-PL-2026-11-12-OJ-ITM-D-1',date:'2026-11-12',order:1,title:'Thursday'},
    {id:'MTG-PL-2026-11-12-OJ-ITM-D-2',date:'2026-11-12',order:2,title:'Thursday second'},
  ];
  const rows=agendaRows(topics,'2026-11-11');
  assert.deepEqual(rows.map(row=>row.topic.id),['MTG-PL-2026-11-11-OJ-ITM-D-1','MTG-PL-2026-11-11-OJ-ITM-D-2','MTG-PL-2026-11-12-OJ-ITM-D-1','MTG-PL-2026-11-12-OJ-ITM-D-2']);
  assert.deepEqual(agendaRows(topics,'2026-11-11',2).map(row=>row.topic.title),['First','Second']);
  assert.deepEqual(agendaRows(topics,'2026-11-13'),[],'a finished week shows no rows');
  assert.deepEqual(agendaRows(null,'2026-11-11'),[]);
});

test('vote picks follow the fixed rules and skip unpublished totals',()=>{
  const vote=(id,forCount,against,{abstaining=0,final=false,groupDeviations,date='2026-10-22'}={})=>({id,date,namedVotersAvailable:true,aggregateTotals:{for:forCount,against,abstaining},groupDeviations,...(final?{scope:'final-text'}:{})});
  const finals=['DEC-1','DEC-2','DEC-4','DEC-5'];
  const votes=[
    vote('DEC-1',300,280,{final:true,groupDeviations:12,date:'2026-10-21'}),
    vote('DEC-2',500,100,{final:true,groupDeviations:40,date:'2026-10-22'}),
    vote('DEC-3',340,330,{groupDeviations:0,date:'2026-10-22'}),
    vote('DEC-4',500,20,{final:true,date:'2026-10-23'}),
    {id:'DEC-5',date:'2026-10-22',namedVotersAvailable:false,aggregateTotals:{for:null,against:null,abstaining:null}},
  ];
  const picks=votePicks(votes,finals);
  assert.deepEqual(picks.map(pick=>[pick.rule,pick.vote.id]),[['closest','DEC-1'],['divergent','DEC-2'],['recent','DEC-4']],'DEC-4 has the widest margin among finals after the closest, and is the most recent; DEC-2 wins on group deviations');
  assert.deepEqual(picks.map(pick=>pick.totals),[{for:300,against:280,abstaining:0},{for:500,against:100,abstaining:0},{for:500,against:20,abstaining:0}]);
  // Without deviation data that pick disappears rather than being invented.
  const noDeviation=votePicks(votes.map(({groupDeviations,...rest})=>rest),finals);
  assert.deepEqual(noDeviation.map(pick=>pick.rule),['closest','recent']);
  // A tie in margin resolves to the most recent.
  const tied=votePicks([vote('DEC-7',300,290,{final:true,date:'2026-10-20'}),vote('DEC-8',310,300,{final:true,date:'2026-10-22'})],['DEC-7','DEC-8']);
  assert.equal(tied[0].vote.id,'DEC-8');
  // No finals, no closest or recent pick even with plenty of roll-calls.
  assert.deepEqual(votePicks(votes,[]).map(pick=>pick.rule),['divergent']);
  assert.deepEqual(votePicks([],finals),[]);
  assert.deepEqual(votePicks(null,finals),[]);
  // Zero deviations on every vote yields no divergent pick.
  assert.deepEqual(votePicks([vote('DEC-1',300,280,{final:true,groupDeviations:0})],['DEC-1']).map(pick=>pick.rule),['closest']);
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
