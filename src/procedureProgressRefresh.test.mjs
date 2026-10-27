import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {PROGRESS_REFRESH_DELAYS,PROGRESS_REFRESH_DEADLINE} from './insightRefresh.mjs';

const reference='2026/2937(RSP)';
const oeilUrl='https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2026%2F2937%28RSP%29';
const event=(extra={})=>({id:'oeil:exact-event',date:'2026-10-20',dates:['2026-10-20'],types:[],statuses:[],status:'recorded',institutions:[],works:[],label:'End of procedure in Parliament',labelLanguage:'en',milestone:true,issues:[],...extra});
const progress=(extra={})=>({reference,language:'en',detail:'events',basis:'oeil',cellar:{state:'unmapped',dossier:null},state:'mapped',dossier:null,status:{label:'Procedure completed',language:'en'},events:[event()],coverage:{limited:false,invalidRows:0,incompleteEvents:0},source:{url:oeilUrl,fetchedAt:'2026-10-27T12:00:00Z',stale:false,refreshInProgress:false,refreshError:null},...extra});
const pending=()=>progress({source:{fetchedAt:'2026-10-26T12:00:00Z',stale:true,refreshInProgress:true,refreshError:null}});

async function harness(t) {
  const window=new Window({url:'http://localhost/'}),originals=new Map(),requests=[],timers=[];
  for(const [key,value] of Object.entries({window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})) {
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  }
  const schedule=globalThis.setTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{
    const timer=schedule(callback,delay,...args);
    if(PROGRESS_REFRESH_DELAYS.includes(delay)||delay===PROGRESS_REFRESH_DEADLINE||delay>100_000)timers.push({callback,delay,timer});
    return timer;
  });
  t.mock.method(globalThis,'fetch',(input,options)=>new Promise(resolve=>requests.push({url:new URL(input,location.href),signal:options.signal,resolve})));
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {ProcedureProgress}=await load('/src/ProcedureProgress.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  t.after(async()=>{await act(async()=>{root.unmount();requests.forEach(request=>request.resolve(Response.json({})));});timers.forEach(({timer})=>clearTimeout(timer));await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  return {container,requests,timers,render:props=>act(async()=>root.render(createElement(ProcedureProgress,{reference,language:'en',...props}))),
    finish:(data,request=requests.at(-1),status=200)=>act(async()=>request.resolve(Response.json(data,{status}))),
    tick:delay=>act(async()=>{const index=timers.findLastIndex(timer=>timer.delay===delay);assert(index>=0,'expected timer '+delay);const timer=timers.splice(index,1)[0];clearTimeout(timer.timer);timer.callback();}),
    click:text=>act(async()=>{const button=[...container.querySelectorAll('button')].find(button=>button.textContent===text);assert(button,text);button.click();}),unmount:()=>act(async()=>root.unmount())};
}

test('stale admitted progress reaches a settled result, keeping the timeline and lazy document boundary',async t=>{
  const h=await harness(t);await h.render();await h.finish(pending());
  assert.match(h.container.textContent,/Checking…/);assert.match(h.container.textContent,/End of procedure/);
  await h.tick(500);assert.equal(h.requests.length,2,'poll bypasses the stale browser cache');
  await h.finish(progress());assert.doesNotMatch(h.container.textContent,/Checking|Checked|Not checked/);
  assert.match(h.container.querySelector('h3').textContent,/Procedure progress/);
  await h.click('Show timeline');assert.equal(h.container.querySelectorAll('.procedure-progress-timeline>li').length,1);
  assert.equal(h.requests.length,2,'opening a timeline does not load documents');
  await h.render({reference:'2025/0223(COD)'});
  const cellarEvent=event({id:'cellar:1',works:['cellar:work'],institutions:[{id:'EP',code:'EP',label:'European Parliament',language:'en'}]});
  await h.finish(progress({reference:'2025/0223(COD)',dossier:'cellar:dossier',status:null,events:[cellarEvent]}));
  await h.click('Show timeline');
  const details=h.container.querySelector('details');await act(async()=>{details.open=true;details.dispatchEvent(new window.Event('toggle'));});
  assert.equal(h.requests.at(-1).url.searchParams.get('detail'),'documents');
  const documentData={reference:'2025/0223(COD)',state:'mapped',dossier:'cellar:dossier',documents:[],coverage:{},source:{}};
  await h.finish({...documentData,source:pending().source});assert.match(details.textContent,/Checking for updates/);
  await h.tick(500);assert.equal(h.requests.at(-1).url.searchParams.get('detail'),'documents');await h.finish(documentData);
  assert.doesNotMatch(details.textContent,/Checking for updates/);
  assert.match(h.container.textContent,/No document link/);
});

