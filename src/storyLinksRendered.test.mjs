import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {storyQuery} from '../server/story-facts-reader.mjs';
import {parseStorySetKey,storySetKey} from './storyLinkModel.mjs';
import {mapLinkFacts,placeLinkFacts,recordLinkPage,topicLinkDetail,storyPeriods,storyLabels,sourceDocuments} from './test-support/storyLinksFixtures.mjs';
let load;after(async()=>{if(load)await load.close();});
async function harness(t,{component='TopicStories',url='?view=geopolitics',props={},respond,fresh=false}={}){
 if(fresh&&load){await load.close();load=null;}
 const window=new Window({url:'http://localhost/'+url}),old=new Map(),calls=[],invalid=[],sourceReads=[];let root;
 for(const [k,v]of Object.entries({window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLButtonElement:window.HTMLButtonElement,innerWidth:1280,requestAnimationFrame:fn=>{fn();return 0;},IS_REACT_ACT_ENVIRONMENT:true})){old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}
 window.HTMLElement.prototype.scrollIntoView=function(){};
 t.mock.method(globalThis,'fetch',async input=>{
  const u=new URL(input,location.href);calls.push(u);
  if(u.pathname==='/api/source-record'){sourceReads.push(u);return Response.json({error:{message:'Forbidden per-row EP read'}},{status:500});}
  let q;if(u.pathname==='/api/topics/story-facts'){const p=new URLSearchParams(u.search);p.delete('v');try{q=storyQuery(p);}catch(e){invalid.push(u.href);return Response.json({error:{message:e.message}},{status:400});}}
  const special=await respond?.(u,q);if(special!==undefined)return special instanceof Response?special:Response.json(special);
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
 const h=await harness(t,{component:'TopicStoryRecords',url:'?view=legislation&pl-mode=topics&topic=oeil:3.70.03&t-records='+encodeURIComponent(key),props:{selection:{...selection,topic:'oeil:3.70.03',period:'2025-Q2'}}});await h.wait('about Climate policy');assert(!h.node.querySelector('h1').textContent.includes('oeil:'));
});
for(const [askers,label]of [['all','All authors'],['elsewhere','asked only by MEPs from other countries'],['not-home','Leave out MEPs’ own country']])test('record-page meta identifies '+askers+' exactly',async t=>{
 const h=await harness(t,{component:'TopicStoryRecords',url:'?view=geopolitics&place=IRN&t-records='+encodeURIComponent('questions:IRN:2026-Q2:'+askers),props:{selection:{...selection,place:'IRN',period:'2026-Q2'}}});await h.wait('questions about Iran');assert(h.node.querySelector('.topic-story-records > p').textContent.toLowerCase().includes(label.toLowerCase()));
});
test('record and document Back URLs preserve mode, zoom and own-country state',async t=>{
 const key=storySetKey({text:'',records:[],browse:{list:'documents'}},{place:'IRN',period:'2026-Q1',mode:'d',zoom:'eu'}),base='?view=geopolitics&place=IRN&t-q=2026-Q1&t-mode=d&t-zoom=eu&t-own=0';
 const h=await harness(t,{component:'Topics',url:base+'&t-records='+encodeURIComponent(key)});await h.wait('texts about Iran');let back=h.node.querySelector('.topic-story-records > a');for(const[k,v]of Object.entries({'t-mode':'d','t-zoom':'eu','t-own':'0'}))assert.equal(new URL(back.href).searchParams.get(k),v);
 await act(async()=>{history.replaceState({},'',base+'&t-record='+sourceDocuments[0].id);window.dispatchEvent(new window.PopStateEvent('popstate'));});await h.wait(sourceDocuments[0].title);back=h.node.querySelector('.topic-story-records > a');for(const[k,v]of Object.entries({'t-mode':'d','t-zoom':'eu','t-own':'0'}))assert.equal(new URL(back.href).searchParams.get(k),v);
 const previous=location.href;let wentBack=0;t.mock.method(history,'back',()=>{wentBack++;});history.replaceState({storyReturn:true},'',previous);await act(async()=>back.click());assert.equal(wentBack,1,'in-app document Back must use browser history');
});
test('question rows use answer references from their one story-facts response, with no per-row EP reads',async t=>{
 const h=await harness(t,{component:'StoryBrowse',props:{selection:{...selection,place:'TUR',period:'2026-Q1'},browse:{list:'questions',place:'TUR',period:'2026-Q1',askers:'all'}},respond:(u,q)=>{if(q?.list==='questions'){const f=recordLinkPage(q);f.questions[0].answers=[{id:f.questions[0].id+'-ASW',title:'A retained published answer',date:'2026-02-01'}];return f;}}});await h.wait('A retained published answer');assert(h.node.querySelector('article > .story-supporting article'));assert(h.node.textContent.includes('Showing 4 of 4'));assert.equal(h.calls.filter(u=>u.pathname.includes('story-facts')).length,1);
});
test('count phrases select reviewed singular plural families when actually rendered',async t=>{
 const h=await harness(t,{props:{selection},respond:(u,q)=>{if(q?.scope==='map'){const f=mapLinkFacts(q);f.periodCounts.forEach(r=>r.urgencyDebates=1);for(const p of f.periods)f.sets.urgencyDebates[p]=f.sets.urgencyDebates[p].slice(0,1);return f;}}});await h.wait('urgency');const {UiMessage}=await load('/src/UiI18nReact.tsx'),{renderToStaticMarkup}=await import('react-dom/server');for(const[id,expected]of [['urgency','1 urgency debate'],['debatesEach','1 debate each'],['places','1 place']])assert.equal(renderToStaticMarkup(createElement(UiMessage,{id:'topics.story.links.'+id,values:{count:1},counts:{count:1}})),expected);
});
test('known record kinds and the Plenary texts baseline heading survive rendering',async t=>{
 const records=sourceDocuments.map(r=>({...r,kind:'document'})),key=storySetKey({text:{message:'topics.story.count.texts',values:{count:'three'},counts:{count:3}},expected:3,records},{place:'IRN',period:'2026-Q1'});
 const h=await harness(t,{component:'TopicStoryRecords',url:'?view=geopolitics&place=IRN&t-records='+encodeURIComponent(key),props:{selection:{...selection,place:'IRN',period:'2026-Q1'}}});await h.wait('3 texts about Iran');assert(!h.node.querySelector('h1').textContent.includes('records'));
 await act(async()=>{history.replaceState({},'','?view=geopolitics&place=IRN&t-records='+encodeURIComponent('documents:IRN:2025-Q1%2C2025-Q2:all'));window.dispatchEvent(new window.PopStateEvent('popstate'));});await h.wait('Plenary texts on Iran before January 2026');
});
test('missing records keep the unavailable state instead of lowering the claimed count',async t=>{
 const records=[...sourceDocuments,{id:'B-10-2026-999999',kind:'document',title:'Not hydrated'}].map(r=>({...r,kind:'document'})),key=storySetKey({text:'four texts',expected:4,records},{place:'IRN',period:'2026-Q2'});
 const h=await harness(t,{component:'TopicStoryRecords',url:'?view=geopolitics&place=IRN&t-records='+encodeURIComponent(key),props:{selection:{...selection,place:'IRN',period:'2026-Q2'}}});await h.wait('Records unavailable.');assert(!h.node.textContent.includes('3 texts about'));assert.equal(h.node.querySelectorAll('article').length,0);
});

test('the actual page-list heading includes its claim and returns focus to the sentence',async t=>{
 const h=await harness(t,{component:'Topics',url:'?view=legislation&pl-mode=topics&topic=oeil:3.70.03&t-q=2026-Q3'});await h.wait('debates and dossiers');const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent.includes('debates and dossiers'));assert(link);await act(async()=>link.click());const heading=h.node.querySelector('#topic-records h2');assert(heading.textContent.includes(link.textContent),heading.textContent);const back=heading.parentElement.querySelector('a');assert(back.textContent.includes('Back to the sentence'));assert.equal(heading.textContent,link.textContent);assert.equal(back.previousSibling.textContent,' ');await act(async()=>back.click());assert.equal(document.activeElement.id,link.id);
});
test('document history Back restores the originating rendered story link and selection',async t=>{
 const origin='?view=geopolitics&place=IRN&t-q=2026-Q1&t-mode=d&t-zoom=eu&t-own=0',h=await harness(t,{component:'Topics',url:origin});await h.wait('Exact adopted text 1');const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent==='Exact adopted text 1');assert(link);const id=link.id;await act(async()=>link.click());await h.wait(sourceDocuments[0].title);const state={storyLinkId:id,storyScroll:0};let backCalls=0;t.mock.method(history,'back',()=>{backCalls++;history.replaceState(state,'',origin);window.dispatchEvent(new window.PopStateEvent('popstate'));});await act(async()=>h.node.querySelector('.topic-story-records > a').click());await h.wait('Exact adopted text 1');assert.equal(backCalls,1);assert.equal(document.activeElement.id,id);for(const[k,v]of Object.entries({'t-mode':'d','t-zoom':'eu','t-own':'0'}))assert.equal(new URL(location.href).searchParams.get(k),v);
});
test('a directly shared EU set preserves the key selection in its Back URL',async t=>{
 const key='urgency-debates:map:2026-Q1:not-home:zoom=eu:mode=d:n=2',h=await harness(t,{component:'TopicStoryRecords',url:'?view=geopolitics&t-records='+encodeURIComponent(key),props:{selection:{...selection,mode:'q',zoom:'world',excludeOwn:false,period:'2026-Q1'}}});await h.wait('2 urgency debates on human rights');const back=new URL(h.node.querySelector('.topic-story-records > a').href);assert.equal(back.searchParams.get('t-mode'),'d');assert.equal(back.searchParams.get('t-zoom'),'eu');assert.equal(back.searchParams.get('t-own'),'1');
});

