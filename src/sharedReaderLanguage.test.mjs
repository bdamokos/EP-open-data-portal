import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const speech={id:'MTG-PL-2026-03-25-OTH-101',kind:'PLENARY_DEBATE_SPEECH',start:'2026-03-25T09:00:00Z',end:'2026-03-25T09:01:00Z'};
const effective=node=>{assert(node,'Missing rendered language target');return node.closest('[lang]')?.getAttribute('lang');};
async function harness(t,locale,respond=()=>{throw Error('Unexpected fixture request');}) {
  const window=new Window({url:'http://localhost/',settings:{disableIframePageLoading:true,disableCSSFileLoading:true}});
  window.document.documentElement.lang=locale;
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const endpoints=new WeakMap();
  Object.defineProperty(window.HTMLIFrameElement.prototype,'contentWindow',{get(){if(!endpoints.has(this))endpoints.set(this,{postMessage(){}});return endpoints.get(this);}});
  let loadModule,root;const calls=[];
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input,window.location.href);assert.equal(url.origin,'http://localhost');calls.push(url);return Response.json(await respond(url));});
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);root=createRoot(container);
  return {window,container,calls,load:path=>loadModule('/src/'+path+'.tsx'),render:element=>act(async()=>root.render(element)),click:element=>act(async()=>{element.focus();element.click();})};
}

test('player controls, unavailable states and parent-frame text stay English under EN/HU/FR source selections',async t=>{
  for(const locale of ['en','hu','fr'])await t.test(locale,async t=>{
    const h=await harness(t,locale,url=>{assert.equal(url.pathname,'/api/speech-media/'+speech.id);return {available:false,status:'audio-unavailable',reason:'Requested fixture audio is unavailable.'};});
    const {SpeechPlayer,ParliamentFrame}=await h.load('SpeechPlayer');
    await h.render(createElement(SpeechPlayer,{speech:{...speech,kind:'PLENARY_DEBATE_WRITTEN_STATEMENT'},lang:locale}));
    assert.equal(effective(h.container.querySelector('.explorer-video-gap strong')),'en');
    await h.render(createElement(SpeechPlayer,{speech:{...speech,start:null},lang:locale}));
    assert.equal(h.container.querySelector('strong').textContent,'Video timings unavailable');assert.equal(effective(h.container.querySelector('strong')),'en');
    await h.render(createElement(SpeechPlayer,{speech,lang:locale}));
    const actions=h.container.querySelectorAll('.explorer-video-toggle');
    assert.deepEqual([...actions].map(node=>node.textContent),['Video']);
    assert([...actions].every(node=>effective(node)==='en'));assert.equal(h.calls.length,0,'language markup never starts media acquisition');
    await h.click(actions[0]);
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].searchParams.get('lang'),locale);
    assert.equal(effective(h.container.querySelector('.explorer-notice strong')),'en');
    assert.equal(h.container.querySelector('.explorer-notice p').textContent,'Requested fixture audio is unavailable.');
    assert.equal(h.container.querySelector('iframe'),null,'unavailable audio does not open a player');
    const mapping={schemaVersion:1,channels:[{slot:0,language:'or',providerCode:'qaa'}],source:{recordingId:'isolated-frame'}};
    await h.render(createElement(ParliamentFrame,{src:'http://localhost/isolated-frame',speechId:speech.id,lang:locale,audio:'or',original:true,mapping}));
    assert.equal(h.container.querySelector('[role="status"]').textContent,'Preparing original audio…');assert.equal(effective(h.container.querySelector('[role="status"]')),'en');
    const frame=h.container.querySelector('iframe');assert.equal(effective(frame),'en');assert.equal(frame.title,'European Parliament speech video · original audio');assert.equal(frame.tabIndex,-1);
    await act(async()=>h.window.dispatchEvent(new h.window.MessageEvent('message',{origin:'https://webstreaming.europarl.europa.eu',source:frame.contentWindow,data:{key:'get:availableAudio',isError:true}})));
    assert.equal(effective(h.container.querySelector('[role="alert"]')),'en');assert.equal(h.container.querySelector('[role="alert"] button').textContent,'Retry player');
    assert.equal(h.calls.length,1,'isolated parent-frame messages never fetch an external player');
  });
});

