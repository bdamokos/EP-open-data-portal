import {LegislationInsights} from '../server/insights-legislation.mjs';
import {insightQuery} from '../server/insights-store.mjs';
import {participation,participationQuery} from '../server/insights-participation.mjs';
import {SpeechCloudInsights,speechCloudQuery} from '../server/speech-cloud.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

async function harness(t,path,component,query,respond,props={}) {
  const window=new Window({url:'http://localhost/'+query});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,
    HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:class {observe(){} disconnect(){}},
    requestAnimationFrame:window.requestAnimationFrame.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());t.mock.timers.reset();if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const calls=[];
  t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input,window.location.href);calls.push(url);const result=await respond(url);return result instanceof Response?result:Response.json(result);});
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const Component=(await loadModule(path))[component],{createRoot}=await import('react-dom/client');
  // Module loading uses real timers; only mounted application deadlines are advanced.
  t.mock.timers.enable({apis:['setTimeout']});
  const tick=async(ms=350)=>{await act(async()=>{});await act(async()=>{t.mock.timers.tick(ms);});};
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(Component,{language:'en',onBack(){},...props})));
  const status=()=>container.querySelector('[role="status"][aria-live="polite"][aria-atomic="true"]');
  assert(component==='Legislation'||status(),'the result status region is present before a result settles');
  const messages=[];
  const observer=new window.MutationObserver(()=>{if(status()?.textContent)messages.push(status().textContent);});
  observer.observe(status()||container,{childList:true,subtree:true,characterData:true});t.after(()=>observer.disconnect());
  const navigate=query=>act(async()=>{history.replaceState(null,'','/'+query);window.dispatchEvent(new window.PopStateEvent('popstate'));});
  const click=text=>act(async()=>{const button=[...container.querySelectorAll('button')].find(node=>node.textContent===text);assert(button,'Missing button: '+text);button.click();});
  return {window,container,calls,status,messages,navigate,click,tick};
}

test('participation announces only settled filters and keeps focus while qualifying upcoming and missing activity',async t=>{
  const response=deferred();
  const h=await harness(t,'/src/Participation.tsx','Participation','?hot-period=sitting%3AMTG-PL-2026-10-20',()=>response.promise,{sittings:[{id:'MTG-PL-2026-10-20',date:'2026-10-20',phase:'upcoming'}],onTopic(){}});
  const status=h.status(),search=h.container.querySelector('input[type="search"]');search.focus();
  await h.tick();assert.equal(status.textContent,'');
  await act(async()=>response.resolve({window:{start:'2026-10-20',end:'2026-10-20'},series:[],topics:[{id:'exact-agenda-id',title:'Fixture agenda',date:'2026-10-20',sittingId:'MTG-PL-2026-10-20',upcoming:true,speakers:null,voters:null,amendmentVotes:null,rollCalls:0}],coverage:{topicsWithSpeechLinks:0,topics:1,gaps:[{kind:'unavailable',sitting:'MTG-PL-2026-10-20'}]}}));
  await h.tick(349);assert.equal(status.textContent,'','results stay silent before the debounce deadline');
  await h.tick(1);
  assert.match(status.textContent,/1 agenda item/);assert.match(status.textContent,/This period has not taken place\./);assert.match(status.textContent,/Partial coverage/);
  assert.equal(document.activeElement,search);assert.equal(status.lang,'en');
  h.messages.length=0;
  await h.navigate('?hot-period=sitting%3AMTG-PL-2026-10-20&hot-search=absent');
  await h.navigate('?hot-period=sitting%3AMTG-PL-2026-10-20&hot-search=Fixture');
  await h.tick();
  assert.equal(h.status(),status,'one stable region survives filter changes');assert.equal(document.activeElement,search);
  assert.equal(h.messages.length,1);assert(h.messages.every(message=>message.includes('1 agenda item')),'superseded empty filters must not be announced');
  await h.navigate('?hot-period=sitting%3AMTG-PL-2026-10-20&hot-search=absent');await h.tick();
  assert.match(status.textContent,/No agenda items match this selection/);assert.doesNotMatch(status.textContent,/0 speakers|0 MEPs/);
  assert.equal(h.calls.length,1,'title filters do not reload public-source data');
});

