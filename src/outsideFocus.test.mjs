import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const day='2026-10-07',source={url:'https://data.europarl.europa.eu/fixture',fetchedAt:'2026-10-16T12:00:00Z'};
const coverage={complete:true,pending:0,unresolved:0,gaps:0,truncated:false,initialized:true,generation:1,updatedAt:source.fetchedAt,tasks:[],source:'Public fixture'};
const detail=id=>({person:{id,name:'Fixture speaker '+id,role:'Guest speaker',capacity:'other',contributions:1,appearances:1,unlinkedContributions:0,sittingDays:1,first:day,last:day,terms:[10],days:[{date:day,contributions:1,itemIds:['exact-agenda-'+id],items:[{id:'exact-agenda-'+id,kind:'PLENARY_DEBATE',legislative:false}],formal:false,legislative:false}],roles:['Guest speaker'],roleConflicts:[]},contributions:[{id:'MTG-PL-'+day+'-OTH-'+id,personId:id,date:day,term:10,start:null,end:null,titles:{en:'Fixture contribution '+id},parentIds:['exact-agenda-'+id],documentId:null,parentDocumentId:null,reference:'Exact reference '+id,originalLanguages:['en'],websiteUrl:null,websiteLanguage:null,header:{personId:id,name:'Fixture speaker '+id,role:'Guest speaker',languageTag:'en',original:true,capacity:'other'},source,rosterSource:{date:day,sources:[source]}}],agendas:[{id:'exact-agenda-'+id,date:day,titles:{en:'Fixture agenda '+id},kind:'PLENARY_DEBATE',procedureIds:[],procedures:[],source}],coSpeakers:[],coverage});

