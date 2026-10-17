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
  t.mock.method(globalThis,'fetch',async(input,options)=>Response.json(await respond(new URL(input,location.href),options)));
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  return {window,container,load:path=>vite.ssrLoadModule(path),render:element=>act(async()=>root.render(element)),click:node=>{assert(node,'Missing button');return act(async()=>node.click());},button:text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text)};
}

test('Follow and Save names include their visible state and identify compact controls',async t=>{
  const h=await harness(t,'');
  const {SaveButton}=await h.load('/src/Saved.tsx');
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

test('MEP speech loads before hidden debate preload, then opening the sequence warms nearby transcripts',async t=>{
  const id='MTG-PL-2026-03-25-OTH-2017069380111',other=id+'2',requests=[];
  let finishSpeech,finishContext;
  const item={id:'speech:'+id,sourceId:id,recordKind:'speech',date:'2026-03-25',titles:{en:'Test debate'},speechKind:'PLENARY_DEBATE_SPEECH',originalLanguages:['en']};
  const person={id:'257043',name:'Mika Aaltola'};
  const row=sourceId=>({id:sourceId,start:null,intervention:{type:'speech',speaker:person,onBehalfOf:[]}});
  const h=await harness(t,`?poc=1&member=257043&speech=${id}`,url=>{
    const route=url.pathname.split('/poc/')[1];requests.push(route);
    if(route.startsWith('latest-activities/'))return {...activities,items:[item],indexedTotal:1};
    if(route===`speech/${id}`)return new Promise(resolve=>finishSpeech=()=>resolve({id,xml:'<speech><p>Main transcript</p></speech>',speakers:[person],availableTextLanguages:['en'],textLanguage:'en'}));
    if(route.startsWith('speech-context/'))return new Promise(resolve=>finishContext=()=>resolve({speechId:id,debates:[{id:'debate',titles:{en:'Debate'},records:[row(id),row(other)],exchanges:[],coverage:{complete:true}}]}));
    if(route===`speech/${other}`)return {id:other,xml:'<speech><p>Preloaded contribution</p></speech>',textLanguage:'en'};
    return fixture(url);
  });
  globalThis.DOMParser=class extends h.window.DOMParser {
    parseFromString(...args) {
      const parsed=super.parseFromString(...args),query=parsed.getElementsByTagNameNS.bind(parsed);
      parsed.getElementsByTagNameNS=(namespace,name)=>namespace==='*'?parsed.getElementsByTagName(name):query(namespace,name);
      return parsed;
    }
  };
  const {default:ExplorerApp}=await h.load('/src/App.tsx');await h.render(createElement(ExplorerApp));
  assert(finishSpeech);assert(!requests.some(route=>route.startsWith('speech-context/')));
  await act(async()=>finishSpeech());
  assert(h.container.textContent.includes('Main transcript'),'pending context does not block the transcript');
  assert(finishContext);assert.equal(h.container.querySelector('.intervention-context-toggle').getAttribute('aria-expanded'),'false');
  await act(async()=>finishContext());
  assert(!requests.includes(`speech/${other}`),'closed sequences do not preload contributions');
  await h.click(h.container.querySelector('.intervention-context-toggle'));
  assert(h.container.querySelector('.intervention-sequence'));assert(!h.container.textContent.includes('Loading debate sequence'));
  await act(async()=>new Promise(resolve=>setTimeout(resolve,200)));
  assert.equal(requests.filter(route=>route===`speech/${other}`).length,1);
  await h.click(h.container.querySelectorAll('.intervention-read')[1]);
  assert(h.container.textContent.includes('Preloaded contribution'));assert.equal(requests.filter(route=>route===`speech/${other}`).length,1);
  assert.equal(requests.filter(route=>route.startsWith('speech-context/')).length,1);
});

test('sequence preloads are bounded, skip procedural rows, stop on close and follow the transcript language',async t=>{
  const prefix='MTG-PL-2026-03-25-OTH-',id=prefix+'5',reads=[];let finish;
  const records=Array.from({length:25},(_,n)=>({id:prefix+n,start:null,intervention:{type:n===6?'procedure':'speech',speaker:{id:String(n),name:'Speaker '+n},onBehalfOf:[]}}));
  const h=await harness(t,'',(url,options)=>{
    if(url.pathname.includes('/speech-context/'))return {speechId:id,debates:[{id:'debate',titles:{en:'Debate'},records,exchanges:[],coverage:{complete:false,available:25,expected:26}}]};
    assert(url.pathname.includes('/speech/'));assert.equal(options.priority,'low');reads.push(url);
    if(url.searchParams.get('lang')==='en')return new Promise(resolve=>finish=()=>resolve({id:url.pathname.split('/').at(-1)}));
    return {id:url.pathname.split('/').at(-1)};
  });
  const {SpeechContextPanel}=await h.load('/src/SpeechInterventions.tsx');
  const render=transcriptLanguage=>h.render(createElement(SpeechContextPanel,{id,language:'en',transcriptLanguage}));
  await render('en');assert.equal(reads.length,0);
  await h.click(h.container.querySelector('.intervention-context-toggle'));
  await act(async()=>new Promise(resolve=>setTimeout(resolve,200)));
  assert.equal(reads.length,1);assert(reads[0].pathname.endsWith(prefix+'4'),'nearest contribution is warmed first');
  await h.click(h.container.querySelector('.intervention-context-toggle'));
  await act(async()=>finish());await act(async()=>new Promise(resolve=>setTimeout(resolve,200)));
  assert.equal(reads.length,1,'closing stops the rest of the batch');
  await render('fr');await h.click(h.container.querySelector('.intervention-context-toggle'));
  await act(async()=>new Promise(resolve=>setTimeout(resolve,2300)));
  assert.equal(reads.length,13);assert(reads.slice(1).every(url=>url.searchParams.get('lang')==='fr'));
  assert(reads.every(url=>!url.pathname.endsWith(prefix+'5')&&!url.pathname.endsWith(prefix+'6')));
  assert(h.container.textContent.includes('25 of 26 debate records available'),'preloading preserves incomplete coverage');
});

test('member deep links, module selection and restored routes keep meaningful titles without extra history',async t=>{
  const pending=[];
  const h=await harness(t,'?poc=1&member=257043&module=profile',url=>['directory','profile/257043'].includes(url.pathname.split('/poc/')[1])?new Promise(resolve=>pending.push(()=>resolve(fixture(url)))):fixture(url));
  const {default:App}=await h.load('/src/App.tsx');
  await h.render(createElement(App));
  assert.equal(document.title,'MEP 257043 · Profile — European Parliament data explorer');
  const length=history.length;
  await act(async()=>pending.splice(0).forEach(resolve=>resolve()));
  assert.equal(document.title,'Mika Aaltola · Profile — European Parliament data explorer');
  assert.equal(history.length,length,'data and title updates must not add history entries');
  for(const label of ['Latest speeches','Political activities','Profile']) {
    await h.click(h.button(label));
    assert.equal(h.container.querySelectorAll('.explorer-tabs [aria-pressed="true"]').length,1);
    assert.equal(h.container.querySelector('.explorer-tabs [aria-pressed="true"]').textContent,label);
    assert.equal(document.title,`Mika Aaltola · ${label} — European Parliament data explorer`);
    assert.equal(history.length,length,'module changes retain existing replaceState behavior');
  }
  const routes=[];
  for(const [label,title] of [['Following','Following'],['Plenary agenda','Plenary agenda'],['Questions','Questions'],['Outside voices','Outside voices']]) {
    await h.click(h.button(label));
    routes.push(location.href);
    assert.equal(document.title,`${title} — European Parliament data explorer`);
  }
  // happy-dom's replaceState truncates forward entries. Exercise popstate restoration here;
  // actual browser Back/Forward is verified separately with the local fixture frontend.
  async function restore(url,title) {
    await act(async()=>{history.replaceState(null,'',url);window.dispatchEvent(new window.PopStateEvent('popstate'));});
    assert.equal(document.title,`${title} — European Parliament data explorer`);
  }
  await restore(routes[2],'Questions');await restore(routes[3],'Outside voices');
  await h.click(h.button('Members'));
  assert.equal(document.title,'Members of the European Parliament — European Parliament data explorer');
});

test('initial feature and unavailable member links have titles before data returns',async t=>{
  for(const [query,title] of [['?view=saved','Following'],['?view=legislation','Plenary agenda'],['?view=legislation&pl-mode=dossier','Dossiers'],['?view=legislation&pl-mode=cloud','Plenary word cloud'],['?view=legislation&pl-mode=participation','What’s hot'],['?view=legislation&pl-mode=trends','Topic timeline'],['?view=legislation&pl-mode=invalid','Plenary agenda'],['?view=questions','Questions'],['?view=outside','Outside voices'],['?member=999&module=activities','MEP 999 · Political activities']]) {
    await t.test(query,async t=>{
      const h=await harness(t,query,()=>{throw Error('Fixture unavailable');});
      const {default:App}=await h.load('/src/App.tsx');await h.render(createElement(App));
      assert.equal(document.title,`${title} — European Parliament data explorer`);
    });
  }
});

test('plenary mode titles follow headings, gestures and restored queries without adding history',async t=>{
  const h=await harness(t,'?view=legislation&pl-mode=dossier');
  const {default:App}=await h.load('/src/App.tsx');
  await h.render(createElement(App));
  assert.equal(document.title,'Dossiers — European Parliament data explorer');
  const routes=[];
  for(const [button,title] of [['Agenda','Plenary agenda'],['Word cloud','Plenary word cloud'],['What’s hot','What’s hot'],['Topic timeline','Topic timeline'],['Dossiers','Dossiers']]) {
    const length=history.length;
    await h.click(h.button(button));routes.push(location.href);
    assert.equal(document.title,`${title} — European Parliament data explorer`);
    assert.equal(h.container.querySelector('h1').textContent,title);
    assert.equal(history.length,length+1,'one mode gesture adds only its existing history entry');
  }
  // Simulate the restored browser query; happy-dom truncates forward entries on replaceState.
  for(const [index,title] of [[1,'Plenary word cloud'],[3,'Topic timeline'],[4,'Dossiers']]) {
    await act(async()=>{history.replaceState(null,'',routes[index]);window.dispatchEvent(new window.PopStateEvent('popstate'));});
    assert.equal(document.title,`${title} — European Parliament data explorer`);
    assert.equal(h.container.querySelector('h1').textContent,title);
  }
  await h.click(h.button('Following'));
  assert.equal(document.title,'Following — European Parliament data explorer');
  await h.click(h.button('Plenary agenda'));
  assert.equal(document.title,'Plenary agenda — European Parliament data explorer','returning to plenary resets its mode as before');
});

test('document disclosures stay related and accurate when documents repeat across agenda and committee events',async t=>{
  const h=await harness(t,'?view=legislation&pl-sitting=MTG-PL-2026-10-07&agenda-topic=test-topic');
  const {Legislation}=await h.load('/src/Legislation.tsx');
  await h.render(createElement(Legislation,{language:'en',onBack(){}}));
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
