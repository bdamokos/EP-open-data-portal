import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaItemHref,agendaVoteRedirect,decisionVoterRows,differingByGroup,findMember,findableMembers,fullDate,itemVoteSections,longDate,countryStory,memberBackHref,memberVoteLine,membersByGroup,shortDate,dayDate,voteAmendmentWording,voteCentre,voteHref,voteOutcomeWord,voteProvision,voteRowLabel,voteSentence,voteSteps,wayLine} from './votePagePresentation.mjs';
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
 assert.deepEqual(voteAmendmentWording([variant],base),{state:'text',language:'en',text:'The text.',heading:'Amendment 4, article 3 – paragraph 1',provision:'article 3 – paragraph 1',sourceLabel:'Article 3 – paragraph 1',labelLanguage:'en'});
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
 const noLabel={...unnamed,referenceTexts:{}};
 assert.equal(voteRowLabel(noLabel,'en'),'Decision');
 assert.equal(render(voteSentence(noLabel,page)),'Decision: adopted by 423 to 125, with 32 abstaining.');
 const several={...unnamed,parts:[part('1'),part('2')]};
 assert.equal(render(voteSentence(several,page)),'Recital 3 – Am 4/2: adopted by 423 to 125, with 32 abstaining.');
 assert.equal(render(voteSentence({...unnamed,parts:[part('2')]},page)),'Parliament adopted part 2 of amendment 4 by 423 to 125, with 32 abstaining.');
});
const lineData=(fields={})=>({integrity:'complete',noRecord:{ids:['absent'],groups:['PPE']},decision:{outcome:'ADOPTED',ballotStatus:'conducted'},...fields});
const row=(id,group,position,country='MT')=>({id,name:id,group,position,country});
const voters=[row('a','PPE','against'),row('b','PPE','for'),row('c','PPE','for'),row('d','S&D','for'),row('e','S&D','against'),row('n','NI','against','GR'),row('g','NI','for','EL'),row('x','NI','for','EL'),row('u','unavailable','for','DE'),row('l','ESN','for','DE'),row('q','ECR','abstaining',null),row('r','ECR','for','IE'),row('s','ECR','for','IE'),row('t','ECR','for','IE')];
test('a member line states position, group, outcome and country from the reply alone',()=>{
 assert.deepEqual(memberVoteLine(lineData(),voters,'a'),{state:'voted',position:'against',id:'votepage.member.voted.differs.differs',group:'PPE',country:null},'Malta splits 3 to 2: no story');
 assert.equal(memberVoteLine(lineData(),voters,'b').id,'votepage.member.voted.with.with');
 assert.equal(memberVoteLine(lineData({decision:{outcome:'REJECTED',ballotStatus:'conducted'}}),voters,'b').id,'votepage.member.voted.with.differs');
 assert.equal(memberVoteLine(lineData({decision:{outcome:'REJECTED',ballotStatus:'conducted'}}),voters,'a').id,'votepage.member.voted.differs.with');
 assert.equal(memberVoteLine(lineData({decision:{outcome:null,ballotStatus:'conducted'}}),voters,'b').id,'votepage.member.voted.with.none');
 assert.equal(memberVoteLine(lineData({decision:{outcome:null,ballotStatus:'conducted'}}),voters,'a').id,'votepage.member.voted.differs.none');
 const tied=memberVoteLine(lineData(),voters,'e');
 assert.equal(tied.id,'votepage.member.voted.none.differs','a tied group never differs');
 assert.equal(tied.group,null);
 assert.equal(memberVoteLine(lineData(),voters,'n').id,'votepage.member.voted.none.differs','non-attached has no group clause');
 assert.equal(memberVoteLine(lineData(),voters,'u').id,'votepage.member.voted.none.with','no group history: position and outcome');
 assert.equal(memberVoteLine(lineData(),voters,'l').id,'votepage.member.voted.none.with','alone in a group: no group clause');
 assert.equal(memberVoteLine(lineData({decision:{outcome:null,ballotStatus:'conducted'}}),voters,'u').id,'votepage.member.voted.none.none');
});
test('an abstention is neither with nor against the outcome',()=>{
 const line=memberVoteLine(lineData(),voters,'q');
 assert.equal(line.id,'votepage.member.abstained.differs');
 assert.equal(line.country,null,'country unknown: no sentence');
 assert.equal(memberVoteLine(lineData(),[row('z','PPE','abstaining'),row('y','PPE','abstaining')],'z').id,'votepage.member.abstained.with');
 assert.equal(memberVoteLine(lineData(),[row('z','NI','abstaining')],'z').id,'votepage.member.abstained.none');
});
test('a member line carries the country story when there is one',()=>{
 assert.equal(memberVoteLine(lineData(),voters,'r').country,null,'the Irish ECR voters voted with the ECR');
 const broke=[...voters.filter(row=>row.group!=='ECR'),row('q','ECR','abstaining','FR'),row('w','ECR','abstaining','FR'),row('r','ECR','for','IE'),row('s','ECR','for','IE'),row('t','ECR','for','IE'),row('v','ECR','abstaining','FR'),row('z','ECR','abstaining','FR')];
 assert.deepEqual(memberVoteLine(lineData(),broke,'r').country,{kind:'delegation',all:true,position:'for',count:3,total:3,code:'IE',group:'ECR'},'the Irish ECR voters broke with the ECR\'s abstention');
 assert.equal(memberVoteLine(lineData(),voters,'g').country,null,'NI in Greece: no group line, and 2 of 3 is under 75%');
 assert.equal(memberVoteLine(lineData({integrity:'partial',noRecord:null}),voters,'r').country,null,'an incomplete list supports no country sentence');
});
test('records that cannot support a line give less or none, never a zero',()=>{
 const partial=memberVoteLine(lineData({integrity:'partial',noRecord:null}),voters,'a');
 assert.deepEqual(partial,{state:'voted',position:'against',id:'votepage.member.voted.none.differs',group:null,country:null});
 assert.equal(memberVoteLine(lineData({integrity:'partial',noRecord:null}),voters,'absent'),null,'a partial list cannot show who did not vote');
 assert.equal(memberVoteLine(lineData({integrity:'conflicting'}),[],'a'),null);
 assert.equal(memberVoteLine(lineData({integrity:'unavailable',noRecord:null,decision:{outcome:'ADOPTED',ballotStatus:'conducted',method:'VOTE_HAND'}}),[],'a'),null,'show of hands');
 assert.equal(memberVoteLine(lineData({decision:{outcome:'LAPSED',ballotStatus:'not-conducted'}}),voters,'a'),null);
 assert.equal(memberVoteLine(lineData({decision:{outcome:'LAPSED',ballotStatus:'conducted'}}),voters,'a'),null);
 assert.deepEqual(memberVoteLine(lineData(),voters,'absent'),{state:'no_record'});
 assert.equal(memberVoteLine(lineData(),voters,'stranger'),null,'not on this vote at all');
 assert.equal(memberVoteLine(lineData(),voters,null),null);
});
test('every member-line message exists in all 24 catalogues with the same slots',async()=>{
 const {readFile}=await import('node:fs/promises');
 const read=async name=>JSON.parse(await readFile(new URL('./ui-locales/'+name+'.json',import.meta.url),'utf8'));
 const clauses=['differs','with','none'];
 const ids=['votepage.member.no_record',...['votepage.country.delegation.both.for','votepage.country.delegation.both.against','votepage.country.delegation.both.abstaining'],...['delegation','country'].flatMap(kind=>['all','most'].flatMap(size=>['for','against','abstaining'].map(position=>'votepage.country.'+kind+'.'+size+'.'+position))),...clauses.flatMap(group=>[...clauses.map(outcome=>'votepage.member.voted.'+group+'.'+outcome),'votepage.member.abstained.'+group])];
 const slots=text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
 const english=await read('en');
 for(const language of 'en bg cs da de el es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' ')) {
  const catalogue=await read(language);
  for(const id of ids) {
   assert.equal(typeof catalogue[id],'string',language+': '+id);
   assert.deepEqual(slots(catalogue[id]),slots(english[id]),language+': '+id);
  }
 }
});
test('the member goes in the vote address only when given, and back returns to their record',()=>{
 const id='MTG-PL-2026-03-11-DEC-188831';
 assert.equal(voteHref(id,'en',113523),'?view=legislation&pl-mode=vote&pl-vote='+id+'&vote-member=113523&lang=en');
 assert.equal(voteHref(id,'en',null),voteHref(id,'en'));
 const record='http://localhost/?member=113523&module=votes&mv-record-offset=20&lang=en';
 assert.equal(memberBackHref(record,'113523','en'),record,'the exact place the reader left');
 assert.match(memberBackHref('http://localhost/?member=5&module=votes&lang=en','113523','de'),/^\?member=113523&module=votes&.*lang=de$/,'another member is not this one\'s way back');
 assert.match(memberBackHref('http://localhost/?view=legislation&pl-mode=dossier&lang=en','113523','en'),/^\?member=113523&module=votes/);
 assert.match(memberBackHref(null,'113523','en'),/^\?member=113523&module=votes/);
});
test('the member the reader came from leads their own group in the differs list',()=>{
 const plain=differingByGroup(rows,new Set(['p0','p9','s2']),['PPE','S&D']);
 assert.deepEqual(plain[0].positions.map(line=>[line.position,line.people.map(person=>person.id)]),[['for',['p0']],['against',['p9']]]);
 const led=differingByGroup(rows,new Set(['p0','p9','s2']),['PPE','S&D'],'p9');
 assert.deepEqual(led[0].positions.map(line=>[line.position,line.people.map(person=>person.id)]),[['against',['p9']],['for',['p0']]]);
 assert.deepEqual(led[1],plain[1],'other groups keep their order');
 const peers=[{id:'k',name:'K Aaa',group:'PPE',position:'for'},{id:'m',name:'M Zzz',group:'PPE',position:'for'}];
 assert.deepEqual(differingByGroup(peers,new Set(['k','m']),['PPE'],'m')[0].positions[0].people.map(person=>person.id),['m','k']);
});
test('a vote on a named place in the text reads as Parliament\'s sentence; other labels keep theirs',()=>{
 const vote={id:'x',ballotStatus:'conducted',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:377,against:163,abstaining:70},scope:{kind:'split-part'},context:{amendmentIds:[]},referenceTexts:{en:'§ 10'},parts:[{number:'2'}]};
 const say=(fields,language='en')=>{const s=voteSentence({...vote,...fields},{mainVoteId:'main',language});return [s.id,s.values.label];};
 assert.deepEqual(say({}),['votepage.provision.adopted.tally','§ 10, part 2']);
 assert.equal(say({outcome:'REJECTED'})[0],'votepage.provision.rejected.tally');
 assert.equal(say({method:'VOTE_HAND',totals:{for:null,against:null,abstaining:null}})[0],'votepage.provision.adopted.hands');
 assert.equal(say({method:null,totals:{for:null,against:null,abstaining:null}})[0],'votepage.provision.adopted.plain');
 assert.equal(say({referenceTexts:{en:'Recital A'},parts:[]})[0],'votepage.provision.adopted.tally');
 assert.equal(say({referenceTexts:{en:'After § 5'},parts:[]})[0],'votepage.other.adopted.tally','"Parliament adopted After § 5" is no sentence');
 assert.equal(say({referenceTexts:{en:'Request for referral back to committee'},parts:[]})[0],'votepage.other.adopted.tally');
 assert.equal(say({context:{amendmentIds:['A-10-2026-0001-AM-1','A-10-2026-0001-AM-2']}})[0],'votepage.other.adopted.tally','a block of amendments on that paragraph');
 assert.equal(voteSentence({...vote,id:'main',date:'2026-03-11'},{mainVoteId:'main'}).id,'votepage.main.adopted.tally','the final vote keeps its own');
});
test('a vote maps to a provision only from its exact reference and one document',()=>{
 const vote=fields=>({scope:{kind:'split-part'},title:'A10-0021/2026 – § 10/2',referenceTexts:{en:'§ 10'},context:{documentIds:['A-10-2026-0021','PV-10-2026-03-11-RCV-ITM-016'],amendmentIds:[]},...fields});
 assert.deepEqual(voteProvision(vote({})),{documentId:'A-10-2026-0021',provision:'paragraph:10'});
 assert.equal(voteProvision(vote({referenceTexts:{en:'§ 15, point f'}})).provision,'point:15:f');
 assert.equal(voteProvision(vote({referenceTexts:{en:'Recital AB'}})).provision,'recital:AB');
 assert.equal(voteProvision(vote({referenceTexts:{en:'Citation 3'}})).provision,'citation:3');
 for(const en of ['After § 5','Article 1, § 1','§ 10/2','Motion for a resolution (as a whole)','07 02 01','Recital 3','§ 123456','§ 0','§ 10, point abcde','Citation 0'])assert.equal(voteProvision(vote({referenceTexts:{en}})),null,en);
 assert.equal(voteProvision(vote({referenceTexts:{hu:'10. bek.'}})),null,'the exact form is the English reference');
 assert.equal(voteProvision(vote({context:{documentIds:['A-10-2026-0021'],amendmentIds:['A-10-2026-0021-AM-3']}})),null,'an amendment to it has its own wording');
 assert.equal(voteProvision(vote({scope:{kind:'amendment'}})),null);
 assert.equal(voteProvision(vote({scope:{kind:'whole-text'}})),null);
 const motions=['B-10-2026-0485','B-10-2026-0476'],joint='RC-10-2026-0476';
 assert.equal(voteProvision(vote({title:'§ 5',context:{documentIds:motions,amendmentIds:[]}})),null,'several motions and nothing to choose by');
 assert.equal(voteProvision(vote({title:'§ 5',context:{documentIds:[...motions,joint],amendmentIds:[]}})),null,'nor does a joint motion among them say which');
 assert.equal(voteProvision(vote({title:'B10-0485/2026 – § 5',context:{documentIds:[...motions,joint],amendmentIds:[]}})).documentId,'B-10-2026-0485','the title names the exact one');
 assert.equal(voteProvision(vote({title:'RC-B10-0476/2026 – § 1/1',context:{documentIds:[...motions,joint],amendmentIds:[]}})).documentId,joint);
 assert.equal(voteProvision(vote({title:'A10-0099/2026 – § 10/2'})),null,'a title that disagrees with the vote\'s link');
 assert.equal(voteProvision(vote({title:null,context:{documentIds:[joint],amendmentIds:[]}})).documentId,joint,'its own one document needs no title');
 assert.equal(voteProvision(vote({title:null,context:{documentIds:[],amendmentIds:[]}})),null,'a vote with no document of its own has no text');
 assert.equal(voteProvision(vote({title:null,context:{documentIds:['PV-10-2026-03-11-RCV-ITM-016'],amendmentIds:[]}})),null);
});
const people=(prefix,group,country,list)=>list.map((position,index)=>({id:prefix+index,name:prefix+index,group,country,position}));
test('a national delegation that broke with its group is the story, at 75% and from 2 voters',()=>{
 const epp=[...people('e','PPE','DE',Array(10).fill('for')),...people('m','PPE','MT',['against','against','against'])];
 assert.deepEqual(countryStory(epp,epp.find(row=>row.id==='m0')),{kind:'delegation',all:true,position:'against',count:3,total:3,code:'MT',group:'PPE'});
 const most=[...people('e','PPE','DE',Array(10).fill('for')),...people('p','PPE','PL',['against','against','against','for'])];
 assert.deepEqual(countryStory(most,most.find(row=>row.id==='p3')),{kind:'delegation',all:false,position:'against',count:3,total:4,code:'PL',group:'PPE'},'the member need not be in the lead');
 const split=[...people('e','PPE','DE',Array(10).fill('for')),...people('p','PPE','PL',['against','against','for','for'])];
 assert.equal(countryStory(split,split.find(row=>row.id==='p0')),null,'half and half is no story');
 const alone=[...people('e','PPE','DE',Array(10).fill('for')),...people('m','PPE','MT',['against'])];
 assert.equal(countryStory(alone,alone.at(-1)),null,'one voter is no delegation');
 const loyal=[...people('e','PPE','DE',Array(10).fill('for')),...people('m','PPE','MT',['for','for'])];
 assert.equal(countryStory(loyal,loyal.at(-1)),null,'with the group is no story');
 const ni=[...people('n','NI','HU',['for','for','for']),...people('x','NI','DE',['against','against','against','against'])];
 assert.equal(countryStory(ni,ni[0]),null,'NI has no group line to break with');
});
test('a country voting together across groups whose lines differ is the story',()=>{
 const rows=[...people('a','PPE','DE',Array(6).fill('for')),...people('b','S&D','DE',Array(6).fill('against')),...people('p','PPE','PL',Array(5).fill('for')),...people('q','S&D','PL',['for','for','for','for','against'])];
 assert.deepEqual(countryStory(rows,rows.find(row=>row.id==='q0')),{kind:'delegation',all:false,position:'for',count:4,total:5,code:'PL',group:'S&D'},'4 of 5 Polish S&D voters is 80%: the delegation comes first');
 assert.deepEqual(countryStory(rows,rows.find(row=>row.id==='p0')),{kind:'country',all:false,position:'for',count:9,total:10,code:'PL',group:null},'for a Polish EPP voter, who voted with the EPP, the country is the story');
 const together=[...people('a','PPE','DE',Array(6).fill('for')),...people('b','S&D','DE',Array(6).fill('against')),...people('p','PPE','PL',Array(5).fill('for')),...people('q','S&D','PL',Array(4).fill('for'))];
 const story=countryStory(together,together.find(row=>row.id==='p0'));
 assert.deepEqual(story,{kind:'country',all:true,position:'for',count:9,total:9,code:'PL',group:null});
 const sameLine=[...people('a','PPE','DE',Array(6).fill('for')),...people('b','Renew','DE',Array(6).fill('for')),...people('p','PPE','PL',Array(3).fill('for')),...people('q','Renew','PL',Array(3).fill('for'))];
 assert.equal(countryStory(sameLine,sameLine.find(row=>row.id==='p0')),null,'groups that agree tell nothing about the country');
 const lopsided=[...people('a','PPE','DE',Array(20).fill('for')),...people('b','S&D','DE',Array(20).fill('for')),...people('c','ESN','DE',Array(10).fill('against')),...people('d','ESN','FR',Array(4).fill('against')),...people('e','PPE','FR',Array(3).fill('for'))];
 assert.equal(countryStory(lopsided,lopsided[0]),null,'Germany is 80% for only because its groups were: its ESN voters stayed with the ESN');
 const one=[...lopsided.slice(0,49),{...lopsided[49],position:'for'}];
 assert.equal(countryStory(one,one[0]),null,'one ESN voter crossing is not the country voting together');
 const small=[...people('a','PPE','DE',Array(6).fill('for')),...people('b','S&D','DE',Array(6).fill('against')),...people('c','PPE','CY',['for']),...people('d','S&D','CY',['for'])];
 assert.equal(countryStory(small,small.find(row=>row.id==='c0')),null,'two voters are too few for a country');
 const greece=[...people('a','PPE','DE',Array(6).fill('for')),...people('b','S&D','DE',Array(6).fill('against')),...people('g','PPE','GR',['for','for']),...people('h','S&D','EL',['for','for'])];
 assert.equal(countryStory(greece,greece.find(row=>row.id==='g0')).total,4,'GR and EL are one country');
});
test('the delegation test wins over the country test',()=>{
 const rows=[...people('a','PPE','DE',Array(6).fill('for')),...people('b','S&D','DE',Array(6).fill('for')),...people('c','ECR','DE',Array(6).fill('against')),...people('m','PPE','MT',['against','against']),...people('n','ECR','MT',['against'])];
 assert.equal(countryStory(rows,rows.find(row=>row.id==='m0')).kind,'delegation');
 assert.equal(countryStory(rows,rows.find(row=>row.id==='n0')).kind,'country','the ECR Maltese voted with their group, but Malta voted together across groups');
});