async function harness(t,query='?view=outside') {
  const window=new Window({url:'http://localhost/'+query,settings:{disableIframePageLoading:true,disableCSSFileLoading:true}}),requests=[];
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:class {observe(){} disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  // Happy DOM has no layout. Every unhidden local fixture control has a box;
  // the production selector still performs its visibility/negative-index checks.
  window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{width:20,height:20}];};
  const scrolls=[],focusScrollEvents=[],nativeFocus=window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus=function(options){focusScrollEvents.push({kind:'focus',element:this,options});nativeFocus.call(this,options);};
  window.scrollTo=(...args)=>scrolls.push(args);window.HTMLElement.prototype.scrollTo=function(options){scrolls.push(options);focusScrollEvents.push({kind:'reset',element:this,options});};
  window.HTMLElement.prototype.scrollIntoView=function(options){focusScrollEvents.push({kind:'reveal',element:this,options});};
  let loadModule,root;const extraRoots=[];
  t.after(async()=>{for(const nested of extraRoots)await act(async()=>nested.unmount());if(root)await act(async()=>root.unmount());for(const request of requests)if(!request.finished)request.resolve(Response.json({}));if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const directory={term:'10',people:['42','43'].map(id=>detail(id).person),coverage};
  t.mock.method(globalThis,'fetch',input=>{const url=new URL(input,location.href);if(url.pathname.endsWith('/references'))return Promise.resolve(Response.json({references:[{key:'question:E-2026-003031',kind:'question',status:'found',id:'E-10-2026-003031',title:'Fixture referenced question'}]}));assert.match(url.pathname,/\/api\/(outside|speech)\//,'outside focus checks are limited to isolated outside and speech fixtures');if(url.pathname.endsWith('/directory'))return Promise.resolve(Response.json(directory));return new Promise((resolve,reject)=>requests.push({url,resolve,reject,finished:false}));});
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {OutsideVoices}=await loadModule('/src/OutsideVoices.tsx'),{ReferenceScope,ReferenceText}=await loadModule('/src/References.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(createElement(OutsideVoices,{language:'en',onBack(){}})));
  const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text);
  const click=async target=>{const node=typeof target==='string'?button(target):target;assert(node,'Missing button '+target);await act(async()=>{node.focus();node.click();});return node;};
  const finish=(id,error=false,extra={})=>act(async()=>{const request=requests.find(request=>!request.finished&&request.url.pathname.endsWith('/'+id));assert(request,'Missing outside detail '+id);request.finished=true;error?request.reject(new Error('Fixture unavailable.')):request.resolve(Response.json({...detail(id),...extra}));});
  const navigate=query=>act(async()=>{history.replaceState(null,'','/'+query);window.dispatchEvent(new window.PopStateEvent('popstate'));});
  const key=(key,shiftKey=false)=>act(async()=>{const event=new window.KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true});document.activeElement.dispatchEvent(event);return event;});
  const mountReference=async()=>{const host=document.createElement('div');container.querySelector('.ov-drawer .ov-contribution').append(host);const nested=createRoot(host);extraRoots.push(nested);const text='See question E-003031/2026.';await act(async()=>nested.render(createElement(ReferenceScope,{texts:[text],language:'en'},createElement('p',null,createElement(ReferenceText,{text})))));return host.querySelector('button.legal-ref');};
  return {window,container,requests,scrolls,focusScrollEvents,button,click,finish,navigate,key,mountReference};
}

test('speaker intent focuses a retained pending Back control, arrival keeps it, and Back restores the exact directory speaker',async t=>{
  const h=await harness(t,'?view=outside&ov-q=Fixture&ov-group=other');const original=h.container.querySelector('[data-ov-focus="person:42"]');await h.click(original);
  const back=h.container.querySelector('.ov-back');assert.equal(document.activeElement,back);assert.equal(h.container.querySelector('.ov-person-heading'),null);
  await h.finish('42');assert.equal(h.container.querySelector('.ov-back'),back,'the pending destination control survives completion');assert.equal(document.activeElement,back,'data completion never moves focus again');
  assert.equal(h.container.querySelector('.ov-person-heading h2').textContent,'Fixture speaker 42');await h.click(back);
  const restored=h.container.querySelector('[data-ov-focus="person:42"]');assert.equal(document.activeElement,restored);assert.equal(new URL(location.href).searchParams.get('ov-q'),'Fixture');assert.equal(new URL(location.href).searchParams.get('ov-group'),'other');
  const scrollCount=h.scrolls.length;const filter=h.container.querySelector('input[type="search"]');filter.focus();await h.navigate('?view=outside&ov-q=Fixture&ov-group=all');assert.equal(document.activeElement,filter);assert.equal(h.scrolls.length,scrollCount,'retained filtering introduces no navigation or scroll intent');
});

test('cached speaker destinations orient once and drawer-to-speaker Back returns to the original exact sitting marker',async t=>{
  const h=await harness(t),mark=h.container.querySelector('[data-ov-focus="mark:42:'+day+'"]');await h.click(mark);await h.finish('42');
  assert(document.activeElement===h.container.querySelector('.ov-drawer .ov-item h3'),'a timeline activation focuses its exact agenda heading after arrival');
  await h.click('Open speaker page →');assert.equal(h.container.querySelector('.ov-drawer'),null);assert.equal(document.activeElement,h.container.querySelector('.ov-person-heading h2'),'cached explicit navigation lands on the current speaker heading');
  await h.click('← All speakers');assert.equal(document.activeElement,h.container.querySelector('[data-ov-focus="mark:42:'+day+'"]'),'return follows the initiating day marker rather than the removed drawer action');
  await h.click('Fixture speaker 42');assert.equal(document.activeElement,h.container.querySelector('.ov-person-heading h2'));await h.click('← All speakers');assert.equal(document.activeElement,h.container.querySelector('[data-ov-focus="person:42"]'));
});

test('superseded detail and error responses never reclaim focus; absent semantic openers use the retained directory search',async t=>{
  const h=await harness(t);await h.click('Fixture speaker 42');await h.click('← All speakers');const filter=h.container.querySelector('input[type="search"]');filter.focus();await h.finish('42');assert.equal(document.activeElement,filter);assert.equal(h.container.querySelector('.ov-person-heading'),null);
  await h.click('Fixture speaker 43');const back=h.container.querySelector('.ov-back');await h.finish('43',true);assert.equal(document.activeElement,back);assert(h.container.querySelector('.insight-error'));
  await h.navigate('?view=outside&ov-person=43&ov-q=absent');await h.click('← All speakers');assert.equal(document.activeElement,h.container.querySelector('input[type="search"]'));assert.equal(h.container.querySelector('[data-ov-focus="person:43"]'),null);
});

test('drawer endpoints wrap during pending and ready content and host Escape returns to the recorded opener',async t=>{
  const h=await harness(t),mark=h.container.querySelector('[data-ov-focus="mark:42:'+day+'"]');await h.click(mark);const close=h.container.querySelector('[aria-label="Close speeches"]');assert.equal(document.activeElement,close);
  let prevented=false;await act(async()=>{const event=new h.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true});close.dispatchEvent(event);prevented=event.defaultPrevented;});assert(prevented);assert.equal(document.activeElement,close,'the single pending endpoint wraps locally');
  await h.finish('42');const drawer=h.container.querySelector('.ov-drawer'),last=h.container.querySelector('.ov-open-person');
  // The nested frame is an offline boundary fixture. Events dispatched in the
  // host document do not establish upstream cross-origin keyboard behavior.
  const wrapper=document.createElement('div'),frame=document.createElement('iframe');frame.title='Local player boundary fixture';frame.tabIndex=-1;wrapper.setAttribute('aria-hidden','true');wrapper.append(frame);last.before(wrapper);
  close.focus();await h.key('Tab',true);assert.equal(document.activeElement,last,'the real final drawer action remains the endpoint while a frame prepares');
  await h.key('Tab');assert.equal(document.activeElement,close);frame.tabIndex=0;wrapper.setAttribute('aria-hidden','false');
  close.focus();await h.key('Tab',true);assert.equal(document.activeElement,last,'a ready intermediate iframe does not remove access to the existing final action');
  frame.focus();await act(async()=>{const event=new h.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});frame.dispatchEvent(event);assert.equal(event.defaultPrevented,false,'an intermediate ready frame is not mistaken for a host boundary');});
  // A locally ready frame is also a valid boundary if it is the last element.
  drawer.append(wrapper);close.focus();await h.key('Tab',true);assert.equal(document.activeElement,frame);await h.key('Tab');assert.equal(document.activeElement,close);
  await h.key('Escape');assert.equal(h.container.querySelector('.ov-drawer'),null);assert.equal(document.activeElement,mark);
});

