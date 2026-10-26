import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,390));});
const block=(text,index=0)=>({index,kind:'paragraph',label:String(index+1),text});
function comparison(request,overrides={}) {
  const language=request.url.searchParams.get('lang'),stage=request.url.searchParams.get('stage');
  return {status:'available',stage,requestedLanguage:language,textLanguage:language,availableLanguages:['en','fr'],reason:null,
    summary:{changed:1,added:0,removed:0,unchanged:1,referenceChanged:0},
    documents:[request.url.pathname.split('/').at(-1),request.url.searchParams.get('joint')].map(id=>({id,reference:id,title:id,date:'2026-10-08',sourceUrl:`https://data.europarl.europa.eu/distribution/example/${id}_${language}.docx`,fetchedAt:'2026-10-16T15:00:00Z',language,translationType:'original',stale:false,refreshError:null})),
    sources:[{url:'https://data.europarl.europa.eu/eli/dl/event/MTG-PL-2026-10-08',fetchedAt:'2026-10-16T15:00:00Z',stale:false,refreshError:null}],
    rows:[{kind:'changed',before:block('Full original public passage.'),after:block('Full revised public passage.'),referenceChanged:false,segments:[{type:'equal',text:'Full '},{type:'removed',text:'original'},{type:'added',text:'revised'},{type:'equal',text:' public passage.'}]},
      {kind:'unchanged',before:block('Full unchanged public passage.',1),after:block('Full unchanged public passage.',1),referenceChanged:false,segments:[{type:'equal',text:'Full unchanged public passage.'}]}],...overrides};
}
async function harness(t) {
  const window=new Window({url:'http://localhost/'}),globals={window,document:window.document,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const requests=[];let root,loadModule;
  t.after(async()=>{
    if(root)await act(async()=>{root.unmount();for(const request of requests)if(!request.done){request.done=true;request.resolve(Response.json(comparison(request)));}});
    if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  t.mock.method(globalThis,'fetch',input=>new Promise(resolve=>requests.push({url:new URL(input,window.location.href),resolve,done:false})));
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {MotionComparison}=await loadModule('/src/MotionComparison.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=(props={})=>act(async()=>root.render(createElement(MotionComparison,{originalId:'B-10-2026-0441',jointId:'RC-10-2026-0441',language:'en',...props})));
  const respond=(index,overrides={},status=200)=>act(async()=>{const request=requests[index];assert(request&&!request.done,'request must still be pending');request.done=true;request.resolve(Response.json(status===200?comparison(request,overrides):{error:{message:overrides.error||'Temporary comparison source failure'}},{status}));});
  const change=(label,value)=>act(async()=>{const control=[...container.querySelectorAll('.explorer-diff-controls label')].find(node=>node.textContent.startsWith(label))?.querySelector('select');assert(control);control.value=value;control.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const status=()=>container.querySelector('[role="status"][aria-atomic="true"]');
  return {window,container,requests,render,respond,change,status,clear:()=>act(async()=>root.render(null))};
}
const liveAncestor=node=>node.closest('[aria-live],[role="status"],[role="alert"],[role="log"],[role="marquee"],[role="timer"]');
function record(h,t) {
  const messages=[],observer=new h.window.MutationObserver(()=>{const message=h.status()?.textContent;if(message)messages.push(message);});
  observer.observe(h.status(),{subtree:true,childList:true,characterData:true});t.after(()=>observer.disconnect());return messages;
}

test('comparison announces one narrow settled result; full wording, provenance and controls remain outside live regions',async t=>{
  const h=await harness(t);await h.render();
  const status=h.status(),stage=h.container.querySelector('select');stage.focus();
  assert.equal(status.textContent,'');assert.equal(status.lang,'en');assert.equal(status.getAttribute('aria-live'),'polite');
  const messages=record(h,t);await h.respond(0);await settle();
  assert.match(status.textContent,/Original to joint comparison available.*Text language: EN.*1 changed/);
  assert.equal(messages.length,1);assert.equal(document.activeElement,stage);assert.equal(h.container.querySelector('select'),stage);
  const passages=[...h.container.querySelectorAll('.explorer-diff-passage p')];assert.equal(passages.length,4);
  assert.match(passages.map(node=>node.textContent).join(' '),/Full .*original.*revised.* public passage/);
  for(const node of [...passages,...h.container.querySelectorAll('.explorer-diff-controls,.explorer-diff-documents,.explorer-diff-sources,.explorer-diff-checkbox')])assert.equal(liveAncestor(node),null);
  assert.equal(h.container.querySelectorAll('a[href$=".docx"]').length,2);assert.equal(h.container.querySelector('.explorer-diff-sources'),null);
  assert.equal(h.container.querySelector('.explorer-diff-rows').lang,'en');
  await act(async()=>h.container.querySelector('input[type="checkbox"]').click());await settle();
  assert.equal(h.container.querySelectorAll('.explorer-diff-row').length,1);assert.equal(messages.length,1,'filtering unchanged passages must not repeat completion');
  for(const paragraph of h.container.querySelectorAll('.explorer-diff-passage p'))assert.equal(liveAncestor(paragraph),null);
  assert.equal(h.requests.length,1);assert(status.textContent.length<180);assert.doesNotMatch(status.textContent,/Full original|Full revised|Full unchanged|2026-10-16|https:/);
});

test('only the current stage, language and exact document pair can settle or announce; obsolete and unmounted outcomes are silent',async t=>{
  const h=await harness(t);await h.render();const messages=record(h,t),stage=h.container.querySelector('select');stage.focus();
  await h.change('Stages','original-adopted');await h.change('Stages','joint-adopted');
  await h.respond(1);await h.respond(0);await settle();assert.equal(h.status().textContent,'');assert.equal(h.container.querySelector('.explorer-diff-row'),null);
  await h.respond(2);await settle();assert.match(h.status().textContent,/Joint to adopted comparison available/);assert.equal(messages.length,1);assert.equal(document.activeElement,stage);
  await h.change('Text language','fr');assert.equal(h.status().textContent,'');
  await h.render({originalId:'B-10-2026-0999'});await h.render({originalId:'B-10-2026-0999',jointId:'RC-10-2026-0999'});
  await h.respond(3,{error:'Obsolete language failure'},503);await h.respond(4);await settle();
  assert.equal(h.status().textContent,'');assert.equal(h.container.querySelector('.explorer-diff-row'),null);assert.doesNotMatch(h.container.textContent,/Obsolete language failure/);
  await h.respond(5);await settle();assert.match(h.status().textContent,/Joint to adopted comparison available.*Text language: EN/);
  assert.equal(messages.length,2);assert.match(h.container.querySelector('.explorer-diff-documents').textContent,/B-10-2026-0999.*RC-10-2026-0999/);assert.equal(h.container.querySelector('.explorer-diff-rows').lang,'en');assert.equal(h.requests[5].url.searchParams.get('lang'),'en','a new document pair starts in the interface language');assert.equal(document.activeElement,stage);
  await h.change('Stages','original-joint');await h.clear();await h.respond(6);await settle();assert.equal(h.container.textContent,'');assert.equal(messages.length,2);
});

test('errors and unavailable results stay concise, retry repeats deliberate outcomes, and a language fallback remains honest',async t=>{
  const h=await harness(t);await h.render();const messages=record(h,t);
  await h.respond(0,{error:'Temporary source failure with full diagnostic text'},503);await settle();
  assert.match(h.container.querySelector('.explorer-diff-error').textContent,/Temporary source failure with full diagnostic text/);assert.equal(h.container.querySelector('[role="alert"]'),null);
  assert.equal(h.status().textContent,'Original to joint comparison could not be loaded.');assert.equal(messages.length,1);
  await act(async()=>h.container.querySelector('.explorer-diff-error button').click());assert.equal(h.status().textContent,'');
  await h.respond(1,{error:'Temporary source failure with full diagnostic text'},503);await settle();assert.equal(messages.length,2,'the same error after an explicit retry is announced again');
  const unavailable={status:'unavailable',reason:'No published adopted text explicitly links to this joint motion.',summary:null,rows:[],textLanguage:null};
  await act(async()=>h.container.querySelector('.explorer-diff-error button').click());await h.respond(2,unavailable);await settle();
  assert.equal(h.status().textContent,'Original to joint comparison unavailable.');assert.match(h.container.textContent,/No published adopted text explicitly links/);assert.equal(h.container.querySelector('.explorer-diff-row'),null);
  await act(async()=>h.container.querySelector('.explorer-diff-notice button').click());assert.equal(h.status().textContent,'');await h.respond(3,unavailable);await settle();
  assert.equal(messages.length,4,'the same unavailable outcome after an explicit retry is announced again');
  await h.change('Text language','fr');await h.respond(4,{textLanguage:'en'});await settle();
  assert.match(h.status().textContent,/available.*Text language: EN/);assert.match(h.container.querySelector('.text-language-note').textContent,/French unavailable.*showing English/);assert.equal(h.container.querySelector('.explorer-diff-rows').lang,'en');
});

test('missing summaries preserve unknown counts and known passages without claiming no differences',async t=>{
  const h=await harness(t);await h.render();await h.respond(0,{summary:null});await settle();
  assert.equal(h.container.querySelector('.explorer-diff-summary').textContent,'— changed · — only in original · — only in joint');
  assert.match(h.container.querySelector('.explorer-diff-checkbox').textContent,/Show unchanged passages \(—\)/);assert.equal(h.container.querySelectorAll('.explorer-diff-row').length,2);
  assert.match(h.status().textContent,/Comparison counts unavailable/);assert.doesNotMatch(h.status().textContent,/0 changed/);assert.doesNotMatch(h.container.textContent,/No wording differences\./);
  await h.change('Stages','original-adopted');await h.respond(1,{summary:null,rows:[]});await settle();
  assert.match(h.container.textContent,/Comparison unavailable\./);assert.doesNotMatch(h.container.textContent,/No wording differences\./);
  await h.change('Stages','joint-adopted');await h.respond(2,{summary:{changed:0,added:0,removed:0,unchanged:1,referenceChanged:0},rows:comparison(h.requests[2]).rows.slice(1)});await settle();
  assert.match(h.container.textContent,/No wording differences\./);assert.match(h.status().textContent,/0 changed/);
});

test('saved sources and cached refresh failures retain wording and provenance with concise saved-data qualifiers',async t=>{
  const h=await harness(t);let now=Date.now();t.mock.method(Date,'now',()=>now);
  await h.render();await h.respond(0,{sources:[{url:'https://data.europarl.europa.eu/eli/dl/event/MTG-PL-2026-10-08',fetchedAt:'2026-10-16T15:00:00Z',stale:true,refreshError:'Source refresh failed'}]});await settle();
  assert.match(h.status().textContent,/comparison available/);assert.doesNotMatch(h.container.textContent,/Showing saved sources/);
  await h.clear();now+=31_000;await h.render();assert.equal(h.requests.length,2);assert.equal(h.status().textContent,'');assert.equal(h.container.querySelectorAll('.explorer-diff-row').length,2,'cached wording remains while refreshing');
  await h.respond(1,{error:'Refresh unavailable'},503);await settle();
  assert.equal(h.status().textContent,'Original to joint comparison refresh failed. Showing saved comparison.');assert.equal(h.container.querySelectorAll('.explorer-diff-row').length,2);assert.equal(h.container.querySelectorAll('a[href$=".docx"]').length,2);
  assert.match(h.container.querySelector('.explorer-diff-error').textContent,/Refresh unavailable/);assert.equal(liveAncestor(h.container.querySelector('.explorer-diff-passage p')),null);
  await act(async()=>h.container.querySelector('.explorer-diff-error button').click());assert.equal(h.status().textContent,'');assert.equal(h.container.querySelectorAll('.explorer-diff-row').length,2);
  await h.respond(2);await settle();assert.match(h.status().textContent,/comparison available/);assert.doesNotMatch(h.status().textContent,/refresh failed|Showing saved/);
});
