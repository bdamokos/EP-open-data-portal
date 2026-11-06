import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {topicVotes,boundedTopicVotes} from './insights-legislation-model.mjs';
import {rollCallDecisions} from './insights-participation.mjs';

// Fixture provenance: decision fields below are trimmed copies of nodes in the
// EP Open Data record https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-10-22/decisions
// (activity ids, methods, outcomes and tallies as published; retrieved 2026-11-05).
// The vote-result parent is the PLENARY_VOTE_RESULTS node
// eli/dl/event/MTG-PL-2026-10-22-VOT-ITM-993352 from .../vote-results. Labels are shortened.
const sitting='MTG-PL-2026-10-22',item='eli/dl/event/'+sitting+'-OJ-ITM-V-72',parent='eli/dl/event/'+sitting+'-VOT-ITM-993352';
const topic={id:sitting+'-OJ-ITM-V-72',uri:item};
const results={url:'https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/vote-results',fetchedAt:null,payload:{data:[
  {id:parent,activity_id:sitting+'-VOT-ITM-993352',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',executed:[item],based_on_a_realization_of:[],inverse_consists_of:[]},
  {id:'eli/dl/event/'+sitting+'-VOT-ITM-OTHER',activity_id:sitting+'-VOT-ITM-OTHER',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',executed:['eli/dl/event/'+sitting+'-OJ-ITM-V-99']},
]}};
const decision=(number,method,outcome,extra={},parents=[parent])=>({id:'eli/dl/event/'+sitting+'-DEC-'+number,activity_id:sitting+'-DEC-'+number,activity_date:'2026-10-22',
  activity_label:{en:'Decision '+number},referenceText:{en:'§ 21'},decision_method:'def/ep-decision-methods/'+method,decision_outcome:'def/ep-statuses/'+outcome,inverse_consists_of:parents,...extra});
const decisions={url:'https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/decisions',fetchedAt:null,payload:{data:[
  decision('199512','VOTE_ELECTRONIC_ROLLCALL','ADOPTED',{number_of_votes_favor:556,number_of_votes_abstention:10,had_voter_favor:[],had_voter_abstention:[]}),
  decision('199510','VOTE_ELECTRONIC','ADOPTED',{referenceText:{en:'After § 19'},number_of_votes_favor:334,number_of_votes_against:190,number_of_votes_abstention:31}),
  decision('199513','VOTE_HAND','ADOPTED',{decided_on_a_realization_of:['eli/dl/doc/'+sitting+'-VOT-ITM-993352-SPLIT-4-2']}),
  decision('199432','VOTE_HAND','LAPSED',{referenceText:{en:'B10-0478/2026'}}),
  decision('199999','VOTE_HAND','ADOPTED',{referenceText:{en:'§ 21'}},['eli/dl/event/'+sitting+'-VOT-ITM-OTHER']),
  decision('199998','VOTE_HAND','ADOPTED',{referenceText:{en:'§ 21'}},[]),
]}};
const votes=topicVotes(topic,results,decisions,new Map(),new Map(),'2026-10-22');

test('hand and non-roll-call electronic decisions join through the exact parent link only',()=>{
  assert.deepEqual(votes.map(v=>v.id).sort(),['199432','199510','199512','199513'].map(n=>sitting+'-DEC-'+n));
  assert.deepEqual(Object.fromEntries(votes.map(v=>[v.id.slice(-6),v.method])),{199432:'VOTE_HAND',199510:'VOTE_ELECTRONIC',199512:'VOTE_ELECTRONIC_ROLLCALL',199513:'VOTE_HAND'});
});
test('published tallies stay, unpublished ones stay null and never become zero',()=>{
  const by=id=>votes.find(v=>v.id.endsWith(id));
  assert.deepEqual(by('199510').aggregateTotals,{for:334,against:190,abstaining:31});
  assert.equal(by('199510').namedVotersAvailable,false);
  assert.deepEqual(by('199512').aggregateTotals,{for:556,against:null,abstaining:10});
  assert.deepEqual(by('199513').aggregateTotals,{for:null,against:null,abstaining:null});
  assert.equal(by('199513').outcome,'ADOPTED');
});
test('the decisions request carries no vote-method filter',()=>{
  const source=readFileSync(new URL('./insights-legislation.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\/decisions',\{[^}]*vote-method/);
});
test('participation keeps the roll calls with voter lists that the upstream roll-call filter returned, from the shared unfiltered read',()=>{
  // Observed on the 2026-10-22 record: the filter returned 76 of 94 roll-call decisions; the 18 absent had no had_voter_* field.
  const all={...decisions,payload:{data:[...decisions.payload.data,decision('199388','VOTE_ELECTRONIC_ROLLCALL','ADOPTED',{had_voter_favor:[],had_voter_against:[],had_voter_abstention:[]}),decision('199389','VOTE_ELECTRONIC_ROLLCALL','REJECTED')]}};
  assert.deepEqual(rollCallDecisions(all).payload.data.map(v=>v.activity_id.slice(-6)),['199512','199388']);
});
test('decided-on document links are exposed by exact id for the picker and the primary text',()=>{
  const by=id=>votes.find(v=>v.id.endsWith(id));
  assert.deepEqual(by('199513').decidedDocumentIds,[sitting+'-VOT-ITM-993352-SPLIT-4-2']);
  assert.deepEqual(by('199510').decidedDocumentIds,[]);
});
test('the vote cap bounds one item, so a large sitting keeps votes that sit late in its decision list',()=>{
  // 2026-10-21 published 400 decisions; slicing the sitting to 250 first dropped later items' votes.
  const filler=Array.from({length:300},(_,i)=>decision('1'+String(i).padStart(5,'0'),'VOTE_HAND','ADOPTED',{},[parent+'-FILLER']));
  const late=['199001','199002','199003'].map(n=>decision(n,'VOTE_HAND','ADOPTED'));
  const big={...decisions,payload:{data:[...filler,...decisions.payload.data,...late]}};
  const kept=boundedTopicVotes(topic,results,big,new Map(),new Map(),'2026-10-22',undefined,250);
  assert.equal(kept.truncated,false);
  assert(kept.votes.some(v=>v.id.endsWith('199003')),'a decision after position 250 is kept');
  assert.equal(kept.votes.length,7);
  const capped=boundedTopicVotes(topic,results,big,new Map(),new Map(),'2026-10-22',undefined,5);
  assert.equal(capped.truncated,true);assert.equal(capped.votes.length,5);
});
