import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
const people=[{id:'42',name:'Éva Example',total:3,subjects:{foreign:2,climate:1}},...Array.from({length:22},(_,i)=>({id:String(100+i),name:'Speaker '+String(i+1).padStart(2,'0'),total:1,subjects:{foreign:1}}))];
const coverage={initialized:true,observedOralRecords:25,pending:0,truncated:false,note:'Available recorded designations · partial coverage'};
async function harness(t,query='?poc=1&view=groups&gv-tab=people'){
 const window=new Window({url:'http://localhost/'+query,settings:{disableIframePageLoading:true,disableCSSFileLoading:true}});
 const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,HTMLElement:window.HTMLElement,ResizeObserver:class {observe(){} disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLElement.prototype.scrollTo=function(){};
 let vite,root,fail=false;const calls=[],delays=[];
 t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input,location.href);calls.push(url);assert.equal(url.pathname,'/api/poc/insights/group-voices','No directory, corpus or upstream fetch is needed.');
  if(fail)return Response.json({error:{message:'Unavailable'}},{status:503});
  if(url.searchParams.get('group')==='PPE')return new Promise(resolve=>delays.push(resolve));
  if(!url.searchParams.has('part'))return Response.json({people,months:['2026-10','2026-09'],coverage,window:{from:'2024-07-16',to:'2026-10-17'}});
  const selected=people.filter(p=>!url.searchParams.get('person')||url.searchParams.get('person')===p.id),subject=url.searchParams.get('subject'),total=selected.reduce((n,p)=>n+(subject?p.subjects[subject]||0:p.total),0);
  return Response.json({contributions:selected.slice(0,20).map(p=>({id:'MTG-PL-2026-10-06-OTH-'+p.id,personId:p.id,date:'2026-10-06',subject:subject||'foreign',title:'Exact contribution '+p.id,titleLanguage:'en',websiteUrl:'https://www.europarl.europa.eu/doceo/document/CRE-10-2026-10-06-OTH-'+p.id+'_EN.html'})),total,nextOffset:null,coverage});
 });
 vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {default:PocApp}=await vite.ssrLoadModule('/src/PocApp.tsx'),{createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
 t.after(async()=>{await act(async()=>root.unmount());delays.forEach(resolve=>resolve(Response.json({people:[],months:[],coverage,window:{}})));await vite.close();await window.happyDOM.close();for(const [key,d] of originals)d?Object.defineProperty(globalThis,key,d):delete globalThis[key];});
 await act(async()=>root.render(createElement(PocApp)));
 const click=node=>act(async()=>{assert(node);node.focus();node.click();});
 const restore=url=>act(async()=>{history.replaceState(null,'',url);window.dispatchEvent(new window.PopStateEvent('popstate'));});
 const input=async text=>act(async()=>{const field=container.querySelector('.gv-search input');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(field,text);field.dispatchEvent(new window.InputEvent('input',{bubbles:true,data:text,inputType:'insertText'}));});
 return {window,container,calls,click,restore,input,fail:()=>{fail=true;},delays};
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
 const h=await harness(t,'?poc=1&view=groups&gv-tab=people&gv-person=121');assert.equal(h.container.querySelectorAll('.gv-person').length,23);assert.equal(new URLSearchParams(location.search).has('gv-people-limit'),false);
 await h.click(h.container.querySelector('[data-gv-person="121"]'));assert.equal(h.container.querySelectorAll('.gv-person').length,15);
 const length=history.length;await h.input('É');await h.input('Éva');assert.equal(history.length,length+1);assert.equal(h.container.querySelectorAll('.gv-person').length,1);
 await act(async()=>{const popped=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history.back();await popped;});assert.equal(h.container.querySelector('.gv-search input').value,'');assert.equal(h.container.querySelectorAll('.gv-person').length,15);
 await h.restore('/?poc=1&view=groups&gv-tab=time&gv-person=42&gv-subject=climate');assert.equal(h.container.querySelector('.gv-tabs [aria-pressed=true]').textContent,'Subjects');assert.match(h.container.querySelector('.gv-subjects').textContent,/Climate & energy/);assert.equal(h.container.querySelector('.gv-person'),null);
});
test('changing scope with delayed or failed data hides previous results and ignores late responses',async t=>{
 const h=await harness(t);const select=h.container.querySelector('.gv-controls select');
 await act(async()=>{select.value='PPE';select.dispatchEvent(new window.Event('change',{bubbles:true}));});assert.equal(h.container.querySelector('.gv-person'),null);assert.equal(h.container.querySelector('.gv-contributions article'),null);
 h.fail();await h.restore('/?poc=1&view=groups&gv-group=ECR&gv-tab=people');assert(h.container.querySelector('[role=alert]'));assert.equal(h.container.querySelector('.gv-person'),null);
 await act(async()=>{h.delays.forEach(resolve=>resolve(Response.json({people,months:[],coverage,window:{}})));});assert.equal(new URLSearchParams(location.search).get('gv-group'),'ECR');assert.equal(h.container.querySelector('.gv-person'),null);
});
