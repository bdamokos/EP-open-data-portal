import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const WEEK='2026-10-19',NEXT='2026-11-09',MIXED='2026-11-23';
const totals=(a,b,c)=>({for:a,against:b,abstaining:c});
const none={for:null,against:null,abstaining:null};
const topic=(id,kind,title,extra={})=>({id,kind,title,titleLanguage:'en',date:id.slice(7,17),sittingId:id.slice(0,17),documentIds:[],procedureIds:[],order:0,evidence:{apiUrl:'',fetchedAt:'',relationship:'',containerId:id.slice(0,17)+'-TF-1200'},...extra});
const day=(date,phase)=>({id:'MTG-PL-'+date,date,phase,agendaComplete:true,agendaError:null});
const agenda=(week,days,topics)=>({view:'legislation',week,agendaSittings:days,sitting:{id:days[0].id,phase:days[0].phase,date:days[0].date,title:'',agendaDocumentIds:[]},sittings:[],topics,detail:null,coverage:{},attribution:''});
const past=agenda(WEEK,[day('2026-10-19','past'),day('2026-10-21','past'),day('2026-10-22','past')],[
 topic('MTG-PL-2026-10-21-OJ-ITM-D-5','PLENARY_DEBATE','Conclusions of the European Council meeting of 15-16 October 2026',{order:1}),
 topic('MTG-PL-2026-10-21-OJ-ITM-D-6','PLENARY_DEBATE','Erasmus+ programme 2028–2034',{order:2,procedureIds:['2025-0222']}),
 topic('MTG-PL-2026-10-22-OJ-ITM-V-1','PLENARY_VOTE','Erasmus+ programme 2028–2034',{order:3,procedureIds:['2025-0222']}),
 topic('MTG-PL-2026-10-22-OJ-ITM-V-2','PLENARY_VOTE','A vote by hands',{order:4}),
 topic('MTG-PL-2026-10-22-OJ-ITM-V-3','PLENARY_VOTE','Budget draft with many votes',{order:5}),
]);
const results={version:3,week:WEEK,location:'Strasbourg',days:[{sittingId:'MTG-PL-2026-10-19',complete:true,voteCount:1,rollCallCount:1,notConducted:0},{sittingId:'MTG-PL-2026-10-21',complete:true,voteCount:0,rollCallCount:0,notConducted:0},{sittingId:'MTG-PL-2026-10-22',complete:true,voteCount:210,rollCallCount:0,notConducted:0}],
 unlinked:[{id:'MTG-PL-2026-10-19-DEC-1',sittingId:'MTG-PL-2026-10-19',titles:{en:'Monday’s agenda – Request'},outcome:'REJECTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:totals(115,317,12)}],
 items:[
  {agendaItemId:'MTG-PL-2026-10-22-OJ-ITM-V-1',voteCount:35,summary:null,main:{id:'MTG-PL-2026-10-22-DEC-198405',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:totals(454,34,93)}},
  {agendaItemId:'MTG-PL-2026-10-22-OJ-ITM-V-2',voteCount:1,summary:null,main:{id:'MTG-PL-2026-10-22-DEC-2',outcome:'ADOPTED',method:'VOTE_HAND',totals:none}},
  {agendaItemId:'MTG-PL-2026-10-22-OJ-ITM-V-3',voteCount:210,main:null,summary:{kind:'counts',adopted:51,rejected:116,lapsed:42,unknown:1}},
 ]};
const press={id:'20261021IPR48321',url:'https://www.europarl.europa.eu/news/en/press-room/20261021IPR48321/',title:'A better equipped Erasmus+ 2028-2034',publishedAt:'2026-10-22T11:00:00.000Z',lead:'MEPs want a bigger budget for Erasmus+.',second:'With 454 votes in favour to 34, MEPs adopted their mandate.'};
const story={version:1,week:WEEK,status:'complete',press:{'MTG-PL-2026-10-22-OJ-ITM-V-1':{url:press.url}},
 stories:[{key:'2025/0222',reasons:[{list:'differing',rank:2,value:74},{list:'speeches',rank:1,value:91},{list:'blueCards',rank:3,value:9}],press,vote:{id:'MTG-PL-2026-10-22-DEC-198405',method:'VOTE_ELECTRONIC_ROLLCALL',totals:totals(454,34,93)}},
  {key:'2026/0325',reasons:[{list:'closest',rank:2,value:116}],press:{...press,id:'2',title:'Methane rules'},vote:null},
  {key:'2026/0100',reasons:[{list:'closest',rank:3,value:120}],press:{...press,id:'3',title:'A show of hands story'},vote:{id:'MTG-PL-2026-10-22-DEC-2',method:'VOTE_HAND',totals:none}}],
 highlights:[
  {id:'MTG-PL-2026-10-22-DEC-3',key:'a',list:'closest',lists:['closest'],titles:{en:'Combating VAT fraud'},totals:totals(357,274,31),rank:1},
  {id:'MTG-PL-2026-10-21-PVCRE-ITM-1',key:'b',list:'speeches',lists:['speeches'],titles:{en:'Conclusions of the European Council meeting of 15-16 October 2026'},agendaItemIds:['MTG-PL-2026-10-21-OJ-ITM-D-5'],speeches:113,speakers:92,blueCards:11},
  {id:'MTG-PL-2026-10-20-PVCRE-ITM-2',key:'c',list:'blueCards',lists:['blueCards'],titles:{en:'France, Italy and Belgium: Latest anti-democratic violence by radical far-left groups, implications on public safety'},agendaItemIds:[],speeches:30,speakers:20,blueCards:24},
 ]};
const coming=agenda(NEXT,[day('2026-11-11','upcoming'),day('2026-11-12','upcoming')],[
 topic('MTG-PL-2026-11-11-OJ-ITM-D-1','PLENARY_DEBATE','Resumption of session and order of business',{order:1,evidence:{containerId:'MTG-PL-2026-11-11-TF-1500'}}),
 topic('MTG-PL-2026-11-11-OJ-ITM-D-2','PLENARY_DEBATE','Europe’s Beating Cancer Plan',{order:2,procedureIds:['2025-2139'],documentIds:['A-10-2026-0261','C-10-2025-0174'],evidence:{containerId:'MTG-PL-2026-11-11-TF-1500'}}),
 topic('MTG-PL-2026-11-12-OJ-ITM-V-1','PLENARY_VOTE','EU agri-food promotion policy',{order:3,procedureIds:['2025-2089'],evidence:{containerId:'MTG-PL-2026-11-12-TF-1100'}}),
 topic('MTG-PL-2026-11-12-OJ-ITM-V-2','PLENARY_VOTE','Union retail investor protection rules',{order:4,evidence:{containerId:'MTG-PL-2026-11-12-TF-1100'}}),
]);
const running=agenda(MIXED,[day('2026-11-23','past'),day('2026-11-24','today'),day('2026-11-25','upcoming')],[
 topic('MTG-PL-2026-11-23-OJ-ITM-V-1','PLENARY_VOTE','Monday vote',{order:1}),
 topic('MTG-PL-2026-11-24-OJ-ITM-V-1','PLENARY_VOTE','Tuesday vote',{order:2}),
 topic('MTG-PL-2026-11-25-OJ-ITM-V-1','PLENARY_VOTE','Wednesday vote',{order:3,evidence:{containerId:'MTG-PL-2026-11-25-TF-1200'}}),
 topic('MTG-PL-2026-11-25-OJ-ITM-D-1','PLENARY_DEBATE','Wednesday debate',{order:4,evidence:{containerId:'MTG-PL-2026-11-25-TF-1500'}}),
]);
const runningResults={version:3,week:MIXED,location:'Strasbourg',unlinked:[],days:[{sittingId:'MTG-PL-2026-11-23',complete:true,voteCount:3,rollCallCount:3,notConducted:0},{sittingId:'MTG-PL-2026-11-24',complete:false,voteCount:null,rollCallCount:null,notConducted:null}],items:[{agendaItemId:'MTG-PL-2026-11-23-OJ-ITM-V-1',voteCount:3,summary:null,main:{id:'MTG-PL-2026-11-23-DEC-1',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:totals(10,2,0)}}]};
const week=(id,...dates)=>({week:id,sittings:dates.map(date=>({sittingId:'MTG-PL-'+date,date,location:'Strasbourg'}))});
const periods={version:4,coverage:{status:'complete',years:[]},upcoming:[week(MIXED,'2026-11-23','2026-11-25'),week(NEXT,'2026-11-11','2026-11-12')],weeks:[week(WEEK,'2026-10-19','2026-10-21','2026-10-22'),week('2026-10-05','2026-10-05','2026-10-08')]};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const serve=(overrides={})=>async target=>{
 const week=target.searchParams.get('week'),path=target.pathname;
 const pick=(key,value)=>Object.hasOwn(overrides,key)?overrides[key]:value;
 if(path.includes('vote-periods'))return json(periods);
 if(path.includes('week-story')){const value=pick('story',story);return value instanceof Response?value:json(value);}
 if(path.includes('week-results')){const value=pick('results',week===MIXED?runningResults:results);return value instanceof Response?value:json(value);}
 if(path.includes('insights/legislation')) {
  if(target.searchParams.get('topic'))return json({detail:{procedures:[{id:'2025-2139',reference:'2025/2139(INI)'}]}});
  const value=pick('agenda',{[WEEK]:past,[NEXT]:coming,[MIXED]:running}[week]);return value instanceof Response?value:value?json(value):json({error:{}},404);
 }
 return json({},404);
};
async function mount(t,handler,{id=WEEK,language='en',wait=20}={}) {
 const window=new Window({url:'http://localhost/?view=legislation&pl-mode=week&pl-week='+id+'&lang='+language}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map();
 for(const [key,value] of Object.entries(globals)){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 const calls=[];t.mock.method(globalThis,'fetch',async input=>{const target=new URL(input,window.location.href);calls.push(target.pathname+target.search);return handler(target);});
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {WeekPage}=await load('/src/WeekPage.tsx'),{createRoot}=await import('react-dom/client');
 const container=window.document.createElement('div');window.document.body.append(container);const root=createRoot(container);
 t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value] of old)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 await act(async()=>root.render(createElement(WeekPage,{week:id,language})));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,wait));});
 return {container,calls,settle:async(ms=30)=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms));})};
}
const banned=/against (their|the|own) group|rebel|defect|loyal|names on record|not put to a vote|tabling deadline|source:|retrieved/i;
const rowOf=(container,text)=>[...container.querySelectorAll('.row')].find(row=>row.textContent.includes(text));