test('a rendered claim never shrinks when its complete set contains fewer IDs than advertised',async t=>{
 const h=await harness(t,{props:{selection:{...selection,period:'2025-Q3'}},respond:(u,q)=>{if(q?.scope==='map'){const f=mapLinkFacts(q);f.sets.urgencyDebates['2025-Q3']=f.sets.urgencyDebates['2025-Q3'].slice(0,7);return f;}}});await h.wait('Eight urgency debates');const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent==='Eight urgency debates');assert(link);const key=new URL(link.href).searchParams.get('t-records');assert.equal(parseStorySetKey(key).expected,8);await act(async()=>{history.pushState({},'',link.href);window.dispatchEvent(new window.PopStateEvent('popstate'));});await h.wait('Records unavailable.');assert.equal(h.node.querySelectorAll('article').length,0);assert(!h.node.textContent.includes('7 urgency debates'));
});

for(const baseline of [false,true])test('policy record headings and onward names retain label language'+(baseline?' on baselines':''),async t=>{
 const period=baseline?'2025-Q1,2025-Q2':'2025-Q1',key=storySetKey({text:'',records:[],browse:{list:'questions',periods:baseline?period:undefined}},{topic:'oeil:8.20',period:'2025-Q1'});
 const h=await harness(t,{component:'TopicStoryRecords',url:'?view=legislation&pl-mode=topics&topic=oeil:8.20&t-records='+encodeURIComponent(key),props:{selection:{...selection,topic:'oeil:8.20'}},respond:u=>{if(u.pathname==='/api/topics/detail'){const d=topicLinkDetail('oeil:8.20');d.concept={...d.concept,label:'Politique climatique',labelLanguage:'fr'};return d;}}});await h.wait('Politique climatique');await h.wait(baseline?'before':'questions about');assert.equal(h.node.querySelector('h1 [lang=fr]').textContent,'Politique climatique');assert.equal(h.node.querySelector('.topic-story-records > p:last-child a [lang=fr]').textContent,'Politique climatique');
});
test('tie headings carry each source name as a language-tagged element',async t=>{
 const key='questions:COL%2CTUR:2025-Q3:all',h=await harness(t,{component:'TopicStoryRecords',url:'?view=geopolitics&t-records='+encodeURIComponent(key),props:{selection:{...selection,labels:{}}},respond:u=>u.pathname==='/api/topics/overview'?{ready:true,items:[{id:'COL',key:'place:COL',label:'Colombie',labelLanguage:'fr'},{id:'TUR',key:'place:TUR',label:'Turquie',labelLanguage:'fr'}]}:undefined});await h.wait('questions each on');assert.equal(h.node.querySelectorAll('h1 [lang=fr]').length,2);assert.equal(h.node.querySelectorAll('h2 [lang=fr]').length,2);assert.equal(h.node.querySelectorAll('section > a [lang=fr]').length,2);
});
test('a place heading never exposes its raw code or takes focus before names arrive',async t=>{
 let release;const pending=new Promise(r=>release=r);t.after(()=>release(topicLinkDetail('place:TUR')));
 const h=await harness(t,{component:'TopicStoryRecords',url:'?view=geopolitics&t-records='+encodeURIComponent('questions:TUR:2025-Q4:elsewhere'),props:{selection:{...selection,labels:{}}},respond:u=>u.pathname==='/api/topics/detail'?pending:undefined});await act(async()=>new Promise(r=>setTimeout(r,30)));assert(!h.node.querySelector('h1'));assert(!h.node.textContent.includes('about TUR'));await act(async()=>release(topicLinkDetail('place:TUR')));await h.wait('questions about Türkiye');assert.equal(document.activeElement,h.node.querySelector('h1'));
});
test('the publication reader labels plenary documents as documents',async t=>{
 const h=await harness(t,{component:'TopicStoryDocument',props:{selection:{...selection,place:'IRN'},id:sourceDocuments[0].id}});await h.wait(sourceDocuments[0].title);assert.equal(h.node.querySelector('.insight-reader-heading h3').textContent,'Document');
});
for(const list of ['documents','urgency-debates','places'])test('non-question '+list+' set meta contains only its period',async t=>{
 const scope=list==='documents'?'IRN':'map',key=list+':'+scope+':2026-Q3:not-home',h=await harness(t,{component:'TopicStoryRecords',url:'?view=geopolitics&t-records='+encodeURIComponent(key),props:{selection:{...selection,...(scope==='IRN'?{place:scope}:{})}}});assert.match(h.node.querySelector('.topic-story-records > p').textContent,/^July\s*–\s*September 2026$/);
});
test('fallback Texts counts never link the broader overview count to a narrower story set',async t=>{
 const h=await harness(t,{component:'TopicStory',props:{data:{periods:['2026-Q3'],partial:{},items:[{key:'place:IRN',label:'Iran',series:[{period:'2026-Q3',document:12}]}]},index:0,mode:'d',own:true}});assert(h.node.textContent.includes('12'));assert.equal(h.node.querySelectorAll('a').length,0);
});
test('place lists sort by localized names rather than authority codes',async t=>{
 const h=await harness(t,{component:'TopicStoryRecords',url:'?view=geopolitics&t-records='+encodeURIComponent('places:map:2026-Q3:all'),props:{selection:{...selection,labels:{DEU:'Germany',FRA:'France'}}},respond:(u,q)=>{if(q?.scope==='map'){const f=mapLinkFacts(q);f.series={DEU:{'2026-Q3':{adoptedTexts:1}},FRA:{'2026-Q3':{adoptedTexts:1}}};return f;}}});await h.wait('Showing 2 of 2');assert.deepEqual([...h.node.querySelectorAll('summary')].map(s=>s.textContent),['France','Germany']);
});
test('rise links use the destination heading as their accessible name',async t=>{
 const h=await harness(t,{props:{selection}});await h.wait('Questions about Colombia');const about=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent==='Questions about Colombia');assert(about.getAttribute('aria-label')?.includes('13 questions about Colombia'));

});

