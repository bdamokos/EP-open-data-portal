import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {topicLinkDetail,placeLinkFacts,recordLinkPage} from './test-support/storyLinksFixtures.mjs';
import {storyQuery} from '../server/story-facts-reader.mjs';
import {viewReady} from './test-support/viewReady.mjs';

const ref='2025/0176(COD)',documentId='A-10-2026-0010',source={url:'https://data.europarl.europa.eu/api/v2/procedures/2025-0176',fetchedAt:'2026-10-24T08:00:00Z',language:'en'};
const member={id:257727,firstName:'Named',lastName:'Member',sortName:'MEMBER Named',gender:'',countryCode:'HU',groupCode:'EPP',memberships:[],accounts:[]};
const role={kind:'role',id:'exact-role',personId:'257727',role:'RAPPORTEUR',committee:'ENVI',date:'2026-02-11',dateBasis:'recorded',stage:'RDG1',source};
const procedure={id:'2025-0176',reference:ref,title:'Official procedure title from metadata',titleLanguage:'en',source};
const item={id:'report:'+documentId,sourceId:documentId,recordKind:'document',date:'2026-09-09',category:'reports',categoryLabel:'Reports',title:'Official report title',titleLanguage:'en',procedureIds:['2025-0176'],reference:documentId,files:[],provenance:{role:'RAPPORTEUR',stage:'RDG1',apiUrl:source.url,sourceFetchedAt:source.fetchedAt}};
const activityPage={categories:{reports:'Reports'},categoryGroups:[],categoryCoverage:{reports:{status:'complete',indexedCount:1}},items:[item],selectedItems:[],indexedTotal:30,nextOffset:null,cache:{complete:true}};
const topic={id:'exact-agenda',title:'Official agenda title',date:'2026-09-15',kind:'PLENARY_DEBATE',documentIds:[documentId]};
const person={id:'257727',name:'Named Member',currentMep:true,personUri:'person/257727',country:'HU',group:'PPE'};
const sitting={id:'MTG-PL-2026-09-15',date:'2026-09-15',phase:'past'};
const legislation={sitting,sittings:[sitting],topics:[topic],coverage:{agendaError:null,catalogueComplete:true},detail:{...topic,phase:'past',procedures:[{...procedure,label:ref,websiteUrl:'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference='+ref,apiUrl:source.url}],committeeWork:[],people:[person],roles:[{...person,role:'RAPPORTEUR'}],speeches:[],stats:{denominator:0,dimensions:{country:[],group:[],gender:[],age:[]}},votes:[],voteCoverage:{},coverage:{gaps:[],speechAssociations:{sources:[]}}}};

async function harness(t,url,respond) {
  const window=new Window({url:'http://localhost/'+url}),originals=new Map(),calls=[];
  for(const [key,value] of Object.entries({window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,DOMParser:window.DOMParser,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),innerWidth:390,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  }
  let root,load;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href),route=url.pathname.split('/api/')[1];calls.push(url);
    const custom=respond?.(url);if(custom!==undefined)return custom instanceof Response?custom:Response.json(custom);
    if(route==='directory')return Response.json({day:'2026-10-24',members:[member],committees:[],index:{complete:true,loaded:1,total:1,failed:0,error:null}});
    if(route?.startsWith('profile/'))return Response.json(member);
    if(route?.startsWith('portrait/'))return new Response(null,{status:404});
    if(route?.startsWith('latest-activities/'))return Response.json(activityPage);
    if(route==='insights/dossier-references')return Response.json({items:[procedure],coverage:{status:'complete',gaps:[]}});
    if(route==='insights/dossier-activity')return Response.json({version:12,procedure,memberId:url.searchParams.get('member'),section:url.searchParams.get('section'),participants:[{id:'257727',name:'Named Member',roles:[role]}],items:url.searchParams.get('section')==='roles'?[role]:[],pagination:{offset:0,targetOffset:0,limit:25,next:null},coverage:{status:'partial',gaps:['Only linked records shown.'],sources:[source]},generation:1});
    if(route==='insights/procedure-context')return Response.json({reference:ref,title:procedure.title,language:'en',summaries:[],summary:null,subjects:[],topics:[],source});
    if(route==='insights/legislation')return Response.json(legislation);
    if(route==='insights/following-status')return Response.json({epoch:'test',generation:1,marksReady:false,indexComplete:false});
    if(route==='insights/saved')return Response.json({members:[],questions:[]});
    if(route?.startsWith('document/'))return Response.json({selectedDocumentId:documentId,files:[],coAuthors:[],answers:[],selectedText:{status:'available',paragraphs:['Official report text'],textLanguage:'en',availableTextLanguages:['en']}});
    return Response.json({error:{message:'This source is unavailable.'}},{status:404});
  });
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {default:App}=await load('/src/App.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(createElement(App)));await viewReady(container);
  const frames=()=>act(async()=>new Promise(resolve=>window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>window.requestAnimationFrame(resolve)))));
  const click=async node=>{assert(node,'Missing control');await act(async()=>{node.focus();node.click();});await viewReady(container);await frames();};
  return {window,container,calls,click,frames};
}