const comparison=actual=>({status:'available',stage:'original-joint',requestedLanguage:'hu',textLanguage:actual,availableLanguages:['en','hu','fr'],reason:null,
  documents:['before','after'].map(id=>({id,reference:id,title:'Exact unused source title',date:'2026-03-25',sourceUrl:null,fetchedAt:null,language:actual,translationType:'original',stale:false,refreshError:null})),sources:[],
  summary:{changed:0,added:1,removed:0,unchanged:0,referenceChanged:0},rows:[{kind:'added',before:null,after:{index:0,kind:'recital',label:'A',text:'Exact source wording'},referenceChanged:false,segments:[{type:'added',text:'Exact source wording'}]}]});

test('comparison source wording keeps exact actual/unknown metadata while English labels and localized metadata remain separate',async t=>{
  const cases=[['en','hu'],['hu','fr'],['fr','en'],['hu',null],['fr','mul'],['hu','und']];
  for(const [locale,actual] of cases)await t.test(locale+'/'+actual,async t=>{
    const h=await harness(t,locale,url=>{assert.equal(url.pathname,'/api/motion-comparison/B-10-2026-0001');return comparison(actual);});
    const {MotionComparison}=await h.load('MotionComparison');
    await h.render(createElement(MotionComparison,{originalId:'B-10-2026-0001',jointId:'RC-10-2026-0001',language:locale}));
    assert.equal(effective(h.container.querySelector('.explorer-diff-change-label')),'en');
    assert.equal(h.container.querySelector('.explorer-diff-change-label').textContent,'Only in joint');
    assert.equal(effective(h.container.querySelector('.explorer-diff-rows ins')),actual||'');
    assert([...h.container.querySelectorAll('.explorer-diff-sr')].every(node=>effective(node)==='en'));
    await h.click([...h.container.querySelectorAll('.explorer-diff-views button')].find(node=>node.textContent==='Side by side'));
    assert.equal(effective(h.container.querySelector('h4')),'en');assert.equal(effective(h.container.querySelector('.explorer-diff-row-label')),'en');
    assert.equal(h.container.querySelector('.explorer-diff-row-label').textContent,'Only in joint');
    assert.equal(effective(h.container.querySelector('.explorer-diff-reference')),'en');assert.equal(effective(h.container.querySelector('.explorer-diff-absent')),'en');
    const wording=h.container.querySelector('.explorer-diff-rows ins');assert.equal(wording.childNodes[1].textContent,'Exact source wording');assert.equal(effective(wording),actual||'');
    assert.equal(h.container.querySelector('.explorer-diff-reference').textContent,'Original');assert.equal(h.container.querySelectorAll('.explorer-diff-reference')[1].textContent,'Joint · Recital A');
    const sourceDate=h.container.querySelector('.explorer-diff-documents > div > span');assert.equal(effective(sourceDate),locale);
    assert.equal(sourceDate.textContent,new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date('2026-03-25')));
    const selects=h.container.querySelectorAll('select');
    assert.equal(effective(selects[0].querySelector('option')),'en');assert.equal(effective(selects[1]),'en');
    for(const option of selects[1].options){assert.equal(effective(option),option.value);assert.equal(option.textContent,new Intl.DisplayNames([option.value],{type:'language'}).of(option.value));}
    const fallback=h.container.querySelector('.text-language-note');
    if(actual&&actual!==locale){assert.equal(effective(fallback),'en');assert([...fallback.querySelectorAll('span')].every(node=>effective(node)===locale));assert.equal(fallback.textContent,new Intl.DisplayNames([locale],{type:'language'}).of(locale)+' unavailable in one or both texts · showing '+new Intl.DisplayNames([locale],{type:'language'}).of(actual));}
    else assert.equal(fallback,null,'unknown metadata never invents a fallback-language notice');
    await h.click([...h.container.querySelectorAll('.explorer-diff-views button')].find(node=>node.textContent==='Full text'));
    assert.equal(effective(h.container.querySelector('.explorer-diff-reader h5')),'en');assert.equal(effective(h.container.querySelector('.explorer-diff-reader .explorer-diff-reference')),'en');
    assert.equal(effective(h.container.querySelector('.explorer-diff-reader .explorer-diff-wording')),actual||'');
    assert.equal(h.container.querySelector('.explorer-diff-reader .explorer-diff-wording').textContent,'Exact source wording');
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].searchParams.get('lang'),locale);assert.equal(h.calls[0].searchParams.get('joint'),'RC-10-2026-0001');
  });
});
