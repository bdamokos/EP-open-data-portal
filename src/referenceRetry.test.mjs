import {automaticRecovery,installRetryClock} from './test-support/automaticRecovery.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const text='Regulation (EU) 2021/2116 protects this readable document text.';
const reference={key:'celex:32021R2116',kind:'act',status:'found',celex:'32021R2116',title:'Saved official title'};
async function reader(t,fetch) {
  const window=new Window({url:'http://localhost/'}),globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',fetch);
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {ReferenceScope,ReferenceText}=await loadModule('/src/References.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);installRetryClock(t);root=createRoot(container);
  const render=()=>root.render(createElement(ReferenceScope,{texts:[text],language:'en'},createElement('p',null,createElement(ReferenceText,{text}))));
  await act(async()=>render());
  return {container,revisit:()=>act(async()=>{root.render(null);}),render:()=>act(async()=>render()),retry:()=>[...container.querySelectorAll('button')].find(button=>button.textContent.includes('Retry'))};
}
test('failed reference details have an explicit retry while text remains readable',async t=>{
  let calls=0,finish;
  t.after(()=>finish?.());
  const {container,retry}=await reader(t,async()=>{
    if(++calls===1)return Response.json({error:{message:'This data request took too long.'}},{status:503});
    return new Promise(resolve=>finish=()=>resolve(Response.json({references:[reference]})));
  });
  assert(container.textContent.includes(text));assert.equal(container.querySelectorAll('button.legal-ref').length,0);assert.equal(retry(),undefined);
  await automaticRecovery(t);assert.equal(calls,2);assert.equal(retry(),undefined);assert(container.textContent.includes(text));
  await act(async()=>finish());assert.equal(retry(),undefined);assert.equal(container.querySelector('button.legal-ref').textContent,'Regulation (EU) 2021/2116');
});
test('stale references remain idle and a later failed read preserves their controls through recovery',async t=>{
  let calls=0;
  const {container,retry,revisit,render}=await reader(t,async()=>{
    calls++;if(calls===2)return Response.json({error:{message:'Temporarily unavailable.'}},{status:503});
    return Response.json({references:[{...reference,stale:calls===1}]});
  });
  assert.equal(retry(),undefined);assert(container.querySelector('button.legal-ref'));
  assert.equal(installRetryClock(t).timers.size,0);await installRetryClock(t).advance(31000);assert.equal(calls,1);await revisit();await render();assert.equal(calls,2);assert.equal(retry(),undefined);assert(container.querySelector('button.legal-ref'));assert(container.textContent.includes(text));
  await automaticRecovery(t);assert.equal(calls,3);assert.equal(retry(),undefined);assert(container.querySelector('button.legal-ref'));
});
