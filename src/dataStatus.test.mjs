import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

test('data hook exposes snapshot and reader HTTP failures and clears their status after retry or navigation',async t=>{
  const window=new Window({url:'http://localhost/'}),originals=new Map();
  for(const [key,value] of Object.entries({window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
  let root,loadModule,reply=409;
  t.after(async()=>{if(root)await act(async()=>root.unmount());await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async()=>Response.json(reply===200?{ok:true}:{error:{message:reply===409?'Snapshot expired.':'Please try again.',retryAt:123}},{status:reply}));
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true}});
  const {useData}=await loadModule('/src/data.ts');
  function Reader({route}) {const state=useData(route);return createElement('div',null,createElement('output',null,JSON.stringify(state)),createElement('button',{onClick:state.retry},'Retry'));}
  const {createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const settle=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
  const render=async route=>{await act(async()=>root.render(createElement(Reader,{route})));await settle();};
  const state=()=>JSON.parse(container.querySelector('output').textContent);
  await render('member-votes/197591?week=2026-10-05');assert.equal(state().status,409);assert.equal(state().retryAt,123);assert.equal(state().data,null);
  reply=200;await act(async()=>container.querySelector('button').click());await settle();assert.equal(state().status,undefined);assert.equal(state().error,null);assert.deepEqual(state().data,{ok:true});
  reply=503;await render('document-context/A-10-2026-0237?lang=en');assert.equal(state().status,503);assert.equal(state().data,null,'a failed new route cannot reuse another route’s data');
  await render(null);assert.equal(state().status,undefined);assert.equal(state().error,null);assert.equal(state().data,null);
});
