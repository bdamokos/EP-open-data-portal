import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {storyQuery} from '../server/story-facts-reader.mjs';
import {parseStorySetKey,storySetKey} from './storyLinkModel.mjs';
import {mapLinkFacts,placeLinkFacts,recordLinkPage,topicLinkDetail,storyPeriods,storyLabels,sourceDocuments} from './test-support/storyLinksFixtures.mjs';
let load;after(async()=>{if(load)await load.close();});
async function harness(t,{component='TopicStories',url='?view=topics&t-tab=places',props={},respond}={}){
 const window=new Window({url:'http://localhost/'+url}),old=new Map(),calls=[],invalid=[],sourceReads=[];let root;
 for(const [k,v]of Object.entries({window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLButtonElement:window.HTMLButtonElement,innerWidth:1280,requestAnimationFrame:fn=>{fn();return 0;},IS_REACT_ACT_ENVIRONMENT:true})){old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}
 window.HTMLElement.prototype.scrollIntoView=function(){};
 t.mock.method(globalThis,'fetch',async input=>{
  const u=new URL(input,location.href);calls.push(u);
  if(u.pathname==='/api/source-record'){sourceReads.push(u);return Response.json({error:{message:'Forbidden per-row EP read'}},{status:500});}
  let q;if(u.pathname==='/api/topics/story-facts'){const p=new URLSearchParams(u.search);p.delete('v');try{q=storyQuery(p);}catch(e){invalid.push(u.href);return Response.json({error:{message:e.message}},{status:400});}}
  const special=respond?.(u,q);if(special!==undefined)return special instanceof Response?special:Response.json(special);
  if(q)return Response.json(q.list?recordLinkPage(q):q.scope==='map'?mapLinkFacts(q):placeLinkFacts(q.key?.replace('place:','')));
  if(u.pathname==='/api/topics/detail')return Response.json(topicLinkDetail(u.searchParams.get('key')));
  if(u.pathname==='/api/topics/overview')return Response.json({ready:true,periods:storyPeriods,partial:{},items:Object.entries(storyLabels).map(([id,label])=>({id,iso3:id,key:'place:'+id,label,series:[],counts:{},groupsTotal:0,total:0}))});
  if(u.pathname.startsWith('/api/document/'))return Response.json({error:{message:'Fixture body unavailable'}},{status:503});
  return Response.json({ready:false});
 });
 t.after(async()=>{if(root)await act(async()=>root.unmount());await window.happyDOM.close();for(const[k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];assert.deepEqual(invalid,[],'requests must pass the real storyQuery parser');assert.equal(sourceReads.length,0,'rendering record rows must not read EP metadata');});
 if(!load)load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const module=component==='TopicStory'?'/src/TopicStory.tsx':component==='Topics'?'/src/Topics.tsx':'/src/TopicStories.tsx',Component=(await load(module))[component],{createRoot}=await import('react-dom/client');const node=document.createElement('div');document.body.append(node);root=createRoot(node);
 const render=next=>act(async()=>root.render(createElement(Component,{language:'en',members:[],onBack(){},...props,...next})));
 await render();const wait=async text=>{for(let i=0;i<50&&!node.textContent.includes(text);i++)await act(async()=>new Promise(r=>setTimeout(r,10)));assert(node.textContent.includes(text),node.textContent);};return {node,window,calls,render,wait};
}
const selection={periods:storyPeriods,partial:['2024-Q3','2026-Q4'],period:'2026-Q3',excludeOwn:true,labels:storyLabels};
test('real map templates render rises across full quarters, zooms and modes without undefined slots',async t=>{
 const h=await harness(t,{props:{selection}});
 for(const period of ['2025-Q2','2026-Q1','2026-Q3'])for(const zoom of ['world','eu'])for(const mode of ['q','d']){
  await h.render({selection:{...selection,period,zoom,mode}});await h.wait(mode==='q'?'questions':'Plenary texts');assert(h.node.querySelector('.topic-story'));assert(!h.node.textContent.includes('could not be displayed'));assert(!h.node.textContent.includes('undefined'));
 }
});
test('fallback rise and overall leader links name their own exact record sets',async t=>{
 const data={periods:['2026-Q1','2026-Q2','2026-Q3'],partial:{},items:[{key:'place:COL',label:'Colombia',series:[{period:'2026-Q1',question:1},{period:'2026-Q2',question:1},{period:'2026-Q3',question:13}]},{key:'place:TUR',label:'Türkiye',series:[{period:'2026-Q1',question:30},{period:'2026-Q2',question:30},{period:'2026-Q3',question:37}]}]};
 const h=await harness(t,{component:'TopicStory',props:{data,index:2,mode:'q',own:true,zoom:'eu'}}),links=[...h.node.querySelectorAll('a')];assert.equal(links.length,2);assert.deepEqual(links.map(a=>parseStorySetKey(new URL(a.href).searchParams.get('t-records')).scope),['COL','TUR']);
});
test('EU map set keys retain zoom and mode, and their record pages fetch the same selection',async t=>{
 const h=await harness(t,{props:{selection:{...selection,zoom:'eu',mode:'d'}}});await h.wait('Two urgency debates');const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent==='Two urgency debates');assert(link);const key=new URL(link.href).searchParams.get('t-records');assert.equal(parseStorySetKey(key).zoom,'eu');assert.equal(parseStorySetKey(key).mode,'d');
 await act(async()=>{history.pushState({},'',link.href);window.dispatchEvent(new window.PopStateEvent('popstate'));});await h.wait('2 urgency debates on human rights');assert(h.calls.some(u=>u.pathname.endsWith('story-facts')&&u.searchParams.get('period')==='2026-Q3'&&u.searchParams.get('zoom')==='eu'&&u.searchParams.get('mode')==='d'));assert.equal(h.node.querySelectorAll('.topic-story-records > article').length,2);
});
test('home-author claims retain the supported filtered topic-list URL',async t=>{
 const h=await harness(t,{props:{selection:{...selection,excludeOwn:false,mode:'q'}},respond:(u,q)=>{if(q?.scope==='map'){const f=mapLinkFacts(q);f.periodWinners['2026-Q3'].risingQuestionPlaces=[{id:'GRC',count:13,baselineMean:2,ratio:6.5}];f.series={GRC:{'2026-Q3':{questionHome:3}}};return f;}}});await h.wait('had an author elected there');const link=[...h.node.querySelectorAll('a')].find(a=>a.textContent.includes('had an author elected there'));assert(link);const q=new URL(link.href).searchParams;assert.equal(q.get('place'),'GRC');assert.equal(q.get('t-askers'),'home');assert.equal(q.get('t-kind'),'question');assert(!q.has('t-records'));
});
test('a quarter-qualified page-list claim calls its list handler before quarter navigation',async t=>{
 const opened=[];const h=await harness(t,{props:{selection:{...selection,topic:'oeil:3.70.03'},onRecords:(...args)=>opened.push(args)}});await h.wait('debates and dossiers');const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent.includes('debates and dossiers'));assert(link);assert.equal(new URL(link.href).hash,'#topic-records');await act(async()=>link.click());assert.equal(opened.length,1);assert.equal(opened[0][0],'2026-Q3');assert(opened[0][1].includes('debates and dossiers'));
});
for(const list of ['questions','documents','adoptedTexts'])test('topic labels are resolved for '+list+' record pages',async t=>{
 const key=storySetKey({text:'',records:[],browse:{list}},{topic:'oeil:3.70.03',period:'2025-Q2',mode:'d',zoom:'eu'});
 const h=await harness(t,{component:'TopicStoryRecords',url:'?view=topics&topic=oeil:3.70.03&t-records='+encodeURIComponent(key),props:{selection:{...selection,topic:'oeil:3.70.03',period:'2025-Q2'}}});await h.wait('about Climate policy');assert(!h.node.querySelector('h1').textContent.includes('oeil:'));
});
for(const [askers,label]of [['all','All authors'],['elsewhere','asked only by MEPs from other countries'],['not-home','Leave out MEPs’ own country']])test('record-page meta identifies '+askers+' exactly',async t=>{
 const h=await harness(t,{component:'TopicStoryRecords',url:'?view=topics&place=IRN&t-records='+encodeURIComponent('questions:IRN:2026-Q2:'+askers),props:{selection:{...selection,place:'IRN',period:'2026-Q2'}}});await h.wait('questions about Iran');assert(h.node.querySelector('.topic-story-records > p').textContent.toLowerCase().includes(label.toLowerCase()));
});
test('record and document Back URLs preserve mode, zoom and own-country state',async t=>{
 const key=storySetKey({text:'',records:[],browse:{list:'documents'}},{place:'IRN',period:'2026-Q1',mode:'d',zoom:'eu'}),base='?view=topics&place=IRN&t-q=2026-Q1&t-mode=d&t-zoom=eu&t-own=0';
 const h=await harness(t,{component:'Topics',url:base+'&t-records='+encodeURIComponent(key)});await h.wait('texts about Iran');let back=h.node.querySelector('.topic-story-records > a');for(const[k,v]of Object.entries({'t-mode':'d','t-zoom':'eu','t-own':'0'}))assert.equal(new URL(back.href).searchParams.get(k),v);
 await act(async()=>{history.replaceState({},'',base+'&t-record='+sourceDocuments[0].id);window.dispatchEvent(new window.PopStateEvent('popstate'));});await h.wait(sourceDocuments[0].title);back=h.node.querySelector('.topic-story-records > a');for(const[k,v]of Object.entries({'t-mode':'d','t-zoom':'eu','t-own':'0'}))assert.equal(new URL(back.href).searchParams.get(k),v);
 const previous=location.href;let wentBack=0;t.mock.method(history,'back',()=>{wentBack++;});history.replaceState({storyLinkId:'from-story'},'',previous);await act(async()=>back.click());assert.equal(wentBack,1,'in-app document Back must use browser history');
});
test('question rows use answer references from their one story-facts response, with no per-row EP reads',async t=>{
 const h=await harness(t,{component:'StoryBrowse',props:{selection:{...selection,place:'TUR',period:'2026-Q1'},browse:{list:'questions',place:'TUR',period:'2026-Q1',askers:'all'}},respond:(u,q)=>{if(q?.list==='questions'){const f=recordLinkPage(q);f.questions[0].answers=[{id:f.questions[0].id+'-ASW',title:'A retained published answer',date:'2026-02-01'}];return f;}}});await h.wait('A retained published answer');assert(h.node.querySelector('article > .story-supporting article'));assert(h.node.textContent.includes('Showing 4 of 4'));assert.equal(h.calls.filter(u=>u.pathname.includes('story-facts')).length,1);
});
test('count phrases select reviewed singular plural families when actually rendered',async t=>{
 const h=await harness(t,{props:{selection},respond:(u,q)=>{if(q?.scope==='map'){const f=mapLinkFacts(q);f.periodCounts.forEach(r=>r.urgencyDebates=1);for(const p of f.periods)f.sets.urgencyDebates[p]=f.sets.urgencyDebates[p].slice(0,1);return f;}}});await h.wait('urgency');const {UiMessage}=await load('/src/UiI18nReact.tsx'),{renderToStaticMarkup}=await import('react-dom/server');for(const[id,expected]of [['urgency','1 urgency debate'],['debatesEach','1 debate each'],['places','1 place']])assert.equal(renderToStaticMarkup(createElement(UiMessage,{id:'topics.story.links.'+id,values:{count:1},counts:{count:1}})),expected);
});
test('known record kinds and the Plenary texts baseline heading survive rendering',async t=>{
 const records=sourceDocuments.map(r=>({...r,kind:'document'})),key=storySetKey({text:{message:'topics.story.count.texts',values:{count:'three'},counts:{count:3}},expected:3,records},{place:'IRN',period:'2026-Q1'});
 const h=await harness(t,{component:'TopicStoryRecords',url:'?view=topics&place=IRN&t-records='+encodeURIComponent(key),props:{selection:{...selection,place:'IRN',period:'2026-Q1'}}});await h.wait('3 texts about Iran');assert(!h.node.querySelector('h1').textContent.includes('records'));
 await act(async()=>{history.replaceState({},'','?view=topics&place=IRN&t-records='+encodeURIComponent('documents:IRN:2025-Q1%2C2025-Q2:all'));window.dispatchEvent(new window.PopStateEvent('popstate'));});await h.wait('Plenary texts on Iran before 2026 Q1');
});
test('missing records keep the unavailable state instead of lowering the claimed count',async t=>{
 const records=[...sourceDocuments,{id:'B-10-2026-999999',kind:'document',title:'Not hydrated'}].map(r=>({...r,kind:'document'})),key=storySetKey({text:'four texts',expected:4,records},{place:'IRN',period:'2026-Q2'});
 const h=await harness(t,{component:'TopicStoryRecords',url:'?view=topics&place=IRN&t-records='+encodeURIComponent(key),props:{selection:{...selection,place:'IRN',period:'2026-Q2'}}});await h.wait('Records unavailable.');assert(!h.node.textContent.includes('3 texts about'));assert.equal(h.node.querySelectorAll('article').length,0);
});

