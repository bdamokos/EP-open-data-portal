import {installRetryClock} from './test-support/automaticRecovery.mjs';
import {topicFixture} from './test-support/topicFixtures.mjs';
import {proposalContextResponse} from './test-support/proposalContext.mjs';
import {contextOverlayResponse} from './test-support/contextOverlay.mjs';
import {freshLoader} from './test-support/viteRunner.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {API_VERSION} from '../server/api-version.mjs';
import {createElement as el,act} from 'react';
import {Window} from 'happy-dom';

const report='A-10-2026-0257',amendment=report+'-AM-7',list=report+'-AM-001-020',readUrl=(extra='')=>'http://localhost/?view=legislation&pl-mode=read&read-doc='+report+extra;

async function harness(t,url,respond,width=390) {
  const window=new Window({url,width,height:844}),requests=[],scrolls=[];
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,requestAnimationFrame:callback=>setTimeout(callback,0),cancelAnimationFrame:clearTimeout,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(window.HTMLElement.prototype,'scrollIntoView',function(options){scrolls.push({element:this,options});});
  t.mock.method(globalThis,'fetch',async input=>{const classification=topicFixture(input);if(classification)return classification;
    const url=new URL(input,window.location.href);assert.equal(url.searchParams.get('v'),String(API_VERSION));url.searchParams.delete('v');const route=url.pathname.split('/api/')[1];
    assert(route,'Only mocked application routes are allowed');requests.push(route+url.search);
    if(route==='references')return Response.json({references:[]});
    if(route.startsWith('document-pages/'))return Response.json({pages:[]});
    const value=await respond(route,url.searchParams);assert.notEqual(value,undefined,'Unexpected request: '+route+url.search);
    return value instanceof Response?value:Response.json(value);
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {ReadPage}=await loadModule('/src/ReadPage.tsx'),journey=await loadModule('/src/dossierJourney.ts');
  const {createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);installRetryClock(t);root=createRoot(container);
  const settle=async()=>{for(let i=0;i<6;i++)await act(async()=>new Promise(resolve=>setTimeout(resolve,15)));};
  const mount=async()=>{await act(async()=>root.render(el(ReadPage,{language:'en'})));await settle();};
  await mount();
  const click=async element=>{assert(element,'Missing control');await act(async()=>element.click());await settle();};
  const button=text=>[...container.querySelectorAll('button')].find(item=>(item.getAttribute('aria-label')||item.textContent.trim())===text);
  const remount=async()=>{await act(async()=>root.render(null));await mount();};
  return {window,container,requests,scrolls,settle,click,button,journey,remount};
}
const placedParagraphs=h=>[...h.container.querySelectorAll('[data-proposal-item] [data-source-paragraph]')].map(node=>Number(node.dataset.sourceParagraph));

test('an amendment opens with its header, reference and diff above a passage of its proposal',async t=>{
  const source=proposalContextResponse(report,amendment,list,7);
  assert.equal(source.placement.status,'placed','the fixture places this amendment');
  const whole=source.proposal.items.reduce((sum,item)=>sum+item.proposal.paragraphs.length,0);
  const h=await harness(t,readUrl('&read-amendment='+amendment+'&read-list='+list+'&read-lang=en'),()=>source);
  const bar=h.container.querySelector('.read-page-bar h1');
  assert.match(bar.textContent,/^Am 7( · .+)?$/);
  assert.equal(h.container.querySelector('.read-page-line a').textContent,'A10-0257/2026');
  const documentRequests=h.requests.filter(route=>route.startsWith('document-context/'));
  assert.equal(documentRequests.length,1,'one document request');
  assert.match(documentRequests[0],/amendment=A-10-2026-0257-AM-7&list=A-10-2026-0257-AM-001-020&wording-lang=en/);
  const block=h.container.querySelector('[data-amendment-block]');
  assert(block.querySelector('.wording-diff'));assert.equal(block.dataset.contextTarget,'true');
  assert.equal(h.button('Side by side')?.textContent,'Side by side');
  assert.equal(block.compareDocumentPosition(h.container.querySelector('[data-proposal-item]'))&4,4,'the amendment comes before the passage');
  const shown=placedParagraphs(h);
  assert(shown.length>0&&shown.length<whole,'the passage is only part of the proposal');
  assert.deepEqual(shown,Array.from({length:shown.length},(_,index)=>shown[0]+index),'a passage is a continuous run');
  const target=h.container.querySelector('[data-passage-target="true"]');
  assert(target,'the source text is marked');
  assert.equal(h.container.querySelectorAll('[data-amendment-block]').length,1,'the amendment appears once');
});

test('Show whole proposal adds the full text without repeating the amendment and marks where it was',async t=>{
  const source=proposalContextResponse(report,amendment,list,7);
  const whole=source.proposal.items.reduce((sum,item)=>sum+item.proposal.paragraphs.length,0);
  const h=await harness(t,readUrl('&read-amendment='+amendment+'&read-list='+list+'&read-lang=en'),()=>source);
  const before=h.container.querySelector('[data-amendment-block]').textContent;
  await h.click(h.button('Show whole proposal'));
  assert.equal(h.button('Show whole proposal'),undefined);
  assert.equal(placedParagraphs(h).length,whole);
  assert.equal(h.container.querySelectorAll('[data-amendment-block]').length,1);
  assert.equal(h.container.querySelector('[data-amendment-block]').textContent,before,'the amendment itself does not change');
  assert.equal(h.requests.filter(route=>route.startsWith('document-context/')).length,1,'the text is already held');
  const target=h.container.querySelector('[data-passage-target="true"]');
  assert(h.scrolls.some(scroll=>scroll.element===target),'the reader keeps its place at the target');
  assert.equal(h.window.document.activeElement,target);
});

test('the whole proposal stays open when the reader navigates away and returns',async t=>{
  const source=proposalContextResponse(report,amendment,list,7);
  const h=await harness(t,readUrl('&read-amendment='+amendment+'&read-list='+list+'&read-lang=en'),()=>source);
  // With the response cached, the document body and the proposal mount together.
  await h.remount();
  await h.click(h.button('Show whole proposal'));
  h.journey.rememberDossierOrigin();
  assert.equal(h.journey.dossierReaderValue('read-whole:'+amendment,false),true,'the document body saves its own state under its own name');
});

test('find in text opens the whole proposal first',async t=>{
  const source=proposalContextResponse(report,amendment,list,7);
  const whole=source.proposal.items.reduce((sum,item)=>sum+item.proposal.paragraphs.length,0);
  const h=await harness(t,readUrl('&read-amendment='+amendment+'&read-list='+list+'&read-lang=en'),()=>source);
  await h.click(h.button('Find in proposal'));
  assert.equal(placedParagraphs(h).length,whole);
  assert(h.container.querySelector('.read-passage-head input'),'the find control is open');
});

test('an unplaced amendment shows its notice and no passage until the whole text is asked for',async t=>{
  const source=proposalContextResponse(report,amendment,list,7);
  source.placement={operation:'replace',status:'unresolved',reason:'target_not_found',evidence:[]};
  const h=await harness(t,readUrl('&read-amendment='+amendment+'&read-list='+list+'&read-lang=en'),()=>source);
  assert.equal(h.container.querySelector('.document-context-notice[role="status"]').textContent,'Not shown in the text.');
  assert(h.container.querySelector('[data-amendment-block] .wording-diff'));
  assert.equal(placedParagraphs(h).length,0);
  await h.click(h.button('Show whole proposal'));
  assert(placedParagraphs(h).length>0);
});

test('a whole-document operation stays as it is',async t=>{
  const source=proposalContextResponse(report,amendment,list,7);
  source.placement={operation:'reject',status:'document-operation',scope:'commission-proposal',reason:'rejects_proposal',evidence:[]};
  const h=await harness(t,readUrl('&read-amendment='+amendment+'&read-list='+list+'&read-lang=en'),()=>source);
  assert.equal(h.button('Show whole proposal'),undefined);
  assert(placedParagraphs(h).length>0);
});

test('an amendment to a motion opens above its passage and marks new text in place',async t=>{
  const motion='B-10-2026-0424',id=motion+'-AM-5',motionList=motion+'-AM-001-020';
  const source=contextOverlayResponse(motion,id,motionList);
  source.document.selectedText.paragraphs.push('21. Later.','22. Later.','23. Later.');
  source.document.selectedText.paragraphSources.push(...[5,6,7].map(ordinal=>({path:'body/p'+ordinal,ordinal,container:'body',containerPath:'body',segment:0,complete:true})));
  const h=await harness(t,'http://localhost/?view=legislation&pl-mode=read&read-doc='+motion+'&read-amendment='+id+'&read-list='+motionList+'&read-lang=en',()=>source);
  const shown=()=>[...h.container.querySelectorAll('[data-source-paragraph]')].map(node=>Number(node.dataset.sourceParagraph));
  assert.equal(h.container.querySelector('.read-page-bar h1').textContent,'Am 5 · Paragraph 19 a (new)');
  const block=h.container.querySelector('[data-amendment-block]');assert(block.querySelector('.wording-diff ins'));
  const mark=h.container.querySelector('.read-passage-mark');
  assert.equal(mark.textContent,'Amendment 5');assert.equal(mark.previousElementSibling.textContent,'(a) last point;');
  assert(shown().length<source.document.selectedText.paragraphs.length);
  await h.click(h.button('Show whole proposal'));
  assert.equal(shown().at(-1),7);assert.equal(h.container.querySelectorAll('[data-amendment-block]').length,1);
});

test('a stale amendment opens the document with a short note',async t=>{
  const document={id:report,titles:{en:'REPORT on Erasmus+'},date:'2026-10-02',files:[],selectedDocumentId:report,selectedText:{status:'available',paragraphs:['Report text.'],textLanguage:'en',requestedLanguage:'en',availableTextLanguages:['en']}};
  const h=await harness(t,readUrl('&read-amendment='+report+'-AM-9999'),(route,params)=>({version:1,documentId:report,requestedLanguage:'en',document,related:{status:'not-requested',items:[],gaps:[]},amendment:params.has('amendment')?{id:params.get('amendment'),status:'unavailable',variants:[],gaps:[]}:null,target:{status:'not-requested',paragraphs:[]},sources:[]}));
  assert.equal(h.container.querySelector('.document-context-notice').textContent,'Amendment not found.');
  assert.equal(h.container.querySelector('h1').textContent,'REPORT on Erasmus+');
  assert.match(h.container.textContent,/Report text\./);
});

test('without an amendment the heading is the title, then its reference and date',async t=>{
  const document={id:report,titles:{en:'REPORT on Erasmus+'},date:'2026-10-02',files:[],selectedDocumentId:report,selectedText:{status:'available',paragraphs:['Report text.'],textLanguage:'en',requestedLanguage:'en',availableTextLanguages:['en','fr']}};
  const h=await harness(t,readUrl(),()=>({version:1,documentId:report,requestedLanguage:'en',document,related:{status:'not-requested',items:[],gaps:[]},amendment:null,target:{status:'not-requested',paragraphs:[]},sources:[]}));
  assert.equal(h.container.querySelector('h1').textContent,'REPORT on Erasmus+');
  assert.equal(h.container.querySelector('.read-page-line').textContent,'A10-0257/2026 · 2 Oct 2026');
  assert.equal(h.container.querySelectorAll('.document-context-heading').length,0);
  assert.doesNotMatch(h.container.textContent,/Document A-10-2026-0257/);
});

test('a document that cannot be read offers the original instead of an error',async t=>{
  const h=await harness(t,readUrl('&read-amendment='+amendment),()=>new Response('{}',{status:404}));
  const link=h.container.querySelector('.document-context-source a');
  assert.equal(link?.textContent,'Open original document ↗');
  assert.match(link.href,/^https:\/\/www\.europarl\.europa\.eu\//);
  assert.equal(h.container.querySelector('[role="alert"]'),null);
  assert.match(h.container.querySelector('.read-page-bar h1').textContent,/^Am 7/);
});

test('loading shows the amendment number from the URL',async t=>{
  let release;
  const h=await harness(t,readUrl('&read-amendment='+amendment),()=>new Promise(resolve=>{release=resolve;}));
  t.after(()=>release?.(Response.json({})));
  assert.match(h.container.querySelector('.read-page-bar h1').textContent,/^Am 7$/);
  assert.equal(h.container.querySelector('[role="status"]').textContent,'Loading amendment…');
});

test('an invalid document names the gap and requests nothing',async t=>{
  const h=await harness(t,'http://localhost/?view=legislation&pl-mode=read&read-doc=nonsense',()=>undefined);
  assert.equal(h.requests.length,0);
  assert.match(h.container.querySelector('h1').textContent,/unavailable/);
});

const neighboursFor=extra=>({version:1,amendmentId:amendment,listId:list,outcome:null,authors:[],committeeProposer:null,proposerLanguage:null,onBehalfOf:null,previous:null,next:null,...extra});
const withNeighbours=(source,neighbours)=>route=>route.startsWith('amendment-neighbours')?neighbours:source;

test('previous and next stay in the list and in the wording language',async t=>{
  const source=proposalContextResponse(report,amendment,list,7);
  const h=await harness(t,readUrl('&read-amendment='+amendment+'&read-list='+list+'&read-lang=en'),withNeighbours(source,neighboursFor({previous:{id:report+'-AM-6',number:6},next:{id:report+'-AM-8',number:8}})));
  const step=name=>new URL(h.container.querySelector(`.read-page-step[aria-label="${name}"]`).href).searchParams;
  assert.equal(step('Previous amendment').get('read-amendment'),report+'-AM-6');
  assert.equal(step('Next amendment').get('read-amendment'),report+'-AM-8');
  for(const name of ['Previous amendment','Next amendment']){assert.equal(step(name).get('read-list'),list);assert.equal(step(name).get('read-lang'),'en');assert.equal(step(name).get('read-doc'),report);}
  assert.match(h.requests.find(route=>route.startsWith('amendment-neighbours')),/amendment=A-10-2026-0257-AM-7&list=A-10-2026-0257-AM-001-020/);
});

test('the first and last amendment of a list have no link beyond it',async t=>{
  const source=proposalContextResponse(report,amendment,list,7);
  const h=await harness(t,readUrl('&read-amendment='+amendment+'&read-list='+list),withNeighbours(source,neighboursFor({})));
  assert.equal(h.container.querySelectorAll('a.read-page-step').length,0);
  assert.equal(h.container.querySelectorAll('.read-page-step[aria-disabled="true"]').length,2);
});

test('the line gives the reference, who tabled it and a known outcome',async t=>{
  const source=proposalContextResponse(report,amendment,list,7);
  const h=await harness(t,readUrl('&read-amendment='+amendment+'&read-list='+list),withNeighbours(source,neighboursFor({committeeProposer:'Committee on Culture and Education',proposerLanguage:'en',outcome:'ADOPTED'})));
  assert.equal(h.container.querySelector('.read-page-line').textContent,'A10-0257/2026 · Tabled by Committee on Culture and Education · Adopted');
});

test('an unknown outcome stays out of the line, and many signatories open on request',async t=>{
  const authors=Array.from({length:5},(_,index)=>({name:'Person '+index,displayName:null,personId:String(100+index)}));
  const source=proposalContextResponse(report,amendment,list,7);
  const h=await harness(t,readUrl('&read-amendment='+amendment+'&read-list='+list),withNeighbours(source,neighboursFor({authors})));
  const details=h.container.querySelector('.read-page-authors');
  assert.equal(details.querySelector('summary').textContent,'Tabled by Person 0, Person 1, Person 2 +2');
  assert.equal(details.querySelectorAll('p a').length,5,'every name is there');
  assert.doesNotMatch(h.container.querySelector('.read-page-line').textContent,/Outcome|Adopted|Rejected/);
});

const headed={id:report,titles:{en:'REPORT on Erasmus+'},date:'2026-10-02',files:[],selectedDocumentId:report,selectedText:{status:'available',formatStatus:'extracted',paragraphs:['Report text.','I.  First heading','Body.','II. Second heading','Body.'],paragraphFormats:[{},{heading:1},{},{heading:2},{}],textLanguage:'en',requestedLanguage:'en',availableTextLanguages:['en']}};
const documentResponse=document=>()=>({version:1,documentId:report,requestedLanguage:'en',document,related:{status:'not-requested',items:[],gaps:[]},amendment:null,target:{status:'not-requested',paragraphs:[]},sources:[]});

test('Contents is closed on a phone and goes to the heading it names',async t=>{
  const h=await harness(t,readUrl(),documentResponse(headed));
  const contents=h.container.querySelector('details.read-contents');
  assert(contents,'closed list');assert.equal(contents.open,false);
  assert.deepEqual([...contents.querySelectorAll('button')].map(button=>button.textContent),['I. First heading','II. Second heading']);
  await h.click(contents.querySelectorAll('button')[1]);
  const target=h.container.querySelector('[data-source-paragraph="3"]');
  assert.equal(h.window.document.activeElement,target);assert(h.scrolls.some(scroll=>scroll.element===target));
});

test('Contents is a side list on a wide screen',async t=>{
  const h=await harness(t,readUrl(),documentResponse(headed),1280);
  assert.equal(h.container.querySelector('details.read-contents'),null);
  const side=h.container.querySelector('.read-page-with-contents>nav.read-contents');
  assert(side);assert.equal(side.querySelectorAll('button').length,2);
});

test('a document with no headings has no Contents',async t=>{
  const plain={...headed,selectedText:{...headed.selectedText,paragraphFormats:headed.selectedText.paragraphFormats.map(()=>({}))}};
  const h=await harness(t,readUrl(),documentResponse(plain));
  assert.equal(h.container.querySelector('.read-contents'),null);
});

test('an amendment page has no Contents',async t=>{
  const source=proposalContextResponse(report,amendment,list,7);
  const h=await harness(t,readUrl('&read-amendment='+amendment+'&read-list='+list),withNeighbours(source,neighboursFor({})));
  assert.equal(h.container.querySelector('.read-contents'),null);
});
