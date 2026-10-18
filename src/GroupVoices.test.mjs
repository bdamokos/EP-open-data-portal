import {viewReady} from './test-support/viewReady.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
const basePeople=[{id:'42',name:'Éva Example',total:3,subjects:{foreign:2,climate:1}},...Array.from({length:22},(_,i)=>({id:String(100+i),name:'Speaker '+String(i+1).padStart(2,'0'),total:1,subjects:{foreign:1}}))];
const coverage={initialized:true,observedOralRecords:25,pending:0,truncated:false,note:'Available recorded designations · partial coverage'};
async function harness(t,query='?view=groups&gv-group=PPE&gv-tab=people'){
 const window=new Window({url:'http://localhost/'+query,settings:{disableIframePageLoading:true,disableCSSFileLoading:true}});
 const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,ResizeObserver:class {observe(){} disconnect(){}},IntersectionObserver:class {observe(){} disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLElement.prototype.scrollTo=function(){};
 let vite,root,fail=false,deferPerson=false;const calls=[],delays=[],personResponses=[];
 t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input,location.href);if(url.pathname.startsWith('/api/portrait/'))return new Response(null,{status:404});calls.push(url);assert.equal(url.pathname,'/api/insights/group-voices','No directory, corpus or upstream fetch is needed.');
  if(fail)return Response.json({error:{message:'Unavailable'}},{status:503});
  if(url.searchParams.get('group')==='RENEW')return new Promise(resolve=>delays.push(resolve));
  const people=url.searchParams.get('group')==='ESN'?[{id:'7',name:'Zero Example',total:1,subjects:{climate:1}}]:basePeople,selected=people.filter(p=>!url.searchParams.get('person')||url.searchParams.get('person')===p.id),subject=url.searchParams.get('subject'),total=selected.reduce((n,p)=>n+(subject?p.subjects[subject]||0:p.total),0);
  const result={people,months:['2026-10','2026-09'],window:{from:'2024-07-16',to:'2026-10-17'},contributions:selected.slice(0,20).map(p=>({id:'MTG-PL-2026-10-06-OTH-'+p.id,personId:p.id,date:'2026-10-06',subject:subject||'foreign',title:'Exact contribution '+p.id,titleLanguage:'en',websiteUrl:'https://www.europarl.europa.eu/doceo/document/CRE-10-2026-10-06-OTH-'+p.id+'_EN.html'})),total,nextOffset:null,coverage,groupSubjects:[{id:'PPE',total:12,subjects:{foreign:6,climate:2,unclassified:4}},{id:'ECR',total:5,subjects:{foreign:1,unclassified:1}},{id:'ESN',total:3,subjects:{unclassified:3}}]};
  if(deferPerson&&url.searchParams.has('person'))return new Promise(resolve=>personResponses.push(()=>resolve(Response.json(result))));
  return Response.json(result);
 });
 vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {default:App}=await vite.ssrLoadModule('/src/App.tsx'),{createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
 t.after(async()=>{await act(async()=>root.unmount());delays.forEach(resolve=>resolve(Response.json({people:[],months:[],coverage,window:{}})));await vite.close();await window.happyDOM.close();for(const [key,d] of originals)d?Object.defineProperty(globalThis,key,d):delete globalThis[key];});
 await act(async()=>root.render(createElement(App)));await viewReady(container);
 const click=async node=>{await act(async()=>{assert(node);node.focus();node.click();});await viewReady(container);};
 const restore=url=>act(async()=>{history.replaceState(null,'',url);window.dispatchEvent(new window.PopStateEvent('popstate'));});
 const input=async text=>act(async()=>{const field=container.querySelector('.gv-search input');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(field,text);field.dispatchEvent(new window.InputEvent('input',{bubbles:true,data:text,inputType:'insertText'}));});
 return {window,container,calls,click,restore,input,fail:()=>{fail=true;},delays,deferPerson:()=>{deferPerson=true;},finishPerson:()=>act(async()=>{personResponses.splice(0).forEach(resolve=>resolve());})};
}
test('integrated group navigation preserves the independent People selector, exact subject counts and Back state',async t=>{
 const h=await harness(t),name=()=>h.container.querySelector('[data-gv-person="42"]'),first=name();
 assert.equal(h.container.querySelectorAll('.gv-person').length,15);assert.match(h.container.textContent,/Foreign affairs 2/);
 await h.click(first);assert.equal(new URLSearchParams(location.search).get('gv-person'),'42');assert.equal(h.container.querySelectorAll('.gv-person').length,15);assert.equal(document.activeElement,first);assert.equal(name(),first);
 await h.click(h.container.querySelector('.gv-person.is-selected .gv-person-subjects button'));assert.match(h.container.querySelector('.gv-person.is-selected').textContent,/2Also this period: Climate & energy 1/);assert.match(h.container.querySelector('.gv-summary').textContent,/2recorded oral contributions1speaker1subjects/);
 await h.click(name());assert.equal(new URLSearchParams(location.search).get('gv-person'),null);assert.equal(new URLSearchParams(location.search).get('gv-subject'),'foreign');
 await h.click(name());await h.click(h.container.querySelector('.gv-jump'));assert.equal(document.activeElement,h.container.querySelector('.gv-contributions h2'));assert.equal(location.hash,'');
 const before=location.href;await h.click(name());await act(async()=>{const popped=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history.back();await popped;});assert.equal(location.href,before);assert.equal(new URLSearchParams(location.search).get('gv-person'),'42');
 assert.equal(h.container.querySelector('[role="dialog"]'),null);
});
test('search typing is one undo step; selected rows past 15 remain visible without expanding the saved limit',async t=>{
 const h=await harness(t,'?view=groups&gv-tab=people&gv-person=121');assert.equal(h.container.querySelectorAll('.gv-person').length,23);assert.equal(new URLSearchParams(location.search).has('gv-people-limit'),false);
 await h.click(h.container.querySelector('[data-gv-person="121"]'));assert.equal(h.container.querySelectorAll('.gv-person').length,15);
 const length=history.length;await h.input('É');await h.input('Éva');assert.equal(history.length,length+1);assert.equal(h.container.querySelectorAll('.gv-person').length,1);
 await act(async()=>{const popped=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history.back();await popped;});assert.equal(h.container.querySelector('.gv-search input').value,'');assert.equal(h.container.querySelectorAll('.gv-person').length,15);
 await h.restore('/?view=groups&gv-tab=time&gv-person=42&gv-subject=climate');assert.equal(h.container.querySelector('.gv-tabs [aria-pressed=true]').textContent,'Subjects');assert.match(h.container.querySelector('.gv-subjects').textContent,/Climate & energy/);assert.equal(h.container.querySelector('.gv-person'),null);
});
test('changing scope with delayed or failed data hides previous results and ignores late responses',async t=>{
 const h=await harness(t);const select=h.container.querySelector('.gv-controls select');
 await act(async()=>{select.value='RENEW';select.dispatchEvent(new window.Event('change',{bubbles:true}));});assert.equal(h.container.querySelector('.gv-person'),null);assert.equal(h.container.querySelector('.gv-contributions article'),null);
 h.fail();await h.restore('/?view=groups&gv-group=ECR&gv-tab=people');assert(h.container.querySelector('[role=alert]'));assert.equal(h.container.querySelector('.gv-person'),null);
 await act(async()=>{h.delays.forEach(resolve=>resolve(Response.json({people:basePeople,months:[],coverage,window:{}})));});assert.equal(new URLSearchParams(location.search).get('gv-group'),'ECR');assert.equal(h.container.querySelector('.gv-person'),null);
});

