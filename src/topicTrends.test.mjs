import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

test('timeline titles, milestones and missing metadata stay attached to exact dossier buttons through selection',async t=>{
  const window=new Window({url:'http://localhost/?trend-days=90'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,ResizeObserver:window.ResizeObserver,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const title='Complete official title '.repeat(30).trim(),calls=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);calls.push(url);
    if(url.pathname.endsWith('/insights/procedure-context'))return Response.json({reference:url.searchParams.get('reference'),title,language:'en',summary:null,summaries:[],subjects:[],topics:[],source:{url:'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2025%2F0000(COD)'}});
    assert(url.pathname.endsWith('/insights/topic-trends'));
    return Response.json({window:{start:'2026-07-01',end:'2026-09-30'},weeks:['2026-09-07'],nextPage:null,
      coverage:{procedures:5,mapped:5,indexComplete:false},
      dossiers:Object.fromEntries(['published','signed','parliament-position','none'].map((state,i)=>['2025-000'+i,{title:i===0?title:'Official title '+i,titleLanguage:i===0?'fr':'en',reference:'2025/000'+i+'(COD)',status:{state,date:'2026-09-10'},fetchedAt:'2026-10-15T08:00:00Z'}])),
      topics:[{id:'http://eurovoc.europa.eu/1',label:'Transport',language:'en',dossiers:5,series:[{week:'2026-09-07',debates:1,votes:0,committee:0}],events:[{id:'exact-event',date:'2026-09-10',kind:'debates',procedures:[0,1,2,3,4].map(i=>({id:'2025-000'+i,reference:'2025/000'+i+'(COD)'}))}]}]});
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {TopicTrends}=await vite.ssrLoadModule('/src/TopicTrends.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(TopicTrends,{language:'en'})));
  const cards=[...container.querySelectorAll('.insight-trend-dossier')];assert.equal(cards.length,5);
  const first=cards[0].querySelector('button');assert.equal(first.title,title);assert.equal(first.querySelector('[lang]').lang,'fr');
  assert.deepEqual(cards.map(card=>card.querySelector('.insight-trend-dossier-status').textContent.split(' · ')[0]),['Published in Official Journal','Final act signed','Parliament position adopted','Adoption not recorded','Status unavailable']);
  assert.equal(cards[4].querySelector('.insight-trend-dossier-title').textContent,'Title unavailable');
  assert.equal(cards[0].querySelector('a').href,'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2025%2F0000%28COD%29');
  assert(cards[0].querySelector('.insight-trend-dossier-source').textContent.includes('Retrieved Oct 15, 2026'));assert.match(cards[4].querySelector('.insight-trend-dossier-source').textContent,/EP source ↗Read dataOpen original source/);assert.equal(calls.length,1,'rows do not fetch individual dossier pages');
  await act(async()=>first.click());assert.equal(first.getAttribute('aria-expanded'),'true');
  assert.equal(new URL(window.location.href).searchParams.get('trend-dossier'),'2025/0000(COD)');
  assert.equal(calls[1].searchParams.get('reference'),'2025/0000(COD)');
  await act(async()=>first.click());assert.equal(first.getAttribute('aria-expanded'),'false');assert.equal(container.querySelector('.insight-procedure-context'),null);
});
