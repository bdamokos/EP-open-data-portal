import test from 'node:test';
import assert from 'node:assert/strict';
import {voteFixture} from './test-support/decision-votes.mjs';
import {createGroupOn} from './group-attribution.mjs';
import {memberVoteAlignment} from './member-votes-model.mjs';
import {memberVoteRecordRevision,summariseVoteSitting,pickTitle,voteGroupLines} from './member-vote-record-model.mjs';

const DATE='2026-10-07',DOCUMENT='PV-10-2026-10-07-VOT-ITM-007';

function person(group,{end=null,groups=[],mandates=[{start:'2024-07-16',end:null}]}={}) {
  const periods=groups.length?groups:[{code:group,org:'org/'+group,groupId:'org/'+group,start:'2024-07-16',end}];
  return {coverage:'complete',mandateCoverage:'complete',mandates,ambiguous:[],groups:periods};
}
function history(people) {
  return {members:Object.fromEntries(Object.entries(people).map(([id,value])=>[String(id),value])),catalogue:{sources:[],bodies:[]}};
}
const groupsOf=people=>history(Object.fromEntries(Object.entries(people).map(([id,group])=>[id,person(group)])));

// Builds one or more synthetic decisions over the retained public fixture. The
// raw voter arrays are the only observations the projection may read.
function sitting(decisions,{complete=true,chairing}={}) {
  const fixture=voteFixture(),base=structuredClone(fixture.raw),baseResult=structuredClone(fixture.day.results.find(node=>node.activity_id===base.inverse_consists_of[0].split('/').pop()));
  const raw=[],results=[];
  decisions.forEach((decision,index)=>{
    const item=structuredClone(base),id='MTG-PL-2026-10-07-DEC-'+(900+index);
    item.activity_id=id;item.id='eli/dl/event/'+id;
    item.referenceText={en:decision.reference||'Motion for a resolution (as a whole)'};
    item.activity_label={en:decision.reference||'Motion for a resolution (as a whole)'};
    item.decision_outcome='def/ep-statuses/'+(decision.outcome||'ADOPTED');
    delete item.decided_on_a_realization_of;
    delete item.had_voter_intended_favor;delete item.had_voter_intended_against;delete item.had_voter_intended_abstention;
    for(const [position,field] of [['for','had_voter_favor'],['against','had_voter_against'],['abstaining','had_voter_abstention']]) {
      item[field]=(decision[position]||[]).map(value=>'person/'+value);
      item['number_of_votes_'+position]=(decision[position]||[]).length;
    }
    const resultId='MTG-PL-2026-10-07-VOT-ITM-'+(900+index);
    item.inverse_consists_of=['eli/dl/event/'+resultId];
    const result={...structuredClone(baseResult),id:'eli/dl/event/'+resultId,activity_id:resultId,consists_of:['eli/dl/event/'+id],recorded_in_a_realization_of:['eli/dl/doc/'+DOCUMENT]};
    raw.push(item);results.push(result);
  });
  fixture.day.decisions=raw;fixture.day.results=results;
  fixture.day.coverage={completeness:{complete}};
  if(chairing)fixture.day.chairing={status:'observed',byResultDocument:{[DOCUMENT]:String(chairing)},sources:[]};
  return {day:fixture.day,groupOn:createGroupOn(fixture.history)};
}

test('alignment counts voters against the largest position within their own group',()=>{
  const people=groupsOf({1:'S&D',2:'S&D',3:'S&D',4:'S&D',5:'Renew',6:'PPE',7:'NI'});
  const day=sitting([{for:[1,2,5],against:[3,6],abstaining:[4,7]}]);
  const summary=summariseVoteSitting(day.day,createGroupOn(people),{groupGeneration:'g1'});
  const member=id=>summary.members.get(String(id));
  // S&D has two for, one against and one abstention: its line is "for".
  assert.deepEqual(member(1).alignment,{with:1,against:0,abstained:0,notComparable:0});
  assert.deepEqual(member(1).bySitting,{sittingId:'MTG-PL-2026-10-07',date:DATE,withGroup:1,comparable:1,finalWithGroup:1,finalComparable:1});
  assert.deepEqual(member(3).alignment,{with:0,against:1,abstained:0,notComparable:0});
  assert.deepEqual(member(3).departures,[{decisionId:'MTG-PL-2026-10-07-DEC-900',date:DATE,wholeText:true,position:'against',line:'for'}]);
  assert.deepEqual(member(4).alignment,{with:0,against:0,abstained:1,notComparable:0});
  // A single-voter group makes that voter's position the line.
  assert.deepEqual(member(6).alignment,{with:1,against:0,abstained:0,notComparable:0});
  assert.equal(summary.sitting.named,1);
  assert.equal(member(1).ballots.named,1);
});

