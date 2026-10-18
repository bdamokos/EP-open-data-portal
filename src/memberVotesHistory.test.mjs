import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {viewReady} from './test-support/viewReady.mjs';

const WEEK='2026-03-23',SITTING='MTG-PL-2026-03-25',SNAPSHOT='a'.repeat(64),SUBJECT=SITTING+'-VOT-ITM-8';
const DOCUMENT='B-10-2026-0001',AMENDMENT=DOCUMENT+'-AM-7',LIST=DOCUMENT+'-AM-001-007';
const ADOPTED='TA-10-2026-0009',OTHER_ADOPTED='TA-10-2026-0010';
const decision=number=>SITTING+'-DEC-'+number;
const members=[1,2].map(id=>({id,firstName:'Member',lastName:String(id),sortName:String(id),gender:'',countryCode:'HU',groupCode:'EPP',memberships:[],accounts:[]}));
const directory={day:'2026-10-18',members,committees:[],index:{complete:true,loaded:2,total:2,failed:0,error:null}};
function vote(number) {
  return {id:decision(number),sittingId:SITTING,date:'2026-03-25',title:'Decision '+number,titleLanguage:'en',titles:{en:'Decision '+number},referenceTexts:{en:'Decision '+number},
    method:'VOTE_ELECTRONIC_ROLLCALL',outcome:'ADOPTED',ballotStatus:'conducted',scope:{kind:'amendment'},actualPosition:{status:'recorded',position:'for'},intention:{status:'not-reported',positions:[]},totals:{for:400,against:200,abstaining:0},
    subjectId:SUBJECT,parts:[],rollCallRequesters:[],resultRelationship:{binding:'consistent'},context:{documentIds:[DOCUMENT],amendmentIds:number===2?[AMENDMENT]:[],componentIds:[]}};
}
function response(url) {
  const query=url.searchParams,offset=Number(query.get('offset')||0),id=query.get('decision'),items=offset?[vote(3),vote(4)]:[vote(1),vote(2)];
  const week=query.get('week')==='latest'?WEEK:query.get('week'),sitting=query.get('sitting');
  return {version:2,member:{id:url.pathname.split('/').at(-1)},positions:query.get('positions'),snapshotId:query.get('snapshot')||SNAPSHOT,
    period:sitting?{kind:'sitting',week:null,sittingId:sitting,from:sitting.slice(7),to:sitting.slice(7)}:{kind:'week',week,sittingId:null,from:week,to:new Date(Date.parse(week+'T12:00:00Z')+6*86400000).toISOString().slice(0,10)},
    items,pagination:{offset,limit:50,returned:2,observedTotal:4,filteredTotal:4,nextOffset:offset?null:2},
    selected:id?Number(id.split('-').at(-1))<=4?{status:'found',item:vote(Number(id.split('-').at(-1)))}:{status:'not-found-in-scanned-data',item:null}:{status:'not-requested',item:null},
    subjects:[{id:SUBJECT,title:'Exact subject',titleLanguage:'en',titles:{en:'Exact subject'},documentIds:[DOCUMENT],agendaItemIds:[],counts:{observed:4,filtered:4,page:2},wholeTextDecisions:[]}],coverage:{status:'partial',termWide:false}};
}
const button=(container,text)=>[...container.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
const params=()=>new URLSearchParams(location.search);
const contextDocument=id=>({id,titles:{en:'Source '+id},date:'2026-03-25',files:[],answers:[],selectedDocumentId:id,selectedText:{status:'available',paragraphs:['Synthetic context body.'],textLanguage:'en',notes:[],noteAnchors:[],documentLinks:[]}});

async function harness(t,query='member=1&module=votes&lang=en',{activities=[]}={}) {
  const window=new Window({url:'http://localhost/?'+query}),requests=[],unexpected=[];
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,vite;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(vite)await vite.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
    assert.deepEqual(unexpected,[],'all requests stay inside local fixtures');
  });
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href);requests.push(url);
    if(url.pathname==='/api/directory')return Response.json(directory);
    if(url.pathname.startsWith('/api/portrait/'))return new Response(null,{status:404});
    if(url.pathname.startsWith('/api/profile/'))return Response.json({...members[Number(url.pathname.split('/').at(-1))-1],birthDate:null,memberships:[]});
    if(url.pathname.startsWith('/api/document/'))return Response.json({...contextDocument(decodeURIComponent(url.pathname.split('/').at(-1))),roles:['AUTHOR'],coAuthors:[]});
    if(url.pathname.startsWith('/api/member-votes/'))return Response.json(response(url));
    if(url.pathname.startsWith('/api/document-context/')){
      const id=decodeURIComponent(url.pathname.split('/').at(-1));
      const choices=[ADOPTED,OTHER_ADOPTED].map(id=>({...contextDocument(id),relationship:{from:id,field:'adopts',to:DOCUMENT}}));
      return Response.json({documentId:id,requestedLanguage:'en',document:contextDocument(id),related:{status:'available',items:choices,gaps:[]},amendment:{id:AMENDMENT,status:'available',variants:[{listId:LIST,language:'en',wordingStatus:'available',targetLabel:null,originalText:'Original',proposedText:'Proposed',authors:[]}]}});
    }
    if(url.pathname==='/api/insights/saved')return Response.json({members:[],questions:[]});
    if(url.pathname==='/api/corpus/search')return Response.json({results:[],total:0,nextOffset:null,coverage:{status:'partial'}});
    if(url.pathname.startsWith('/api/latest-activities/'))return Response.json({categories:{},categoryGroups:[],categoryCoverage:{},items:activities,selectedItems:[],indexedTotal:activities.length,nextOffset:null,cache:{complete:true}});
    if(url.pathname.startsWith('/api/speech-statistics/'))return Response.json({items:[],counts:{},groups:[],coverage:{available:0,total:0,complete:true,headers:0},sources:[],nextPage:null});
    if(url.pathname==='/api/insights/speech-cloud')return Response.json({scope:{},words:[],speeches:[],coverage:{transcripts:0,complete:true},window:{},nextPage:null});
    unexpected.push(url.href);throw Error('Unexpected fixture request: '+url.href);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {default:App}=await vite.ssrLoadModule('/src/App.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(App)));
  const settle=async()=>{await viewReady(container);for(let attempt=0;attempt<200;attempt++){await act(async()=>new Promise(resolve=>setTimeout(resolve,10)));if(!container.querySelector('.member-votes-loading'))return;}assert.fail('Lazy view did not load');};
  await settle();
  const click=async node=>{await act(async()=>{assert(node,'Missing control');node.click();});await settle();};
  const go=async delta=>{await act(async()=>{
    let timer,listener;
    const popped=new Promise((resolve,reject)=>{listener=resolve;window.addEventListener('popstate',listener,{once:true});timer=setTimeout(()=>reject(Error('Missing popstate')),5000);});
    try{history.go(delta);await popped;}finally{clearTimeout(timer);window.removeEventListener('popstate',listener);}
  });await settle();};
  const restore=async query=>{await act(async()=>{history.pushState(null,'','/?'+query);window.dispatchEvent(new window.PopStateEvent('popstate'));});await settle();};
  const list=()=>container.querySelector('.member-votes-pane:not([hidden])');
  return {window,container,requests,click,go,restore,list};
}

