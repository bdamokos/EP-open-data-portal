import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const member={id:257043,firstName:'Mika',lastName:'Aaltola',sortName:'AALTOLA Mika',gender:'m',countryCode:'FI',groupCode:'EPP',memberships:[],accounts:[]};
const directory={day:'2026-10-16',members:[member],committees:[],index:{complete:true,loaded:1,total:1,failed:0,error:null}};
const speechId='MTG-PL-2026-10-07-OTH-2017097993206';
const item={id:'speech:'+speechId,sourceId:speechId,date:'2026-10-07',title:'Public speech fixture',titles:{en:'Public speech fixture'},recordKind:'speech',category:'plenary-contributions',categoryLabel:'Plenary contributions',speechKind:'PLENARY_DEBATE_WRITTEN_STATEMENT',reference:speechId,files:[],provenance:{role:'SPEAKER'}};
const page=(offset=0)=>({categories:{},categoryGroups:[],categoryCoverage:{},items:offset?[]:[item],selectedItems:[],indexedTotal:11,nextOffset:offset?null:10,cache:{complete:false}});

async function harness(t,query='',delay=false) {
  const window=new Window({url:'http://localhost/'+query}),pending=[],unexpected=[];
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),innerWidth:1280,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,vite;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    pending.forEach(request=>request.resolve(Response.json(page())));
    if(vite)await vite.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
    assert.deepEqual(unexpected,[]);
  });
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href),route=url.pathname.split('/poc/')[1];
    if(route?.startsWith('speech-transcript/'))return Response.json({id:route.split('/')[1],available:false});
    if(route==='directory')return Response.json(directory);
    if(route?.startsWith('portrait/'))return new Response(null,{status:404});
    if(route?.startsWith('profile/'))return Response.json(member);
    if(route?.startsWith('latest-activities/')){
      if(delay)return new Promise(resolve=>pending.push({url,resolve}));
      return Response.json(page(Number(url.searchParams.get('offset'))));
    }
    if(route?.startsWith('speech-statistics/'))return Response.json({items:[],counts:{},groups:[],coverage:{available:0,total:0,complete:true,headers:0},sources:[],nextPage:null});
    if(route==='insights/speech-cloud')return Response.json({scope:{},words:[],speeches:[],coverage:{transcripts:0,complete:true},window:{},nextPage:null});
    if(route==='insights/saved')return Response.json({members:[],questions:[]});
    if(route?.startsWith('speech/'))return Response.json({id:speechId,xml:null,speakers:[],availableTextLanguages:['en'],textLanguage:'en'});
    // Main-view error states still have a stable destination before any data.
    if(route?.startsWith('insights/')||route?.startsWith('outside/'))return Response.json({error:{message:'Local fixture unavailable.'}},{status:503});
    unexpected.push(url.href);throw Error('Unexpected fixture request: '+url.href);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {default:App}=await vite.ssrLoadModule('/src/App.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(App)));
  const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text);
  const click=node=>{assert(node,'Missing control');node.focus();return act(async()=>node.click());};
  const finish=(data,status=200)=>act(async()=>{assert(pending.length,'Missing pending page');pending.shift().resolve(Response.json(data,{status}));});
  return {window,container,pending,button,click,finish};
}

test('member destination and Back restore the remounted exact portrait while retaining filters',async t=>{
  const h=await harness(t),input=h.container.querySelector('.explorer-filters input');
  input.focus();await act(async()=>{Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype,'value').set.call(input,'Mika');input.dispatchEvent(new h.window.Event('input',{bubbles:true}));});
  const original=h.container.querySelector('[data-member-id="257043"] button'),main=h.container.querySelector('main.explorer'),order=[];
  Object.defineProperties(main,{scrollHeight:{value:1000,configurable:true},clientHeight:{value:100,configurable:true}});
  main.scrollTo=()=>order.push('existing page reset');
  t.mock.method(h.window.HTMLElement.prototype,'scrollIntoView',function(){if(this.matches('.portrait--button'))order.push('returned portrait reveal');});
  await h.click(original);
  assert.equal(document.activeElement,h.container.querySelector('.explorer-profile h1'));
  assert.equal(document.activeElement.getAttribute('aria-label'),'Mika Aaltola');
  assert.equal(original.isConnected,false);
  order.length=0;await h.click(h.container.querySelector('.explorer-back'));
  assert.deepEqual(order,['existing page reset','returned portrait reveal'],'the established responsive scroll cannot hide the returned control afterwards');
  const returned=h.container.querySelector('[data-member-id="257043"] button');
  assert.equal(document.activeElement,returned);assert.notEqual(returned,original);
  assert.equal(h.container.querySelector('.explorer-filters input').value,'Mika');
});