test('drawer Back/popstate returns locally without changing existing URL history behavior',async t=>{
  const h=await harness(t),mark=h.container.querySelector('[data-ov-focus="mark:42:'+day+'"]');await h.click(mark);const length=history.length;await h.navigate('?view=outside');assert.equal(h.container.querySelector('.ov-drawer'),null);assert.equal(document.activeElement,mark);assert.equal(history.length,length,'closing a non-URL drawer adds no history entry');
});

test('a delayed timeline response never reveals a closed drawer or reclaims focus after another action',async t=>{
  const h=await harness(t),mark=id=>h.container.querySelector('[data-ov-focus="mark:'+id+':'+day+'"]');
  await h.click(mark('42'));await h.click(h.container.querySelector('[aria-label="Close speeches"]'));
  h.focusScrollEvents.length=0;await h.finish('42');
  assert.equal(h.container.querySelector('.ov-drawer'),null);
  assert.equal(h.focusScrollEvents.length,0,'a response for a dismissed selection creates no scroll or focus');
  await h.click(mark('43'));
  const search=h.container.querySelector('input[type="search"]');search.focus();h.focusScrollEvents.length=0;
  await h.finish('43');
  assert(document.activeElement===search,'explicit focus movement supersedes the pending reveal');
  assert.equal(h.focusScrollEvents.length,0);
});


test('retained contribution disclosure keeps focus through reader cleanup and reopen',async t=>{
  const h=await harness(t);await h.click(h.container.querySelector('.ov-mark'));await h.finish('42');
  const toggle=await h.click('Read / watch');assert.equal(toggle.textContent,'Close speech');assert.equal(document.activeElement,toggle);assert(h.container.querySelector('.insight-inline-reader'));
  await h.click('Close speech');assert.equal(h.container.querySelector('.insight-inline-reader'),null);assert.equal(document.activeElement,toggle);
  await h.click('Read / watch');assert.equal(h.container.querySelector('.ov-contribution-head button'),toggle);assert.equal(document.activeElement,toggle);assert(h.container.querySelector('.insight-inline-reader'));
});