test('Votes is public; canonical pinning replaces, every user navigation pushes once and MEP searches survive',async t=>{
  const search='&mep-speech-fts-search=transport&mep-activity-fts-search=rail&global-fts-search=climate&ma-document=B-10-2026-0001&ma-view=document';
  const h=await harness(t,'member=1&module=votes&lang=en'+search),length=history.length;
  assert.equal(length,1);assert.equal(params().get('module'),'votes');
  assert.equal(params().get('mv-week'),WEEK);assert.equal(params().get('mv-snapshot'),SNAPSHOT);
  assert.equal(button(h.container,'Amendments'),undefined);assert.equal(button(h.container,'Votes').getAttribute('aria-pressed'),'true');
  assert.equal(document.title,'Member 1 · Votes — European Parliament data explorer');
  await h.click(h.container.querySelector('.member-votes-subject h3 button'));
  assert.equal(history.length,length+1,'expansion is a user step despite module replace hint');
  assert.deepEqual(JSON.parse(params().get('mv-expanded')),[SUBJECT]);
  const expanded=location.href;
  await h.click(button(h.container,'All decisions'));assert.equal(history.length,length+2);
  assert.equal(params().get('mv-positions'),'all');
  await h.click(button(h.container,'Next page'));assert.equal(history.length,length+3);assert.equal(params().get('mv-offset'),'2');
  await h.go(-1);assert.equal(params().get('mv-offset'),null);assert.equal(params().get('mv-positions'),'all');
  await h.go(-1);assert.equal(location.href,expanded);assert.equal(button(h.container,'Recorded positions').getAttribute('aria-pressed'),'true');
  await h.go(2);assert.equal(params().get('mv-offset'),'2');
  for(const [key,value] of new URLSearchParams(search))assert.equal(params().get(key),value);
  await h.click(button(h.container,'Following'));
  assert.equal([...params().keys()].some(key=>key.startsWith('mv-')||key.startsWith('ma-')),false);
  await h.go(-1);assert.equal(params().get('mv-offset'),'2');assert.equal(params().get('ma-document'),DOCUMENT);
});