test('whole-text counts split from all comparable votes while all-vote counts stay whole',()=>{
  const people=groupsOf({1:'S&D',2:'S&D',3:'S&D'});
  const day=sitting([{for:[1,2],against:[3]},{reference:'Amendment 4',for:[1,2],against:[3]}]);
  const summary=summariseVoteSitting(day.day,createGroupOn(people),{groupGeneration:'g1'});
  const member=summary.members.get('3');
  assert.deepEqual(member.alignment,{with:0,against:2,abstained:0,notComparable:0});
  assert.deepEqual(member.wholeText,{with:0,against:1,abstained:0,notComparable:0});
  assert.deepEqual(member.departures.map(item=>item.wholeText),[true,false]);
  assert.equal(summary.sitting.decisions['MTG-PL-2026-10-07-DEC-901'].scope,'amendment');
  assert.equal(summary.sitting.decisions['MTG-PL-2026-10-07-DEC-900'].scope,'whole-text');
});

test('non-attached members record ballots without a group line or departure',()=>{
  const people=groupsOf({1:'S&D',7:'NI'}),day=sitting([{for:[1],against:[7]}]);
  const member=summariseVoteSitting(day.day,createGroupOn(people),{groupGeneration:'g1'}).members.get('7');
  assert.equal(member.groupCode,null);
  assert.deepEqual(member.alignment,{with:0,against:0,abstained:0,notComparable:1});
  assert.deepEqual(member.bySitting,{sittingId:'MTG-PL-2026-10-07',date:DATE,withGroup:null,comparable:null,finalWithGroup:null,finalComparable:null});
  assert.deepEqual(member.departures,[]);
  assert.equal(member.ballots.recorded,1);
});

test('a tied group position has no line, so no voter departs from it',()=>{
  assert.deepEqual(voteGroupLines([{position:'for',status:'recorded',group:{code:'S&D'}},{position:'against',status:'recorded',group:{code:'S&D'}}]),new Map([['S&D',null]]));
  const people=groupsOf({1:'S&D',2:'S&D'}),day=sitting([{for:[1],against:[2]}]);
  const summary=summariseVoteSitting(day.day,createGroupOn(people),{groupGeneration:'g1'});
  for(const id of ['1','2']) {
    const member=summary.members.get(id);
    assert.deepEqual(member.alignment,{with:0,against:0,abstained:0,notComparable:1});
    assert.deepEqual(member.bySitting,{sittingId:'MTG-PL-2026-10-07',date:DATE,withGroup:null,comparable:null,finalWithGroup:null,finalComparable:null});
    assert.deepEqual(member.departures,[]);
  }
});

test('a chairing member gains a chaired ballot without being counted absent',()=>{
  const people=groupsOf({1:'S&D',2:'S&D',999:'S&D'}),day=sitting([{for:[1],against:[2]}],{chairing:999});
  const member=summariseVoteSitting(day.day,createGroupOn(people),{groupGeneration:'g1'}).members.get('999');
  assert.deepEqual(member.ballots,{recorded:0,named:1,chaired:1});
  assert.deepEqual(member.bySitting,{sittingId:'MTG-PL-2026-10-07',date:DATE,withGroup:null,comparable:null,finalWithGroup:null,finalComparable:null});
  assert.deepEqual(member.alignment,{with:0,against:0,abstained:0,notComparable:0});
});

test('mid-term entry dates attach a member and a finished mandate stays distinct from non-attachment',()=>{
  const people=history({
    1:person('S&D'),
    9:person('S&D',{mandates:[{start:'2026-10-07',end:null}]}),
    10:person('S&D',{mandates:[{start:'2024-07-16',end:'2026-10-06'}]}),
  });
  const day=sitting([{for:[1,9],against:[10]}]);
  const summary=summariseVoteSitting(day.day,createGroupOn(people),{groupGeneration:'g1'});
  assert.equal(summary.members.get('9').groupCode,'S&D');
  assert.equal(summary.members.get('9').bySitting.withGroup,1);
  // A recorded ballot after the mandate ended is not a zero; it has no line.
  assert.equal(summary.members.get('10').groupCode,null);
  assert.deepEqual(summary.members.get('10').bySitting,{sittingId:'MTG-PL-2026-10-07',date:DATE,withGroup:null,comparable:null,finalWithGroup:null,finalComparable:null});
  assert.equal(summary.members.get('10').alignment.notComparable,1);
});

