import {wordingText} from './test-support/wordingText.mjs';
import {closedGlobalSearch,checkClosedGlobalSearchHistory} from './test-support/closedGlobalSearchHistory.mjs';
import test from 'node:test';
import {API_VERSION} from '../server/api-version.mjs';
import assert from 'node:assert/strict';
import {createElement,Fragment,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {viewReady} from './test-support/viewReady.mjs';
import {DocumentContext,documentContextQuery} from '../server/document-context.mjs';

const WEEK='2026-03-23',SITTING='MTG-PL-2026-03-25',SNAPSHOT='a'.repeat(64),SUBJECT=SITTING+'-VOT-ITM-8';
const DOCUMENT='B-10-2026-0001',AMENDMENT=DOCUMENT+'-AM-7',LIST=DOCUMENT+'-AM-001-007';
const ADOPTED='TA-10-2026-0009',OTHER_ADOPTED='TA-10-2026-0010';
const decision=number=>SITTING+'-DEC-'+number;
const members=[1,2].map(id=>({id,firstName:'Member',lastName:String(id),sortName:String(id),gender:'',countryCode:'HU',groupCode:'EPP',memberships:[],accounts:[]}));
const directory={day:'2026-10-18',members,committees:[],index:{complete:true,loaded:2,total:2,failed:0,error:null}};
function vote(number) {
  return {id:decision(number),sittingId:SITTING,date:'2026-03-25',title:'Decision '+number,titleLanguage:'en',titles:{en:'Decision '+number},referenceTexts:{en:'Decision '+number},
    alignment:'with',method:'VOTE_ELECTRONIC_ROLLCALL',outcome:'ADOPTED',ballotStatus:'conducted',scope:{kind:'amendment'},actualPosition:{status:'recorded',position:'for'},intention:{status:'not-reported',positions:[]},totals:{for:400,against:200,abstaining:0},
    subjectId:SUBJECT,parts:[],rollCallRequesters:[],resultRelationship:{binding:'consistent'},context:{documentIds:[DOCUMENT],amendmentIds:number===2?[AMENDMENT]:[],componentIds:[],partialReferenceIds:[]}};
}
function response(url) {
  const query=url.searchParams,offset=Number(query.get('offset')||0),id=query.get('decision'),items=offset?[vote(3),vote(4)]:[vote(1),vote(2)];
  const week=query.get('week')==='latest'?WEEK:query.get('week'),sitting=query.get('sitting');
  return {version:10,member:{id:url.pathname.split('/').at(-1)},positions:query.get('positions'),alignment:query.get('alignment')||'all',alignmentCounts:{with:4,against:0,abstained:0,unclassified:0},snapshotId:query.get('snapshot')||SNAPSHOT,
    period:sitting?{kind:'sitting',week:null,sittingId:sitting,from:sitting.slice(7),to:sitting.slice(7)}:{kind:'week',week,sittingId:null,from:week,to:new Date(Date.parse(week+'T12:00:00Z')+6*86400000).toISOString().slice(0,10)},
    items,pagination:{offset,limit:50,returned:2,observedTotal:4,recordedTotal:4,filteredTotal:4,nextOffset:offset?null:2},
    selected:id?Number(id.split('-').at(-1))<=4?{status:'found',item:vote(Number(id.split('-').at(-1)))}:{status:'not-found-in-scanned-data',item:null}:{status:'not-requested',item:null},
    subjects:[{id:SUBJECT,title:'Exact subject',titleLanguage:'en',titles:{en:'Exact subject'},documentIds:[DOCUMENT],agendaItemIds:[],counts:{observed:4,filtered:4,page:2},wholeTextDecisions:[]}],coverage:{status:'partial',termWide:false}};
}
const button=(container,text)=>[...container.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
const params=()=>new URLSearchParams(location.search);
const contextDocument=id=>({id,titles:{en:'Source '+id},date:'2026-03-25',files:[],answers:[],selectedDocumentId:id,selectedText:{status:'available',paragraphs:['Synthetic context body.'],textLanguage:'en',notes:[],noteAnchors:[],documentLinks:[]}});

function multilingualContext() {
  const fetchedAt=Date.parse('2026-03-25T12:00:00Z'),reads=[],results=[];
  const source=language=>({url:'https://example.test/synthetic-list_'+(language||'unknown')+'.docx',fetchedAt:new Date(fetchedAt).toISOString(),language});
  const variants=[
    {listId:LIST,language:'en',originalText:'1. Exact English source wording.',proposedText:'1. Exact English proposal.'},
    {listId:LIST,language:'hu',originalText:'1. Eredeti magyar forrásszöveg.',proposedText:'1. Pontos magyar javaslat.'},
  ].map(variant=>({...variant,textIntegrity:'complete',targetLabel:null,targetLabelLanguage:variant.language,authors:[],wordingSource:source(variant.language),sourceFreshness:{status:'fresh'},gaps:[]}));
  const indexed={id:AMENDMENT,targetDocumentId:DOCUMENT,variants};
  const work={id:'eli/dl/doc/'+DOCUMENT,identifier:DOCUMENT,document_date:'2026-03-25',work_type:'def/ep-document-types/RESOLUTION_MOTION',title_dcterms:{en:'Synthetic multilingual motion',hu:'Szintetikus többnyelvű indítvány'},is_realized_by:[]};
  const service=new DocumentContext({clock:()=>fetchedAt,findAmendment:()=>indexed,
    request:async endpoint=>{assert.equal(endpoint,'/plenary-documents/'+DOCUMENT);return {payload:{data:[work]},fetchedAt,url:'https://example.test/public-fixture'+endpoint};},
    readText:async(node,language)=>{
      assert.equal(node.identifier,DOCUMENT);reads.push(language);
      const paragraphs=language==='hu'?['Az Európai Parlament,','– tekintettel a nyilvános forrásokra,',variants[1].originalText,'2. A következő magyar bekezdés.']:['The European Parliament,','– having regard to public sources,',variants[0].originalText,'2. The next English paragraph.'];
      return {status:'available',textLanguage:language,availableTextLanguages:['en','hu'],paragraphs,notes:[],noteAnchors:[],documentLinks:[],structureStatus:'extracted',paragraphSources:paragraphs.map((_,ordinal)=>({path:'w:body/w:p['+ordinal+']',ordinal,container:'body',containerPath:'w:body',segment:0,complete:true})),sourceUrl:'https://example.test/synthetic-motion_'+language+'.docx',fetchedAt:new Date(fetchedAt).toISOString()};
    },download:async()=>{assert.fail('Indexed test wording never downloads a document.');},
  });
  return {indexed,reads,results,response:async url=>{const value=await service.query(documentContextQuery(DOCUMENT,url.searchParams),{store:{}});results.push(value);return Response.json(value);}};
}

async function harness(t,query='member=1&module=votes&lang=en',{activities=[],contextResponse}={}) {
  const window=new Window({url:'http://localhost/?'+query}),requests=[],unexpected=[];
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,loadModule;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
    assert.deepEqual(unexpected,[],'all requests stay inside local fixtures');
  });
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href);
    if(url.pathname==='/api/corpus/search')return Response.json({results:[],total:0,nextOffset:null,coverage:{status:'partial'}});
    assert.equal(url.searchParams.get('v'),String(API_VERSION));url.searchParams.delete('v');
    if(url.pathname==='/api/vote-periods')return Response.json({version:2,weeks:[{week:WEEK,sittings:[{sittingId:SITTING,date:SITTING.slice(7)}]}],coverage:{status:'complete',years:[{year:2026,state:'complete',sources:[]}]}});
    requests.push(url);
    if(url.pathname==='/api/directory')return Response.json(directory);
    if(url.pathname.startsWith('/api/portrait/'))return new Response(null,{status:404});
    if(url.pathname.startsWith('/api/profile/'))return Response.json({...members[Number(url.pathname.split('/').at(-1))-1],birthDate:null,memberships:[]});
    if(url.pathname.startsWith('/api/document/'))return Response.json({...contextDocument(decodeURIComponent(url.pathname.split('/').at(-1))),roles:['AUTHOR'],coAuthors:[]});
    if(url.pathname.startsWith('/api/member-votes/'))return Response.json(response(url));
    if(url.pathname.startsWith('/api/commission-followups/'))return Response.json({documentId:decodeURIComponent(url.pathname.split('/').at(-1)),requestedLanguage:url.searchParams.get('lang')||'en',status:'none-listed',items:[],gaps:[],sources:[]});
    if(url.pathname.startsWith('/api/member-vote-explanations/'))return Response.json({version:3,memberId:url.pathname.split('/').at(-1),decisionId:url.searchParams.get('decision'),sittingId:SITTING,snapshotId:url.searchParams.get('snapshot'),subjectId:SUBJECT,matchScope:'subject',presentationAnchorDecisionId:null,items:[],written:{status:'unsupported',count:null},coverage:{status:'searched',searchComplete:true,gaps:[]}});
    if(url.pathname.startsWith('/api/document-context/')){
      const id=decodeURIComponent(url.pathname.split('/').at(-1));
      const choices=[ADOPTED,OTHER_ADOPTED].map(id=>({...contextDocument(id),relationship:{from:id,field:'adopts',to:DOCUMENT}}));
      const payload={documentId:id,requestedLanguage:url.searchParams.get('lang')||'en',...(url.searchParams.has('wording-lang')?{requestedWordingLanguage:url.searchParams.get('wording-lang')==='unknown'?null:url.searchParams.get('wording-lang')}:{}),document:contextDocument(id),related:{status:'available',items:choices,gaps:[]},amendment:{id:AMENDMENT,status:'available',variants:[{listId:LIST,language:'en',wordingStatus:'available',targetLabel:null,originalText:'Original',proposedText:'Proposed',authors:[]}]}};
      return contextResponse?.(url,payload)??Response.json(payload);
    }
    if(url.pathname.startsWith('/api/qa-cache/'))return Response.json({id:url.pathname.split('/').at(-1)});
  if(url.pathname==='/api/insights/following-status')return Response.json({epoch:'test',generation:1,marksReady:false,indexComplete:false});
    if(url.pathname==='/api/insights/saved')return Response.json({members:[],questions:[]});
    if(url.pathname==='/api/insights/search')return Response.json({offset:0,sections:[]});
    if(url.pathname.startsWith('/api/latest-activities/'))return Response.json({categories:{},categoryGroups:[],categoryCoverage:{},items:activities,selectedItems:[],indexedTotal:activities.length,nextOffset:null,cache:{complete:true}});
    if(url.pathname.startsWith('/api/speech-statistics/'))return Response.json({items:[],counts:{},groups:[],coverage:{available:0,total:0,complete:true,headers:0},sources:[],nextPage:null});
    if(url.pathname==='/api/insights/speech-cloud')return Response.json({scope:{},words:[],speeches:[],coverage:{transcripts:0,complete:true},window:{},nextPage:null});
    unexpected.push(url.href);throw Error('Unexpected fixture request: '+url.href);
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {default:App}=await loadModule('/src/App.tsx'),{useData}=await loadModule('/src/data.ts'),{createRoot}=await import('react-dom/client');
  const WarmCache=({route})=>{
    const state=useData(route);
    return createElement('span',{hidden:true,'data-qa-cache-ready':Boolean(state.data&&!state.loading&&!state.error)});
  };
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  let warmRoutes=[];
  const draw=()=>root.render(createElement(Fragment,null,createElement(App,{key:'app'}),...warmRoutes.map(route=>createElement(WarmCache,{key:route,route}))));
  await act(async()=>draw());
  const settle=async()=>{await viewReady(container);for(let attempt=0;attempt<200;attempt++){await act(async()=>new Promise(resolve=>setTimeout(resolve,10)));if(!container.querySelector('.member-votes-loading'))return;}assert.fail('Lazy view did not load');};
  await settle();
  const click=async node=>{await act(async()=>{assert(node,'Missing control');node.click();});await settle();};
  const go=async delta=>{await act(async()=>{
    let timer,listener;
    const popped=new Promise((resolve,reject)=>{listener=resolve;window.addEventListener('popstate',listener,{once:true});timer=setTimeout(()=>reject(Error('Missing popstate')),5000);});
    try{history.go(delta);await popped;}finally{clearTimeout(timer);window.removeEventListener('popstate',listener);}
  });await settle();};
  const restore=async query=>{await act(async()=>{history.pushState(null,'','/?'+query);window.dispatchEvent(new window.PopStateEvent('popstate'));});await settle();};
  const warmCache=async count=>{
    warmRoutes=Array.from({length:count},(_,index)=>'qa-cache/'+index);
    await act(async()=>draw());
    for(let attempt=0;attempt<200;attempt++){
      if(container.querySelectorAll('[data-qa-cache-ready="true"]').length===count)return;
      await act(async()=>new Promise(resolve=>setTimeout(resolve,10)));
    }
    assert.fail('Local cache fixture did not finish loading');
  };
  const list=()=>container.querySelector('.member-votes-pane:not([hidden])');
  return {window,container,requests,click,go,restore,warmCache,list};
}