test('a past week tells its stories, highlights, results and debates',async t=>{
 const {container:c}=await mount(t,serve());
 assert.equal(c.querySelector('h1').textContent,'Week of 19 October 2026');
 assert.equal(c.querySelector('.say').textContent.trim(),'Strasbourg. 211 votes on 3 agenda items.');
 assert.deepEqual([...c.querySelectorAll('.strip a .on-wide')].map(link=>link.textContent),['‹ 5–8 October','11–12 November ›']);
 assert.match(c.querySelector('.strip a').getAttribute('href'),/pl-mode=week&pl-week=2026-10-05/);
 // Stories: lead first, the reason line by best rank, verbatim English, its press line.
 const lead=c.querySelector('.lead');
 assert.equal(lead.querySelector('.reason').textContent,'91 speeches, 74 MEPs voted differently from their group, 9 blue-card speeches');
 assert.equal(lead.querySelector('h2').getAttribute('lang'),'en');
 assert.equal(lead.querySelector('.quote').getAttribute('lang'),'en');
 assert.equal(lead.querySelector('.quote').textContent,press.lead+' '+press.second);
 assert.match(lead.querySelector('.press').textContent,/From Parliament’s press release of Thursday 22 October\./);
 assert.equal(lead.querySelector('.press a[target=_blank]').href,press.url);
 assert.match(lead.querySelector('.press a:not([target])').getAttribute('href'),/pl-vote=MTG-PL-2026-10-22-DEC-198405/);
 assert.deepEqual([...lead.querySelectorAll('.fig b')].map(n=>n.textContent),['454','34','93']);
 // Others: no vote means no figures and no See the vote; a show of hands says so.
 const [methane,hands]=c.querySelectorAll('.story');
 assert.equal(methane.querySelector('.fig'),null);
 assert.equal(methane.querySelectorAll('.press a').length,1);
 assert.equal(hands.querySelector('.story-hands').textContent,'Show of hands');
 // Deck: speech and blue-card highlights come from the fixture here; the dev copy has no corpus.
 assert.deepEqual([...c.querySelectorAll('.cell .label')].map(n=>n.textContent),['Closest final vote','Most debated','Most blue cards']);
 assert.equal([...c.querySelectorAll('.cell .value')].map(n=>n.textContent).join('|'),'113 speeches by 92 speakers|24 blue-card speeches');
 assert.equal(c.querySelectorAll('.cell')[2].querySelector('a.t'),null,'a blue-card debate with no exact item has no link');
 assert.match(c.querySelectorAll('.cell')[2].querySelector('.t').textContent,/implications on public safety$/,'the whole label, never cut');
 // Results: heads per day, an unlinked decision first, row states.
 assert.deepEqual([...c.querySelectorAll('.section')].map(n=>n.textContent),['Results','Debates']);
 const monday=c.querySelector('[data-week-day="MTG-PL-2026-10-19"]');
 assert.match(monday.querySelector('h3').textContent,/Monday 19 October.*1 vote$/);
 assert.deepEqual([...monday.querySelectorAll('.heads .hd')].map(n=>n.textContent),['For','Against','Abstain']);
 assert.match(monday.querySelector('.row a.t').getAttribute('href'),/pl-vote=MTG-PL-2026-10-19-DEC-1/);
 assert.equal(monday.querySelector('.w.no').textContent,'Rejected');
 const erasmus=rowOf(c.querySelector('[data-week-day="MTG-PL-2026-10-22"]'),'Erasmus+');
 assert.equal(erasmus.querySelector('.sub').textContent,'35 votes, debated Wednesday 21 October, Press release');
 assert.equal(erasmus.querySelector('.sub a').href,press.url);
 assert.deepEqual([...erasmus.querySelectorAll('.n')].map(n=>n.textContent),['454','34','93']);
 const byHands=rowOf(c,'A vote by hands');
 assert.equal(byHands.querySelector('.w').textContent,'Adopted');
 assert.equal(byHands.querySelector('.span').textContent,'Show of hands');
 assert.equal(byHands.querySelector('.n'),null,'a show of hands is never zeros');
 const many=rowOf(c,'Budget draft');
 assert.equal(many.querySelector('.span.wordy').textContent,'51 adopted, 116 rejected, 42 lapsed, 1 unknown');
 assert.match(many.querySelector('a.t').getAttribute('href'),/agenda-topic=MTG-PL-2026-10-22-OJ-ITM-V-3/);
 // Debates: linked by the exact procedure.
 const debated=rowOf(c.querySelector('.week-section:last-of-type'),'Erasmus+');
 assert.equal(debated.querySelector('.span a').textContent,'Vote: Thursday 22 October');
 assert.equal(rowOf(c.querySelector('.week-section:last-of-type'),'European Council').querySelector('.span'),null);
 // Nothing from the earlier designs.
 assert.equal(c.querySelector('.seats,svg.arc,.week-deadlines,.week-days'),null);
 assert.doesNotMatch(c.textContent,banned);
});