test('the actual page-list heading includes its claim and returns focus to the sentence',async t=>{
 const h=await harness(t,{component:'Topics',url:'?view=topics&topic=oeil:3.70.03&t-q=2026-Q3'});await h.wait('debates and dossiers');const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent.includes('debates and dossiers'));assert(link);await act(async()=>link.click());const heading=h.node.querySelector('#topic-records h2');assert(heading.textContent.includes(link.textContent),heading.textContent);const back=heading.querySelector('a');assert(back.textContent.includes('Back to the sentence'));await act(async()=>back.click());assert.equal(document.activeElement.id,link.id);
});
test('document history Back restores the originating rendered story link and selection',async t=>{
 const origin='?view=topics&place=IRN&t-q=2026-Q1&t-mode=d&t-zoom=eu&t-own=0',h=await harness(t,{component:'Topics',url:origin});await h.wait('Exact adopted text 1');const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent==='Exact adopted text 1');assert(link);const id=link.id;await act(async()=>link.click());await h.wait(sourceDocuments[0].title);const state=history.state;let backCalls=0;t.mock.method(history,'back',()=>{backCalls++;history.replaceState(state,'',origin);window.dispatchEvent(new window.PopStateEvent('popstate'));});await act(async()=>h.node.querySelector('.topic-story-records > a').click());await h.wait('Exact adopted text 1');assert.equal(backCalls,1);assert.equal(document.activeElement.id,id);for(const[k,v]of Object.entries({'t-mode':'d','t-zoom':'eu','t-own':'0'}))assert.equal(new URL(location.href).searchParams.get(k),v);
});
test('a directly shared EU set preserves the key selection in its Back URL',async t=>{
 const key='urgency-debates:map:2026-Q1:not-home:zoom=eu:mode=d:n=2',h=await harness(t,{component:'TopicStoryRecords',url:'?view=topics&t-records='+encodeURIComponent(key),props:{selection:{...selection,mode:'q',zoom:'world',period:'2026-Q1'}}});await h.wait('2 urgency debates on human rights');const back=new URL(h.node.querySelector('.topic-story-records > a').href);assert.equal(back.searchParams.get('t-mode'),'d');assert.equal(back.searchParams.get('t-zoom'),'eu');
});

test('a rendered claim never shrinks when its complete set contains fewer IDs than advertised',async t=>{
 const h=await harness(t,{props:{selection:{...selection,period:'2025-Q3'}},respond:(u,q)=>{if(q?.scope==='map'){const f=mapLinkFacts(q);f.sets.urgencyDebates['2025-Q3']=f.sets.urgencyDebates['2025-Q3'].slice(0,7);return f;}}});await h.wait('Eight urgency debates');const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent==='Eight urgency debates');assert(link);const key=new URL(link.href).searchParams.get('t-records');assert.equal(parseStorySetKey(key).expected,8);await act(async()=>{history.pushState({},'',link.href);window.dispatchEvent(new window.PopStateEvent('popstate'));});await h.wait('Records unavailable.');assert.equal(h.node.querySelectorAll('article').length,0);assert(!h.node.textContent.includes('7 urgency debates'));
});
