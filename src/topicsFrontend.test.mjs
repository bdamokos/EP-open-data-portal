import {installRetryClock,automaticRecovery,exhaustAutomaticRetries} from './test-support/automaticRecovery.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {titleParts,mapCode,point,quarterBounds,placeValue,riser,risers,emptyDossierRedirect,topicsHref,agendaTitle,isEuPlace,withBoundaryTies} from './topicPresentation.mjs';
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
test('heat cells expose zero values, partial state and drilldown; finder supports keyboard and cancellation',async()=>{const source=await readFile(new URL('./Topics.tsx',import.meta.url),'utf8'),finder=await readFile(new URL('./TopicFinder.tsx',import.meta.url),'utf8');assert(source.includes('data-zero={n===0}'));assert(source.includes("'topic-partial'"));assert(source.includes("{'t-q':p}"));for(const key of ['ArrowDown','ArrowUp','Enter','Escape','aria-activedescendant','role="combobox"'])assert(finder.includes(key));});

test('kicker renders +N and place links, keeps keywords reader-only, and hides empty records',async t=>{
 const {createElement:h}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server'),{freshLoader}=await import('./test-support/viteRunner.mjs');
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});t.after(()=>load.close());
 const {TopicLine}=await load('/src/RecordTopics.tsx');
 const record={id:'O-10-2026-000001',status:'classified',topics:[{key:'oeil:1.10',label:'Trade'},{key:'oeil:1.20',label:'Policy'}],places:[{key:'place:IRN',label:'Iran'}],keywords:[{key:'eurovoc:123',label:'Customs',featured:true}]};
 const compact=renderToStaticMarkup(h(TopicLine,{record}));assert.match(compact,/\+1/);assert.match(compact,/place=IRN/);assert.match(compact,/topic=oeil%3A1.10/);assert(!compact.includes('Customs'));
 const full=renderToStaticMarkup(h(TopicLine,{record,full:true}));assert.match(full,/Customs/);assert.match(full,/topic=eurovoc%3A123/);
 assert.equal(renderToStaticMarkup(h(TopicLine,{record:{...record,topics:[],places:[],keywords:[]}})),'');
 const translated={...record,topics:[{key:'oeil:1.10',label:'Magyar név',labelLanguage:'hu',labelSource:'explorer-translation'}]};
 const translatedMarkup=renderToStaticMarkup(h(TopicLine,{record:translated,full:true,language:'fr'}));
 assert.match(translatedMarkup,/lang="hu"[^>]*>Magyar név/);
 assert(!translatedMarkup.includes('<details'));
 assert(!renderToStaticMarkup(h(TopicLine,{record:translated,language:'fr'})).includes('translated by'));
 assert(!full.includes('translated by'));

 assert.match(renderToStaticMarkup(h(TopicLine,{record:{...record,status:'unavailable',topics:[],places:[],keywords:[]},full:true})),/Unavailable/);
 const {default:PlacesMap}=await load('/src/PlacesMap.tsx');const map=renderToStaticMarkup(h(PlacesMap,{data:{items:[{key:'place:IRN',iso3:'IRN',label:'Iran',series:[]}]},period:'2026-Q1',mode:'q',own:false,zoom:'world',pause:()=>{}}));assert.match(map,/<a tabindex="-1" aria-hidden="true"[^>]+href=/);assert.match(map,/place=IRN/);
 const {TopicStory}=await load('/src/TopicStory.tsx');
 const rareData={periods:['2025-Q1','2025-Q2','2025-Q3'],partial:{},items:[{key:'place:IRN',label:'Iran',series:[{period:'2025-Q3',question:8,document:3,top:{key:'MTG-PL-1',title:'A debate (debate)'}}]}]};const rare=renderToStaticMarkup(h(TopicStory,{data:rareData,index:2,mode:'q',own:false}));assert.match(rare,/rarely asked about before/);assert(!rare.includes('Infinity')&&!rare.includes('Biggest debate'));assert.match(renderToStaticMarkup(h(TopicStory,{data:rareData,index:2,mode:'d',own:false})),/Biggest debate/);
 const untitledData={...rareData,items:[{...rareData.items[0],series:[{...rareData.items[0].series[0],top:{key:'MTG-PL-2025-09-10-PVCRE-ITM-7',title:null}}]}]};const untitledStory=renderToStaticMarkup(h(TopicStory,{data:untitledData,index:2,mode:'d',own:false}));assert(!untitledStory.includes('Biggest debate')&&!untitledStory.includes('<a></a>')&&!untitledStory.includes('Untitled'),'a debate without a held title is not named as the biggest debate');
 const voteData={...rareData,items:[{...rareData.items[0],series:[{...rareData.items[0].series[0],top:{key:'MTG-PL-2025-09-10-PVCRE-ITM-7-2',title:'Support for Ukraine (vote)',kind:'record'}}]}]};const voteStory=renderToStaticMarkup(h(TopicStory,{data:voteData,index:2,mode:'d',own:false}));assert(!voteStory.includes('Biggest debate')&&!voteStory.includes('(vote)'),'a voting-time group is never named the biggest debate');
 const tieData={periods:['2025-Q1','2025-Q2','2025-Q3'],partial:{},items:['Iran','Georgia'].map((label,i)=>({key:'place:'+['IRN','GEO'][i],label,series:[{period:'2025-Q1',document:2},{period:'2025-Q2',document:2},{period:'2025-Q3',document:10}]}))};const tied=renderToStaticMarkup(h(TopicStory,{data:tieData,index:2,mode:'d',own:false}));assert(tied.includes('Georgia')&&tied.includes('Iran')&&tied.includes('each'));
 for(const mode of ['d','q']){const single={periods:['2026-Q1'],partial:{},items:[{key:'place:IRN',label:'Iran',series:[{period:'2026-Q1',document:1,question:1}]}]},text=renderToStaticMarkup(h(TopicStory,{data:single,index:0,mode,own:false}));assert(text.includes(mode==='d'?'1 document':'1 question'));assert(!text.includes(mode==='d'?'1 documents':'1 questions'));}

});

