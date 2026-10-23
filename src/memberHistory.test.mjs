import {viewReady} from './test-support/viewReady.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

// Synthetic directory: each unrelated row exercises one of the URL facets.
const makeMember=(id,firstName,lastName,role,overrides={})=>({id,firstName,lastName,sortName:lastName+' '+firstName,gender:'',countryCode:'HU',groupCode:'PfE',memberships:[{id:'6567',role,classification:'COMMITTEE',current:true}],accounts:[],...overrides});
const members=[
  makeMember(1,'Tamás','Deutsch','MEMBER'),
  makeMember(2,'Annamária','Vicsek','MEMBER_SUBSTITUTE'),
  makeMember(3,'Other','Country','MEMBER',{countryCode:'FR'}),
  makeMember(4,'Other','Group','MEMBER',{groupCode:'EPP'}),
  makeMember(5,'Other','Committee','MEMBER',{memberships:[]}),
];
const directory={day:'2026-10-17',members,committees:[{id:'6567',code:'BUDG',names:{en:'Budgets',hu:'Költségvetés'},classification:'COMMITTEE'}],index:{complete:true,loaded:members.length,total:members.length,failed:0,error:null}};
const selection='committee=6567&country=HU&group=PfE';

async function harness(t,query='lang=en&'+selection+'&role=member') {
  const window=new Window({url:'http://localhost/?'+query}),unexpected=[];
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,loadModule;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
    assert.deepEqual(unexpected,[],'all requests use local fixtures');
  });
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href);
    if(url.pathname==='/api/directory')return Response.json(directory);
    if(url.pathname.startsWith('/api/portrait/'))return new Response(null,{status:404});
    if(url.pathname.startsWith('/api/latest-activities/'))return Response.json({categories:{},categoryGroups:[],categoryCoverage:{},items:[],selectedItems:[],indexedTotal:0,nextOffset:null,cache:{complete:true}});
    if(url.pathname.startsWith('/api/speech-statistics/'))return Response.json({items:[],counts:{},groups:[],coverage:{available:0,total:0,complete:true,headers:0},sources:[],nextPage:null});
    if(url.pathname==='/api/insights/speech-cloud')return Response.json({scope:{},words:[],speeches:[],coverage:{transcripts:0,complete:true},window:{},nextPage:null});
    unexpected.push(url.href);throw Error('Unexpected fixture request: '+url.href);
  });
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {default:App}=await loadModule('/src/App.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(App)));await viewReady(container);
  const select=(node,value)=>act(async()=>{assert(node,'Missing select');node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const click=async text=>{await act(async()=>{const node=[...container.querySelectorAll('.parliament-header nav button')].find(node=>node.textContent===text);assert(node,'Missing navigation: '+text);node.click();});await viewReady(container);};
  const go=delta=>act(async()=>{
    let timer,listener;
    const popped=new Promise((resolve,reject)=>{listener=resolve;window.addEventListener('popstate',listener,{once:true});timer=setTimeout(()=>reject(Error('Missing popstate for history.go('+delta+')')),5000);});
    try{history.go(delta);await popped;}finally{clearTimeout(timer);window.removeEventListener('popstate',listener);}
  });
  const filters=()=>[...container.querySelectorAll('.explorer-filters select')];
  const language=()=>container.querySelector('[aria-label="Interface language"]');
  function agree(role,lang='en') {
    const query=new URLSearchParams(location.search);
    assert.deepEqual(filters().map(node=>node.value),['6567',role,'HU','PfE'],'rendered filter controls');
    assert.deepEqual(['committee','role','country','group','lang'].map(key=>query.get(key)),['6567',role,'HU','PfE',lang],'URL filters');
    assert.equal(language().value,lang);assert.equal(document.documentElement.lang,lang);
    const expected=role==='member'?[members[0]]:role==='substitute'?[members[1]]:members.slice(0,2);
    assert.deepEqual([...container.querySelectorAll('[data-member-id]')].map(node=>Number(node.dataset.memberId)),expected.map(row=>row.id),'actual filtered member identities');
    for(const row of expected)assert.match(container.querySelector(`[data-member-id="${row.id}"]`).textContent,new RegExp(row.firstName+'\\s*'+row.lastName));
  }
  const open=async id=>{await act(async()=>{const node=container.querySelector(`[data-member-id="${id}"] button`);assert(node,'Missing portrait: '+id);node.click();});await viewReady(container);};
  return {window,container,select,click,go,filters,language,agree,open};
}

test('Back and Forward restore Membership, every URL filter and actual directory results',async t=>{
  const h=await harness(t);h.agree('member');
  const initial=location.href;
  await h.click('Following');await h.click('Members');
  await h.select(h.filters()[1],'substitute');h.agree('substitute');
  const later=location.href,length=history.length,incoming=[];
  h.window.addEventListener('popstate',()=>incoming.push(location.href));
  await h.go(-2);assert.equal(incoming.at(-1),initial);assert.equal(location.href,initial);h.agree('member');
  await h.go(2);assert.equal(incoming.at(-1),later);assert.equal(location.href,later);h.agree('substitute');
  assert.equal(history.length,length,'restoration does not add history entries');
});

test('language follows history alongside Membership without overwriting restored parameters',async t=>{
  const h=await harness(t,'lang=hu&'+selection+'&role=member');h.agree('member','hu');
  await h.click('Following');await h.click('Members');
  await h.select(h.filters()[1],'substitute');await h.select(h.language(),'fr');h.agree('substitute','fr');
  await h.go(-2);h.agree('member','hu');
  await h.go(1);assert.equal(new URLSearchParams(location.search).get('view'),'saved');assert.equal(h.language().value,'hu');
  await h.go(1);h.agree('substitute','fr');
});

for(const query of [selection,selection+'&role=invalid&lang=invalid'])test('history applies initial-load defaults for '+query,async t=>{
  const h=await harness(t,query);h.agree('both');
  await h.click('Following');await h.click('Members');
  await h.select(h.filters()[1],'substitute');await h.select(h.language(),'hu');
  // Retain the raw old URL so popstate must validate absent/unsupported values.
  await act(async()=>{history.replaceState(null,'','/?'+query);h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));});
  h.agree('both');
});

test('opening and leaving an MEP from the member wall are Back/Forward steps',async t=>{
  const h=await harness(t);h.agree('member');
  const wall=location.href,length=history.length;
  await h.open(1);
  const profile=location.href,query=new URLSearchParams(location.search);
  assert.equal(history.length,length+1,'opening an MEP adds one history entry');
  assert.equal(query.get('member'),'1');assert.equal(h.container.querySelector('.explorer-profile h1')?.getAttribute('aria-label'),'Tamás Deutsch');
  await h.go(-1);assert.equal(location.href,wall);assert.equal(h.container.querySelector('.explorer-profile'),null);h.agree('member');
  await h.go(1);assert.equal(location.href,profile);assert.equal(h.container.querySelector('.explorer-profile h1')?.getAttribute('aria-label'),'Tamás Deutsch');
  await act(async()=>h.container.querySelector('.explorer-back').click());
  assert.equal(history.length,length+2,'leaving the MEP adds one history entry');h.agree('member');
  await h.go(-1);assert.equal(location.href,profile);assert(h.container.querySelector('.explorer-profile'));
});
