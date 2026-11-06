import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {viewReady} from './test-support/viewReady.mjs';

const committees=[{id:'6567',code:'BUDG',names:{en:'Budgets'},classification:'COMMITTEE_PARLIAMENTARY_STANDING'},{id:'6568',code:'AFET',names:{en:'Foreign Affairs'},classification:'COMMITTEE_PARLIAMENTARY_STANDING'}];
const person=(id,firstName,lastName,countryCode,groupCode,seats,party)=>({id,firstName,lastName,sortName:lastName,gender:null,countryCode,groupCode,
  memberships:seats.map(([committee,role])=>({id:committee,role,classification:'COMMITTEE_PARLIAMENTARY_STANDING',current:true,start:'2024-07-19',end:null})),
  organizationMemberships:party?[{id:party,role:'MEMBER',classification:'NATIONAL_POLITICAL_GROUP',current:true,start:'2024-07-19',end:null}]:[],organizationMembershipsComplete:true});
const members=[
  person(1,'Anna','Abel','MT','PPE',[['6568','MEMBER'],['6567','MEMBER_SUBSTITUTE']],'900'),
  person(2,'Bela','Bay','HU','Verts/ALE',[['6567','MEMBER']],'901'),
  person(3,'Cora','Cox','MT','S&D',[],null),
  {...person(4,'Dan','Dee','HU','PPE',[],'902'),memberships:null},
];
const directory=(count=members.length)=>({day:'2026-11-06',members:members.length>=count?members.slice(0,count):members,committees,parties:{900:'PN',901:'GRÜNE'},index:{complete:true,loaded:4,total:4,failed:0,error:null},committeeDetails:{complete:true,loaded:2,total:2,failed:0,error:null},sync:{error:null,lastSuccess:null,lastAttempt:null,changedMeps:0,changedCommittees:0}});

async function harness(t,{width,query='view=meps&lang=en',source=directory()}) {
  const window=new Window({url:'http://localhost/?'+query,width,height:900}),unexpected=[];
  const globals={window,document:window.document,location:window.location,history:window.history,localStorage:window.localStorage,Event:window.Event,HTMLElement:window.HTMLElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),matchMedia:window.matchMedia.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,loadModule;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
    assert.deepEqual(unexpected,[],'all requests use local fixtures');
  });
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href);
    if(url.pathname==='/api/directory')return Response.json(source);
    if(url.pathname.startsWith('/api/portrait/'))return new Response(null,{status:404});
    unexpected.push(url.href);throw Error('Unexpected fixture request: '+url.href);
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {default:App}=await loadModule('/src/App.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(App)));await viewReady(container);
  const click=node=>act(async()=>{assert(node,'Missing control');node.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));});
  const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
  const names=()=>[...container.querySelectorAll('[data-member-id]')].map(node=>node.dataset.memberId);
  return {container,click,button,names,window};
}

test('wide screens start with cards that carry an affiliation line and offer a list with sortable columns',async t=>{
  const h=await harness(t,{width:1280});
  const {container}=h;
  assert(container.querySelector('.explorer-portraits'),'cards by default');
  assert.deepEqual([...container.querySelectorAll('.explorer-portrait-item .member-affiliation')].map(node=>node.textContent),['EPP · Malta','Greens/EFA · Hungary','S&D · Malta','EPP · Hungary']);
  const group=[...container.querySelectorAll('.explorer-filters select')].at(-1);
  assert.deepEqual([...group.options].map(option=>[option.value,option.textContent]),[['','All'],['PPE','EPP'],['Verts/ALE','Greens/EFA'],['S&D','S&D']],'group names, not raw codes');
  await h.click(h.button('List'));
  assert.equal(new URL(h.window.location.href).searchParams.get('mep-view'),'list');
  assert.equal(container.querySelector('.explorer-portraits'),null);
  const rows=[...container.querySelectorAll('.member-list__table tbody tr')].map(row=>[...row.children].map(cell=>cell.textContent));
  assert.deepEqual(rows.map(row=>row.slice(1,5)),[['Anna Abel','EPP','Malta','AFET, BUDG (sub)'],['Bela Bay','Greens/EFA','Hungary','BUDG'],['Cora Cox','S&D','Malta',''],['Dan Dee','EPP','Hungary','']]);
  assert.deepEqual(rows.map(row=>row[5]),['PN','GRÜNE','','']);
  const count=()=>container.querySelector('.explorer-results strong').textContent;
  assert.equal(count(),'4');
  await h.click(container.querySelector('.member-list__table thead th:nth-child(4) button'));
  assert.deepEqual(h.names(),['2','4','1','3'],'Hungary before Malta, ties by name');
  assert.equal(container.querySelector('.member-list__table thead th:nth-child(4)').getAttribute('aria-sort'),'ascending');
  await h.click(container.querySelector('.member-list__table thead th:nth-child(4) button'));
  assert.deepEqual(h.names(),['1','3','2','4']);
  assert.equal(count(),'4','sorting never changes the count');
  await h.click(h.button('Cards'));
  assert.equal(new URL(h.window.location.href).searchParams.get('mep-view'),'cards');
  assert(container.querySelector('.explorer-portraits'));
});

test('phones start with a two-line list and collapse the filters behind a count',async t=>{
  const h=await harness(t,{width:390,query:'lang=en&country=MT'});
  const {container}=h;
  assert.equal(container.querySelector('.member-list__table'),null);
  assert.deepEqual([...container.querySelectorAll('.member-list__compact li')].map(item=>item.querySelector('.member-list__open').textContent+' | '+item.querySelector('.member-affiliation').textContent),['Anna Abel | EPP · Malta · AFET, BUDG (sub)','Cora Cox | S&D · Malta']);
  assert.equal(container.querySelector('.explorer-filter-fields').hidden,true);
  assert.equal(new URL(h.window.location.href).searchParams.has('mep-view'),false,'the default view is not written to the URL');
  const toggle=h.button('Filters (1)');
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  const chip=[...container.querySelectorAll('.explorer-active-filters button')];
  assert.deepEqual(chip.map(node=>node.textContent.trim()),['Malta ×']);
  await h.click(toggle);
  assert.equal(container.querySelector('.explorer-filter-fields').hidden,false);
  assert.equal(container.querySelector('.explorer-active-filters'),null,'chips give way to the open filters');
  await h.click(h.button('Filters (1)'));
  await h.click(container.querySelector('.explorer-active-filters button'));
  assert.equal(container.querySelector('.explorer-results strong').textContent,'4');
  assert(h.button('Filters'),'no count without applied filters');
});

test('the list pages in fifty rows and keeps the exact count',async t=>{
  const many=Array.from({length:120},(_,index)=>person(1000+index,'Given','Member'+String(index).padStart(3,'0'),'MT','PPE',[],null));
  const h=await harness(t,{width:1280,query:'lang=en&mep-view=list',source:{...directory(),members:many,index:{complete:true,loaded:120,total:120,failed:0,error:null}}});
  const {container}=h;
  assert.equal(h.names().length,50);
  assert.equal(container.querySelector('.explorer-results strong').textContent,'120');
  await h.click(h.button('Show more'));
  assert.equal(h.names().length,100);
  assert.equal(h.window.document.activeElement.textContent,'Given Member050','focus moves to the first added row');
  await h.click(h.button('Show more'));
  assert.equal(h.names().length,120);
  assert.equal(h.button('Show more'),undefined);
});
