import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppUiI18n} from './uiCatalogues.mjs';
import {agendaOpensWeekPage,foldFacts,weekItemRoute,comingSlots,comingSummary,debateDateFor,highlightCells,itemCells,pastCounts,pressDate,reasonLine,resultRows,sittingRangeLabel,slotTime,storyText,tallyWords,validWeekPageResults,validWeekStory,voteDateFor,weekNeighbours} from './weekPagePresentation.mjs';

const ui=createAppUiI18n().forLocale('en');
const topic=(id,kind,extra={})=>({id,kind,title:id,titleLanguage:'en',date:id.slice(7,17),sittingId:id.slice(0,17),order:0,documentIds:[],procedureIds:[],evidence:{containerId:id.slice(0,17)+'-TF-1100'},...extra});
const counted={for:341,against:225,abstaining:6},unknown={for:null,against:null,abstaining:null};

test('neighbours and range labels cross the held and upcoming lists',()=>{
 const week=(id,...dates)=>({week:id,sittings:dates.map(date=>({sittingId:'MTG-PL-'+date,date}))});
 const calendar={weeks:[week('2026-10-19','2026-10-19','2026-10-22'),week('2026-10-05','2026-10-05','2026-10-08')],upcoming:[week('2026-11-23','2026-11-23','2026-11-26'),week('2026-11-09','2026-11-11','2026-11-12')]};
 assert.deepEqual(weekNeighbours(calendar,'2026-10-19'),{previous:{week:'2026-10-05',label:'5–8 October'},next:{week:'2026-11-09',label:'11–12 November'}});
 assert.deepEqual(weekNeighbours(calendar,'2026-11-09'),{previous:{week:'2026-10-19',label:'19–22 October'},next:{week:'2026-11-23',label:'23–26 November'}});
 assert.equal(weekNeighbours(calendar,'2026-10-05').previous,null);
 assert.equal(weekNeighbours(calendar,'2026-11-23').next,null);
 assert.equal(sittingRangeLabel(['2026-10-29','2026-11-02']),'29 October – 2 November');
 assert.equal(sittingRangeLabel(['2026-11-12']),'12 November');
 assert.equal(sittingRangeLabel([]),null);
});

test('the count line names one slot, one day or neither',()=>{
 assert.equal(slotTime(topic('MTG-PL-2026-11-12-OJ-ITM-V-1','PLENARY_VOTE')),'11:00');
 assert.equal(slotTime({evidence:{containerId:'something-else'}}),null);
 const one=[topic('MTG-PL-2026-11-12-OJ-ITM-V-1','PLENARY_VOTE'),topic('MTG-PL-2026-11-12-OJ-ITM-V-2','PLENARY_VOTE'),topic('MTG-PL-2026-11-11-OJ-ITM-D-1','PLENARY_DEBATE')];
 assert.deepEqual(comingSummary(one),{votes:2,others:1,date:'2026-11-12',time:'11:00'});
 const late=topic('MTG-PL-2026-11-12-OJ-ITM-V-3','PLENARY_VOTE',{evidence:{containerId:'MTG-PL-2026-11-12-TF-1230'}});
 assert.deepEqual(comingSummary([...one,late]),{votes:3,others:1,date:'2026-11-12',time:null});
 const other=topic('MTG-PL-2026-11-13-OJ-ITM-V-1','PLENARY_VOTE');
 assert.deepEqual(comingSummary([...one,other]),{votes:3,others:1,date:null,time:null});
 assert.deepEqual(comingSummary([one[2]]),{votes:0,others:1,date:null,time:null});
});

test('slots follow agenda order and split when the time or the kind changes',()=>{
 const rows=[
  topic('MTG-PL-2026-11-12-OJ-ITM-D-3','PLENARY_DEBATE',{order:19}),
  topic('MTG-PL-2026-11-12-OJ-ITM-V-1','PLENARY_VOTE',{order:9}),
  topic('MTG-PL-2026-11-12-OJ-ITM-V-2','PLENARY_VOTE',{order:10}),
  topic('MTG-PL-2026-11-12-OJ-ITM-D-1','PLENARY_DEBATE',{order:8,evidence:{containerId:'MTG-PL-2026-11-12-TF-0900'}}),
 ];
 assert.deepEqual(comingSlots(rows).map(slot=>[slot.time,slot.kind,slot.topics.length]),[['09:00','debates',1],['11:00','votes',2],['11:00','debates',1]]);
});