test('a counted week gets its place line; with no place it goes without',async t=>{
 const {container:c}=await mount(t,serve({results:{...results,location:null}}));
 assert.equal(c.querySelector('.say').textContent.trim(),'211 votes on 3 agenda items.');
});

test('no release: highlights directly under the heading, no story block',async t=>{
 const {container:c}=await mount(t,serve({story:{...story,stories:[],press:{},status:'partial',highlights:story.highlights.slice(0,1)}}));
 assert.equal(c.querySelector('.lead'),null);assert.equal(c.querySelector('.stories'),null);
 assert.equal(c.querySelector('.mast').nextElementSibling.querySelector('.deck .cell .label').textContent,'Closest final vote');
 assert.doesNotMatch(c.textContent,/Press release/);
});

test('a failed or partial story read shows what is complete, with no note',async t=>{
 const failed=await mount(t,serve({story:new Response('{}',{status:404})}));
 assert.equal(failed.container.querySelector('.week-stories'),null);
 assert.equal(failed.container.querySelector('[role=alert]'),null);
 assert.match(failed.container.querySelector('.section').textContent,/Results/);
 assert.doesNotMatch(failed.container.textContent,/Partial|unavailable/i);
});

test('while the story read is pending nothing sits above Results and journeys wait',async t=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const base=serve();
 const h=await mount(t,async target=>{if(target.pathname.includes('week-story')){await pending;return json(story);}return base(target);});
 assert.equal(h.container.querySelector('.week-stories'),null);
 assert.equal(h.container.querySelector('.mast').nextElementSibling.querySelector('h2').textContent,'Results');
 assert.equal(h.container.querySelector('.week-page').getAttribute('data-week-pending'),'true');
 release();await h.settle();
 assert.equal(h.container.querySelector('.week-page').getAttribute('data-week-pending'),null);
 assert(h.container.querySelector('.lead'));
});