test('peak quarter references include their period in the link identity',async t=>{
 const h=await harness(t,{props:{selection:{...selection,place:'GRC',period:undefined}},respond:(u,q)=>{if(q?.scope==='place'){const f=placeLinkFacts('GRC');f.periodCounts.forEach(r=>r.debateSpeakerAppearances=['2025-Q1','2025-Q2'].includes(r.period)?9:0);return f;}}});await h.wait('January');const links=[...h.node.querySelectorAll('.topic-story a')].filter(a=>/January.*March 2025|April.*June 2025/.test(a.textContent));assert.equal(links.length,2);assert.equal(new Set(links.map(a=>a.id)).size,2);
});

for(const change of ['kind','quarter','origin','facet','summary'])test('changing '+change+' clears the claim heading and its sentence return link',async t=>{
 const base='?view=legislation&pl-mode=topics&topic=oeil:9.99&t-q=2026-Q3&t-own=0',h=await harness(t,{component:'Topics',url:base,respond:u=>{if(u.pathname==='/api/topics/detail'){const d=topicLinkDetail('oeil:9.99');d.facets.keywords=[{key:'eurovoc:245',label:'Research',n:4}];return d;}}});await h.wait('debates and dossiers');const claim=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent.includes('debates and dossiers'));await act(async()=>claim.click());assert.equal(h.node.querySelector('#topic-records h2').textContent,claim.textContent);assert(h.node.querySelector('#topic-records > a'));
 await act(async()=>{if(change==='kind'){const select=h.node.querySelector('.topic-kind select');select.value='question';select.dispatchEvent(new window.Event('change',{bubbles:true}));}else if(change==='quarter'){const bars=h.node.querySelectorAll('.topic-bars button');bars[1].click();}else if(change==='facet')h.node.querySelector('.topic-facets a').click();else if(change==='summary')h.node.querySelector('.topic-detail-header p a').click();else{const u=new URL(location.href);u.searchParams.set('t-askers','elsewhere');history.replaceState({},'',u);window.dispatchEvent(new window.PopStateEvent('popstate'));}});
 assert(!h.node.querySelector('#topic-records h2').textContent.includes('debates and dossiers'));assert(!h.node.querySelector('#topic-records > a'));
 await act(async()=>{history.replaceState({},'',base);window.dispatchEvent(new window.PopStateEvent('popstate'));});assert(!h.node.querySelector('#topic-records h2').textContent.includes('debates and dossiers'),'returning to old filters must not resurrect the claim');
});
for(const fallback of [false,true])test((fallback?'fallback':'exact')+' links restore the main scroll container and keep origin state out of later navigation',async t=>{
 const origin='?view=geopolitics&t-q=2026-Q3&t-own=0',h=await harness(t,{component:'Topics',fresh:true,url:origin,respond:(u,q)=>{if(fallback&&u.pathname==='/api/topics/overview')return {ready:true,periods:storyPeriods,partial:{},items:[{key:'place:TUR',id:'TUR',iso3:'TUR',label:'Türkiye',series:storyPeriods.map(period=>({period,question:4,document:0,questionHome:0}))}]};if(fallback&&q?.scope==='map')return {ready:false};}});
 await h.wait(fallback?'4 questions':'Questions about Colombia');const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent===(fallback?'4 questions':'Questions about Colombia')),id=link.id,container=link.closest('main.explorer-insights');assert(container);container.style.overflowY='auto';container.scrollTop=380;
 const push=history.pushState.bind(history);let originState;t.mock.method(history,'pushState',(...args)=>{originState=history.state;return push(...args);});
 await act(async()=>link.click());await h.wait(fallback?'4 questions about Türkiye':'4 questions about Colombia');assert.equal(originState.storyLinkId,id);assert.equal(originState.storyScroll,380);assert.equal(history.state.storyLinkId,undefined);assert.equal(history.state.storyScroll,undefined);assert.equal(history.state.storyReturn,true);container.scrollTop=900;
 t.mock.method(history,'back',()=>{history.replaceState(originState,'',origin);window.dispatchEvent(new window.PopStateEvent('popstate'));});await act(async()=>h.node.querySelector('.topic-story-records > a').click());await h.wait(fallback?'4 questions':'Questions about Colombia');assert.equal(document.activeElement.id,id);assert.equal(container.scrollTop,380);
 const {navigateDossier}=await load('/src/dossierJourney.ts');navigateDossier('?view=questions');assert.equal(history.state.storyLinkId,undefined);assert.equal(history.state.storyScroll,undefined);assert.equal(history.state.storyReturn,undefined);
});
test('restored links outside the scroll viewport are brought into view',async t=>{
 const h=await harness(t,{props:{selection}});await h.wait('Questions about Colombia');const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent==='Questions about Colombia');history.replaceState({storyLinkId:link.id,storyScroll:300},'');t.mock.method(link,'getBoundingClientRect',()=>({top:-229,bottom:-205}));const seen=[];t.mock.method(link,'scrollIntoView',options=>seen.push(options));const {focusStoryLink}=await load('/src/storyLinkNavigation.ts');focusStoryLink();assert.equal(document.activeElement,link);assert.deepEqual(seen,[{block:'center'}]);
});
test('record dates use month ranges in metadata, baseline headings, rows and compared links',async t=>{
 const key='questions:COL:2026-Q1%2C2026-Q2:all',h=await harness(t,{component:'TopicStoryRecords',url:'?view=geopolitics&place=COL&t-records='+encodeURIComponent(key),props:{selection:{...selection,place:'COL'}}});await h.wait('Questions about Colombia before July 2026');assert.match(h.node.querySelector('.topic-story-records > p').textContent,/January.*June 2026/);const rows=[...h.node.querySelectorAll('summary')].map(r=>r.textContent);assert.match(rows[0],/January.*March 2026/);assert.match(rows[1],/April.*June 2026/);assert([...h.node.querySelectorAll('a')].some(a=>/July.*September 2026/.test(a.textContent)));assert(!h.node.textContent.includes('2026 Q'));
});
test('story link accessible names use the same month ranges as their destination',async t=>{
 const h=await harness(t,{props:{selection}});await h.wait('Questions about Colombia');const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent==='Questions about Colombia');assert.match(link.getAttribute('aria-label'),/13 questions about Colombia, July.*September 2026/);assert(!link.getAttribute('aria-label').includes('Q3'));
});

