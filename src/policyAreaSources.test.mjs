import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createElement as h,act} from 'react';
import {freshLoader} from './test-support/viteRunner.mjs';
async function harness(t,url='http://localhost/?view=topics'){
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
 await act(async()=>{history.replaceState({},'','?view=topics&topic=oeil%3A9.99');window.dispatchEvent(new window.PopStateEvent('popstate'));root.render(h(Topics,{key:'detail'}));});await wait(()=>node.querySelector('.topic-detail-header h1')?.textContent==='Explorer label');await wait(disclosed);assert.equal(node.querySelectorAll('.policy-area-sources').length,1);assert.equal(sources().open,false);
});

test('French story requests render English titles and a French policy label with separate lang attributes',async t=>{
 const {node,root,load,wait}=await harness(t,'http://localhost/?view=topics&topic=oeil%3A8.20');
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
 await act(async()=>node.querySelector('.explorer-saved-card button').click());await wait(()=>!node.querySelector('.explorer-saved-card'));await wait(()=>!node.querySelector('details').textContent.includes('translated by'));
});
