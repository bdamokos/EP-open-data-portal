import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {readExplorerParam,explorerParams} from './explorerQuery.mjs';

test('addressee links retain exact organisations and reject malformed selections',()=>{
  for(const value of ['org/COM','org/CS','org/HRVP','unavailable']) {
    const query=new URLSearchParams({'q-addressee':value,'q-country':'DK'});
    assert.equal(readExplorerParam(explorerParams(query,'questions'),'q-addressee',''),value);
    assert.equal(explorerParams(query,'legislation').has('q-addressee'),false);
  }
  for(const value of ['COM','https://example.org/org/CS','org/COM/','org/'+('A'.repeat(101))])assert.equal(readExplorerParam(new URLSearchParams({'q-addressee':value}),'q-addressee',''),'');
});

const stats={uniquePeople:1,uniqueCurrentMeps:1,peopleOutsideCurrentRoster:0,denominator:1,referenceDate:'2026-10-20',dimensions:{country:[],group:[],gender:[],age:[]}};
const question=(id,recipient)=>({id:'O-10-2026-'+id,date:'2026-10-15',kind:'QUESTION_ORAL',title:'European medicines policy',titleLanguage:'en',authors:[],answers:[],addressees:recipient?[{id:recipient,uri:'https://data.europarl.europa.eu/'+recipient,label:recipient==='org/CS'?'Council':recipient==='org/COM'?'Commission':recipient,participationIds:[]}]:[]});
const questions=[question('000043','org/CS'),question('000044','org/COM'),question('000045'),question('000046','org/HRVP'),question('000047','org/Unfamiliar_1')];
function response(url) {
  const recipient=url.searchParams.get('addressee'),selected=questions.filter(q=>!recipient||recipient==='unavailable'?!recipient||!q.addressees.length:q.addressees.some(a=>a.id===recipient));
  return {window:{start:'2026-07-23',end:'2026-10-20'},counts:{selectedQuestions:selected.length},selection:{addressee:recipient},clusters:[],words:[],stats,selectedStats:stats,analysis:{language:'en',unassignedQuestions:0,missingEnglishTitles:0},coverage:{indexComplete:false,truncated:false},questions:selected,facets:{countries:[],addressees:[{id:'org/CS',label:'Council',count:1},{id:'org/COM',label:'Commission',count:1},{id:'org/HRVP',label:'org/HRVP',count:1},{id:'org/Unfamiliar_1',label:'org/Unfamiliar_1',count:1},{id:'unavailable',label:'Addressee unavailable',count:1}]},offset:0,limit:25,nextOffset:null};
}

test('question addressee controls reset paging, preserve combined scopes and filter text-search requests',async t=>{
  const window=new Window({url:'http://localhost/?view=questions&q-country=DK&q-offset=25&q-read=old&q-fts-page=3'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,CSS:window.CSS,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:class {observe(){} disconnect(){}},requestAnimationFrame:window.requestAnimationFrame.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;const requests=[];
  t.after(async()=>{if(root)await act(async()=>root.unmount());await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async(input,init)=>{
    const url=new URL(input,location.href);requests.push({url,body:init?.body?JSON.parse(init.body):null});
    if(url.pathname.endsWith('/corpus/search'))return Response.json({results:[],total:0,offset:0,limit:20,nextOffset:null,coverage:{complete:false}});
    assert(url.pathname.endsWith('/insights/questions'));return Response.json(response(url));
  });
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {QuestionTopics}=await loadModule('/src/QuestionTopics.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(QuestionTopics,{language:'en',onBack(){}})));
  assert.deepEqual([...container.querySelectorAll('.insight-question-addressee')].map(n=>n.textContent),['To the Council','To the Commission','Addressee unavailable','To the Vice-President / High Representative','To the org/Unfamiliar_1']);
  assert.deepEqual([...container.querySelectorAll('.insight-question-reference')].map(n=>n.textContent),['O-000043/2026','O-000044/2026','O-000045/2026','O-000046/2026','O-000047/2026']);
  const change=async value=>act(async()=>{const select=container.querySelector('[data-question-addressee]');select.focus();select.value=value;select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  await change('org/HRVP');
  assert.equal(container.querySelector('[data-question-addressee] option[value="org/HRVP"]').textContent,'Vice-President / High Representative (1 question)');
  assert.equal(container.querySelector('.insight-question-addressee').textContent,'To the Vice-President / High Representative');
  assert.match(container.querySelector('[aria-label="Active filters"]').textContent,/To the Vice-President \/ High Representative/);
  assert.equal(new URL(location.href).searchParams.get('q-addressee'),'org/HRVP');
  assert.equal(requests.at(-1).url.searchParams.get('addressee'),'org/HRVP');
  await act(async()=>{history.replaceState(null,'','/?view=questions&q-addressee=org%2FHRVP&q-country=DK&q-fts-search=medicines');window.dispatchEvent(new window.PopStateEvent('popstate'));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  assert.equal(requests.findLast(r=>r.body).body.addressee,'org/HRVP');
  assert.match(container.querySelector('.explorer-search-scope').textContent,/addressed to Vice-President \/ High Representative/);
  await act(async()=>container.querySelector('[aria-label="Close text search"]').click());
  await change('org/CS');
  let query=new URL(location.href).searchParams;assert.equal(query.get('q-addressee'),'org/CS');assert.equal(query.get('q-country'),'DK');for(const key of ['q-offset','q-read','q-fts-page','q-fts-read'])assert.equal(query.has(key),false,key);
  assert.equal(requests.at(-1).url.searchParams.get('addressee'),'org/CS');assert.equal(requests.at(-1).url.searchParams.get('offset'),'0');assert.equal(container.querySelectorAll('.insight-question-list>article').length,1);
  await act(async()=>{history.replaceState(null,'','/?view=questions&q-addressee=org%2FCOM&q-country=DK&q-fts-search=medicines');window.dispatchEvent(new window.PopStateEvent('popstate'));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  const search=requests.findLast(r=>r.body);assert.equal(search.body.addressee,'org/COM');assert.equal(search.body.country,'DK');assert.equal(search.body.group,'question');assert.equal(search.body.offset,0);
  await change('org/CS');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  assert.equal(requests.findLast(r=>r.body).body.addressee,'org/CS','mounted text search follows recipient changes');
  await act(async()=>{history.replaceState(null,'','/?view=questions&q-addressee=unavailable&q-fts-closed=1');window.dispatchEvent(new window.PopStateEvent('popstate'));});
  assert.equal(container.querySelector('[data-question-addressee]').value,'unavailable');assert.equal(container.querySelectorAll('.insight-question-list>article').length,1);
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Clear all filters').click());
  query=new URL(location.href).searchParams;assert.equal(query.has('q-addressee'),false);assert.equal(container.querySelectorAll('.insight-question-list>article').length,5);
});
