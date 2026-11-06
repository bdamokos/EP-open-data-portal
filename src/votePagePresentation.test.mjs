import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaItemHref,namedVoteFromDecision,voteHref,voteRowLabel,voteRowResult,voteSentence} from './votePagePresentation.mjs';
import {splitVoteRequests} from './memberVotesPresentation.mjs';
import {readExplorerParam,explorerParams} from './explorerQuery.mjs';
import {defaultUi} from './uiDefault.mjs';

const render=sentence=>defaultUi.t(sentence.id,{item:'Erasmus+ programme 2028-2034',...sentence.values})+(sentence.noNames?' '+defaultUi.t('votepage.no_names'):'');
const base={id:'D',ballotStatus:'conducted',method:'VOTE_ELECTRONIC_ROLLCALL',outcome:'ADOPTED',totals:{for:423,against:125,abstaining:32},scope:{kind:'amendment',basis:'exact-component-reference'},referenceTexts:{en:'Amendments by the committee responsible – separate vote'},context:{amendmentIds:['A-10-2026-0257-AM-4']},parts:[]};
const noTally={for:null,against:null,abstaining:null};
const part=number=>({number,requestUri:'r',requestId:'r',requestScopeByLanguage:{en:'Am 4'}});
const page={itemTitle:'Erasmus+ programme 2028-2034',language:'en'};
test('split parts read as the spec on exact part and amendment references',()=>{
 assert.equal(render(voteSentence({...base,parts:[part('2')]},page)),'Part 2 of amendment 4 was adopted: 423 for, 125 against, 32 abstaining.');
 assert.equal(render(voteSentence({...base,method:'VOTE_HAND',totals:noTally,parts:[part('1')]},page)),'Part 1 of amendment 4 was adopted by show of hands. No names on record.');
});
test('amendments read adopted, rejected, by show of hands, without names and not put to a vote',()=>{
 const am=fields=>render(voteSentence({...base,...fields},page));
 assert.equal(am({outcome:'REJECTED',totals:{for:179,against:399,abstaining:4},context:{amendmentIds:['A-10-2026-0257-AM-174']}}),'Amendment 174 was rejected: 179 for, 399 against, 4 abstaining.');
 assert.equal(am({method:'VOTE_HAND',totals:noTally}),'Amendment 4 was adopted by show of hands. No names on record.');
 assert.equal(am({method:'VOTE_ELECTRONIC',outcome:'REJECTED',totals:{for:170,against:395,abstaining:14}}),'Amendment 4 was rejected: 170 for, 395 against, 14 abstaining. No names on record.');
 assert.equal(am({ballotStatus:'not-conducted',outcome:'LAPSED',totals:noTally}),'Amendment 4 was not put to a vote.');
 assert.equal(am({totals:{for:1,against:null,abstaining:2}}),'Amendment 4 was adopted.','a partial tally is not a tally');
});
test('the main vote names the item; referral comes only from the exact event flag',()=>{
 const main={...base,id:'M',context:{amendmentIds:[]},scope:{kind:'unclassified',basis:'unclassified'},referenceTexts:{en:'Commission proposal'},totals:{for:454,against:34,abstaining:93}};
 assert.equal(render(voteSentence(main,{...page,mainVoteId:'M',procedureReferral:true})),'Parliament set its position on Erasmus+ programme 2028-2034: 454 for, 34 against, 93 abstaining. The file went back to committee for talks with the Council.');
 assert.equal(render(voteSentence(main,{...page,mainVoteId:'M'})),'Parliament adopted Erasmus+ programme 2028-2034: 454 for, 34 against, 93 abstaining.');
 assert.equal(render(voteSentence({...main,outcome:'REJECTED'},{...page,mainVoteId:'M',procedureReferral:true})),'Parliament rejected Erasmus+ programme 2028-2034: 454 for, 34 against, 93 abstaining.');
 assert.equal(render(voteSentence({...main,method:'VOTE_HAND',totals:noTally},{...page,mainVoteId:'M'})),'Parliament adopted Erasmus+ programme 2028-2034 by show of hands. No names on record.');
 assert.equal(render(voteSentence(main,{...page,mainVoteId:'other',procedureReferral:true})),'Commission proposal: Adopted, 454 for, 34 against, 93 abstaining.','referral belongs to the main vote');
});
test('a deal vote with an amendment reference reads as the main vote; its amendment variants do not',()=>{
 const deal={...base,id:'P',referenceTexts:{en:'Provisional agreement'},context:{amendmentIds:['A-10-2026-0104-AM-118']},totals:{for:477,against:59,abstaining:41}};
 assert.equal(render(voteSentence(deal,{...page,mainVoteId:'P'})),'Parliament adopted Erasmus+ programme 2028-2034: 477 for, 59 against, 41 abstaining.');
 assert.equal(render(voteSentence({...deal,outcome:'REJECTED'},{...page,mainVoteId:'P'})),'Parliament rejected Erasmus+ programme 2028-2034: 477 for, 59 against, 41 abstaining.');
 assert.equal(render(voteSentence({...deal,id:'A',referenceTexts:{en:'Provisional agreement - Am 118'}},{...page,mainVoteId:'P'})),'Amendment 118 was adopted: 477 for, 59 against, 41 abstaining.');
});
test('anything else uses its source label; a block vote never lists every amendment',()=>{
 const block={...base,method:'VOTE_HAND',totals:noTally,referenceTexts:{en:'Amendments by the committee responsible – block vote'},context:{amendmentIds:['A-10-2026-0257-AM-1','A-10-2026-0257-AM-2']}};
 assert.equal(voteRowLabel(block,'en'),'Amendments by the committee responsible – block vote');
 assert.equal(render(voteSentence(block,page)),'Amendments by the committee responsible – block vote: Adopted. No names on record.');
 assert.equal(render(voteSentence({...base,ballotStatus:'not-conducted',outcome:'LAPSED',method:'VOTE_HAND',totals:noTally,scope:{kind:'unclassified',basis:'unclassified'},referenceTexts:{en:'Recital 16'},context:{amendmentIds:[]}},page)),'Recital 16: Lapsed.');
 assert.equal(voteRowLabel({...base,parts:[part('2')]},'en'),'Amendment 4 · Part 2');
});
test('rows show a tally, show of hands, not put to a vote or nothing',()=>{
 assert.deepEqual(voteRowResult(base),{text:'423–125–32',label:'423 for, 125 against, 32 abstaining'});
 assert.deepEqual(voteRowResult({...base,method:'VOTE_HAND',totals:noTally}),{text:'Show of hands',label:null});
 assert.deepEqual(voteRowResult({...base,ballotStatus:'not-conducted',totals:noTally}),{text:'Not put to a vote',label:null});
 assert.equal(voteRowResult({...base,method:'VOTE_ELECTRONIC',totals:noTally}),null);
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
test('decision reads become the agenda shape without guessing unknown people',()=>{
 const voter=(personId,position,code)=>({personId,position,status:'recorded',group:code?{code,orgId:'o',groupId:'g'}:null,groupStatus:code?'verified':'unavailable',groupSource:null});
 const data={integrity:'complete',corrections:{for:[],against:['2'],abstaining:[]},people:{'3':{name:'Former Member',country:'HU'}},voters:[voter('1','for','PPE'),voter('2','against','S&D'),voter('3','for',null),{personId:'4',position:null,status:'conflicting',group:null}],decision:{id:'D',date:'2026-10-22',scope:{kind:'amendment'},outcome:'ADOPTED',totals:{for:2,against:1,abstaining:0},namedVoters:{available:true}}};
 const vote=namedVoteFromDecision(data,new Map([['1',{countryCode:'MT'}],['2',{countryCode:'FR'}]]));
 assert.deepEqual(vote.groups.for.map(person=>[person.id,person.name,person.currentMep,person.country,person.contributionGroup]),[['1',null,true,'MT','PPE'],['3','Former Member',false,'HU',null]]);
 assert.deepEqual(vote.politicalGroups.map(group=>group.code),['PPE','S&D','unavailable']);
 assert.deepEqual(vote.intendedCorrections.against.map(person=>person.id),['2']);
 assert.equal(vote.groups.for.concat(vote.groups.against).some(person=>person.id==='4'),false,'a conflicting record stays out');
 assert.equal(namedVoteFromDecision({...data,integrity:'conflicting'}).namedVotersAvailable,false);
 const named=namedVoteFromDecision(data,new Map([['2',{countryCode:'FR'}]]),id=>id==='2'?'Known Member':null);
 assert.equal(named.intendedCorrections.against[0].name,'Known Member','a correction by a current member keeps the name');
 assert.equal(named.groups.for.find(person=>person.id==='3').name,'Former Member');
});
test('the vote route is a fixed URL and pl-vote accepts only exact decision identifiers',()=>{
 assert.equal(voteHref('MTG-PL-2026-10-22-DEC-199360','en'),'?view=legislation&pl-mode=vote&pl-vote=MTG-PL-2026-10-22-DEC-199360&lang=en');
 assert.equal(agendaItemHref('MTG-PL-2026-10-22-OJ-ITM-V-52','en'),'?view=legislation&agenda-period=sitting%3AMTG-PL-2026-10-22&agenda-topic=MTG-PL-2026-10-22-OJ-ITM-V-52&lang=en');
 const query=value=>new URLSearchParams({view:'legislation','pl-mode':'vote','pl-vote':value});
 assert.equal(readExplorerParam(query('MTG-PL-2026-10-22-DEC-199360'),'pl-vote',''),'MTG-PL-2026-10-22-DEC-199360');
 assert.equal(readExplorerParam(query('not-a-decision'),'pl-vote',''),'');
 assert.equal(explorerParams(query('MTG-PL-2026-10-22-DEC-199360'),'legislation').get('pl-vote'),'MTG-PL-2026-10-22-DEC-199360');
});