test('participation distinguishes unavailable agendas, verified empty agendas and unmatched saved titles',async t=>{
  const sitting={id:'MTG-PL-2026-10-07',date:'2026-10-07',phase:'past'};
  const row={id:'exact-saved-agenda-id',title:'Available agenda title',date:sitting.date,sittingId:sitting.id,upcoming:false,speakers:2,voters:null,amendmentVotes:null,rollCalls:0};
  const agendaGap={kind:'agenda-unavailable',sitting:'MTG-PL-2026-10-08'};
  const cases=[
    {name:'no agenda rows retrieved',topics:[],gaps:[agendaGap],search:'',status:/Agenda data is unavailable for this selection\./,visible:'Agenda data is unavailable for this selection.'},
    {name:'verified empty agenda',topics:[],gaps:[],search:'',status:/No agenda items match this selection\./,visible:'No agenda items available in this view.'},
    {name:'unmatched title over partial saved agendas',topics:[row],gaps:[agendaGap],search:'absent',status:/None of the available agenda items match this search\. Some agendas are unavailable\./,visible:'None of the available agenda items match this search. Some agendas are unavailable.'},
    {name:'unavailable speaking data over known agendas',topics:[{...row,speakers:null}],gaps:[],search:'',status:/MEPs speaking: unavailable for this period\./,visible:'MEPs speaking: unavailable for this period. Choose another sitting or open an agenda item below.'},
  ];
  for(const fixture of cases)await t.test(fixture.name,async t=>{
    const h=await harness(t,'/src/Participation.tsx','Participation','?hot-period=week%3A2026-10-05'+(fixture.search?'&hot-search='+fixture.search:''),()=>({window:{start:'2026-10-05',end:'2026-10-11'},series:[{date:sitting.date,speakers:null,voters:null,amendmentVotes:null}],topics:fixture.topics,coverage:{topicsWithSpeechLinks:fixture.topics.length,topics:fixture.topics.length,gaps:fixture.gaps}}),{language:'fr',sittings:[sitting],onTopic(){}});
    await h.tick();
    assert.match(h.status().textContent,fixture.status);
    const visible=[...h.container.querySelectorAll('p')].find(node=>node.textContent===fixture.visible);assert(visible,'the visible empty state agrees with the announcement');
    if(fixture.gaps.length){
      assert.equal(visible.lang,'en','new actual-English source-gap messages are marked');
      assert.doesNotMatch(h.container.textContent,/No agenda items match|No agenda items available|No agenda titles match|No saved MEPs speaking|0 agenda items/,'unknown agendas cannot establish an empty result or missing activity');
    }
    assert.equal(new URL(location.href).searchParams.get('hot-search'),fixture.search||null);
  });
});

const trend=(n)=>({id:'http://eurovoc.europa.eu/'+n,label:'Fixture topic '+n,language:'en',dossiers:1,series:[{week:'2026-09-07',debates:1,votes:0,committee:0}],events:[]});
const trends=(topics,extra={})=>({window:{start:'2026-07-01',end:'2026-09-30'},weeks:['2026-09-07'],topics,nextPage:null,coverage:{procedures:30,mapped:20,unmapped:0,pending:10,sourceError:false,truncated:true,indexComplete:false},...extra});

test('topic status waits for every page, distinguishes shown topics and never treats a source failure as zero',async t=>{
  const first=deferred(),last=deferred();
  let sourceError=true;
  const h=await harness(t,'/src/TopicTrends.tsx','TopicTrends','?trend-days=90',url=>url.searchParams.get('days')==='180'?(sourceError?trends([],{coverage:{sourceError:true,indexComplete:false,truncated:false}}):trends([trend(9)])):url.searchParams.get('page')==='0'?first.promise:last.promise);
  await act(async()=>first.resolve(trends([trend(1)],{nextPage:1})));await h.tick();
  assert.equal(h.status().textContent,'','an intermediate page is not settled');
  await act(async()=>last.resolve(trends(Array.from({length:15},(_,i)=>trend(i+1)))));await h.tick();
  assert.match(h.status().textContent,/15 topics.*Showing 12/);assert.match(h.status().textContent,/Archive incomplete/);assert.match(h.status().textContent,/some activity is omitted/);
  await h.click('More topics');await h.tick();assert.match(h.status().textContent,/15 topics.*Showing 15/);assert.equal(h.calls.length,2);
  await h.navigate('?trend-days=180');await h.tick();
  assert.equal(h.status().textContent,'Topic catalogue temporarily unavailable.');assert.doesNotMatch(h.status().textContent,/No topics|0 topics/);
  assert(!h.container.textContent.includes('No mapped debates'),'a source failure must not show a contradictory empty-result claim');
  sourceError=false;await h.click('Try again');await h.tick();
  assert.match(h.status().textContent,/1 topic.*Showing 1/,'explicit retry recovery announces the settled replacement');
});

