import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

test('dossier amendment link remains available while its independent summary loads or fails',async t=>{
  const window=new Window({url:'http://localhost/?view=legislation'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root,respond;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(vite)await vite.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const pending=new Promise(resolve=>{respond=resolve;});
  t.mock.method(globalThis,'fetch',async input=>{
    assert(new URL(input,window.location.href).pathname.endsWith('/insights/procedure-context'));
    return pending;
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocProcedureContext}=await vite.ssrLoadModule('/src/PocProcedureContext.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocProcedureContext,{reference:'2025/0407(COD)',language:'en'})));
  const amendmentLinks=()=>[...container.querySelectorAll('a')].filter(link=>link.textContent.includes('Amendments for this dossier'));
  assert.equal(amendmentLinks().length,1);
  assert.match(container.textContent,/Loading summary/);
  const params=new URL(amendmentLinks()[0].href).searchParams;
  assert.equal(params.get('view'),'amendments');
  assert.equal(params.get('am-procedure'),'2025/0407(COD)');
  await act(async()=>respond(Response.json({error:{message:'Summary service unavailable.'}},{status:503})));
  assert.equal(amendmentLinks().length,1,'a failed summary never hides or duplicates the independent amendment trail');
  assert.match(container.textContent,/Read on Legislative Observatory/);
  assert.doesNotMatch(container.textContent,/Loading summary/);
});
