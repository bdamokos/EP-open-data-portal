import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

test('failed debate sections offer a real retry that bypasses the partial-result cache and recovers',async t=>{
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root,calls=0,finish;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const id='MTG-PL-2026-03-25-OTH-2017069380111',parent='MTG-PL-2026-03-25-PVCRE-ITM-13';
  const result={speechId:id,unavailable:false,debates:[{id:parent,titles:{en:'European Council conclusions'},records:[],exchanges:[],coverage:{complete:false,available:0,expected:null},error:'Parliament data is unavailable (429). Please try again.'}]};
  t.mock.method(globalThis,'fetch',async url=>{
    assert(String(url).includes('speech-context/'));calls++;
    if(calls===1)return Response.json(result);
    return new Promise(resolve=>finish=()=>resolve(Response.json({...result,debates:[{...result.debates[0],error:undefined,coverage:{complete:true,available:0,expected:0}}]})));
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocSpeechContext}=await vite.ssrLoadModule('/src/PocSpeechInterventions.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocSpeechContext,{id,language:'en'})));
  assert.equal(calls,0,'closed debate must not fetch');
  await act(async()=>container.querySelector('button').click());
  const retry=()=>[...container.querySelectorAll('button')].find(button=>button.textContent.includes('Retry'));
  assert.equal(retry().textContent,'Retry sequence');assert.equal(calls,1);
  await act(async()=>retry().click());assert.equal(calls,2);assert.equal(retry().disabled,true);
  assert(container.textContent.includes('Retrying sequence…'));assert(container.querySelector('[role="status"]'));
  await act(async()=>finish());assert.equal(retry(),undefined);assert(!container.textContent.includes('429'));assert(container.querySelector('ol'));
});

test('top-level rate errors show a countdown and enable retry after the cooldown',async t=>{
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:{message:'Parliament is temporarily limiting requests.',retryAt:Date.now()+500}},{status:503}));
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocSpeechContext}=await vite.ssrLoadModule('/src/PocSpeechInterventions.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');root=createRoot(container);
  await act(async()=>root.render(createElement(PocSpeechContext,{id:'MTG-PL-2026-03-25-OTH-2017069380108',language:'en'})));
  await act(async()=>container.querySelector('button').click());
  const retry=()=>[...container.querySelectorAll('button')].find(button=>button.textContent.startsWith('Retry sequence'));
  assert.equal(retry().disabled,true);assert.match(retry().textContent,/in 1s/);
  await act(async()=>new Promise(resolve=>setTimeout(resolve,1100)));
  assert.equal(retry().disabled,false);assert.equal(retry().textContent,'Retry sequence');
});
