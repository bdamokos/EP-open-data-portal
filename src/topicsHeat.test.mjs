import {installRetryClock} from './test-support/automaticRecovery.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createElement,act} from 'react';
import {freshLoader} from './test-support/viteRunner.mjs';
import {heatStep,topicStatusMessage} from './topicPresentation.mjs';

async function mount(t,{url,narrow=false,language='en',fetch,omit=[]}) {
  const window=new Window({url}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
  window.HTMLElement.prototype.scrollIntoView=function(){};
  window.matchMedia=()=>({matches:narrow,addEventListener(){},removeEventListener(){}});
  let root,load;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
  t.mock.method(globalThis,'fetch',async input=>fetch(new URL(String(input),location.href)));
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-history'});
  const {Topics}=await load('/src/Topics.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');
  document.body.append(node);installRetryClock(t);root=createRoot(node);
  const wait=async predicate=>{for(let i=0;i<60&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(predicate(),node.textContent);};
  let page=createElement(Topics,{language});
  if(language!=='en') {
    const {UiI18nProvider}=await load('/src/UiI18nReact.tsx'),{createAppUiI18n}=await load('/src/uiCatalogues.mjs'),{default:catalogue}=await load('/src/ui-locales/'+language+'.json');
    // `omit` stubs a catalogue that lacks those messages, whatever the shipped catalogue holds.
    const stub=Object.fromEntries(Object.entries(catalogue).filter(([id])=>!omit.includes(id)));
    page=createElement(UiI18nProvider,{i18n:createAppUiI18n({[language]:stub}),language},page);
  }
  await act(async()=>root.render(page));
  return {node,wait,window};
}

test('heat steps rise with the count and never colour a zero',()=>{
  assert.equal(heatStep(0,40),0);
  assert.equal(heatStep(1,40),1);
  assert.equal(heatStep(40,40),5);
  assert.equal(heatStep(10,40),3);
  let previous=0;for(let n=0;n<=40;n++){const step=heatStep(n,40);assert(step>=previous&&step<=5);previous=step;}
});
test('stages after Parliament\'s position keep its word until signature',()=>{
  const id=stage=>topicStatusMessage(stage);
  assert.equal(id('position-talks'),id('position'));assert.equal(id('council-approved'),id('position'));
  assert.notEqual(id('signed'),id('position'));assert.notEqual(id('journal'),id('signed'));
  for(const stage of ['proposal','referred','drafting','reported','deal','resolution-adopted','unknown',null])assert.equal(id(stage),undefined,String(stage));
});

const overview=(url)=>url.pathname==='/api/topics/overview'?Response.json({ready:true,periods:['2024-Q4','2025-Q1'],partial:{first:null,last:null},items:[
  {key:'oeil:1.10',label:'Fundamental freedoms',groupsTotal:40,series:[{period:'2024-Q4',groups:40},{period:'2025-Q1',groups:0}]},
  {key:'oeil:3.60',label:'Energy policy',groupsTotal:12,series:[{period:'2024-Q4',groups:3},{period:'2025-Q1',groups:9}]}]}):Response.json({ready:false});

test('the grid shows every count and no zero, with a caption and scale',async t=>{
  const {node,wait}=await mount(t,{url:'http://localhost/?view=legislation&pl-mode=topics',fetch:overview});
  await wait(()=>node.querySelector('.topic-heat'));
  const cells=[...node.querySelectorAll('.topic-heat tbody tr:first-child .topic-cell')];
  assert.deepEqual(cells.map(cell=>cell.textContent),['40','']);
  assert.deepEqual(cells.map(cell=>cell.dataset.step),['5','0']);
  assert.match(cells[0].getAttribute('aria-label'),/Fundamental freedoms, 2024 Q4: 40 debates and dossiers/);
  assert.equal(node.querySelector('.topic-heat-key p').textContent,'Debates and dossiers per quarter.');
  assert.equal(node.querySelector('.topic-scale').textContent,'FewerMore');assert.equal(node.querySelectorAll('.topic-scale i').length,5);
  assert.equal(node.querySelector('.topic-list'),null);
  assert.deepEqual([...node.querySelectorAll('.topic-view button')].map(b=>b.textContent+':'+b.getAttribute('aria-pressed')),['Grid:true','List:false']);
});
test('the list shows each topic once with its count for the chosen period, and keeps the choice in the URL',async t=>{
  const {node,wait,window}=await mount(t,{url:'http://localhost/?view=legislation&pl-mode=topics',fetch:overview});
  await wait(()=>node.querySelector('.topic-heat'));
  await act(async()=>[...node.querySelectorAll('.topic-view button')].find(b=>b.textContent==='List').click());
  await wait(()=>node.querySelector('.topic-list'));
  assert.equal(new URL(location.href).searchParams.get('t-view'),'list');
  assert.equal(node.querySelector('.topic-heat'),null);
  const rows=[...node.querySelectorAll('.topic-list li')];
  assert.deepEqual(rows.map(row=>row.textContent),['Fundamental freedoms40','Energy policy12']);
  assert.match(rows[1].querySelector('a').getAttribute('href'),/topic=oeil%3A3\.60/);
  assert.equal(rows[1].querySelector('b').getAttribute('aria-label'),'12 debates and dossiers');
  await act(async()=>[...node.querySelectorAll('.topic-sort button')].find(b=>b.textContent==='2025 Q1').click());
  await wait(()=>node.querySelector('.topic-list li').textContent==='Energy policy9');
  await act(async()=>[...node.querySelectorAll('.topic-view button')].find(b=>b.textContent==='Grid').click());
  await wait(()=>node.querySelector('.topic-heat'));
  assert.equal(new URL(location.href).searchParams.get('t-view'),'grid');
  void window;
});
test('a narrow screen opens on the list unless the grid is chosen',async t=>{
  const {node,wait}=await mount(t,{url:'http://localhost/?view=legislation&pl-mode=topics',narrow:true,fetch:overview});
  await wait(()=>node.querySelector('.topic-list'));
  assert.equal(node.querySelector('.topic-heat'),null);
  await act(async()=>[...node.querySelectorAll('.topic-view button')].find(b=>b.textContent==='Grid').click());
  await wait(()=>node.querySelector('.topic-heat'));
});
test('a grid choice in the URL wins on a narrow screen',async t=>{
  const {node,wait}=await mount(t,{url:'http://localhost/?view=legislation&pl-mode=topics&t-view=grid',narrow:true,fetch:overview});
  await wait(()=>node.querySelector('.topic-heat'));
  assert.equal(node.querySelector('.topic-list'),null);
});

const group=(procedureId,reference,title)=>({key:procedureId,kind:'procedure',title,date:'2026-10-22',reference,procedureId,items:[],speechCount:0,speakers:[]});
const detail=(statuses)=>url=>{
  if(url.pathname==='/api/topics/story-facts')return Response.json({ready:false});
  if(url.pathname==='/api/insights/dossier-statuses')return statuses(url);
  assert.equal(url.pathname,'/api/topics/detail');
  return Response.json({ready:true,concept:{key:'oeil:3.60',label:'Energy policy',role:'topic'},periods:['2026-Q4'],partial:{first:null,last:null},series:[{period:'2026-Q4',groups:3,speech:0,question:0,document:0}],groupsTotal:3,total:3,nextOffset:null,facets:{keywords:[],places:[],topics:[]},
    groups:[group('2025-0222','2025/0222(COD)','Erasmus+'),group('2025-0235','2025/0235(COD)','Fisheries'),{key:'MTG-PL-2026-10-22-OJ-ITM-D-5',kind:'debate',title:'A debate',date:'2026-10-22',items:[],speechCount:0,speakers:[]}]});
};
test('dossier rows show their reference and status, and rows without a known status show neither a gap nor a message',async t=>{
  const asked=[];
  const {node,wait}=await mount(t,{url:'http://localhost/?view=legislation&pl-mode=topics&topic=oeil%3A3.60',fetch:detail(url=>{asked.push(url.searchParams.get('procedures'));return Response.json({version:1,items:[{id:'2025-0222',reference:'2025/0222(COD)',stage:'position-talks'}]});})});
  await wait(()=>node.querySelectorAll('.topic-record-group').length===3&&/Parliament position adopted/.test(node.textContent));
  const rows=[...node.querySelectorAll('.topic-record-group > small')].map(row=>row.textContent);
  assert.deepEqual(rows,['2026-10-22 · Dossier · 2025/0222(COD) · Parliament position adopted','2026-10-22 · Dossier · 2025/0235(COD)','2026-10-22 · Debate']);
  assert.deepEqual(asked,['2025-0222,2025-0235'],'one read for the page, exact identifiers only');
});
test('a failed status read leaves the references without status or message',async t=>{
  const {node,wait}=await mount(t,{url:'http://localhost/?view=legislation&pl-mode=topics&topic=oeil%3A3.60',fetch:detail(()=>Response.json({error:{code:'down',message:'Down'}},{status:503}))});
  await wait(()=>node.querySelectorAll('.topic-record-group').length===3);
  await act(async()=>new Promise(r=>setTimeout(r,100)));
  assert.deepEqual([...node.querySelectorAll('.topic-record-group > small')].map(row=>row.textContent).slice(0,2),['2026-10-22 · Dossier · 2025/0222(COD)','2026-10-22 · Dossier · 2025/0235(COD)']);
  assert.doesNotMatch(node.textContent,/Down|unavailable/i);
});

const topicViewIds=['topics.heatCaption','topics.scaleFewer','topics.scaleMore','topics.viewLabel','topics.viewGrid','topics.viewList'];
test('messages missing from a catalogue keep their English language tag',async t=>{
  const {node,wait}=await mount(t,{url:'http://localhost/?view=legislation&pl-mode=topics&lang=fr',language:'fr',fetch:overview,omit:topicViewIds});
  await wait(()=>node.querySelector('.topic-heat'));
  const lang=element=>element.closest('[lang]')?.getAttribute('lang');
  assert.equal(node.querySelector('.topic-heat-key p').textContent,'Debates and dossiers per quarter.');
  assert.equal(lang(node.querySelector('.topic-heat-key p')),'en');
  assert.deepEqual([...node.querySelectorAll('.topic-scale span')].map(lang),['en','en']);
  const view=node.querySelector('.topic-view');
  assert.equal(view.getAttribute('lang'),'en');assert.equal(view.getAttribute('aria-label'),'View');
  assert.deepEqual([...view.querySelectorAll('button')].map(b=>b.textContent+':'+lang(b)),['Grid:en','List:en']);
});
test('translated topic view messages carry the interface language',async t=>{
  const french=JSON.parse(await readFile(new URL('./ui-locales/fr.json',import.meta.url),'utf8'));
  const {node,wait}=await mount(t,{url:'http://localhost/?view=legislation&pl-mode=topics&lang=fr',language:'fr',fetch:overview});
  await wait(()=>node.querySelector('.topic-heat'));
  const lang=element=>element.closest('[lang]')?.getAttribute('lang');
  assert.equal(node.querySelector('.topic-heat-key p').textContent,french['topics.heatCaption']);
  assert.equal(lang(node.querySelector('.topic-heat-key p')),'fr');
  assert.deepEqual([...node.querySelectorAll('.topic-scale span')].map(span=>span.textContent+':'+lang(span)),[french['topics.scaleFewer']+':fr',french['topics.scaleMore']+':fr']);
  const view=node.querySelector('.topic-view');
  assert.equal(view.getAttribute('lang'),'fr');assert.equal(view.getAttribute('aria-label'),french['topics.viewLabel']);
  assert.deepEqual([...view.querySelectorAll('button')].map(b=>b.textContent+':'+lang(b)),[french['topics.viewGrid']+':fr',french['topics.viewList']+':fr']);
});
test('a status word keeps the language of its own message',async t=>{
  const {node,wait}=await mount(t,{url:'http://localhost/?view=legislation&pl-mode=topics&topic=oeil%3A3.60&lang=fr',language:'fr',fetch:detail(()=>Response.json({version:1,items:[{id:'2025-0222',reference:'2025/0222(COD)',stage:'position-talks'}]}))});
  await wait(()=>node.querySelectorAll('.topic-record-group').length===3&&node.textContent.includes('Position du Parlement adoptée'));
  const word=[...node.querySelector('.topic-record-group small').querySelectorAll('span[lang]')].at(-1);
  assert.equal(word.getAttribute('lang'),'fr');assert.notEqual(word.textContent,'Parliament position adopted');
});
