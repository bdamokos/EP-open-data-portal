import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

test('source links prefer official pages, read data on demand, preserve raw access on failure, and close to their trigger',async t=>{
  const window=new Window({url:'http://localhost/'}),globals={window,document:window.document,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  let vite,root;const calls=[],revoked=[],oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
  URL.createObjectURL=()=> 'blob:source-test';URL.revokeObjectURL=href=>revoked.push(href);
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const source='https://data.europarl.europa.eu/api/v2/procedures/2025-0407';let fail=false;
  t.mock.method(globalThis,'fetch',async input=>{calls.push(String(input));return fail?Response.json({error:{message:'Source unavailable'}},{status:502}):Response.json({sourceUrl:source,requestUrl:source+'?format=application%2Fld%2Bjson',fetchedAt:'2026-10-16T17:00Z',stale:true,collection:false,limited:false,records:[{title:'Exact procedure',websiteUrl:'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2025/0407(COD)',value:{id:'eli/dl/proc/2025-0407',process_title:{en:'Exact procedure',fr:'Procédure exacte'},number_of_votes_favor:0,absent:null}}],payload:{data:[{id:'eli/dl/proc/2025-0407'}]}});});
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocSourceLink}=await vite.ssrLoadModule('/src/PocSourceLink.tsx'),{createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocSourceLink,{url:source,reference:'2025/0407(COD)'},'EP source')));
  assert.equal(calls.length,0);assert.match(container.querySelector('a').href,/oeil/);assert.equal(container.querySelector('.source-raw').href,source);
  const trigger=container.querySelector('button');await act(async()=>trigger.click());
  const dialog=document.querySelector('dialog');assert(dialog.open);assert.equal(calls.length,1);assert.match(dialog.textContent,/Saved copy/);assert.match(dialog.textContent,/Not supplied/);assert.match(dialog.textContent,/Number of votes favor0/);assert.equal(dialog.querySelector('[download]').getAttribute('download'),'parliament-source.jsonld');
  const select=dialog.querySelector('select');await act(async()=>{select.value='fr';select.dispatchEvent(new window.Event('change',{bubbles:true}));});assert.equal(dialog.querySelector('h3').textContent,'Procédure exacte');assert.equal(calls.length,1,'language selection does not fetch another source');
  await act(async()=>dialog.querySelector('.source-close').click());assert.equal(document.querySelector('dialog'),null);assert.equal(document.activeElement,trigger);assert.equal(revoked.length,1);
  fail=true;const missing=source.replace('0407','0408');await act(async()=>root.render(createElement(PocSourceLink,{url:missing},'Source')));await act(async()=>container.querySelector('button').click());
  assert.match(document.querySelector('[role=alert]').textContent,/Source unavailable/);assert.equal(document.querySelector('dialog .source-actions a').href,missing);assert.equal(document.querySelector('dialog [download]'),null);
  await act(async()=>document.querySelector('dialog').dispatchEvent(new window.Event('cancel',{cancelable:true})));assert.equal(document.querySelector('dialog'),null);
});
