import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act,useLayoutEffect} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const id='MTG-PL-2026-03-25-OTH-2017069380111';
const speech={id,kind:'PLENARY_DEBATE_SPEECH',start:'2026-03-25T09:00:00Z',end:'2026-03-25T09:02:00Z'};
const origin='https://webstreaming.europarl.europa.eu';
const mapping={schemaVersion:1,channels:[{slot:0,language:'or',providerCode:'qaa'},{slot:1,language:'en',providerCode:'qab'}],source:{recordingId:'fixture-recording'}};
const media=(audio='or')=>({available:true,status:'matched',speechId:id,requestedAudio:audio,initialAudio:audio,requiresAudioCheck:false,audioVerification:'official-content-map',selectionMethod:'official-embed-parameter',audioMapping:mapping,availableAudioLanguages:['or','en'],recording:{id:'fixture-recording',websiteUrl:'https://multimedia.europarl.europa.eu/fixture-recording'},clip:{startUtc:speech.start,endUtc:speech.end},embedUrl:origin+'/ep/embed/embed.html?'+new URLSearchParams({event:'fixture-recording',language:'en',audio:audio,analytics:'false',autoplay:'true',start:speech.start,end:speech.end})});

async function harness(t) {
  const window=new Window({url:'http://localhost/',settings:{disableIframePageLoading:true,disableCSSFileLoading:true}}),requests=[];
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  // No iframe document is acquired: the isolated message endpoint lets the
  // unchanged parent protocol process fixture messages with exact source checks.
  const endpoints=new WeakMap();Object.defineProperty(window.HTMLIFrameElement.prototype,'contentWindow',{get(){if(!endpoints.has(this))endpoints.set(this,{postMessage(){}});return endpoints.get(this);}});
  const scrolls=[];window.HTMLElement.prototype.scrollIntoView=function(options){scrolls.push({element:this,options});};
  let loadModule,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());for(const request of requests)if(!request.finished)request.resolve(Response.json({}));if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',input=>{const route=new URL(input,window.location.href);assert.match(route.pathname,/\/api\/speech-media\//,'media focus tests cannot fetch an upstream player or corpus');return new Promise((resolve,reject)=>requests.push({route,resolve,reject,finished:false}));});
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const components=await loadModule('/src/SpeechPlayer.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=element=>act(async()=>root.render(element));
  const player=props=>createElement(components.SpeechPlayer,{speech,lang:'en',...props});
  const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text);
  const click=async text=>{const node=button(text);assert(node,'Missing button: '+text);await act(async()=>{node.focus();node.click();});return node;};
  const finish=(audio='en',error=false,payload=media(audio))=>act(async()=>{const request=requests.find(request=>!request.finished&&request.route.searchParams.get('audio')===(audio==='or'?'or':null));assert(request,'Missing media request '+audio);request.finished=true;error?request.reject(new Error('Fixture media unavailable.')):request.resolve(Response.json(payload));});
  const post=(frame,data,{messageOrigin=origin,source=frame.contentWindow}={})=>act(async()=>window.dispatchEvent(new window.MessageEvent('message',{origin:messageOrigin,source,data})));
  const ready=async frame=>{await post(frame,{key:'get:availableAudio',isError:false,result:['qaa','qab']});await post(frame,{key:'get:availableLang',isError:false,result:[['qaa','Original'],['qab','English']]});await post(frame,{key:'event:audioadaptation',isError:false,result:{type:'audioadaptation',representationID:'Original AUDIO'}});await post(frame,{key:'method:play',isError:false});};
  return {window,container,requests,scrolls,components,render,player,button,click,finish,post,ready};
}

test('the compact disclosure loads only on request, retains focus while the player loads and restores its opener on Close',async t=>{
  const h=await harness(t);await h.render(h.player());
  assert.equal(h.requests.length,0);const toggle=h.button('Video');
  const panel=document.getElementById(toggle.getAttribute('aria-controls'));assert(panel.hidden);assert.equal(panel.querySelector('select'),null);
  await h.click('Video');assert.equal(document.activeElement,toggle);assert.equal(toggle.getAttribute('aria-expanded'),'true');await h.finish('en');
  assert.equal(document.activeElement,toggle);assert.equal(h.container.querySelector('iframe').tabIndex,0);
  await h.click('Close video');assert.equal(document.activeElement,toggle);assert.equal(h.container.querySelector('iframe'),null);assert(panel.hidden);
  await h.click('Video');assert.equal(h.requests.length,1,'reopening reuses fresh metadata');
  const frame=h.container.querySelector('iframe'),wrapper=frame.parentElement;
  assert.notEqual(wrapper.style.visibility,'hidden');assert.equal(wrapper.getAttribute('aria-hidden'),null);assert.equal(frame.tabIndex,0);
  assert.equal(document.activeElement,toggle,'showing the native player retains focus');
  assert.deepEqual(h.scrolls.at(-1),{element:wrapper,options:{block:'nearest'}});
  assert.equal(panel.querySelector('select'),null,'the official player owns audio language selection');
  assert.deepEqual([...panel.querySelectorAll('button')].map(node=>node.textContent),['Close video']);
  assert.equal(new URL(frame.src).searchParams.get('audio'),'en','the video opens in the interface language');
  await h.click('Close video');assert.equal(document.activeElement,toggle);assert.equal(h.container.querySelector('iframe'),null);
});