test('retained story links browse their displayed mode, zoom and authors while replacement facts load',async t=>{
 let release;const pending=new Promise(r=>release=r);
 const h=await harness(t,{fresh:true,props:{selection},respond:async(u,q)=>{if(q?.mode==='d'&&!q.list){await pending;return mapLinkFacts(q);}}});
 await h.wait('Questions about Colombia');
 await h.render({selection:{...selection,mode:'d',zoom:'eu',excludeOwn:false}});
 const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent==='Questions about Colombia');assert(link);
 const target=new URL(link.href);assert.equal(target.searchParams.get('t-mode'),'q');assert.equal(target.searchParams.get('t-zoom'),'world');assert.equal(target.searchParams.get('t-own'),'1');assert.equal(parseStorySetKey(target.searchParams.get('t-records')).askers,'not-home');assert(!h.node.textContent.includes('Joint texts counted once'));
 await act(async()=>link.click());await h.wait('questions about Colombia');
 const request=h.calls.find(u=>u.searchParams.get('list')==='questions');assert(request);assert.equal(request.searchParams.get('askers'),'not-home');assert.equal(request.searchParams.get('mode'),'q');assert.equal(request.searchParams.get('zoom'),'world');
 await act(async()=>release());
});

test('outside names sharing an address each link',async t=>{
 const debateId='MTG-PL-2026-01-21-PVCRE-ITM-5';
 const outside=[{id:'1:'+debateId,personId:'1',name:'Felipe VI',date:'2026-01-21',country:'ESP',debateId},{id:'2:'+debateId,personId:'2',name:'Marcelo Rebelo de Sousa',date:'2026-01-21',country:'PRT',debateId}];
 const h=await harness(t,{fresh:true,props:{selection:{...selection,period:'2026-Q1',labels:{ESP:'Spain',PRT:'Portugal'}}},respond:(_u,q)=>q?{...mapLinkFacts(q),counts:{},periodCounts:[],winners:{},periodWinners:{},sets:{},outsideSpeakers:outside,debates:outside.map(a=>({id:a.debateId,title:'Formal sitting',date:a.date,docs:[],places:[],meps:0}))}:undefined});
 await h.wait('Also in plenary:');const links=[...h.node.querySelectorAll('.topic-story a')];assert.deepEqual(links.map(a=>a.textContent),['Felipe VI','Marcelo Rebelo de Sousa']);assert(links.every(a=>new URL(a.href).searchParams.get('agenda-topic')===debateId));assert.notEqual(links[0].id,links[1].id);assert(!links.some(a=>a.textContent==='Spain'||a.textContent==='Portugal'));
});