test('own-country exclusion retains unknown-origin questions rather than treating them as home',()=>{assert.equal(placeValue({question:12,questionHome:3,questionElsewhere:7,questionUnknown:2},'q',true),9);});
test('finder selects the active result with arrows and Enter and closes with Escape',async t=>{
 const {Window}=await import('happy-dom'),{createElement:h,act}=await import('react'),{freshLoader}=await import('./test-support/viteRunner.mjs');
 const window=new Window({url:'http://localhost/?view=geopolitics'}),globals={window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v] of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
 let root,load; t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d] of originals)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 t.mock.method(globalThis,'fetch',async()=>Response.json({ready:true,results:[{key:'oeil:1.10',role:'topic',label:'Trade',counts:{debate:2,question:1}},{key:'place:IRN',role:'place',label:'Iran',counts:{question:4}}]}));
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-finder'});const {TopicFinder}=await load('/src/TopicFinder.tsx'),{createRoot}=await import('react-dom/client');const node=window.document.createElement('div');window.document.body.append(node);installRetryClock(t);root=createRoot(node);let selected;
 await act(async()=>root.render(h(TopicFinder,{onSelect:item=>selected=item})));const input=node.querySelector('input');await act(async()=>input.focus());await act(async()=>new Promise(r=>setTimeout(r,30)));
 const press=key=>act(async()=>input.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true})));
 await press('ArrowDown');assert(input.getAttribute('aria-activedescendant'));await press('ArrowDown');await press('Enter');assert.equal(selected.key,'place:IRN');assert.equal(input.getAttribute('aria-expanded'),'false');
 for(const [scope,label,expected] of [['places','Find a place',['Iran']],['topics','Find a topic',['Trade']]]){await act(async()=>root.render(h(TopicFinder,{scope,onSelect:item=>selected=item})));await act(async()=>{input.blur();input.focus();});await act(async()=>new Promise(r=>setTimeout(r,30)));assert.equal(input.placeholder,label);assert.deepEqual([...node.querySelectorAll('[role=option]>span')].map(n=>n.textContent),expected);await press('ArrowDown');await press('Enter');assert.equal(selected.role,scope==='places'?'place':'topic');}