test('a failed metadata request retries with focus on the retained opener',async t=>{
  const h=await harness(t);await h.render(h.player());const opener=await h.click('Video');await h.finish('en',true);
  const retry=await h.click('Try video again');assert.equal(retry.isConnected,false);assert.equal(document.activeElement,opener);await h.finish('en');
  assert.equal(h.container.querySelector('iframe').tabIndex,0);
});

test('a refresh error keeps the retained clip and Try video again refreshes it with focus on the opener',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const h=await harness(t);await h.render(h.player());
  const toggle=await h.click('Video');await h.finish('en');await h.click('Close video');
  now+=31_000;await h.click('Video');await h.finish('en',true);
  const frame=h.container.querySelector('iframe');assert(frame,'the retained matched clip remains available after refresh failure');
  const retry=await h.click('Try video again');assert.equal(retry.isConnected,false);assert.equal(document.activeElement,toggle);
  assert.equal(h.requests.length,3,'Try video again explicitly refreshes failed metadata');
  await h.finish('en');assert.equal(h.container.querySelector('iframe'),frame,'a matching refresh keeps the playing frame');assert.equal(document.activeElement,toggle);
});

test('unavailable interface-language audio offers the original audio and keeps focus in the panel',async t=>{
  const h=await harness(t);await h.render(h.player());await h.click('Video');
  await h.finish('en',false,{available:false,status:'audio-unavailable',speechId:id});
  assert.equal(h.container.querySelector('iframe'),null);
  const fallback=await h.click('Try original audio');assert.equal(fallback.isConnected,false);assert.equal(document.activeElement,h.button('Close video'));
  await h.finish('or');assert.equal(new URL(h.container.querySelector('iframe').src).searchParams.get('audio'),'or');
});

test('native startup is visible without parent audio messages or playback commands',async t=>{
  const h=await harness(t);await h.render(h.player());await h.click('Video');await h.finish('en');
  const frame=h.container.querySelector('iframe');frame.focus();
  await h.post(frame,{key:'get:availableAudio',isError:true});
  assert.equal(h.container.querySelector('iframe'),frame);assert.equal(document.activeElement,frame);
  assert.equal(h.container.querySelector('[role="alert"]'),null);
  assert.equal(new URL(frame.src).searchParams.get('audio'),'en');
  assert.equal(new URL(frame.src).searchParams.get('autoplay'),'true');
});

test('iframe language changes retain the ready player, focus and language-neutral caption',async t=>{
  const h=await harness(t);await h.render(h.player());await h.click('Video');await h.finish('en');
  const frame=h.container.querySelector('iframe');await h.ready(frame);frame.focus();
  for(const label of ['English','Magyar','Original','English']){
    await h.post(frame,{key:'event:audioadaptation',isError:false,result:{type:'audioadaptation',representationID:label+' AUDIO'}});
    await h.post(frame,{key:'event:audiodownloadqualitychanged',isError:false,result:{type:'audiodownloadqualitychanged',targetQualityId:label+' AUDIO',targetQuality:{id:label+' AUDIO'}}});
    assert.equal(h.container.querySelector('iframe'),frame);assert.equal(document.activeElement,frame);
    assert.equal(frame.tabIndex,0);assert.notEqual(frame.parentElement.style.visibility,'hidden');
    assert.equal(h.container.querySelector('[role="alert"]'),null);
    assert.equal(h.container.querySelector('.explorer-video-caption').textContent,'European Parliament');
    assert.equal(frame.title,'European Parliament speech video');
  }
  await h.click('Close video');assert.equal(h.container.querySelector('iframe'),null);assert.equal(document.activeElement,h.button('Video'));
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
  await h.render(h.player());const original=await h.click('Video');await h.finish('en');const active=h.container.querySelector('iframe');await h.ready(active);active.focus();
  await h.render(h.player({lang:'fr'}));assert.notEqual(document.activeElement,original,'a superseded language intent does not restore the old audio opener');assert.equal(h.container.querySelector('iframe'),null);
  const unrelated=document.createElement('button');document.body.append(unrelated);unrelated.focus();await h.render(null);assert.equal(document.activeElement,unrelated,'navigation cleanup never steals focus');
});
