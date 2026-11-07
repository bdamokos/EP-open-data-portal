import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaItemHref,agendaVoteRedirect,decisionVoterRows,differingByGroup,findMember,findableMembers,fullDate,itemVoteSections,longDate,membersByGroup,shortDate,dayDate,voteAmendmentWording,voteCentre,voteHref,voteOutcomeWord,voteRowLabel,voteSentence,voteSteps,wayLine} from './votePagePresentation.mjs';
import {splitVoteRequests} from './memberVotesPresentation.mjs';
import {readExplorerParam,explorerParams} from './explorerQuery.mjs';
import {defaultUi} from './uiDefault.mjs';

const render=sentence=>defaultUi.t(sentence.id,sentence.values)+(sentence.noNames?' '+defaultUi.t('votepage.no_names'):'');
const base={id:'D',date:'2026-10-22',ballotStatus:'conducted',method:'VOTE_ELECTRONIC_ROLLCALL',outcome:'ADOPTED',totals:{for:423,against:125,abstaining:32},scope:{kind:'amendment',basis:'exact-component-reference'},referenceTexts:{en:'Recital 3'},context:{amendmentIds:['A-10-2026-0257-AM-4']},parts:[]};
const noTally={for:null,against:null,abstaining:null};
const part=number=>({number,requestUri:'r',requestId:'r',requestScopeByLanguage:{en:'Am 4'}});
const main={...base,id:'M',context:{amendmentIds:[]},scope:{kind:'unclassified',basis:'unclassified'},referenceTexts:{en:'Commission proposal'},totals:{for:454,against:34,abstaining:93}};
const at=(vote,context={})=>render(voteSentence(vote,{language:'en',...context}));

