import {viewReady} from './test-support/viewReady.mjs';
import test from 'node:test';
import {freshLoader} from './test-support/viteRunner.mjs';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';

// The transform hook has no per-harness closure state. Share its transform
// server while freshLoader creates/disposes a new module runner for each case.
const navigationServerKey=Symbol('navigation fixtures');
async function navigationLoader(options) {
  return freshLoader({...options,plugins:[{name:'delay-view-fixture',transform(code,id){
    const file=['Saved.tsx','Legislation.tsx','GroupVoices.tsx'].find(file=>id.endsWith('/'+file));
    if(file)return 'if(globalThis.__navigationDelayedFile==='+JSON.stringify(file)+')await globalThis.__navigationViewGate;\n'+code;
  }}]},{sharedServerKey:navigationServerKey});
}

const member={id:257043,firstName:'Mika',lastName:'Aaltola',sortName:'AALTOLA Mika',gender:'m',countryCode:'FI',groupCode:'EPP',memberships:[],accounts:[]};
const directory={day:'2026-10-16',members:[member],committees:[],index:{complete:true,loaded:1,total:1,failed:0,error:null}};
const speechId='MTG-PL-2026-10-07-OTH-2017097993206';
const item={id:'speech:'+speechId,sourceId:speechId,date:'2026-10-07',title:'Public speech fixture',titles:{en:'Public speech fixture'},recordKind:'speech',category:'plenary-contributions',categoryLabel:'Plenary contributions',speechKind:'PLENARY_DEBATE_WRITTEN_STATEMENT',reference:speechId,files:[],provenance:{role:'SPEAKER'}};
const page=(offset=0)=>({categories:{},categoryGroups:[],categoryCoverage:{},items:offset?[]:[item],selectedItems:[],indexedTotal:11,nextOffset:offset?null:10,cache:{complete:false}});

async function harness(t,query='',delay=false,delayedModule=false,brokenGroup=false, unavailableMemberships=false) {
  const window=new Window({url:'http://localhost/'+query}),pending=[],unexpected=[],portraitRequests=[];
  if(unavailableMemberships)delete window.IntersectionObserver;
  let releaseModule;const moduleGate=new Promise(resolve=>{releaseModule=resolve;});
  const delayedFile=delayedModule==='saved'?'Saved.tsx':delayedModule==='legislation'?'Legislation.tsx':'GroupVoices.tsx';
  const globals={__navigationDelayedFile:delayedModule?delayedFile:null,__navigationViewGate:moduleGate,window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),innerWidth:1280,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,loadModule;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    releaseModule();
    pending.forEach(request=>request.resolve(Response.json(page())));
    if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
    assert.deepEqual(unexpected,[]);
  });
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href),route=url.pathname.split('/api/')[1];
    if(route?.startsWith('speech-transcript/'))return Response.json({id:route.split('/')[1],available:false});
    if(route==='directory')return Response.json(unavailableMemberships?{...directory,members:[{...member,memberships:null}],index:{complete:false,loaded:0,total:1,failed:0,error:null}}:directory);
    if(route?.startsWith('portrait/')){portraitRequests.push(route);return new Response(null,{status:404});}
    if(route?.startsWith('profile/'))return Response.json(member);
    if(route?.startsWith('latest-activities/')){
      if(delay)return new Promise(resolve=>pending.push({url,resolve}));
      return Response.json(page(Number(url.searchParams.get('offset'))));
    }
    if(route?.startsWith('speech-statistics/'))return Response.json({items:[],counts:{},groups:[],coverage:{available:0,total:0,complete:true,headers:0},sources:[],nextPage:null});
    if(route==='insights/speech-cloud')return Response.json({scope:{},words:[],speeches:[],coverage:{transcripts:0,complete:true},window:{},nextPage:null});
    if(route==='insights/following-status')return Response.json({epoch:'test',generation:1,marksReady:false,indexComplete:false});
    if(route==='insights/search')return Response.json({offset:0,sections:[]});
    if(route==='insights/saved')return Response.json({members:[],questions:[]});
    if(route==='corpus/search')return Response.json({total:0,limit:20,offset:0,nextOffset:null,results:[],coverage:{complete:false}});
    if(route?.startsWith('speech-context/'))return Response.json({speechId:route.slice(15),unavailable:true,debates:[]});
    if(route?.startsWith('speech/'))return Response.json({id:speechId,xml:null,speakers:[],availableTextLanguages:['en'],textLanguage:'en'});
    if(brokenGroup&&route==='insights/group-voices'&&url.searchParams.get('group')==='ECR')return Response.json({people:[null],months:[],window:{},contributions:[],coverage:{initialized:true}});
    // Main-view error states still have a stable destination before any data.
    if(route?.startsWith('insights/')||route?.startsWith('outside/'))return Response.json({error:{message:'Local fixture unavailable.'}},{status:503});
    unexpected.push(url.href);throw Error('Unexpected fixture request: '+url.href);
  });
  const loaderOptions={configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}};
  loadModule=await navigationLoader(loaderOptions);
  const {default:App}=await loadModule('/src/App.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container,{onCaughtError:()=>{}});
  await act(async()=>root.render(createElement(App)));
  if(!delayedModule||!query.includes('view='+(delayedModule==='legislation'?'legislation':'groups')))await viewReady(container);
  const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text);
  const click=async node=>{assert(node,'Missing control');node.focus();await act(async()=>node.click());if(!delayedModule)await viewReady(container);};
  const finish=(data,status=200)=>act(async()=>{assert(pending.length,'Missing pending page');pending.shift().resolve(Response.json(data,{status}));});
  return {window,container,pending,portraitRequests,button,click,finish,releaseView:async()=>{await act(async()=>{releaseModule();await loadModule('/src/'+delayedFile);});await viewReady(container);}};
}