await press('ArrowDown');await press('Escape');assert.equal(input.getAttribute('aria-expanded'),'false');
});

test('malformed quarter URLs cannot silently select an unfiltered record list',async()=>{const {readExplorerParam}=await import('./explorerQuery.mjs');assert.equal(readExplorerParam(new URLSearchParams('t-q=2026-Q8'),'t-q',''),'');assert.equal(readExplorerParam(new URLSearchParams('t-q=2026-Q3'),'t-q',''),'2026-Q3');});

test('agenda item prefixes are stripped without changing any remaining title text',()=>{
 for(const [before,after] of [['19.2. Systemic oppression…','Systemic oppression…'],['16. Simplification of waste legislation (joint debate)','Simplification of waste legislation (joint debate)'],['2.3.4. Exact — title 2026/12','Exact — title 2026/12'],['2026 priorities','2026 priorities'],['19.2.Systemic oppression','19.2.Systemic oppression'],['REPORT on 16. Trade','REPORT on 16. Trade']])assert.equal(agendaTitle(before),after);
});

test('own-country origin splitting applies only to EU places',()=>{assert.equal(isEuPlace('HUN'),true);assert.equal(isEuPlace('IRN'),false);assert.equal(isEuPlace('TUR'),false);assert.equal(isEuPlace('GBR'),false);assert.equal(isEuPlace(null),false);});

test('ranked previews include every tie at their boundary',()=>{const rows=[9,8,7,7,7,6].map((n,i)=>({n,id:i}));assert.deepEqual(withBoundaryTies(rows,3,r=>r.n).map(r=>r.n),[9,8,7,7,7]);assert.deepEqual(withBoundaryTies(rows,20,r=>r.n),rows);});

test('record-topic batches cover every ID and full reader metadata expands completely',async t=>{
 const {Window}=await import('happy-dom'),{createElement:h,act}=await import('react'),{freshLoader}=await import('./test-support/viteRunner.mjs');
 const window=new Window({url:'http://localhost/?view=geopolitics'}),globals={window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v] of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d] of originals)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const ids=Array.from({length:75},(_,i)=>'E-10-2026-'+String(i).padStart(6,'0')),requests=[];
 t.mock.method(globalThis,'fetch',async input=>{const url=new URL(String(input),'http://localhost');if(url.pathname==='/api/topics/story-facts')return Response.json({ready:false});assert.equal(url.pathname,'/api/insights/record-topics');const requested=url.searchParams.get('ids').split(',');requests.push(requested);return Response.json({ready:true,records:requested.map(id=>({id,status:'classified',topics:[{key:'oeil:1.10',label:'Trade'},{key:'oeil:1.20',label:'Climate'}],places:[{key:'place:IRN',id:'IRN',label:'Iran'},{key:'place:GEO',id:'GEO',label:'Georgia'}],keywords:['Customs','Transport','Energy','Water','Waste'].map((label,i)=>({key:'eurovoc:'+i,label,featured:i<3}))}))});});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-batch-expansion'});
 const {TopicBatch,RecordTopics}=await load('/src/RecordTopics.tsx'),{TopicStories}=await load('/src/TopicStories.tsx'),{createRoot}=await import('react-dom/client');const node=window.document.createElement('div');window.document.body.append(node);installRetryClock(t);root=createRoot(node);
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

