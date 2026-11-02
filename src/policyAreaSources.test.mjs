import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createElement as h,act} from 'react';
import {freshLoader} from './test-support/viteRunner.mjs';
async function harness(t,url='http://localhost/?view=legislation&pl-mode=topics'){// these tests cover the heat strip; Topics opens on Places by default
 const window=new Window({url}),globals={window,localStorage:window.localStorage,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'policy-area-sources'}),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);const root=createRoot(node);
 t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const wait=async predicate=>{for(let i=0;i<80&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(predicate(),node.textContent);};
 return {node,root,load,wait};
}
test('one collapsed page disclosure tracks only visible heat-strip, finder and detail labels',async t=>{
 const {node,root,load,wait}=await harness(t);
 const translated={key:'oeil:9.99',label:'Explorer label',labelLanguage:'hu',labelSource:'explorer-translation'};
 const series=[{period:'2026-Q1',groups:2,question:1,document:1,debate:0,speech:0,vote:0}],items=Array.from({length:21},(_,i)=>({...(i===20?translated:{key:'oeil:9.99.'+i,label:'Official '+i}),total:21-i,groupsTotal:21-i,counts:{question:1},series}));
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);if(u.pathname==='/api/topics/overview')return Response.json({ready:true,items,periods:['2026-Q1'],partial:{}});if(u.pathname==='/api/topics/search')return Response.json({ready:true,results:[{...translated,role:'topic',counts:{}}]});if(u.pathname==='/api/topics/detail')return Response.json({ready:true,concept:translated,series,periods:['2026-Q1'],partial:{},groupsTotal:2,total:2,groups:[],facets:{topics:[],keywords:[],places:[]},nextOffset:null});return Response.json({ready:false});});
 const {Topics}=await load('/src/Topics.tsx');await act(async()=>root.render(h(Topics,{})));await wait(()=>node.querySelectorAll('.topic-heat tbody tr').length===20);
 const sources=()=>node.querySelector('.policy-area-sources'),disclosed=()=>sources()?.textContent.includes('translated by the explorer');
 assert.equal(node.querySelectorAll('.policy-area-sources').length,1);assert.equal(sources().open,false);assert(sources().querySelector('a').textContent==='Legislative Observatory');assert(!disclosed());
 const input=node.querySelector('.topic-finder input');await act(async()=>input.focus());await wait(()=>node.querySelector('[role=option]'));await wait(disclosed);assert.equal(sources().open,false);
 await act(async()=>input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await wait(()=>!disclosed());
 const all=[...node.querySelectorAll('button')].find(b=>b.textContent==='Show all');assert(all);await act(async()=>all.click());await wait(()=>node.querySelectorAll('.topic-heat tbody tr').length===21);await wait(disclosed);
 await act(async()=>{history.replaceState({},'','?view=legislation&pl-mode=topics&topic=oeil%3A9.99');window.dispatchEvent(new window.PopStateEvent('popstate'));root.render(h(Topics,{key:'detail'}));});await wait(()=>node.querySelector('.topic-detail-header h1')?.textContent==='Explorer label');await wait(disclosed);assert.equal(node.querySelectorAll('.policy-area-sources').length,1);assert.equal(sources().open,false);
});

