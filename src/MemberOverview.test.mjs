import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const row=(indexedCount,status='available')=>({status,indexedCount,total:status==='available'?indexedCount:null,reason:null});
const activities={categoryCoverage:{'plenary-contributions':row(21),'reports-rapporteur':row(0),'reports-shadow':row(1),'opinions-rapporteur':row(0),'opinions-shadow':row(0),'written-questions':row(5),'oral-questions':row(0),motions:row(0,'incomplete-joins')}};
const votes={coverage:{status:'complete'},period:{week:'2026-10-19'},alignmentCounts:{with:244,against:10,abstained:1,unclassified:414},pagination:{recordedTotal:255}};
const unavailable=()=>Response.json({error:{code:'unavailable'}},{status:404});

async function mount(t,{reads}={}) {
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let load,root;const opened=[],calls=[];
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(String(input),'http://localhost/');calls.push((url.pathname+url.search).replace(/&v=[0-9a-f]+$/,''));
    if(url.pathname.startsWith('/api/latest-activities/'))return reads.activities();
    if(url.pathname.startsWith('/api/member-votes/'))return reads.votes();
    assert.fail('Unexpected read '+url);
  });
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {MemberOverview}=await load('/src/MemberOverview.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=window.document.createElement('div');window.document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(MemberOverview,{member:113523,language:'en',onSpeeches:()=>opened.push('speeches'),onActivities:category=>opened.push('activities:'+category),onVotes:week=>opened.push('votes:'+week)})));
  for(let attempt=0;attempt<50&&container.querySelector('[aria-busy]');attempt++)await act(async()=>new Promise(resolve=>setTimeout(resolve,10)));
  return {container,opened,calls,items:()=>[...container.querySelectorAll('li')].map(li=>li.textContent),async click(key){await act(async()=>container.querySelector(`[data-overview="${key}"] button`).click());}};
}

test('items open their tab, category and week',async t=>{
  const view=await mount(t,{reads:{activities:()=>Response.json(activities),votes:()=>Response.json(votes)}});
  assert.deepEqual(view.items(),['21 speeches','1 shadow report','5 questions','Last plenary week: 255 votes on record, 10 against the outcome']);
  assert.deepEqual(view.calls.sort(),['/api/latest-activities/113523?lang=en&limit=1','/api/member-votes/113523?week=latest&view=summary']);
  for(const key of ['speeches','reports-shadow','questions','votes'])await view.click(key);
  assert.deepEqual(view.opened,['speeches','activities:reports-shadow','activities:written-questions','votes:2026-10-19']);
});

test('a failed activity read drops only its items',async t=>{
  const view=await mount(t,{reads:{activities:unavailable,votes:()=>Response.json(votes)}});
  assert.deepEqual(view.items(),['Last plenary week: 255 votes on record, 10 against the outcome']);
});

test('a failed vote read drops only its item',async t=>{
  const view=await mount(t,{reads:{activities:()=>Response.json(activities),votes:unavailable}});
  assert.deepEqual(view.items(),['21 speeches','1 shadow report','5 questions']);
});

test('the row is omitted when every read failed',async t=>{
  const view=await mount(t,{reads:{activities:unavailable,votes:unavailable}});
  assert.equal(view.container.querySelector('.member-overview'),null);
});
