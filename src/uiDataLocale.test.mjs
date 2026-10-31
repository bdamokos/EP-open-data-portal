import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement as h} from 'react';
import {Window} from 'happy-dom';
import {createAppUiI18n} from './uiCatalogues.mjs';
import {freshLoader} from './test-support/viteRunner.mjs';

test('shared reads retain owned error identity and re-render by locale without translating API text or refetching',async t=>{
  const window=new Window({url:'http://localhost/'});
  let calls=0,external=false,root,load;
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,
    fetch:async()=>{calls++;return {ok:false,status:400,headers:new Headers(),json:async()=>({error:{code:'fixture',...(external?{message:'The request took too long. Try again.'}:{})}})};}};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {UiI18nProvider}=await load('/src/UiI18nReact.tsx');
  const {useData}=await load('/src/data.ts');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const i18n=createAppUiI18n({fr:{'batch6.client.the.data.service.is.unavailable.status.64':'Indisponible ({status}).','batch6.client.the.request.took.too.long.try.again.43':'Délai dépassé.'}});
  function ErrorLine({route}){const data=useData(route);return h('p',null,data.error);}
  const child=(language,route)=>h(UiI18nProvider,{i18n,language},h(ErrorLine,{route}));
  const render=(languages,route)=>act(async()=>root.render(h('div',null,...languages.map(language=>child(language,route)))));
  await render(['en','fr'],'ui-owned-error-fixture');
  assert.deepEqual([...container.querySelectorAll('p')].map(node=>node.textContent),['The data service is unavailable (400).','Indisponible (400).']);
  assert.equal(calls,1);
  await render(['fr','en'],'ui-owned-error-fixture');
  assert.deepEqual([...container.querySelectorAll('p')].map(node=>node.textContent),['Indisponible (400).','The data service is unavailable (400).']);
  assert.equal(calls,1,'changing UI language does not restart a shared source read');
  external=true;await render(['fr','en'],'ui-external-error-fixture');
  assert.deepEqual([...container.querySelectorAll('p')].map(node=>node.textContent),Array(2).fill('The request took too long. Try again.'));
  assert.equal(calls,2);
});