for(const [query,expected] of [
  ['',''],
  ['?lang=en&role=both',''],
  ['?lang=hu&role=member','?lang=hu&role=member'],
  ['?lang=hu&role=substitute&view=outside','?lang=hu&view=outside'],
  ['?global-fts-text-lang=en&global-fts-search=deutsch&lang=en&role=both&view=outside&global-fts-closed=1&ov-person=257105','?view=outside&ov-person=257105'],
])test('App omits defaults and irrelevant URL state for '+(query||'the default view'),async t=>{
  const h=await harness(t,query);
  const actualParams=new URLSearchParams(h.window.location.search),expectedParams=new URLSearchParams(expected);
  actualParams.sort();expectedParams.sort();assert.equal(actualParams.toString(),expectedParams.toString());
  assert.equal(h.window.document.documentElement.lang,new URLSearchParams(query).get('lang')||'en');
});

test('global search stays remembered across top-level navigation while its share URL stays clean',async t=>{
  const h=await harness(t,'?view=outside&ov-person=257105&global-fts-search=deutsch&global-fts-text-lang=fr&global-fts-closed=1');
  await h.click(h.button('Following'));
  assert.equal(h.window.location.search,'?view=saved');
  await h.click(h.container.querySelector('[aria-label="Search Parliament"]'));
  assert.equal(h.container.querySelector('.explorer-search-panel input').value,'deutsch');
  assert.equal(new URL(h.window.location.href).searchParams.get('global-fts-text-lang'),'fr');
  await h.click(h.container.querySelector('[aria-label="Close search"]'));
  assert.equal(h.window.location.search,'?view=saved');
});

test('roster portraits are requested while committee memberships are unavailable',async t=>{
  const h=await harness(t,'',false,false,false,true);
  assert.match(h.container.querySelector('[data-member-id="257043"] img').getAttribute('src'),/^\/api\/portrait\/257043\?v=1$/);
  assert.deepEqual(h.portraitRequests,[], 'portraits use native image loading');
  assert.match(h.container.querySelector('.explorer-index[role="status"]').textContent,/Loading committee memberships: 0 \/ 1\./);
});

