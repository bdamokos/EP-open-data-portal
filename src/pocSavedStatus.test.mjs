import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,390));});
const baseline={activityVersion:3,revision:'old',answerIds:[],total:1,latestIds:['A-10-2026-000001']};
const member=(overrides={})=>({kind:'mep',id:'257043',title:'Fixture member',titleLanguage:'en',baseline,current:baseline,updated:false,...overrides});
const state=(overrides={})=>({id:'257043',status:'available',name:'Fixture member',revision:'old',total:1,activityIds:['A-10-2026-000001'],answers:[],latest:[{id:'A-10-2026-000001',title:'Existing activity',titleLanguage:'en',date:'2026-10-01'}],...overrides});
const response=(members=[state()],coverage=true)=>({questions:[],members,checkedAt:'2026-10-16T17:00:00Z',coverage:{indexComplete:coverage}});
async function harness(t,items=[member()]) {
  const window=new Window({url:'http://localhost/'}),globals={window,document:window.document,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  window.localStorage.setItem('ep.bookmarks.v1',JSON.stringify({version:1,items}));
  const requests=[];let root,vite;
  t.after(async()=>{
    if(root)await act(async()=>{root.unmount();for(const request of requests)if(!request.done){request.done=true;request.resolve(Response.json(response()));}});
    if(vite)await vite.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  t.mock.method(globalThis,'fetch',input=>new Promise(resolve=>requests.push({url:new URL(input,window.location.href),resolve,done:false})));
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocSaved,checkSaved}=await vite.ssrLoadModule('/src/PocSaved.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=(language='en')=>act(async()=>root.render(createElement(PocSaved,{language,onBack(){},onMember(){}})));
  const button=()=>[...container.querySelectorAll('button')].find(node=>/^(Check for updates|Checking…)$/.test(node.textContent));
  const check=()=>act(async()=>{button().focus();button().click();});
  const respond=(index,data=response(),status=200)=>act(async()=>{const request=requests[index];assert(request&&!request.done);request.done=true;request.resolve(Response.json(data,{status}));});
  const status=()=>container.querySelector('[role="status"][aria-atomic="true"]');
  const replace=items=>act(async()=>{window.localStorage.setItem('ep.bookmarks.v1',JSON.stringify({version:1,items}));window.dispatchEvent(new window.StorageEvent('storage',{key:'ep.bookmarks.v1'}));});
  const saved=()=>JSON.parse(window.localStorage.getItem('ep.bookmarks.v1')).items;
  return {window,container,requests,render,button,check,respond,status,replace,saved,background:()=>checkSaved('en',true),clear:()=>act(async()=>root.render(null))};
}
function record(h,t) {
  const messages=[],observer=new h.window.MutationObserver(()=>{const message=h.status()?.textContent;if(message)messages.push(message);});
  observer.observe(h.status(),{subtree:true,childList:true,characterData:true});t.after(()=>observer.disconnect());return messages;
}

test('explicit Following checks announce settled current unread state once, preserve focus and repeat a later deliberate result',async t=>{
  const h=await harness(t);await h.render();const button=h.button(),messages=record(h,t);
  assert.equal(h.status().textContent,'');assert.equal(h.status().getAttribute('aria-live'),'polite');assert.equal(h.status().lang,'en');
  await h.check();assert.equal(button.textContent,'Checking…');assert.equal(button.getAttribute('aria-disabled'),'true');assert.equal(button.disabled,false);assert.equal(document.activeElement,button);
  await h.check();assert.equal(h.requests.length,1,'busy button remains focusable while guarding repeated activation');await settle();assert.equal(h.status().textContent,'');
  assert.equal(h.requests[0].url.searchParams.get('members'),'257043');
  const changed=response([state({revision:'new',total:2,activityIds:['A-10-2026-000001','A-10-2026-000002']})]);
  await h.respond(0,changed);assert.equal(button.textContent,'Check for updates');await settle();
  assert.equal(h.status().textContent,'Check finished. 1 followed item has unread updates.');assert.equal(messages.length,1);
  assert.equal(h.button(),button);assert.equal(document.activeElement,button);assert.match(h.container.querySelector('.poc-update-label').textContent,/New activity/);
  assert.equal(h.saved()[0].baseline.revision,'old');assert.equal(h.saved()[0].current.revision,'new');assert.equal(h.saved()[0].updated,true);
  await h.check();assert.equal(h.status().textContent,'');await h.respond(1,changed);await settle();
  assert.equal(messages.length,2);assert.equal(messages[0],messages[1]);assert.doesNotMatch(h.status().textContent,/newly|found|discovered/);
  assert.equal(document.activeElement,button);assert.equal(h.saved()[0].updated,true,'checking must not acknowledge unread activity');
});

test('unchanged, pre-existing unread and partial unavailable states describe only current known state',async t=>{
  const h=await harness(t);await h.render();await h.check();await h.respond(0);await settle();
  assert.equal(h.status().textContent,'Check finished. No unread updates are currently recorded.');assert.equal(h.saved()[0].updated,false);
  const unread={id:'E-10-2026-003031-ASW',title:'Previously unread answer',titleLanguage:'en',recordKind:'answer'};
  await h.replace([member({updated:true,newAnswer:true,unreadAnswers:[unread]})]);await h.check();await h.respond(1);await settle();
  assert.equal(h.status().textContent,'Check finished. 1 followed item has unread updates.');assert.equal(h.saved()[0].newAnswer,true);assert.deepEqual(h.saved()[0].unreadAnswers.map(x=>x.id),[unread.id]);
  await h.check();await h.respond(2,response([state({status:'outside-roster'})],false));await settle();
  assert.equal(h.status().textContent,'Check finished. 1 followed item has unread updates. Update information is unavailable for 1 followed item. The saved index is incomplete.');
  assert.match(h.container.textContent,/No longer on the current roster/);assert.equal(h.saved()[0].baseline.revision,'old');assert.equal(h.saved()[0].newAnswer,true);
  await h.replace([member()]);await h.check();await h.respond(3,response([],false));await settle();
  assert.match(h.status().textContent,/No unread updates are currently recorded.*information is unavailable.*index is incomplete/);assert.doesNotMatch(h.status().textContent,/No new|0 updates/);
});

test('check errors retain diagnostics, announce politely and repeat on explicit retry without clearing saved state',async t=>{
  const h=await harness(t,[member({updated:true,newActivity:true})]);await h.render();const messages=record(h,t),button=h.button();
  for(let i=0;i<2;i++){
    await h.check();await h.respond(i,{error:{message:'Fixture update service unavailable'}},503);await settle();
    assert.equal(h.status().textContent,'Could not check for updates. Saved items are still shown.');assert.match(h.container.textContent,/Fixture update service unavailable/);assert.equal(h.container.querySelector('[role="alert"]'),null);
    assert.equal(h.saved()[0].updated,true);assert.equal(h.saved()[0].baseline.revision,'old');assert.equal(document.activeElement,button);
  }
  assert.equal(messages.length,2);assert.equal(h.requests.length,2);
});

test('Following with no items keeps native disabled behavior and makes no check request',async t=>{
  const h=await harness(t,[]);await h.render();const button=h.button();
  assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-disabled'),null);
  await act(async()=>button.click());await settle();assert.equal(h.requests.length,0);assert.equal(h.status().textContent,'');
});

test('a deliberate check after follows change awaits the matching queued refresh, even when the obsolete request fails',async t=>{
  const h=await harness(t);await h.render();const messages=record(h,t);
  for(const [index,id,oldStatus] of [[0,'12345',200],[2,'67890',503]]){
    await h.check();await h.replace([member({id})]);await h.check();const button=h.button();
    assert.equal(h.requests.length,index+1,'the old shared request is still pending');
    await h.respond(index,oldStatus===200?response():{error:{message:'Obsolete failed check'}},oldStatus);
    assert.equal(h.requests.length,index+2);assert.equal(button.getAttribute('aria-disabled'),'true');assert.equal(h.status().textContent,'');assert.doesNotMatch(h.container.textContent,/Obsolete failed check/);
    await h.respond(index+1,response([state({id,revision:'new',total:2})]));await settle();
    assert.equal(h.status().textContent,'Check finished. 1 followed item has unread updates.');assert.equal(button.getAttribute('aria-disabled'),null);assert.equal(document.activeElement,button);assert.equal(h.saved()[0].id,id);
  }
  assert.equal(messages.length,2);
});

test('background checks and superseded language, membership, acknowledgement and unmounted completions stay silent',async t=>{
  const h=await harness(t);await h.render();const messages=record(h,t);
  let background;await act(async()=>{background=h.background();});await h.respond(0);await background;await settle();assert.equal(h.status().textContent,'');assert.equal(messages.length,0);
  await h.check();await h.render('fr');await h.respond(1);await settle();assert.equal(h.status().textContent,'');assert.equal(messages.length,0);assert.equal(h.button().disabled,false);
  await h.check();await h.replace([member({id:'12345'})]);await h.respond(2);assert.equal(h.requests.length,4,'existing membership guard refreshes the new exact selection');await h.respond(3,response([state({id:'12345'})]));await settle();assert.equal(h.status().textContent,'');assert.equal(messages.length,0);assert.equal(h.saved()[0].id,'12345');
  await h.check();await h.respond(4,response([state({id:'12345',revision:'new',total:2})]));
  await act(async()=>[...h.container.querySelectorAll('button')].find(node=>node.textContent==='Profile').click());await settle();assert.equal(h.status().textContent,'');assert.equal(messages.length,0);assert.equal(h.saved()[0].updated,false,'acknowledgement retains its existing behavior');
  await h.check();await h.respond(5,response([state({id:'12345'})]));
  await act(async()=>{background=h.background();});await h.respond(6,response([state({id:'12345',revision:'latest'})]));await background;await settle();assert.equal(h.status().textContent,'');assert.equal(messages.length,0,'background observation cancels a queued obsolete unread count');
  await h.check();await h.clear();await h.respond(7,response([state({id:'12345'})]));await settle();assert.equal(h.container.textContent,'');assert.equal(messages.length,0);
});
