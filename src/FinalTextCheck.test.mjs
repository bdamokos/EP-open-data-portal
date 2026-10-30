import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {API_VERSION} from '../server/api-version.mjs';

const selection={documentId:'AGRI-PR-773115',amendmentId:'committee:AGRI-AM-773343:181',listId:'AGRI-AM-773343',wordingLanguage:'en',language:'en'};
const wording={status:'same-wording',wholeProvision:'same',operation:'replace',mapping:{basis:'unique-complete-wording',from:'Article 7(4)',to:'Article 9(4)',officialLineage:false},passages:{original:'Original clause.',proposed:'Proposed complete clause.',baseline:{text:'Original clause.',address:'Article 7(4)',complete:true},destination:{text:'Proposed complete clause.',address:'Article 9(4)',complete:true}},components:[],gaps:[]};
const destination={kind:'final-eu-act',id:'32026R0697',date:'2026-03-11',language:'en',sourceUrls:['https://publications.europa.eu/resource/celex/32026R0697','https://eur-lex.europa.eu/eli/reg/2026/697/oj/eng'],source:{url:'https://publications.europa.eu/resource/celex/32026R0697',sha256:'a'.repeat(64)}};
const response=(picked=selection,extra={})=>({version:3,comparisonVersion:3,selection:{...picked,source:{url:'https://data.europarl.europa.eu/distribution/reds_iCmDoc_Amd/AGRI-AM-773343/AGRI-AM-773343_en.docx',contentHash:'b'.repeat(64)},parserVersion:'5'},vote:{status:'unavailable',stage:'committee',scope:'individual-amendment',outcome:null,decisions:[]},destination,wording,stages:[{destination,wording}],lineage:{status:'available',relationships:[],gaps:[]},provenance:[],gaps:[],...extra});

async function harness(t,respond) {
  const window=new Window({url:'http://localhost/'}),requests=[];
  const globals={window,document:window.document,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loader,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(loader)await loader.close();await window.happyDOM.close();for(const[key,descriptor]of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    const url=new URL(input,window.location.href);assert.equal(url.searchParams.get('v'),String(API_VERSION));assert.equal(options.method,'GET');
    const request={url,signal:options.signal};requests.push(request);const value=await respond(request,requests.length);return value instanceof Response?value:Response.json(value);
  });
  loader=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {FinalTextCheck}=await loader('/src/FinalTextCheck.tsx'),journey=await loader('/src/dossierJourney.ts'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const settle=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,15)));
  const render=async picked=>{await act(async()=>root.render(createElement(FinalTextCheck,picked)));await settle();};
  const toggle=async(open=true)=>{await act(async()=>{const detail=container.querySelector('.final-text-check');detail.open=open;detail.dispatchEvent(new window.Event('toggle'));});await settle();};
  const click=async label=>{const button=[...container.querySelectorAll('button')].find(node=>node.textContent===label);assert(button,label);await act(async()=>button.click());await settle();};
  return {window,container,requests,render,toggle,click,settle,remember:journey.rememberDossierOrigin};
}

test('closed disclosure does not fetch; opening requests the exact list, amendment and wording language once',async t=>{
  const h=await harness(t,()=>response());await h.render(selection);assert.equal(h.requests.length,0);assert.equal(h.container.textContent,'In the final text?');
  await h.toggle();assert.equal(h.requests.length,1);const url=h.requests[0].url;
  assert.equal(decodeURIComponent(url.pathname),'/api/document-context/AGRI-PR-773115');
  for(const [key,value]of Object.entries({amendment:selection.amendmentId,list:selection.listId,'wording-lang':'en',lang:'en','final-text':'1',scope:'committee'}))assert.equal(url.searchParams.get(key),value);
  assert(h.container.textContent.includes('Same wording'));assert(h.container.textContent.includes('Final EU act'));assert(h.container.textContent.includes('11 Mar 2026'));assert(h.container.textContent.includes('Article 9(4)'));
  assert(h.container.textContent.includes('Compare wording'));assert(h.container.querySelector('.wording-diff'));assert(h.container.textContent.includes('Read text'));
  for(const link of h.container.querySelectorAll('a'))assert(!/publications\.europa\.eu\/resource|data\.europarl\.europa\.eu\/api/u.test(link.href));
  assert(!h.container.textContent.includes(destination.id));assert(!h.container.textContent.includes('2026-10-30'));
  await h.toggle(false);assert.equal(h.requests.length,1);
});

test('selection changes remount closed and late responses cannot cross document, list or language',async t=>{
  let finish;
  const h=await harness(t,(_request,count)=>count===1?new Promise(resolve=>{finish=resolve;}):response({...selection,listId:'IMCO-AM-772127',amendmentId:'committee:IMCO-AM-772127:121',documentId:'IMCO-PA-770204'}));
  await h.render(selection);await h.toggle();assert.equal(h.requests.length,1);
  const next={...selection,listId:'IMCO-AM-772127',amendmentId:'committee:IMCO-AM-772127:121',documentId:'IMCO-PA-770204'};
  await h.render(next);assert.equal(h.requests[0].signal.aborted,true);assert.equal(h.container.querySelector('details').open,false);assert.equal(h.requests.length,1);
  await act(async()=>finish(response()));await h.settle();assert.equal(h.container.textContent,'In the final text?');
  await h.toggle();assert.equal(h.requests.length,2);assert(h.container.textContent.includes('Same wording'));
  await h.render({...next,wordingLanguage:'fr'});assert.equal(h.container.textContent,'In the final text?');assert.equal(h.requests.length,2);
});

