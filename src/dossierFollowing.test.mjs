import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement,StrictMode} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
const reference='2025/0407(COD)',epoch='12345678-1234-1234-1234-123456789abc';
async function harness(t) {
  const window=new Window({url:'http://localhost/?view=saved'}),globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:window.ResizeObserver,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let generation=1,root,loader;const requests=[];
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(loader)await loader.close();await window.happyDOM.close();for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href),path=url.pathname.split('/').at(-1);requests.push(url);
    if(path==='following-status')return Response.json({epoch,generation,marksReady:true});
    if(path==='following-dossiers')return Response.json({epoch,generation,indexComplete:true,items:[{reference,status:'available',entries:generation===1?[]:[{id:'recorded-stage',mark:generation,eventKind:'stage',title:'Parliament position adopted',titleLanguage:'en',date:'2026-07-07'}]}]});
    if(path==='procedure-progress')return Response.json({reference,state:'mapped',coverage:{},events:[],source:{fetchedAt:'2026-10-23T10:00:00Z'}});
    if(path==='press-releases')return Response.json({reference,watermark:1,items:[],coverage:{followingSince:'2026-10-20',feeds:[],procedureLinks:{status:'available'}},dossier:{title:'Public dossier title',language:'en',summaries:[],source:{fetchedAt:'2026-10-23T10:00:00Z'}}});
    if(path==='procedure-context')return Response.json({reference,title:'Public dossier title',language:'en',summary:null,summaries:[],topics:[],subjects:[],source:{url:'https://oeil.europarl.europa.eu/'}});
    assert.fail('Unexpected route '+url);
  });
  loader=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const controls=await loader('/src/DossierControls.tsx'),{Saved}=await loader('/src/Saved.tsx'),{SavedNav}=await loader('/src/SavedControls.tsx'),{ProcedureContext}=await loader('/src/ProcedureContext.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const flush=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
  const renderSaved=()=>act(async()=>root.render(createElement(StrictMode,null,createElement(SavedNav,{onClick(){}}),createElement(Saved,{language:'en',onBack(){},onMember(){},renderActivity(){return null;}}))));
  const click=async label=>{await act(async()=>{const button=[...container.querySelectorAll('button')].find(button=>button.textContent.trim()===label);assert(button,'Missing '+label+' in '+container.textContent);button.click();});await flush();};
  return {controls,container,requests,flush,renderSaved,click,generation:value=>generation=value,renderContext:()=>act(async()=>root.render(createElement(ProcedureContext,{reference,language:'en',showTitle:true})))};
}
test('following a dossier from its reader establishes a quiet baseline and exposes inline updates, acknowledgment and history',async t=>{
  const h=await harness(t);await h.renderContext();await h.flush();
  const follow=h.container.querySelector('.explorer-save-button');
  assert.equal(follow.getAttribute('aria-label'),'Follow dossier '+reference);assert.equal(follow.getAttribute('aria-pressed'),'false');
  await h.click('☆Follow');assert.equal(h.controls.dossierStore.snapshot().items.length,1);assert.equal(h.controls.dossierStore.snapshot().items[0].entries.length,0);
  assert.equal(follow.getAttribute('aria-label'),'Follow dossier '+reference);assert.equal(follow.getAttribute('aria-pressed'),'true');
  await h.renderSaved();await h.flush();assert.match(h.container.textContent,/No new updates/);assert(h.container.querySelector('a[href*="dossier-ref=2025"]'));
  h.generation(2);await act(async()=>h.controls.checkDossiers({force:true}));await h.flush();
  assert.match(h.container.textContent,/1 new/);assert.match(h.container.textContent,/Parliament position adopted/);
  const row=h.container.querySelector('.dossier-update-disclosure');await act(async()=>row.click());await h.flush();
  assert(h.controls.dossierStore.snapshot().items[0].entries[0].readAt!==null);assert.equal(row.getAttribute('aria-expanded'),'true');assert.equal(location.search,'?view=saved');
  await act(async()=>row.click());assert.equal(h.container.querySelector('.explorer-saved-history'),null);assert(h.container.textContent.includes('Parliament position adopted'),'read row remains in place during this visit');
  await h.click('Read here');assert.match(h.container.textContent,/Public dossier title/);
});
test('automatic source reads are bounded to five dossiers and all follow checks request English',async t=>{
  const h=await harness(t);
  await act(async()=>{for(let n=0;n<7;n++)h.controls.dossierStore.toggle({id:`2025/${String(n).padStart(4,'0')}(COD)`});await h.controls.checkDossiers();});
  const progress=h.requests.filter(url=>url.pathname.endsWith('/procedure-progress'));assert.equal(progress.length,5);assert(progress.every(url=>url.searchParams.get('lang')==='en'));
});

test('an opened row stays read when bounded history drops its stored entry',async t=>{
  const h=await harness(t);h.controls.dossierStore.toggle({id:reference});await h.renderSaved();await h.flush();
  h.generation(2);await act(async()=>h.controls.checkDossiers({force:true}));await h.flush();
  await act(async()=>h.container.querySelector('.dossier-update-disclosure').click());await h.flush();
  await act(async()=>{
    const expected=h.controls.dossierStore.snapshot().items[0];
    h.controls.dossierStore.observeIndex({epoch,generation:3,indexComplete:true,items:[{reference,status:'available',entries:Array.from({length:6},(_,i)=>({id:'later-'+i,mark:3,eventKind:'stage',title:'Later event '+i,date:'2026-10-23'}))}]},[expected]);
    h.controls.dossierStore.markRead(reference);
  });
  assert(!h.controls.dossierStore.snapshot().items[0].entries.some(entry=>entry.id==='recorded-stage'));
  const pinned=[...h.container.querySelectorAll('.dossier-update-disclosure')].find(row=>row.textContent.includes('Parliament position adopted'));
  assert(pinned);assert.equal(pinned.querySelector('.explorer-saved-new'),null);
});
