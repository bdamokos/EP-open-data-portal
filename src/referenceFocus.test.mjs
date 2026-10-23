import test from 'node:test';
import {API_VERSION} from '../server/api-version.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {contrast,paintedBackground,schemes,themeCss,tokenValue} from './test-support/themeStyles.mjs';

const first='E-10-2026-003031',second='E-10-2026-003032';
const citation='E-003031/2026',text='See question '+citation+'.';
const resolved=id=>({key:'question:E-2026-'+id.slice(-6),kind:'question',status:'found',id,title:'Official question '+id});
const documentResponse=(id,paragraphs)=>({id,selectedDocumentId:id,files:[],answers:[],selectedText:{status:'available',paragraphs,textLanguage:'en',availableTextLanguages:['en','fr'],translationType:'original'}});

async function reader(t,{heading=true,citationInNotes=false}={}) {
  const window=new Window({url:'http://localhost/'}),requests=[],scrolls=[];
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,matchMedia:()=>({matches:true}),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());for(const request of requests)if(!request.finished)request.resolve(Response.json({}));t.mock.timers.reset();if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(window.HTMLElement.prototype,'scrollIntoView',function(options){scrolls.push({element:this,options});});
  t.mock.method(globalThis,'fetch',input=>{
    const url=new URL(input,window.location.href);assert.equal(url.searchParams.get('v'),String(API_VERSION));url.searchParams.delete('v');const route=url.pathname.split('/api/')[1]+url.search;
    if(route.startsWith('references?'))return Promise.resolve(Response.json({references:[resolved(first),resolved(second)]}));
    assert.match(route,/^document\//,'focus fixtures must never contact unrelated services');
    return new Promise((resolve,reject)=>requests.push({route,resolve,reject,finished:false}));
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {ReferenceScope,ReferenceText,DocumentNotes}=await vite.ssrLoadModule('/src/References.tsx');
  const {InsightQuestionReader}=await vite.ssrLoadModule('/src/InsightReaders.tsx');
  const {createRoot}=await import('react-dom/client');
  // Module loading uses real timers; only mounted application deadlines are advanced.
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(window,'setTimeout',(callback,ms,...args)=>setTimeout(callback,ms,...args));
  t.mock.method(window,'clearTimeout',timer=>clearTimeout(timer));
  const tick=async(ms=350)=>{await act(async()=>{});await act(async()=>{t.mock.timers.tick(ms);});};
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const notes=citationInNotes?[{id:'1',label:'1',text,links:[]}]:[];
  const render=(showCitation=true)=>act(async()=>root.render(createElement(heading?'section':'div',null,
    heading&&createElement('h3',null,'Original document'),
    createElement('button',{id:'retained'},'Retained document control'),
    createElement(ReferenceScope,{texts:[text],notes,language:'en',renderQuestion:id=>createElement(InsightQuestionReader,{id,language:'en',heading:'Referenced question',includeAnswers:true})},
      createElement('p',null,citationInNotes?'Original document body.':showCitation?createElement(ReferenceText,{text}):'Updated document text without that citation.'),
      citationInNotes&&showCitation&&createElement(DocumentNotes,{notes,prefix:'focus-notes'})))));
  const click=element=>act(async()=>{assert(element,'Missing action');element.focus();element.click();});
  const findButton=(label,scope=container)=>[...scope.querySelectorAll('button')].find(button=>button.textContent===label);
  const finish=(id,paragraphs,{error=false}={})=>act(async()=>{
    const request=requests.find(request=>request.route===`document/${id}?lang=en`&&!request.finished);assert(request,'Missing document request '+id);request.finished=true;
    if(error)request.reject(new Error('Fixture document unavailable'));else request.resolve(Response.json(documentResponse(id,paragraphs)));
  });
  await render();
  return {window,container,scrolls,tick,render,click,findButton,finish,citation:()=>container.querySelector('button.legal-ref'),open:async(trigger=container.querySelector('button.legal-ref'))=>{await click(trigger);const card=container.querySelector('.legal-reference-card');assert.equal(document.activeElement,card);return card;}};
}

test('pinned reference Close and Escape return to the exact citation without resize refocusing its controls',async t=>{
  const h=await reader(t),citation=h.citation();
  const card=await h.open();assert.equal(card.getAttribute('role'),'dialog');
  assert.equal(h.scrolls.length,1,'the existing pinned-card scroll runs once for the explicit opening');
  const close=card.querySelector('button[aria-label="Close"]');close.focus();
  await act(async()=>h.window.dispatchEvent(new h.window.Event('resize')));
  assert.equal(document.activeElement,close,'repositioning must not take focus from a card control');assert.equal(h.scrolls.length,1);
  await h.click(close);assert.equal(document.activeElement,citation);assert.equal(h.container.querySelector('.legal-reference-card'),null);
  await h.open(citation);await act(async()=>document.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(document.activeElement,citation);assert.equal(h.container.querySelector('.legal-reference-card'),null);
});

test('a hover preview neither focuses nor scrolls until the citation is explicitly pinned',async t=>{
  const h=await reader(t),citation=h.citation(),retained=h.container.querySelector('#retained');retained.focus();
  await act(async()=>citation.dispatchEvent(new h.window.PointerEvent('pointerover',{pointerType:'mouse',bubbles:true})));
  await h.tick(349);assert.equal(h.container.querySelector('.legal-reference-card'),null,'hover must not open early');
  assert.equal(document.activeElement,retained);assert.equal(h.scrolls.length,0);
  await h.tick(1);
  assert(h.container.querySelector('.legal-reference-card'),'the existing fine-pointer hover preview remains available');
  assert.equal(document.activeElement,retained);assert.equal(h.scrolls.length,0);
  await h.open(citation);assert.equal(h.scrolls.length,1);
});

test('referenced readers focus a stable pending destination, preserve local-find refs and return one exact citation level at a time',async t=>{
  const h=await reader(t),original=h.citation();
  await h.open(original);await h.click(h.findButton('Read question'));
  const outer=h.container.querySelector('.legal-reference-question');
  assert.equal(document.activeElement,outer);assert.equal(outer.getAttribute('aria-label'),'Referenced question');
  assert(outer.textContent.includes('Loading text…'),'the destination exists while its document is pending');
  assert.equal(h.scrolls.length,1,'opening the nested reader must not add a new scrolling policy');
  const retained=h.container.querySelector('#retained');retained.focus();
  await h.finish(first,['See question E-003032/2026.']);assert.equal(document.activeElement,retained,'document completion must not steal focus');
  const search=outer.querySelector('button[aria-label="Find in referenced question"]');assert(search,'the existing local-find control remains available');
  assert(outer.querySelector('.insight-reader-text').textContent.includes('E-003032/2026'));
  assert.equal(outer.querySelector('.insight-reader-text').closest('[role="status"],[aria-live]'),null);
  const nested=outer.querySelector('button.legal-ref');await h.open(nested);await h.click(h.findButton('Read question'));
  const inner=outer.querySelector('.legal-reference-question');assert.equal(document.activeElement,inner);
  await h.finish(second,['An exact nested question body.']);
  assert.equal(document.activeElement,inner,'arrival retains the already focused destination');
  await h.click(inner.querySelector(':scope > button'));assert.equal(document.activeElement,nested);assert.equal(inner.isConnected,false);
  await h.click(outer.querySelector(':scope > button'));assert.equal(document.activeElement,original);assert.equal(outer.isConnected,false);
});

test('nested-reader error and late completion after close do not reclaim focus',async t=>{
  const h=await reader(t),citation=h.citation(),retained=h.container.querySelector('#retained');
  await h.open();await h.click(h.findButton('Read question'));
  const destination=h.container.querySelector('.legal-reference-question');retained.focus();
  await h.finish(first,[],{error:true});assert.equal(document.activeElement,retained);
  assert(destination.textContent.includes('Text temporarily unavailable.'));assert.equal(destination.isConnected,true);
  await h.click(destination.querySelector(':scope > button'));assert.equal(document.activeElement,citation);
  await h.open();await h.click(h.findButton('Read question'));
  const reopened=h.container.querySelector('.legal-reference-question');
  await h.click(reopened.querySelector(':scope > button'));assert.equal(document.activeElement,citation);
  await h.finish(first,['Late source text.']);assert.equal(document.activeElement,citation);assert.equal(h.container.querySelector('.legal-reference-question'),null);
});

test('a disappeared or unavailable citation falls back to the retained local heading',async t=>{
  for(const change of ['removed','hidden','inert','aria-hidden'])await t.test(change,async t=>{
    const h=await reader(t);await h.open();await h.click(h.findButton('Read question'));
    if(change==='removed')await h.render(false);else h.citation().setAttribute(change,change==='aria-hidden'?'true':'');
    const close=h.container.querySelector('.legal-reference-question > button');await h.click(close);
    assert.equal(document.activeElement,h.container.querySelector('h3'));
    assert.equal(document.activeElement.textContent,'Original document');
    assert.equal(document.activeElement.tabIndex,-1,'fallback headings do not enter the sequential tab order');
    assert.equal(h.container.querySelector('.legal-reference-question'),null);
    h.container.querySelector('#retained').focus();assert.equal(h.container.querySelector('h3').hasAttribute('tabindex'),false,'temporary heading focusability is cleared on departure');
  });
});

test('a disappeared citation without a local heading returns to the labelled connected scope',async t=>{
  const h=await reader(t,{heading:false});await h.open();await h.click(h.findButton('Read question'));await h.render(false);
  await h.click(h.container.querySelector('.legal-reference-question > button'));
  assert.equal(document.activeElement,h.container.querySelector('.legal-reference-scope'));
  assert.equal(document.activeElement.getAttribute('aria-label'),'Document text and references');
  assert.equal(document.activeElement.tabIndex,-1);
});

test('closing a referenced question from collapsed Notes returns to a visible local fallback',async t=>{
  const h=await reader(t,{citationInNotes:true}),citation=h.citation(),notes=h.container.querySelector('details.legal-notes');
  assert.equal(notes.open,true);assert(notes.contains(citation));
  await h.open(citation);await h.click(h.findButton('Read question'));
  await act(async()=>{notes.open=false;});
  assert.equal(citation.isConnected,true,'collapsing Notes retains the original citation node');
  await h.click(h.container.querySelector('.legal-reference-question > button'));
  assert(document.activeElement===h.container.querySelector('h3'),'the return target must be visible outside collapsed Notes');
  assert.equal(notes.open,false,'focus recovery preserves the chosen disclosure state');
  assert.equal(h.scrolls.length,1,'focus recovery adds no scroll operation');
  assert.equal(citation.textContent,'E-003031/2026','the exact cited identifier remains intact');
});

test('reference scope, citations, reader destinations, cards and player controls use the focus token in both schemes',async t=>{
  const files=['References.css','ParliamentHeader.css','explorer.css','Insights.css','ExplorerLayout.css','TextSearch.css','base.css'];
  const styles=await Promise.all(files.map(file=>readFile(new URL(file,import.meta.url),'utf8')));
  for(const scheme of schemes)for(const shell of ['explorer','explorer-insights'])for(const nested of [false,true])for(const mode of ['focus','focus-visible'])await t.test(`${scheme} ${shell}${nested?' nested':''} ${mode}`,async t=>{
    const window=new Window();t.after(()=>window.happyDOM.close());
    // Removing focus-visible selectors also exercises the independent :focus
    // cascade; Happy DOM does not model native keyboard/pointer modality.
    window.document.head.innerHTML=[themeCss(scheme),...styles].map(style=>`<style>${mode==='focus'?style.replaceAll(':focus-visible',':not(*)'):style}</style>`).join('');
    window.document.body.innerHTML=`<main class="${shell}"><section class="explorer-saved-view"><div class="insight-inline-reader"><div class="legal-reference-scope" tabindex="-1" role="group" aria-label="Document text and references"><button class="legal-ref">Original citation</button><div class="legal-reference-question" tabindex="-1" role="region" aria-label="Referenced question"><button class="legal-reference-text-button">Close referenced question</button>${nested?'<div class="insight-inline-reader"><div class="legal-reference-scope" tabindex="-1" role="group" aria-label="Nested document text and references"><button class="legal-ref">Nested citation</button>':''}<div class="legal-reference-card" tabindex="-1"><button class="legal-reference-close">Close</button><div class="legal-reference-actions"><button>Read question</button><button aria-expanded="true">Summary</button><a href="#source">Source</a></div><details><summary>Notes</summary></details><a href="#footnote">Footnote</a><input aria-label="Find"><select aria-label="Language"><option>EN</option></select><button class="legal-ref">Card citation</button></div>${nested?'</div></div>':''}</div><div class="explorer-video"><button id="player-control">Player action</button></div></div></div></section></main>`;
    const focus=tokenValue(scheme,'focus'),playerControl=window.document.querySelector('#player-control');
    for(const control of window.document.querySelectorAll('.legal-reference-scope,.legal-reference-question,.legal-reference-card,button,a,input,select,summary')){
      if(control===playerControl&&mode==='focus')continue;
      control.focus();const style=window.getComputedStyle(control);
      assert.equal(window.document.activeElement,control);assert.equal(style.outlineStyle,'solid');assert.equal(style.outlineColor,focus,control.outerHTML);assert(parseFloat(style.outlineWidth)>=3);
      const behind=paintedBackground(window,control.parentElement,scheme);
      assert(contrast(style.outlineColor,behind)>=3,`${control.outerHTML}: ${style.outlineColor} on ${behind}`);
    }
  });
});