for(const blocked of [false,true])test('vote navigation preserves an older closed global search with '+(blocked?'blocked':'available')+' session storage',async t=>{
  const h=await harness(t,'member=1&module=votes&'+closedGlobalSearch);
  await checkClosedGlobalSearchHistory(t,h,()=>h.click(h.container.querySelector('.member-votes-subject h3 button')),blocked);
  assert.deepEqual(JSON.parse(params().get('mv-expanded')),[SUBJECT]);
});

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
  await h.click(button(h.container,'Recorded positions'));assert.equal(history.length,length+2);
  assert.equal(params().get('mv-positions'),'recorded');
  await h.click(button(h.container,'Next page'));assert.equal(history.length,length+3);assert.equal(params().get('mv-offset'),'2');
  await h.go(-1);assert.equal(params().get('mv-offset'),null);assert.equal(params().get('mv-positions'),'recorded');
  await h.go(-1);assert.equal(location.href,expanded);assert.equal(button(h.container,'All decisions').getAttribute('aria-pressed'),'true');
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
  assert.equal(params().get('mv-wording-lang'),'en');
  assert.match(h.container.querySelector('.document-context-reader').textContent,/Synthetic context body/);
  assert(h.requests.some(url=>url.pathname==='/api/document-context/'+DOCUMENT&&url.searchParams.get('list')===LIST&&url.searchParams.get('amendment')===AMENDMENT));
  const context=location.href;
  await h.go(-1);assert.equal(location.href,detail);assert(h.container.querySelector('.member-votes-detail'));
  await h.go(1);assert.equal(location.href,context);assert(h.container.querySelector('.document-context-back'));
  await h.restore('member=1&module=votes&mv-week='+WEEK+'&mv-decision='+decision(999));
  assert.equal(params().get('mv-decision'),decision(999));assert.match(h.container.textContent,/requested decision is unavailable/);
  assert.equal(h.container.querySelector('.member-votes-detail'),null);
});