test('French story requests render English titles and a French policy label with separate lang attributes',async t=>{
 const {node,root,load,wait}=await harness(t,'http://localhost/?view=legislation&pl-mode=topics&topic=oeil%3A8.20');
 const {createAppUiI18n}=await import('./uiCatalogues.mjs'),i18n=createAppUiI18n();
 const payload={ready:true,counts:{groups:2,adoptedTexts:1},periodCounts:[],periodWinners:{},winners:{headlineAdoptedTexts3Plus:[{id:'RC-10-2025-0010',debateMeps:5}]},sets:{},questions:[],debates:[],docs:[{id:'RC-10-2025-0010',type:'RESOLUTION_MOTION_JOINT',title:'JOINT MOTION FOR A RESOLUTION on English motion',date:'2025-03-12',places:[],keywords:[],groups:[],procedures:[],outcome:{outcome:'ADOPTED',date:'2025-03-12',for:100,against:20}}],topic:{key:'oeil:8.20',label:"Elargissement de l'Union",labelLanguage:'fr'}};
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);assert.equal(u.searchParams.get('lang'),'fr');return Response.json(payload);});
 const {TopicStories}=await load('/src/TopicStories.tsx'),{UiI18nProvider}=await load('/src/UiI18nReact.tsx');await act(async()=>root.render(h(UiI18nProvider,{i18n,language:'fr'},h(TopicStories,{selection:{periods:[],topic:'oeil:8.20'}}))));
 await wait(()=>node.querySelector('i[lang=en]'));assert.equal(node.querySelector('i[lang=en]').textContent,'English motion');assert.equal(node.querySelector('span[lang=fr]').textContent,"Elargissement de l'Union");
});

test('followed policy labels use the single page disclosure with no inline provenance',async t=>{
 const {node,root,load,wait}=await harness(t);
 localStorage.setItem('ep.following.topics.v1',JSON.stringify([{key:'oeil:9.99',label:'Magyar név',labelLanguage:'hu',labelSource:'explorer-translation'}]));
 const {FollowedTopics}=await load('/src/TopicFollowing.tsx'),{PolicyAreaSourcesPage}=await load('/src/PolicyAreaSources.tsx');
 await act(async()=>root.render(h(PolicyAreaSourcesPage,{},h(FollowedTopics))));
 await wait(()=>node.querySelector('.policy-area-sources')?.textContent.includes('translated by the explorer'));
 assert.equal(node.querySelector('h2 a').getAttribute('lang'),'hu');assert(!node.querySelector('.explorer-saved-card').textContent.includes('translated by'));
 assert.equal(node.querySelectorAll('details').length,1);assert.equal(node.querySelector('details').open,false);
 await act(async()=>node.querySelector('.explorer-saved-card button').click());await wait(()=>!node.querySelector('.explorer-saved-card'));await wait(()=>!node.querySelector('details'));
});

test('Sources stays absent for loading, unavailable and Places, and appears for place-detail policy facets',async t=>{
 const {node,root,load,wait}=await harness(t,'http://localhost/?view=geopolitics');let release,requested=false,ready=false;
 const gate=new Promise(r=>release=r);
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);if(u.pathname==='/api/topics/overview'){if(!ready){requested=true;await gate;return Response.json({ready:false});}return Response.json({ready:true,items:[],periods:['2026-Q1'],partial:{}});}if(u.pathname==='/api/topics/detail')return Response.json({ready:true,concept:{key:'place:HUN',label:'Hungary',iso3:'HUN'},series:[],periods:['2026-Q1'],partial:{},groupsTotal:0,total:0,groups:[],facets:{topics:[{key:'oeil:9.99',label:'Policy facet',n:1}],keywords:[],places:[]},nextOffset:null});return Response.json({ready:false});});
 const {Topics}=await load('/src/Topics.tsx');await act(async()=>root.render(h(Topics,{})));await wait(()=>requested);assert(!node.querySelector('.policy-area-sources'));
 await act(async()=>release());await wait(()=>node.textContent.includes('Unavailable'));assert(!node.querySelector('.policy-area-sources'));
 ready=true;await act(async()=>root.render(h(Topics,{key:'ready',language:'fr'})));await wait(()=>node.querySelector('.places-layout'));assert(!node.querySelector('.policy-area-sources'));
 await act(async()=>{history.replaceState({},'','?view=geopolitics&place=HUN');window.dispatchEvent(new window.PopStateEvent('popstate'));root.render(h(Topics,{key:'detail',language:'fr'}));});await wait(()=>node.querySelector('.topic-facets a')?.textContent.includes('Policy facet'));await wait(()=>node.querySelector('.policy-area-sources'));
});

