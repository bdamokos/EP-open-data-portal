import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act,useLayoutEffect} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const id='MTG-PL-2026-03-25-OTH-2017069380111';
const speech={id,kind:'PLENARY_DEBATE_SPEECH',start:'2026-03-25T09:00:00Z',end:'2026-03-25T09:02:00Z'};
const origin='https://webstreaming.europarl.europa.eu';
const mapping={schemaVersion:1,channels:[{slot:0,language:'or',providerCode:'qaa'},{slot:1,language:'en',providerCode:'qab'}],source:{recordingId:'fixture-recording'}};
const media=(audio='or')=>({available:true,status:'matched',speechId:id,requestedAudio:audio,initialAudio:'or',requiresAudioCheck:true,audioVerification:'official-content-map-runtime-check-required',selectionMethod:'iframe-inventory-and-adaptation',audioMapping:mapping,availableAudioLanguages:['or','en'],recording:{id:'fixture-recording',websiteUrl:'https://multimedia.europarl.europa.eu/fixture-recording'},clip:{startUtc:speech.start,endUtc:speech.end},embedUrl:origin+'/ep/embed/embed.html?'+new URLSearchParams({event:'fixture-recording',language:'en',audio:'or',analytics:'false',autoplay:'false',start:speech.start,end:speech.end})});

async function harness(t) {
  const window=new Window({url:'http://localhost/',settings:{disableIframePageLoading:true,disableCSSFileLoading:true}}),requests=[];
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  // No iframe document is acquired: the isolated message endpoint lets the
  // unchanged parent protocol process fixture messages with exact source checks.
  const endpoints=new WeakMap();Object.defineProperty(window.HTMLIFrameElement.prototype,'contentWindow',{get(){if(!endpoints.has(this))endpoints.set(this,{postMessage(){}});return endpoints.get(this);}});
  const scrolls=[];window.HTMLElement.prototype.scrollIntoView=function(options){scrolls.push({element:this,options});};
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());for(const request of requests)if(!request.finished)request.resolve(Response.json({}));if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',input=>{const route=new URL(input,window.location.href);assert.match(route.pathname,/\/api\/speech-media\//,'media focus tests cannot fetch an upstream player or corpus');return new Promise((resolve,reject)=>requests.push({route,resolve,reject,finished:false}));});
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const components=await vite.ssrLoadModule('/src/SpeechPlayer.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=element=>act(async()=>root.render(element));
  const player=props=>createElement(components.SpeechPlayer,{speech,lang:'en',...props});
  const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text);
  const click=async text=>{const node=button(text);assert(node,'Missing button: '+text);await act(async()=>{node.focus();node.click();});return node;};
  const finish=(audio='or',error=false)=>act(async()=>{const request=requests.find(request=>!request.finished&&request.route.searchParams.get('audio')===(audio==='or'?'or':null));assert(request,'Missing media request '+audio);request.finished=true;error?request.reject(new Error('Fixture media unavailable.')):request.resolve(Response.json(media(audio)));});
  const post=(frame,data,{messageOrigin=origin,source=frame.contentWindow}={})=>act(async()=>window.dispatchEvent(new window.MessageEvent('message',{origin:messageOrigin,source,data})));
  const ready=async frame=>{await post(frame,{key:'get:availableAudio',isError:false,result:['qaa','qab']});await post(frame,{key:'get:availableLang',isError:false,result:[['qaa','Original'],['qab','English']]});await post(frame,{key:'event:audioadaptation',isError:false,result:{type:'audioadaptation',representationID:'Original AUDIO'}});await post(frame,{key:'method:play',isError:false});};
  const chooseAudio=async value=>act(async()=>{const select=container.querySelector('select');assert(select);select.value=value;select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const openOriginal=async()=>{if(button('Video').getAttribute('aria-expanded')==='false')await click('Video');await chooseAudio('original');await click('Restart video');return button('Video');};
  return {window,container,requests,scrolls,components,render,player,button,click,finish,post,ready,chooseAudio,openOriginal};
}

test('the compact disclosure loads only on request, retains focus through readiness and restores its opener on Close',async t=>{
  const h=await harness(t);await h.render(h.player());
  assert.equal(h.requests.length,0);const toggle=h.button('Video');
  const panel=document.getElementById(toggle.getAttribute('aria-controls'));assert(panel.hidden);assert.equal(panel.querySelector('select'),null);
  await h.click('Video');assert.equal(document.activeElement,toggle);assert.equal(toggle.getAttribute('aria-expanded'),'true');await h.finish('en');
  assert.equal(document.activeElement,toggle);assert.equal(h.container.querySelector('iframe').tabIndex,-1);
  await h.click('Close video');assert.equal(document.activeElement,toggle);assert.equal(h.container.querySelector('iframe'),null);assert(panel.hidden);
  await h.openOriginal();const select=h.container.querySelector('select');assert.equal(document.activeElement,select);await h.finish();
  const frame=h.container.querySelector('iframe'),wrapper=frame.parentElement;
  assert.equal(wrapper.style.visibility,'hidden');assert.equal(wrapper.getAttribute('aria-hidden'),'true');assert.equal(frame.tabIndex,-1);
  await h.post(frame,{key:'get:availableAudio',isError:false,result:['qaa','qab']},{messageOrigin:'https://invalid.example'});
  assert.equal(frame.tabIndex,-1,'an untrusted origin cannot release the frame');
  await h.ready(frame);assert.equal(frame.tabIndex,0);assert.equal(wrapper.style.visibility,'visible');assert.equal(wrapper.getAttribute('aria-hidden'),'false');assert.equal(document.activeElement,select,'readiness never reclaims focus');
  assert.deepEqual(h.scrolls.at(-1),{element:wrapper,options:{block:'nearest'}},'the established readiness scroll is retained');
  const replay=await h.click('Replay video');assert.notEqual(h.container.querySelector('iframe'),frame);assert.equal(document.activeElement,replay);assert.equal(h.requests.length,2,'matched replay does not refresh metadata');
  await h.click('Close video');assert.equal(document.activeElement,toggle);assert.equal(h.container.querySelector('iframe'),null);
});

test('both disappearing retry controls recover the exact retained audio action without changing readiness guards',async t=>{
  const h=await harness(t);await h.render(h.player());const original=await h.openOriginal();await h.finish('or',true);
  const outer=await h.click('Try video again');assert.equal(outer.isConnected,false);assert.equal(document.activeElement,original);await h.finish();
  const first=h.container.querySelector('iframe');await h.post(first,{key:'get:availableAudio',isError:true});
  const inner=await h.click('Retry player');assert.equal(inner.isConnected,false);assert.equal(document.activeElement,original);
  const next=h.container.querySelector('iframe');assert.notEqual(first,next);assert.equal(next.tabIndex,-1);assert.equal(next.parentElement.getAttribute('aria-hidden'),'true');
  await h.ready(next);assert.equal(document.activeElement,original,'a successful retry does not move focus again');
});

test('replaying a retained clip after a refresh error moves focus before disabling Replay',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const h=await harness(t);await h.render(h.player());
  const toggle=await h.click('Video');assert.equal(toggle.getAttribute('aria-label'),null,'the visible Video label names the disclosure in both states');
  await h.finish('en');await h.click('Close video');
  now+=31_000;await h.click('Video');await h.finish('en',true);
  assert(h.container.querySelector('iframe'),'the retained matched clip remains available after refresh failure');
  assert.equal(h.button('Replay video').disabled,false);
  const replay=await h.click('Replay video'),select=h.container.querySelector('select');
  assert.equal(replay.disabled,true);assert.equal(document.activeElement,select,'retrying Replay retains keyboard focus in the audio controls');
  assert.equal(h.requests.length,3,'Replay explicitly refreshes failed metadata');
  await h.finish('en');assert.equal(document.activeElement,select,'refresh completion does not move focus again');
  assert.equal(toggle.getAttribute('aria-label'),null);
});