test('finder keeps input focus through automatic recovery and closes only when focus leaves',async t=>{
 const {Window}=await import('happy-dom'),{createElement:h,act}=await import('react'),{freshLoader}=await import('./test-support/viteRunner.mjs');
 const window=new Window({url:'http://localhost/?view=geopolitics'}),globals={window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v] of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
 let root,load; t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d] of originals)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 let requests=0;t.mock.method(globalThis,'fetch',async()=>++requests===1?Response.json({error:{message:'Unavailable'}},{status:503}):Response.json({ready:true,results:[{key:'oeil:1.10',role:'topic',label:'Trade',counts:{debate:1,question:1}}]}));
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'topics-finder-error'});const {TopicFinder}=await load('/src/TopicFinder.tsx'),{createRoot}=await import('react-dom/client');const node=window.document.createElement('div');window.document.body.append(node);installRetryClock(t);root=createRoot(node);let selected;
 await act(async()=>root.render(h(TopicFinder,{onSelect:item=>selected=item})));const input=node.querySelector('input');await act(async()=>input.focus());await act(async()=>new Promise(r=>setTimeout(r,30)));
 const notice=node.querySelector('[role=alert]');assert.equal(notice,null);assert.equal(node.querySelector('button'),null);assert.equal(document.activeElement,input);assert.equal(input.getAttribute('aria-expanded'),'true');await automaticRecovery(t);await act(async()=>new Promise(r=>setTimeout(r,30)));assert.equal(requests,2);assert(node.textContent.includes('Trade'));assert.equal(document.activeElement,input);const result=node.querySelector('[role=option]');assert(result);await act(async()=>result.focus());assert.equal(input.getAttribute('aria-expanded'),'true');const outside=document.createElement('button');document.body.append(outside);await act(async()=>outside.focus());assert.equal(input.getAttribute('aria-expanded'),'false');assert.equal(node.querySelector('[role=listbox]'),null);
});

test('fallback risers retain every tie on ratio and count, not a sole winner',async t=>{
 const data={periods:['2025-Q1','2025-Q2','2025-Q3'],partial:{first:null,last:null},items:[['IRN','Iran',2,10],['GEO','Georgia',2,10],['TUR','Türkiye',1,5]].map(([id,label,base,n])=>({key:'place:'+id,label,series:[{period:'2025-Q1',document:base},{period:'2025-Q2',document:base},{period:'2025-Q3',document:n}]}))};assert.deepEqual(risers(data,2,'d',false).map(r=>r.item.label),['Georgia','Iran']);

});

test('fallback and finder quantities select independent singular and plural forms',async t=>{
 const {createAppUiI18n}=await import('./uiCatalogues.mjs'),ui=createAppUiI18n().forLocale('en');const summary=(d,q)=>ui.t('topics.findSummary',{debates:ui.t('topics.story.count.debates',{count:d},{count:d}),questions:ui.t('topics.story.count.questions',{count:q},{count:q})});assert.equal(summary(1,1),'1 plenary debate · 1 question');assert.equal(summary(1,2),'1 plenary debate · 2 questions');assert.equal(summary(2,1),'2 plenary debates · 1 question');

});

test('risers require a real 1.5 ratio and retain the earlier average',()=>{
 const data={periods:['2025-Q1','2025-Q2','2025-Q3'],partial:{},items:[{key:'place:IRN',series:[{period:'2025-Q1',question:10},{period:'2025-Q2',question:10},{period:'2025-Q3',question:14}]}]};assert.equal(riser(data,2,'q',false),null);data.items[0].series[2].question=15;assert.equal(riser(data,2,'q',false).ratio,1.5);data.items[0].series[0].question=0;data.items[0].series[1].question=0;assert.equal(riser(data,2,'q',false).average,0);
});

test("display agenda titles strip the debate suffix without changing source text",()=>{const source="19.2. Original title (debate)";assert.equal(agendaTitle(source),"Original title");assert.equal(source,"19.2. Original title (debate)");});

test('riser ratios use the max(1, average) baseline shared with stories',()=>{
 const item=(key,earlier,now)=>({key,series:[{period:'2025-Q1',question:earlier},{period:'2025-Q2',question:earlier},{period:'2025-Q3',question:now}]});
 const data={periods:['2025-Q1','2025-Q2','2025-Q3'],partial:{},items:[item('place:AAA',0,9),item('place:BBB',1,30)]};
 assert.equal(riser(data,2,'q',false).item.key,'place:BBB');assert.equal(riser(data,2,'q',false).ratio,30);
});