test('every main-vote sentence, with the numbers flipped on rejection',()=>{
 const m={mainVoteId:'M'};
 assert.equal(at(main,m),'Parliament adopted this text by 454 to 34, with 93 abstaining.');
 assert.equal(at({...main,outcome:'REJECTED',totals:{for:34,against:454,abstaining:93}},m),'Parliament rejected this text by 454 to 34, with 93 abstaining.');
 assert.equal(at(main,{...m,procedureReferral:true}),'Parliament set its position on 22 October 2026: 454 to 34, with 93 abstaining. The file went back to committee for talks with the Council.');
 assert.equal(at({...main,method:'VOTE_HAND',totals:noTally},m),'Adopted by show of hands. No count and no names.');
 assert.equal(at({...main,method:'VOTE_HAND',totals:noTally,outcome:'REJECTED'},m),'Rejected by show of hands. No count and no names.');
 assert.equal(at({...main,method:'VOTE_HAND',totals:noTally},{...m,procedureReferral:true}),'Parliament set its position on 22 October 2026 by show of hands. The file went back to committee for talks with the Council.');
 assert.equal(at({...main,method:null,totals:noTally},m),'Adopted. No count and no names.');
 assert.equal(at({...main,method:null,totals:noTally,outcome:'REJECTED'},m),'Rejected. No count and no names.');
 assert.equal(at({...main,outcome:'REJECTED'},{...m,procedureReferral:true}),'Parliament rejected this text by 34 to 454, with 93 abstaining.','referral needs adoption');
 assert.equal(at(main,{mainVoteId:'other',procedureReferral:true}),'Commission proposal: adopted by 454 to 34, with 93 abstaining.','referral belongs to the main vote');
});
test('every amendment and part sentence, on exact references only',()=>{
 const am=fields=>at({...base,...fields});
 assert.equal(am({}),'Parliament adopted amendment 4 by 423 to 125, with 32 abstaining.');
 assert.equal(am({outcome:'REJECTED',totals:{for:179,against:399,abstaining:4},context:{amendmentIds:['A-10-2026-0257-AM-174']}}),'Parliament rejected amendment 174 by 399 to 179, with 4 abstaining.');
 assert.equal(am({method:'VOTE_HAND',totals:noTally}),'Parliament adopted amendment 4 by show of hands.');
 assert.equal(am({method:'VOTE_HAND',totals:noTally,outcome:'REJECTED'}),'Parliament rejected amendment 4 by show of hands.');
 assert.equal(am({parts:[part('2')]}),'Parliament adopted part 2 of amendment 4 by 423 to 125, with 32 abstaining.');
 assert.equal(am({parts:[part('2')],outcome:'REJECTED',totals:{for:125,against:423,abstaining:32}}),'Parliament rejected part 2 of amendment 4 by 423 to 125, with 32 abstaining.');
 assert.equal(am({parts:[part('1')],method:'VOTE_HAND',totals:noTally}),'Parliament adopted part 1 of amendment 4 by show of hands.');
 assert.equal(am({parts:[part('1')],method:'VOTE_HAND',totals:noTally,outcome:'REJECTED'}),'Parliament rejected part 1 of amendment 4 by show of hands.');
 assert.equal(am({ballotStatus:'not-conducted',outcome:'LAPSED',totals:noTally}),'Amendment 4 lapsed.');
 assert.equal(am({ballotStatus:'not-conducted',outcome:'LAPSED',totals:noTally,parts:[part('2')]}),'Part 2 of amendment 4 lapsed.');
 assert.equal(am({ballotStatus:'not-conducted',outcome:null,totals:noTally}),'No vote held on amendment 4.');
 assert.equal(am({ballotStatus:'not-conducted',outcome:null,totals:noTally,parts:[part('2')]}),'No vote held on part 2 of amendment 4.');
 assert.equal(am({method:'VOTE_ELECTRONIC',outcome:'REJECTED',totals:{for:170,against:395,abstaining:14}}),'Parliament rejected amendment 4 by 395 to 170, with 14 abstaining. No names.');
 assert.equal(am({totals:{for:1,against:null,abstaining:2}}),'Amendment 4: Recital 3: adopted.','a partial tally is not a tally');
});
test('anything else uses its label, and no result stays no result',()=>{
 const other={...base,context:{amendmentIds:[]},scope:{kind:'procedural',basis:'x'},referenceTexts:{en:'Request for referral'}};
 assert.equal(at(other),'Request for referral: adopted by 423 to 125, with 32 abstaining.');
 assert.equal(at({...other,outcome:'REJECTED'}),'Request for referral: rejected by 125 to 423, with 32 abstaining.');
 assert.equal(at({...other,method:'VOTE_HAND',totals:noTally}),'Request for referral: adopted.');
 assert.equal(at({...other,method:'VOTE_HAND',totals:noTally,outcome:'REJECTED'}),'Request for referral: rejected.');
 assert.equal(at({...other,ballotStatus:'not-conducted',outcome:'LAPSED',totals:noTally}),'Request for referral: lapsed.');
 assert.equal(at({...other,ballotStatus:'unknown',outcome:null,totals:noTally}),'No result on record.');
 assert.equal(at({...other,ballotStatus:'not-conducted',outcome:null,totals:noTally}),'No result on record.');
 assert.equal(render(voteSentence({...main,method:'VOTE_ELECTRONIC'},{mainVoteId:'M',language:'en'})),'Parliament adopted this text by 454 to 34, with 93 abstaining. No names.');
});
test('a deal vote with an amendment reference reads as the main vote',()=>{
 const deal={...base,id:'P',referenceTexts:{en:'Provisional agreement'},context:{amendmentIds:['A-10-2026-0104-AM-118']},totals:{for:477,against:59,abstaining:41}};
 assert.equal(at(deal,{mainVoteId:'P'}),'Parliament adopted this text by 477 to 59, with 41 abstaining.');
 assert.equal(at({...deal,id:'A'},{mainVoteId:'P'}),'Parliament adopted amendment 118 by 477 to 59, with 41 abstaining.');
 assert.equal(voteCentre(deal,{mainVoteId:'P'}).small,null);
});
test('row labels follow the design: final vote, amendment, part, block, source label',()=>{
 assert.equal(voteRowLabel(main,'en',defaultUi,{mainVoteId:'M'}),'Final vote');
 assert.equal(voteRowLabel(base,'en'),'Amendment 4: Recital 3');
 assert.equal(voteRowLabel({...base,parts:[part('2')]},'en'),'Amendment 4, part 2: Recital 3');
 assert.equal(voteRowLabel({...base,referenceTexts:{en:'Article 3 – Am 174'}},'en'),'Amendment 4: Article 3');
 assert.equal(voteRowLabel({...base,referenceTexts:{en:'Amendments by the committee responsible'}},'en'),'Amendment 4');
 assert.equal(voteRowLabel({...base,referenceTexts:{en:'Amendments by the committee responsible'},parts:[part('2')]},'en'),'Amendment 4, part 2');
 assert.equal(voteRowLabel({...base,context:{amendmentIds:['A-10-2026-0257-AM-1','A-10-2026-0257-AM-2','A-10-2026-0257-AM-3']}},'en'),'3 amendments, block vote');
 assert.equal(voteRowLabel({...base,context:{amendmentIds:[]},referenceTexts:{en:'§ 1'},parts:[part('2')]},'en'),'§ 1, part 2');
 assert.equal(voteRowLabel({...base,context:{amendmentIds:[]},referenceTexts:{en:'§ 1/2'},parts:[part('2')]},'en'),'§ 1/2');
 assert.equal(voteRowLabel({...base,context:{amendmentIds:[]},referenceTexts:{en:'B10-0478/2026'}},'en'),'B10-0478/2026');
});
test('the outcome word and the chart centre',()=>{
 assert.deepEqual(['ADOPTED','REJECTED','LAPSED'].map(outcome=>voteOutcomeWord({outcome,ballotStatus:'conducted'})),['Adopted','Rejected','Lapsed']);
 assert.equal(voteOutcomeWord({outcome:null,ballotStatus:'not-conducted'}),'No vote held');
 assert.equal(voteOutcomeWord({outcome:null,ballotStatus:'unknown'}),null);
 assert.equal(voteCentre({...base,parts:[part('2')]}).small,'Part 2 of amendment 4');
 assert.equal(voteCentre(base).small,'Amendment 4');
 assert.equal(voteCentre(main,{mainVoteId:'M',procedureReferral:true}).small,'Back to committee for talks with the Council');
 const resolution={...main,title:'RC-B10-0476/2026 – Motion for a resolution (as a whole)',titleLanguage:'en'};
 assert.deepEqual(voteCentre(resolution,{mainVoteId:'M'}),{word:'Adopted',small:'Motion for a resolution (as a whole)',smallLanguage:'en'});
});
test('dates read day, month, year in English',()=>{
 assert.equal(longDate('2026-10-22','en'),'22 October 2026');
 assert.equal(fullDate('2026-10-22','en'),'Thursday 22 October 2026');
 assert.equal(dayDate('2026-10-22','en'),'Thursday 22 October');
 assert.equal(shortDate('2026-10-22','en'),'Thu 22 Oct');
});
const voter=(personId,position,code)=>({personId,position,status:'recorded',group:code?{code,orgId:'o',groupId:'g'}:null,groupStatus:code?'verified':'unavailable',groupSource:null});
const decision={namedVoters:{available:true}};
test('voters become rows; unknown people are not guessed and conflicts stay out',()=>{
 const data={integrity:'complete',decision,people:{'3':{name:'Former Member',country:'HU'}},voters:[voter('1','for','PPE'),voter('3','for',null),{...voter('4',null,'PPE'),status:'conflicting'}]};
 const rows=decisionVoterRows(data,new Map([['1',{countryCode:'MT'}]]),id=>id==='1'?'Known Member':null);
 assert.deepEqual(rows,[{id:'1',name:'Known Member',country:'MT',group:'PPE',position:'for'},{id:'3',name:'Former Member',country:'HU',group:'unavailable',position:'for'}]);
 assert.deepEqual(decisionVoterRows({...data,integrity:'conflicting'}),[]);
 assert.deepEqual(decisionVoterRows({...data,decision:{namedVoters:{available:false}}}),[]);
 const people=findableMembers(rows,{ids:['9','8'],groups:['NI','S&D']},{people:{'9':{name:'Absent Person',country:'FR'}}});
 assert.deepEqual(people.at(-1),{id:'9',name:'Absent Person',country:'FR',group:'NI',position:null},'a member with no name cannot be found');
 assert.equal(people.length,3);
 assert.equal(findMember(people,'k'),null);
 assert.equal(findMember(people,'absent person').id,'9');
 assert.equal(findMember(people,'mémber').id,'1');
 assert.equal(findMember(people,'nobody'),null);
});
const rows=[...Array.from({length:4},(_,i)=>({id:'p'+i,name:'P Zed'+i,group:'PPE',position:'for'})),{id:'p9',name:'Ann Abel',group:'PPE',position:'against'},{id:'s1',name:'S One',group:'S&D',position:'for'},{id:'s2',name:'S Two',group:'S&D',position:'against'},{id:'n1',name:'N One',group:'NI',position:'against'},{id:'e1',name:'E One',group:'ESN',position:'abstaining'}];
test('the way line follows group majorities: NI out, ties under Split',()=>{
 assert.deepEqual(wayLine(rows,['PPE','S&D','ESN','NI']),{for:['PPE'],against:[],abstaining:['ESN'],split:['S&D']});
});
test('members list minority positions first, by surname; only real majorities differ',()=>{
 const entries=membersByGroup(rows,['PPE','S&D','ESN','NI']);
 assert.deepEqual(entries.map(entry=>entry.code),['PPE','S&D','ESN','NI']);
 assert.deepEqual(entries[0].positions.map(line=>[line.position,line.people.length]),[['against',1],['for',4]]);
 assert.deepEqual(entries[1].positions.map(line=>line.position),['for','against'],'a tied group keeps the fixed order');
 const differ=differingByGroup(rows,new Set(['p9']),['PPE','S&D','ESN','NI']);
 assert.deepEqual(differ.map(entry=>[entry.code,entry.count]),[['PPE',1]]);
});
test('item votes fall into sections with the main vote first, and the steps follow them',()=>{
 const v=(id,fields)=>({id,totals:noTally,ballotStatus:'conducted',outcome:'ADOPTED',...fields});
 const votes=[v('a',{totals:{for:1,against:2,abstaining:0}}),v('h',{method:'VOTE_HAND'}),v('m',{method:'VOTE_HAND'}),v('l',{ballotStatus:'not-conducted',outcome:'LAPSED'}),v('n',{ballotStatus:'not-conducted',outcome:null})];
 const sections=itemVoteSections(votes,'m');
 assert.deepEqual(sections.map(section=>[section.key,section.votes.map(row=>row.id)]),[['counted',['a']],['hands',['m','h']],['lapsed',['l']],['not_held',['n']]]);
 assert.equal(sections.flatMap(section=>section.votes).length,votes.length,'every row, no preview cut');
 assert.deepEqual(voteSteps(votes,'m','a'),{previous:null,next:'m'});
 assert.deepEqual(voteSteps(votes,'m','h'),{previous:'m',next:'l'});
 assert.deepEqual(voteSteps(votes,'m','n'),{previous:'l',next:null});
 assert.deepEqual(voteSteps(votes,'m','missing'),{previous:null,next:null});
 const methods=itemVoteSections([v('p',{method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:3,against:null,abstaining:1}}),v('e',{method:'VOTE_ELECTRONIC'}),v('r',{method:'VOTE_ELECTRONIC_ROLLCALL'}),v('u',{method:null}),v('c',{method:null,ballotStatus:'unknown',outcome:null})],null);
 assert.deepEqual(methods.map(section=>[section.key,section.votes.map(row=>row.id)]),[['counted',['p']],['no_count',['e','r','u','c']]],'a missing tally never becomes a show of hands');
});
test('the amendment wording is plain; differing versions keep their chooser',()=>{
 const variant={wordingStatus:'available',proposedText:'(3)\tThe text.',language:'en',targetLabel:'Article 3 – paragraph 1',targetLabelLanguage:'en'};
 assert.deepEqual(voteAmendmentWording([variant],base),{state:'text',language:'en',text:'The text.',heading:'Amendment 4, article 3 – paragraph 1'});
 assert.equal(voteAmendmentWording([{...variant,targetLabelLanguage:'de',targetLabel:'Artikel 3'}],base).heading,'Amendment 4, Artikel 3');
 assert.equal(voteAmendmentWording([{...variant,targetLabel:null}],base).heading,'Amendment 4');
 assert.equal(voteAmendmentWording([variant,{...variant,proposedText:'Other.'}],base).state,'versions');
 assert.equal(voteAmendmentWording([variant,{...variant}],base).state,'text');
 assert.equal(voteAmendmentWording([{...variant,wordingStatus:'unavailable'}],base).state,'none');
});
test('split requests hold every part in order and mark this vote',()=>{
 const component=(number,text)=>({componentId:'c'+number,number,requestUri:'r',contentByLanguage:{en:{text,sourceLiteral:text}}});
 const own={...component('2','those words'),contextComponents:[component('2','those words'),component('1','Text as a whole without the words')]};
 const [request]=splitVoteRequests([own]);
 assert.deepEqual(request.parts.map(row=>[row.number,row.current]),[['1',false],['2',true]]);
 const [single]=splitVoteRequests([{...component('1','Only part'),contextComponents:[]}]);
 assert.equal(single.parts.length,1);
 assert.equal(splitVoteRequests([]).length,0);
});
test('the vote route is a fixed URL and pl-vote accepts only exact decision identifiers',()=>{
 assert.equal(voteHref('MTG-PL-2026-10-22-DEC-199360','en'),'?view=legislation&pl-mode=vote&pl-vote=MTG-PL-2026-10-22-DEC-199360&lang=en');
 assert.equal(agendaItemHref('MTG-PL-2026-10-22-OJ-ITM-V-52','en'),'?view=legislation&agenda-period=sitting%3AMTG-PL-2026-10-22&agenda-topic=MTG-PL-2026-10-22-OJ-ITM-V-52&lang=en');
 const query=value=>new URLSearchParams({view:'legislation','pl-mode':'vote','pl-vote':value});
 assert.equal(readExplorerParam(query('MTG-PL-2026-10-22-DEC-199360'),'pl-vote',''),'MTG-PL-2026-10-22-DEC-199360');
 assert.equal(readExplorerParam(query('not-a-decision'),'pl-vote',''),'');
 assert.equal(explorerParams(query('MTG-PL-2026-10-22-DEC-199360'),'legislation').get('pl-vote'),'MTG-PL-2026-10-22-DEC-199360');
});
test('an old agenda address with a chosen vote moves to the vote page',()=>{
 assert.equal(agendaVoteRedirect('?view=legislation&agenda-topic=X&agenda-vote=MTG-PL-2026-10-22-DEC-199360&lang=de'),voteHref('MTG-PL-2026-10-22-DEC-199360','de'));
 assert.equal(agendaVoteRedirect('?agenda-topic=X'),null);
 assert.equal(agendaVoteRedirect('?agenda-vote=MTG-PL-2026-10-22-DEC-199360'),null);
 assert.equal(agendaVoteRedirect('?agenda-topic=X&agenda-vote=bad'),null);
});

test('a part vote whose part cannot be named takes the source label, never the whole amendment',()=>{
 const page={mainVoteId:'M'};
 const unnamed={...base,scope:{kind:'split-part',basis:'exact-component-reference'},parts:[],referenceTexts:{en:'Recital 3 – Am 4/2'}};
 assert.equal(render(voteSentence(unnamed,page)),'Recital 3 – Am 4/2: adopted by 423 to 125, with 32 abstaining.');
 assert.equal(voteRowLabel(unnamed,'en'),'Recital 3 – Am 4/2');
 const several={...unnamed,parts:[part('1'),part('2')]};
 assert.equal(render(voteSentence(several,page)),'Recital 3 – Am 4/2: adopted by 423 to 125, with 32 abstaining.');
 assert.equal(render(voteSentence({...unnamed,parts:[part('2')]},page)),'Parliament adopted part 2 of amendment 4 by 423 to 125, with 32 abstaining.');
});
