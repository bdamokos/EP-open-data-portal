import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
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

async function harness(t,url) {
  const window=new Window({url:'http://localhost/'+url}),originals=new Map(),calls=[];
  for(const [key,value] of Object.entries({window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,DOMParser:window.DOMParser,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),innerWidth:390,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  }
  let root,load;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href),route=url.pathname.split('/api/')[1];calls.push(url);
    if(route==='directory')return Response.json({day:'2026-10-24',members:[member],committees:[],index:{complete:true,loaded:1,total:1,failed:0,error:null}});
    if(route?.startsWith('profile/'))return Response.json(member);
    if(route?.startsWith('portrait/'))return new Response(null,{status:404});
    if(route?.startsWith('latest-activities/'))return Response.json(activityPage);
    if(route==='insights/dossier-references')return Response.json({items:[procedure],coverage:{status:'complete',gaps:[]}});
    if(route==='insights/dossier-activity')return Response.json({version:7,procedure,memberId:url.searchParams.get('member'),section:url.searchParams.get('section'),participants:[{id:'257727',name:'Named Member',roles:[role]}],items:url.searchParams.get('section')==='roles'?[role]:[],pagination:{offset:0,targetOffset:0,limit:25,next:null},coverage:{status:'partial',gaps:['Only linked records shown.'],sources:[source]},generation:1});
    if(route==='insights/procedure-context')return Response.json({reference:ref,title:procedure.title,language:'en',summaries:[],summary:null,subjects:[],topics:[],source});
    if(route==='insights/legislation')return Response.json(legislation);
    if(route==='insights/following-status')return Response.json({epoch:'test',generation:1,marksReady:false,indexComplete:false});
    if(route==='insights/saved')return Response.json({members:[],questions:[]});
    if(route?.startsWith('document/'))return Response.json({selectedDocumentId:documentId,files:[],coAuthors:[],answers:[],selectedText:{status:'available',paragraphs:['Official report text'],textLanguage:'en',availableTextLanguages:['en']}});
    return Response.json({error:{message:'This source is unavailable.'}},{status:502});
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
