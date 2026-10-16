import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const stats={uniquePeople:3,uniqueCurrentMeps:3,peopleOutsideCurrentRoster:0,denominator:3,referenceDate:'2026-10-16',dimensions:{country:[],group:[],gender:[],age:[]}};
const question=n=>({id:'E-10-2026-'+String(n).padStart(6,'0'),date:'2026-10-01',kind:'QUESTION_WRITTEN',title:'Exact question '+n,authors:[],answers:[]});
const questions=(offset=0)=>({window:{start:'2026-07-01',end:'2026-09-30'},counts:{selectedQuestions:27},selection:{},clusters:[],words:[{word:'water',label:'water',questionCount:27}],stats,selectedStats:stats,analysis:{unassignedQuestions:0,missingEnglishTitles:0},coverage:{indexComplete:false,truncated:false},questions:Array.from({length:offset?2:25},(_,i)=>question(offset+i+1)),offset,limit:25,nextOffset:offset?null:25});

async function harness(t,respond,{query='?view=questions',props={}}={}) {
  const window=new Window({url:'http://localhost/'+query}),frames=new Map();let frame=0;
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,CSS:window.CSS,
    HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:class {observe(){} disconnect(){}},
    requestAnimationFrame:callback=>{frames.set(++frame,callback);return frame;},IS_REACT_ACT_ENVIRONMENT:true};
  window.cancelAnimationFrame=id=>frames.delete(id);
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const calls=[],reveals=[];
  t.mock.method(window.HTMLElement.prototype,'scrollIntoView',function(options){reveals.push({target:this,options,focused:document.activeElement});});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href);calls.push(url);
    assert(url.pathname.endsWith('/insights/questions'),'focus tests must not request corpus, media or remote source data');
    const result=await respond(url);return result instanceof Response?result:Response.json(result);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocQuestionTopics}=await vite.ssrLoadModule('/src/PocQuestionTopics.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=element=>act(async()=>root.render(element));
  await render(createElement(PocQuestionTopics,{language:'en',onBack(){},...props}));
  const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text);
  const click=text=>act(async()=>{const target=button(text);assert(target,'Missing button: '+text);target.focus();target.click();});
  const flushFrames=()=>act(async()=>{const queued=[...frames.values()];frames.clear();queued.forEach(callback=>callback(0));});
  const navigate=query=>act(async()=>{history.replaceState(null,'','/'+query);window.dispatchEvent(new window.PopStateEvent('popstate'));});
  return {window,container,calls,reveals,button,click,flushFrames,navigate,render,component:()=>createElement(PocQuestionTopics,{language:'en',onBack(){},...props}),
    pageHeading:()=>container.querySelector('.insight-intro h1'),resultHeading:()=>container.querySelector('.insight-question-results h2'),
    status:()=>container.querySelector('[role="status"][aria-live="polite"][aria-atomic="true"]')};
}