test('Sources gating keeps the provider, child DOM, input value and focus mounted',async t=>{
 const {node,root,load,wait}=await harness(t),{PolicyAreaSourcesPage,PolicyAreaLabelUsage}=await load('/src/PolicyAreaSources.tsx');
 const render=enabled=>root.render(h(PolicyAreaSourcesPage,{enabled},h('section',{},h(PolicyAreaLabelUsage,{labels:[{key:'oeil:9.99',label:'Policy'}]}),h('input',{defaultValue:'Original'}))));
 await act(async()=>render(false));const section=node.querySelector('section'),input=node.querySelector('input');input.value='Edited';input.focus();assert(!node.querySelector('details'));
 await act(async()=>render(true));await wait(()=>node.querySelector('details'));assert.equal(node.querySelector('section'),section);assert.equal(node.querySelector('input'),input);assert.equal(input.value,'Edited');assert.equal(document.activeElement,input);
 await act(async()=>render(false));assert(!node.querySelector('details'));assert.equal(node.querySelector('input'),input);assert.equal(document.activeElement,input);
});

test('keyword-page TopicLines can disclose policy areas while a keyword alone cannot',async t=>{
 const {node,root,load,wait}=await harness(t),{PolicyAreaSourcesPage,PolicyAreaLabelUsage}=await load('/src/PolicyAreaSources.tsx'),{TopicLine}=await load('/src/RecordTopics.tsx');
 const children=show=>h(PolicyAreaSourcesPage,{},h(PolicyAreaLabelUsage,{labels:[{key:'eurovoc:245',label:'Keyword'}]}),show?h(TopicLine,{record:{id:'B-10-2026-1',status:'classified',topics:[{key:'oeil:9.99',label:'Policy',labelSource:'explorer-translation'}],keywords:[],places:[]}}):null);
 await act(async()=>root.render(children(false)));assert(!node.querySelector('details'));await act(async()=>root.render(children(true)));await wait(()=>node.querySelector('details')?.textContent.includes('translated by'));assert.equal(node.querySelectorAll('details').length,1);
});

test('fallback story titles and their opened records carry the actual French language',async t=>{
 const {node,root,load,wait}=await harness(t,'http://localhost/?view=legislation&pl-mode=topics&topic=oeil%3A9.99');
 const payload={ready:true,counts:{groups:1,adoptedTexts:1},periodCounts:[],periodWinners:{},winners:{headlineAdoptedTexts3Plus:[{id:'R',debateMeps:5}]},sets:{},questions:[],debates:[],docs:[{id:'R',type:'REPORT',title:'Titre français',titleLanguage:'fr',date:'2025-03-12',places:[],keywords:[],groups:[],procedures:[],outcome:{outcome:'ADOPTED',for:100,against:20}}],topic:{key:'oeil:9.99',label:'Policy',labelLanguage:'en'}};
 t.mock.method(globalThis,'fetch',async input=>new URL(String(input),location.href).pathname==='/api/topics/story-facts'?Response.json(payload):Response.json({error:{message:'Fixture body unavailable'}},{status:503}));const {TopicStories}=await load('/src/TopicStories.tsx');await act(async()=>root.render(h(TopicStories,{selection:{periods:[],topic:'oeil:9.99'}})));
 await wait(()=>node.querySelector('i[lang=fr]'));assert.equal(node.querySelector('i[lang=fr]').textContent,'Titre français');
 await act(async()=>node.querySelector('i[lang=fr]').closest('a').click());assert.equal(new URLSearchParams(location.search).get('t-record'),'R');const {TopicStoryDocument}=await load('/src/TopicStories.tsx');await act(async()=>root.render(h(TopicStoryDocument,{selection:{periods:[],topic:'oeil:9.99'},id:'R'})));await wait(()=>node.querySelector('.topic-story-records article a[lang=fr]'));assert.equal(node.querySelector('.topic-story-records article a[lang=fr]').textContent,'Titre français');
});