test('a day not read completely keeps its rows without tally',async t=>{
 const h=await mount(t,serve({results:{...results,days:results.days.map(entry=>entry.sittingId==='MTG-PL-2026-10-22'?{sittingId:entry.sittingId,complete:false,voteCount:null,rollCallCount:null,notConducted:null}:entry),items:[]}}));
 const day=h.container.querySelector('[data-week-day="MTG-PL-2026-10-22"]');
 assert.match(day.textContent,/Results not in yet\./);
 assert.equal(day.querySelector('.n'),null);assert.equal(day.querySelector('.heads .hd'),null);
 assert(rowOf(day,'Erasmus+'),'the agenda rows remain');
 assert.equal(h.container.querySelector('.say').textContent.trim(),'','no partial totals');
});

test('a results day missing from the reply is pending, not silently bare',async t=>{
 const h=await mount(t,serve({results:{...results,days:results.days.filter(entry=>entry.sittingId!=='MTG-PL-2026-10-22')}}));
 const day=h.container.querySelector('[data-week-day="MTG-PL-2026-10-22"]');
 assert.match(day.textContent,/Results not in yet\./);
 assert.equal(day.querySelector('.n'),null);
 assert.equal(h.container.querySelector('.say').textContent.trim(),'','no totals with a voting day unread');
});

