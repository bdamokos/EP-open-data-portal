import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

let load;after(async()=>{if(load)await load.close();});
async function withWindow(t,url) {
  const window=new Window({url:'http://localhost/'+url}),old=new Map();
  for(const [k,v] of Object.entries({window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent})){old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}
  t.after(async()=>{await window.happyDOM.close();for(const [k,d] of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
  load??=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  return window;
}
const search=()=>new URL(location.href).search;

// happy-dom's replaceState drops forward entries, so the history calls themselves are asserted.
test('changing vote with the voter list open pushes once; clearing the old filters rewrites in place, also on Back re-entry',async t=>{
  const window=await withWindow(t,'?agenda-vote=A&agenda-voters=1&agenda-voters-group=PPE');
  const {updateExplorerQuery,clearVoterParams}=await load('/src/explorerUrl.ts');
  const push=t.mock.method(window.history,'pushState'),replace=t.mock.method(window.history,'replaceState');
  // The vote change is one push; the cleanup that follows once the new vote is shown rewrites it.
  await act(async()=>updateExplorerQuery(url=>url.searchParams.set('agenda-vote','B')));
  await act(async()=>clearVoterParams());
  assert.equal(push.mock.callCount(),1,'one entry for the vote change');
  assert.equal(replace.mock.callCount(),1,'the cleanup rewrites it');
  assert.equal(search(),'?agenda-vote=B');
  // Back lands on vote A with its filters; the cleanup for the re-entered vote must not push (it would cut Forward).
  history.back();await window.happyDOM.waitUntilComplete();
  assert.equal(search(),'?agenda-vote=A&agenda-voters=1&agenda-voters-group=PPE');
  await act(async()=>clearVoterParams());
  assert.equal(search(),'?agenda-vote=A');
  assert.equal(push.mock.callCount(),1,'re-entry did not push');
  assert.equal(replace.mock.callCount(),2);
});
