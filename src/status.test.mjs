import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const wait=(ms=30)=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms));});
async function harness(t,query='',respond=()=>{throw Error('Unexpected request');}) {
  const window=new Window({url:'http://localhost/'+query});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,
    HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:class {observe(){} disconnect(){}},
    IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),innerWidth:1280,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,loadModule;
  t.after(async()=>{t.mock.timers.reset();if(root)await act(async()=>root.unmount());await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>Response.json(await respond(new URL(input,location.href))));
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  // Status debounces with the global setTimeout. Fake it only after Vite has
  // loaded the module; happy-dom keeps its own real timers and microtask delivery.
  const tick=ms=>act(async()=>{t.mock.timers.tick(ms);});
  const load=async path=>{const module=await loadModule(path);if(path==='/src/Status.tsx')t.mock.timers.enable({apis:['setTimeout']});return module;};
  return {window,container,load,tick,render:node=>act(async()=>root.render(node)),unmount:()=>act(async()=>root.unmount())};
}

test('one persistent polite atomic region debounces obsolete outcomes without moving focus',async t=>{
  const h=await harness(t),{Status}=await h.load('/src/Status.tsx');
  const render=props=>h.render(createElement('div',null,createElement('input',{'aria-label':'Filter'}),createElement(Status,{delay:20,...props})));
  await render({scope:'initial',message:null,pending:true});
  const status=h.container.querySelector('[role="status"]'),input=h.container.querySelector('input');input.focus();
  assert.equal(status.textContent,'');assert.equal(status.getAttribute('aria-live'),'polite');assert.equal(status.getAttribute('aria-atomic'),'true');assert.equal(status.lang,'en');
  const messages=[],observer=new h.window.MutationObserver(()=>{if(status.textContent)messages.push(status.textContent);});
  observer.observe(status,{subtree:true,childList:true,characterData:true});t.after(()=>observer.disconnect());
  await render({scope:'a',message:'3 members'});await render({scope:'ab',message:'No members'});await render({scope:'abc',message:'1 member'});await h.tick(30);
  assert.deepEqual(messages,['1 member']);assert.equal(h.container.querySelector('[role="status"]'),status);assert.equal(document.activeElement,input);
  await render({scope:'other-filter',message:'1 member'});assert.equal(status.textContent,'');await h.tick(30);
  assert.deepEqual(messages,['1 member','1 member'],'different settled filters with equal counts each receive an update');
});

test('settled results suppress unchanged polling and clear invalidated counts without a background announcement',async t=>{
  const h=await harness(t),{Status}=await h.load('/src/Status.tsx');
  const render=props=>h.render(createElement(Status,{scope:'filter',message:'2 speakers. Partial coverage.',oncePerScope:true,delay:10,...props}));
  await render();await h.tick(30);const status=h.container.querySelector('[role="status"]');
  let updates=0;const observer=new h.window.MutationObserver(()=>{if(status.textContent)updates++;});observer.observe(status,{subtree:true,childList:true,characterData:true});t.after(()=>observer.disconnect());
  await render({pending:true});await render();await h.tick(30);assert.equal(updates,0);assert.equal(status.textContent,'2 speakers. Partial coverage.');
  await render({message:'3 speakers. Partial coverage.'});await h.tick(30);assert.equal(status.textContent,'');assert.equal(updates,0,'changed polling data must not queue a spoken count');
  await render({scope:'new-filter',message:'No indexed speakers match. Partial coverage.'});await h.tick(30);
  assert.equal(updates,1);assert.match(status.textContent,/No indexed speakers.*Partial coverage/);
});

test('returning to an earlier filter never restores its announcement before the debounce settles',async t=>{
  for(const oncePerScope of [false,true])await t.test(String(oncePerScope),async t=>{
    const h=await harness(t),{Status}=await h.load('/src/Status.tsx');
    const render=scope=>h.render(createElement(Status,{scope,message:scope+' results',oncePerScope,delay:30}));
    await render('A');await h.tick(40);
    const status=h.container.querySelector('[role="status"]'),messages=[];
    assert.equal(status.textContent,'A results');
    const observer=new h.window.MutationObserver(()=>{if(status.textContent)messages.push(status.textContent);});
    observer.observe(status,{subtree:true,childList:true,characterData:true});t.after(()=>observer.disconnect());
    await render('B');await render('A');
    assert.equal(status.textContent,'','returning to A must wait for a fresh debounce');
    await render('C');await h.tick(40);
    assert.deepEqual(messages,['C results'],'A and B were superseded before settling');
    await render('A');assert.equal(status.textContent,'');await h.tick(40);
    assert.equal(status.textContent,'A results','a settled return to A is announced normally');
  });
});