test('member destination and Back keep the wall, its portraits and scroll position while retaining filters',async t=>{
  const h=await harness(t),input=h.container.querySelector('.explorer-filters input');
  input.focus();await act(async()=>{Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype,'value').set.call(input,'Mika');input.dispatchEvent(new h.window.Event('input',{bubbles:true}));});
  const original=h.container.querySelector('[data-member-id="257043"] button'),main=h.container.querySelector('main.explorer'),order=[];
  Object.defineProperties(main,{scrollHeight:{value:1000,configurable:true},clientHeight:{value:100,configurable:true}});
  main.scrollTo=()=>order.push('existing page reset');
  t.mock.method(h.window.HTMLElement.prototype,'scrollIntoView',function(){if(this.matches('.portrait--button'))order.push('returned portrait reveal');});
  main.scrollTop=420;await act(async()=>main.dispatchEvent(new h.window.Event('scroll')));
  await h.click(original);
  assert.equal(document.activeElement,h.container.querySelector('.explorer-profile h1'));
  assert.equal(document.activeElement.getAttribute('aria-label'),'Mika Aaltola');
  assert.equal(original.isConnected,true,'the wall stays mounted behind the member page');
  assert.equal(h.container.querySelector('.explorer-wall').hidden,true);
  main.scrollTop=0;order.length=0;await h.click(h.container.querySelector('.explorer-back'));
  assert.deepEqual(order,['returned portrait reveal'],'returning restores the wall scroll instead of resetting the page');
  assert.equal(main.scrollTop,420);
  assert.equal(h.container.querySelector('.explorer-wall').hidden,false);
  assert.equal(document.activeElement,original,'the same portrait node returns, so its loaded image is kept');
  assert.equal(h.container.querySelector('.explorer-filters input').value,'Mika');
});

