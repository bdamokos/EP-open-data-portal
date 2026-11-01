import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {titleParts,mapCode,point,quarterBounds,placeValue,riser,risers,legacyTopics,topicsHref,agendaTitle,isEuPlace,withBoundaryTies} from './topicPresentation.mjs';
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
 const {TopicStory}=await load('/src/TopicStory.tsx');
 const tieData={periods:['2025-Q1','2025-Q2','2025-Q3'],partial:{},items:['Iran','Georgia'].map((label,i)=>({key:'place:'+['IRN','GEO'][i],label,series:[{period:'2025-Q1',document:2},{period:'2025-Q2',document:2},{period:'2025-Q3',document:10}]}))};const tied=renderToStaticMarkup(h(TopicStory,{data:tieData,index:2,mode:'d',own:false}));assert(tied.includes('Georgia')&&tied.includes('Iran')&&tied.includes('each'));
 for(const mode of ['d','q']){const single={periods:['2026-Q1'],partial:{},items:[{key:'place:IRN',label:'Iran',series:[{period:'2026-Q1',document:1,question:1}]}]},text=renderToStaticMarkup(h(TopicStory,{data:single,index:0,mode,own:false}));assert(text.includes(mode==='d'?'1 document':'1 question'));assert(!text.includes(mode==='d'?'1 documents':'1 questions'));}

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

test('own-country origin splitting applies only to EU places',()=>{assert.equal(isEuPlace('HUN'),true);assert.equal(isEuPlace('IRN'),false);assert.equal(isEuPlace('TUR'),false);assert.equal(isEuPlace('GBR'),false);assert.equal(isEuPlace(null),false);});

test('ranked previews include every tie at their boundary',()=>{const rows=[9,8,7,7,7,6].map((n,i)=>({n,id:i}));assert.deepEqual(withBoundaryTies(rows,3,r=>r.n).map(r=>r.n),[9,8,7,7,7]);assert.deepEqual(withBoundaryTies(rows,20,r=>r.n),rows);});

test('record-topic batches cover every ID and full reader metadata expands completely',async t=>{
 const {Window}=await import('happy-dom'),{createElement:h,act}=await import('react'),{freshLoader}=await import('./test-support/viteRunner.mjs');
 const window=new Window({url:'http://localhost/?view=topics'}),globals={window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v] of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d] of originals)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const ids=Array.from({length:75},(_,i)=>'E-10-2026-'+String(i).padStart(6,'0')),requests=[];
 t.mock.method(globalThis,'fetch',async input=>{const url=new URL(String(input),'http://localhost');if(url.pathname==='/api/topics/story-facts')return Response.json({ready:false});assert.equal(url.pathname,'/api/insights/record-topics');const requested=url.searchParams.get('ids').split(',');requests.push(requested);return Response.json({ready:true,records:requested.map(id=>({id,status:'classified',topics:[{key:'oeil:1.10',label:'Trade'},{key:'oeil:1.20',label:'Climate'}],places:[{key:'place:IRN',id:'IRN',label:'Iran'},{key:'place:GEO',id:'GEO',label:'Georgia'}],keywords:['Customs','Transport','Energy','Water','Waste'].map((label,i)=>({key:'eurovoc:'+i,label,featured:i<3}))}))});});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-batch-expansion'});
 const {TopicBatch,RecordTopics}=await load('/src/RecordTopics.tsx'),{TopicStories}=await load('/src/TopicStories.tsx'),{createRoot}=await import('react-dom/client');const node=window.document.createElement('div');window.document.body.append(node);root=createRoot(node);
 await act(async()=>root.render(h(TopicBatch,{ids},h(RecordTopics,{id:ids[74],full:true}))));for(let i=0;i<20&&!node.textContent.includes('Trade');i++)await act(async()=>new Promise(r=>setTimeout(r,25)));
 assert.deepEqual(requests.map(r=>r.length),[50,25]);assert.equal(new Set(requests.flat()).size,75);assert(node.textContent.includes('Trade'));assert(!node.textContent.includes('Climate'));assert(!node.textContent.includes('Waste'));
 await act(async()=>node.querySelector('.record-topics button').click());assert(node.textContent.includes('Climate'));assert(node.textContent.includes('Georgia'));
 await act(async()=>node.querySelector('.topic-keywords button').click());assert(node.textContent.includes('Water'));assert(node.textContent.includes('Waste'));assert.equal(node.querySelectorAll('[data-topics-pending="true"]').length,0);
 const before=requests.length;await act(async()=>root.render(h(TopicStories,{selection:{periods:['2026-Q1'],place:'IRN'},fallback:'Fallback caption'})));assert.equal(node.textContent,'Fallback caption');assert.equal(requests.length,before,'Unavailable live facts retain the fallback.');
});