test('pending requests cancel queued success, and a repeated explicit reader failure is announced again',async t=>{
  const h=await harness(t),{Status}=await h.load('/src/Status.tsx');
  const render=props=>h.render(createElement(Status,{scope:'reader',delay:10,...props}));
  await render({message:'Text loaded.'});await render({message:null,pending:true});await h.tick(30);
  const status=h.container.querySelector('[role="status"]');assert.equal(status.textContent,'');
  await render({message:'Text temporarily unavailable.'});await h.tick(30);assert.equal(status.textContent,'Text temporarily unavailable.');
  await render({message:null,pending:true});assert.equal(status.textContent,'');
  await render({message:'Text temporarily unavailable.'});await h.tick(30);assert.equal(status.textContent,'Text temporarily unavailable.');
  await render({scope:'next-reader',message:'Obsolete reader'});await h.unmount();await h.tick(30);assert.equal(h.container.textContent,'');
});

const member=(id,countryCode)=>({id,firstName:'Fixture',lastName:String(id),sortName:String(id),countryCode,groupCode:'EPP',gender:'f',memberships:[],accounts:[]});
const directory={day:'2026-10-16',members:[member(1,'BE'),member(2,'FI')],committees:[{id:'ENVI',code:'ENVI',names:{en:'Environment'}}],index:{complete:false,loaded:0,total:2,failed:0,error:null}};
test('member count labels partial committee coverage, and polling never reannounces a settled filter',async t=>{
  let resolve,response=directory;
  const pending=new Promise(done=>{resolve=done;});
  const h=await harness(t,'?committee=ENVI',url=>{
    if(url.pathname.endsWith('/directory'))return response===directory?pending:response;
    if(url.pathname.endsWith('/insights/following-status'))return {epoch:'test',generation:1,marksReady:false,indexComplete:false};
    if(url.pathname.endsWith('/insights/saved'))return {members:[],questions:[]};
    throw Error('Unexpected fixture request: '+url);
  });
  const poll=[];t.mock.method(h.window,'setInterval',(callback,delay)=>{if(delay===10_000||delay===60_000)poll.push(callback);return 1;});t.mock.method(h.window,'clearInterval',()=>{});
  const {default:App}=await h.load('/src/App.tsx');await h.render(createElement(App));
  const status=h.container.querySelector('[role="status"][aria-atomic="true"]');assert(status);assert.equal(status.textContent,'');
  await act(async()=>resolve(directory));await wait(380);
  assert.equal(status.textContent,'No matches in the loaded memberships yet. Committee memberships are incomplete.','incomplete membership data must not announce a false zero');assert.equal(h.container.querySelector('.explorer-results strong').textContent,'—');
  response={...directory,index:{...directory.index,complete:true,loaded:2},members:directory.members.map(m=>({...m,memberships:[{id:'ENVI',current:true,role:'MEMBER'}]}))};
  await act(async()=>poll.at(-1)());await wait(380);assert.equal(status.textContent,'','background completion must not reannounce the same filter');
  const country=h.container.querySelector('select[aria-label="Country"]')||[...h.container.querySelectorAll('select')].find(n=>[...n.options].some(o=>o.value==='FI'));assert(country);country.focus();
  await act(async()=>{country.value='FI';country.dispatchEvent(new h.window.Event('change',{bubbles:true}));});await wait(380);
  assert.equal(status.textContent,'1 MEP matches these filters.');assert.equal(document.activeElement,country);assert.equal(new URL(location.href).searchParams.get('country'),'FI');
  let updates=0;const observer=new h.window.MutationObserver(()=>{if(status.textContent)updates++;});observer.observe(status,{subtree:true,childList:true,characterData:true});t.after(()=>observer.disconnect());
  await act(async()=>poll.at(-1)());await wait(380);assert.equal(updates,0);assert.equal(document.activeElement,country);
});