test('out-of-order timeline responses cannot announce a superseded period',async t=>{
  const old=deferred(),current=deferred();
  const h=await harness(t,'/src/TopicTrends.tsx','TopicTrends','?trend-days=90',url=>url.searchParams.get('days')==='90'?old.promise:current.promise);
  await h.navigate('?trend-days=180');await act(async()=>current.resolve(trends([trend(7),trend(8)])));await h.tick();
  assert.match(h.status().textContent,/2 topics/);h.messages.length=0;
  await act(async()=>old.resolve(trends([trend(1)])));await h.tick();
  assert.match(h.status().textContent,/2 topics/);assert.equal(h.messages.length,0);assert.equal(h.calls.length,2);
});

const stats={uniquePeople:3,uniqueCurrentMeps:3,peopleOutsideCurrentRoster:0,denominator:3,referenceDate:'2026-10-16',dimensions:{country:[],group:[],gender:[],age:[]}};
const question=n=>({id:'E-10-2026-'+String(n).padStart(6,'0'),date:'2026-10-01',kind:'QUESTION_WRITTEN',title:'Exact fixture question '+n,authors:[],answers:[]});
const questions=(offset=0)=>({window:{start:'2026-07-01',end:'2026-09-30'},counts:{selectedQuestions:42},selection:{},clusters:[],words:[],stats,selectedStats:stats,analysis:{unassignedQuestions:0,missingEnglishTitles:0},coverage:{indexComplete:false,truncated:true},questions:Array.from({length:offset?17:25},(_,i)=>question(offset+i+1)),offset,limit:25,nextOffset:offset?null:25});

test('question topic counts stay silent during text search and announce once when its visual results return',async t=>{
  const h=await harness(t,'/src/QuestionTopics.tsx','QuestionTopics','?view=questions',url=>{assert(url.pathname.endsWith('/insights/questions'),'blank text search must not request the text corpus');return questions();});
  await h.tick();assert.match(h.status().textContent,/42 questions match these filters/);assert(h.container.querySelector('.insight-question-results'));
  const status=h.status();h.messages.length=0;
  await act(async()=>h.container.querySelector('button[aria-label="Search question and answer text"]').click());
  await h.tick();
  assert.equal(h.status(),status);assert.equal(status.textContent,'');assert.equal(h.messages.length,0,'hidden topic results must not announce over text search');
  assert.equal(h.container.querySelector('.insight-question-results'),null);assert(h.container.querySelector('.explorer-search-panel'));
  await act(async()=>h.container.querySelector('button[aria-label="Close text search"]').click());
  assert.equal(status.textContent,'','restored topic counts retain their debounce');
  await h.tick();
  assert(h.container.querySelector('.insight-question-results'));assert.equal(h.container.querySelector('.explorer-search-panel'),null);
  assert.match(status.textContent,/42 questions match these filters/);assert.equal(h.messages.length,1);
  assert.equal(h.calls.length,1,'opening and closing an empty text search preserves the topic data request');
});

test('question results announce total and page range without moving focus or repeating presentation toggles',async t=>{
  const second=deferred();
  const h=await harness(t,'/src/QuestionTopics.tsx','QuestionTopics','?view=questions',url=>url.searchParams.get('offset')==='25'?second.promise:questions());
  await h.tick();assert.match(h.status().textContent,/42 questions match these filters. Showing 1 to 25/);assert.match(h.status().textContent,/Question archive incomplete/);assert.match(h.status().textContent,/latest 5,000/);
  const select=h.container.querySelector('[data-question-country]');select.focus();
  await h.navigate('?view=questions&q-offset=25');await h.tick();assert.equal(h.status().textContent,'');assert.equal(document.activeElement,select);
  await act(async()=>second.resolve(questions(25)));await h.tick();
  assert.match(h.status().textContent,/42 questions match these filters. Showing 26 to 42/);assert.equal(document.activeElement,select);
  const expected=new URL(location.href).searchParams.toString();h.messages.length=0;
  await h.click('Timeline');await h.tick();
  assert.equal(h.messages.length,0,'a presentation toggle must not repeat the settled result count');assert.equal(h.calls.length,2);
  assert.equal(new URL(location.href).searchParams.get('q-offset'),'25');assert(expected.includes('q-offset=25'));
});

