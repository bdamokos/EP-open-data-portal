import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

async function mount(t,{url='http://localhost/?view=amendments',fetch,component='Amendments',props={}}) {
  const window=new Window({url});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(loadModule)await loadModule.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  t.mock.method(globalThis,'fetch',input=>fetch(new URL(input,window.location.href)));
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const module=await loadModule('/src/Amendments.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(module[component],{language:'en',...props})));
  return {window,container};
}
const button=(scope,label)=>[...scope.querySelectorAll('button')].find(element=>element.textContent===label);
const page=(items,total=items.length)=>({items,total,offset:0,limit:20,coverage:{complete:false,pending:false,gaps:[]}});
const amendment={id:'A-10-2026-0254-AM-1',number:1,targetDocumentId:'A-10-2026-0254',outcome:'ADOPTED'};

test('an out-of-range amendment URL offers first-page recovery while preserving every filter',async t=>{
  const filters={'am-document':'A-10-2026-0254','am-procedure':'2025/0407(COD)','am-member':'42','am-outcome':'ADOPTED'};
  const calls=[];
  const {window,container}=await mount(t,{
    url:'http://localhost/?'+new URLSearchParams({view:'amendments',...filters,'am-offset':'1000'}),
    component:'AmendmentsPage',props:{onBack(){}},
    fetch:async url=>{
      if(url.pathname.endsWith('/directory'))return Response.json({members:[{id:42,firstName:'Fixture',lastName:'Author'}],index:{complete:true}});
      assert(url.pathname.endsWith('/amendments'));calls.push(url);
      return Response.json(page(url.searchParams.get('offset')==='1000'?[]:[amendment],50));
    },
  });
  const pagination=container.querySelector('nav[aria-label="Amendment pages"]');
  assert.match(pagination.textContent,/0 shown of 50/);
  assert.doesNotMatch(pagination.textContent,/1001\s*[–-]\s*50/);
  assert.doesNotMatch(container.querySelector('.explorer-amendment-empty').textContent,/no indexed amendments match/i,'an empty page cannot deny matching records on earlier pages');
  const recover=button(pagination,'Go to first page');assert(recover,'the stale page has a direct recovery control');
  await act(async()=>recover.click());
  const current=new URL(window.location.href);
  for(const [key,value] of Object.entries(filters))assert.equal(current.searchParams.get(key),value,key+' survives page recovery');
  assert.equal(current.searchParams.get('am-offset'),null);
  assert.equal(current.searchParams.get('view'),'amendments');
  assert.equal(container.querySelectorAll('.explorer-amendment-card').length,1);
  assert.equal(button(container.querySelector('nav[aria-label="Amendment pages"]'),'Previous').disabled,true);
  const request=calls.at(-1);
  for(const [key,value] of Object.entries({document:filters['am-document'],procedure:'2025-0407',member:'42',outcome:'ADOPTED'}))assert.equal(request.searchParams.get(key),value);
  assert.equal(Number(request.searchParams.get('offset')||0),0);
});

test('a shrinking parser-failure registry keeps its remaining records distinct from an empty page',async t=>{
  const failures=Array.from({length:10},(_,index)=>({requestId:'request-'+index,partId:'component-'+index,description:'Recorded failure '+index,language:'en',code:'unsupported_syntax'}));
  const calls=[];
  const {window,container}=await mount(t,{
    props:{document:'A-10-2026-0254'},
    fetch:async url=>{
      if(url.pathname.endsWith('/amendments/failures')){
        calls.push(url);
        return Response.json(url.searchParams.get('offset')==='10'?{items:[],total:3,offset:10,limit:10}:{items:failures,total:12,offset:0,limit:10});
      }
      assert(url.pathname.endsWith('/amendments'));
      return Response.json({...page([amendment]),failures:{total:12,unresolved:12}});
    },
  });
  const details=container.querySelector('.explorer-amendment-failures');
  await act(async()=>{details.open=true;details.dispatchEvent(new window.Event('toggle'));});
  assert.equal(details.querySelectorAll('.explorer-amendment-failure-list>li').length,10);
  await act(async()=>button(details.querySelector('nav[aria-label="Parser failure pages"]'),'Next').click());
  const pagination=details.querySelector('nav[aria-label="Parser failure pages"]');
  assert.match(pagination.textContent,/0 shown of 3/);
  assert.doesNotMatch(pagination.textContent,/11\s*[–-]\s*3/);
  assert.doesNotMatch(details.textContent,/No parser failures recorded/i,'three remaining records cannot be presented as an empty registry');
  const recover=button(pagination,'Go to first page');assert(recover);
  await act(async()=>recover.click());
  assert.match(details.textContent,/Recorded failure 0/);
  assert.equal(button(details.querySelector('nav[aria-label="Parser failure pages"]'),'Previous').disabled,true);
  assert(calls.some(url=>url.searchParams.get('offset')==='10'));
});

test('Clear filters is available for an outcome-only URL and removes its outcome selection',async t=>{
  const calls=[];
  const {window,container}=await mount(t,{
    url:'http://localhost/?view=amendments&am-outcome=ADOPTED',component:'AmendmentsPage',props:{onBack(){}},
    fetch:async url=>{
      if(url.pathname.endsWith('/directory'))return Response.json({members:[],index:{complete:true}});
      assert(url.pathname.endsWith('/amendments'));calls.push(url);
      return Response.json(page([]));
    },
  });
  const clear=button(container.querySelector('.explorer-amendment-finder'),'Clear filters');assert(clear);
  assert.equal(container.querySelector('.explorer-amendment-controls select').value,'ADOPTED');
  await act(async()=>clear.click());
  assert.equal(new URL(window.location.href).searchParams.get('am-outcome'),null);
  assert.equal(container.querySelector('.explorer-amendment-controls select').value,'');
  assert.equal(calls.at(-1).searchParams.get('outcome'),null);
  assert.equal(button(container.querySelector('.explorer-amendment-finder'),'Clear filters'),undefined);
});

test('zero indexed results with partial coverage explicitly retain the incomplete-coverage qualification',async t=>{
  const {container}=await mount(t,{
    props:{document:'A-10-2026-0254',showFailures:false},
    fetch:async url=>{
      assert(url.pathname.endsWith('/amendments'));
      return Response.json(page([]));
    },
  });
  assert.equal(container.querySelectorAll('.explorer-amendment-card').length,0);
  assert.match(container.querySelector('.explorer-amendment-empty').textContent,/incomplete.{0,30}coverage|coverage.{0,30}incomplete|partial coverage/i);
  assert.match(container.querySelector('nav[aria-label="Amendment pages"]').textContent,/0 amendments/);
});