test('known committee matches stay usable after another profile fails, with honest counts and recoverable details',async t=>{
  let response={...directory,committeeDetails:{complete:false,loaded:0,total:1,failed:1,error:'Some committee details are unavailable. Showing retained names or committee codes.'},committees:[{id:'ENVI',code:'ENVI',names:{}}],index:{...directory.index,loaded:1,failed:1,error:'Some membership profiles could not be loaded. Retry the membership index.'},members:[{...member(1,'BE'),memberships:[{id:'ENVI',current:true,role:'MEMBER'}]},{...member(2,'FI'),memberships:null}]};
  const directoryReads=[];
  const h=await harness(t,'?committee=ENVI',url=>{
    if(url.pathname.endsWith('/directory')){directoryReads.push(url);return response;}
    if(url.pathname.endsWith('/insights/following-status'))return {epoch:'test',generation:1,marksReady:false,indexComplete:false};
    if(url.pathname.endsWith('/insights/saved'))return {members:[],questions:[]};
    throw Error('Unexpected fixture request: '+url);
  });
  const {default:App}=await h.load('/src/App.tsx');await h.render(createElement(App));await wait(380);
  assert.equal(h.container.querySelector('.explorer-results strong').textContent,'1+');
  assert.equal(h.container.querySelectorAll('.explorer-portrait-item').length,1);
  assert.match(h.container.textContent,/Showing known matches.*results are incomplete/);
  assert.match(h.container.querySelector('option[value="ENVI"]').textContent,/ENVI.*Name unavailable/);
  const retry=[...h.container.querySelectorAll('button')].find(node=>node.textContent==='Retry membership index');assert(retry);
  const detailsRetry=[...h.container.querySelectorAll('button')].find(node=>node.textContent==='Retry committee details');assert(detailsRetry);
  await act(async()=>detailsRetry.click());await wait(30);assert(directoryReads.some(url=>url.searchParams.get('retry')==='committee-details'));
  response={...response,committeeDetails:{complete:true,loaded:1,total:1,failed:0,error:null},committees:[{id:'ENVI',code:'ENVI',names:{fr:'Environnement'}}],index:{complete:true,loaded:2,total:2,failed:0,error:null},members:response.members.map(m=>({...m,memberships:[{id:'ENVI',current:true,role:'MEMBER'}]}))};
  await act(async()=>retry.click());await wait(380);
  assert.equal(h.container.querySelector('.explorer-results strong').textContent,'2');assert.equal(h.container.querySelectorAll('.explorer-portrait-item').length,2);
  const option=h.container.querySelector('option[value="ENVI"]');assert.match(option.textContent,/Environnement/);assert.equal(option.lang,'fr');
  assert.doesNotMatch(h.container.textContent,/results are incomplete|Retry membership index|Retry committee details/);
});


test('completed memberships keep polling promptly until optional committee names arrive',async t=>{
  let response={...directory,committees:[{id:'ENVI',code:'ENVI',names:{}}],committeeDetails:{complete:false,loaded:0,total:1,failed:0,error:null},index:{complete:true,loaded:2,total:2,failed:0,error:null}};
  const h=await harness(t,'',url=>{
    if(url.pathname.endsWith('/directory'))return response;
    if(url.pathname.endsWith('/insights/following-status'))return {epoch:'test',generation:1,marksReady:false,indexComplete:false};
    if(url.pathname.endsWith('/insights/saved'))return {members:[],questions:[]};
    throw Error('Unexpected fixture request: '+url);
  });
  const polling=[];t.mock.method(h.window,'setInterval',(callback,delay)=>{if(delay===10_000||delay===60_000)polling.push({callback,delay});return 1;});t.mock.method(h.window,'clearInterval',()=>{});
  const {default:App}=await h.load('/src/App.tsx');await h.render(createElement(App));await wait();
  assert.match(h.container.querySelector('option[value="ENVI"]').textContent,/Name unavailable/);
  assert.equal(polling.at(-1).delay,10_000,'finishing the profile index must not delay incomplete committee names for a minute');
  response={...response,committees:[{id:'ENVI',code:'ENVI',names:{en:'Environment'}}],committeeDetails:{complete:true,loaded:1,total:1,failed:0,error:null}};
  await act(async()=>polling.at(-1).callback());await wait();
  assert.match(h.container.querySelector('option[value="ENVI"]').textContent,/Environment/);
  assert.doesNotMatch(h.container.textContent,/Loading committee names/);
  assert.equal(polling.at(-1).delay,60_000,'settled names and memberships use the normal refresh interval');
});
