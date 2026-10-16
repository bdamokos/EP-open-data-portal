import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

test('question text search keeps country and dates while visual topic filters remain a separate browsing state',async t=>{
  const window=new Window({url:'http://localhost/?view=questions&q-days=365&q-until=2026-10-11&q-country=IT&q-word=water&q-range=2026-10-05_2026-10-11'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const stats={uniqueCurrentMeps:0,denominator:0,referenceDate:'2026-10-11',dimensions:{country:[],group:[],gender:[],age:[]}},searches=[];
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    const url=new URL(input,window.location.href);
    if(url.pathname.endsWith('/insights/questions'))return Response.json({window:{start:'2025-10-12',end:'2026-10-11'},counts:{selectedQuestions:0},selection:{word:'water',wordLabel:'water'},stats,selectedStats:stats,clusters:[],words:[],questions:[],nextOffset:null,facets:{countries:[{code:'IT',count:0,authors:0}]},analysis:{unassignedQuestions:0,missingEnglishTitles:0},coverage:{indexComplete:false,truncated:false}});
    if(url.pathname.endsWith('/corpus/search')){
      searches.push(options?.method==='POST'?JSON.parse(options.body):Object.fromEntries(url.searchParams));
      return Response.json({results:[],hits:[],total:0,limit:20,offset:0,nextOffset:null,truncated:false,query:'water',group:'question',dateBasis:'question',coverage:{complete:false,phase:'waiting',note:'Saved texts only.'}});
    }
    if(url.pathname.endsWith('/corpus/status'))return Response.json({phase:'waiting',coverage:{complete:false,note:'Saved texts only.'}});
    throw new Error('Unexpected request: '+url);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocQuestionTopics}=await vite.ssrLoadModule('/src/PocQuestionTopics.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocQuestionTopics,{language:'en',onBack(){}})));
  assert.equal(container.querySelectorAll('input[type="search"]').length,0,'text fields are collapsed initially');
  assert(container.querySelector('.insight-question-dimensions'));
  const toggle=container.querySelector('button[aria-label="Search question and answer text"]');assert(toggle,'question text search icon');
  await act(async()=>toggle.click());
  assert.equal(container.querySelector('.insight-question-dimensions'),null);
  assert.equal(container.querySelector('.insight-topic-picker'),null);
  assert.equal(container.querySelector('.insight-active-filters'),null,'analytical topic chips must not imply a full-text filter');
  assert.equal(container.querySelector('[data-question-country]').value,'IT');
  assert.match(container.textContent,/across all topics in the selected period/);
  await act(async()=>{const url=new URL(location.href);url.searchParams.set('q-fts-search','water');history.pushState(null,'',url);window.dispatchEvent(new window.Event('popstate'));});
  assert.equal(searches.length,1);
  const search=searches[0];
  assert.equal(search.country,'IT');assert.equal(search.from,'2026-10-05');assert.equal(search.to,'2026-10-11');assert.equal(search.group,'question');
  assert.equal(search.dateBasis||search['date-basis'],'question');
  assert.deepEqual(Array.isArray(search.kinds)?search.kinds:search.kinds.split(','),['question','answer']);
  assert.equal('word' in search,false);assert.equal('cluster' in search,false);
  await act(async()=>toggle.click());
  assert(container.querySelector('.insight-question-dimensions'));
  assert.equal(new URL(location.href).searchParams.get('q-word'),'water','closing text search restores the visual context');
  assert.equal(new URL(location.href).searchParams.get('q-country'),'IT');
  assert.equal(new URL(location.href).searchParams.get('q-range'),'2026-10-05_2026-10-11');
});
