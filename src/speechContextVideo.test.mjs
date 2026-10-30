import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const start='2026-10-06T12:00:00Z',end='2026-10-06T12:01:00Z';
const row=(suffix,extra={})=>({id:'MTG-PL-2026-10-06-OTH-'+suffix,kind:'PLENARY_DEBATE_SPEECH',start,end,titles:{en:'Debate'},intervention:{type:'speech',speaker:{id:suffix,name:'Speaker '+suffix},onBehalfOf:[]},replyTo:null,exchangeId:null,...extra});
const records=[row('101'),row('102'),row('103',{kind:'PLENARY_DEBATE_WRITTEN_STATEMENT',intervention:{type:'written',speaker:{id:'103',name:'Written contribution'},onBehalfOf:[]}}),row('104',{start:null,end:null})];
const mapping={schemaVersion:1,channels:[{slot:0,language:'or',providerCode:'qaa'},{slot:1,language:'hu',providerCode:'qab'},{slot:2,language:'fr',providerCode:'qac'}],source:{recordingId:'context-recording'}};
function media(speech,language) {
  return {available:true,status:'matched',speechId:speech.id,requestedAudio:language,initialAudio:language,requiresAudioCheck:false,audioVerification:'official-content-map',selectionMethod:'official-embed-parameter',audioMapping:mapping,availableAudioLanguages:['or','hu','fr'],recording:{id:'context-recording',websiteUrl:'https://multimedia.europarl.europa.eu/context-recording'},clip:{startUtc:speech.start,endUtc:speech.end},embedUrl:'https://webstreaming.europarl.europa.eu/ep/embed/embed.html?'+new URLSearchParams({event:'context-recording',language,audio:language,analytics:'false',autoplay:'true',start:speech.start,end:speech.end})};
}
async function harness(t) {
  const window=new Window({url:'http://localhost/',settings:{disableIframePageLoading:true,disableCSSFileLoading:true}}),calls=[];
  // Happy DOM does not resolve the namespace wildcard used by the browser reader.
  class DOMParser extends window.DOMParser {
    parseFromString(...args){const doc=super.parseFromString(...args),query=doc.getElementsByTagNameNS.bind(doc);doc.getElementsByTagNameNS=(namespace,name)=>namespace==='*'?doc.getElementsByTagName(name):query(namespace,name);return doc;}
  }
  const globals={window,document:window.document,DOMParser,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const endpoints=new WeakMap();Object.defineProperty(window.HTMLIFrameElement.prototype,'contentWindow',{get(){if(!endpoints.has(this))endpoints.set(this,{postMessage(){}});return endpoints.get(this);}});
  let load,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);calls.push(url);
    if(url.pathname.startsWith('/api/speech-context/'))return Response.json({speechId:records[0].id,debates:[{id:'context-debate',titles:{en:'Debate'},records,exchanges:[],coverage:{complete:true}}]});
    const speech=records.find(row=>url.pathname.endsWith('/'+row.id));assert(speech,'Unexpected contextual request: '+url);
    if(url.pathname.startsWith('/api/speech-media/'))return Response.json(media(speech,url.searchParams.get('lang')));
    if(url.pathname.startsWith('/api/speech-transcript/'))return Response.json({id:speech.id,available:true,xml:'<speech><p>Retained contextual transcript.</p></speech>',textLanguage:'en',translationType:'original',metadata:{id:speech.id}});
    assert(url.pathname.startsWith('/api/speech/'),'No external player or corpus request is permitted');return Response.json(speech);
  });
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {SpeechContextPanel}=await load('/src/SpeechInterventions.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=language=>act(async()=>root.render(createElement(SpeechContextPanel,{id:records[0].id,language:'en',transcriptLanguage:language,preload:false})));
  const click=node=>act(async()=>{assert(node,'Missing contextual control');node.focus();node.click();});
  const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text);
  const header=index=>container.querySelectorAll('.intervention-read')[index];
  const mediaCalls=()=>calls.filter(url=>url.pathname.startsWith('/api/speech-media/'));
  return {window,container,calls,render,click,button,header,mediaCalls};
}

test('context video is requested explicitly for the opened speech and cleans up on row, language and section changes',async t=>{
  const h=await harness(t);await h.render('hu');
  assert.equal(h.button('Video'),undefined);assert.equal(h.mediaCalls().length,0);
  await h.click(h.container.querySelector('.intervention-context-toggle'));
  assert.equal(h.button('Video'),undefined,'closed contributions add no video controls');
  await h.click(h.header(0));
  const toggle=h.button('Video');assert(toggle.closest('.intervention-connected-tools'));
  assert(h.container.textContent.includes('Retained contextual transcript.'));
  assert.equal(h.container.querySelectorAll('.explorer-video-toggle').length,1);
  assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(h.container.querySelector('iframe'),null);assert.equal(h.mediaCalls().length,0);
  await h.click(toggle);
  assert.equal(h.mediaCalls().length,1);assert.equal(h.mediaCalls()[0].pathname,'/api/speech-media/'+records[0].id);assert.equal(h.mediaCalls()[0].searchParams.get('lang'),'hu');
  assert.equal(h.container.querySelector('iframe').dataset.speechId,records[0].id,'context clip uses row metadata even when the retained transcript metadata has no times');
  await h.click(h.button('Close video'));assert.equal(h.container.querySelector('iframe'),null);assert.equal(document.activeElement,toggle);
  await h.click(toggle);const first=h.container.querySelector('iframe');assert(first);
  await h.click(h.header(1));assert.equal(first.isConnected,false);assert.equal(h.container.querySelector('iframe'),null);assert.equal(h.button('Video').getAttribute('aria-expanded'),'false');
  await h.click(h.button('Video'));assert.equal(h.container.querySelector('iframe').dataset.speechId,records[1].id);assert.equal(h.mediaCalls().at(-1).pathname,'/api/speech-media/'+records[1].id);
  const second=h.container.querySelector('iframe');await h.render('fr');assert.equal(second.isConnected,false);assert.equal(h.container.querySelector('iframe'),null);assert.equal(h.button('Video').getAttribute('aria-expanded'),'false');
  await h.click(h.button('Video'));assert.equal(h.mediaCalls().at(-1).searchParams.get('lang'),'fr');
  const panel=h.container.querySelector('.explorer-video');await act(async()=>panel.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(h.container.querySelector('iframe'),null);assert.equal(document.activeElement,h.button('Video'));
  await h.click(h.button('Video'));const third=h.container.querySelector('iframe');assert(third);
  await h.click(h.container.querySelector('.intervention-context-toggle'));assert.equal(third.isConnected,false);assert.equal(h.container.querySelector('iframe'),null);
  const count=h.mediaCalls().length;await h.click(h.container.querySelector('.intervention-context-toggle'));assert.equal(h.button('Video'),undefined);assert.equal(h.mediaCalls().length,count);
});

test('written and untimed context contributions retain their text without a video control or gap label',async t=>{
  const h=await harness(t);await h.render('hu');await h.click(h.container.querySelector('.intervention-context-toggle'));
  for(const index of [2,3]){
    await h.click(h.header(index));assert(h.container.querySelector('.intervention-connected-text'));
    assert.equal(h.button('Video'),undefined);assert.equal(h.container.querySelector('.explorer-video-gap'),null);assert.equal(h.mediaCalls().length,0);
  }
});
