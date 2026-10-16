import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const member={id:257043,firstName:'Mika',lastName:'Aaltola',sortName:'AALTOLA Mika',gender:'m',countryCode:'FI',groupCode:'EPP',memberships:[],accounts:[]};
const directory={day:'2026-10-16',members:[member],committees:[],index:{complete:true,loaded:1,total:1,failed:0,error:null}};
const activities={categories:{},categoryGroups:[],categoryCoverage:{},items:[],selectedItems:[],indexedTotal:0,nextOffset:null,cache:{complete:true}};
const stats={denominator:0,dimensions:{country:[],group:[],gender:[],age:[]}};
const topic={id:'test-topic',title:'Agenda fixture',date:'2026-10-07',kind:'PLENARY_DEBATE',documentIds:['A-10-2026-0237','B-10-2026-0001']};
const legislation={sitting:{id:'MTG-PL-2026-10-07',date:'2026-10-07',phase:'past'},sittings:[{id:'MTG-PL-2026-10-07',date:'2026-10-07',phase:'past'}],topics:[topic],coverage:{agendaError:null},detail:{...topic,phase:'past',procedures:[],committeeWork:[1,2].map(n=>({id:'event/'+n,date:'2026-10-01',kind:'COMMITTEE_TABLING_REPORT',documentIds:[topic.documentIds[0]]})),people:[],roles:[],speeches:[],stats,votes:[],voteCoverage:{},coverage:{gaps:[],speechAssociations:{sources:[]}}}};
function fixture(url) {
  const route=url.pathname.split('/poc/')[1];
  if(route==='directory')return directory;
  if(route?.startsWith('profile/'))return member;
  if(route?.startsWith('latest-activities/'))return activities;
  if(route?.startsWith('speech-statistics/'))return {items:[],counts:{},groups:[],coverage:{available:0,total:0,complete:true,headers:0},sources:[],nextPage:null};
  if(route==='insights/speech-cloud')return {scope:{},words:[],speeches:[],coverage:{transcripts:0,complete:true},window:{},nextPage:null};
  if(route==='insights/saved')return {members:[],questions:[]};
  if(route==='insights/legislation')return legislation;
  if(route?.startsWith('document/'))return {selectedDocumentId:decodeURIComponent(route.slice(9)),files:[],answers:[],selectedText:{status:'available',paragraphs:['Document fixture text'],textLanguage:url.searchParams.get('lang'),availableTextLanguages:['en','fr']}};
  throw Error('Unexpected fixture request: '+url);
}
async function harness(t,query,respond=fixture) {
  const window=new Window({url:'http://localhost/'+query});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),innerWidth:1440,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,vite;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>Response.json(await respond(new URL(input,location.href))));
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  return {window,container,load:path=>vite.ssrLoadModule(path),render:element=>act(async()=>root.render(element)),click:node=>{assert(node,'Missing button');return act(async()=>node.click());},button:text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text)};
}

test('Follow and Save names include their visible state and identify compact controls',async t=>{
  const h=await harness(t,'');
  const {SaveButton}=await h.load('/src/PocSaved.tsx');
  for(const kind of ['mep','question'])for(const compact of [false,true]) {
    const item={kind,id:kind==='mep'?'257043':'E-10-2026-003031',title:kind==='mep'?'Mika Aaltola':'Question fixture'};
    await h.render(createElement(SaveButton,{item,compact}));
    const button=h.container.querySelector('button');
    for(const [index,saved] of [false,true,false].entries()) {
      const label=kind==='mep'?(saved?'Following':'Follow'):(saved?'Saved':'Save');
      assert.equal(button.getAttribute('aria-pressed'),String(saved));
      assert.equal(button.getAttribute('aria-label'),`${label} ${kind==='mep'?'MEP':'question'} · ${item.title}`);
      if(!compact)assert(button.textContent.includes(label));
      if(index<2)await h.click(button);
    }
  }
});

