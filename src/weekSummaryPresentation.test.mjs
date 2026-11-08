import test from 'node:test';
import assert from 'node:assert/strict';
import {procedureReferences,resultLine,resultText,tallyText,visibleTopics} from './weekSummaryPresentation.mjs';

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

test('rows keep source order and put votes first only on days ahead',()=>{
  const d=topic('MTG-PL-2026-11-11-OJ-ITM-D-1','PLENARY_DEBATE'),v=topic('MTG-PL-2026-11-11-OJ-ITM-V-2','PLENARY_VOTE'),a=topic('MTG-PL-2026-11-11-OJ-ITM-X-3','PLENARY_ACTIVITY');
  assert.deepEqual(visibleTopics([d,v,a]).map(t=>t.id),[d.id,v.id,a.id]);
  assert.deepEqual(visibleTopics([d,v,a],{upcoming:true}).map(t=>t.id),[v.id,d.id,a.id]);
});

test('procedure references keep exact identifiers',()=>{
  assert.deepEqual(procedureReferences(topic('MTG-PL-2026-11-11-OJ-ITM-V-1','PLENARY_VOTE',{procedureIds:['2025-0235','eli/dl/proc/x','2025-0222A']})),['2025/0235','2025/0222A']);
});
