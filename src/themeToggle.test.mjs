import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

async function setup(t,failure) {
  const window=new Window({url:'http://localhost/'}),key='ep.colour-scheme.v1';
  const storage=window.localStorage;
  if(failure==='remove')storage.setItem(key,'dark');
  const denied=()=>{throw new Error('Storage unavailable');};
  if(failure==='access')Object.defineProperty(window,'localStorage',{get:denied,configurable:true});
  if(failure==='read')t.mock.method(storage,'getItem',denied);
  if(failure==='write')t.mock.method(storage,'setItem',denied);
  if(failure==='remove')t.mock.method(storage,'removeItem',denied);
  const globals={window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(vite)await vite.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {ThemeToggle}=await vite.ssrLoadModule('/src/ThemeToggle.tsx');
  const {applyColourScheme,readColourScheme}=await vite.ssrLoadModule('/src/colourScheme.mjs');
  applyColourScheme(readColourScheme());
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  let instance=0;
  const remount=()=>act(async()=>root.render(createElement(ThemeToggle,{key:instance++})));
  const click=()=>act(async()=>container.querySelector('button').click());
  const state=()=>({theme:document.documentElement.dataset.theme||'system',label:container.querySelector('button').getAttribute('aria-label')});
  await remount();
  return {remount,click,state,storage,key};
}

for(const failure of ['access','read','write'])test(`scheme toggle retains its active choice after remount when storage ${failure} fails`,async t=>{
  const view=await setup(t,failure);
  await view.click();await view.click();
  assert.deepEqual(view.state(),{theme:'dark',label:'Colour scheme: Dark. Switch to system'});
  await view.remount();
  assert.deepEqual(view.state(),{theme:'dark',label:'Colour scheme: Dark. Switch to system'});
  await view.click();
  assert.deepEqual(view.state(),{theme:'system',label:'Colour scheme: System. Switch to light'});
});

test('a failed storage removal cannot restore a stale override when the toggle remounts',async t=>{
  const view=await setup(t,'remove');
  assert.equal(view.state().theme,'dark');
  await view.click();
  assert.equal(view.storage.getItem(view.key),'dark','the old persisted choice remains after removal fails');
  await view.remount();
  assert.deepEqual(view.state(),{theme:'system',label:'Colour scheme: System. Switch to light'});
  await view.click();
  assert.deepEqual(view.state(),{theme:'light',label:'Colour scheme: Light. Switch to dark'});
});