test('explicit main-view gestures orient to the current heading without adding history beyond existing navigation',async t=>{
  const h=await harness(t);
  assert.equal(document.activeElement,document.body,'ordinary initial load does not force focus');
  for(const label of ['Following','Plenary agenda','Questions','Outside voices','Members']) {
    const before=history.length;
    await h.click(h.button(label));
    assert.equal(document.activeElement,h.container.querySelector('h1'),label);
    assert.equal(document.activeElement.tabIndex,-1);
    assert.equal(history.length,before+1,'one existing navigation history entry');
  }
  const search=h.container.querySelector('.explorer-filters input');search.focus();
  await act(async()=>{search.value='No such member';search.dispatchEvent(new h.window.Event('input',{bubbles:true}));});
  assert.equal(document.activeElement,search,'filter updates do not invoke a page destination');
});

test('Following Back restores its semantic header trigger even after the header remounts',async t=>{
  const h=await harness(t);
  await h.click(h.button('Questions'));
  const original=h.button('Following');await h.click(original);
  assert.equal(original.isConnected,false);
  await h.click(h.button('← Back'));
  assert.equal(document.activeElement,h.button('Following'));
});

test('speech pagination keeps a stable local destination through pending, error and retry without completion focus steals',async t=>{
  const h=await harness(t,'?member=257043&module=speeches',true);
  await h.finish(page());
  const heading=h.container.querySelector('.explorer-profile-body h2'),body=h.container.querySelector('.explorer-profile-body'),reveals=[];
  Object.defineProperties(body,{scrollHeight:{value:1000,configurable:true},clientHeight:{value:100,configurable:true}});
  body.scrollTo=options=>reveals.push(options);
  await h.click(h.button('Older'));
  assert.equal(document.activeElement,heading);
  assert.deepEqual(reveals,[{top:0}],'pagination reuses the activity list local reveal rather than leaving its target offscreen');
  assert.equal(h.button('Older'),undefined,'clicked page control is removed during request');
  await h.finish({error:{message:'Page unavailable.'}},503);
  assert.equal(document.activeElement,heading);
  const retry=h.button('Try again');await h.click(retry);
  assert.equal(document.activeElement,heading,'a disappearing retry keeps the local destination');
  const language=h.container.querySelector('[aria-label="Interface language"]');language.focus();
  await h.finish(page(10));
  assert.equal(document.activeElement,language,'response arrival cannot reclaim unrelated focus');
  await h.click(h.button('Newer'));
  assert.equal(document.activeElement,heading,'reverse pagination uses the same stable destination');
});

test('delayed exact-speech handoff respects a subsequent focus choice and initial deep-link selection',async t=>{
  for(const moved of [false,true,'returned'])await t.test(moved==='returned'?'returning to the old focus cannot revive intent':moved?'user moved focus':'initial destination',async t=>{
    const h=await harness(t,'?member=257043&module=speeches&speech='+speechId,true);
    const language=h.container.querySelector('[aria-label="Interface language"]');if(moved)language.focus();
    if(moved==='returned'){document.body.tabIndex=-1;document.body.focus();}
    await h.finish(page());
    assert.equal(document.activeElement,moved==='returned'?document.body:moved?language:h.container.querySelector('.explorer-speech-toggle'));
  });
});
