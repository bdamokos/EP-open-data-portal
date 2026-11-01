import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {titleParts,mapCode,point,quarterBounds,placeValue,riser,legacyTopics,topicsHref,agendaTitle} from './topicPresentation.mjs';
import {explorerParams} from './explorerQuery.mjs';
test('official titles retain every character and style English only',()=>{
 for(const title of ['REPORT on the proposal for a regulation of the European Parliament and of the Council on transport','MOTION FOR A RESOLUTION on Iran','REPORT on trade as regards apples as regards pears','Plain title']){
  assert.equal(titleParts(title,'en').join(''),title);assert.deepEqual(titleParts(title,'fr'),['',title]);
 }
 assert(titleParts('REPORT on trade','en')[0]);assert.equal(titleParts('REPORT on trade as regards pears','en')[1],'pears');
});
test('map identity joins Belarus by ISO and documents the Kosovo exception',()=>{assert.equal(mapCode('BLR'),'BLR');assert.equal(mapCode('1A0'),'KOS');assert.equal(mapCode(null),null);});
test('sparse periods align without shifting and own-country exclusion preserves unknown',()=>{const item={series:[{period:'2026-Q2',question:10,questionHome:3,questionUnknown:2}]};assert.deepEqual(point(item,'2026-Q1'),{});assert.equal(placeValue(point(item,'2026-Q2'),'q',true),7);assert.equal(placeValue(point(item,'2026-Q2'),'q',false),10);assert.deepEqual(quarterBounds('2024-Q1'),{from:'2024-01-01',to:'2024-03-31'});assert.equal(quarterBounds('2024-Q5'),null);});
test('risers use earlier full quarters and never a partial quarter',()=>{const data={periods:['2025-Q1','2025-Q2','2025-Q3','2025-Q4'],partial:{first:null,last:'2025-12-01'},items:[{key:'place:IND',series:[{period:'2025-Q1',question:2},{period:'2025-Q2',question:2},{period:'2025-Q3',question:10}]}]};assert.equal(riser(data,2,'q',false).ratio,5);assert.equal(riser(data,3,'q',false),null);assert.equal(riser(data,1,'q',false),null);});
test('legacy timelines redirect and drilldown filters survive explorer serialization',()=>{assert.equal(legacyTopics(new URLSearchParams('view=legislation&pl-mode=trends&trend-key=123')),'?view=topics&topic=eurovoc%3A123');assert.equal(legacyTopics(new URLSearchParams('view=questions')),null);const href=topicsHref('place:IRN',{'t-q':'2026-Q1','t-kind':'question','t-own':'1'}),q=new URL(href,'http://localhost').searchParams;assert.equal(q.get('place'),'IRN');assert.equal(explorerParams(q,'topics').get('t-own'),'1');assert.equal(explorerParams(q,'topics').get('t-q'),'2026-Q1');});
test('heat cells expose zero values, partial state and drilldown; finder supports keyboard and cancellation',async()=>{const source=await readFile(new URL('./Topics.tsx',import.meta.url),'utf8'),finder=await readFile(new URL('./TopicFinder.tsx',import.meta.url),'utf8');assert(source.includes('data-zero={n===0}'));assert(source.includes("'topic-partial'"));assert(source.includes("{'t-q':p}"));for(const key of ['ArrowDown','ArrowUp','Enter','Escape','aria-activedescendant','role="combobox"'])assert(finder.includes(key));});

test('kicker renders +N and place links, keeps keywords reader-only, and hides empty records',async t=>{
 const {createElement:h}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server'),{freshLoader}=await import('./test-support/viteRunner.mjs');
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>load.close());
 const {TopicLine}=await load('/src/RecordTopics.tsx');
 const record={id:'O-10-2026-000001',status:'classified',topics:[{key:'oeil:1.10',label:'Trade'},{key:'oeil:1.20',label:'Policy'}],places:[{key:'place:IRN',label:'Iran'}],keywords:[{key:'eurovoc:123',label:'Customs',featured:true}]};
 const compact=renderToStaticMarkup(h(TopicLine,{record}));assert.match(compact,/\+1/);assert.match(compact,/place=IRN/);assert.match(compact,/topic=oeil%3A1.10/);assert(!compact.includes('Customs'));
 const full=renderToStaticMarkup(h(TopicLine,{record,full:true}));assert.match(full,/Customs/);assert.match(full,/topic=eurovoc%3A123/);
 assert.equal(renderToStaticMarkup(h(TopicLine,{record:{...record,topics:[],places:[],keywords:[]}})),'');
});

test('own-country exclusion retains unknown-origin questions rather than treating them as home',()=>{assert.equal(placeValue({question:12,questionHome:3,questionElsewhere:7,questionUnknown:2},'q',true),9);});
test('finder selects the active result with arrows and Enter and closes with Escape',async t=>{
 const {Window}=await import('happy-dom'),{createElement:h,act}=await import('react'),{freshLoader}=await import('./test-support/viteRunner.mjs');
 const window=new Window({url:'http://localhost/?view=topics'}),globals={window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v] of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
 let root,load; t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d] of originals)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 t.mock.method(globalThis,'fetch',async()=>Response.json({ready:true,results:[{key:'oeil:1.10',role:'topic',label:'Trade',counts:{debate:2,question:1}},{key:'place:IRN',role:'place',label:'Iran',counts:{question:4}}]}));
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-finder'});const {TopicFinder}=await load('/src/TopicFinder.tsx'),{createRoot}=await import('react-dom/client');const node=window.document.createElement('div');window.document.body.append(node);root=createRoot(node);let selected;
 await act(async()=>root.render(h(TopicFinder,{onSelect:item=>selected=item})));const input=node.querySelector('input');await act(async()=>input.focus());await act(async()=>new Promise(r=>setTimeout(r,30)));
 const press=key=>act(async()=>input.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true})));
 await press('ArrowDown');assert(input.getAttribute('aria-activedescendant'));await press('ArrowDown');await press('Enter');assert.equal(selected.key,'place:IRN');assert.equal(input.getAttribute('aria-expanded'),'false');await press('ArrowDown');await press('Escape');assert.equal(input.getAttribute('aria-expanded'),'false');
});

test('legacy EuroVoc URI bookmarks keep exact concept identity',()=>{assert.equal(legacyTopics(new URLSearchParams('view=legislation&pl-mode=trends&trend-topic=http%3A%2F%2Feurovoc.europa.eu%2F404')),'?view=topics&topic=eurovoc%3A404');});

test('malformed quarter URLs cannot silently select an unfiltered record list',async()=>{const {readExplorerParam}=await import('./explorerQuery.mjs');assert.equal(readExplorerParam(new URLSearchParams('t-q=2026-Q8'),'t-q',''),'');assert.equal(readExplorerParam(new URLSearchParams('t-q=2026-Q3'),'t-q',''),'2026-Q3');});

test('agenda item prefixes are stripped without changing any remaining title text',()=>{
 for(const [before,after] of [['19.2. Systemic oppression…','Systemic oppression…'],['16. Simplification of waste legislation (joint debate)','Simplification of waste legislation (joint debate)'],['2.3.4. Exact — title 2026/12','Exact — title 2026/12'],['2026 priorities','2026 priorities'],['19.2.Systemic oppression','19.2.Systemic oppression'],['REPORT on 16. Trade','REPORT on 16. Trade']])assert.equal(agendaTitle(before),after);
});
