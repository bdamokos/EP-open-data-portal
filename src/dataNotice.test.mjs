import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

async function harness(t,{dismissed=false}={}) {
  const window=new Window({url:'http://localhost/'});
  if(dismissed)window.localStorage.setItem('ep.data-notice.dismissed.v1','1');
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,loadModule;
  t.after(async()=>{if(root)await act(async()=>root.unmount());await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const {DataNotice}=await loadModule('/src/components/DataNotice.tsx');
  await act(async()=>root.render(createElement(DataNotice)));
  return {window,container};
}

test('the site notice states independence and can be hidden to a compact toggle with the same terms',async t=>{
  const {window,container}=await harness(t);
  const summary=()=>container.querySelector('.data-notice summary');
  assert.equal(summary().textContent,'Independent site · Not an official Parliament service');
  const details=container.querySelector('.data-notice details');
  await act(async()=>summary().click());
  assert.equal(details.open,true,'the terms open before dismissal');
  const dismiss=container.querySelector('.data-notice__dismiss');
  assert.equal(dismiss.getAttribute('aria-label'),'Hide site notice');
  await act(async()=>dismiss.click());
  assert.equal(container.querySelector('.data-notice__dismiss'),null);
  assert.ok(container.querySelector('.data-notice').classList.contains('data-notice--dismissed'));
  assert.equal(summary().textContent,'About this site');
  assert.equal(details.open,false,'dismissal collapses the expanded terms');
  assert.equal(window.document.activeElement,summary(),'focus moves to the remaining toggle');
  assert.match(container.querySelector('.data-notice__body').textContent,/This site is independent\./);
  assert.equal(window.localStorage.getItem('ep.data-notice.dismissed.v1'),'1');
  await act(async()=>summary().click());
  assert.equal(details.open,true,'the compact toggle reopens the same terms');
});

test('a hidden site notice stays compact on later pages',async t=>{
  const {container}=await harness(t,{dismissed:true});
  assert.equal(container.querySelector('.data-notice summary').textContent,'About this site');
  assert.equal(container.querySelector('.data-notice__dismiss'),null);
  assert.match(container.querySelector('.data-notice__body').textContent,/© European Union – Source: European Parliament/);
});