test('multiple outside addresses for one exact person remain reachable as a complete record set',async t=>{
 const dates=['2026-01-21','2026-02-24'],ids=dates.map((d,i)=>'MTG-PL-'+d+'-PVCRE-ITM-'+(i+1));
 const payload={...mapLinkFacts(),counts:{},periodCounts:[],winners:{},periodWinners:{},sets:{},outsideSpeakers:ids.map((debateId,i)=>({id:'230786:'+debateId,personId:'230786',name:'Volodymyr Zelenskyy',country:'UKR',date:dates[i],debateId})),debates:ids.map((id,i)=>({id,title:'Address '+i,date:dates[i],docs:[],places:[],meps:0}))};
 const h=await harness(t,{fresh:true,props:{selection:{...selection,period:'2026-Q1'}},respond:(_u,q)=>q?payload:undefined});await h.wait('Volodymyr Zelenskyy');const link=[...h.node.querySelectorAll('.topic-story a')].find(a=>a.textContent==='Volodymyr Zelenskyy');assert(link);const key=new URL(link.href).searchParams.get('t-records');assert.equal(parseStorySetKey(key).ids.split(',').length,2);
 await act(async()=>{history.pushState({},'',link.href);window.dispatchEvent(new window.PopStateEvent('popstate'));});await h.wait('Address 1');assert.equal(h.node.querySelectorAll('.topic-story-records article').length,2);assert(!h.node.textContent.includes('Records unavailable'));
});