test('refresh errors and admission pauses settle without losing last-good content or retrying early',async t=>{
  const h=await harness(t);await h.render();await h.finish(pending());await h.tick(500);
  await h.finish(progress({source:{...progress().source,stale:true,refreshError:'Source failed'}}));
  assert.match(h.container.textContent,/Update unavailable/);assert.doesNotMatch(h.container.textContent,/Checking…/);
  assert.match(h.container.textContent,/Procedure completed/);assert.equal(h.requests.length,2);
  await h.click('Check again');assert.match(h.container.textContent,/Procedure completed/);
  await h.finish({error:{message:'Busy',code:'upstream_busy',retryAt:Date.now()+120_000}},undefined,503);
  const retry=[...h.container.querySelectorAll('button')].find(button=>button.textContent==='Try later');assert(retry?.disabled);
  assert.match(h.container.textContent,/Procedure completed/);assert.equal(h.requests.length,3,'long admission pause is not shortened');
  const pause=h.timers.find(timer=>timer.delay>100_000);assert(pause);
  const now=Date.now();t.mock.method(Date,'now',()=>now+120_001);await h.tick(pause.delay);
  assert.equal([...h.container.querySelectorAll('button')].find(button=>button.textContent==='Check again')?.disabled,false,'retry becomes usable when the admission pause ends');
});

test('refresh polling has finite attempts and an overall deadline, with a fresh explicit retry lifecycle',async t=>{
  const h=await harness(t);await h.render();await h.finish(pending());
  for(const delay of PROGRESS_REFRESH_DELAYS){await h.tick(delay);await h.finish(pending());}
  assert.equal(h.requests.length,7);assert.doesNotMatch(h.container.textContent,/Checking…/);assert.match(h.container.textContent,/Update unavailable/);
  await h.click('Check again');assert.equal(h.requests.length,8);await h.finish(pending());
  await h.tick(PROGRESS_REFRESH_DEADLINE);assert.doesNotMatch(h.container.textContent,/Checking…/);assert.match(h.container.textContent,/Procedure completed/);
});

test('reference, language and unmount cancel pending polls and obsolete results cannot replace the selection',async t=>{
  const h=await harness(t);await h.render();await h.finish(pending());
  await h.render({language:'fr'});assert.doesNotMatch(h.container.textContent,/Procedure completed/);
  assert.equal(h.requests.length,2);await h.finish(progress({language:'fr',status:{label:'Procédure terminée',language:'fr'}}));
  await h.tick(500);assert.equal(h.requests.length,2,'cancelled English poll does not make a request');
  assert.match(h.container.textContent,/Procédure terminée/);
  await h.render({reference:'2026/2938(RSP)'});const obsolete=h.requests.at(-1);
  await h.render({reference:'2026/2939(RSP)'});assert(obsolete.signal.aborted);
  await h.finish(progress({reference:'2026/2938(RSP)'}),obsolete);assert.doesNotMatch(h.container.textContent,/Procedure completed/);
  await h.unmount();assert(h.requests.at(-1).signal.aborted);
});

test('unavailable progress stays one short gap state and future, cancelled and unknown events retain their meaning',async t=>{
  const h=await harness(t);await h.render();await h.finish(progress({state:'unmapped',status:null,events:[],source:{...progress().source,stale:true}}));
  assert.equal((h.container.textContent.match(/Unavailable/g)||[]).length,1);assert.equal(h.container.querySelectorAll('p').length,0);
  await h.click('Check again');await h.finish(progress({status:null,events:[event({id:'future',date:'2099-10-20',milestone:false}),event({id:'cancel',status:'cancelled'}),event({id:'unknown',status:'unknown'})]}));
  assert(!h.container.querySelector('.procedure-progress-latest'),'future and cancelled/unknown events are not completed milestones');
  await h.click('Show timeline');await h.click('Show all recorded events');assert.match(h.container.textContent,/Upcoming/);assert.match(h.container.textContent,/Cancelled/);assert.match(h.container.textContent,/Status unavailable/);
});

