import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement as h,act,Suspense} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

async function harness(t) {
  const window=new Window({url:'http://localhost/?lang=hu&view=groups'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);
  const caught=[],root=createRoot(container,{onCaughtError:error=>caught.push(error)});
  t.after(async()=>{await act(async()=>root.unmount());await loadModule.close();await window.happyDOM.close();for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  const boundary=await loadModule('/src/ErrorBoundary.tsx');
  return {...boundary,load:path=>loadModule(path),window,container,caught,render:element=>act(async()=>root.render(element)),click:text=>act(async()=>{const button=[...container.querySelectorAll('button')].find(node=>node.textContent===text);assert(button,text);button.focus();button.click();})};
}
const broken=()=>{throw new Error('Malformed public fixture');};

test('API GETs and prefetches carry the contract version without changing route keys or page URLs',async t=>{
  const x=await harness(t),calls=[];
  const {API_VERSION}=await x.load('/server/api-version.mjs');
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return Response.json({ok:true});});
  const {api,prefetchData}=await x.load('/src/data.ts');
  const {useExplorerParam}=await x.load('/src/explorerUrl.ts');
  const before=location.href;
  await api('directory');await api('profile/43?lang=hu');
  const cancel=prefetchData(['speech/MTG-PL-2026-10-07-TEST?lang=fr']);
  t.after(cancel);
  for(let attempt=0;calls.length<3&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
  cancel();assert.equal(calls.length,3);
  assert.deepEqual(calls.map(({url})=>url),[`/api/directory?v=${API_VERSION}`,`/api/profile/43?lang=hu&v=${API_VERSION}`,`/api/speech/MTG-PL-2026-10-07-TEST?lang=fr&v=${API_VERSION}`]);
  assert(calls.every(({options})=>options.method==='GET'));
  assert.equal(calls[2].options.priority,'low');
  await api('speech/MTG-PL-2026-10-07-TEST?lang=fr');
  assert.equal(location.href,before);
  function Page(){const [member,setMember]=useExplorerParam('mep',null);return h('button',{onClick:()=>setMember('43')},member||'Select');}
  await x.render(h(Page));await x.click('Select');
  assert.equal(location.search,'?lang=hu&view=groups&mep=43');
  assert.equal(new URL(location.href).searchParams.has('v'),false);
});

test('concurrent API mismatches show one localized recovery notice and reload only on click',async t=>{
  const x=await harness(t),reloads=[],calls=[];
  history.replaceState(null,'','?lang=hu&view=groups&mep=43#contribution');
  const before=location.href;
  t.mock.method(location,'reload',()=>reloads.push(location.href));
  const {readJson}=await x.load('/src/client.mjs');
  const ordinary=()=>Response.json({error:{code:'snapshot_expired',message:'Snapshot expired.'}},{status:409});
  await assert.rejects(readJson('/api/member-votes/43',{fetchImpl:ordinary}));
  await x.render(h(x.RootBoundary,null,h('p',null,'Current view')));
  assert.equal(x.container.textContent,'Current view');
  const mismatch=async url=>{calls.push(url);return Response.json({error:{code:'api_version_mismatch',apiVersion:2,message:'A new version of the explorer is available.'}},{status:409});};
  await act(async()=>{
    await Promise.all([
      assert.rejects(readJson('/api/directory',{fetchImpl:mismatch}),error=>error.code==='api_version_mismatch'),
      assert.rejects(readJson('/api/profile/43',{fetchImpl:mismatch}),error=>error.code==='api_version_mismatch'),
    ]);
  });
  assert.equal(calls.length,2,'a mismatch is not retried');
  assert.equal(x.container.querySelectorAll('[role=alert]').length,1);
  assert.equal(x.container.querySelector('h1').textContent,'Elérhető a parlamenti adatböngésző új verziója');
  assert.equal(x.container.querySelector('main').lang,'hu');
  assert.equal(document.activeElement,x.container.querySelector('h1'));
  assert.equal(x.container.querySelector('[role=alert]').getAttribute('aria-labelledby'),document.activeElement.id);
  assert(!x.container.textContent.includes('Current view'),'the view and its individual errors are replaced');
  assert.equal(reloads.length,0);assert.equal(location.href,before);
  await x.click('Oldal újratöltése');
  assert.deepEqual(reloads,[before]);
  await x.render(h(x.RootBoundary,null,h('p',null,'Current view')));
  assert.equal(reloads.length,1,'rerenders never reload automatically');
});

test('localized view recovery focuses its alert heading, survives deterministic retries and resets on navigation',async t=>{
  const x=await harness(t);
  const render=(key,child)=>x.render(h(x.ErrorBoundary,{resetKey:key,language:'hu',navigation:h('nav',null,h('button',null,'Questions'))},child));
  await render('groups',h(broken));
  const alert=x.container.querySelector('[role=alert]'),heading=x.container.querySelector('h1');
  assert.equal(document.activeElement,heading);
  assert.equal(alert.getAttribute('aria-labelledby'),heading.id);
  assert.equal(heading.closest('main').lang,'hu');
  assert.equal(heading.textContent,'Ez a nézet nem jeleníthető meg');
  assert.equal(x.container.querySelector('a').getAttribute('href'),'?lang=hu');
  assert(x.container.querySelector('nav button'),'view navigation remains available');
  await x.click('Újrapróbálkozás');
  assert.equal(document.activeElement,x.container.querySelector('h1'));
  assert.equal(x.caught.length,2,'a deterministic failure remains recoverable on the next attempt');
  await render('questions',h('h1',null,'Questions'));
  assert.equal(x.container.querySelector('[role=alert]'),null);
  assert.equal(x.container.querySelector('h1').textContent,'Questions');
});

test('retry remounts the view and restores its destination when the failure has cleared',async t=>{
  const x=await harness(t);let fail=true,ready=0;
  function View(){if(fail)return broken();return h('h1',{tabIndex:-1},'Recovered');}
  await x.render(h(x.ErrorBoundary,{resetKey:'same',language:'en'},h(x.ViewContent,{render:()=>h(View),onReady:()=>{ready++;document.querySelector('h1')?.focus();}})));
  fail=false;await x.click('Try again');
  assert.equal(x.container.querySelector('[role=alert]'),null);
  assert.equal(document.activeElement.textContent,'Recovered');assert.equal(ready,1);
});

test('root fallback reads the current URL language and recovers on browser navigation',async t=>{
  const x=await harness(t);let fail=true;
  function App(){return fail?broken():h('h1',null,'Members');}
  await x.render(h(x.RootBoundary,null,h(App)));
  assert.equal(x.container.querySelector('main').lang,'hu');
  assert.equal(x.container.querySelector('nav'),null,'root fallback is independent of app navigation');
  fail=false;
  await act(async()=>{history.pushState(null,'','?lang=hu&view=groups');window.dispatchEvent(new window.Event('popstate'));});
  assert.equal(x.container.querySelector('h1').textContent,'Members');
});

test('a rejected lazy loader offers only an explicit reload, preserves the share URL and resets on navigation',async t=>{
  const x=await harness(t),reloads=[];let reject,loads=0,retries=0;
  const {lazyView,LazyViewError}=await x.load('/src/lazyView.ts');
  history.replaceState(null,'','?lang=fr&view=groups&group=RE&country=BE#contribution');
  const before=location.href;
  t.mock.method(location,'reload',()=>reloads.push(location.href));
  const View=lazyView(()=>{loads++;return new Promise((_,failure)=>{reject=failure;});});
  const render=(key,child)=>x.render(h(x.ErrorBoundary,{resetKey:key,language:'fr',navigation:h('nav',null,h('button',null,'Questions')),onRetry:()=>{retries++;}},child));
  const view=h(Suspense,{fallback:h(x.ViewLoading,{language:'fr'})},h(View));
  await render('lazy',view);
  assert.equal(x.container.querySelector('[role=status]').textContent,'Chargement de la vue…');
  assert.equal(x.container.querySelector('[aria-busy]').getAttribute('aria-busy'),'true');
  assert.equal(x.container.querySelector('[role=alert]'),null);
  assert.deepEqual(reloads,[],'delayed chunks never trigger automatic reloads');
  const cause=new TypeError('Load failed');
  await act(async()=>reject(cause));
  assert(x.caught[0] instanceof LazyViewError);
  assert.equal(x.caught[0].cause,cause,'preserve the original loader error for diagnostics');
  assert.equal(x.container.querySelector('main').lang,'fr');
  assert.equal(document.activeElement,x.container.querySelector('h1'));
  assert.equal(x.container.querySelector('[role=alert]').getAttribute('aria-labelledby'),document.activeElement.id);
  assert.equal(x.container.querySelector('p').textContent,'Rechargez la page pour essayer de charger cette vue à nouveau.');
  assert.deepEqual([...x.container.querySelectorAll('[role=alert] button')].map(node=>node.textContent),['Recharger la page']);
  assert(x.container.querySelector('nav button'),'view navigation remains available');
  assert.equal(x.container.querySelector('a').getAttribute('href'),'?lang=fr');
  assert.equal(location.href,before);
  await render('lazy',view);
  assert.equal(loads,1,'rerendering keeps the rejected lazy loader cached');
  assert.equal(reloads.length,0,'failed chunks never cause a reload loop');
  await x.click('Recharger la page');
  assert.deepEqual(reloads,[before],'reload keeps every selection, language and fragment');
  assert.equal(retries,0,'do not pretend to retry the cached loader');
  await render('questions',h('h1',null,'Questions'));
  assert.equal(x.container.querySelector('[role=alert]'),null);
  await render('ordinary-error',h(broken));
  assert([...x.container.querySelectorAll('button')].some(node=>node.textContent==='Réessayer'),'navigation clears the chunk recovery policy');
});

test('a delayed lazy loader can resolve without recovery, while its render errors still support retry',async t=>{
  const x=await harness(t);let resolve,fail=true,loads=0;
  const {lazyView}=await x.load('/src/lazyView.ts');
  function View(){if(fail)throw new TypeError('Failed to fetch dynamically imported module');return h('h1',{tabIndex:-1},'Recovered view');}
  const ViewModule=lazyView(()=>{loads++;return new Promise(success=>{resolve=success;});});
  await x.render(h(x.ErrorBoundary,{resetKey:'lazy',language:'en'},h(Suspense,{fallback:h('p',{role:'status'},'Loading…')},h(x.ViewContent,{render:()=>h(ViewModule),onReady:()=>document.querySelector('h1')?.focus()}))));
  assert.equal(x.container.querySelector('[role=status]').textContent,'Loading…');
  await act(async()=>resolve({default:View}));
  assert([...x.container.querySelectorAll('button')].some(node=>node.textContent==='Try again'),'render failures are not classified by matching error messages');
  fail=false;await x.click('Try again');
  assert.equal(x.container.querySelector('[role=alert]'),null);
  assert.equal(document.activeElement.textContent,'Recovered view');
  assert.equal(loads,1,'ordinary retry keeps the successfully loaded module');
});

test('root recovery recognizes lazy loader failures without app navigation',async t=>{
  const x=await harness(t),reloads=[];
  const {lazyView}=await x.load('/src/lazyView.ts');
  t.mock.method(location,'reload',()=>reloads.push(location.href));
  const View=lazyView(()=>Promise.reject('Module unavailable'));
  await x.render(h(x.RootBoundary,null,h(Suspense,{fallback:'Loading…'},h(View))));
  assert.equal(x.container.querySelector('nav'),null);
  assert.equal(x.container.querySelector('main').lang,'hu');
  assert.equal(x.container.querySelector('[role=alert] button').textContent,'Oldal újratöltése');
  assert(!x.container.textContent.includes('Újrapróbálkozás'));
  assert.equal(reloads.length,0);
  await x.click('Oldal újratöltése');
  assert.deepEqual(reloads,[location.href]);
});

test('a successful delayed lazy import retains the selected view without a recovery notice',async t=>{
  const x=await harness(t);let resolve;
  const {lazyView}=await x.load('/src/lazyView.ts');
  const before=location.href;
  const View=lazyView(()=>new Promise(success=>{resolve=success;}));
  await x.render(h(x.ErrorBoundary,{resetKey:'lazy',language:'fr'},h(Suspense,{fallback:h('p',{role:'status'},'Chargement…')},h(View))));
  assert.equal(x.container.querySelector('[role=status]').textContent,'Chargement…');
  await act(async()=>resolve({default:()=>h('h1',null,'Selected view')}));
  assert.equal(x.container.querySelector('[role=alert]'),null);
  assert.equal(x.container.querySelector('[role=status]'),null);
  assert.equal(x.container.querySelector('h1').textContent,'Selected view');
  assert.equal(location.href,before);
});
