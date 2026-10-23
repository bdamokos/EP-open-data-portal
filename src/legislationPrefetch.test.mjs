import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const days=['2026-10-06','2026-10-07','2026-09-17'].map(date=>({id:'MTG-PL-'+date,date,phase:'past',title:'Plenary'}));
const topics=days.slice(0,2).flatMap((day,index)=>[0,1].map(n=>({id:day.id+'-ITM-'+n,sittingId:day.id,date:day.date,title:'Agenda '+index+' '+n,titleLanguage:'en',kind:'PLENARY_DEBATE',documentIds:[],procedureIds:[]})));
const stats={denominator:0,dimensions:{country:[],group:[],gender:[],age:[]}};
function response(params) {
  const selected=topics.find(topic=>topic.id===params.get('topic'));
  return {view:'legislation',week:'2026-10-05',sitting:days[1],sittings:days,agendaSittings:days.slice(0,2),topics,coverage:{agendaComplete:false,agendaError:null},detail:selected?{
    ...selected,phase:'past',procedures:[],committeeWork:[],roles:[],speeches:[],people:[],stats,votes:[],selectedVote:null,voteCoverage:{truncated:false},coverage:{roleRowsTruncated:false,gaps:[],speechAssociations:{sources:[],truncated:false}}
  }:null};
}
async function harness(t,width=1440) {
  const window=new Window({url:'http://localhost/?view=legislation'}),originals=new Map(),requests=[];
  for(const [key,value] of Object.entries({window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,innerWidth:width,requestAnimationFrame:callback=>{callback();return 0;},IS_REACT_ACT_ENVIRONMENT:true})) {
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  }
  let root,loadModule;
  t.mock.method(globalThis,'fetch',(input,options)=>{
    const url=new URL(input,location.href);
    assert(url.pathname.endsWith('/insights/legislation'),'Unexpected request '+url);
    if(!url.searchParams.has('topic'))return Promise.resolve(Response.json(response(url.searchParams)));
    return new Promise(resolve=>requests.push({url,...options,resolve,settled:false}));
  });
  t.after(async()=>{
    if(root)await act(async()=>{root.unmount();for(const request of requests.filter(r=>!r.settled))request.resolve(Response.json(response(request.url.searchParams)));});
    if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {Legislation}=await loadModule('/src/Legislation.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=language=>act(async()=>root.render(createElement(Legislation,{language,onBack(){}})));
  await render('en');
  return {requests,container,render,window,
    item:index=>container.querySelectorAll('.insight-agenda button')[index],
    hover:node=>act(async()=>node.dispatchEvent(new window.PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}))),
    leave:node=>act(async()=>node.dispatchEvent(new window.PointerEvent('pointerout',{bubbles:true,pointerType:'mouse'}))),
    wait:()=>act(async()=>new Promise(resolve=>setTimeout(resolve,220))),
    finish:(request,status=200)=>act(async()=>{request.settled=true;request.resolve(Response.json(status===200?response(request.url.searchParams):{error:{message:'Unavailable'}},{status}));}),
    unmount:()=>act(async()=>root.unmount())};
}

test('hover shares exact per-day detail requests with selection, caches results and keeps failures retryable',async t=>{
  const h=await harness(t),{requests}=h;
  assert.equal(requests.length,0,'rendering a week does not preload every agenda item');
  await h.hover(h.item(0));await h.leave(h.item(0));
  await act(async()=>h.item(0).dispatchEvent(new h.window.PointerEvent('pointerover',{bubbles:true,pointerType:'touch'})));
  await h.wait();assert.equal(requests.length,0,'brief hover and touch do not preload');
  await h.hover(h.item(2));await h.wait();assert.equal(requests.length,1);
  assert.equal(requests[0].priority,'low');assert.equal(requests[0].url.searchParams.get('sitting'),days[1].id);
  assert.equal(requests[0].url.searchParams.get('topic'),topics[2].id);assert.equal(requests[0].url.searchParams.get('lang'),'en');assert(requests[0].url.searchParams.has('v'));
  await h.leave(h.item(2));await act(async()=>h.item(2).click());
  assert.equal(requests.length,1,'click joins the in-flight hover request after pointer leave');
  await h.finish(requests[0]);assert.equal(h.container.querySelector('.insight-topic-detail h2').textContent,topics[2].title);
  await h.hover(h.item(3));await h.wait();assert.equal(requests.length,2);
  await h.finish(requests[1],503);assert.equal(h.container.querySelector('.insight-topic-detail [role="alert"]'),null,'speculative failure stays silent');
  await act(async()=>h.item(3).click());assert.equal(requests.length,3,'click retries failed speculation normally');assert.equal(requests[2].priority,'auto');
  await h.finish(requests[2]);await act(async()=>h.item(2).click());
  assert.equal(requests.length,3,'revisiting the successfully preloaded item reuses the insight cache');
  assert.equal(h.container.querySelector('.insight-topic-detail h2').textContent,topics[2].title);
});

test('hover speculation is serial, supersedes queued items and yields to foreground reads',async t=>{
  const h=await harness(t),{requests}=h;
  await act(async()=>h.item(0).click());assert.equal(requests.length,1);assert.equal(requests[0].priority,'auto');
  await h.hover(h.item(1));await h.wait();assert.equal(requests.length,1,'foreground read blocks new speculation');
  await h.hover(h.item(2));await h.finish(requests[0]);await h.wait();assert.equal(requests.length,2);assert.equal(requests[1].url.searchParams.get('topic'),topics[2].id,'only the latest hovered item starts');
  await h.hover(h.item(3));await h.wait();assert.equal(requests.length,2,'one speculative request at a time');
  await h.leave(h.item(3));await h.finish(requests[1]);await h.wait();assert.equal(requests.length,2,'leaving cancels the queued next request');
});

test('keyboard intent preloads, while language, period, mode and unmount cancel obsolete queued work',async t=>{
  const h=await harness(t),{requests}=h;
  await act(async()=>h.item(0).focus());await h.wait();assert.equal(requests.length,1);await h.finish(requests[0]);
  await act(async()=>h.item(1).focus());await h.render('fr');await h.wait();assert.equal(requests.length,1,'language change cancels queued old-language intent');
  await h.hover(h.item(2));
  await act(async()=>{const select=h.container.querySelector('.insight-controls select');select.value='sitting:'+days[2].id;select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
  await h.wait();assert.equal(requests.length,1,'period change cancels queued work');
  await h.hover(h.item(2));await act(async()=>[...h.container.querySelectorAll('button')].find(button=>button.textContent==='Dossiers').click());await h.wait();assert.equal(requests.length,1,'mode change cancels queued work');
  await act(async()=>[...h.container.querySelectorAll('button')].find(button=>button.textContent==='Agenda').click());
  await h.hover(h.item(2));await h.unmount();await h.wait();assert.equal(requests.length,1,'unmount cancels queued work');
});

test('mobile detail completion respects intervening keyboard focus',async t=>{
  const h=await harness(t,390),{container,requests}=h;
  await act(async()=>{h.item(0).focus();h.item(0).click();});
  const period=container.querySelector('.insight-controls select');
  await act(async()=>period.focus());
  await h.finish(requests[0]);
  assert.equal(document.activeElement,period,'the response must not steal focus from period navigation');
  await act(async()=>{h.item(1).focus();h.item(1).click();});
  await h.finish(requests[1]);
  assert.equal(document.activeElement,container.querySelector('.insight-topic-detail'),'uninterrupted selection still hands focus to the detail');
  await h.render('fr');
  const navigation=container.querySelector('.insight-agenda-navigation');
  assert.equal(navigation.lang,'en','English navigation retains its own language');
});
