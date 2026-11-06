import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const evidence={apiUrl:'',fetchedAt:'',relationship:'',containerId:''};
const topic=(id,kind,extra={})=>({id,kind,sittingId:id.slice(0,17),title:id.includes('V-52')?'Erasmus+ programme 2028-2034 ***I':'Title '+id.split('-').slice(-2).join('-'),titleLanguage:'en',date:id.slice(7,17),documentIds:[],procedureIds:[],evidence,...extra});
const day=(id,phase)=>({id,date:id.slice(7),phase,agendaComplete:true,agendaError:null});
const past={week:'2026-10-19',agendaSittings:[day('MTG-PL-2026-10-19','past'),day('MTG-PL-2026-10-21','past'),day('MTG-PL-2026-10-22','past')],topics:[
  topic('MTG-PL-2026-10-19-OJ-ITM-D-1','PLENARY_DEBATE'),topic('MTG-PL-2026-10-21-OJ-ITM-V-71','PLENARY_VOTE'),topic('MTG-PL-2026-10-22-OJ-ITM-V-52','PLENARY_VOTE'),topic('MTG-PL-2026-10-22-OJ-ITM-V-60','PLENARY_VOTE')]};
const results={version:1,week:'2026-10-19',location:'Strasbourg',days:[{sittingId:'MTG-PL-2026-10-22',voteCount:31,rollCallCount:20,notConducted:4},{sittingId:'MTG-PL-2026-10-19',voteCount:5,rollCallCount:5,notConducted:0}],items:[
  {agendaItemId:'MTG-PL-2026-10-22-OJ-ITM-V-52',voteCount:35,main:{id:'MTG-PL-2026-10-22-DEC-198405',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',totals:{for:454,against:34,abstaining:93}}}]};

async function mount(t,props) {
  const window=new Window({url:'http://localhost/?view=legislation&lang=en'}),old=new Map();
  for(const [key,value] of Object.entries({window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,navigator:window.navigator,IS_REACT_ACT_ENVIRONMENT:true})){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PlenaryWeekSummary}=await load('/src/PlenaryWeekSummary.tsx'),{createRoot}=await import('react-dom/client');
  const container=window.document.createElement('div');window.document.body.append(container);const root=createRoot(container);
  t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value] of old)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  await act(async()=>root.render(createElement(PlenaryWeekSummary,{language:'en',onOpen:()=>{},...props})));
  return container;
}

test('a finished week names its place, counts, days and results by day',async t=>{
  const view=await mount(t,{data:past,results:{data:results,error:null}});
  assert.equal(view.querySelector('h2').textContent,'Week of Oct 19, 2026 · Strasbourg');
  assert.equal(view.querySelector('.week-count').textContent,'36 votes on 1 agenda item: 25 with names on record. 4 not put to a vote.');
  assert.deepEqual([...view.querySelectorAll('.week-days button')].map(b=>b.textContent),['Mon 19 · 5 votes','Wed 21','Thu 22 · 31 votes']);
  const days=[...view.querySelectorAll('.week-results h4')].map(h=>h.textContent);assert.deepEqual(days,['Oct 21, 2026','Oct 22, 2026']);
  assert.equal(view.querySelectorAll('.week-results p').length,1);assert.equal(view.querySelector('.week-results p').textContent,'Results not in yet.');
  const rows=[...view.querySelectorAll('.week-results li')];assert.equal(rows.length,2);
  assert.equal(rows[0].textContent,'Erasmus+ programme 2028-2034 ***IAdopted · 454–34–93 · 35 votes');
  const link=rows[0].querySelector('a');assert.equal(link.textContent,'454–34–93');assert.equal(link.getAttribute('href'),'?view=legislation&pl-mode=vote&pl-vote=MTG-PL-2026-10-22-DEC-198405&lang=en');
  assert.equal(rows[1].textContent,'Title V-60');
});

test('a week without votes says so and results failing leaves the heading',async t=>{
  const debates={...past,topics:past.topics.filter(item=>item.kind!=='PLENARY_VOTE')};
  const none=await mount(t,{data:debates,results:{data:{...results,days:[],items:[]},error:null}});
  assert.equal(none.querySelector('.week-count').textContent,'No votes this week.');assert.equal(none.querySelector('.week-results'),null);
});

test('a failed results read shows the unavailable line under the heading',async t=>{
  const view=await mount(t,{data:past,results:{data:null,error:'down'}});
  assert.equal(view.querySelector('h2').textContent,'Week of Oct 19, 2026');
  assert.equal(view.querySelector('.week-count').textContent,'Results unavailable.');
  assert.equal(view.querySelector('.week-results'),null);
});

test('an upcoming week shows the sitting dates, counts, next deadlines and items with references',async t=>{
  const ahead=[day('MTG-PL-2026-11-11','upcoming'),day('MTG-PL-2026-11-12','upcoming')];
  const soon=Date.now()+86400_000*3,end=new Date(soon).toISOString();
  const data={week:'2026-11-09',agendaSittings:ahead,topics:[
    topic('MTG-PL-2026-11-11-OJ-ITM-D-1','PLENARY_DEBATE'),
    topic('MTG-PL-2026-11-11-OJ-ITM-V-2','PLENARY_VOTE',{procedureIds:['2025-0235'],deadlines:[{id:'d1',end,type:'def/ep-activities/TABLING_PLENARY',labels:{de:'Frist'}}]}),
    topic('MTG-PL-2026-11-12-OJ-ITM-V-3','PLENARY_VOTE')]};
  const view=await mount(t,{data,results:{data:{version:1,week:'2026-11-09',location:'Brussels',days:[],items:[]},error:null}});
  assert.equal(view.querySelector('h2').textContent,'Week of Nov 9, 2026 · Brussels · Nov 11–12');
  assert.equal(view.querySelector('.week-count').textContent,'2 votes and 1 debate scheduled.');
  assert.equal(view.querySelector('.week-days'),null);
  assert.match(view.querySelector('.week-deadlines li').textContent,/^\d{1,2} \w{3}, \d{2}:\d{2}: tabling deadline for Title V-2$/);
  const rows=[...view.querySelectorAll('.week-upcoming li')].map(li=>li.textContent);
  assert.deepEqual(rows,['Title V-2'+'2025/0235','Title D-1','Title V-3']);
  assert.equal(view.querySelector('.week-results'),null);
});

test('the list variant carries the heading, count and chips without the result rows',async t=>{
  const view=await mount(t,{data:past,results:{data:results,error:null},list:true});
  assert(view.querySelector('.week-summary-list'));assert(view.querySelector('.week-days'));assert.equal(view.querySelector('.week-results'),null);
});