test('with the calendar still choosing a week the page counts as pending',async t=>{
 const h=await mount(t,serve(),{id:null});
 assert.equal(h.container.querySelector('.week-page').getAttribute('data-week-pending'),'true');
 assert.equal(h.container.querySelector('[role=status]').textContent,'Loading…');
});

test('a day whose agenda read failed offers the retry, in a past or a coming day',async t=>{
 let attempts=0;const failedPast={...past,agendaSittings:past.agendaSittings.map(day=>day.id==='MTG-PL-2026-10-21'?{...day,agendaError:'failed',agendaComplete:false}:day),topics:past.topics.filter(topic=>topic.sittingId!=='MTG-PL-2026-10-21')};
 const base=serve({agenda:failedPast});
 const h=await mount(t,async target=>{if(target.pathname.includes('insights/legislation'))attempts++;return base(target);});
 const day=h.container.querySelector('[data-week-day="MTG-PL-2026-10-21"]');
 assert.equal(day.querySelector('[role=alert]').textContent.trim(),'Agenda unavailable. Try again');
 const before=attempts;
 await act(async()=>{day.querySelector('[role=alert] button').click();await new Promise(resolve=>setTimeout(resolve,30));});
 assert.equal(attempts,before+1);
});
test('a coming day with a failed agenda has the retry and no count line',async t=>{
 const failed={...coming,agendaSittings:coming.agendaSittings.map(day=>day.id==='MTG-PL-2026-11-12'?{...day,agendaError:'failed',agendaComplete:false}:day)};
 const {container:c}=await mount(t,serve({agenda:failed}),{id:NEXT});
 assert.equal(c.querySelector('[data-week-day="MTG-PL-2026-11-12"] [role=alert] button').textContent,'Try again');
 assert.equal(c.querySelector('.say').textContent.trim(),'');
});
test('an agenda read only in part gives no count line but keeps its rows',async t=>{
 const part={...coming,agendaSittings:coming.agendaSittings.map(day=>day.id==='MTG-PL-2026-11-12'?{...day,agendaComplete:false}:day)};
 const {container:c}=await mount(t,serve({agenda:part}),{id:NEXT});
 assert.equal(c.querySelector('.say').textContent.trim(),'','a subset must not read as the total');
 assert(c.querySelector('#week-votes'));
});

test('loading shows the heading from the route; a failed agenda offers a retry that works',async t=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const base=serve();let attempts=0;
 const h=await mount(t,async target=>{
  if(target.pathname.includes('insights/legislation')){attempts++;await pending;if(attempts===1)return new Response('{}',{status:404});}
  return base(target);
 });
 assert.equal(h.container.querySelector('h1').textContent,'Week of 19 October 2026');
 assert.equal(h.container.querySelector('[role=status]').textContent,'Loading…');
 release();await h.settle();
 assert.equal(h.container.querySelector('[role=alert]').textContent.trim(),'Agenda unavailable. Try again');
 await act(async()=>{h.container.querySelector('[role=alert] button').click();await new Promise(resolve=>setTimeout(resolve,30));});
 assert.equal(attempts,2);
 assert(h.container.querySelector('.mast'),'the retried agenda renders');
});

