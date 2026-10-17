import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const deferred=()=>{
  let resolve;const promise=new Promise(complete=>{resolve=complete;});
  return {promise,resolve};
};
const button=(scope,label)=>[...scope.querySelectorAll('button')].find(node=>node.textContent===label);
const failurePage=(offset=0,capacityReached=false)=>({items:Array.from({length:10},(_,index)=>({requestId:'request-'+(offset+index),partId:'part-'+(offset+index),description:'Failure description '+(offset+index),language:'en',code:'unsupported_syntax'})),total:20,offset,limit:10,capacityReached});

async function mount(t,fetch,{capacityReached=false}={}) {
  const window=new Window({url:'http://localhost/?view=amendments'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(vite)await vite.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);
    if(url.pathname.endsWith('/amendments/failures'))return fetch(url);
    assert(url.pathname.endsWith('/amendments'));
    return Response.json({items:[],total:0,offset:0,limit:20,coverage:{complete:false,pending:false,gaps:[]},failures:{total:20,unresolved:20,capacityReached}});
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocAmendments}=await vite.ssrLoadModule('/src/PocAmendments.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement('div',null,createElement('button',{'data-sentinel':true},'External control'),createElement(PocAmendments,{document:'A-10-2026-0254',language:'en'}))));
  return {window,container,details:container.querySelector('.poc-amendment-failures')};
}

test('failure pager actions preserve keyboard focus across delayed loading, error and retry without stealing focus on first open',async t=>{
  const initial=deferred(),firstNext=deferred(),retryNext=deferred();let nextReads=0;
  const {window,container,details}=await mount(t,url=>url.searchParams.get('offset')==='10'?(++nextReads===1?firstNext.promise:retryNext.promise):initial.promise);
  t.after(async()=>{await act(async()=>{initial.resolve(Response.json(failurePage()));firstNext.resolve(Response.json(failurePage(10)));retryNext.resolve(Response.json(failurePage(10)));});});
  const summary=details.querySelector(':scope>summary'),sentinel=container.querySelector('[data-sentinel]');
  const assertPersistentFocus=message=>{
    assert.equal(details.querySelector(':scope>summary'),summary,'the summary keeps its DOM identity');
    assert.equal(document.activeElement===summary||document.activeElement===details,true,message);
  };
  sentinel.focus();assert.equal(document.activeElement,sentinel);
  await act(async()=>{details.open=true;details.dispatchEvent(new window.Event('toggle'));});
  assert.match(details.querySelector('[role="status"]').textContent,/loading/i);
  assert.equal(document.activeElement,sentinel,'opening the panel programmatically does not steal unrelated focus while loading');
  await act(async()=>initial.resolve(Response.json(failurePage())));
  assert.equal(document.activeElement,sentinel,'first-page data arrival does not steal unrelated focus');
  assert.equal(details.querySelector(':scope>summary'),summary);
  const next=button(details.querySelector('nav[aria-label="Parser failure pages"]'),'Next');
  next.focus();assert.equal(document.activeElement,next);
  await act(async()=>next.click());
  assert.equal(next.isConnected,false,'the old page control is removed while the new page is loading');
  assert.match(details.querySelector('[role="status"]').textContent,/loading/i);
  assertPersistentFocus('Next moves focus to the persistent failure summary or panel before removing its pager');
  await act(async()=>firstNext.resolve(Response.json({error:{message:'Delayed fixture failure'}},{status:503})));
  assert.match(details.querySelector('[role="alert"]').textContent,/could not load/i);
  assertPersistentFocus('a page failure preserves focus on the persistent panel');
  const retry=button(details,'Try again');assert(retry);
  retry.focus();assert.equal(document.activeElement,retry);
  await act(async()=>retry.click());
  assert.equal(retry.isConnected,false,'the error retry control is removed during its new request');
  assert.match(details.querySelector('[role="status"]').textContent,/loading/i);
  assertPersistentFocus('retry moves focus to the persistent failure summary or panel before removing its button');
  await act(async()=>retryNext.resolve(Response.json(failurePage(10))));
  assert.equal(nextReads,2);
  assert.match(details.querySelector('.poc-amendment-failure-list').textContent,/Failure description 10/);
  assert.match(details.querySelector('nav[aria-label="Parser failure pages"]').textContent,/11–20 of 20/);
  assertPersistentFocus('the replacement page does not move focus after its delayed response');
});

test('a capacity limit reported by the amendment page is visible before the failure panel is opened',async t=>{
  let failureReads=0;
  const {details}=await mount(t,async()=>{failureReads++;return Response.json(failurePage());},{capacityReached:true});
  assert.equal(details.open,false);
  assert.equal(failureReads,0,'the closed panel does not load failure pages');
  assert.match(details.querySelector(':scope>summary').textContent,/capacity|limit/i,'a closed panel still exposes the capacity warning');
  assert.match(details.querySelector(':scope>summary').textContent,/reached|full|capped|incomplete/i);
});

test('a capacity limit discovered in the failure-page response is displayed in the open panel',async t=>{
  const response=deferred();
  const {window,details}=await mount(t,()=>response.promise);
  const summary=details.querySelector(':scope>summary');
  assert.doesNotMatch(summary.textContent,/capacity|limit/i);
  await act(async()=>{details.open=true;details.dispatchEvent(new window.Event('toggle'));});
  await act(async()=>response.resolve(Response.json(failurePage(0,true))));
  assert.equal(details.querySelector(':scope>summary'),summary);
  assert.match(details.textContent,/capacity|limit/i);
  assert.match(details.textContent,/reached|full|capped|incomplete/i);
  assert.equal(details.querySelectorAll('.poc-amendment-failure-list>li').length,10,'the capacity notice does not hide the recorded failures');
});
