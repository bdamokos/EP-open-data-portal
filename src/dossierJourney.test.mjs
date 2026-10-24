import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement,useEffect,useState} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const origin='/?member=257727&module=activities&lang=en&role=both&country=HU&activity-category=reports&activity-offset=20&activity=reports%3AA-10-2026-0010&ma-view=document&ma-text=A-10-2026-0010';
const dossier='/?view=legislation&pl-mode=dossier&dossier-ref=2025%2F0176%28COD%29&dossier-person=257727&lang=en';
async function harness(t) {
  const window=new Window({url:'http://localhost'+origin}),originals=new Map();
  for(const [key,value] of Object.entries({window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  }
  let root,load,latest,readerPending=false;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const journey=await load('/src/dossierJourney.ts'),{createRoot}=await import('react-dom/client');
  function Origin() {
    const [language,setLanguage]=journey.useDossierReaderState('source-language','en');latest={language,setLanguage};
    return createElement('main',{className:'explorer'},createElement('h1',null,'Member'),createElement('div',{className:'explorer-profile-body'},
      createElement('section',{className:'explorer-activities'},createElement('article',{id:'activity-row'},createElement('button',{className:'explorer-speech-toggle','aria-expanded':true},'Expanded report'),
        createElement('section',{className:'document-context-reader','data-context-pending':readerPending?'true':undefined},createElement('p',null,'Exact source text'),createElement('p',{id:'selected-reader-language'},language),
          createElement('details',{id:'wording-details'},createElement('summary',null,'Published wording'),createElement('p',null,'Original and proposed wording')),
          createElement('a',{id:'origin-link',href:dossier,onClick:journey.dossierLinkClick},'Work on this dossier'))))));
  }
  function Shell() {
    journey.useDossierJourney();const [query,setQuery]=useState(location.search);
    useEffect(()=>{const sync=()=>setQuery(location.search);window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);
    return new URLSearchParams(query).get('view')==='legislation'?createElement('main',{className:'explorer-insights'},createElement('div',{className:'insight-dossier-title'},createElement('h2',null,'Long official dossier title')),createElement('section',{'data-dossier-reference':'2025/0176(COD)','data-dossier-person':new URLSearchParams(query).get('dossier-person')||''},createElement('h3',null,'Work on this dossier'),createElement('a',{href:origin,id:'return-link',onClick:journey.dossierLinkClick},'Back'))):createElement(Origin);
  }
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=()=>act(async()=>root.render(createElement(Shell)));
  const frames=()=>act(async()=>new Promise(resolve=>window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>window.requestAnimationFrame(resolve)))));
  await render();
  const click=async selector=>act(async()=>{const link=container.querySelector(selector);assert(link);link.focus();link.click();});
  return {window,container,journey,get latest(){return latest;},click,frames,async pending(value){readerPending=value;await render();},async pop(href){await act(async()=>{history.replaceState(history.state,'',href);window.dispatchEvent(new Event('popstate'));});}};
}

test('dossier return restores complete URL, reader choice, expanded details, nested scroll and focus only after exact destination settles',async t=>{
  const h=await harness(t);await act(async()=>h.latest.setLanguage('hu'));
  const main=h.container.querySelector('main'),body=h.container.querySelector('.explorer-profile-body'),reader=h.container.querySelector('.document-context-reader');
  main.scrollTop=340;body.scrollTop=620;reader.scrollTop=95;h.container.querySelector('details').open=true;
  await h.click('#origin-link');await h.frames();
  assert.equal(new URL(location.href).searchParams.get('dossier-person'),'257727');assert(h.container.querySelector('[data-dossier-reference]'));
  // App canonicalizes defaults after mounting. That must not lose restoration.
  await h.pop(location.href+'&role=both');await h.pending(true);
  await h.click('#return-link');await h.frames();
  assert.equal(location.pathname+location.search,origin);
  assert.equal(h.latest.language,'hu','the selected reader language belongs to the origin URL');
  assert.equal(h.journey.dossierJourneyRestoring(),true);
  assert.equal(h.container.querySelector('main').scrollTop,0,'a loading destination cannot take the saved scroll');
  assert.notEqual(document.activeElement?.id,'origin-link');
  await h.pending(false);await h.frames();await h.frames();
  assert.equal(h.container.querySelector('main').scrollTop,340);assert.equal(h.container.querySelector('.explorer-profile-body').scrollTop,620);assert.equal(h.container.querySelector('.document-context-reader').scrollTop,95);
  assert.equal(h.container.querySelector('details').open,true);assert.equal(document.activeElement.id,'origin-link');assert.equal(h.journey.dossierJourneyRestoring(),false);
});

test('native Back uses the saved origin and user interaction cancels delayed focus/scroll restoration',async t=>{
  const h=await harness(t);h.container.querySelector('main').scrollTop=700;await h.click('#origin-link');await h.frames();
  await h.pending(true);await h.pop(origin);await h.frames();assert.equal(h.journey.dossierJourneyRestoring(),true);
  const event=new h.window.Event('pointerdown',{bubbles:true});Object.defineProperty(event,'isTrusted',{value:true});document.dispatchEvent(event);
  h.container.querySelector('.explorer-speech-toggle').focus();await h.pending(false);await h.frames();
  assert.equal(h.container.querySelector('main').scrollTop,0);assert.equal(document.activeElement.className,'explorer-speech-toggle');assert.equal(h.journey.dossierJourneyRestoring(),false);
});

test('only plain same-origin clicks enter the SPA journey',async t=>{
  const h=await harness(t),anchor=h.container.querySelector('#origin-link'),before=location.href;
  for(const modifier of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]){
    let prevented=false;h.journey.dossierLinkClick({currentTarget:anchor,button:0,preventDefault(){prevented=true;},...modifier});assert.equal(prevented,false);assert.equal(location.href,before);
  }
  anchor.href='https://example.org/external';let prevented=false;h.journey.dossierLinkClick({currentTarget:anchor,button:0,preventDefault(){prevented=true;}});assert.equal(prevented,false);assert.equal(location.href,before);
});


test('entering a person scope focuses its heading while the full dossier keeps its title target',async t=>{
  const h=await harness(t);
  await h.click('#origin-link');await h.frames();
  assert.equal(document.activeElement,h.container.querySelector('[data-dossier-reference] h3'));
  await h.click('#return-link');await h.frames();
  h.container.querySelector('#origin-link').href=dossier.replace('&dossier-person=257727','');
  await h.click('#origin-link');await h.frames();
  assert.equal(document.activeElement,h.container.querySelector('.insight-dossier-title h2'));
});
