import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

test('source links open public pages and never machine-readable records',async t=>{
  const window=new Window({url:'http://localhost/'}),globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {SourceLink,sourcePageUrl}=await loadModule('/src/SourceLink.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=props=>act(async()=>root.render(createElement(SourceLink,props,'EP source')));
  await render({url:'https://data.europarl.europa.eu/api/v2/procedures/2025-0407',reference:'2025/0407(COD)'});
  assert.equal(container.querySelectorAll('a').length,1);assert.match(container.querySelector('a').href,/oeil\.europarl\.europa\.eu/);assert.equal(container.querySelector('button'),null);
  await render({url:'https://data.europarl.europa.eu/api/v2/meetings?parliamentary-term=10'});
  assert.equal(container.querySelector('a'),null);assert.equal(container.textContent,'EP source');
  await render({url:'http://eurovoc.europa.eu/3064',compact:true});
  assert.match(container.querySelector('a').href,/op\.europa\.eu/);assert.equal(container.querySelectorAll('a').length,1);
  await render({url:'https://www.europarl.europa.eu/doceo/document/A-10-2026-0001_EN.html'});
  assert.equal(container.querySelector('a').href,'https://www.europarl.europa.eu/doceo/document/A-10-2026-0001_EN.html');
  assert.equal(sourcePageUrl('https://data.europarl.europa.eu/org/7038'),null);
  assert.equal(sourcePageUrl('https://publications.europa.eu/webapi/rdf/sparql?query=x'),null);
});
