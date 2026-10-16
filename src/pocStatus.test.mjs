import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const wait=(ms=30)=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms));});
async function harness(t,query='',respond=()=>{throw Error('Unexpected request');}) {
  const window=new Window({url:'http://localhost/'+query});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,
    HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:class {observe(){} disconnect(){}},
    IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),innerWidth:1280,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,vite;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>Response.json(await respond(new URL(input,location.href))));
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  return {window,container,load:path=>vite.ssrLoadModule(path),render:node=>act(async()=>root.render(node)),unmount:()=>act(async()=>root.unmount())};
}

test('one persistent polite atomic region debounces obsolete outcomes without moving focus',async t=>{
  const h=await harness(t),{PocStatus}=await h.load('/src/PocStatus.tsx');
  const render=props=>h.render(createElement('div',null,createElement('input',{'aria-label':'Filter'}),createElement(PocStatus,{delay:20,...props})));
  await render({scope:'initial',message:null,pending:true});
  const status=h.container.querySelector('[role="status"]'),input=h.container.querySelector('input');input.focus();
  assert.equal(status.textContent,'');assert.equal(status.getAttribute('aria-live'),'polite');assert.equal(status.getAttribute('aria-atomic'),'true');assert.equal(status.lang,'en');
  const messages=[],observer=new h.window.MutationObserver(()=>{if(status.textContent)messages.push(status.textContent);});
  observer.observe(status,{subtree:true,childList:true,characterData:true});t.after(()=>observer.disconnect());
  await render({scope:'a',message:'3 members'});await render({scope:'ab',message:'No members'});await render({scope:'abc',message:'1 member'});await wait();
  assert.deepEqual(messages,['1 member']);assert.equal(h.container.querySelector('[role="status"]'),status);assert.equal(document.activeElement,input);
  await render({scope:'other-filter',message:'1 member'});assert.equal(status.textContent,'');await wait();
  assert.deepEqual(messages,['1 member','1 member'],'different settled filters with equal counts each receive an update');
});

test('settled results suppress unchanged polling and clear invalidated counts without a background announcement',async t=>{
  const h=await harness(t),{PocStatus}=await h.load('/src/PocStatus.tsx');
  const render=props=>h.render(createElement(PocStatus,{scope:'filter',message:'2 speakers. Partial coverage.',oncePerScope:true,delay:10,...props}));
  await render();await wait();const status=h.container.querySelector('[role="status"]');
  let updates=0;const observer=new h.window.MutationObserver(()=>{if(status.textContent)updates++;});observer.observe(status,{subtree:true,childList:true,characterData:true});t.after(()=>observer.disconnect());
  await render({pending:true});await render();await wait();assert.equal(updates,0);assert.equal(status.textContent,'2 speakers. Partial coverage.');
  await render({message:'3 speakers. Partial coverage.'});await wait();assert.equal(status.textContent,'');assert.equal(updates,0,'changed polling data must not queue a spoken count');
  await render({scope:'new-filter',message:'No indexed speakers match. Partial coverage.'});await wait();
  assert.equal(updates,1);assert.match(status.textContent,/No indexed speakers.*Partial coverage/);
});

test('pending requests cancel queued success, and a repeated explicit reader failure is announced again',async t=>{
  const h=await harness(t),{PocStatus}=await h.load('/src/PocStatus.tsx');
  const render=props=>h.render(createElement(PocStatus,{scope:'reader',delay:10,...props}));
  await render({message:'Text loaded.'});await render({message:null,pending:true});await wait();
  const status=h.container.querySelector('[role="status"]');assert.equal(status.textContent,'');
  await render({message:'Text temporarily unavailable.'});await wait();assert.equal(status.textContent,'Text temporarily unavailable.');
  await render({message:null,pending:true});assert.equal(status.textContent,'');
  await render({message:'Text temporarily unavailable.'});await wait();assert.equal(status.textContent,'Text temporarily unavailable.');
  await render({scope:'next-reader',message:'Obsolete reader'});await h.unmount();await wait();assert.equal(h.container.textContent,'');
});

const member=(id,countryCode)=>({id,firstName:'Fixture',lastName:String(id),sortName:String(id),countryCode,groupCode:'EPP',gender:'f',memberships:[],accounts:[]});
const directory={day:'2026-10-16',members:[member(1,'BE'),member(2,'FI')],committees:[{id:'ENVI',code:'ENVI',names:{en:'Environment'}}],index:{complete:false,loaded:0,total:2,failed:0,error:null}};
test('member count waits for directory and committee coverage, and polling never reannounces a settled filter',async t=>{
  let resolve,response=directory;
  const pending=new Promise(done=>{resolve=done;});
  const h=await harness(t,'?poc=1&committee=ENVI',url=>{
    if(url.pathname.endsWith('/directory'))return response===directory?pending:response;
    if(url.pathname.endsWith('/insights/saved'))return {members:[],questions:[]};
    throw Error('Unexpected fixture request: '+url);
  });
  const poll=[];t.mock.method(h.window,'setInterval',(callback,delay)=>{if(delay===10_000||delay===60_000)poll.push(callback);return 1;});t.mock.method(h.window,'clearInterval',()=>{});
  const {default:PocApp}=await h.load('/src/PocApp.tsx');await h.render(createElement(PocApp));
  const status=h.container.querySelector('[role="status"][aria-atomic="true"]');assert(status);assert.equal(status.textContent,'');
  await act(async()=>resolve(directory));await wait(380);
  assert.equal(status.textContent,'','incomplete membership data must not announce a false zero');assert.equal(h.container.querySelector('.poc-results strong').textContent,'—');
  response={...directory,index:{...directory.index,complete:true,loaded:2},members:directory.members.map(m=>({...m,memberships:[{id:'ENVI',current:true,role:'MEMBER'}]}))};
  await act(async()=>poll.at(-1)());await wait(380);assert.equal(status.textContent,'2 MEPs match these filters.');
  const country=h.container.querySelector('select[aria-label="Country"]')||[...h.container.querySelectorAll('select')].find(n=>[...n.options].some(o=>o.value==='FI'));assert(country);country.focus();
  await act(async()=>{country.value='FI';country.dispatchEvent(new h.window.Event('change',{bubbles:true}));});await wait(380);
  assert.equal(status.textContent,'1 MEP matches these filters.');assert.equal(document.activeElement,country);assert.equal(new URL(location.href).searchParams.get('country'),'FI');
  let updates=0;const observer=new h.window.MutationObserver(()=>{if(status.textContent)updates++;});observer.observe(status,{subtree:true,childList:true,characterData:true});t.after(()=>observer.disconnect());
  await act(async()=>poll.at(-1)());await wait(380);assert.equal(updates,0);assert.equal(document.activeElement,country);
});
