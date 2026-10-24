import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

test('dossier summary loading and failure do not expose the unfinished amendment catalogue',async t=>{
  const window=new Window({url:'http://localhost/?view=legislation'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root,respond;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(loadModule)await loadModule.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const pending=new Promise(resolve=>{respond=resolve;});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);
    if(url.pathname.endsWith('/insights/procedure-progress'))return Response.json({reference:'2025/0407(COD)',state:'unmapped',events:[],coverage:{limited:false,invalidRows:0,incompleteEvents:0},source:{fetchedAt:'2026-10-20T10:00:00Z',stale:false,refreshInProgress:false,refreshError:null}});
    assert(url.pathname.endsWith('/insights/procedure-context'));
    return pending;
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {ProcedureContext}=await loadModule('/src/ProcedureContext.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(ProcedureContext,{reference:'2025/0407(COD)',language:'en'})));
  const amendmentLinks=()=>[...container.querySelectorAll('a')].filter(link=>link.textContent.includes('Amendments for this dossier'));
  assert.equal(amendmentLinks().length,0);
  assert.match(container.textContent,/Loading summary/);
  await act(async()=>respond(Response.json({error:{message:'Summary service unavailable.'}},{status:503})));
  assert.equal(amendmentLinks().length,0,'a failed summary must not expose the unfinished catalogue');
  assert.match(container.textContent,/Read on Legislative Observatory/);
  assert.doesNotMatch(container.textContent,/Loading summary/);
});
