import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act,useEffect,useState} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const reference='2025/0385(COD)',report='A-10-2026-0265',other='B-10-2026-0032';
const origin='/?view=legislation&pl-sitting=MTG-PL-2026-10-20&agenda-topic=raw-materials';
const stats={uniquePeople:0,uniqueCurrentMeps:0,peopleOutsideCurrentRoster:0,denominator:0,dimensions:{country:[],group:[],gender:[],age:[]}};
const topics=[{id:'raw-materials',title:'Amendments to the Critical Raw Materials Act',date:'2026-10-20',kind:'PLENARY_DEBATE',documentIds:[report,other]},{id:'second-topic',title:'Another agenda item',date:'2026-10-20',kind:'PLENARY_DEBATE',documentIds:[other]}];
const context={reference,title:topics[0].title,language:'en',summaries:[{id:'summary',stage:'proposal',date:'2026-10-20'}],summary:{id:'summary',stage:'proposal',date:'2026-10-20',blocks:Array.from({length:10},(_,i)=>({kind:'paragraph',text:`Long dossier summary paragraph ${i+1}.`})),source:{url:'https://example.test/summary'}},topics:[{id:'http://eurovoc.europa.eu/1',label:'Raw materials',language:'en'}],subjects:[{label:'Industrial policy',code:'3.40.01'},{label:'Environment',code:'3.70'}],source:{url:'https://example.test/dossier'}};
function legislation(params){return {sitting:{id:'MTG-PL-2026-10-20',date:'2026-10-20',phase:'past'},sittings:[{id:'MTG-PL-2026-10-20',date:'2026-10-20',phase:'past'}],topics,coverage:{agendaError:null},detail:params.has('topic')?{...topics.find(topic=>topic.id===params.get('topic')),phase:'past',procedures:[{id:'procedure',reference}],committeeWork:[{id:'committee-event',date:'2026-10-01',kind:'COMMITTEE_TABLING_REPORT',documentIds:[report,other]}],people:[],roles:[],stats,speeches:[],votes:[],voteCoverage:{truncated:false},coverage:{roleRowsTruncated:false,gaps:[],speechAssociations:{sources:[],truncated:false}}}:null};}
function publication(id,language){return {selectedDocumentId:id,files:[],answers:[],selectedText:{status:'available',paragraphs:[`Exact text for ${id} in ${language}.`],textLanguage:language,availableTextLanguages:['en','fr']}};}