test('Escape dismisses an actual nested reference card before its Outside drawer',async t=>{
  const h=await harness(t),mark=h.container.querySelector('[data-ov-focus="mark:42:'+day+'"]');await h.click(mark);await h.finish('42');
  const citation=await h.mountReference();assert(citation);await h.click(citation);const card=h.container.querySelector('.legal-reference-card');assert(card);assert.equal(document.activeElement,card);
  await h.key('Escape');assert.equal(h.container.querySelector('.legal-reference-card'),null);assert(h.container.querySelector('.ov-drawer'),'the first Escape closes only the inner reference');assert.equal(document.activeElement,citation,'the inner return is preserved');
  await h.key('Escape');assert.equal(h.container.querySelector('.ov-drawer'),null);assert.equal(document.activeElement,mark,'the next host Escape closes the drawer to its recorded opener');
});

test('hidden, inert and aria-hidden drawer openers use visible local fallbacks',async t=>{
  for(const attribute of ['hidden','inert','aria-hidden'])await t.test(attribute,async t=>{
    const h=await harness(t),mark=h.container.querySelector('[data-ov-focus="mark:42:'+day+'"]');await h.click(mark);mark.setAttribute(attribute,attribute==='aria-hidden'?'true':'');await h.click(h.container.querySelector('[aria-label="Close speeches"]'));assert.equal(document.activeElement,h.container.querySelector('input[type="search"]'));assert.notEqual(document.activeElement,mark);
  });
});


test('opening the current speaker from its drawer consumes focus intent before a later deferred refresh',async t=>{
  const h=await harness(t),polls=new Set(),setInterval=globalThis.setInterval,clearInterval=globalThis.clearInterval;
  t.mock.method(globalThis,'setInterval',(callback,delay,...args)=>{if(delay!==15000)return setInterval(callback,delay,...args);const timer={run:()=>callback(...args)};polls.add(timer);return timer;});
  t.mock.method(globalThis,'clearInterval',timer=>{if(!polls.delete(timer))clearInterval(timer);});
  await h.click('Fixture speaker 42');await h.finish('42',false,{coverage:{...coverage,complete:false,pending:1}});
  const dataHeading=h.container.querySelector('.ov-person-heading h2');await h.click(h.container.querySelector('.ov-appearance-cards button'));
  assert.equal(h.requests.filter(r=>r.url.pathname.includes('/outside/')).length,1,'the drawer reuses the exact cached speaker detail');await h.click('Open speaker page →');
  assert.equal(h.container.querySelector('.ov-drawer'),null);assert(document.activeElement===dataHeading,'same-speaker navigation consumes the explicit intent when its drawer closes');
  const retained=h.container.querySelector('.ov-tabs button');retained.focus();
  await act(async()=>{assert.equal(polls.size,1);[...polls][0].run();});assert.equal(h.requests.filter(r=>r.url.pathname.includes('/outside/')).length,2,'incomplete coverage still starts its existing deferred refresh');assert.equal(document.activeElement,retained,'starting the refresh preserves the chosen control');
  retained.blur();assert.equal(document.activeElement,document.body);
  h.focusScrollEvents.length=0;await h.finish('42');assert(document.activeElement===document.body,'later completion cannot revive the consumed drawer navigation intent');assert.equal(h.focusScrollEvents.length,0,'later completion cannot refocus or reveal a consumed destination');
  assert.equal(h.container.querySelector('.ov-person-heading h2'),dataHeading);
});