test('opening a motion activity defers its document read until document details are expanded',async t=>{
  const activity={id:'motion-fixture',sourceId:DOCUMENT,category:'motions',categoryLabel:'Motion for a resolution',recordKind:'document',date:'2026-03-25',title:'Synthetic motion',titleLanguage:'en',reference:DOCUMENT,files:[],provenance:{apiUrl:'https://example.test/public-fixture',sourceFetchedAt:'2026-03-25T12:00:00Z',role:'AUTHOR',relationship:'authored'}};
  const h=await harness(t,'member=1&module=activities&lang=en&activity='+DOCUMENT,{activities:[activity]});
  assert(h.container.textContent.includes('Author'));
  assert.equal(h.requests.filter(url=>url.pathname.startsWith('/api/document/')).length,0);
  assert.equal(h.requests.filter(url=>url.pathname.startsWith('/api/document-context/')).length,0);
  const details=h.container.querySelector('details.explorer-reader-download');assert(details);
  await act(async()=>{details.open=true;details.dispatchEvent(new h.window.Event('toggle'));});
  assert.equal(h.requests.filter(url=>url.pathname==='/api/document/'+DOCUMENT).length,1);
  assert.equal(h.requests.filter(url=>url.pathname.startsWith('/api/document-context/')).length,0);
});

test('entering and leaving the profile Votes tab adds one entry per gesture',async t=>{
  const h=await harness(t,'member=1&module=profile&lang=en'),length=history.length,profile=location.href;
  await h.click(button(h.container,'Votes'));
  assert.equal(history.length,length+1,'period and snapshot pinning do not add another entry');
  const votes=location.href;
  await h.click(button(h.container,'Profile'));assert.equal(history.length,length+2);
  await h.go(-1);assert.equal(location.href,votes);assert.equal(button(h.container,'Votes').getAttribute('aria-pressed'),'true');
  await h.go(-1);assert.equal(location.href,profile);assert.equal(button(h.container,'Profile').getAttribute('aria-pressed'),'true');
});