test('choosing Hungarian wording in one multilingual list opens and restores its exact Hungarian source passage',async t=>{
  const source=multilingualContext(),h=await harness(t,'member=1&module=votes&lang=en',{contextResponse:source.response});
  await h.click(h.container.querySelector('.member-votes-subject h3 button'));
  await h.click(h.container.querySelectorAll('.member-votes-row')[1]);
  assert.equal(source.reads.length,0,'the actual service keeps its wording-only read lazy');
  const selector=h.container.querySelector('select[aria-label="Amendment published version"]');
  assert.equal(Boolean(selector),true);
  const option=[...selector.options].find(option=>option.textContent.includes('Hungarian'));
  assert.equal(Boolean(option),true);
  await act(async()=>{selector.value=option.value;selector.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
  assert.equal(h.container.querySelector('.member-votes-comparison')?.lang,'hu');
  const detail=location.href;
  await h.click(button(h.container,'Read in context'));
  const context=location.href;
  h.container.querySelector('.member-votes').scrollTop=4237;
  h.container.querySelector('.explorer-profile-body').scrollTop=413;
  const assertHungarian=()=>{
    assert.equal(location.href,context);assert.equal(params().get('lang'),null,'default English is implicit');assert.equal(document.documentElement.lang,'en','the interface language stays independent');
    assert.equal(params().get('mv-wording-lang'),'hu');assert.equal(params().get('mv-amendment'),AMENDMENT);assert.equal(params().get('mv-list'),LIST);
    const highlighted=h.container.querySelector('.document-context-reader [data-context-target="true"]');
    assert(highlighted?.querySelector('.wording-diff'),'the exact Hungarian source is shown as an in-place diff');
    assert.equal(wordingText(highlighted,'original'),source.indexed.variants[1].originalText);
    assert.equal(h.container.querySelector('.document-context-text')?.lang,'hu');
    assert.equal(h.container.querySelector('.member-votes').scrollTop,4237);assert.equal(h.container.querySelector('.explorer-profile-body').scrollTop,413);
  };
  assertHungarian();
  const full=h.requests.filter(url=>url.pathname==='/api/document-context/'+DOCUMENT&&url.searchParams.get('body')!=='0');
  assert.equal(full.length,1);assert.equal(full[0].searchParams.get('lang'),'hu');assert.equal(full[0].searchParams.get('wording-lang'),'hu');
  assert.deepEqual(source.reads,['hu']);
  const resolved=source.results.find(result=>result.document);
  assert.equal(resolved.requestedWordingLanguage,'hu');assert.equal(resolved.target.status,'found');assert.equal(resolved.target.evidence.wordingLanguage,'hu');
  await h.click(button(h.container,'Profile'));
  await h.go(-1);assertHungarian();
  await h.go(-1);assert.equal(location.href,detail);assert.equal(params().get('mv-decision'),decision(2));
  assert.equal(Boolean(h.container.querySelector('.document-context-reader')),false);
  await h.go(1);assertHungarian();
});

test('unknown wording language and conflicting same-language versions do not acquire another source passage',async t=>{
  for(const kind of ['unknown','conflicting Hungarian'])await t.test(kind,async child=>{
    const source=multilingualContext();
    source.indexed.variants.push({...source.indexed.variants[kind==='unknown'?0:1],language:kind==='unknown'?null:'hu',targetLabelLanguage:kind==='unknown'?null:'hu',wordingSource:{...source.indexed.variants[kind==='unknown'?0:1].wordingSource,language:kind==='unknown'?null:'hu'},proposedText:'A competing source proposal.'});
    const h=await harness(child,'member=1&module=votes&lang=en',{contextResponse:source.response});
    await h.click(h.container.querySelector('.member-votes-subject h3 button'));
    await h.click(h.container.querySelectorAll('.member-votes-row')[1]);
    const selector=h.container.querySelector('select[aria-label="Amendment published version"]');
    const option=[...selector.options].find(option=>option.textContent.includes(kind==='unknown'?'Version 3':'Version 2 · Hungarian'));
    assert.equal(Boolean(option),true);
    await act(async()=>{selector.value=option.value;selector.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
    await h.click(button(h.container,'Read in context'));
    assert.equal(params().get('mv-wording-lang'),kind==='unknown'?'unknown':'hu');
    assert.equal(params().get('mv-amendment'),AMENDMENT);assert.equal(params().get('mv-list'),LIST);
    assert.equal(Boolean(h.container.querySelector('.document-context-reader [data-context-target="true"]')),false);
    assert.equal(Boolean(h.container.querySelector('.document-context-text [data-source-paragraph]')),true,'the exact source body stays readable without an assigned passage');
    assert.equal(h.container.querySelector('.document-context-reader .document-context-notice[role="status"]').textContent,kind==='unknown'?'The amendment wording language is unknown.':'The amendment wording is unavailable.');
    const resolved=source.results.find(result=>result.document);
    assert.notEqual(resolved.target.status,'found');assert.equal(Object.hasOwn(resolved,'requestedWordingLanguage'),true);
    assert.equal(resolved.requestedWordingLanguage,kind==='unknown'?null:'hu');
  });
});

for(const scroller of ['.explorer-profile-body','main.explorer'])test(scroller+': exact amendment context and its scroll survive Profile and browser Back/Forward',async t=>{
  const h=await harness(t);
  await h.click(h.container.querySelector('.member-votes-subject h3 button'));
  await h.click(h.container.querySelectorAll('.member-votes-row')[1]);
  const detail=location.href;
  await h.click(button(h.container,'Read in context'));
  const context=location.href,outer=()=>h.container.querySelector(scroller),contextScroller=()=>h.container.querySelector('.member-votes');
  if(scroller==='main.explorer'){
    Object.defineProperties(outer(),{scrollHeight:{value:6000},clientHeight:{value:800}});
    const computed=globalThis.getComputedStyle;
    t.mock.method(globalThis,'getComputedStyle',node=>node.classList.contains('explorer-tabs')?{position:'sticky'}:computed(node));
    t.mock.method(h.container.querySelector('.explorer-profile-body'),'getBoundingClientRect',()=>({top:-77}));
  }
  const assertContext=()=>{
    assert.equal(location.href,context);
    assert.equal(params().get('mv-decision'),decision(2));assert.equal(params().get('mv-snapshot'),SNAPSHOT);
    assert.equal(params().get('mv-document'),DOCUMENT);assert.equal(params().get('mv-amendment'),AMENDMENT);
    assert.equal(params().get('mv-list'),LIST);assert.equal(params().get('mv-view'),'document');
    assert.equal(h.container.querySelector('.document-context-reader')?.textContent.includes('Synthetic context body.'),true);
    assert.equal(contextScroller().scrollTop,4237);assert.equal(outer().scrollTop,413);
  };
  contextScroller().scrollTop=4237;outer().scrollTop=413;
  await h.click(button(h.container,'Profile'));
  assert.equal(Boolean(h.container.querySelector('.document-context-reader')),false);
  outer().scrollTop=91;
  await h.go(-1);assertContext();
  await h.go(-1);
  assert.equal(location.href,detail);assert.equal(params().get('mv-decision'),decision(2));
  assert.equal(Boolean(h.container.querySelector('.member-votes-detail')),true);
  assert.equal(Boolean(h.container.querySelector('.document-context-reader')),false);
  contextScroller().scrollTop=82;outer().scrollTop=92;
  await h.go(1);assertContext();
});

test('an evicted amendment context restores its scroll after the delayed source body loads',async t=>{
  let delayed=false,releaseBody;
  const delayedBodies=new Set();
  const h=await harness(t,'member=1&module=votes&lang=en',{contextResponse:(url,payload)=>{
    if(url.searchParams.get('body')==='0')return;
    payload.document.selectedText.paragraphs=Array.from({length:207},(_,index)=>'Synthetic source paragraph '+index+'.');
    if(delayed)return new Promise(resolve=>{releaseBody=()=>resolve(Response.json(payload));delayedBodies.add(releaseBody);});
    return Response.json(payload);
  }});
  // Release every delayed body so request deadlines do not keep the file alive.
  t.after(()=>{for(const release of delayedBodies)release();});
  await h.click(h.container.querySelector('.member-votes-subject h3 button'));
  await h.click(h.container.querySelectorAll('.member-votes-row')[1]);
  await h.click(button(h.container,'Read in context'));
  const context=location.href,prototype=h.window.HTMLElement.prototype,ownScroll=Object.getOwnPropertyDescriptor(prototype,'scrollTop');
  let sourcePrototype=prototype;
  while(!Object.hasOwn(sourcePrototype,'scrollTop'))sourcePrototype=Object.getPrototypeOf(sourcePrototype);
  const nativeScroll=Object.getOwnPropertyDescriptor(sourcePrototype,'scrollTop'),writes=[];
  Object.defineProperty(prototype,'scrollTop',{configurable:true,get(){return nativeScroll.get.call(this);},set(value){
    const contextScroller=this.classList.contains('member-votes');
    const readable=Boolean(this.querySelector('.document-context-reader [data-source-paragraph]'));
    if(contextScroller)writes.push({value,readable});
    nativeScroll.set.call(this,contextScroller&&!readable?0:value);
  }});
  t.after(()=>ownScroll?Object.defineProperty(prototype,'scrollTop',ownScroll):delete prototype.scrollTop);
  h.container.querySelector('.member-votes').scrollTop=4237;
  h.container.querySelector('.explorer-profile-body').scrollTop=413;
  await h.click(button(h.container,'Profile'));
  await h.warmCache(61);
  assert.equal(h.requests.filter(url=>url.pathname.startsWith('/api/qa-cache/')).length,61,'successful local reads evict the earlier context from the shared 60-entry cache');
  delayed=true;writes.length=0;
  await h.go(-1);
  assert.equal(location.href,context);
  assert.equal(typeof releaseBody,'function','the full context response was fetched again after eviction');
  assert.equal(Boolean(h.container.querySelector('.document-context-reader')),true,'the reader shell is already mounted');
  assert.equal(Boolean(h.container.querySelector('.document-context-reader [data-source-paragraph]')),false,'its source body is still loading');
  assert.equal(h.container.querySelector('.member-votes').scrollTop,0,'the loading shell has no native scroll range');
  assert.equal(writes.some(write=>write.value===4237),false,'restoration must wait instead of being consumed by the loading shell');
  await h.click(button(h.container,'Profile'));
  await h.go(-1);
  assert.equal(location.href,context);
  assert.equal(Boolean(h.container.querySelector('.document-context-reader [data-source-paragraph]')),false);
  assert.equal(writes.some(write=>write.value===4237),false,'leaving the pending shell cannot replace the last readable position with zero');
  await act(async()=>releaseBody());
  assert.equal(location.href,context);assert.equal(params().get('mv-snapshot'),SNAPSHOT);
  assert.equal(params().get('mv-decision'),decision(2));assert.equal(params().get('mv-amendment'),AMENDMENT);assert.equal(params().get('mv-list'),LIST);
  assert.equal(h.container.querySelectorAll('.document-context-reader [data-source-paragraph]').length,207);
  assert.equal(h.container.querySelector('.document-context-reader').textContent.includes('Synthetic source paragraph 206.'),true);
  assert.equal(h.container.querySelector('.member-votes').scrollTop,4237);
  assert.equal(h.container.querySelector('.explorer-profile-body').scrollTop,413);
  assert.equal(writes.some(write=>write.value===4237&&write.readable),true,'the saved position is applied to the loaded source body');
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
  assert.deepEqual(Object.fromEntries(first.searchParams),{week:'latest',view:'period',positions:'all',lang:'en',offset:'0',limit:'50'});
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

test('invalid wording-language links keep their exact requested context and never fetch an unpinned fallback',async t=>{
  const fields={member:'1',module:'votes','mv-week':WEEK,'mv-decision':decision(2),'mv-document':DOCUMENT,'mv-amendment':AMENDMENT,'mv-list':LIST,'mv-view':'document','mv-wording-lang':'hu'};
  const malformed=[{...fields,'mv-wording-lang':'HU'},{...fields,'mv-wording-lang':''},{...fields,'mv-view':'adopted'}];
  for(const key of ['mv-amendment','mv-list']){const missing={...fields};delete missing[key];malformed.push(missing);}
  const h=await harness(t,new URLSearchParams(malformed[0]).toString());
  for(const query of malformed){
    await h.restore(new URLSearchParams(query).toString());
    assert.equal(h.container.textContent.includes('Invalid voting records link'),true);
    assert.equal(params().get('mv-decision'),decision(2));assert.equal(params().get('mv-document'),DOCUMENT);
    assert.equal(params().get('mv-amendment'),query['mv-amendment']??null);assert.equal(params().get('mv-list'),query['mv-list']??null);
  }
  assert.equal(h.requests.some(url=>url.pathname.startsWith('/api/member-votes/')||url.pathname.startsWith('/api/document-context/')),false,'invalid source selections cannot initiate an English or unpinned read');
});

test('alignment navigation pushes once, preserves the snapshot and restores the filtered detail/list with Back',async t=>{
  const h=await harness(t),length=history.length;
  assert.equal(params().has('mv-alignment'),false);
  await h.click(button(h.container,'With the outcome (4)'));
  assert.equal(history.length,length+1);assert.equal(params().get('mv-alignment'),'with');assert.equal(params().get('mv-snapshot'),SNAPSHOT);
  await h.click(h.container.querySelector('[data-vote-group]'));
  const listUrl=location.href;
  await h.click(h.container.querySelector('[data-vote-id]'));
  const detailUrl=location.href;assert.equal(params().get('mv-alignment'),'with');
  await h.click(button(h.container,'← Back to votes'));
  assert.equal(location.href,listUrl);assert.equal(document.activeElement.dataset.voteId,decision(1));
  await h.go(-1);assert.equal(location.href,detailUrl);assert.equal(params().get('mv-alignment'),'with');
  await h.go(-1);assert.equal(location.href,listUrl);assert.equal(params().get('mv-alignment'),'with');
  await h.click(button(h.container,'All'));assert.equal(params().has('mv-alignment'),false);
  const requests=h.requests.filter(url=>url.pathname.startsWith('/api/member-votes/'));
  assert(requests.some(url=>url.searchParams.get('alignment')==='with'));
  assert.equal(requests[0].searchParams.has('alignment'),false,'the default request stays compatible; returning may reuse its cache');
});

test('expansion preserves outer scroll without a request and decision/back keep page position',async t=>{
 const h=await harness(t),page=h.container.querySelector('main.explorer'),body=h.container.querySelector('.explorer-profile-body');
 page.scrollTop=230;body.scrollTop=90;
 const before=h.requests.filter(url=>url.pathname.startsWith('/api/member-votes/')).length;
 await h.click(h.container.querySelector('.member-votes-subject h3 button'));
 assert.equal(page.scrollTop,230);assert.equal(body.scrollTop,90);
 assert.equal(h.requests.filter(url=>url.pathname.startsWith('/api/member-votes/')).length,before);
 await h.click(h.container.querySelector('[data-vote-id]'));
 assert.equal(page.scrollTop,230);assert.equal(body.scrollTop,90);
 await h.click(button(h.container,'← Back to votes'));
 assert.equal(page.scrollTop,230);assert.equal(body.scrollTop,90);
 await h.go(-1);assert.equal(page.scrollTop,230);assert.equal(body.scrollTop,90);
});