test('a degraded successful retry preserves the selected saved timeline and its retry deadline',async t=>{
  const h=await harness(t),saved=progress({source:{...progress().source,stale:true}});
  await h.render();await h.finish(saved);await h.click('Show timeline');
  await h.click('Check again');
  const retryAt=Date.now()+120_000;
  await h.finish(progress({basis:'cellar',cellar:undefined,state:'unmapped',status:null,events:[],fallback:{status:'unavailable',url:oeilUrl,error:'Busy',retryAt}}));
  assert.match(h.container.textContent,/Procedure completed/);assert.match(h.container.textContent,/End of procedure in Parliament/);
  assert.equal(h.container.querySelectorAll('.procedure-progress-timeline>li').length,1);
  assert.match(h.container.textContent,/Update unavailable/);
  assert.equal([...h.container.querySelectorAll('button')].find(button=>button.textContent==='Try later')?.disabled,true);
  const timer=h.timers.find(timer=>timer.delay>100_000),now=Date.now();assert(timer);
  t.mock.method(Date,'now',()=>now+120_001);await h.tick(timer.delay);
  await h.click('Check again');assert.match(h.container.textContent,/Procedure completed/,'a repeated retry uses saved content rather than the degraded client cache');
  await h.finish(progress({events:[event({label:'Updated event'})]}));assert.match(h.container.textContent,/Updated event/);
  await h.render({reference:'2026/2938(RSP)'});await h.finish(progress({reference:'2026/2938(RSP)',state:'unmapped',status:null,events:[],fallback:{status:'unavailable'}}));
  assert.doesNotMatch(h.container.textContent,/Procedure completed|Updated event/,'retained observations never cross references');
});

test('a secondary Cellar source failure remains visible beside fresh OEIL progress',async t=>{
  const h=await harness(t),source=progress().source;
  await h.render();await h.finish(progress({sources:[{...source,stale:true,refreshError:'Cellar failed'},source]}));
  assert.match(h.container.textContent,/Procedure completed/);assert.match(h.container.textContent,/Update unavailable/);
  assert([...h.container.querySelectorAll('button')].some(button=>button.textContent==='Check again'&&!button.disabled));
  assert.doesNotMatch(h.container.textContent,/Checking…/);
});

test('fallback admission backoff settles a pending Cellar refresh without polling',async t=>{
  const h=await harness(t),retryAt=Date.now()+120_000;
  await h.render();await h.finish(progress({state:'unmapped',status:null,events:[],source:pending().source,fallback:{status:'unavailable',error:'Busy',retryAt}}));
  assert.doesNotMatch(h.container.textContent,/Checking…/);
  assert.equal([...h.container.querySelectorAll('button')].find(button=>button.textContent==='Try later')?.disabled,true);
  assert.equal(h.requests.length,1);
  assert.equal(h.timers.filter(timer=>PROGRESS_REFRESH_DELAYS.includes(timer.delay)).length,0,'no source poll is scheduled during fallback admission backoff');
});

test('a cached primary-source retry deadline disables retry without discarding progress',async t=>{
  const h=await harness(t),retryAt=Date.now()+120_000;
  await h.render();await h.finish(progress({source:{...progress().source,stale:true,refreshError:'Source limited',retryAt}}));
  assert.match(h.container.textContent,/Procedure completed/);assert.match(h.container.textContent,/Update unavailable/);
  assert.equal([...h.container.querySelectorAll('button')].find(button=>button.textContent==='Try later')?.disabled,true);
  assert.equal(h.requests.length,1);
});

test('a valid empty OEIL observation clears saved completion even when Cellar has failed',async t=>{
  const h=await harness(t);await h.render();await h.finish(progress({source:{...progress().source,stale:true}}));
  await h.click('Check again');
  await h.finish(progress({state:'unmapped',status:null,events:[],coverage:{limited:false,invalidRows:0,incompleteEvents:0,timeline:'available'},sources:[{url:'https://publications.europa.eu/webapi/rdf/sparql',stale:true,refreshError:'Cellar failed'},progress().source]}));
  assert.doesNotMatch(h.container.textContent,/Procedure completed|End of procedure/);assert.match(h.container.textContent,/Unavailable/);
});
