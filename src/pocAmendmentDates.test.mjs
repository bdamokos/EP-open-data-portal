import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

test('amendment-list dates remain visible without substituting unknown individual or fallback dates',async t=>{
  const window=new Window({url:'http://localhost/?view=amendments'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(vite)await vite.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const base={targetDocumentId:'A-10-2026-0254',outcome:'unavailable',date:'2099-01-01'};
  const listDate={documentDate:null,listDocumentDate:'2026-02-02',dateBasis:'amendment-list-document'};
  const unknownDate={documentDate:null,listDocumentDate:null,dateBasis:'amendment-list-document'};
  const items=[
    {...base,id:'known-list',number:1,...listDate},
    {...base,id:'unknown-list',number:2,...unknownDate},
    {...base,id:'legacy-date',number:3,date:'2026-03-03',dateBasis:'amendment-list-document'},
    {...base,id:'legacy-document-date',number:4,documentDate:'2026-04-04',listDocumentDate:null,dateBasis:'amendment-list-document'},
    {...base,id:'unknown-individual',number:5,documentDate:null,listDocumentDate:'2026-05-05',dateBasis:'individual-amendment-document'},
    {...base,id:'variants',number:6,conflicted:true,variants:[
      {listId:'known-list',...listDate},
      {listId:'unknown-list',date:'2099-01-01',...unknownDate},
      {listId:'legacy-list',date:'2026-06-06',dateBasis:'amendment-list-document'},
    ]},
  ];
  t.mock.method(globalThis,'fetch',async input=>{
    assert(new URL(input,window.location.href).pathname.endsWith('/amendments'));
    return Response.json({items,total:items.length,offset:0,limit:20,coverage:{complete:false,pending:false,gaps:[]}});
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocAmendments}=await vite.ssrLoadModule('/src/PocAmendments.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocAmendments,{document:'A-10-2026-0254',showFailures:false})));
  const cards=[...container.querySelectorAll('.poc-amendment-card')];
  assert.match(cards[0].textContent,/Amendment-list document date Feb 2, 2026/);
  assert.doesNotMatch(cards[0].textContent,/Amendment document date Feb 2/);
  assert.doesNotMatch(cards[1].textContent,/document date|2099/i,'explicit unknown dates never use the generic fallback date');
  assert.match(cards[2].textContent,/Amendment-list document date Mar 3, 2026/);
  assert.match(cards[3].textContent,/Amendment-list document date Apr 4, 2026/);
  assert.doesNotMatch(cards[4].textContent,/document date|May 5|2099/i,'a known list date is not an individual amendment date');
  const variants=[...cards[5].querySelectorAll('.poc-amendment-variant')];
  assert.match(variants[0].textContent,/Amendment-list document date Feb 2, 2026/);
  assert.doesNotMatch(variants[1].textContent,/document date|2099/i);
  assert.match(variants[2].textContent,/Amendment-list document date Jun 6, 2026/);
});