for(const scroller of ['.explorer-profile-body','main.explorer'])test(scroller+': leaving Votes preserves the pinned list and scroll for browser Back and the Votes button',async t=>{
  const h=await harness(t);
  await h.click(h.container.querySelector('.member-votes-subject h3 button'));
  const outer=()=>h.container.querySelector(scroller);
  if(scroller==='main.explorer'){
    // Model the responsive tab policy: sticky tabs would otherwise move the
    // restored outer page back to the beginning of its content.
    Object.defineProperties(outer(),{scrollHeight:{value:2000},clientHeight:{value:800}});
    const computed=globalThis.getComputedStyle;
    t.mock.method(globalThis,'getComputedStyle',node=>node.classList.contains('explorer-tabs')?{position:'sticky'}:computed(node));
    t.mock.method(h.container.querySelector('.explorer-profile-body'),'getBoundingClientRect',()=>({top:-77}));
  }
  outer().scrollTop=413;h.list().scrollTop=237;
  h.list().dispatchEvent(new h.window.Event('scroll',{bubbles:true}));
  const votes=location.href;
  assert.equal(params().get('mv-week'),WEEK);assert.equal(params().get('mv-snapshot'),SNAPSHOT);
  await h.click(button(h.container,'Profile'));
  assert.equal(button(h.container,'Profile').getAttribute('aria-pressed'),'true');
  assert.equal(Boolean(h.list()),false);
  outer().scrollTop=91;
  await h.go(-1);
  assert.equal(location.href,votes);
  assert.equal(button(h.container,'Votes').getAttribute('aria-pressed'),'true');
  assert.equal(outer().scrollTop,413);assert.equal(h.list().scrollTop,237);

  outer().scrollTop=509;h.list().scrollTop=319;
  h.list().dispatchEvent(new h.window.Event('scroll',{bubbles:true}));
  await h.click(button(h.container,'Profile'));
  assert.equal(Boolean(h.list()),false);
  outer().scrollTop=72;
  await h.click(button(h.container,'Votes'));
  assert.equal(location.href,votes,'returning directly keeps the canonical period, snapshot and expanded subject');
  assert.equal(outer().scrollTop,509);assert.equal(h.list().scrollTop,319);
});

for(const scroller of ['.explorer-profile-body','main.explorer'])test(scroller+': list → detail → Back and browser Back restore scroll and exact state',async t=>{
  const h=await harness(t);
  await h.click(h.container.querySelector('.member-votes-subject h3 button'));
  const outer=h.container.querySelector(scroller),list=h.list();
  outer.scrollTop=413;list.scrollTop=237;
  list.dispatchEvent(new h.window.Event('scroll',{bubbles:true}));
  const listUrl=location.href;
  await h.click(h.container.querySelector('.member-votes-row'));
  assert.equal(params().get('mv-decision'),decision(1));assert.match(h.container.querySelector('.member-votes-detail').textContent,/Decision 1/);
  outer.scrollTop=91;h.list().scrollTop=82;
  await h.click(button(h.container,'← Back to votes'));
  assert.equal(location.href,listUrl);assert.equal(outer.scrollTop,413);assert.equal(h.list().scrollTop,237);
  await h.go(-1);assert.equal(params().get('mv-decision'),decision(1));assert.equal(outer.scrollTop,91);
  await h.go(-1);assert.equal(location.href,listUrl);assert.equal(outer.scrollTop,413);assert.equal(h.list().scrollTop,237);
});

test('decision and exact wording context survive Back/Forward without selecting another decision',async t=>{
  const h=await harness(t);
  await h.click(h.container.querySelector('.member-votes-subject h3 button'));
  await h.click(h.container.querySelectorAll('.member-votes-row')[1]);
  const detail=location.href,length=history.length;
  await h.click(button(h.container,'Read in context'));
  assert.equal(history.length,length+1);
  assert.equal(params().get('mv-decision'),decision(2));assert.equal(params().get('mv-document'),DOCUMENT);
  assert.equal(params().get('mv-amendment'),AMENDMENT);assert.equal(params().get('mv-list'),LIST);assert.equal(params().get('mv-view'),'document');
  assert.match(h.container.querySelector('.document-context-reader').textContent,/Synthetic context body/);
  assert(h.requests.some(url=>url.pathname==='/api/document-context/'+DOCUMENT&&url.searchParams.get('list')===LIST&&url.searchParams.get('amendment')===AMENDMENT));
  const context=location.href;
  await h.go(-1);assert.equal(location.href,detail);assert(h.container.querySelector('.member-votes-detail'));
  await h.go(1);assert.equal(location.href,context);assert(h.container.querySelector('.document-context-back'));
  await h.restore('member=1&module=votes&mv-week='+WEEK+'&mv-decision='+decision(999));
  assert.equal(params().get('mv-decision'),decision(999));assert.match(h.container.textContent,/requested decision is unavailable/);
  assert.equal(h.container.querySelector('.member-votes-detail'),null);
});

