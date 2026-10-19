import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act,StrictMode} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

async function harness(t) {
  const window=new Window({url:'http://localhost/'}),originals=new Map(),requests=[];
  for(const [key,value] of Object.entries({window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})) {
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  }
  let root,vite;
  t.mock.method(globalThis,'fetch',(input,options)=>new Promise(resolve=>requests.push({url:new URL(input,location.href),signal:options.signal,resolve})));
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);root=createRoot(container);
  return {requests,container,load:path=>vite.ssrLoadModule(path),render:element=>act(async()=>root.render(element)),finish:(request,data,status=200)=>act(async()=>request.resolve(Response.json(data,{status}))),unmount:()=>act(async()=>root.unmount())};
}

for(const [module,name,route] of [['data.ts','useData','profile/43'],['InsightData.ts','useInsightData','insights/participation?country=BE']]) {
  test(name+' releases obsolete navigation and unmount reads, preserving shared StrictMode readers and refresh data',async t=>{
    const h=await harness(t),hook=(await h.load('/src/'+module))[name];
    function Reader({route,id}) {const state=hook(route);return createElement('section',{'data-reader':id},createElement('output',null,JSON.stringify(state)),createElement('button',{onClick:state.retry},'Retry'));}
    const render=(route,joined=true)=>h.render(createElement(StrictMode,null,...(joined?['a','b']:['b']).map(id=>createElement(Reader,{key:id,id,route}))));
    const state=()=>JSON.parse(h.container.querySelector('output').textContent);
    await render(route);assert.equal(h.requests.length,1,'StrictMode and joined consumers share one request');
    await render(route,false);assert.equal(h.requests[0].signal.aborted,false,'surviving consumer retains the request');
    const next=route+'&selection=new';await render(next,false);
    assert(h.requests[0].signal.aborted,'navigation releases the old transport');assert.equal(h.requests.length,2);
    await h.finish(h.requests[0],{id:'obsolete'});assert.equal(state().data,null);assert(state().loading);
    await h.finish(h.requests[1],{id:'new',coverage:{complete:false}});assert.equal(state().data.id,'new');assert.equal(state().data.coverage.complete,false);
    await act(async()=>h.container.querySelector('button').click());assert.equal(h.requests.length,3);assert.equal(state().data.id,'new');
    await h.finish(h.requests[2],{error:{message:'Unavailable'}},503);assert.equal(state().data.id,'new');assert.equal(state().error,'Unavailable');assert.equal(state().loading,false);
    await render(next+'&pending=1',false);assert.equal(h.requests.length,4);await h.unmount();assert(h.requests[3].signal.aborted,'unmount releases pending transport');
  });
}

for(const [file,name,first,next] of [['SpeechCloud.tsx','SpeechCloud',{member:43},{member:44}],['TopicTrends.tsx','TopicTrends',{language:'en'},{language:'fr'}]]) {
  test(name+' releases its custom paginated read when filters change or the view unmounts',async t=>{
    const h=await harness(t),Component=(await h.load('/src/'+file))[name];
    await h.render(createElement(Component,first));assert.equal(h.requests.length,1);
    await h.render(createElement(Component,next));assert.equal(h.requests.length,2);assert(h.requests[0].signal.aborted);
    await h.finish(h.requests[0],{nextPage:1});assert.equal(h.requests.length,2,'abandoned page cannot continue pagination');
    await h.unmount();assert(h.requests[1].signal.aborted);
  });
}