test('question failures retain existing error and missing-topic announcements without publishing a false count',async t=>{
  const h=await harness(t,'/src/QuestionTopics.tsx','QuestionTopics','?view=questions',url=>Response.json({error:{message:url.searchParams.has('cluster')?'That topic is not in this window.':'Fixture unavailable'}},{status:503}));
  await h.tick();assert.equal(h.status().textContent,'');assert(h.container.querySelector('[role="alert"]')?.textContent.includes('Could not load this item.'));
  await h.navigate('?view=questions&q-topic=exact-missing-topic');await h.tick();
  assert.equal(h.status().textContent,'');assert.equal(h.container.querySelector('[role="alert"]'),null);
  assert([...h.container.querySelectorAll('[role="status"]')].some(node=>node.textContent.includes('unavailable in this period')));
  assert.equal(new URL(location.href).searchParams.get('q-topic'),'exact-missing-topic');
});
test('participation leaves latest unselected when newer calendar years are unavailable',async t=>{
 const sitting={id:'MTG-PL-2025-12-18',date:'2025-12-18',phase:'past'};
 const h=await harness(t,'/src/Participation.tsx','Participation','',()=>({window:{start:sitting.date,end:sitting.date},series:[],topics:[],coverage:{topicsWithSpeechLinks:0,topics:0,gaps:[]}}),{sittings:[sitting],latestAvailable:false,onTopic(){}});
 await h.tick();assert.equal(h.calls.length,0);assert.match(h.container.textContent,/Latest week unavailable/);
 const select=h.container.querySelector('select');assert.equal(select.value,'');
 await act(async()=>{select.value='sitting:'+sitting.id;select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});await h.tick();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].searchParams.get('sitting'),sitting.id);
});
function incompleteCalendarApi() {
  const now=Date.parse('2026-10-19T12:00:00Z'),clock=()=>now;
  const store={status:()=>({currentMeps:1,servingGeneration:1,complete:false}),db:{prepare:()=>({all:()=>[],get:()=>null})}};
  const request=async(endpoint,params={})=>{
    if(endpoint==='/meetings'&&params.year===2026)throw Error('Current year unavailable');
    const date=params.year===2024?'2024-07-16':'2025-12-18';
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:now,payload:{data:endpoint==='/meetings'?[{id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING'}]:[],meta:{total:0}}};
  };
  const legislation=new LegislationInsights(store,{request,clock,loadMetadata:async()=>new Map()}),cloud=new SpeechCloudInsights(store,{request,clock,legislation,readCorpusPage:null});
  return async url=>{
    const params=new URLSearchParams(url.searchParams);params.delete('v');
    if(url.pathname.endsWith('/insights/legislation'))return legislation.query(insightQuery(params,{kind:'legislation',now}));
    if(url.pathname.endsWith('/insights/participation'))return participation(legislation,store,participationQuery(params),{clock});
    if(url.pathname.endsWith('/insights/speech-cloud'))return cloud.query(speechCloudQuery(params,{now}));
    throw Error('Unexpected route '+url.pathname);
  };
}
for(const mode of ['participation','cloud'])test(mode+' keeps explicit saved sitting links usable across an unreadable latest year',async t=>{
 const key=mode==='participation'?'hot-period':'cloud-period',id='MTG-PL-2025-12-18';
 const h=await harness(t,'/src/Legislation.tsx','Legislation','?pl-mode='+mode+'&'+key+'=sitting%3A'+id,incompleteCalendarApi());
 await h.tick();await h.tick();
 assert(h.calls.some(url=>url.pathname.endsWith('/insights/legislation')&&url.searchParams.get('sitting')===id));
 assert(h.calls.some(url=>url.pathname.endsWith('/insights/'+(mode==='cloud'?'speech-cloud':'participation'))&&url.searchParams.get('sitting')===id));
 assert(h.container.querySelector('select'));assert(!h.container.textContent.includes('Latest week unavailable'));
});
test('unknown latest keeps known Agenda dates selectable on a fresh visit',async t=>{
 const h=await harness(t,'/src/Legislation.tsx','Legislation','',incompleteCalendarApi());
 await h.tick();assert.match(h.container.textContent,/Latest week unavailable/);
 const select=h.container.querySelector('.insight-controls select');assert([...select.options].some(option=>option.value==='sitting:MTG-PL-2025-12-18'));
 assert(!h.container.textContent.includes('0 agenda items'));
 await act(async()=>{select.value='sitting:MTG-PL-2025-12-18';select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});await h.tick();
 assert(h.calls.some(url=>url.pathname.endsWith('/insights/legislation')&&url.searchParams.get('sitting')==='MTG-PL-2025-12-18'));assert(!h.container.textContent.includes('Latest week unavailable'));
});