test('audio failure recovers a focused frame but respects another chosen link',async t=>{
  const h=await harness(t);await h.render(h.player());const original=await h.openOriginal();await h.finish();
  const frame=h.container.querySelector('iframe');await h.ready(frame);frame.focus();assert.equal(document.activeElement,frame);
  await h.post(frame,{key:'event:audioadaptation',isError:false,result:{type:'audioadaptation',representationID:'English AUDIO'}});
  assert.equal(h.container.querySelector('iframe'),null);assert.equal(document.activeElement,original,'removing the active frame returns to its semantic audio opener');
  await h.click('Retry player');const next=h.container.querySelector('iframe');await h.ready(next);
  const source=h.container.querySelector('.explorer-source-link a');source.focus();
  await h.post(next,{key:'event:audioadaptation',isError:false,result:{type:'audioadaptation',representationID:'English AUDIO'}});
  assert.equal(h.container.querySelector('iframe'),null);assert.equal(document.activeElement,source,'an audio failure cannot steal focus from another retained control');
});

test('frame replacement returns only lost frame focus, while navigation and deliberately moved focus cancel recovery',async t=>{
  const h=await harness(t),fallback=document.createElement('button');fallback.textContent='Retained audio action';document.body.append(fallback);
  const frame=key=>createElement(h.components.ParliamentFrame,{key,src:media().embedUrl,speechId:id,lang:'en',audio:'or',original:true,mapping,returnFocus:()=>fallback.focus({preventScroll:true})});
  await h.render(frame('first'));const first=h.container.querySelector('iframe');await h.ready(first);first.focus();await h.render(frame('new-map'));
  assert.equal(document.activeElement,fallback,'a key change recovers focus after the old active frame is detached');
  const second=h.container.querySelector('iframe');await h.ready(second);fallback.focus();await h.render(frame('another-map'));assert.equal(document.activeElement,fallback,'unrelated focus is retained');
  const moving=h.container.querySelector('iframe');await h.ready(moving);moving.focus();
  const chosen=document.createElement('button');chosen.textContent='User selected destination';document.body.append(chosen);
  function ChosenDestination(){useLayoutEffect(()=>chosen.focus(),[]);return frame('chosen-map');}
  await h.render(createElement(ChosenDestination));assert.equal(document.activeElement,chosen,'a newer focus destination wins before deferred frame cleanup');
  await h.render(h.player());const original=await h.openOriginal();await h.finish();const active=h.container.querySelector('iframe');await h.ready(active);active.focus();
  await h.render(h.player({lang:'fr'}));assert.notEqual(document.activeElement,original,'a superseded language intent does not restore the old audio opener');assert.equal(h.container.querySelector('iframe'),null);
  const unrelated=document.createElement('button');document.body.append(unrelated);unrelated.focus();await h.render(null);assert.equal(document.activeElement,unrelated,'navigation cleanup never steals focus');
});
