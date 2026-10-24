import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {viewReady} from './test-support/viewReady.mjs';

// Controlled public API observations: neither fixture claims complete coverage.
const directory={day:'2026-10-16',members:[],committees:[],index:{complete:false,loaded:0,total:1,failed:1,error:'Fixture memberships unavailable'}};
const groupVoices={people:[],months:[],window:{from:'2024-07-16',to:'2026-10-16'},contributions:[],total:0,nextOffset:null,coverage:{initialized:false,observedOralRecords:0,pending:0,truncated:false,note:'Recorded group designations unavailable · partial coverage'}};

async function harness(t,query) {
  const window=new Window({url:'http://localhost/'+query});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let root,load;
  // Unmount consumers before closing the runner; restore globals even on failure.
  t.after(async()=>{
    try {if(root)await act(async()=>root.unmount());}
    finally {
      try {if(load)await load.close();}
      finally {
        try {await window.happyDOM.close();}
        finally {for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];}
      }
    }
  });
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  window.HTMLElement.prototype.scrollIntoView=function(){};
  window.HTMLElement.prototype.scrollTo=function(){};
  const requests=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href);
    assert.equal(url.origin,'http://localhost','only controlled local API fixtures are allowed');
    requests.push(url.pathname);
    if(url.pathname==='/api/directory')return Response.json(directory);
    if(url.pathname==='/api/insights/group-voices')return Response.json(groupVoices);
    assert.fail('Unexpected public API fixture request: '+url.href);
  });
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {default:App}=await load('/src/App.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(App)));
  await viewReady(container);
  return {container,requests};
}

async function assertPublicNotice(container) {
  const main=container.querySelector('main');
  assert.ok(main,'the route renders its explorer shell');
  assert.equal(main.querySelector('.parliament-header .parliament-brand')?.textContent,'European Parliament data explorer');
  const notices=main.querySelectorAll('footer .data-notice');
  assert.equal(notices.length,1,'the active shell renders one public-data notice in its footer');
  const notice=notices[0],summary=notice.querySelector('summary');
  assert.equal(summary?.textContent,'Independent site · Not an official Parliament service');
  await act(async()=>summary.click());
  assert.equal(notice.querySelector('details').open,true,'legal terms can be opened from the rendered shell');
  const body=notice.querySelector('.data-notice__body');
  assert.match(body.textContent,/© European Union – Source: European Parliament/);
  assert.match(body.textContent,/This site is independent\./);
  const license=body.querySelector('a[href="https://creativecommons.org/licenses/by/4.0/"]');
  assert.ok(license,'the rendered license links to CC BY 4.0');
  assert.equal(license.textContent,'CC BY 4.0');
}

test('the App member shell renders the public-data notice and site brand with incomplete directory data',async t=>{
  const {container,requests}=await harness(t,'?lang=en');
  assert.equal(container.querySelector('.parliament-header [aria-current="page"]')?.textContent,'Members');
  assert.ok(requests.includes('/api/directory'));
  assert.match(container.textContent,/Fixture memberships unavailable/);
  await assertPublicNotice(container);
});

test('the group route through InsightShared renders the public-data notice and site brand with unavailable observations',async t=>{
  const {container,requests}=await harness(t,'?lang=en&view=groups');
  assert.equal(container.querySelector('.insight-intro h1')?.textContent,'Group voices');
  assert.equal(container.querySelector('.parliament-header [aria-current="page"]')?.textContent,'Group voices');
  assert.ok(requests.includes('/api/insights/group-voices'));
  assert.equal(container.querySelector('.availability-note p')?.textContent,'Records unavailable for this selection.');
  await assertPublicNotice(container);
});