test('member Activities exact resolver link opens the real dossier inside App and returns to its original page, category, expanded row and focus',async t=>{
  const h=await harness(t,'?member=257727&module=activities&country=HU&activity-category=reports&activity-offset=20&activity='+encodeURIComponent('reports:'+documentId));
  const link=[...h.container.querySelectorAll('.dossier-work-links a')].find(node=>node.textContent==='Work on this dossier');assert(link);
  const origin=location.href;h.container.querySelector('main.explorer').scrollTop=400;h.container.querySelector('.explorer-profile-body').scrollTop=660;
  await h.click(link);assert.equal(new URL(location.href).searchParams.get('view'),'legislation');assert.equal(new URL(location.href).searchParams.get('dossier-person'),'257727');
  assert.equal(h.container.querySelectorAll('.insight-dossier-title').length,1);assert.equal(h.container.querySelector('.insight-dossier-title h2').textContent,procedure.title);
  assert.equal(h.container.querySelectorAll('.explorer-tabs').length,0);
  await h.click(h.container.querySelector('.dossier-back'));assert.equal(location.href,origin);assert.equal(h.container.querySelector('.explorer-speech-toggle').getAttribute('aria-expanded'),'true');
  assert.equal(h.container.querySelector('main.explorer').scrollTop,400);assert.equal(h.container.querySelector('.explorer-profile-body').scrollTop,660);assert.equal(document.activeElement.textContent,'Work on this dossier');
});

test('agenda participant keeps profile action and a secondary dossier action; returning restores the exact agenda and open document reader',async t=>{
  const h=await harness(t,'?view=legislation&pl-sitting=MTG-PL-2026-09-15&agenda-topic=exact-agenda&agenda-country=HU');
  const read=[...h.container.querySelectorAll('button')].find(node=>node.textContent==='Read '+documentId);await h.click(read);assert(h.container.querySelector('.insight-inline-reader'));
  const participant=h.container.querySelector('.insight-people article');assert(participant);assert.equal(new URL(participant.querySelector('a').href).searchParams.get('module'),'profile');
  const work=participant.querySelector('.dossier-work-links a');assert(work);const origin=location.href;h.container.querySelector('main').scrollTop=820;
  await h.click(work);assert(h.container.querySelector('[data-dossier-reference]'));await h.click(h.container.querySelector('.dossier-back'));await h.frames();
  assert.equal(location.href,origin);assert.equal(h.container.querySelector('[data-agenda-topic]').dataset.agendaTopic,'exact-agenda');
  const restoredRead=[...h.container.querySelectorAll('button')].find(node=>node.textContent==='Hide '+documentId);assert(restoredRead);assert.equal(restoredRead.getAttribute('aria-expanded'),'true');
  assert.equal(document.getElementById(restoredRead.getAttribute('aria-controls')).querySelector('[data-reader-source]').getAttribute('data-reader-source'),documentId);
  assert.equal(h.container.querySelector('main').scrollTop,820);assert.equal(document.activeElement.textContent,'Work on this dossier');
});