test('mismatched responses are discarded and retry preserves a successful readable comparison',async t=>{
  let count=0;
  const h=await harness(t,()=>{count++;if(count===1)return response({...selection,wordingLanguage:'fr'});if(count===3)return new Response('{}',{status:502});return response();});
  await h.render(selection);await h.toggle();assert(!h.container.textContent.includes('Same wording'));assert(h.container.textContent.includes('Could not load comparison.'));
  await h.click('Try again');assert(h.container.textContent.includes('Same wording'));
  await h.click('Check again');assert(h.container.textContent.includes('Same wording'));assert(h.container.querySelector('.wording-diff'));assert(h.container.textContent.includes('Could not refresh comparison.'));
  await h.click('Try again');assert(h.container.textContent.includes('Same wording'));assert.equal(h.requests.length,4);
});

test('published vote is separate from wording and unavailable destinations offer no invented outcome',async t=>{
  const h=await harness(t,()=>response(selection,{vote:{status:'available',stage:'committee',scope:'individual-amendment',outcome:'REJECTED',decisions:[{id:'published-decision'}]},stages:[{destination,wording:{...wording,status:'unavailable',mapping:null,passages:null}}]}));
  await h.render(selection);await h.toggle();assert(h.container.textContent.includes('Committee vote: rejected'));assert(h.container.textContent.includes('Unavailable'));
  assert(!h.container.textContent.includes('Same wording'));assert(!h.container.textContent.includes('Not yet'));assert(!h.container.textContent.includes('Compare wording'));
});

test('a comparison produced by the earlier claim rules is rejected',async t=>{
  let version=1;
  const h=await harness(t,()=>response(selection,{version,comparisonVersion:version}));
  await h.render(selection);await h.toggle();
  assert(h.container.textContent.includes('Could not load comparison.'));
  assert(!h.container.textContent.includes('Same wording'));
  version=2;await h.click('Try again');
  assert(h.container.textContent.includes('Could not load comparison.'));
  assert(!h.container.textContent.includes('Same wording'));
});

test('a verified final-act comparison stays clear when the Parliament publication has no legislative body',async t=>{
  const parliament={...destination,kind:'parliament-adopted-text',id:'TA-10-2026-0048'};
  const h=await harness(t,()=>response(selection,{stages:[{destination:parliament,wording:{...wording,status:'unavailable',mapping:null,passages:null}},{destination,wording}]}));
  await h.render(selection);await h.toggle();
  assert(h.container.textContent.includes('Final EU act'));assert(h.container.textContent.includes('Same wording'));
  assert(!h.container.textContent.includes('Parliament’s adopted text'));assert(!h.container.textContent.includes('Unavailable'));
});

test('same wording keeps each published passage without highlighting presentation-only spacing',async t=>{
  const matched={...wording,passages:{...wording.passages,proposed:'4.Questions regarding limitation periods.',destination:{...wording.passages.destination,text:'4. Questions regarding limitation periods.'}}};
  const h=await harness(t,()=>response(selection,{wording:matched,stages:[{destination,wording:matched}]}));
  await h.render(selection);await h.toggle();
  const passages=h.container.querySelectorAll('.wording-diff__passage');
  assert.equal(passages[0].textContent,'4.Questions regarding limitation periods.');assert.equal(passages[1].textContent,'4. Questions regarding limitation periods.');
  assert.equal(h.container.querySelectorAll('.wording-diff ins,.wording-diff del').length,0);
});

test('returning to an exact selection restores both disclosures after the comparison reloads',async t=>{
  let finish;
  const h=await harness(t,(_request,count)=>count===2?new Promise(resolve=>{finish=resolve;}):response());
  h.window.history.replaceState({},'','/comparison-history');
  await h.render(selection);await h.toggle();
  await act(async()=>{const detail=h.container.querySelector('.final-text-check__comparison');detail.open=true;detail.dispatchEvent(new h.window.Event('toggle'));});
  h.remember();
  await h.render({...selection,wordingLanguage:'fr'});assert.equal(h.requests.length,1);assert.equal(h.container.querySelector('.final-text-check').open,false);
  await h.render(selection);
  assert.equal(h.requests.length,2);assert.equal(h.container.querySelector('.final-text-check').open,true);
  assert.equal(h.container.querySelector('.final-text-check').dataset.readerPending,'true');
  await act(async()=>finish(response()));await h.settle();
  assert.equal(h.container.querySelector('.final-text-check__comparison').open,true);
  assert.equal(h.container.querySelector('[data-reader-pending="true"]'),null);
});
