import {topicFixture} from './test-support/topicFixtures.mjs';
import test from 'node:test';
import {API_VERSION} from '../server/api-version.mjs';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const questionA='E-10-2026-003031',questionB='E-10-2026-003032',answerA=questionA+'-ASW';
const source=id=>'https://www.europarl.europa.eu/doceo/document/'+id+'_EN.docx';
const file=id=>({format:'PDF',language:'en',url:source(id).replace('.docx','.pdf')});
const references=[questionA,questionB].map(id=>({key:'question:E-2026-'+id.slice(-6),kind:'question',status:'found',id,title:'Exact fixture '+id,answerIds:id===questionA?[answerA]:[]}));
function publication(id) {
  const paragraph=id===questionA?'Alpha question body. See question E-003032/2026':id===questionB?'Beta question body. See question E-003031/2026':'Omega answer body.';
  return {id,selectedDocumentId:id,files:[file(id)],answers:id===questionB?[]:[{id:answerA,files:[file(answerA)]}],selectedText:{status:'available',paragraphs:[paragraph],textLanguage:'en',availableTextLanguages:['en'],translationType:'original',sourceFormat:'DOCX',sourceUrl:source(id),notes:[{id:'n1',label:'1',text:'Exact fixture footnote.',links:[]}],noteAnchors:[{paragraph:0,offset:paragraph.length,note:'n1',label:'1'}]}};
}

