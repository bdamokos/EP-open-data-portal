import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {dataTimeoutFor} from './client.mjs';

const sittings=['2026-10-05','2026-10-07','2026-10-19'].map(date=>({id:'MTG-PL-'+date,date,phase:date==='2026-10-19'?'upcoming':'past'}));
function agenda(params) {
  const week=params.has('week')?(params.get('week')==='latest'?'2026-10-05':params.get('week')):null;
  const days=week?sittings.filter(s=>week==='2026-10-05'?s.date<'2026-10-19':s.date==='2026-10-19'):[sittings.find(s=>s.id===params.get('sitting'))];
  return {view:'legislation',week,sitting:days[0],sittings,topics:days.map(s=>({id:s.id+'-item',sittingId:s.id,date:s.date,title:'Agenda for '+s.date,kind:'PLENARY_DEBATE',documentIds:[],procedureIds:[]})),agendaSittings:week?days.map(s=>({...s,agendaComplete:true,agendaError:null})):undefined,coverage:{agendaComplete:false,agendaError:null},detail:null};
}
async function harness(t,query='') {
  const window=new Window({url:'http://localhost/?view=legislation'+query});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,innerWidth:1440,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  const requests=[];
  t.mock.method(globalThis,'fetch',(input,options)=>{
    const url=new URL(input,location.href);
    assert(url.pathname.endsWith('/insights/legislation'),'Unexpected fetch: '+url);
    return new Promise(resolve=>requests.push({url,signal:options.signal,resolve}));
  });
  t.after(async()=>{if(root)await act(async()=>{root.unmount();for(const r of requests)r.resolve(Response.json({}));});await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {Legislation}=await loadModule('/src/Legislation.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(Legislation,{language:'en',onBack(){}})));
  const select=()=>container.querySelector('.insight-controls select');
  return {container,requests,select,
    choose:async value=>act(async()=>{select().value=value;select().dispatchEvent(new window.Event('change',{bubbles:true}));}),
    finish:async(request=requests.at(-1),status=200)=>act(async()=>request.resolve(status===200?Response.json(agenda(request.url.searchParams)):Response.json({error:{message:'Fixture unavailable'}},{status}))),
    reload:async()=>act(async()=>container.querySelector('.insight-error button').click()),
    history:async direction=>act(async()=>{const popped=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history[direction]();await popped;}),
    restore:async query=>act(async()=>{history.replaceState(null,'','/?view=legislation'+query);window.dispatchEvent(new window.Event('popstate'));}),
  };
}

test('agenda period navigation survives delayed errors, manual retry, history and superseded requests',async t=>{
  const h=await harness(t),{container,requests,select}=h;
  await h.finish();
  assert.equal(select().value,'week:2026-10-05');
  assert.match(container.textContent,/2 agenda items · partial/,'incomplete coverage stays labelled');
  await h.choose('week:2026-10-19');
  assert.equal(select().value,'week:2026-10-19');
  assert.equal(select().options.length,6,'retains latest, both weeks and all three days');
  assert(!container.querySelector('.insight-agenda'),'old agenda results must disappear during a different request');
  await act(async()=>new Promise(resolve=>setTimeout(resolve,330)));
  assert.match(container.querySelector('[role="status"]').textContent,/Loading agenda/);
  await h.finish(undefined,503);
  assert.equal(select().value,'week:2026-10-19');
  assert(!container.textContent.includes('Loading'));
  assert.match(container.querySelector('[role="alert"]').textContent,/Could not load this agenda.*Choose another period/);
  assert.equal(requests.length,2,'failure does not automatically retry');
  await h.history('back');
  assert.equal(select().value,'week:2026-10-05');
  assert.match(container.textContent,/Agenda for 2026-10-07/);
  await h.history('forward');
  assert.equal(select().value,'week:2026-10-19');
  assert(!container.querySelector('.insight-agenda'));
  await h.finish(undefined,503);
  assert(!container.textContent.includes('Loading'));
  await h.reload();
  assert(!container.querySelector('[role="alert"]'));
  assert.equal(select().value,'week:2026-10-19');
  assert.equal(requests.length,4,'one explicit retry after revisiting the failed history entry');
  assert.equal(requests.at(-1).url.searchParams.get('week'),'2026-10-19');
  await h.finish();
  assert.match(container.textContent,/Agenda for 2026-10-19/);
  await h.history('back');
  assert.equal(select().value,'week:2026-10-05');
  assert.match(container.textContent,/Agenda for 2026-10-07/);
  await h.history('forward');
  assert.equal(select().value,'week:2026-10-19');
  assert.match(container.textContent,/Agenda for 2026-10-19/);
  await h.choose('sitting:MTG-PL-2026-10-07');
  const superseded=requests.at(-1);
  assert.equal(select().value,'sitting:MTG-PL-2026-10-07');
  await h.choose('week:2026-10-05');
  const current=requests.at(-1);
  await h.finish(superseded,503);
  assert.equal(select().value,'week:2026-10-05');
  assert(!container.querySelector('[role="alert"]'),'late failure cannot replace the newer request');
  await h.finish(current);
  assert.match(container.textContent,/Agenda for 2026-10-07/);
  await h.choose('sitting:MTG-PL-2026-10-05');
  await h.finish(undefined,503);
  assert.equal(select().value,'sitting:MTG-PL-2026-10-05');
  assert(!container.querySelector('.insight-agenda'));
  await h.choose('week:2026-10-19');
  assert.match(container.textContent,/Agenda for 2026-10-19/,'another cached period recovers without Reload');
});

test('failed direct links keep exact week/day identity without a catalogue and can select latest',async t=>{
  const h=await harness(t,'&agenda-period=week:2026-09-14'),{container,select}=h;
  assert.equal(select().value,'week:2026-09-14');
  assert.match(select().selectedOptions[0].textContent,/Week of/);
  await h.finish(undefined,503);
  assert.equal(select().value,'week:2026-09-14');
  assert(!container.textContent.includes('Loading'));
  await h.choose('week:latest');
  assert.equal(h.requests.at(-1).url.searchParams.get('week'),'latest');
  await h.finish();
  assert.match(container.textContent,/Agenda for 2026-10-07/);
  await h.history('back');
  assert.equal(select().value,'week:2026-09-14','missing week stays represented even with a retained catalogue');
  assert(!container.querySelector('.insight-agenda'));
  await h.finish(undefined,503);
  await h.restore('&pl-sitting=MTG-PL-2026-09-16');
  assert.equal(select().value,'sitting:MTG-PL-2026-09-16');
  await h.finish(undefined,503);
  assert.equal(select().selectedOptions[0].textContent,'Sitting MTG-PL-2026-09-16');
  await h.choose('week:2026-10-05');
  await h.finish();
  assert.match(container.textContent,/Agenda for 2026-10-07/);
});

test('agenda timeout ends loading and leaves usable navigation without automatic retries',async t=>{
  const h=await harness(t,'&agenda-period=week:2026-10-19');
  // The production InsightData client bounds each read, even when fetch never settles.
  // Advance the route deadline rather than waiting for it in a regression test.
  const timeouts=[],schedule=globalThis.setTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{if(delay===dataTimeoutFor('insights/legislation'))timeouts.push(callback);return schedule(callback,delay,...args);});
  // Start a new uncached route after enabling timer control.
  await h.restore('&agenda-period=week:2026-10-05');
  assert(timeouts.length>0);
  await act(async()=>timeouts[0]());
  assert(h.requests.at(-1).signal.aborted);
  assert(!h.container.textContent.includes('Loading'));
  assert(h.container.querySelector('[role="alert"]'));
  assert.equal(h.select().value,'week:2026-10-05');
  assert.equal(h.requests.length,2);
});