test('legacy prose requires parent and quantity coverage while other panels stay native',async t=>{
 const {createElement:h}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server'),{freshLoader}=await import('./test-support/viteRunner.mjs');
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'legacy-story-locale'});t.after(()=>load.close());
 const {TopicStory}=await load('/src/TopicStory.tsx'),{UiI18nProvider,UiMessage}=await load('/src/UiI18nReact.tsx'),{createUiI18n}=await import('./uiI18n.mjs'),{defaultUi}=await import('./uiDefault.mjs');
 const source={'topics.mostTiedCount':'{place} are most named, with {quantity} each.','topics.story.count.questions':{plural:'count',one:'{count} question',other:'{count} questions'}};
 const parent={'topics.mostTiedCount':'{place}: {quantity} kummallakin.'},child={'topics.story.count.questions':{plural:'count',one:'{count} kysymys',other:'{count} kysymystä'}};
 const data={periods:['2026-Q1'],partial:{},items:['Türkiye','Iran'].map((label,i)=>({key:'place:'+['TUR','IRN'][i],label,series:[{period:'2026-Q1',question:1234}]}))};
 for(const [messages,native] of [[child,false],[parent,false],[{...parent,...child},true]]){
  // Reuse the real complete English formatter for fallback, and inject only
  // these Finnish fixtures; unrelated absent messages still use production EN.
  const fixture=createUiI18n({source,translations:{fi:messages}}).forLocale('fi'),ui={...defaultUi,...fixture},i18n={sourceLocale:'en',forLocale:()=>ui};
  const html=renderToStaticMarkup(h(UiI18nProvider,{i18n},h('div',null,h(TopicStory,{data,index:0,mode:'q',own:true}),h('aside',null,h(UiMessage,{id:'topics.story.count.questions',values:{count:2},counts:{count:2}})))));
  assert.match(html,new RegExp('lang="'+(native?'fi':'en')+'"'));assert.match(html,native?/Türkiye<\/span> ja /:/Türkiye<\/span> and /);
  assert(html.includes(native?'1 234 kysymystä':'1,234 questions'),html);assert.match(html,/t-records=.*TUR/);assert.match(html,/t-own=1/);assert(html.includes('Türkiye'));
  if(messages===child)assert.match(html,/<aside>2 kysymystä<\/aside>/);
 }
});

test('topic and place links select their canonical navigation context and retain filters',()=>{
 for(const [key,view,mode,param] of [['place:IRN','geopolitics',null,'place'],['oeil:1.10','legislation','topics','topic'],['eurovoc:404','legislation','topics','topic']]){
  const q=new URL(topicsHref(key,{'t-q':'2026-Q1','t-own':'1',lang:'fr'}),'http://localhost').searchParams;
  assert.equal(q.get('view'),view);assert.equal(q.get('pl-mode'),mode);assert.equal(q.get(param),key.replace(/^place:/,''));assert.equal(q.get('lang'),'fr');
  const saved=explorerParams(q,view);assert.equal(saved.get(param),q.get(param));assert.equal(saved.get('t-q'),'2026-Q1');assert.equal(saved.get('t-own'),'1');
 }
});
test('empty dossier entry returns to agenda while referenced dossiers and other parameters survive',()=>{
 for(const suffix of ['', '&dossier-ref=', '&dossier-ref=%20']){
  const q=new URLSearchParams('view=legislation&pl-mode=dossier&lang=fr&agenda-period=week%3A2026-10-05'+suffix),redirect=new URL(emptyDossierRedirect(q),'http://localhost').searchParams;
  assert.equal(redirect.get('view'),'legislation');assert.equal(redirect.has('pl-mode'),false);assert.equal(redirect.has('dossier-ref'),false);assert.equal(redirect.get('lang'),'fr');assert.equal(redirect.get('agenda-period'),'week:2026-10-05');
 }
 assert.equal(emptyDossierRedirect(new URLSearchParams('view=legislation&pl-mode=dossier&dossier-ref=2025%2F0407(COD)')),null);
});