async function harness(t){
  const window=new Window({url:'http://localhost'+origin}),scrolls=[],pending=[];
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,innerWidth:1440,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  window.HTMLElement.prototype.scrollIntoView=function(options){scrolls.push({target:this,options});};
  let root,load,language='en';
  t.after(async()=>{if(root)await act(async()=>{root.unmount();for(const request of pending.splice(0))request.resolve(Response.json(publication(request.id,request.language)));});if(load)await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href),params=url.searchParams;
    if(url.pathname.endsWith('/insights/legislation'))return Response.json(legislation(params));
    if(url.pathname.endsWith('/insights/procedure-context'))return Response.json(context);
    if(url.pathname.endsWith('/insights/procedure-progress'))return Response.json({reference,state:'unmapped',events:[],coverage:{limited:false,invalidRows:0,incompleteEvents:0},source:{fetchedAt:'2026-10-20T10:00:00Z',stale:false,refreshInProgress:false,refreshError:null}});
    if(url.pathname.endsWith('/insights/press-releases'))return Response.json({reference,items:[],total:0});
    if(url.pathname.includes('/document/')&&params.get('lang')==='fr')return Response.json(publication(decodeURIComponent(url.pathname.split('/').at(-1)),'fr'));
    if(url.pathname.includes('/document/'))return new Promise(resolve=>pending.push({id:decodeURIComponent(url.pathname.split('/').at(-1)),language:params.get('lang'),resolve}));
    return Response.json({});
  });
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {Legislation}=await load('/src/Legislation.tsx'),journey=await load('/src/dossierJourney.ts'),{createRoot}=await import('react-dom/client');
  function Shell(){journey.useDossierJourney();const [query,setQuery]=useState(location.search);useEffect(()=>{const sync=()=>setQuery(location.search);window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);return new URLSearchParams(query).get('test-dossier')?createElement('main',null,createElement('h1',null,'Dossier destination')):createElement(Legislation,{language,onBack(){}});}
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=()=>act(async()=>root.render(createElement(Shell)));
  await render();
  const find=selector=>{const node=container.querySelector(selector);assert(node,'Missing '+selector);return node;};
  const button=text=>{const node=[...container.querySelectorAll('button')].find(node=>node.textContent===text);assert(node,'Missing '+text);return node;};
  const click=async node=>act(async()=>{node.focus();node.click();});
  const respond=async(id,status=200,lang='en')=>{const index=pending.findIndex(request=>request.id===id&&request.language===lang);assert(index>=0,`No request for ${id} ${lang}`);const [request]=pending.splice(index,1);await act(async()=>request.resolve(Response.json(status===200?publication(id,lang):{error:{message:'Document unavailable'}},{status})));};
  const frames=()=>act(async()=>new Promise(resolve=>window.requestAnimationFrame(()=>window.requestAnimationFrame(resolve))));
  return {window,container,scrolls,pending,journey,find,button,click,respond,frames,async language(value){language=value;await render();},async pop(href){await act(async()=>{history.replaceState(history.state,'',href);window.dispatchEvent(new Event('popstate'));});}};
}

test('subjects are exposed with exact codes; Read focuses its adjacent exact reader through loading, failure, close and document changes',async t=>{
  const h=await harness(t),classification=h.find('.insight-subject-classification');
  assert.equal(classification.closest('details'),null,'classification requires no disclosure');
  assert.equal(classification.getAttribute('aria-label'),'Subject classification');
  assert.deepEqual([...classification.querySelectorAll('li')].map(li=>[li.querySelector('span').textContent,li.querySelector('small').textContent]),[['Industrial policy','3.40.01'],['Environment','3.70']]);
  const trigger=h.button('Read '+report);await h.click(trigger);
  const region=document.getElementById(trigger.getAttribute('aria-controls'));
  assert.equal(trigger.getAttribute('aria-expanded'),'true');assert.equal(trigger.textContent,'Hide '+report);
  assert.equal(region.hidden,false);assert(document.activeElement===region);assert.equal(region.getAttribute('aria-label'),'Document '+report);
  assert(region.previousElementSibling===h.find('.insight-dossier-links'));
  assert(region.nextElementSibling===h.find('.insight-procedure-context'));
  assert.match(region.textContent,/Loading text/);assert.doesNotMatch(region.textContent,/Exact text/);
  assert.deepEqual(h.scrolls.at(-1),{target:region,options:{block:'start',behavior:'instant'}});
  const moved=h.button('Continue reading');moved.focus();const scrollCount=h.scrolls.length;
  await h.respond(report,503);assert.match(region.textContent,/Text temporarily unavailable/);
  assert(document.activeElement===moved);assert.equal(h.scrolls.length,scrollCount,'source arrival cannot scroll again');
  await h.click(h.button('Close document'));assert.equal(region.hidden,true);assert(document.activeElement===trigger);assert.equal(trigger.textContent,'Read '+report);assert.equal(trigger.getAttribute('aria-expanded'),'false');
  await h.click(h.button('Read '+other));await h.respond(other);
  assert.equal(region.querySelector('[data-reader-source]').getAttribute('data-reader-source'),other);assert.match(region.textContent,new RegExp('Exact text for '+other));assert.doesNotMatch(region.textContent,/Exact text for A-/);
  await h.click(h.button('Hide '+other));assert(region.hidden);assert(document.activeElement===h.button('Read '+other));
  // The same document in committee work controls a separate adjacent target.
  const committee=h.find('.insight-committee-work'),committeeTrigger=[...committee.querySelectorAll('button')].find(button=>button.textContent==='Read '+other);
  await h.click(committeeTrigger);const committeeRegion=document.getElementById(committeeTrigger.getAttribute('aria-controls'));
  assert.notEqual(committeeRegion,region);assert(document.activeElement===committeeRegion);assert.equal(region.hidden,true);assert.equal(committeeRegion.hidden,false);
  assert.equal(committeeRegion.querySelector('[data-reader-source]').getAttribute('data-reader-source'),other);
  await h.click(h.button('Close document'));assert(document.activeElement===committeeTrigger);
  const beforeMoved=h.scrolls.length;
  await act(async()=>{trigger.focus();trigger.click();moved.focus();});
  assert(document.activeElement===moved,'focus moved before the commit must win');assert.equal(h.scrolls.length,beforeMoved);
  await h.click(h.button('Close document'));
});