function topicResponse(url){
 const path=url.pathname;
 if(path==='/api/topics/detail')return {...topicLinkDetail(url.searchParams.get('key')),groups:[{key:'2025-0176',reference:ref,kind:'procedure',title:'Open the exact dossier',date:'2026-09-15',items:[],speechCount:0,speakers:[]}]};
 if(path==='/api/topics/overview')return {ready:true,items:[],periods:['2026-Q3'],partial:{},sittingDays:{}};
 if(path==='/api/topics/story-facts')return {ready:false};
 if(path==='/api/insights/record-topics')return {ready:true,records:[]};
}
async function waitFor(h,predicate){for(let i=0;i<100&&!predicate();i++)await act(async()=>new Promise(r=>setTimeout(r,10)));assert(predicate(),h.container.textContent);}
test('real Plenary topic → dossier → Back restores the clicked dossier link, rather than the topic H1',async t=>{
 const h=await harness(t,'?view=legislation&pl-mode=topics&topic=oeil:1.10',topicResponse);
 await waitFor(h,()=>h.container.querySelector('.topic-record-group h3 a'));
 const link=h.container.querySelector('.topic-record-group h3 a');await h.click(link);await waitFor(h,()=>h.container.querySelector('.dossier-back'));
 await h.click(h.container.querySelector('.dossier-back'));await waitFor(h,()=>h.container.querySelector('.topic-record-group h3 a'));await h.frames();
 assert.equal(document.activeElement,h.container.querySelector('.topic-record-group h3 a'));
 assert.equal(h.container.querySelector('.topic-detail-header h1').textContent,'Climate policy');
});
test('mode and current-section controls return detail pages to their overviews without leaking topic filters',async t=>{
 const h=await harness(t,'?view=legislation&pl-mode=topics&topic=oeil:1.10&t-q=2026-Q3&t-kind=document',topicResponse);
 const button=text=>[...h.container.querySelectorAll('button')].find(b=>b.textContent===text);
 await waitFor(h,()=>h.container.querySelector('.topic-detail-header'));
 await h.click(button('Agenda'));
 assert(!new URLSearchParams(location.search).has('topic'));assert(![...new URLSearchParams(location.search).keys()].some(k=>k.startsWith('t-')));
 await h.click(button('Topics'));await waitFor(h,()=>h.container.querySelector('.topic-heat'));
 for(const control of ['Topics','Plenary agenda']){
  await act(async()=>{history.replaceState({},'','?view=legislation&pl-mode=topics&topic=oeil:1.10&t-q=2026-Q3');window.dispatchEvent(new window.PopStateEvent('popstate'));});
  await waitFor(h,()=>h.container.querySelector('.topic-detail-header'));await h.click(button(control));await waitFor(h,()=>h.container.querySelector('.topic-heat'));
  assert.equal(new URLSearchParams(location.search).get('pl-mode'),'topics');assert(!new URLSearchParams(location.search).has('topic'));
 }
 await act(async()=>{history.replaceState({},'','?view=geopolitics&place=IRN&t-mode=d');window.dispatchEvent(new window.PopStateEvent('popstate'));});
 await waitFor(h,()=>h.container.querySelector('.topic-detail-header'));await h.click(button('Geopolitics'));await waitFor(h,()=>h.container.querySelector('.places-map'));assert(!new URLSearchParams(location.search).has('place'));
});


test('real single-record reader Back restores its list and clicked record link',async t=>{
 const origin='?view=geopolitics&place=IRN&t-records='+encodeURIComponent('documents:IRN:2026-Q1:all');
 const h=await harness(t,origin,url=>{
  if(url.pathname==='/api/topics/story-facts'){const p=new URLSearchParams(url.search);p.delete('v');const q=storyQuery(p);return q.list?recordLinkPage(q):placeLinkFacts('IRN');}
  return topicResponse(url);
 });
 const recordLink=()=>[...h.container.querySelectorAll('.topic-story-records article a')].find(a=>a.href.includes('t-record='));
 await waitFor(h,recordLink);const text=recordLink().textContent;await h.click(recordLink());await waitFor(h,()=>new URLSearchParams(location.search).has('t-record'));
 t.mock.method(history,'back',()=>{history.replaceState({},'',origin);window.dispatchEvent(new window.PopStateEvent('popstate'));});
 await h.click(h.container.querySelector('.topic-story-records > a'));await waitFor(h,recordLink);await h.frames();
 assert.equal(document.activeElement.textContent,text);assert.equal(document.activeElement,recordLink());assert(new URLSearchParams(location.search).has('t-records'));
});