test('direct sitting/context/TA selection restores exactly; another MEP receives no inherited Votes state',async t=>{
  const selection=new URLSearchParams({member:'1',module:'votes','mv-sitting':SITTING,'mv-positions':'all','mv-offset':'2','mv-decision':decision(1),'mv-snapshot':SNAPSHOT,'mv-expanded':JSON.stringify([SUBJECT]),'mv-document':DOCUMENT,'mv-view':'adopted','mv-adopted':ADOPTED,'ma-document':DOCUMENT,'ma-view':'adopted'});
  const h=await harness(t,selection.toString()),original=location.href;
  assert.match(h.container.querySelector('.explorer-profile-body').textContent,/TA-10-2026-0009/);
  await h.click(h.container.querySelector('.explorer-back'));
  assert.equal(params().get('mv-decision'),null);
  assert.equal(params().get('ma-document'),null);
  await h.click(h.container.querySelector('[data-member-id="2"] button'));
  await h.click(button(h.container,'Votes'));
  const first=h.requests.find(url=>url.pathname==='/api/member-votes/2');assert(first);
  assert.deepEqual(Object.fromEntries(first.searchParams),{week:'latest',positions:'recorded',lang:'en',offset:'0',limit:'50'});
  assert.equal(params().get('mv-decision'),null);assert.equal(params().get('mv-sitting'),null);assert.equal(params().get('mv-document'),null);
  assert.equal(params().get('ma-document'),null);
  await h.go(-3);assert.equal(location.href,original);assert.equal(params().get('member'),'1');
  assert.match(h.container.querySelector('.explorer-profile-body').textContent,/TA-10-2026-0009/);
});

test('shared reader TA choices push once and restore exact selection with browser Back',async t=>{
  const h=await harness(t,'member=1&module=votes&mv-week='+WEEK+'&mv-decision='+decision(1)+'&mv-document='+DOCUMENT+'&mv-view=adopted');
  const choices=location.href,length=history.length;
  assert.equal(params().get('mv-adopted'),null,'no implicit adopted-text selection');
  await h.click([...h.container.querySelectorAll('.document-context-choices button')].find(node=>node.querySelector('span').textContent==='Source '+OTHER_ADOPTED));
  assert.equal(history.length,length+1);assert.equal(params().get('mv-adopted'),OTHER_ADOPTED);
  assert.equal(h.container.querySelector('.document-context-heading h3').textContent,'Source '+OTHER_ADOPTED);
  const selected=location.href;
  await h.click(button(h.container,'← Adopted texts'));
  assert.equal(history.length,length+2);assert.equal(params().get('mv-adopted'),null);
  await h.go(-1);assert.equal(location.href,selected);assert.equal(h.container.querySelector('.document-context-heading h3').textContent,'Source '+OTHER_ADOPTED);
  await h.go(-1);assert.equal(location.href,choices);assert.equal(params().get('mv-adopted'),null);
  await h.restore('member=1&module=votes&mv-week='+WEEK+'&mv-decision='+decision(1)+'&mv-document='+DOCUMENT+'&mv-view=adopted&mv-adopted=TA-10-2026-0999');
  assert.equal(params().get('mv-adopted'),'TA-10-2026-0999');assert.match(h.container.textContent,/This adopted text is unavailable here/);
  assert.equal(h.container.querySelector('.document-context-heading'),null);
});

test('malformed links remain explicitly invalid, retain requested decision, and never fetch a fallback',async t=>{
  const h=await harness(t,'member=1&module=votes&mv-week=2026-03-24&mv-decision='+decision(1));
  assert.match(h.container.textContent,/Invalid voting records link/);assert.equal(params().get('mv-decision'),decision(1));
  assert.equal(h.requests.some(url=>url.pathname.startsWith('/api/member-votes/')),false);
  await h.restore('member=1&module=votes&mv-offset=Infinity&mv-decision='+decision(2));
  assert.match(h.container.textContent,/Invalid voting records link/);assert.equal(params().get('mv-decision'),decision(2));
  assert.equal(h.requests.some(url=>url.pathname.startsWith('/api/member-votes/')),false);
});