test('reader language, late responses and topic navigation never repeat action focus; dossier Back/Forward restores reader state and position',async t=>{
  const h=await harness(t);await h.click(h.button('Read '+report));await h.respond(report);
  const region=document.activeElement;
  // A text-language change keeps the reader mounted and uses the exact requested ID.
  const picker=h.find('select[aria-label="Text language"]');await act(async()=>picker.focus());const before=h.scrolls.length;
  await act(async()=>{picker.value='fr';picker.dispatchEvent(new Event('change',{bubbles:true}));});
  assert(document.activeElement!==region,'language changes must not refocus the reader');assert.equal(h.scrolls.length,before);
  assert.match(region.textContent,/in fr/);assert(document.activeElement!==region);assert.equal(h.scrolls.length,before);
  const text=h.find('.insight-reader-text');text.scrollTop=93;h.find('main').scrollTop=420;await act(async()=>h.find('select[aria-label="Text language"]').focus());
  await act(async()=>h.journey.navigateDossier('/?test-dossier=true'));await h.frames();
  await h.pop(origin);await h.frames();await h.frames();
  const restored=h.find('[role="region"][aria-label="Document '+report+'"]');
  assert.equal(restored.hidden,false);assert.equal(h.button('Hide '+report).getAttribute('aria-expanded'),'true');
  assert.equal(h.find('select[aria-label="Text language"]').value,'fr');assert.equal(h.find('.insight-reader-text').scrollTop,93);assert.equal(h.find('main').scrollTop,420);
  assert(document.activeElement===h.find('select[aria-label="Text language"]'));
  const count=h.scrolls.length;await h.pop('/?test-dossier=true');await h.frames();await h.pop(origin);await h.frames();await h.frames();assert.equal(h.scrolls.length,count,'restoring a reader does not replay Read scrolling');
  await h.click(h.button('Close document'));assert(document.activeElement===h.button('Read '+report),'a restored reader finds its remounted opener');
  await h.click(h.button('Read '+other));await h.click(h.button('Close document'));const afterClose=h.scrolls.length;
  await h.respond(other);assert.equal(h.scrolls.length,afterClose);assert(document.activeElement===h.button('Read '+other));assert.equal(h.container.querySelector('[data-reader-source="'+other+'"]'),null,'a closed reader stays closed after its response');
  await h.click(h.button('Read '+other));const next=h.find('.insight-agenda-select select');next.focus();
  await act(async()=>{next.value='second-topic';next.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(h.container.querySelector('[data-reader-source]'),null,'changing agenda items closes the previous document');assert(document.activeElement===next);
  const beforeLanguage=h.scrolls.length;await h.language('fr');assert.equal(h.container.querySelector('[data-reader-source]'),null);assert.equal(h.scrolls.length,beforeLanguage,'interface language changes do not replay Read scrolling');
});