async function harness(t,{mismatch=false}={}) {
  const window=new Window({url:'http://localhost/'}),calls=[],frames=new Map(),registry=new Map();let nextFrame=0;
  window.requestAnimationFrame=callback=>{const id=++nextFrame;frames.set(id,callback);return id;};window.cancelAnimationFrame=id=>frames.delete(id);
  class Highlight {constructor(...ranges){this.ranges=ranges;}}
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,CSS:{highlights:registry},Highlight,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();frames.clear();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(window.HTMLElement.prototype,'scrollIntoView',()=>{});
  t.mock.method(globalThis,'fetch',async input=>{const classification=topicFixture(input);if(classification)return classification;
    const url=new URL(input,window.location.href);assert.equal(url.searchParams.get('v'),String(API_VERSION));url.searchParams.delete('v');assert.equal(url.origin,'http://localhost','only isolated local request stubs are permitted');calls.push(url);
    if(url.pathname==='/api/references'){
      assert.equal(url.searchParams.get('lang'),'en');assert(url.searchParams.get('keys').split(',').every(key=>references.some(reference=>reference.key===key)));
      return Response.json({references});
    }
    assert.match(url.pathname,/^\/api\/document\//,'the reader must not contact corpus, media or other services');
    const id=decodeURIComponent(url.pathname.slice('/api/document/'.length));assert([questionA,questionB,answerA].includes(id),'document requests retain exact public source IDs');assert.equal(url.search,'?lang=en');
    return Response.json(publication(mismatch&&id===questionA?questionB:id));
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {InsightQuestionReader}=await loadModule('/src/InsightReaders.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=heading=>act(async()=>root.render(createElement(InsightQuestionReader,{id:questionA,language:'en',includeAnswers:true,heading:heading||'Question A'})));
  const click=node=>act(async()=>{assert(node,'missing fixture action');node.focus();node.click();});
  const ownText=reader=>reader.querySelector(':scope > .legal-reference-scope > .insight-reader-text');
  const ownCitation=reader=>ownText(reader).querySelector('button.legal-ref');
  const button=(scope,label)=>[...scope.querySelectorAll('button')].find(button=>button.textContent===label||button.getAttribute('aria-label')===label);
  async function openCard(citation) {
    await click(citation);const controlled=citation.getAttribute('aria-controls');assert(controlled);const card=document.getElementById(controlled);
    assert(card?.classList.contains('legal-reference-card'));assert(card.parentElement.contains(citation));assert(document.activeElement===card);return card;
  }
  async function openQuestion(reader) {
    const citation=ownCitation(reader),card=await openCard(citation),scope=card.parentElement;
    await click([...card.querySelectorAll('button')].find(button=>button.textContent.startsWith('Read question')));
    const region=scope.querySelector(':scope > .legal-reference-question');assert(region);assert(document.activeElement===region);
    return {citation,region,reader:region.querySelector(':scope > .insight-inline-reader')};
  }
  async function circular() {
    const outer=container.firstElementChild,toB=await openQuestion(outer),backToA=await openQuestion(toB.reader);
    assert(backToA.reader);return {outer,toB,backToA};
  }
  async function flushFrames(){for(let round=0;round<5&&frames.size;round++)await act(async()=>{const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(performance.now());});}
  async function find(reader,query) {
    const control=reader.querySelector(':scope > .insight-reader-heading .explorer-find-text');assert(control);
    if(!control.querySelector('input'))await click(control.querySelector('button'));
    await act(async()=>{const input=control.querySelector('input');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,query);input.dispatchEvent(new window.InputEvent('input',{bubbles:true,inputType:'insertText',data:query}));});
    await flushFrames();const highlightId=control.querySelector('style').textContent.match(/::highlight\(([^)]+)\)/)[1];
    return {control,status:control.querySelector('[role="status"]').textContent,ranges:registry.get(highlightId).ranges};
  }
  await render();return {window,container,calls,registry,render,click,ownText,ownCitation,button,openCard,circular,find,flushFrames};
}

test('mutual question references and repeated answers have unique stable reader instances without changing source identities',async t=>{
  const h=await harness(t),{outer,toB,backToA}=await h.circular();
  const readers=[...h.container.querySelectorAll('section.insight-inline-reader')],ids=readers.map(reader=>reader.id);
  assert.equal(readers.length,5,'A, its answer, B, nested A and its repeated answer are all retained');
  assert.equal(new Set(ids).size,ids.length,'simultaneous repeated source documents need unique rendered section IDs: '+ids.join(', '));
  assert.equal(h.ownText(outer).querySelector('p').textContent,'Alpha question body. See question E-003032/20261');
  assert.equal(h.ownText(toB.reader).querySelector('p').textContent,'Beta question body. See question E-003031/20261');
  assert.equal(h.ownText(backToA.reader).textContent,h.ownText(outer).textContent);
  const answers=readers.filter(reader=>reader.querySelector(':scope > .insight-reader-heading h3')?.textContent==='Answer');assert.equal(answers.length,2);
  for(const answer of answers){assert(h.ownText(answer).textContent.startsWith('Omega answer body.'));assert(answer.querySelector(`:scope > .insight-reader-source a[href="${source(answerA)}"]`));}
  const documentIds=h.calls.filter(url=>url.pathname.includes('/document/')).map(url=>decodeURIComponent(url.pathname.split('/document/')[1]));
  assert.deepEqual(documentIds.sort(),[questionA,answerA,questionB].sort(),'nested reuse keeps exact requested document IDs and the same shared request cache');
  for(const reader of readers){
    const fragment=h.ownText(reader).querySelector('.legal-note-mark a');assert(fragment);const target=document.getElementById(fragment.hash.slice(1));assert(target);assert(h.ownText(reader).contains(target),'each footnote fragment resolves within its own rendered reader');
  }
  const allIds=[...h.container.querySelectorAll('[id]')].map(node=>node.id);assert.equal(new Set(allIds).size,allIds.length,'footnotes and answer readers also stay unique');
  await h.render('Retained question A');assert(readers.every(reader=>reader.isConnected));assert.deepEqual(readers.map(reader=>reader.id),ids,'ordinary rerenders do not change reader-instance IDs');
  for(const reader of [outer,toB.reader,backToA.reader]){
    const citation=h.ownCitation(reader),card=await h.openCard(citation);assert.equal(document.getElementById(citation.getAttribute('aria-controls')),card);
    await act(async()=>document.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert(document.activeElement===citation);assert.equal(card.isConnected,false);
    const reopened=await h.openCard(citation);await h.click(h.button(reopened,'Close'));assert(document.activeElement===citation);assert.equal(reopened.isConnected,false);
  }
  await h.click(backToA.region.querySelector(':scope > button'));assert(document.activeElement===backToA.citation);assert.equal(backToA.region.isConnected,false);assert(toB.region.isConnected);
  await h.click(toB.region.querySelector(':scope > button'));assert(document.activeElement===toB.citation);assert.equal(toB.region.isConnected,false);assert(outer.isConnected);
});

test('local find stays within each repeated question and answer text instance',async t=>{
  const h=await harness(t),{outer,toB,backToA}=await h.circular();
  for(const reader of [outer,backToA.reader]){
    const found=await h.find(reader,'alpha');assert.equal(found.status,'1 / 1');assert.equal(found.ranges.length,1);
    assert(found.ranges.every(range=>h.ownText(reader).contains(range.startContainer)&&h.ownText(reader).contains(range.endContainer)),'the active find uses this reader\'s own text ref');
    assert.equal((await h.find(reader,'beta')).status,'No matches','nested B text is outside A\'s find target');
    assert.equal((await h.find(reader,'omega')).status,'No matches','included answer text is outside the parent question find target');
  }
  assert.equal((await h.find(toB.reader,'beta')).status,'1 / 1');assert.equal((await h.find(toB.reader,'alpha')).status,'No matches');
  for(const reader of [outer,backToA.reader]){
    const answer=[...reader.children].find(child=>child.matches('section.insight-inline-reader'));assert(answer);
    const found=await h.find(answer,'omega');assert.equal(found.status,'1 / 1');assert.equal(found.ranges.length,1);assert(found.ranges.every(range=>h.ownText(answer).contains(range.startContainer)&&h.ownText(answer).contains(range.endContainer)));
    assert.equal((await h.find(answer,'alpha')).status,'No matches');
  }
  const find=outer.querySelector(':scope > .insight-reader-heading .explorer-find-text');await h.click(h.button(find,'Close find'));await h.flushFrames();
  assert(document.activeElement===find.querySelector('button'),'local-find Close returns to its own retained toggle');
});

test('rendered instance identity does not admit a mismatched source response',async t=>{
  const h=await harness(t,{mismatch:true});assert.equal(h.ownText(h.container.firstElementChild),null);assert(!h.container.textContent.includes('Beta question body.'));
  await act(async()=>new Promise(resolve=>setTimeout(resolve,400)));
  assert.equal(h.container.querySelector('[role="status"][aria-live="polite"]').textContent,'Question A: Text temporarily unavailable.');assert.equal(h.calls[0].pathname,'/api/document/'+questionA);assert(h.container.querySelector('.reader-retry button'),'a mismatched read remains locally recoverable');
});
