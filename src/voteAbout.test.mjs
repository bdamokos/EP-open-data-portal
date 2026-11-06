import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

let load;after(async()=>{if(load)await load.close();});
async function mount(t,summary,reference='2026/2933(RSP)') {
  const window=new Window({url:'http://localhost/?view=legislation'}),old=new Map(),requests=[];
  for(const [k,v] of Object.entries({window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,Event:window.Event,PopStateEvent:window.PopStateEvent,innerWidth:1280,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:fn=>{fn();return 0;}})){old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}
  t.mock.method(globalThis,'fetch',async input=>{requests.push(new URL(input,location.href));return Response.json({view:'procedure-context',reference,language:'en',summary});});
  load??=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {VoteAbout}=await load('/src/VoteAbout.tsx'),{createRoot}=await import('react-dom/client');
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  t.after(async()=>{await act(async()=>root.unmount());await window.happyDOM.close();for(const [k,d] of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
  await act(async()=>root.render(createElement(VoteAbout,{reference,language:'en',open:false,onToggle(){}})));
  for(let i=0;i<20&&!requests.length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  return {node,requests};
}
test('the item\'s own summary shows under "About this text" from the procedure-context read, with no loading text',async t=>{
  const {node,requests}=await mount(t,{id:'s1',stage:'parliament-decision',blocks:[{kind:'paragraph',text:'The European Parliament adopted a resolution.'},{kind:'paragraph',text:'It was tabled by five groups.'}]});
  assert.equal(requests[0].pathname.endsWith('/insights/procedure-context'),true);
  assert.equal(requests[0].searchParams.get('reference'),'2026/2933(RSP)');
  assert.match(node.textContent,/About this text/);assert.match(node.textContent,/adopted a resolution/);assert.doesNotMatch(node.textContent,/Loading/);
});
test('an item without a summary shows nothing at all',async t=>{
  const {node}=await mount(t,null,'2026/2935(RSP)');
  assert.equal(node.textContent,'');
});