for(const [label,initialOffset,destination] of [['Next',0,25],['Previous',25,0]])test(`Questions ${label} keeps an explicit page intent through unmount and settles on the requested results`,async t=>{
  const response=deferred(),query='?view=questions&q-days=365&q-until=2026-10-11&q-country=IT&q-word=water&q-range=2026-10-01_2026-10-11'+(initialOffset?'&q-offset='+initialOffset:'');
  const h=await harness(t,url=>Number(url.searchParams.get('offset'))===destination?response.promise:questions(initialOffset),{query});
  assert.equal(document.activeElement,document.body,'initial data completion does not create a page-focus intent');
  const source=h.button(label),historyLength=history.length;source.focus();
  assert.equal(document.activeElement,source);await h.click(label);
  assert.equal(source.isConnected,false,'the data-backed pagination really unmounts during the request');
  assert.equal(h.resultHeading(),null);assert.equal(document.activeElement,h.pageHeading());
  assert.equal(h.reveals.length,0,'the pending heading does not add a scroll policy');
  assert.equal(h.status().textContent,'','no stale page count is published while pending');
  const request=h.calls.at(-1);assert.equal(request.searchParams.get('offset'),String(destination));
  assert.equal(request.searchParams.get('country'),'IT');assert.equal(request.searchParams.get('word'),'water');
  assert.equal(request.searchParams.get('from'),'2026-10-01');assert.equal(request.searchParams.get('to'),'2026-10-11');
  await act(async()=>response.resolve(questions(destination)));
  assert.equal(document.activeElement,h.resultHeading());
  assert.equal(h.reveals.length,1,'the explicit arrival reveals its destination once');
  assert.equal(h.reveals[0].target,h.resultHeading());assert.equal(h.reveals[0].focused,h.resultHeading(),'focus precedes the established results reveal');
  assert.deepEqual(h.reveals[0].options,{block:'start'});
  assert.equal(h.container.querySelector('.insight-question-list h3').textContent,'Exact question '+(destination+1));
  assert.equal(h.container.querySelector('.insight-pagination span').textContent,destination?'26–27 of 27':'1–25 of 27');
  assert.equal(history.length,historyLength+1,'the gesture retains its single existing query-history step');
  assert.equal(new URL(location.href).searchParams.get('q-offset'),destination?String(destination):null);
  assert.equal(new URL(location.href).searchParams.get('q-country'),'IT');
  assert.equal(new URL(location.href).searchParams.get('q-range'),'2026-10-01_2026-10-11');
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,400));});
  assert.match(h.status().textContent,new RegExp('27 questions match these filters. Showing '+(destination+1)+' to '+(destination?27:25)));
  assert.match(h.status().textContent,/Question archive incomplete/);
  await h.flushFrames();assert.equal(document.activeElement,h.resultHeading(),'no late callback refocuses the removed pagination control');
  assert.equal(h.reveals.length,1,'settled statuses and late callbacks do not repeat the destination reveal');
});

test('Questions pagination error and explicit Reload retain orientation without changing the requested offset',async t=>{
  const first=deferred(),retry=deferred();let attempts=0;
  const h=await harness(t,url=>url.searchParams.get('offset')==='25'?(++attempts===1?first.promise:retry.promise):questions());
  await h.click('Next');await act(async()=>first.resolve(Response.json({error:{message:'Fixture unavailable'}},{status:503})));
  assert.equal(document.activeElement,h.pageHeading());assert(h.container.querySelector('[role="alert"]'));
  assert.equal(h.resultHeading(),null);assert.equal(h.status().textContent,'');
  await h.click('Reload');assert.equal(document.activeElement,h.pageHeading());assert.equal(h.container.querySelector('[role="alert"]'),null);
  assert.equal(h.calls.at(-1).searchParams.get('offset'),'25');assert.equal(attempts,2);
  await act(async()=>retry.resolve(questions(25)));
  assert.equal(document.activeElement,h.resultHeading());assert.equal(h.container.querySelector('.insight-pagination span').textContent,'26–27 of 27');
});

test('a generic destination heading and a retained filter after Reload never become page-arrival focus requests',async t=>{
  const initial=deferred(),retry=deferred(),destination=deferred();let attempts=0;
  const h=await harness(t,url=>url.searchParams.get('days')==='180'?destination.promise:++attempts===1?initial.promise:retry.promise);
  h.pageHeading().tabIndex=-1;h.pageHeading().focus();
  await act(async()=>initial.resolve(Response.json({error:{message:'Fixture unavailable'}},{status:503})));
  assert.equal(document.activeElement,h.pageHeading());
  await h.click('Reload');const filter=h.container.querySelector('[data-question-country]');filter.focus();
  await act(async()=>retry.resolve(questions()));
  assert.equal(document.activeElement,filter,'completion does not take focus back from the retained filter');
  assert.equal(h.reveals.length,0,'canceled Reload arrival never scrolls the results into view');
  const cachedHeading=h.resultHeading();await h.navigate('?view=questions&q-days=180');
  h.pageHeading().focus();await act(async()=>destination.resolve(questions()));await h.flushFrames();
  assert.equal(document.activeElement,h.pageHeading(),'a generic destination focus is never enough to request results focus');
  assert(h.resultHeading());assert.notEqual(h.resultHeading(),cachedHeading);
  assert.equal(h.reveals.length,0,'a generic destination focus cannot create arrival scrolling');
});

