import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

test('suggestion actions preserve focus; failed follows announce an alert; storage error shown once',async t=>{
 const window=new Window({url:'http://localhost/'}),originals=new Map();
 for(const [key,value] of Object.entries({window,document:window.document,location:window.location,HTMLElement:window.HTMLElement,HTMLImageElement:window.HTMLImageElement,IntersectionObserver:window.IntersectionObserver,IS_REACT_ACT_ENVIRONMENT:true})){
   originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 }
 let root,loadModule;
 t.after(async()=>{if(root)await act(async()=>root.unmount());await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
 loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {FollowSuggestions}=await loadModule('/src/FollowSuggestions.tsx'),{coverageStore,savedStore}=await loadModule('/src/SavedControls.tsx'),{createRoot}=await import('react-dom/client');
 const m=id=>({id,firstName:'Member',lastName:String(id),countryCode:'MT',groupCode:null,memberships:[],imageUrl:'/assets/portrait-placeholder.svg'});
 const d=members=>({members,committees:[],index:{complete:true,error:null}});
 savedStore.toggle({kind:'mep',id:'1',title:'Member 1'});
 coverageStore.observe(d([m(1)]),savedStore.snapshot().items);coverageStore.observe(d([m(1),m(2),m(3)]),savedStore.snapshot().items);
 const container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(createElement(FollowSuggestions)));
 const button=name=>container.querySelector(`[aria-label="${name}"]`);
 assert(button('Follow Member 2'));const toggle=savedStore.toggle;
 savedStore.toggle=()=>{throw Error('The MEP selection is too large.');};
 await act(async()=>button('Follow Member 2').click());assert.match(container.querySelector('[role="alert"]').textContent,/selection is too large/);assert(button('Follow Member 2'));
 savedStore.toggle=toggle;
 await act(async()=>button('Follow Member 2').click());assert.equal(document.activeElement,button('Follow Member 3'));assert(savedStore.snapshot().items.some(i=>i.id==='2'));
 await act(async()=>button('Dismiss suggestion for Member 3').click());assert.equal(document.activeElement,container.querySelector('h2'));assert.equal(coverageStore.suggestions().length,0);
 await act(async()=>document.activeElement.blur());assert.equal(container.querySelector('section'),null);
 // Enrollment writes use a separate key and fail visibly without affecting follows.
 t.mock.method(window.localStorage,'setItem',()=>{throw Error('full');});
 await act(async()=>coverageStore.observe(d([m(1),m(2)]),savedStore.snapshot().items));
 // Force a write after a stable observation.
 await act(async()=>coverageStore.retryStorage());assert.equal(container.querySelectorAll('[role="alert"]').length,1);
});