test('debates and votes join only on the exact procedure, never on the title',()=>{
 const vote=topic('MTG-PL-2026-10-22-OJ-ITM-V-1','PLENARY_VOTE',{procedureIds:['2025-0222'],title:'Erasmus+'});
 const debate=topic('MTG-PL-2026-10-21-OJ-ITM-D-1','PLENARY_DEBATE',{procedureIds:['2025-0222'],title:'Another title'});
 const sameTitle=topic('MTG-PL-2026-10-19-OJ-ITM-D-2','PLENARY_DEBATE',{procedureIds:['2024-0001'],title:'Erasmus+'});
 const later=topic('MTG-PL-2026-10-22-OJ-ITM-D-3','PLENARY_DEBATE',{procedureIds:['2025-0222']});
 assert.equal(debateDateFor(vote,[vote,debate,sameTitle,later]),'2026-10-21');
 assert.equal(voteDateFor(debate,[vote,debate,sameTitle]),'2026-10-22');
 assert.equal(voteDateFor(sameTitle,[vote,debate,sameTitle]),null);
 assert.equal(debateDateFor(topic('MTG-PL-2026-10-22-OJ-ITM-V-2','PLENARY_VOTE'),[debate]),null);
});

test('result cells keep unknown apart from zero',()=>{
 assert.deepEqual(itemCells({main:{outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:counted}},ui),{word:'Adopted',rejected:false,totals:counted});
 assert.deepEqual(itemCells({main:{outcome:'REJECTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:0,against:2,abstaining:0}}},ui),{word:'Rejected',rejected:true,totals:{for:0,against:2,abstaining:0}});
 assert.deepEqual(itemCells({main:{outcome:'ADOPTED',method:'VOTE_HAND',totals:unknown}},ui),{word:'Adopted',rejected:false,hands:true},'a show of hands is not a zero tally');
 assert.deepEqual(itemCells({main:{outcome:'ADOPTED',method:null,totals:unknown}},ui),{word:'Adopted',rejected:false},'unknown tally: word only');
});

test('an item with no main vote shows one vote under its own label, else the tally in words',()=>{
 const single=itemCells({main:null,summary:{kind:'single',vote:{id:'x',label:'A10-0265/2026 – Mohammed Chahim – Commission proposal and amendment',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:470,against:83,abstaining:108}}}},ui);
 assert.equal(single.label,'Commission proposal and amendment');
 assert.deepEqual(single.totals,{for:470,against:83,abstaining:108});
 const hands=itemCells({main:null,summary:{kind:'single',vote:{id:'x',label:'Motion for adjournment of the vote',outcome:'ADOPTED',method:'VOTE_HAND',totals:unknown}}},ui);
 assert.equal(hands.hands,true);assert.equal(hands.label,'Motion for adjournment of the vote','an adopted motion to adjourn must not read as the item adopted');
 assert.equal(itemCells({main:null,summary:{kind:'counts',adopted:51,rejected:116,lapsed:42,unknown:1}},ui).words,'51 adopted, 116 rejected, 42 lapsed, 1 unknown');
 assert.equal(tallyWords({adopted:2,rejected:0,lapsed:0,unknown:0},ui),'2 adopted');
 assert.deepEqual(itemCells({main:null,summary:null},ui),{});
});

test('a day lists unlinked decisions first, then items in agenda order, then items the agenda lacks',()=>{
 const day={id:'MTG-PL-2026-09-15',date:'2026-09-15',phase:'past'};
 const topics=[topic('MTG-PL-2026-09-15-OJ-ITM-V-2','PLENARY_VOTE',{order:5}),topic('MTG-PL-2026-09-15-OJ-ITM-V-1','PLENARY_VOTE',{order:1}),topic('MTG-PL-2026-09-15-OJ-ITM-D-1','PLENARY_DEBATE',{order:3}),topic('MTG-PL-2026-09-16-OJ-ITM-V-9','PLENARY_VOTE')];
 const results={items:[
  {agendaItemId:'MTG-PL-2026-09-15-OJ-ITM-V-1',voteCount:2,main:{id:'MTG-PL-2026-09-15-DEC-1',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:counted},summary:null},
  {agendaItemId:'MTG-PL-2026-09-15-OJ-ITM-V-88',voteCount:1,main:null,summary:{kind:'single',vote:{id:'MTG-PL-2026-09-15-DEC-88',label:'Request for an urgent decision',outcome:'ADOPTED',method:'VOTE_HAND',totals:unknown}}},
 ],unlinked:[
  {id:'MTG-PL-2026-09-15-DEC-9',sittingId:day.id,titles:{en:'Later request'},outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:counted},
  {id:'MTG-PL-2026-09-15-DEC-3',sittingId:day.id,titles:{en:'Earlier request'},outcome:'REJECTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:counted},
  {id:'MTG-PL-2026-09-14-DEC-1',sittingId:'MTG-PL-2026-09-14',titles:{en:'Another day'},outcome:'ADOPTED',method:null,totals:unknown},
 ]};
 const rows=resultRows(day,topics,results,'en',ui);
 assert.deepEqual(rows.map(row=>row.text),['Earlier request','Later request','MTG-PL-2026-09-15-OJ-ITM-V-1','MTG-PL-2026-09-15-OJ-ITM-V-2','Request for an urgent decision']);
 assert.match(rows[0].href,/pl-mode=vote&pl-vote=MTG-PL-2026-09-15-DEC-3/,'an unlinked decision opens its own vote');
 assert.match(rows[2].href,/pl-vote=MTG-PL-2026-09-15-DEC-1/,'the title opens the main vote');
 assert.match(rows[3].href,/agenda-topic=MTG-PL-2026-09-15-OJ-ITM-V-2/,'no main vote: the agenda item');
 assert.match(rows[4].href,/pl-vote=MTG-PL-2026-09-15-DEC-88/,'an item the agenda lacks still reaches its vote');
 assert.equal(rows[3].votes,null);
 assert.equal(rows[4].cells.label,null,'a label equal to the title is not repeated');
 const noAgenda=resultRows(day,[],{items:[{agendaItemId:'MTG-PL-2026-09-15-OJ-ITM-V-7',voteCount:9,main:null,summary:{kind:'counts',adopted:9,rejected:0,lapsed:0,unknown:0}}],unlinked:[]},'en',ui)[0];
 assert.equal(noAgenda.text,'Agenda item','no raw record identifier as a title');
 assert.match(noAgenda.href,/agenda-topic=MTG-PL-2026-09-15-OJ-ITM-V-7/,'the agenda item is still reachable');
 const untitled=resultRows(day,[],{items:[],unlinked:[{id:'MTG-PL-2026-09-15-DEC-5',sittingId:day.id,titles:{},outcome:'ADOPTED',method:'VOTE_HAND',totals:unknown}]},'en',ui);
 assert.equal(untitled[0].text,'Vote');
 assert.deepEqual(resultRows(day,topics,null,'en',ui).map(row=>row.text),['MTG-PL-2026-09-15-OJ-ITM-V-1','MTG-PL-2026-09-15-OJ-ITM-V-2'],'rows wait with no tally while results are pending');
});

test('counts are exact: any day not read completely gives none',()=>{
 const days=[{sittingId:'a',complete:true,voteCount:5},{sittingId:'b',complete:true,voteCount:547}];
 assert.deepEqual(pastCounts({days,items:new Array(28)},['a','b']),{votes:552,items:28});
 assert.equal(pastCounts({days:[days[0],{sittingId:'b',complete:false,voteCount:null}],items:[]},['a','b']),null);
 assert.equal(pastCounts({days:[days[0]],items:[]},['a','b']),null,'a past day with no record');
 assert.equal(pastCounts(null,[]),null);
});

test('the reason line lists facts by best rank and capitalises only its first letter',()=>{
 assert.equal(reasonLine([{list:'closest',rank:4,value:211},{list:'differing',rank:3,value:85},{list:'speeches',rank:2,value:91}],ui),'91 speeches, 85 MEPs voted differently from their group, fourth closest final vote');
 assert.equal(reasonLine([{list:'closest',rank:2,value:116}],ui),'Second closest final vote');
 assert.equal(reasonLine([{list:'differing',rank:1,value:1},{list:'speeches',rank:1,value:1},{list:'blueCards',rank:1,value:1}],ui),'1 MEP voted differently from their group, 1 speech, 1 blue-card speech');
 assert.equal(reasonLine([{list:'closest',rank:5,value:1},{list:'blueCards',rank:3,value:24}],ui),'24 blue-card speeches, fifth closest final vote');
 const hu=createAppUiI18n({hu:{'week.reason.rank1':'érdekes'}}).forLocale('hu');
 assert.equal(reasonLine([{list:'closest',rank:1,value:0}],hu),'Érdekes');
});

test('press text stays verbatim and dates by the Brussels day',()=>{
 assert.equal(storyText({lead:'MEPs want it.',second:'It passed.'}),'MEPs want it. It passed.');
 assert.equal(storyText({lead:'Only a lead.',second:null}),'Only a lead.');
 assert.equal(storyText({lead:null,second:null}),'');
 assert.equal(pressDate('2026-10-21T10:29:00.000Z'),'Wednesday 21 October');
 assert.equal(pressDate('2026-10-21T22:30:00.000Z'),'Thursday 22 October','after midnight in Brussels');
 assert.equal(pressDate('not a date'),null);
});

const council={id:'MTG-PL-2026-10-21-PVCRE-ITM-1',key:'k',titles:{en:'Conclusions of the European Council meeting'},agendaItemIds:['MTG-PL-2026-10-21-OJ-ITM-D-5'],speeches:113,speakers:92,blueCards:7};
test('highlights: one cell per fact with its label, figures only for votes',()=>{
 const vote={id:'MTG-PL-2026-10-20-DEC-1',titles:{en:'VAT fraud'},totals:{for:357,against:274,abstaining:31},differing:127};
 const cells=highlightCells([{...vote,list:'closest',lists:['closest']},{...vote,list:'differing',lists:['differing']},{...council,list:'speeches',lists:['speeches']},{...council,id:'blue',titles:{en:'France, Italy and Belgium'},blueCards:24,agendaItemIds:[],list:'blueCards',lists:['blueCards']},{...vote,list:'rejected',lists:['rejected']}],'en',ui);
 assert.deepEqual(cells.map(cell=>cell.label),['Closest final vote','Most MEPs voted differently from their group: 127','Most debated','Most blue cards','Rejected']);
 assert.equal(cells[2].value,'113 speeches by 92 speakers');
 assert.equal(cells[3].value,'24 blue-card speeches');
 assert.equal(cells[3].href,null,'no exact agenda item: no link');
 assert.match(cells[2].href,/agenda-topic=MTG-PL-2026-10-21-OJ-ITM-D-5/);
 assert.match(cells[0].href,/pl-vote=MTG-PL-2026-10-20-DEC-1/);
 assert.equal(cells[0].totals.for,357);
});
test('a debate leading two lists gets a cell for each; a debate with no label shows no cell',()=>{
 const cells=highlightCells([{...council,list:'speeches',lists:['speeches','blueCards']}],'en',ui);
 assert.deepEqual(cells.map(cell=>cell.label),['Most debated','Most blue cards']);
 assert.equal(cells[1].value,'7 blue-card speeches');
 assert.deepEqual(highlightCells([{...council,titles:{},list:'speeches',lists:['speeches']}],'en',ui),[]);
});

test('the agenda opens the week page only at the flip and only with no sitting or item chosen',()=>{
 const state={live:true,mode:'agenda',topic:'',sitting:'',agendaPeriod:''};
 assert.equal(agendaOpensWeekPage(state),true);
 assert.equal(agendaOpensWeekPage({...state,agendaPeriod:'week:2026-10-19'}),true);
 assert.equal(agendaOpensWeekPage({...state,live:false}),false,'the agenda stays as it is until the flip');
 assert.equal(agendaOpensWeekPage({...state,topic:'x'}),false);
 assert.equal(agendaOpensWeekPage({...state,sitting:'MTG-PL-2026-10-19'}),false);
 assert.equal(agendaOpensWeekPage({...state,agendaPeriod:'sitting:MTG-PL-2026-10-19'}),false);
 assert.equal(agendaOpensWeekPage({...state,mode:'cloud'}),false);
});

test('contract checks turn a malformed reply into no stories rather than a crash',()=>{
 assert.equal(validWeekStory({status:'complete',stories:[],highlights:[],press:{}}),true);
 assert.equal(validWeekStory({status:'partial',stories:[{press:{url:'u'},reasons:[]}],highlights:[{list:'closest'}],press:{}}),true);
 assert.equal(validWeekStory({status:'complete',stories:[{}],highlights:[],press:{}}),false);
 assert.equal(validWeekStory(null),false);
 assert.equal(validWeekPageResults({items:[],unlinked:[]}),true);
 assert.equal(validWeekPageResults({items:[]}),false,'an older reply has no unlinked list');
});

test('a fold\'s dates and counts come only from the reply and the agenda, and unknown stays null',()=>{
 const row=(id,kind,extra={})=>({id,kind,date:id.slice(7,17),sittingId:id.slice(0,17),documentIds:[],procedureIds:['2025-0223'],agendaCreatorIds:[],...extra});
 const debate=row('MTG-PL-2026-11-11-OJ-ITM-D-1','PLENARY_DEBATE'),vote=row('MTG-PL-2026-11-12-OJ-ITM-V-1','PLENARY_VOTE');
 const reply={procedures:[{id:'2025-0223'}],documents:[{id:'A-10-2026-0271',amendments:366,votingList:{sittingId:'MTG-PL-2026-11-12',rows:51}}],debated:null};
 assert.deepEqual(foldFacts(reply,debate,[debate]),{voteDate:'2026-11-12',debateDate:null,amendments:366,amendmentTarget:{document:'A-10-2026-0271'},listRows:51},'the voting list dates the vote of a debate with no vote row');
 assert.equal(foldFacts({...reply,documents:[]},debate,[debate,vote]).voteDate,'2026-11-12','an agenda vote on the same procedure');
 assert.equal(foldFacts(reply,vote,[debate,vote]).voteDate,null,'a vote row sits in its own slot');
 assert.equal(foldFacts(reply,vote,[debate,vote]).debateDate,'2026-11-11');
 assert.equal(foldFacts({...reply,debated:'2026-10-20'},vote,[vote]).debateDate,'2026-10-20','a debate at an earlier session');
 const two={procedures:[{id:'2025-0223'}],documents:[{id:'A-10-2026-0271',amendments:2,votingList:null},{id:'A-10-2026-0272',amendments:null,votingList:null}],debated:null};
 assert.deepEqual(foldFacts(two,debate,[debate]),{voteDate:null,debateDate:null,amendments:2,amendmentTarget:{procedure:'2025-0223'},listRows:null},'several reports link the procedure\'s amendments');
 assert.deepEqual(foldFacts(null,debate,[debate]),{voteDate:null,debateDate:null,amendments:null,amendmentTarget:null,listRows:null});
});
test('the fold route carries exact identifiers and reports alone, and there is none without any',()=>{
 const topic=(procedureIds,documentIds)=>({procedureIds,documentIds});
 const query=new URL(weekItemRoute(topic(['2025-0223'],['C-10-2025-0174','A-10-2026-0271']),['MTG-PL-2026-11-12','MTG-PL-2026-11-11'],'fr'),'http://x').searchParams;
 assert.deepEqual(Object.fromEntries(query),{procedures:'2025-0223',documents:'A-10-2026-0271',sittings:'MTG-PL-2026-11-11,MTG-PL-2026-11-12',lang:'fr'});
 assert.equal(weekItemRoute(topic([],['C-10-2025-0174']),[]),null);
});
