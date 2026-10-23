import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const xml='<speech><p>Retained readable body.</p></speech>';
async function harness(t) {
  const window=new Window({url:'http://localhost/'}),originals=new Map(),requests=[];
  for(const [key,value] of Object.entries({window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  }
  let loadModule,root;
  t.mock.method(globalThis,'fetch',(input,options)=>new Promise(resolve=>requests.push({url:new URL(input,window.location.href),signal:options.signal,resolve,finished:false})));
  t.after(async()=>{if(root)await act(async()=>root.unmount());for(const r of requests)if(!r.finished)r.resolve(Response.json({}));if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true}});
  const {useSpeechData}=await loadModule('/src/data.ts'),{createRoot}=await import('react-dom/client');
  function Reader({id='X',language='en'}){const state=useSpeechData(id,language);return createElement('section',null,createElement('output',null,JSON.stringify(state)),createElement('button',{onClick:state.retry},'Retry'));}
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=props=>act(async()=>root.render(createElement(Reader,props)));
  await render({});
  return {requests,render,state:()=>JSON.parse(container.querySelector('output').textContent),retry:()=>act(async()=>container.querySelector('button').click()),
    finish:(kind,data,status=200)=>act(async()=>{const request=requests.find(r=>!r.finished&&r.url.pathname==='/api/'+kind+'/X');assert(request,'Missing '+kind+' request');request.finished=true;request.resolve(Response.json(data,{status}));})};
}
const unavailable={id:'X',available:false};
const retained={id:'X',available:true,xml,textLanguage:'en',metadata:{id:'X',xml:null}};
const detail={id:'X',xml,textLanguage:'en'};
const failure={error:{message:'Refresh unavailable',retryAt:20000}};

test('retained corpus refresh reports its own error and retry hint while preserving body and root semantics',async t=>{
  const h=await harness(t);await h.finish('speech-transcript',retained);
  assert.equal(h.requests.length,1);assert.equal(h.state().transcript.xml,xml);
  await h.retry();assert.equal(h.state().transcript.xml,xml);assert.equal(h.state().loading,false);assert.equal(h.state().refreshing,true);
  await h.finish('speech-transcript',failure,503);
  assert.equal(h.state().transcript.xml,xml);assert.equal(h.state().error,null);assert.equal(h.state().loading,false);assert.equal(h.state().refreshing,false);
  assert.equal(h.state().refreshError,'Refresh unavailable');assert.equal(h.state().refreshRetryAt,20000);
  await h.retry();assert.equal(h.state().refreshError,null);assert.equal(h.state().refreshing,true);
  await h.finish('speech-transcript',retained);assert.equal(h.state().refreshError,null);assert.equal(h.state().refreshRetryAt,undefined);assert.equal(h.state().refreshing,false);
});

test('detail body survives corpus recheck and failed refresh without treating a successful fallback as failed',async t=>{
  const h=await harness(t);await h.finish('speech-transcript',failure,503);await h.finish('speech',detail);
  assert.equal(h.state().refreshError,null,'successful fallback does not inherit the corpus failure');
  await h.retry();assert.equal(h.state().transcript.xml,xml,'body stays readable while the corpus lookup is pending');assert.equal(h.state().refreshing,true);assert.equal(h.state().loading,false);
  await h.finish('speech-transcript',unavailable);assert.equal(h.state().transcript.xml,xml);assert.equal(h.state().refreshing,true);
  await h.finish('speech',failure,503);
  assert.equal(h.state().transcript.xml,xml);assert.equal(h.state().error,null);assert.equal(h.state().loading,false);assert.equal(h.state().refreshing,false);
  assert.equal(h.state().refreshError,'Refresh unavailable');assert.equal(h.state().refreshRetryAt,20000);
  await h.retry();assert.equal(h.state().transcript.xml,xml);await h.finish('speech-transcript',failure,503);await h.finish('speech',{...detail,xml:'<speech><p>Refreshed detail.</p></speech>'});
  assert.match(h.state().transcript.xml,/Refreshed detail/);assert.equal(h.state().refreshError,null);assert.equal(h.state().refreshRetryAt,undefined);
  await h.render({id:'X',language:'fr'});assert.equal(h.state().transcript,null,'a new language cannot reuse old body provenance');
  await h.render({id:'Y',language:'en'});assert.equal(h.state().transcript,null,'a new ID cannot reuse the old body');
});

test('an access failure clears the retained detail snapshot instead of restoring denied text',async t=>{
  const h=await harness(t);await h.finish('speech-transcript',unavailable);await h.finish('speech',detail);
  await h.retry();await h.finish('speech-transcript',unavailable);await h.finish('speech',{error:{message:'Unavailable'}},403);
  assert.equal(h.state().transcript,null);assert.equal(h.state().data,null);assert.equal(h.state().error,'Unavailable');assert.equal(h.state().refreshError,null);
});
