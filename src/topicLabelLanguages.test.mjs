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

test('French story requests render English titles and a French policy label with separate lang attributes',async t=>{
 const {node,root,load,wait}=await harness(t,'http://localhost/?view=legislation&pl-mode=topics&topic=oeil%3A8.20');
 const {createAppUiI18n}=await import('./uiCatalogues.mjs'),i18n=createAppUiI18n();
 const payload={ready:true,counts:{groups:2,adoptedTexts:1},periodCounts:[],periodWinners:{},winners:{headlineAdoptedTexts3Plus:[{id:'RC-10-2025-0010',debateMeps:5}]},sets:{},questions:[],debates:[],docs:[{id:'RC-10-2025-0010',type:'RESOLUTION_MOTION_JOINT',title:'JOINT MOTION FOR A RESOLUTION on English motion',date:'2025-03-12',places:[],keywords:[],groups:[],procedures:[],outcome:{outcome:'ADOPTED',date:'2025-03-12',for:100,against:20}}],topic:{key:'oeil:8.20',label:"Elargissement de l'Union",labelLanguage:'fr'}};
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);assert.equal(u.searchParams.get('lang'),'fr');return Response.json(payload);});
 const {TopicStories}=await load('/src/TopicStories.tsx'),{UiI18nProvider}=await load('/src/UiI18nReact.tsx');await act(async()=>root.render(h(UiI18nProvider,{i18n,language:'fr'},h(TopicStories,{selection:{periods:[],topic:'oeil:8.20'}}))));
 await wait(()=>node.querySelector('i[lang=en]'));assert.equal(node.querySelector('i[lang=en]').textContent,'English motion');assert.equal(node.querySelector('span[lang=fr]').textContent,"Elargissement de l'Union");
});

test('followed policy labels keep their language with no inline provenance',async t=>{
 const {node,root,load,wait}=await harness(t);
 localStorage.setItem('ep.following.topics.v1',JSON.stringify([{key:'oeil:9.99',label:'Magyar név',labelLanguage:'hu',labelSource:'explorer-translation'}]));
 const {FollowedTopics}=await load('/src/TopicFollowing.tsx');
 await act(async()=>root.render(h(FollowedTopics)));
 await wait(()=>node.querySelector('h2 a'));
 assert.equal(node.querySelector('h2 a').getAttribute('lang'),'hu');assert(!node.textContent.includes('translated by'));assert(!node.querySelector('details'));
 await act(async()=>node.querySelector('.explorer-saved-card button').click());await wait(()=>!node.querySelector('.explorer-saved-card'));
});




test('fallback story titles and their opened records carry the actual French language',async t=>{
 const {node,root,load,wait}=await harness(t,'http://localhost/?view=legislation&pl-mode=topics&topic=oeil%3A9.99');
 const payload={ready:true,counts:{groups:1,adoptedTexts:1},periodCounts:[],periodWinners:{},winners:{headlineAdoptedTexts3Plus:[{id:'R',debateMeps:5}]},sets:{},questions:[],debates:[],docs:[{id:'R',type:'REPORT',title:'Titre français',titleLanguage:'fr',date:'2025-03-12',places:[],keywords:[],groups:[],procedures:[],outcome:{outcome:'ADOPTED',for:100,against:20}}],topic:{key:'oeil:9.99',label:'Policy',labelLanguage:'en'}};
 t.mock.method(globalThis,'fetch',async input=>new URL(String(input),location.href).pathname==='/api/topics/story-facts'?Response.json(payload):Response.json({error:{message:'Fixture body unavailable'}},{status:503}));const {TopicStories}=await load('/src/TopicStories.tsx');await act(async()=>root.render(h(TopicStories,{selection:{periods:[],topic:'oeil:9.99'}})));
 await wait(()=>node.querySelector('i[lang=fr]'));assert.equal(node.querySelector('i[lang=fr]').textContent,'Titre français');
 await act(async()=>node.querySelector('i[lang=fr]').closest('a').click());assert.equal(new URLSearchParams(location.search).get('t-record'),'R');const {TopicStoryDocument}=await load('/src/TopicStories.tsx');await act(async()=>root.render(h(TopicStoryDocument,{selection:{periods:[],topic:'oeil:9.99'},id:'R'})));await wait(()=>node.querySelector('.topic-story-records article a[lang=fr]'));assert.equal(node.querySelector('.topic-story-records article a[lang=fr]').textContent,'Titre français');
});


test('cold topic details mark pending until the response settles, including an unavailable response',async t=>{
 const {node,root,load,wait}=await harness(t,'http://localhost/?view=legislation&pl-mode=topics&topic=oeil%3A9.99');
 let release;const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release?.());
 t.mock.method(globalThis,'fetch',async()=>{await gate;throw new Error('Unavailable');});
 const {Topics}=await load('/src/Topics.tsx');await act(async()=>root.render(h(Topics,{})));
 await wait(()=>node.querySelector('[data-topics-pending="true"]'));
 release();await wait(()=>node.querySelector('.insight-error'));
 assert.equal(node.querySelector('[data-topics-pending="true"]'),null);
});