test('drawer loading stays visible without shifting retained reading, and Reload retains focus inside the dialog',async t=>{
  const h=await harness(t),polls=new Set(),setInterval=globalThis.setInterval,clearInterval=globalThis.clearInterval;
  t.mock.method(globalThis,'setInterval',(callback,delay,...args)=>{if(delay!==15000)return setInterval(callback,delay,...args);const timer={run:()=>callback(...args)};polls.add(timer);return timer;});
  t.mock.method(globalThis,'clearInterval',timer=>{if(!polls.delete(timer))clearInterval(timer);});
  await h.click(h.container.querySelector('[data-ov-focus="mark:42:'+day+'"]'));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
  assert(h.container.querySelector('.ov-drawer-status [role="status"]'),'the initial load has a visible status above the empty body');
  await h.finish('42',false,{coverage:{...coverage,complete:false,pending:1}});
  const heading=document.activeElement,content=h.container.querySelector('.ov-drawer-content');
  h.focusScrollEvents.length=0;
  await act(async()=>{assert.equal(polls.size,1);[...polls][0].run();});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
  assert.equal(h.container.querySelector('.ov-drawer-status [role="status"]'),null,'a retained-data refresh adds no loading row that would shift the reading viewport');
  await h.finish('42',true);
  const error=h.container.querySelector('.ov-drawer-status [role="alert"]');assert(error?.querySelector('button'));
  assert(!content.contains(error),'the retained-data retry stays above the scroll area');
  assert(document.activeElement===heading,'a refresh failure does not reclaim focus');
  assert(content.contains(heading),'the selected appearance remains available after refresh failure');
  assert.equal(h.focusScrollEvents.length,0,'status changes do not repeat the one-time reveal');
  await h.click(error.querySelector('button'));
  const close=h.container.querySelector('[aria-label="Close speeches"]');
  assert(document.activeElement===close,'Reload moves focus to the retained Close control before removing its button');
  await h.finish('42');assert(document.activeElement===close,'successful retry does not revive the consumed reveal');
  await h.key('Tab',true);assert(h.container.querySelector('.ov-drawer').contains(document.activeElement),'keyboard focus continues inside the dialog after retry');
});


test('returning to an exact speaker resets the established scroll first, then focuses and reveals that control once',async t=>{
  const h=await harness(t);await h.click('Fixture speaker 43');
  h.focusScrollEvents.length=0;await h.finish('43');assert.equal(h.focusScrollEvents.length,0,'speaker arrival introduces neither focus nor scroll');
  h.focusScrollEvents.length=0;await h.click('← All speakers');const returned=h.container.querySelector('[data-ov-focus="person:43"]');
  assert(document.activeElement===returned);const reset=h.focusScrollEvents.findIndex(event=>event.kind==='reset'&&event.element.classList.contains('explorer-insights')),focus=h.focusScrollEvents.findIndex(event=>event.kind==='focus'&&event.element===returned),reveal=h.focusScrollEvents.findIndex(event=>event.kind==='reveal'&&event.element===returned);
  assert(reset>=0&&focus>reset,'the existing person scroll reset must finish before exact-opener focus restoration');assert(reveal>focus,'the returned control is revealed after restoration');
  assert.deepEqual(h.focusScrollEvents[reset].options,{top:0});assert.deepEqual(h.focusScrollEvents[reveal].options,{block:'nearest'});
  assert.equal(h.focusScrollEvents.filter(event=>event.kind==='reveal').length,1,'the explicit exact return reveals only its own control');
});

test('drawer return reveals its exact opener while a person-changing Back resets scroll before fallback focus',async t=>{
  const h=await harness(t),mark=h.container.querySelector('[data-ov-focus="mark:43:'+day+'"]');await h.click(mark);await h.finish('43');h.focusScrollEvents.length=0;
  await h.click(h.container.querySelector('[aria-label="Close speeches"]'));assert(document.activeElement===mark);assert.equal(h.focusScrollEvents.filter(event=>event.kind==='reset').length,0,'ordinary drawer close keeps the existing scroll position');
  const reveal=h.focusScrollEvents.find(event=>event.kind==='reveal');assert(reveal?.element===mark);assert.deepEqual(reveal.options,{block:'nearest'});
  await h.click('Fixture speaker 43');await h.click(h.container.querySelector('.ov-appearance-cards button'));h.focusScrollEvents.length=0;
  await h.navigate('?view=outside');const fallback=h.container.querySelector('input[type="search"]');assert(document.activeElement===fallback);
  const reset=h.focusScrollEvents.findIndex(event=>event.kind==='reset'&&event.element.classList.contains('explorer-insights')),focus=h.focusScrollEvents.findIndex(event=>event.kind==='focus'&&event.element===fallback);
  assert(reset>=0&&focus>reset,'a person-changing Back completes its existing reset before drawer fallback focus');assert.equal(h.focusScrollEvents.filter(event=>event.kind==='reveal').length,0,'fallback focus does not introduce an exact-opener reveal');
});
