import test from 'node:test';import assert from 'node:assert/strict';
import {createElement,act,StrictMode,Fragment} from 'react';import {Window} from 'happy-dom';import {createServer} from 'vite';
const baseline={activityVersion:3,activityIdsComplete:true,revision:'old',answerIds:[],latestIds:['old']};
const member=(extra={})=>({kind:'mep',id:'42',title:'Fixture member',savedAt:1,...extra});
const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,390));});
async function harness(t,items=[member()]) {
 const window=new Window({url:'http://localhost/'}),globals={window,document:window.document,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 window.localStorage.setItem('ep.bookmarks.v1',JSON.stringify({version:1,items}));
 const requests=[];let root,vite,fail='',conflict=0;
 let status={epoch:'one',generation:5,marksReady:true,indexComplete:true,publishedAt:null};
 let ids=[['old',0,5]],entries=[];
 t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  const url=new URL(input,window.location.href),route=url.pathname.split('/').at(-1);requests.push({url,route,options});
  if(fail===route)return Response.json({error:{code:'fixture_failure',message:'Fixture unavailable'}},{status:503});
  if(conflict&&route==='following-manifest'){conflict--;return Response.json({error:{code:'generation_changed',message:'Changed'}},{status:409});}
  if(route==='following-status')return Response.json(status);
  if(route==='following-manifest')return Response.json({epoch:status.epoch,generation:status.generation,rosterBasis:'publication',indexComplete:true,members:{42:[status.generation,3,1,0]}});
  if(route==='following-member')return Response.json({epoch:status.epoch,generation:status.generation,member:url.searchParams.get('member'),status:'available',rosterBasis:'publication',ids,entries,truncated:0});
  if(route==='saved')return Response.json({questions:(JSON.parse(options.body).questions||[]).map(id=>({id,status:'available',title:'Question',revision:'one',answers:[]})),coverage:{indexComplete:true}});
  assert.fail('Unexpected route '+url);
 });
 vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {Saved}=await vite.ssrLoadModule('/src/Saved.tsx'),controls=await vite.ssrLoadModule('/src/SavedControls.tsx'),{createRoot}=await import('react-dom/client');
 const container=document.createElement('div');document.body.append(container);root=createRoot(container);
 function Checks({language}){controls.useSavedChecks(language);return null;}
 const render=(language='en',strict=false)=>act(async()=>root.render(createElement(strict?StrictMode:Fragment,null,harness.focusChecks&&createElement(Checks,{language}),createElement(Saved,{language,onBack(){},onMember(){}}))));
 const click=async text=>{await act(async()=>[...container.querySelectorAll('button')].find(x=>x.textContent===text).click());};
 const check=()=>click('Check for updates');
 const background=(force=false,lang='en')=>act(async()=>{await controls.checkSaved(lang,force).catch(()=>{});});
 return {window,container,controls,requests,render,click,check,background,setStatus:extra=>Object.assign(status,extra),setDetail:(next,rich=[])=>{ids=next;entries=rich;},fail:route=>fail=route,conflict:()=>conflict++,item:()=>controls.savedStore.snapshot().items[0],clear:()=>act(async()=>root.render(null))};
}
test('manifest primes archive, later marks remain unresolved until opened; visit acknowledgement uses displayed entries',async t=>{
 const h=await harness(t);await h.render('en',true);await h.check();await settle();assert(!h.item().updated);assert(!h.requests.some(x=>x.route==='following-member'));
 const manifests=h.requests.filter(x=>x.route==='following-manifest').length;await h.check();assert.equal(h.requests.filter(x=>x.route==='following-manifest').length,manifests,'unchanged generation does no manifest work');
 h.setStatus({generation:6});h.setDetail([['old',0,5],['late',0,6]],[{id:'late',title:'Late speech',titleLanguage:'fr',date:'2026-01-01',kind:'activity',mark:6}]);
 await h.check();assert.match(h.container.textContent,/New activity — open to see/);assert.equal(h.container.querySelectorAll('article a').length,0);
 await h.click('Open updates');assert.match(h.container.textContent,/Late speech/);assert.equal(h.item().seen.activity,6);await h.render('en',true);assert(h.item().updated);
 await h.clear();assert(!h.item().updated);await h.render();assert.equal(h.container.querySelectorAll('article a').length,0);
});
test('marksReady false never baselines or announces zero; readiness and generation conflicts recover explicitly',async t=>{
 const h=await harness(t);h.setStatus({marksReady:false});await h.render();await h.check();await settle();assert.equal(h.item().seen,null);assert.match(h.container.textContent,/Update checks are not available yet/);assert.doesNotMatch(h.container.textContent,/No unread|No new updates/);
 h.setStatus({marksReady:true});h.conflict();await h.check();assert.equal(h.item().seen.activity,5);assert.equal(h.requests.filter(x=>x.route==='following-status').length,3);assert(!h.requests.some(x=>x.route==='saved'));
});
test('failed migration and question tasks retry in the same generation without repeating successful work',async t=>{
 const q={kind:'question',id:'E-10-2026-003031',title:'Question'},h=await harness(t,[member({baseline}),q]);await h.render();h.fail('following-member');await h.check();assert(h.item().legacy);assert.match(h.container.textContent,/Update check pending/);
 const posts=h.requests.filter(x=>x.route==='saved');assert.equal(posts.length,1);assert.equal(posts[0].options.method,'POST');assert.equal(posts[0].url.searchParams.has('questions'),false);assert.equal(posts[0].url.searchParams.has('members'),false);
 h.fail('');h.setDetail([['old',0,5],['late',0,5]]);await h.click('Retry');assert(!h.item().legacy);assert.equal(h.item().unread[0].id,'late');assert.equal(h.requests.filter(x=>x.route==='saved').length,1);
 await h.background(false,'fr');assert.equal(h.requests.filter(x=>x.route==='saved').length,2,'language participates in task completion');
});
test('focus checks status at most once per minute; failed tasks retry without a generation change',async t=>{
 harness.focusChecks=true;t.after(()=>harness.focusChecks=false);const h=await harness(t,[member({baseline})]);await h.render();h.fail('following-member');await h.background();
 let now=Date.now();t.mock.method(Date,'now',()=>now);const count=()=>h.requests.filter(x=>x.route==='following-status').length,initial=count();
 await act(async()=>h.window.dispatchEvent(new h.window.Event('focus')));assert.equal(count(),initial);
 now+=60_001;h.fail('');await act(async()=>h.window.dispatchEvent(new h.window.Event('focus')));assert.equal(count(),initial+1);assert(!h.item().legacy);
});
test('background storage failure keeps unread visible with retry banner; failed toggle reverts with alert',async t=>{
 const h=await harness(t);await h.render();await h.check();const prototype=h.window.localStorage,original=prototype.setItem;
 t.mock.method(prototype,'setItem',function(...args){if(this===h.window.localStorage)throw Object.assign(Error('full'),{name:'QuotaExceededError'});return original.apply(this,args);});
 h.setStatus({generation:6});h.setDetail([['late',0,6]]);await h.check();await h.click('Open updates');assert.equal(h.item().unread[0].id,'late');assert.match(h.container.querySelector('[role="alert"]').textContent,/will be lost on reload/);
 const toggle=h.container.querySelector('article .explorer-save-button');await act(async()=>toggle.click());assert.equal(h.controls.savedStore.snapshot().items.length,1);assert.match(h.container.textContent,/follow change was not kept/);
 t.mock.restoreAll();await h.click('Retry saving');assert.equal(h.controls.savedStore.snapshot().storageError,null);
});
test('empty Following makes no requests; omitted count links to activity and epoch reset keeps unread',async t=>{
 const h=await harness(t,[]);await h.render();assert(h.container.querySelector('.explorer-saved-heading button').disabled);assert.equal(h.requests.length,0);
 await act(async()=>h.controls.savedStore.toggle(member()));await h.background();
 h.setStatus({generation:6});h.setDetail(Array.from({length:202},(_,i)=>['id-'+i,0,6]));await h.check();await h.click('Open updates');assert.match(h.container.textContent,/\+2 more not listed/);assert.match(h.container.querySelector('a').href,/module=activities/);
 h.setStatus({epoch:'two',generation:1});await h.check();assert.equal(h.item().unread.length,200);assert.match(h.container.textContent,/Update tracking restarted/);
});
