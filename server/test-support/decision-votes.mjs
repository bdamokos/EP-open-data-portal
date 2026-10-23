import {readFileSync} from 'node:fs';
import {decisionVotes,decisionVotesQuery} from '../decision-votes.mjs';

// Contract scenarios derived from the retained public fixture. Voters, totals
// and amendment references below are deliberately reduced test inputs.
const fixture=JSON.parse(readFileSync(new URL('../fixtures/member-votes.json',import.meta.url)));
export const amendmentId='B-10-2026-0424-AM-114';
export const decisionId='MTG-PL-2026-10-07-DEC-197457';
export function voteFixture() {
  const day=structuredClone(fixture.snapshots[0]);
  const raw={...day.decisions[0],type:'Vote',decided_on_a_realization_of:['eli/dl/doc/'+amendmentId],
    had_voter_favor:['person/197591','person/124846'],had_voter_against:['person/197481'],had_voter_abstention:['person/256852'],
    had_voter_intended_against:['person/197591'],number_of_votes_favor:2,number_of_votes_against:1,number_of_votes_abstention:1};
  day.decisions=[raw];
  const member=(code,org)=>({coverage:'complete',mandateCoverage:'complete',mandates:[{start:'2024-07-16',end:null}],ambiguous:[],groups:[{code,org:'org/'+org,groupId:'org/'+code,start:'2024-07-16',end:null,membershipIds:['fixture-membership']}],url:'https://data.europarl.europa.eu/api/v2/meps/197591',retrievedAt:'2026-10-23T12:00:00Z',stale:false});
  const history={members:{'197591':member('S&D','7038'),'124846':member('Renew','7035'),'197481':member('PPE','7018'),'256852':member('NI','6561')},catalogue:{sources:[],bodies:[]}};
  const query=decisionVotesQuery(decisionId,new URLSearchParams({lang:'en'}),{now:Date.parse('2026-10-24')});
  let reads=0;
  const reader={async snapshot(received){reads++;if(received.sitting!==day.sittingId)throw Error('Wrong sitting');return {id:'a'.repeat(64),days:[day],coverage:{status:'complete'}};}};
  const store={status:()=>({servingGeneration:7}),get:()=> 'fixture-epoch',db:{prepare:()=>({get:()=>({body:JSON.stringify(history)})})}};
  return {day,raw,history,reader,store,query,reads:()=>reads,read:()=>decisionVotes(query,{reader,store})};
}
export function contradictoryVoteFixture(scenario) {
  const f=voteFixture(),parent=f.day.results.find(node=>node.id===f.raw.inverse_consists_of[0]);
  let indexed={id:decisionId,outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:2,against:1,abstaining:1}};
  if(scenario==='ambiguous-result-binding')f.day.results.push({...structuredClone(parent),id:parent.id.replace(/\d+$/,'999999'),activity_id:parent.activity_id.replace(/\d+$/,'999999'),consists_of:[f.raw.id]});
  else if(scenario==='conflicting-result-source')f.day.conflictingResults=[{...structuredClone(parent),activity_label:{en:'Contradictory source'}}];
  else if(scenario==='component-outside-result') {
    const part='MTG-PL-2026-10-07-VOT-ITM-999999-SPLIT-1-1',request='eli/dl/event/MTG-PL-2026-10-07-VOT-ITM-999999-SPLIT-1';
    f.raw.decided_on_a_realization_of.push('eli/dl/doc/'+part);
    f.day.results.push({id:'eli/dl/event/MTG-PL-2026-10-07-VOT-ITM-999999',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',was_motivated_by:[{id:request,had_activity_type:'def/ep-activities/REQUEST_VOTE_SPLIT',created_a_realization_of:[{id:'eli/dl/doc/'+part,number:1,expressionContent:{en:'<p>Exact part</p>'}}]}]});
    indexed={...indexed,partId:'eli/dl/doc/'+part,partNumber:1,componentBinding:'single-amendment'};
  }else throw Error('Unknown scenario');
  return {...f,indexed};
}