test('a coming week has slots, references in folds, no results, deadlines or arcs',async t=>{
 const h=await mount(t,serve(),{id:NEXT});
 const c=h.container;
 assert.equal(c.querySelector('h1').textContent,'Week of 9 November 2026');
 const say=c.querySelector('.say');
 assert.equal(say.textContent.trim(),'2 votes on Thursday 12 November at 11:00. 2 debates and other items.');
 assert.equal(say.querySelector('a').getAttribute('href'),'#week-votes');
 assert(c.querySelector('#week-votes'),'the first clause links to the vote block');
 assert.equal(c.querySelector('#week-votes .gut').textContent,'11:00');
 assert.deepEqual([...c.querySelectorAll('.slot')].map(n=>n.textContent),['15:00Debates','11:00Votes']);
 assert.equal(c.querySelector('.itemrow .t').textContent,'Resumption of session and order of business');
 assert.equal(c.querySelector('.section'),null);
 assert.equal(c.querySelector('.n'),null);
 assert(!h.calls.some(path=>path.includes('week-results')||path.includes('week-story')),'nothing to read for days ahead');
 assert.doesNotMatch(c.textContent,banned);
 assert.doesNotMatch(c.textContent,/deadline/i);
 // A fold reads the item only when opened, then gives the exact references.
 const fold=c.querySelector('details');
 assert.equal(fold.querySelector('.refs'),null,'mounts on first open');
 assert(!h.calls.some(path=>path.includes('topic=')));
 fold.open=true;await act(async()=>{fold.dispatchEvent(new globalThis.window.Event('toggle'));await new Promise(resolve=>setTimeout(resolve,30));});
 assert.deepEqual([...fold.querySelectorAll('.refs li')].map(n=>n.textContent),['2025/2139(INI)','A10-0261/2026','C-10-2025-0174']);
 assert.match(fold.querySelector('.refs a').getAttribute('href'),/pl-mode=dossier&dossier-ref=2025%2F2139%28INI%29/);
 assert.match(fold.querySelectorAll('.refs a')[1].getAttribute('href'),/pl-mode=read&read-doc=A-10-2026-0261/);
 assert.equal(fold.querySelectorAll('.refs a').length,2,'a document the reader cannot open stays plain');
 assert.equal(fold.querySelector('.open-item').textContent,'Open this item');
 assert.match(fold.querySelector('.open-item a').getAttribute('href'),/agenda-topic=MTG-PL-2026-11-11-OJ-ITM-D-2/);
});

test('a running week: past days as Results, days ahead as slots, both count lines, no stories',async t=>{
 const h=await mount(t,serve(),{id:MIXED});
 const c=h.container;
 assert(!h.calls.some(path=>path.includes('week-story')),'only a finished week has stories');
 assert(rowOf(c.querySelector('[data-week-day="MTG-PL-2026-11-23"]'),'Monday vote').querySelector('.n'));
 const today=c.querySelector('[data-week-day="MTG-PL-2026-11-24"]');
 assert.match(today.textContent,/Results not in yet\./);assert.equal(today.querySelector('.n'),null);
 const ahead=c.querySelector('[data-week-day="MTG-PL-2026-11-25"]');
 assert.deepEqual([...ahead.querySelectorAll('.slot')].map(n=>n.textContent),['12:00Votes','15:00Debates']);
 assert.equal(ahead.querySelector('.row'),null);
 assert.equal(c.querySelector('.say').textContent.trim(),'1 vote on Wednesday 25 November at 12:00. 1 debate or other item.','no totals while a day is incomplete');
});

test('a running week with its days read gives both lines',async t=>{
 const complete={...runningResults,days:runningResults.days.map(entry=>({...entry,complete:true,voteCount:entry.voteCount??2,rollCallCount:0,notConducted:0}))};
 const {container:c}=await mount(t,serve({results:complete}),{id:MIXED});
 assert.equal(c.querySelector('.say').textContent.trim(),'Strasbourg. 5 votes on 1 agenda item. 1 vote on Wednesday 25 November at 12:00. 1 debate or other item.');
});

test('the catalogue holds every week string and no banned wording',async()=>{
 const en=JSON.parse(await readFile(new URL('./ui-locales/en.json',import.meta.url),'utf8'));
 for(const [id,text] of Object.entries(en))if(id.startsWith('week.'))assert.doesNotMatch(text,banned,id);
 assert.equal(en['weekSummary.weekOf'],'Week of {date}');
});
