import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const pair={originalId:'B-10-2026-0441',jointId:'RC-10-2026-0441'};
const body='Distinctive source passage that must never become a live announcement.';
function comparison(stage='original-joint',requestedLanguage='en',overrides={}) {
  const actual=overrides.textLanguage===undefined?requestedLanguage:overrides.textLanguage;
  const ids=stage==='original-joint'?[pair.originalId,pair.jointId]:stage==='original-adopted'?[pair.originalId,'TA-10-2026-0339']:[pair.jointId,'TA-10-2026-0339'];
  return {status:'available',stage,requestedLanguage,textLanguage:actual,availableLanguages:['en','fr'],reason:null,
    documents:ids.map(id=>({id,reference:id,title:id,date:'2026-10-08',sourceUrl:`https://data.europarl.europa.eu/distribution/example/${id}_${actual}.docx`,fetchedAt:'2026-10-16T15:00:00Z',language:actual,translationType:'original'})),sources:[],
    summary:{changed:1,added:0,removed:0,unchanged:0,referenceChanged:0},rows:[{kind:'changed',before:{index:0,kind:'paragraph',label:'1',text:body+' Before.'},after:{index:0,kind:'paragraph',label:'1',text:body+' After.'},referenceChanged:false,segments:[{type:'equal',text:body},{type:'removed',text:' Before.'},{type:'added',text:' After.'}]}],...overrides};
}

