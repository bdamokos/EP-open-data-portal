import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {sourceAvailability} from '../server/source-availability.mjs';

const coverage={complete:true,available:true,limited:false};
const empty=type=>({type,total:0,nextOffset:null,truncated:false,results:[],coverage});
async function render(t,{query,sections,commission,type='all'}) {
  const window=new Window({url:'http://localhost/?global-fts='+encodeURIComponent(query)}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const routes=[];
  t.mock.method(globalThis,'fetch',async url=>{
    const route=String(url);routes.push(route);
    if(route.includes('/references?'))return commission?Response.json(commission):new Response('{}',{status:503});
    const kind=new URL(route,'http://x').searchParams.get('type');
    return Response.json({offset:0,sections:[sections[kind]||empty(kind)]});
  });
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}}),{ParliamentSearchResults}=await load('/src/ParliamentSearchResults.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value]of previous)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  await act(async()=>root.render(createElement(ParliamentSearchResults,{query,type,language:'en'})));
  await act(async()=>{});await act(async()=>{});
  return {container,routes};
}
const report={type:'reference',total:1,nextOffset:null,truncated:false,coverage,input:'document',results:[{id:'A-10-2026-0257',type:'reference',kind:'report',reference:'A10-0257/2026',title:'REPORT on Erasmus+',titleLanguage:'en',date:'2026-10-02',dossier:'2025/0222(COD)'}]};

test('a held reference leads the page and links to its dossier',async t=>{
  const {container}=await render(t,{query:'A10-0257/2026',sections:{reference:report}});
  const block=container.querySelector('.explorer-search-reference');
  assert(block,'reference block');
  assert(container.querySelector('.explorer-catalog-results').firstElementChild===block,'it comes before every section');
  assert.match(block.textContent,/Report · A10-0257\/2026/);
  assert.doesNotMatch(container.textContent,/No matches/);
  assert.match(block.querySelector('a').getAttribute('href'),/dossier-ref=2025%2F0222%28COD%29/);
});
test('a reference that is not held hides the empty sections and says so once',async t=>{
  const {container}=await render(t,{query:'A10-9999/2026',sections:{reference:{...empty('reference'),held:false,input:'document'}}});
  assert.match(container.textContent,/No document with this reference\./);
  assert.doesNotMatch(container.textContent,/No matches/);
  assert.equal(container.querySelectorAll('section').length,0);
});
test('a Commission reference resolves through the reference lookup',async t=>{
  const lookup={...empty('reference'),held:null,input:'commission',lookup:{key:'com:2025/549',reference:'COM(2025) 549'}};
  const {container,routes}=await render(t,{query:'COM(2025) 549',sections:{reference:lookup},commission:{references:[{status:'found',procedure:'2025/0222(COD)',title:'Proposal for Erasmus+',titleLanguage:'en',date:'2025-07-16'}]}});
  assert(routes.some(route=>/references\?keys=com%3A2025%2F549/.test(route)));
  assert.match(container.querySelector('.explorer-search-reference').textContent,/Dossier · 2025\/0222\(COD\)/);
  assert.match(container.querySelector('.explorer-search-reference a').textContent,/Proposal for Erasmus\+/);
});
test('a failed Commission lookup falls through to the ordinary sections',async t=>{
  const lookup={...empty('reference'),held:null,input:'commission',lookup:{key:'com:2025/549',reference:'COM(2025) 549'}};
  const {container}=await render(t,{query:'COM(2025) 549',sections:{reference:lookup}});
  assert(!container.querySelector('.explorer-search-reference'));
  assert.equal(container.querySelectorAll('section').length,3);
});
test('plain queries request no reference',async t=>{
  const {routes}=await render(t,{query:'Erasmus',sections:{}});
  assert(!routes.some(route=>route.includes('type=reference')));
});
test('empty sections say "No matches." and name unsearched agendas once, last',async t=>{
  const topic={...empty('topic'),coverage:{...coverage,complete:false,missingAgendas:27}};
  const availability=sourceAvailability({sourceKey:'questions',family:'questions',start:'2026-10-01',end:'2026-10-30',latestObservedDate:'2026-10-29',gaps:[]});
  const question={...empty('question'),coverage:{...coverage,complete:false,availability}};
  const {container}=await render(t,{query:'Erasmus',sections:{topic,question}});
  assert.equal((container.textContent.match(/No matches\./g)||[]).length,3);
  assert.doesNotMatch(container.textContent,/partial|Latest question|Agendas unavailable/i);
  const section=container.querySelector('section[aria-label="Plenary topics"]');
  assert(section.lastElementChild.textContent==='27 agendas not searched.',section.textContent);
});
