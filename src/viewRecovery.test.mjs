import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement as h,act,lazy,Suspense} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

async function harness(t) {
  const window=new Window({url:'http://localhost/?lang=hu&view=groups'});
  const globals={window,document:window.document,location:window.location,history:window.history,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);
  const caught=[],root=createRoot(container,{onCaughtError:error=>caught.push(error)});
  t.after(async()=>{await act(async()=>root.unmount());await vite.close();await window.happyDOM.close();for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  const boundary=await vite.ssrLoadModule('/src/ErrorBoundary.tsx');
  return {...boundary,window,container,caught,render:element=>act(async()=>root.render(element)),click:text=>act(async()=>{const button=[...container.querySelectorAll('button')].find(node=>node.textContent===text);assert(button,text);button.focus();button.click();})};
}
const broken=()=>{throw new Error('Malformed public fixture');};

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

test('a rejected lazy import reaches recovery with a page reload option',async t=>{
  const x=await harness(t);let reject;
  const View=lazy(()=>new Promise((_,failure)=>{reject=failure;}));
  await x.render(h(x.ErrorBoundary,{resetKey:'lazy',language:'fr'},h(Suspense,{fallback:h('p',{role:'status'},'Chargement…')},h(View))));
  assert.equal(x.container.querySelector('[role=status]').textContent,'Chargement…');
  await act(async()=>reject(new TypeError('Failed to fetch dynamically imported module')));
  assert.equal(x.container.querySelector('main').lang,'fr');
  assert.equal(document.activeElement,x.container.querySelector('h1'));
  assert([...x.container.querySelectorAll('button')].some(node=>node.textContent==='Recharger la page'));
  assert.equal(x.container.querySelector('a').getAttribute('href'),'?lang=fr');
});