async function harness(t,initial={}) {
  const window=new Window({url:'http://localhost/'}),requests=[];
  const globals={window,document:window.document,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    for(const request of requests)if(!request.finished){request.finished=true;request.resolve(Response.json({}));}
    await Promise.resolve();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  t.mock.method(globalThis,'fetch',input=>{
    const url=new URL(input,window.location.href);
    assert.match(url.pathname,/\/api\/motion-comparison\/B-10-/,'comparison focus tests only use stubbed comparison requests');
    return new Promise(resolve=>requests.push({url,resolve,finished:false}));
  });
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {MotionComparison}=await loadModule('/src/MotionComparison.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=props=>act(async()=>root.render(createElement(MotionComparison,{...pair,language:'en',...initial,...props})));
  await render();
  const stage=()=>container.querySelectorAll('.explorer-diff-controls select')[0],language=()=>container.querySelectorAll('.explorer-diff-controls select')[1]||null;
  const change=(select,value)=>act(async()=>{assert(select,'Missing native select');select.focus();select.value=value;select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const finish=(request,data,status=200)=>act(async()=>{assert(request&&!request.finished,'Missing unfinished comparison request');request.finished=true;request.resolve(Response.json(data,{status}));});
  const wait=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,400)));
  const status=()=>container.querySelector('[role="status"][aria-live="polite"][aria-atomic="true"]');
  return {window,container,requests,render,stage,language,change,finish,wait,status};
}

test('comparison language selection keeps its native focused control while a different-language route is pending',async t=>{
  const h=await harness(t);await h.finish(h.requests[0],comparison());
  const select=h.language();assert(select);assert.deepEqual([...select.options].map(option=>option.value),['en','fr']);
  await h.change(select,'fr');
  assert.equal(h.requests.at(-1).url.searchParams.get('lang'),'fr');
  assert.equal(h.container.querySelector('.explorer-diff-rows'),null,'pending language routes cannot show old source passages');
  assert(h.language()===select,'the native selector must stay mounted when useData clears the previous-language body');
  assert.equal(document.activeElement,select);assert.equal(select.value,'fr');
  await h.finish(h.requests.at(-1),comparison('original-joint','fr'));
  assert.equal(h.language(),select);assert.equal(document.activeElement,select);assert.equal(select.value,'fr');
  assert.equal(h.container.querySelector('.explorer-diff-rows').lang,'fr');
});

test('comparison errors and retries retain only the current pair catalog, and authoritative unavailable results can clear it',async t=>{
  const h=await harness(t);await h.finish(h.requests[0],comparison());
  const select=h.language();await h.change(select,'fr');
  await h.finish(h.requests.at(-1),{error:{message:'Fixture source failure'}},503);await h.wait();
  assert(h.language()===select);assert(document.activeElement===select);assert.equal(select.value,'fr');
  assert.deepEqual([...select.options].map(option=>option.value),['en','fr']);
  assert.equal(h.container.querySelector('.explorer-diff-rows'),null);assert.equal(h.container.querySelector('.explorer-diff-documents'),null);
  assert.equal(h.status().textContent,'Original to joint comparison could not be loaded.');
  await act(async()=>h.container.querySelector('.explorer-diff-error button').click());
  assert(h.language()===select);assert(document.activeElement===select);assert.equal(h.requests.at(-1).url.searchParams.get('lang'),'fr');
  await h.finish(h.requests.at(-1),comparison('original-joint','fr',{status:'unavailable',reason:'One or both document texts are temporarily unavailable. Try again or open the source files.',summary:null,rows:[]}));
  assert(h.language()===select);assert(document.activeElement===select);assert.equal(select.value,'fr');
  assert.deepEqual([...select.options].map(option=>option.value),['en','fr']);assert.equal(h.container.querySelector('.explorer-diff-documents a').textContent,'Source DOCX · FR ↗');
  assert.equal(h.container.querySelector('.explorer-diff-rows'),null);await h.wait();
  assert.equal(h.status().textContent,'Original to joint comparison unavailable.');
  await act(async()=>h.container.querySelector('.explorer-diff-notice button').click());
  await h.finish(h.requests.at(-1),comparison('original-joint','fr',{status:'unavailable',textLanguage:null,availableLanguages:[],documents:[],summary:null,rows:[],reason:'These two texts have no common language with a supported document file.'}));
  assert(h.language()===select,'an authoritative empty catalog must not remove the existing focused control');
  assert(document.activeElement===select);assert.equal(select.value,'');
  assert.equal(select.options.length,1);assert.equal(select.options[0].value,'');assert.equal(select.options[0].disabled,true);
  assert.equal(h.container.querySelector('.explorer-diff-documents'),null,'empty availability cannot leave old source files on screen');
  assert.equal(h.container.querySelector('.explorer-diff-rows'),null);
});

test('requested comparison language and actual fallback remain distinct while native focus persists',async t=>{
  const h=await harness(t,{language:'hu'});
  assert.equal(h.requests[0].url.searchParams.get('lang'),'hu');
  await h.finish(h.requests[0],comparison('original-joint','hu',{textLanguage:'en'}));
  const select=h.language();assert(select);select.focus();assert.equal(select.value,'en');
  assert.equal(h.container.querySelector('.explorer-diff-rows').lang,'en');assert.match(h.container.querySelector('.explorer-diff-notice').textContent,/is unavailable in one or both texts\. Showing/);
  await h.change(select,'fr');assert.equal(select.value,'fr');assert(h.language()===select);
  assert.equal(h.requests.at(-1).url.searchParams.get('lang'),'fr');assert.equal(h.container.querySelector('.explorer-diff-rows'),null);
  await h.finish(h.requests.at(-1),comparison('original-joint','fr',{textLanguage:'en',availableLanguages:['en']}));
  assert(h.language()===select);assert(document.activeElement===select);assert.equal(select.value,'en');
  assert.deepEqual([...select.options].map(option=>option.value),['en'],'the current response replaces the previously admitted catalog');
  assert.equal(h.container.querySelector('.explorer-diff-rows').lang,'en');assert.equal(h.requests.length,2,'an actual fallback must not silently issue a different requested-language route');
  await h.wait();assert.match(h.status().textContent,/Text language: EN\./);assert.doesNotMatch(h.status().textContent,/Text language: FR/);
});

test('unadmitted actual language metadata keeps the valid requested choice without inventing language options',async t=>{
  for(const actual of ['mul','und'])await t.test(actual,async t=>{
    const h=await harness(t,{language:'hu'}),admitted=['en','hu','fr'];
    await h.finish(h.requests[0],comparison('original-joint','hu',{availableLanguages:admitted}));
    const select=h.language();await h.change(select,'fr');
    assert.equal(h.requests.at(-1).url.searchParams.get('lang'),'fr');
    await h.finish(h.requests.at(-1),comparison('original-joint','fr',{textLanguage:actual,availableLanguages:admitted}));
    assert(h.language()===select);assert(document.activeElement===select);assert.equal(select.value,'fr','the admitted requested choice remains usable when actual metadata is not a selectable language');
    assert.deepEqual([...select.options].map(option=>option.value),admitted,'neither an unavailable placeholder nor the unadmitted actual code becomes an option');
    assert.deepEqual([...select.options].map(option=>option.textContent),admitted.map(code=>new Intl.DisplayNames(['hu'],{type:'language'}).of(code)));
    assert.equal(h.container.querySelector('.explorer-diff-rows').lang,actual,'selector validity does not rewrite actual source-language metadata');
    assert.equal(h.container.querySelector('.explorer-diff-documents a').textContent,'Source DOCX · '+actual.toUpperCase()+' ↗');
    assert.match(h.container.querySelector('.explorer-diff-notice').textContent,/is unavailable in one or both texts\. Showing/);
    await h.wait();assert.match(h.status().textContent,new RegExp('Text language: '+actual.toUpperCase()+'\\.'));
    assert(!h.status().textContent.includes(body));
  });
});

test('rapid language intent ignores obsolete completion, keeps moved focus, and announces only the latest concise comparison',async t=>{
  const h=await harness(t),announcements=[];
  const status=h.status(),observer=new h.window.MutationObserver(()=>{if(status.textContent)announcements.push(status.textContent);});
  observer.observe(status,{subtree:true,childList:true,characterData:true});t.after(()=>observer.disconnect());
  await h.finish(h.requests[0],comparison('original-joint','en',{availableLanguages:['en','fr','hu']}));
  const select=h.language();await h.change(select,'fr');const obsolete=h.requests.at(-1);
  await h.change(select,'hu');const current=h.requests.at(-1);
  assert(h.language()===select);assert.equal(select.value,'hu');assert.equal(current.url.searchParams.get('lang'),'hu');
  const retained=document.createElement('button');retained.textContent='Continue elsewhere';document.body.append(retained);retained.focus();
  await h.finish(current,comparison('original-joint','hu',{availableLanguages:['en','hu']}));await h.wait();
  const expected='Original to joint comparison available. Text language: HU. 1 changed, 0 only in original, 0 only in joint.';
  assert.equal(h.status().textContent,expected);assert(document.activeElement===retained);assert(h.language()===select);assert.equal(select.value,'hu');
  await h.finish(obsolete,comparison('original-joint','fr',{availableLanguages:['de','fr']}));await h.wait();
  assert.deepEqual(announcements,[expected]);assert.equal(h.status().textContent,expected);assert(document.activeElement===retained);
  assert.deepEqual([...select.options].map(option=>option.value),['en','hu']);assert.equal(h.container.querySelector('.explorer-diff-rows').lang,'hu');
  const rows=h.container.querySelector('.explorer-diff-rows');assert.match(rows.textContent,new RegExp(body));
  assert.equal(rows.closest('[aria-live],[role="status"],[role="alert"]'),null);
  for(const region of h.container.querySelectorAll('[aria-live],[role="status"],[role="alert"]'))assert(!region.textContent.includes(body));
  assert(h.status().textContent.length<180,'status remains a concise outcome rather than reading comparison passages');
});

test('stage and exact motion-pair changes cannot inherit an unrelated language catalog or source passages',async t=>{
  const h=await harness(t);await h.finish(h.requests[0],comparison('original-joint','en',{availableLanguages:['en','fr']}));
  await h.change(h.stage(),'original-adopted');const obsolete=h.requests.at(-1);
  assert.equal(h.container.querySelector('.explorer-diff-rows'),null);assert.equal(h.container.querySelector('.explorer-diff-documents'),null);
  assert(!h.language()||![...h.language().options].some(option=>option.value==='fr'),'the prior stage does not establish French availability for adopted text');
  const nextPair={originalId:'B-10-2026-0449',jointId:'RC-10-2026-0449'};
  await h.render(nextPair);const current=h.requests.at(-1);
  assert.equal(current.url.pathname.split('/').at(-1),nextPair.originalId);assert.equal(current.url.searchParams.get('joint'),nextPair.jointId);
  await h.finish(obsolete,comparison('original-adopted','en',{availableLanguages:['en','de']}));
  assert.equal(h.container.querySelector('.explorer-diff-rows'),null);assert.equal(h.container.querySelector('.explorer-diff-documents'),null);
  assert(!h.language()||![...h.language().options].some(option=>option.value==='de'),'an obsolete stage response cannot admit languages for another pair');
  const result=comparison('original-adopted','en',{textLanguage:'it',availableLanguages:['it']});
  result.documents=result.documents.map((document,index)=>{const id=index?'TA-10-2026-0340':nextPair.originalId;return {...document,id,reference:id,title:id,sourceUrl:`https://data.europarl.europa.eu/distribution/example/${id}_it.docx`};});
  await h.finish(current,result);
  assert.deepEqual([...h.language().options].map(option=>option.value),['it']);assert.equal(h.language().value,'it');
  assert.equal(h.container.querySelector('.explorer-diff-rows').lang,'it');assert.match(h.container.querySelector('.explorer-diff-documents').textContent,/B-10-2026-0449/);
  assert.doesNotMatch(h.container.querySelector('.explorer-diff-documents').textContent,/B-10-2026-0441|RC-10-2026-0441/);
});
