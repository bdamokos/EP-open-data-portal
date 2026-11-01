import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act,StrictMode} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

async function harness(t) {
  const window=new Window({url:'http://localhost/'}),originals=new Map(),requests=[];
  for(const [key,value] of Object.entries({window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})) {
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  }
  let root,loadModule;
  t.mock.method(globalThis,'fetch',(input,options)=>new Promise(resolve=>requests.push({url:new URL(input,location.href),signal:options.signal,resolve})));
  // Settle reads left pending so their request deadlines do not keep the file alive.
  t.after(async()=>{if(root)await act(async()=>root.unmount());await act(async()=>{for(const request of requests)request.resolve(Response.json({}));});if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);root=createRoot(container);
  return {requests,container,load:path=>loadModule(path),render:element=>act(async()=>root.render(element)),finish:(request,data,status=200)=>act(async()=>request.resolve(Response.json(data,{status}))),unmount:()=>act(async()=>root.unmount())};
}

for(const [module,name,route] of [['data.ts','useData','profile/43'],['InsightData.ts','useInsightData','insights/participation?country=BE']]) {
  test(name+' releases obsolete navigation and unmount reads, preserving shared StrictMode readers and refresh data',async t=>{
    const h=await harness(t),hook=(await h.load('/src/'+module))[name];
    function Reader({route,id}) {const state=hook(route);return createElement('section',{'data-reader':id},createElement('output',null,JSON.stringify(state)),createElement('button',{onClick:state.retry},'Retry'));}
    const render=(route,joined=true)=>h.render(createElement(StrictMode,null,...(joined?['a','b']:['b']).map(id=>createElement(Reader,{key:id,id,route}))));
    const state=()=>JSON.parse(h.container.querySelector('output').textContent);
    await render(route);assert.equal(h.requests.length,1,'StrictMode and joined consumers share one request');
    await render(route,false);assert.equal(h.requests[0].signal.aborted,false,'surviving consumer retains the request');
    const next=route+(route.includes('?')?'&':'?')+'selection=new';await render(next,false);
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

test('speech retry checks the corpus before starting exactly one forced detail refresh',async t=>{
  const h=await harness(t),{useSpeechData}=await h.load('/src/data.ts');
  function Reader(){const state=useSpeechData('X','en');return createElement('section',null,createElement('output',null,JSON.stringify(state)),createElement('button',{onClick:state.retry},'Retry'));}
  const state=()=>JSON.parse(h.container.querySelector('output').textContent);
  const retry=()=>act(async()=>h.container.querySelector('button').click());
  await h.render(createElement(Reader));assert.equal(h.requests.length,1);
  await h.finish(h.requests[0],{id:'X',available:false});assert.equal(h.requests.length,2);
  await h.finish(h.requests[1],{error:{message:'Detail unavailable'}},503);
  await retry();assert.equal(h.requests.length,3,'retry only starts the retained corpus lookup');
  assert.equal(h.requests[2].url.pathname,'/api/speech-transcript/X');
  await h.finish(h.requests[2],{id:'X',available:false});assert.equal(h.requests.length,4);
  assert.equal(h.requests[3].url.pathname,'/api/speech/X');assert.equal(h.requests[3].signal.aborted,false);
  await h.finish(h.requests[3],{id:'X',xml:null,textLanguage:'en'});assert.equal(state().loading,false);
  await retry();assert.equal(h.requests.length,5,'a successful cached fallback also waits for the corpus recheck');
  await h.finish(h.requests[4],{id:'X',available:false});assert.equal(h.requests.length,6,'retry intent survives a disabled fallback route and forces its cached data to refresh');
  await h.finish(h.requests[5],{id:'X',xml:'<speech><p>Fresh detail.</p></speech>',textLanguage:'en'});
  assert.match(state().transcript.xml,/Fresh detail/);assert.equal(state().error,null);
  await retry();assert.equal(h.requests.length,7);
  await h.finish(h.requests[6],{id:'X',available:true,xml:'<speech><p>Now retained.</p></speech>',metadata:{id:'X'}});
  assert.equal(h.requests.length,7,'complete retained metadata suppresses the fallback');assert.match(state().transcript.xml,/Now retained/);
});


test('a resolved insight route keeps its completed response while retries and different routes still fetch',async t=>{
  const h=await harness(t),{useInsightData}=await h.load('/src/InsightData.ts');
  const latest='insights/legislation?lang=en&week=latest',pinned='insights/legislation?lang=en&week=2026-10-05';
  const equivalent=(loaded,requested,data)=>loaded===latest&&requested===data.resolvedRoute;
  function Reader({route}){const state=useInsightData(route,equivalent);return createElement('section',null,createElement('output',null,JSON.stringify(state)),createElement('button',{onClick:state.retry},'Retry'));}
  const render=route=>h.render(createElement(Reader,{route}));
  const state=()=>JSON.parse(h.container.querySelector('output').textContent);
  await render(latest);
  await render(pinned);assert.equal(h.requests.length,2,'pending data cannot establish route equivalence');assert(h.requests[0].signal.aborted);
  await render(latest);await h.finish(h.requests[2],{resolvedRoute:pinned,week:'2026-10-05'});
  await render(pinned);assert.equal(h.requests.length,3,'pinning the completed response makes no new request');
  assert.equal(state().route,pinned);assert.equal(state().data.week,'2026-10-05');assert.equal(state().loading,false);
  await act(async()=>h.container.querySelector('button').click());
  assert.equal(h.requests.length,4);assert.equal(h.requests[3].url.searchParams.get('week'),'2026-10-05','retry fetches the pinned route');
  await h.finish(h.requests[3],{error:{message:'Unavailable'}},503);assert.equal(state().error,'Unavailable');
  await act(async()=>h.container.querySelector('button').click());await h.finish(h.requests[4],{week:'2026-10-05'});
  await render('insights/legislation?lang=fr&week=2026-10-05');assert.equal(h.requests.length,6);assert.equal(state().data,null,'different language remains fenced');
  await h.finish(h.requests[5],{week:'2026-10-05'});
  await render('insights/legislation?lang=fr&week=latest');assert.equal(h.requests.length,7);assert.equal(state().data,null,'a dated response does not resolve a new latest request');
});
