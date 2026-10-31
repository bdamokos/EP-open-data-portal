import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {sourceAvailability} from '../server/source-availability.mjs';

test('title search preserves a dated failed root outside the returned page identities',async t=>{
 const window=new Window({url:'http://localhost/?global-fts=climate'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
 const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 const sourceId='/parliamentary-questions/E-10-2026-009999',availability=sourceAvailability({sourceKey:'questions',family:'questions',start:'2026-10-01',end:'2026-10-30',latestObservedDate:'2026-10-29',gaps:[{sourceId,start:'2026-10-16',end:'2026-10-16'}]});
 t.mock.method(globalThis,'fetch',async()=>Response.json({offset:0,sections:[{type:'question',total:1,nextOffset:null,truncated:false,results:[{id:'E-10-2026-000001',type:'question',title:'Retained climate question',titleLanguage:'en',date:'2026-10-29',sourceUrl:'https://example.invalid/question'}],coverage:{complete:false,available:true,limited:false,availability}}]}));
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}}),{ParliamentSearchResults}=await load('/src/ParliamentSearchResults.tsx'),{createRoot}=await import('react-dom/client');
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value]of previous)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 await act(async()=>root.render(createElement(ParliamentSearchResults,{query:'climate',type:'question',language:'en',from:'2026-10-01',to:'2026-10-30'})));
 await act(async()=>{});
 assert.match(container.textContent,/Retained climate question/);
 assert.match(container.textContent,/E-10-2026-009999/);
 assert(container.querySelector('.availability-gaps'));
});