test('person toggles from Contributions retain their local focus while the filtered page loads',async t=>{
 for(const tab of ['subjects','people'])await t.test(tab,async t=>{
  const h=await harness(t,'?view=groups&gv-tab='+tab),button=h.container.querySelector('.gv-contribution-person'),key=button.dataset.gvContribution;
  h.deferPerson();await h.click(button);assert.equal(document.activeElement,h.container.querySelector('.gv-contributions h2'));assert.equal(h.container.querySelector('.gv-contribution-person'),null);
  await h.finishPerson();const restored=h.container.querySelector('[data-gv-contribution="'+key+'"]');assert.equal(document.activeElement,restored);assert(!document.activeElement.hasAttribute('data-gv-person'));
  await h.click(restored);assert.equal(new URLSearchParams(location.search).get('gv-person'),null);assert.equal(document.activeElement,h.container.querySelector('[data-gv-contribution="'+key+'"]'));
 });
});

test('defaults to the largest group and People; a person subject applies both filters; group columns compare classified shares',async t=>{
 const h=await harness(t,'?view=groups'),params=()=>new URLSearchParams(location.search);
 assert.equal(h.calls[0].searchParams.get('group'),'PPE');assert.equal(h.container.querySelector('.gv-tabs [aria-pressed=true]').textContent,'People');assert.match(h.container.querySelector('.gv-people h2').textContent,/Who speaks for PPE/);
 assert(h.container.querySelector('.gv-person .insight-portrait'));
 await h.click(h.container.querySelector('[data-gv-person="100"]').closest('.gv-person').querySelector('.gv-person-subjects button'));
 assert.equal(params().get('gv-person'),'100');assert.equal(params().get('gv-subject'),'foreign');assert.equal(h.calls.at(-1).searchParams.get('person'),'100');assert.equal(h.calls.at(-1).searchParams.get('subject'),'foreign');
 const chip=h.container.querySelector('.gv-person.is-selected .gv-person-subjects button');assert.equal(chip.getAttribute('aria-pressed'),'true');
 await h.click(chip);assert.equal(params().get('gv-person'),'100');assert.equal(params().get('gv-subject'),null);
 await h.click([...h.container.querySelectorAll('.gv-tabs button')].find(b=>b.textContent==='Subjects'));
 const columns=[...h.container.querySelector('.gv-subject .gv-compare').querySelectorAll('button')];assert.equal(columns.length,8);
 assert.match(columns[0].getAttribute('aria-label'),/^PPE: 75% of classified contributions \(6\)/);assert.equal(columns[0].getAttribute('aria-pressed'),'true');
 assert.match(columns.find(b=>/^ESN/.test(b.getAttribute('aria-label'))).getAttribute('aria-label'),/No classified records/);
 await h.click(columns.find(b=>/^ECR/.test(b.getAttribute('aria-label'))));assert.equal(params().get('gv-group'),'ECR');assert.equal(params().get('gv-subject'),'foreign');assert.equal(params().get('gv-person'),null);
 assert.equal(document.activeElement,h.container.querySelector('[data-gv-compare="foreign:ECR"]'),'Focus returns to the destination column after loading.');
 await h.click(h.container.querySelector('[data-gv-compare="foreign:ESN"]'));assert.equal(params().get('gv-group'),'ESN');
 const card=h.container.querySelector('.gv-subject');assert.match(card.textContent,/Foreign affairs0/);assert(card.querySelector('.gv-compare'));assert.equal(document.activeElement,h.container.querySelector('[data-gv-compare="foreign:ESN"]'));assert(h.container.querySelector('.gv-subjects .gv-empty'));
});