test('member deep links, module selection and restored routes keep meaningful titles without extra history',async t=>{
  const pending=[];
  const h=await harness(t,'?poc=1&member=257043&module=profile',url=>['directory','profile/257043'].includes(url.pathname.split('/poc/')[1])?new Promise(resolve=>pending.push(()=>resolve(fixture(url)))):fixture(url));
  const {default:PocApp}=await h.load('/src/PocApp.tsx');
  await h.render(createElement(PocApp));
  assert.equal(document.title,'MEP 257043 · Profile — Parliament explorer');
  const length=history.length;
  await act(async()=>pending.splice(0).forEach(resolve=>resolve()));
  assert.equal(document.title,'Mika Aaltola · Profile — Parliament explorer');
  assert.equal(history.length,length,'data and title updates must not add history entries');
  for(const label of ['Latest speeches','Political activities','Profile']) {
    await h.click(h.button(label));
    assert.equal(h.container.querySelectorAll('.poc-tabs [aria-pressed="true"]').length,1);
    assert.equal(h.container.querySelector('.poc-tabs [aria-pressed="true"]').textContent,label);
    assert.equal(document.title,`Mika Aaltola · ${label} — Parliament explorer`);
    assert.equal(history.length,length,'module changes retain existing replaceState behavior');
  }
  const routes=[];
  for(const [label,title] of [['Following','Following'],['Plenary agenda','Plenary agenda'],['Questions','Questions'],['Outside voices','Outside voices']]) {
    await h.click(h.button(label));
    routes.push(location.href);
    assert.equal(document.title,`${title} — Parliament explorer`);
  }
  // happy-dom's replaceState truncates forward entries. Exercise popstate restoration here;
  // actual browser Back/Forward is verified separately with the local fixture frontend.
  async function restore(url,title) {
    await act(async()=>{history.replaceState(null,'',url);window.dispatchEvent(new window.PopStateEvent('popstate'));});
    assert.equal(document.title,`${title} — Parliament explorer`);
  }
  await restore(routes[2],'Questions');await restore(routes[3],'Outside voices');
  await h.click(h.button('Members'));
  assert.equal(document.title,'Members of the European Parliament — Parliament explorer');
});

test('initial feature and unavailable member links have titles before data returns',async t=>{
  for(const [query,title] of [['?view=saved','Following'],['?view=legislation','Plenary agenda'],['?view=questions','Questions'],['?view=outside','Outside voices'],['?member=999&module=activities','MEP 999 · Political activities']]) {
    await t.test(query,async t=>{
      const h=await harness(t,query,()=>{throw Error('Fixture unavailable');});
      const {default:PocApp}=await h.load('/src/PocApp.tsx');await h.render(createElement(PocApp));
      assert.equal(document.title,`${title} — Parliament explorer`);
    });
  }
});

test('document disclosures stay related and accurate when documents repeat across agenda and committee events',async t=>{
  const h=await harness(t,'?view=legislation&pl-sitting=MTG-PL-2026-10-07&agenda-topic=test-topic');
  const {PocLegislation}=await h.load('/src/PocLegislation.tsx');
  await h.render(createElement(PocLegislation,{language:'en',onBack(){}}));
  const buttons=[...h.container.querySelectorAll('button[aria-controls]')].filter(button=>button.textContent.startsWith('Read '));
  assert.equal(buttons.length,4);
  const controls=buttons.map(button=>button.getAttribute('aria-controls'));
  function check(active) {
    for(const [index,button] of buttons.entries()) {
      assert.equal(button.getAttribute('aria-expanded'),String(index===active));
      assert.equal(button.getAttribute('aria-controls'),controls[index],'relationship remains stable');
      const target=document.getElementById(controls[index]);assert(target,'controlled container exists even while closed');
      if(index===active){assert.equal(target.hidden,false);assert(target.querySelector('.insight-inline-reader'));assert(target.textContent.includes('Document fixture text'));}
    }
    assert.equal(h.container.querySelectorAll('button[aria-expanded="true"]').length,active===null?0:1);
    const ids=[...h.container.querySelectorAll('[id]')].map(node=>node.id);assert.equal(new Set(ids).size,ids.length);
  }
  check(null);
  for(const index of [0,1,2,3,0]) {await h.click(buttons[index]);check(index);}
  const language=h.container.querySelector('select[aria-label="Document language"]');
  await act(async()=>{language.value='fr';language.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(h.container.querySelector('.insight-reader-text').lang,'fr');
  await h.click(buttons[0]);check(null);await h.click(buttons[0]);check(0);
});