test('retained filter focus cancels page arrival even if the user later returns to the pending heading',async t=>{
  const response=deferred();const h=await harness(t,url=>url.searchParams.get('offset')==='25'?response.promise:questions());
  await h.click('Next');const filter=h.container.querySelector('[data-question-country]');
  filter.focus();h.pageHeading().focus();
  await act(async()=>response.resolve(questions(25)));
  assert.equal(document.activeElement,h.pageHeading(),'returning to the heading cannot revive a canceled intent');
  assert.equal(h.container.querySelector('.insight-pagination span').textContent,'26–27 of 27');
  assert.equal(h.reveals.length,0,'returning to the old anchor cannot revive destination scrolling');
});

test('a newer country gesture retains its filter and fences old page data and queued scroll restoration',async t=>{
  const oldPage=deferred(),filtered=deferred();
  const h=await harness(t,url=>url.searchParams.get('country')==='HU'?filtered.promise:url.searchParams.get('offset')==='25'?oldPage.promise:questions());
  await h.click('Next');const filter=h.container.querySelector('[data-question-country]');
  await act(async()=>{filter.focus();filter.value='HU';filter.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
  assert.equal(new URL(location.href).searchParams.get('q-offset'),null);assert.equal(new URL(location.href).searchParams.get('q-country'),'HU');
  await act(async()=>oldPage.resolve(questions(25)));
  assert.equal(h.resultHeading(),null,'an old response cannot populate the newer filter scope');assert.equal(document.activeElement,filter);
  await act(async()=>filtered.resolve(questions()));
  assert.equal(document.activeElement,filter);const until=h.container.querySelector('input[type="date"]'),main=h.container.querySelector('main');
  main.scrollTop=73;until.focus();await h.flushFrames();
  assert.equal(document.activeElement,until,'a queued filter restoration cannot reclaim focus after another control is chosen');
  assert.equal(main.scrollTop,73,'the canceled restoration cannot undo a newer scroll position');
  assert.equal(h.reveals.length,0,'a superseded page cannot reveal results from another filter scope');
});

test('Back restoration, text-search activation and remount do not inherit an old page-focus intent',async t=>{
  for(const action of ['history','text-search','remount'])await t.test(action,async t=>{
    const response=deferred();const h=await harness(t,url=>url.searchParams.get('offset')==='25'?response.promise:questions());
    await h.click('Next');let retained;
    if(action==='history'){
      await h.navigate('?view=questions');retained=h.container.querySelector('[data-question-country]');retained.focus();
    }else if(action==='text-search'){
      await act(async()=>{const toggle=h.container.querySelector('button[aria-label="Search question and answer text"]');toggle.focus();toggle.click();});
      await h.flushFrames();retained=h.container.querySelector('input[type="search"]');assert(retained);retained.focus();
    }else{
      await h.render(null);retained=document.createElement('button');retained.textContent='Retained navigation';document.body.append(retained);retained.focus();await h.render(h.component());
    }
    await act(async()=>response.resolve(questions(25)));await h.flushFrames();
    assert.equal(document.activeElement,retained);
    assert.equal(h.reveals.length,0,'history, text search and remount do not inherit arrival scrolling');
    if(action==='history')assert.equal(h.container.querySelector('.insight-pagination span').textContent,'1–25 of 27');
    if(action==='text-search'){assert.equal(h.resultHeading(),null);assert.equal(h.status().textContent,'','visual result announcements stay separate from full-text search');}
  });
});
