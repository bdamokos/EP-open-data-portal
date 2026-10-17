import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const text='Regulation (EU) 2021/2116 protects this readable document text.';
const reference={key:'celex:32021R2116',kind:'act',status:'found',celex:'32021R2116',title:'Saved official title'};
async function reader(t,fetch) {
  const window=new Window({url:'http://localhost/'}),globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',fetch);
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {ReferenceScope,ReferenceText}=await vite.ssrLoadModule('/src/References.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(ReferenceScope,{texts:[text],language:'en'},createElement('p',null,createElement(ReferenceText,{text})))));
  return {container,retry:()=>[...container.querySelectorAll('button')].find(button=>button.textContent.includes('Retry'))};
}
test('failed reference details have an explicit retry while text remains readable',async t=>{
  let calls=0,finish;
  t.after(()=>finish?.());
  const {container,retry}=await reader(t,async()=>{
    if(++calls===1)return Response.json({error:{message:'This data request took too long.'}},{status:503});
    return new Promise(resolve=>finish=()=>resolve(Response.json({references:[reference]})));
  });
  assert(container.textContent.includes(text));assert.equal(container.querySelectorAll('button.legal-ref').length,0);assert(retry());
  await act(async()=>retry().click());assert.equal(calls,2);assert.equal(retry().disabled,true);assert(container.textContent.includes(text));
  await act(async()=>finish());assert.equal(retry(),undefined);assert.equal(container.querySelector('button.legal-ref').textContent,'Regulation (EU) 2021/2116');
});
test('a failed retry preserves saved reference controls and a later retry replaces them',async t=>{
  let calls=0;
  const {container,retry}=await reader(t,async()=>{
    calls++;if(calls===2)return Response.json({error:{message:'Temporarily unavailable.'}},{status:503});
    return Response.json({references:[{...reference,stale:calls===1}]});
  });
  assert(retry());assert(container.querySelector('button.legal-ref'));
  await act(async()=>retry().click());assert.equal(calls,2);assert(retry());assert(container.querySelector('button.legal-ref'));assert(container.textContent.includes(text));
  await act(async()=>retry().click());assert.equal(calls,3);assert.equal(retry(),undefined);assert(container.querySelector('button.legal-ref'));
});