test('a mid-term group switch resolves at the sitting date and overlapping groups stay ambiguous',()=>{
  const people=history({
    2:person('Renew'),
    11:person('Renew',{groups:[
      {code:'S&D',org:'org/S&D',groupId:'org/S&D',start:'2024-07-16',end:'2026-09-30'},
      {code:'Renew',org:'org/Renew',groupId:'org/Renew',start:'2026-10-01',end:null},
    ]}),
    12:person('S&D',{groups:[
      {code:'S&D',org:'org/S&D',groupId:'org/S&D',start:'2024-07-16',end:null},
      {code:'Renew',org:'org/Renew',groupId:'org/Renew',start:'2026-10-01',end:null},
    ]}),
  });
  const day=sitting([{for:[11,2],against:[12]}]);
  const summary=summariseVoteSitting(day.day,createGroupOn(people),{groupGeneration:'g1'});
  assert.equal(summary.members.get('11').groupCode,'Renew');
  // Renew's line is "for": the switched member is with it, not against S&D.
  assert.deepEqual(summary.members.get('11').alignment,{with:1,against:0,abstained:0,notComparable:0});
  assert.deepEqual(summary.members.get('11').departures,[]);
  assert.equal(summary.members.get('12').groupCode,null);
  assert.deepEqual(summary.members.get('12').alignment,{with:0,against:0,abstained:0,notComparable:1});
});

test('an empty or unrecorded sitting stores no member rows',()=>{
  const day=sitting([]);
  const summary=summariseVoteSitting(day.day,createGroupOn(groupsOf({1:'S&D'})),{groupGeneration:'g1'});
  assert.equal(summary.members.size,0);
  assert.equal(summary.sitting.named,0);
  assert.deepEqual(summary.sitting.decisions,{});
  assert.equal(summary.sitting.complete,true);
});

test('the projection revision changes only with the sitting content, completeness or group generation',()=>{
  const day=sitting([{for:[1],against:[2]}]),groupOn=createGroupOn(groupsOf({1:'S&D',2:'S&D'}));
  const first=summariseVoteSitting(day.day,groupOn,{groupGeneration:'g1'});
  assert.equal(first.revision,memberVoteRecordRevision(day.day,'g1'));
  assert.equal(first.revision,summariseVoteSitting(structuredClone(day.day),groupOn,{groupGeneration:'g1'}).revision);
  assert.notEqual(first.revision,memberVoteRecordRevision(day.day,'g2'));
  assert.notEqual(first.revision,memberVoteRecordRevision({...structuredClone(day.day),date:'2026-10-08'},'g1'));
  assert.notEqual(first.revision,memberVoteRecordRevision({...structuredClone(day.day),coverage:{completeness:{complete:false}}},'g1'));
  day.day.decisions[0].had_voter_abstention=['person/3'];
  assert.notEqual(first.revision,memberVoteRecordRevision(day.day,'g1'));
});

test('titles prefer the requested language, then English, then any available text',()=>{
  assert.deepEqual(pickTitle({fr:'Texte',en:'Text'},{fr:'Réf'},'fr'),{text:'Texte',language:'fr'});
  assert.deepEqual(pickTitle({fr:'Texte'},{},'hu'),{text:'Texte',language:'fr'});
  assert.deepEqual(pickTitle({},{en:'Reference'},'hu'),{text:'Reference',language:'en'});
  assert.deepEqual(pickTitle({fr:'  '},{},'hu'),{text:null,language:null});
  assert.deepEqual(pickTitle({hu:'Szöveg',mul:'A-1 - § 4 - Am 4',fr:'A-1 - § 4 - Am 4'},{en:'§ 4'},'en'),{text:'A-1 - § 4 - Am 4',language:'mul'},'the language-neutral label beats an arbitrary translation');
  assert.deepEqual(pickTitle({hu:'Szöveg'},{en:'§ 4'},'en'),{text:'Szöveg',language:'hu'},'a title in any language still comes before reference wording');
});

test('an abstention is with the group when the group line is to abstain, and a departure otherwise',()=>{
  const people=groupsOf({1:'S&D',2:'S&D',3:'S&D',4:'PPE'});
  const summary=summariseVoteSitting(sitting([{for:[3],abstaining:[1,2,4]}]).day,createGroupOn(people),{groupGeneration:'g1'});
  const member=id=>summary.members.get(String(id));
  assert.deepEqual(member(1).alignment,{with:1,against:0,abstained:0,notComparable:0});
  assert.deepEqual(member(3).alignment,{with:0,against:1,abstained:0,notComparable:0});
  assert.equal(member(3).departures[0].line,'abstaining');
  assert.equal(memberVoteAlignment({ballotStatus:'conducted',actualPosition:{status:'recorded',position:'abstaining'}},'for'),'abstained');
});