test('group speech links state the exact contribution count without implying a speaker total',async()=>{
 const {createAppUiI18n}=await import('./uiCatalogues.mjs');assert.equal(createAppUiI18n().forLocale('en').t('topics.speechSummary',{count:12}),'Speeches: 12');
 const source=await readFile(new URL('./Topics.tsx',import.meta.url),'utf8');assert(!source.includes('g.speechCount-1'));
});

test('finder Reload remains focusable after input blur and closes only when focus leaves',async t=>{
 const {Window}=await import('happy-dom'),{createElement:h,act}=await import('react'),{freshLoader}=await import('./test-support/viteRunner.mjs');
 const window=new Window({url:'http://localhost/?view=topics'}),globals={window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v] of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
 let root,load; t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d] of originals)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 let requests=0;t.mock.method(globalThis,'fetch',async()=>++requests===1?Response.json({error:{message:'Unavailable'}},{status:503}):Response.json({ready:true,results:[{key:'oeil:1.10',role:'topic',label:'Trade',counts:{debate:1,question:1}}]}));
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-finder-error'});const {TopicFinder}=await load('/src/TopicFinder.tsx'),{createRoot}=await import('react-dom/client');const node=window.document.createElement('div');window.document.body.append(node);root=createRoot(node);let selected;
 await act(async()=>root.render(h(TopicFinder,{onSelect:item=>selected=item})));const input=node.querySelector('input');await act(async()=>input.focus());await act(async()=>new Promise(r=>setTimeout(r,30)));
 const reload=node.querySelector('button');assert(reload);await act(async()=>reload.focus());assert.equal(document.activeElement,reload);assert.equal(input.getAttribute('aria-expanded'),'true');await act(async()=>reload.click());await act(async()=>new Promise(r=>setTimeout(r,30)));assert.equal(requests,2);assert(node.textContent.includes('Trade'));const outside=document.createElement('button');document.body.append(outside);await act(async()=>outside.focus());assert.equal(input.getAttribute('aria-expanded'),'false');assert.equal(node.querySelector('[role=listbox]'),null);
});

test('fallback risers retain every tie on ratio and count, not a sole winner',async t=>{
 const data={periods:['2025-Q1','2025-Q2','2025-Q3'],partial:{first:null,last:null},items:[['IRN','Iran',2,10],['GEO','Georgia',2,10],['TUR','Türkiye',1,5]].map(([id,label,base,n])=>({key:'place:'+id,label,series:[{period:'2025-Q1',document:base},{period:'2025-Q2',document:base},{period:'2025-Q3',document:n}]}))};assert.deepEqual(risers(data,2,'d',false).map(r=>r.item.label),['Georgia','Iran']);

});

test('fallback and finder quantities select independent singular and plural forms',async t=>{
 const {createAppUiI18n}=await import('./uiCatalogues.mjs'),ui=createAppUiI18n().forLocale('en');const summary=(d,q)=>ui.t('topics.findSummary',{debates:ui.t('topics.story.count.debates',{count:d},{count:d}),questions:ui.t('topics.story.count.questions',{count:q},{count:q})});assert.equal(summary(1,1),'1 plenary debate · 1 question');assert.equal(summary(1,2),'1 plenary debate · 2 questions');assert.equal(summary(2,1),'2 plenary debates · 1 question');

});