test('browser Back restores the portrait grid offset without remounting the wall',async t=>{
  const h=await harness(t),grid=h.container.querySelector('.explorer-portraits'),original=h.container.querySelector('[data-member-id="257043"] button');
  grid.scrollTop=900;await act(async()=>grid.dispatchEvent(new h.window.Event('scroll')));
  await h.click(original);
  assert.equal(h.container.querySelector('.explorer-wall').hidden,true);
  grid.scrollTop=0;
  const popped=new Promise(resolve=>h.window.addEventListener('popstate',resolve,{once:true}));
  await act(async()=>{history.go(-1);await popped;});await viewReady(h.container);
  assert.equal(new URLSearchParams(location.search).get('member'),null);
  assert.equal(h.container.querySelector('.explorer-wall').hidden,false);
  assert.equal(h.container.querySelector('.explorer-portraits'),grid,'the same grid returns');
  assert.equal(grid.scrollTop,900);
  assert.equal(original.isConnected,true);
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

test('old amendment URLs fall back without exposing or requesting the catalogue',async t=>{
  for(const query of ['?view=amendments&am-document=A-10-2026-0254&am-procedure=2025%2F0407(COD)','?member=257043&module=amendments&am-member=257043'])await t.test(query,async t=>{
    const h=await harness(t,query);
    assert.equal(h.button('Amendments'),undefined);
    assert.equal(h.container.querySelector('.explorer-amendments'),null);
    assert.equal(new URL(location.href).searchParams.has('view'),false);
    assert.equal([...new URL(location.href).searchParams.keys()].some(key=>key.startsWith('am-')),false);
    if(query.includes('member=')){
      assert.equal(new URL(location.href).searchParams.get('module'),'speeches');
      assert.equal(h.container.querySelector('.explorer-tabs button[aria-pressed="true"]').textContent,'Latest speeches');
    }else assert(h.container.querySelector('.explorer-filters'));
    assert.doesNotMatch(document.title,/Amendments/);
  });
});

test('history restoration rejects disabled catalogue views even when the fallback state is unchanged',async t=>{
  const h=await harness(t);
  for(const query of ['?view=amendments&am-document=A-10-2026-0254','?member=257043&module=amendments&am-member=257043','?member=257043&module=amendments&am-offset=20']){
    await act(async()=>{history.pushState(null,'',query);window.dispatchEvent(new window.Event('popstate'));});
    assert.equal(h.button('Amendments'),undefined);
    assert.equal(h.container.querySelector('.explorer-amendments'),null);
    const params=new URL(location.href).searchParams;
    assert.equal(params.has('view'),false);
    assert.equal([...params.keys()].some(key=>key.startsWith('am-')),false);
    if(params.has('member'))assert.equal(params.get('module'),'speeches');
    assert.doesNotMatch(document.title,/Amendments/);
  }
  await h.click(h.button('Questions'));
  assert.equal(new URL(location.href).searchParams.get('view'),'questions','ordinary public navigation stays available');
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

test('revealing a speech scrolls only its reading container and respects the sticky-tab margin',async t=>{
  for(const mobile of [false,true])await t.test(mobile?'page scrolling':'panel scrolling',async t=>{
    const h=await harness(t,'?member=257043&module=speeches&speech='+speechId,true);
    const shell=h.container.querySelector('.explorer'),panel=h.container.querySelector('.explorer-profile-body');
    const shellScroll=[],panelScroll=[],computed=globalThis.getComputedStyle;
    shell.scrollTop=40;panel.scrollTop=35;
    shell.scrollTo=options=>shellScroll.push(options);panel.scrollTo=options=>panelScroll.push(options);
    Object.defineProperty(shell,'clientTop',{value:1,configurable:true});
    Object.defineProperty(panel,'clientTop',{value:2,configurable:true});
    t.mock.method(globalThis,'getComputedStyle',element=>element===panel?{overflowY:mobile?'visible':'auto'}:element.id==='speech-'+speechId?{scrollMarginTop:mobile?'84px':'0px'}:computed(element));
    t.mock.method(h.window.HTMLElement.prototype,'getBoundingClientRect',function(){return {top:this===shell?0:this===panel?200:600};});
    t.mock.method(h.window.HTMLElement.prototype,'scrollIntoView',()=>assert.fail('Speech reveal must not scroll its ancestors'));
    await h.finish(page());
    assert.deepEqual(panelScroll,mobile?[]:[{top:433}]);
    assert.deepEqual(shellScroll,mobile?[{top:555}]:[]);
    assert.equal(shell.scrollTop,40,'revealing a speech cannot implicitly move the shell');
    assert.equal(document.activeElement,h.container.querySelector('.explorer-speech-toggle'));
  });
});


test('delayed view imports keep navigation focus until mount and yield to a subsequent focus choice',async t=>{
  for(const moved of [false,true,'returned'])await t.test(String(moved),async t=>{
    const h=await harness(t,'',false,true);
    await h.click(h.button('Group voices'));
    const loading=h.container.querySelector('[data-view-loading]');
    assert(loading,'the import is still pending');
    assert.equal(loading.getAttribute('aria-busy'),'true');
    assert.equal(loading.querySelector('[role=status]').textContent,'Loading view…');
    assert.equal(loading.querySelector('h1').textContent,'Group voices');
    assert.equal(h.container.querySelectorAll('main:not([style*="display: none"])').length,1);
    const header=loading.closest('main').querySelector('.parliament-header');
    assert(header,'navigation stays outside the loading region');
    assert.equal(header.querySelector('[aria-current=page]').textContent,'Group voices');
    const other=document.createElement('button');other.textContent='Another focus choice';document.body.append(other);
    if(moved)other.focus();
    if(moved==='returned'){document.body.tabIndex=-1;document.body.focus();}
    await h.releaseView();
    assert.equal(h.container.querySelector('main.explorer-insights .parliament-header'),header,'data and code arrival preserve the header node');
    assert.equal(document.activeElement,moved==='returned'?document.body:moved?other:h.container.querySelector('h1'));
  });
});

test('a pending view can be left immediately and its late import cannot reopen it',async t=>{
  const h=await harness(t,'',false,true);
  await h.click(h.button('Group voices'));
  assert(h.container.querySelector('[data-view-loading]'));
  await h.click(h.button('Members'));
  assert.equal(h.container.querySelector('[data-view-loading]'),null);
  assert(h.container.querySelector('.explorer-filters'));
  assert.equal(new URL(location.href).searchParams.has('view'),false);
  await h.releaseView();
  assert(h.container.querySelector('.explorer-filters'));
  assert.equal(h.container.querySelector('.explorer-insights'),null);
});

test('a cold deep link renders its destination shell before the view module resolves',async t=>{
  const h=await harness(t,'?view=groups&lang=fr',false,true);
  assert.equal(h.container.querySelector('[data-view-loading] h1').textContent,'Voix des groupes');
  assert.equal(h.container.querySelector('[role=status]').textContent,'Chargement de la vue…');
  assert.equal(h.container.querySelectorAll('main').length,1);
  assert(h.button('Membres'));
  await h.releaseView();
  assert.equal(h.container.querySelectorAll('main').length,1);
});

test('cold legislation links show the validated mode heading before and after the module loads',async t=>{
  for(const [mode,title] of [['agenda','Plenary agenda'],['participation','What’s hot'],['cloud','Plenary word cloud'],['trends','Topic timeline'],['dossier','Dossiers'],['invalid','Plenary agenda']])await t.test(mode,async t=>{
    const h=await harness(t,'?view=legislation&pl-mode='+mode,false,'legislation');
    assert.equal(h.container.querySelector('[data-view-loading] h1').textContent,title);
    await h.releaseView();
    assert.equal(h.container.querySelector('h1').textContent,title);
  });
});

test('Following retains its mounted header during a delayed first import',async t=>{
  const h=await harness(t,'',false,'saved');
  const header=h.container.querySelector('.parliament-header');
  await h.click(h.button('Following'));
  assert.equal(h.container.querySelector('[data-view-loading] h1').textContent,'Following');
  assert.equal(h.container.querySelector('.parliament-header'),header);
  await h.releaseView();
  assert.equal(h.container.querySelector('.parliament-header'),header);
  assert.equal(h.container.querySelectorAll('main').length,1);
});

test('loaded insight destinations reset the shared frame scroll on clicks and browser Back',async t=>{
  const h=await harness(t);
  await h.click(h.button('Questions'));
  const frame=h.container.querySelector('main.explorer-insights');
  const header=frame.querySelector('.parliament-header');
  frame.scrollTop=600;
  await h.click(h.button('Group voices'));
  assert.equal(h.container.querySelector('main.explorer-insights'),frame);
  assert.equal(frame.querySelector('.parliament-header'),header);
  assert.equal(frame.scrollTop,0,'a destination starts at the top before heading focus');
  frame.scrollTop=450;
  const popped=new Promise(resolve=>h.window.addEventListener('popstate',resolve,{once:true}));
  await act(async()=>{history.go(-1);await popped;});
  await viewReady(h.container);
  assert.equal(new URL(location.href).searchParams.get('view'),'questions');
  assert.equal(h.container.querySelector('main.explorer-insights'),frame);
  assert.equal(frame.scrollTop,0,'popstate preserves the old remount scroll behavior');
});


test('history navigation to another query in a failed view clears its boundary',async t=>{
  const h=await harness(t,'?view=groups&gv-group=ECR',false,false,true);
  assert(h.container.querySelector('.explorer-recovery [role=alert]'));
  await act(async()=>{history.pushState(null,'','?view=groups&gv-group=PPE');window.dispatchEvent(new window.Event('popstate'));});
  await viewReady(h.container);
  assert.equal(h.container.querySelector('.explorer-recovery'),null);
  assert.equal(h.container.querySelector('h1').textContent,'Group voices');
});

test('former-member Profile remains readable while Activities retains its roster fallback',async t=>{
 const h=await harness(t,'?member=43&module=profile');
 assert.match(h.container.textContent,/Not a current MEP\./);
 assert.equal(h.container.querySelectorAll('.explorer-profile-memberships details').length,2);
 assert.equal(h.container.querySelector('.explorer-former-member a').href,'https://www.europarl.europa.eu/meps/en/43');
 await h.click(h.container.querySelectorAll('.explorer-tabs button')[2]);
 assert.equal(h.container.querySelector('.explorer-profile-memberships'),null);
 assert.match(h.container.textContent,/Not a current MEP\./);
 assert.equal(h.container.querySelector('.explorer-former-member a').href,'https://www.europarl.europa.eu/meps/en/43');
});
