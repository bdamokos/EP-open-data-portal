import {topicFixture} from './test-support/topicFixtures.mjs';
import {wordingText} from './test-support/wordingText.mjs';
import {closedGlobalSearch,checkClosedGlobalSearchHistory} from './test-support/closedGlobalSearchHistory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,Fragment,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {viewReady} from './test-support/viewReady.mjs';
import {API_VERSION} from '../server/api-version.mjs';

// Finite synthetic HTTP contracts exercise the real App and readers. These are
// navigation fixtures, not evidence of raw DOCX parsing or public-source coverage.
const ORIGINAL='B-10-2026-0001',JOINT='RC-10-2026-0001',ADOPTED='TA-10-2026-0009';
const AMENDMENT=ORIGINAL+'-AM-7',LIST=ORIGINAL+'-AM-001-020';
const SOURCE={url:'https://data.europarl.europa.eu/distribution/fixture/motion_en.docx',language:'en',fetchedAt:'2026-03-25T12:00:00Z'};
const members=[1,2].map(id=>({id,firstName:'Member',lastName:String(id),sortName:String(id),gender:'',countryCode:'HU',groupCode:'EPP',memberships:[],accounts:[]}));
const directory={day:'2026-10-18',members,committees:[],index:{complete:true,loaded:2,total:2,failed:0,error:null}};
const unavailableOutcome={status:'unavailable',totals:null};
const joint={sourceId:JOINT,reference:JOINT,title:'Synthetic joint text',titleLanguage:'en',memberAuthorship:'not-recorded',relationship:{type:'is_derivative_of',from:JOINT,to:ORIGINAL},outcome:{status:'adopted',date:'2026-03-25',method:'VOTE_HAND',totals:null}};
function activity(document=ORIGINAL) {
 return {id:'fixture-'+document,sourceId:document,category:'motions',categoryLabel:'Motion for a resolution',recordKind:'document',date:'2026-03-25',title:document===ORIGINAL?'Synthetic original text':'Synthetic joint text',titleLanguage:'en',reference:document,files:[],provenance:{apiUrl:'https://example.test/navigation-fixture',sourceFetchedAt:SOURCE.fetchedAt,role:document===ORIGINAL?'AUTHOR':'SUPPORTER',relationship:'authored'},resolutionOutcome:document===ORIGINAL?{status:'lapsed',date:'2026-03-25',method:'VOTE_HAND',totals:null}:joint.outcome,...(document===ORIGINAL?{relatedJointMotions:[joint]}:{})};
}
function match(document,number) {const matched=document===ORIGINAL&&number===7;return {memberId:'1',matched,aggregateMatched:matched,basis:matched?'aggregate':null,variantListIds:[],status:matched?'recorded':'not-recorded'};}
function amendment(document,number,language='en') {
 const original=language==='hu'?'1. Pontos magyar forrásszöveg.':'1. Exact original source wording.';
 return {id:document+'-AM-'+number,number,targetDocumentId:document,listId:document+'-AM-001-020',language,requestedLanguage:language,targetLabel:'Paragraph 1',targetLabelLanguage:language,originalText:original,proposedText:language==='hu'?'1. Pontos magyar javaslat.':'1. Exact proposed wording.',textIntegrity:'complete',authors:[{name:document===ORIGINAL&&number===7?'Member 1':'Another proposer',personId:document===ORIGINAL&&number===7?'1':'2',status:'resolved'}],memberMatch:match(document,number),wording:{language,requestedLanguage:language,languageFallback:false,originalStatus:'available',proposedStatus:'available'},wordingSource:{...SOURCE,language},proposerSource:SOURCE,sources:[SOURCE],outcome:'unavailable',wholeAmendmentOutcome:'unavailable',decisions:[],splitParts:[]};
}
function motionResponse(url) {
 const document=decodeURIComponent(url.pathname.split('/').at(-1)),q=url.searchParams,language=q.get('lang'),scope=q.get('scope'),offset=Number(q.get('offset'));
 assert([ORIGINAL,JOINT].includes(document),'fixture motion identity');
 assert.equal(q.get('member'),'1');assert.equal(q.get('limit'),'20');assert(['member','all'].includes(scope));assert(['en','hu'].includes(language));assert(Number.isInteger(offset)&&offset>=0);
 const all=Array.from({length:25},(_,index)=>amendment(document,index+1,language)),filtered=scope==='all'?all:all.filter(x=>x.memberMatch.matched),items=filtered.slice(offset,offset+20),requestedId=q.get('amendment');
 const selected=requestedId?all.find(x=>x.id===requestedId)||null:null;
 const text={id:document,reference:document,status:'indexed',kind:document===ORIGINAL?'original':'joint',title:document===ORIGINAL?'Synthetic original text':'Synthetic joint text',titleLanguage:language,date:'2026-03-25',files:[],availableLanguages:[language],preferredFile:null,languageFallback:false,authors:document===ORIGINAL?[{id:1,relationships:['AUTHOR']}]:[],memberAuthorship:{memberId:'1',status:document===ORIGINAL?'recorded':'not-recorded',relationships:document===ORIGINAL?['AUTHOR']:[],sources:[SOURCE]},sources:[SOURCE],generation:1,outcome:{status:document===ORIGINAL?'lapsed':'adopted',totalsStatus:'unavailable',evidenceGaps:[]},memberPosition:{memberId:'1',status:'unavailable',position:null,reason:'named-member-votes-not-in-motion-sources'}};
 return {schemaVersion:2,text,relations:{originalMotions:[],jointMotions:document===ORIGINAL?[{...text,id:JOINT,reference:JOINT,kind:'joint',memberAuthorship:{memberId:'1',status:'not-recorded',relationships:[],sources:[]},relationship:{type:'is_derivative_of',from:JOINT,to:ORIGINAL,sources:[SOURCE]}}]:[],adoptedTexts:[],adoptedCoverage:{status:'unavailable',complete:false,gaps:[]},complete:false,limit:5},scope:{documentId:document,memberId:'1',results:scope,requestedLanguage:language},items,total:filtered.length,totals:{allIndexed:25,memberMatched:document===ORIGINAL?1:0},offset,limit:20,selection:{requestedId,status:requestedId?selected?'available':'unavailable':'not-requested',item:selected,inRequestedScope:selected?scope==='all'||selected.memberMatch.matched:null,inPage:Boolean(selected&&items.some(x=>x.id===selected.id))},coverage:{complete:false,observationComplete:false,indexed:true,indexStatus:'indexed',resultState:items.length?'records':'no-indexed-member-matches',backgroundPending:false,backgroundPendingScope:'index',targetProcessing:'unknown',observationScope:'indexed-plenary-amendment-sources',emptyObservation:null,gaps:[],lastUpdated:SOURCE.fetchedAt,parserVersion:'navigation-fixture',scope:'plenary',servingGeneration:1,workingGeneration:false},snapshots:{amendments:1,text:1}};
}
function contextDocument(id,language='en',paragraphCount=3) {
 const paragraphs=Array.from({length:paragraphCount},(_,index)=>index===1?(language==='hu'?'1. Pontos magyar forrásszöveg.':'1. Exact original source wording.'):'Synthetic '+id+' '+language+' source paragraph '+index+'.');
 return {id,titles:{en:'Source '+id,hu:'Forrás '+id},date:'2026-03-25',files:[],answers:[],selectedDocumentId:id,selectedText:{status:'available',paragraphs,textLanguage:language,availableTextLanguages:['en','hu'],notes:[],noteAnchors:[],documentLinks:[]}};
}
function contextResponse(url) {
 const id=decodeURIComponent(url.pathname.split('/').at(-1)),q=url.searchParams,language=q.get('lang')||'en',requested=q.get('amendment'),wording=q.has('wording-lang')?q.get('wording-lang')==='unknown'?null:q.get('wording-lang'):undefined;
 assert([ORIGINAL,JOINT,ADOPTED].includes(id));
 return {documentId:id,requestedLanguage:language,...(wording!==undefined?{requestedWordingLanguage:wording}:{}),document:contextDocument(id,language),related:{status:'available',items:[{...contextDocument(ADOPTED,language),relationship:{from:ADOPTED,field:'adopts',to:id}}],gaps:[]},amendment:requested?{id:requested,status:'available',variants:[{listId:q.get('list'),language:wording===undefined?language:wording,wordingStatus:'available',targetLabel:'Paragraph 1',originalText:language==='hu'?'1. Pontos magyar forrásszöveg.':'1. Exact original source wording.',proposedText:'Exact proposal',authors:[]}]}:null,target:requested?{status:'found',paragraphs:[1],quoteMatches:true,evidence:{amendmentId:requested,listId:q.get('list'),wordingLanguage:wording===undefined?language:wording}}:{status:'not-requested',paragraphs:[]}};
}
function latestResponse(url) {
 const q=url.searchParams,source=q.get('source-id'),offset=Number(q.get('offset')||0),items=source?[]:[activity()];
 return {categories:{motions:'Motions for resolutions','written-questions':'Written questions'},categoryGroups:[{label:'Documents',categories:['motions','written-questions']}],categoryCoverage:{motions:{status:'available',indexedCount:30},'written-questions':{status:'available',indexedCount:10}},items,selectedItems:source&&[ORIGINAL,JOINT].includes(source)?[activity(source)]:[],indexedTotal:30,nextOffset:source?null:offset<20?offset+10:null,unclassifiedMotionCount:0,cache:{complete:true}};
}
const button=(container,text)=>[...container.querySelectorAll('button')].find(node=>typeof text==='string'?node.textContent.trim()===text:text.test(node.textContent.trim()));
const params=()=>new URLSearchParams(location.search);
const query=fields=>new URLSearchParams({member:'1',module:'activities',lang:'en',activity:'motions:'+ORIGINAL,...fields}).toString();

async function harness(t,selection=query({}),{context=contextResponse,motions=motionResponse,latest=latestResponse}={}) {
 const window=new Window({url:'http://localhost/?'+selection}),requests=[],unexpected=[],pushes=[];
 const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 const rawPush=history.pushState.bind(history);t.mock.method(history,'pushState',(...args)=>{pushes.push(args[2]);return rawPush(...args);});
 let root,loadModule;
 t.after(async()=>{if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];assert.deepEqual(unexpected,[],'all HTTP reads remain inside the explicit local fixtures');});
 t.mock.method(globalThis,'fetch',async input=>{const classification=topicFixture(input);if(classification)return classification;
  const url=new URL(input,location.href);requests.push(url);
  if(url.pathname==='/api/directory')return Response.json(directory);
  if(url.pathname.startsWith('/api/portrait/'))return new Response(null,{status:404});
  if(url.pathname.startsWith('/api/profile/'))return Response.json({...members[Number(url.pathname.split('/').at(-1))-1],birthDate:null,memberships:[]});
  if(url.pathname.startsWith('/api/latest-activities/'))return Response.json(await latest(url));
  if(url.pathname.startsWith('/api/motion-amendments/')){const result=await motions(url);return result instanceof Response?result:Response.json(result);}
  if(url.pathname.startsWith('/api/commission-followups/'))return Response.json({documentId:decodeURIComponent(url.pathname.split('/').at(-1)),requestedLanguage:url.searchParams.get('lang')||'en',status:'none-listed',items:[],gaps:[],sources:[]});
  if(url.pathname.startsWith('/api/document-context/')){const result=await context(url);return result instanceof Response?result:Response.json(result);}
  if(url.pathname.startsWith('/api/document/'))return Response.json({...contextDocument(decodeURIComponent(url.pathname.split('/').at(-1))),roles:['AUTHOR'],coAuthors:[]});
  if(url.pathname.startsWith('/api/qa-motion-cache/'))return Response.json({id:url.pathname.split('/').at(-1)});
  if(url.pathname==='/api/insights/following-status')return Response.json({epoch:'test',generation:1,marksReady:false,indexComplete:false});
  if(url.pathname==='/api/insights/saved')return Response.json({members:[],questions:[]});
  if(url.pathname==='/api/corpus/search')return Response.json({results:[],total:0,nextOffset:null,coverage:{status:'partial'}});
  if(url.pathname==='/api/insights/search')return Response.json({offset:0,sections:[]});
  if(url.pathname==='/api/vote-periods')return Response.json({version:3,weeks:[],coverage:{status:'unavailable',years:[]}});
  if(url.pathname.startsWith('/api/speech-statistics/'))return Response.json({items:[],counts:{},groups:[],coverage:{available:0,total:0,complete:true,headers:0},sources:[],nextPage:null});
  if(url.pathname==='/api/insights/speech-cloud')return Response.json({scope:{},words:[],speeches:[],coverage:{transcripts:0,complete:true},window:{},nextPage:null});
  unexpected.push(url.href);throw Error('Unexpected fixture request '+url.href);
 });
 loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {default:App}=await loadModule('/src/App.tsx'),{useData}=await loadModule('/src/data.ts'),{createRoot}=await import('react-dom/client');
 const WarmCache=({route})=>{const state=useData(route);return createElement('span',{hidden:true,'data-motion-cache-ready':Boolean(state.data&&!state.loading&&!state.error)});};
 const container=document.createElement('div');document.body.append(container);root=createRoot(container);let warmRoutes=[];
 const draw=()=>root.render(createElement(Fragment,null,createElement(App,{key:'app'}),...warmRoutes.map(route=>createElement(WarmCache,{key:route,route}))));
 const settle=async()=>{await viewReady(container);for(let attempt=0;attempt<200;attempt++){await act(async()=>new Promise(resolve=>setTimeout(resolve,10)));if(!container.querySelector('p[data-motion-pending="true"]'))return;}assert.fail('Motion module did not mount');};
 await act(async()=>draw());await settle();
 const click=async node=>{await act(async()=>{assert(node,'Missing control; visible text: '+container.textContent);node.click();});await settle();};
 const change=async(node,value)=>{await act(async()=>{assert(node,'Missing select');node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));});await settle();};
 const go=async delta=>{await act(async()=>{let timer,listener;const popped=new Promise((resolve,reject)=>{listener=resolve;window.addEventListener('popstate',listener,{once:true});timer=setTimeout(()=>reject(Error('Missing popstate')),5000);});try{history.go(delta);await popped;}finally{clearTimeout(timer);window.removeEventListener('popstate',listener);}});await settle();};
 const restore=async selection=>{await act(async()=>{history.pushState(null,'','/?'+selection);window.dispatchEvent(new window.PopStateEvent('popstate'));});await settle();};
 const warmCache=async count=>{warmRoutes=Array.from({length:count},(_,index)=>'qa-motion-cache/'+index);await act(async()=>draw());for(let attempt=0;attempt<200;attempt++){if(container.querySelectorAll('[data-motion-cache-ready="true"]').length===count)return;await act(async()=>new Promise(resolve=>setTimeout(resolve,10)));}assert.fail('Finite cache fixtures did not settle');};
 return {window,container,requests,pushes,click,change,go,restore,warmCache,settle};
}

for(const blocked of [false,true])test('motion navigation preserves an older closed global search with '+(blocked?'blocked':'available')+' session storage',async t=>{
 const h=await harness(t,query({})+'&'+closedGlobalSearch);
 await checkClosedGlobalSearchHistory(t,h,()=>h.click(h.container.querySelector('.motion-amendments__disclosure')),blocked);
 assert.equal(params().get('ma-view'),'amendments');
});

test('activity page/category are controlled App history and survive Profile, browser Back and direct Activities return',async t=>{
 const h=await harness(t,query({activity:'','activity-offset':'10','activity-category':'motions'})),length=history.length;
 assert.equal(length,1,'canonical role/language fields replace the initial entry');
 assert.equal(params().get('activity-offset'),'10');assert.equal(params().get('activity-category'),'motions');
 assert(h.requests.some(url=>url.pathname==='/api/latest-activities/1'&&url.searchParams.get('offset')==='10'&&url.searchParams.get('category')==='motions'));
 const page=location.href;
 await h.click(button(h.container,'Profile'));assert.equal(history.length,length+1);
 await h.go(-1);assert.equal(location.href,page);
 await h.click(button(h.container,'Profile'));const profileLength=history.length;
 await h.click(button(h.container,'Political activities'));assert.equal(history.length,profileLength+1);assert.equal(location.href,page);
 const beforePage=history.length;await h.click(button(h.container,'Next 10'));
 assert.equal(history.length,beforePage+1);assert.equal(params().get('activity-offset'),'20');
 await h.go(-1);assert.equal(location.href,page);
 await h.click(button(h.container,'Change category'));const beforeCategory=h.pushes.length;
 await h.click([...h.container.querySelectorAll('#activity-categories button')].find(node=>node.querySelector('span')?.textContent==='Written questions'));
 assert.equal(h.pushes.length,beforeCategory+1,'category+page reset is one gesture and one history entry');
 assert.equal(params().get('activity-category'),'written-questions');assert.equal(params().get('activity-offset'),null);assert.equal(params().get('activity'),null);
 await h.go(-1);assert.equal(location.href,page);
});

for(const exit of ['Back to members','MEPs'])test('opening another MEP through '+exit+' resets the activity category and page',async t=>{
 const h=await harness(t,query({activity:'','activity-category':'motions','activity-offset':'10'}));
 const firstMemberPage=location.href;
 await h.click(button(h.container,exit==='Back to members'?/←/:exit));
 await h.click(h.container.querySelector('[data-member-id="2"] .portrait--button'));
 assert.equal(params().get('member'),'2');
 assert.equal(params().get('activity-category'),null,'a fresh member must not inherit the previous category');
 assert.equal(params().get('activity-offset'),null,'a fresh member starts on the first page');
 await h.click(button(h.container,'Political activities'));
 assert.match(h.container.querySelector('.explorer-activity-results-title').textContent,/^All activities/);
 assert(h.requests.some(url=>url.pathname==='/api/latest-activities/2'&&url.searchParams.get('offset')==='0'&&!url.searchParams.has('category')));
 if(exit==='Back to members'){
  await h.go(-3);
  assert.equal(location.href,firstMemberPage,'browser Back restores the original member’s exact selection');
  assert.match(h.container.querySelector('.explorer-activity-results-title').textContent,/^Motions for resolutions/);
  await h.go(3);
  assert.equal(params().get('member'),'2');
  assert.equal(params().get('activity-category'),null);
  assert.match(h.container.querySelector('.explorer-activity-results-title').textContent,/^All activities/);
 }
});

for(const scroller of ['.explorer-profile-body','main.explorer'])test(scroller+': actual motion body scroll survives cold pending restore, a second departure, and Refresh list',async t=>{
 let delayed=false,releaseBody;
 const delayedBodies=new Set();
 const h=await harness(t,query({}),{context:url=>{
  const payload=contextResponse(url);payload.document=contextDocument(payload.documentId,payload.requestedLanguage,207);
  if(delayed&&url.searchParams.get('adopted')!=='1')return new Promise(resolve=>{releaseBody=()=>resolve(payload);delayedBodies.add(releaseBody);});
  return payload;
 }});
 // Release every delayed body so request deadlines do not keep the file alive.
 t.after(()=>{for(const release of delayedBodies)release();});
 await h.click(button(h.container,'Read motion'));
 const contextUrl=location.href,outer=()=>h.container.querySelector(scroller),prototype=h.window.HTMLElement.prototype;
 assert.equal(h.container.querySelectorAll('.document-context-reader [data-source-paragraph]').length,207);
 const ownScroll=Object.getOwnPropertyDescriptor(prototype,'scrollTop');let owner=prototype;
 while(!Object.hasOwn(owner,'scrollTop'))owner=Object.getPrototypeOf(owner);
 const native=Object.getOwnPropertyDescriptor(owner,'scrollTop'),writes=[];
 Object.defineProperty(prototype,'scrollTop',{configurable:true,get(){const clamped=this.matches(scroller)&&this.querySelector('.explorer-activities .document-context-reader')&&!this.querySelector('.explorer-activities .document-context-reader [data-source-paragraph]');return clamped?0:native.get.call(this);},set(value){
  const target=this.matches(scroller),pending=Boolean(this.querySelector('.explorer-activities .document-context-reader'))&&!this.querySelector('.explorer-activities .document-context-reader [data-source-paragraph]');
  if(target)writes.push({value,pending});native.set.call(this,target&&pending?0:value);
 }});
 t.after(()=>ownScroll?Object.defineProperty(prototype,'scrollTop',ownScroll):delete prototype.scrollTop);
 if(scroller==='main.explorer'){
  Object.defineProperties(outer(),{scrollHeight:{value:6000},clientHeight:{value:800}});
  const computed=globalThis.getComputedStyle;t.mock.method(globalThis,'getComputedStyle',node=>node.classList.contains('explorer-tabs')?{position:'sticky'}:computed(node));
  t.mock.method(h.container.querySelector('.explorer-profile-body'),'getBoundingClientRect',()=>({top:-77}));
 }
 outer().scrollTop=413; // Deliberately no scroll event: App must capture before unmount.
 await h.click(button(h.container,'Profile'));assert.equal(h.container.querySelector('.document-context-reader'),null);
 await h.warmCache(61);assert.equal(h.requests.filter(url=>url.pathname.startsWith('/api/qa-motion-cache/')).length,61);
 delayed=true;writes.length=0;outer().scrollTop=91;
 await h.go(-1);assert.equal(location.href,contextUrl);
 assert.equal(typeof releaseBody,'function','the evicted source body is independently delayed');
 assert(h.container.querySelector('.document-context-reader'));assert.equal(h.container.querySelector('.document-context-reader [data-source-paragraph]'),null);
 assert.equal(outer().scrollTop,0,'the pending body has no scroll range');
 assert.equal(writes.some(write=>write.value===413),false,'restoration is held until the full body settles');
 await h.click(button(h.container,'Profile'));await h.go(-1);
 assert.equal(location.href,contextUrl);assert.equal(h.container.querySelector('.document-context-reader [data-source-paragraph]'),null);
 assert.equal(writes.some(write=>write.value===413),false,'leaving a clamped pending body must not overwrite the readable checkpoint with zero');
 await act(async()=>releaseBody());await h.settle();
 assert.equal(h.container.querySelectorAll('.document-context-reader [data-source-paragraph]').length,207);assert.equal(outer().scrollTop,413);
 assert(writes.some(write=>write.value===413&&!write.pending));
 // Refreshing the list reuses this mounted source body. Its new scalar position
 // must win over an older checkpoint, even with no intervening scroll event.
 outer().scrollTop=617;const before=history.length;
 await h.click(button(h.container,'Refresh list'));
 assert.equal(history.length,before);assert.equal(outer().scrollTop,617);
 await h.click(button(h.container,'Profile'));outer().scrollTop=72;
 await h.click(button(h.container,'Political activities'));
 assert.equal(location.href,contextUrl);assert.equal(outer().scrollTop,617);
});

test('choosing the verified joint text resets amendment/version/page and does not inherit original authorship',async t=>{
 const h=await harness(t);
 await h.click(h.container.querySelector('.motion-amendments__disclosure'));
 await h.click(button(h.container,/^All available amendments/));
 await h.click([...h.container.querySelectorAll('.motion-amendments__row-button')].find(node=>node.textContent.includes('Amendment 7')));
 const selected=new URLSearchParams(location.search);selected.set('ma-list',LIST);await h.restore(selected.toString());
 await h.click(h.container.querySelector('.motion-amendments__pages button:last-child'));
 assert.equal(params().get('ma-offset'),'20');assert.equal(params().get('ma-amendment'),AMENDMENT);assert.equal(params().get('ma-list'),LIST);
 const before=history.length;
 await h.change(h.container.querySelector('select[aria-label="Motion text"]'),JOINT);
 assert.equal(history.length,before+1);assert.equal(params().get('ma-text'),JOINT);
 assert.equal(params().get('ma-amendment'),null);assert.equal(params().get('ma-list'),null);assert.equal(params().get('ma-offset'),'0');
 assert.equal(h.container.querySelector('select[aria-label="Motion text"]').value,JOINT);
 assert.equal(h.container.querySelector('.motion-amendments__disclosure').getAttribute('aria-expanded'),'false','a different text starts with a fresh closed reader');
 assert.equal(h.requests.filter(url=>url.pathname==='/api/motion-amendments/'+JOINT).length,0);
 await h.click(h.container.querySelector('.motion-amendments__disclosure'));
 const jointRequests=h.requests.filter(url=>url.pathname==='/api/motion-amendments/'+JOINT);
 assert(jointRequests.length);assert.equal(jointRequests.at(-1).searchParams.get('offset'),'0');assert.equal(jointRequests.at(-1).searchParams.get('amendment'),null);
 assert.equal(h.container.querySelector('.motion-amendments__member-tag'),null,'original authorship cannot label another text’s amendment proposers');
 assert.doesNotMatch(h.container.querySelector('.explorer-motion-outcome').textContent,/author of this joint motion/);
});

test('a closed exact joint-motion link survives activity and App canonicalization without opening a different reader',async t=>{
 const h=await harness(t,query({activity:JOINT,'ma-member':'1','ma-source':JOINT,'ma-owner':'fixture-'+JOINT,'ma-text':JOINT}));
 assert.equal(params().get('activity'),'motions:'+JOINT,'the exact linked activity is canonicalized with its category');
 assert.equal(params().get('ma-text'),JOINT);assert.equal(params().get('role'),null);assert.equal(params().get('lang'),null);assert.equal(document.documentElement.lang,'en');
 assert.equal(h.container.querySelector('.motion-amendments__reference')?.textContent,JOINT);
 const textChoice=h.container.querySelector('select[aria-label="Motion text"]');if(textChoice)assert.equal(textChoice.value,JOINT);
 assert.equal(h.container.querySelector('.motion-amendments__disclosure')?.getAttribute('aria-expanded'),'false');
 assert.equal(h.requests.some(url=>url.pathname.startsWith('/api/motion-amendments/')),false,'closed exact text is not a request for a different/default amendment list');
 assert.equal(h.requests.some(url=>url.pathname.startsWith('/api/document-context/')),false);
 assert.equal(history.length,1);
});

test('duplicate requested text remains invalid after App canonicalization instead of substituting a valid text',async t=>{
 const selection=new URLSearchParams(query({'ma-member':'1','ma-source':ORIGINAL,'ma-owner':'fixture-'+ORIGINAL}));selection.append('ma-text',ORIGINAL);selection.append('ma-text',JOINT);
 const h=await harness(t,selection.toString());
 assert.deepEqual(params().getAll('ma-text'),[ORIGINAL,JOINT]);assert.equal(params().get('role'),null);assert.equal(params().get('lang'),null);assert.equal(document.documentElement.lang,'en');
 assert.match(h.container.querySelector('.member-motion-reader__unavailable')?.textContent,/reader link is unavailable/i);
 assert.equal(h.container.querySelector('.motion-amendments'),null);
 assert.equal(h.requests.some(url=>url.pathname.startsWith('/api/motion-amendments/')||url.pathname.startsWith('/api/document-context/')),false);
 await h.click(button(h.container,'Profile'));await h.go(-1);
 assert.deepEqual(params().getAll('ma-text'),[ORIGINAL,JOINT]);
 assert.equal(h.requests.some(url=>url.pathname.startsWith('/api/motion-amendments/')||url.pathname.startsWith('/api/document-context/')),false);
});

test('a foreign amendment can be cleared explicitly while whole motion and adopted discovery remain usable',async t=>{
 const h=await harness(t);await h.click(h.container.querySelector('.motion-amendments__disclosure'));
 await h.click(h.container.querySelector('.motion-amendments__row-button'));
 const foreign=JOINT+'-AM-7',selected=new URLSearchParams(location.search);selected.set('ma-amendment',foreign);selected.set('ma-list',JOINT+'-AM-001-020');
 const start=h.requests.length;await h.restore(selected.toString());
 assert.match(h.container.textContent,/linked amendment is unavailable for this motion/);
 assert.equal(h.requests.slice(start).some(url=>url.pathname.startsWith('/api/motion-amendments/')),false,'foreign identity cannot trigger a default or wrong-motion selection fetch');
 await h.click(button(h.container,'Read motion'));
 assert.equal(params().get('ma-amendment'),foreign);assert.match(h.container.querySelector('.document-context-reader').textContent,/Synthetic B-10-2026-0001 en source paragraph 0/);
 const whole=h.requests.filter(url=>url.pathname==='/api/document-context/'+ORIGINAL).at(-1);assert.equal(whole.searchParams.get('amendment'),null);assert.equal(whole.searchParams.get('list'),null);
 await h.click(h.container.querySelector('.document-context-back'));assert.equal(params().get('ma-amendment'),foreign);
 await h.click(button(h.container,'Find the adopted text'));
 assert(h.container.querySelector('.document-context-choices'));assert.equal(h.requests.filter(url=>url.pathname==='/api/document-context/'+ORIGINAL).at(-1).searchParams.get('adopted'),'1');
 await h.click(h.container.querySelector('.document-context-back'));await h.click(button(h.container,'Clear selection'));
 assert.equal(params().get('ma-amendment'),null);assert.equal(params().get('ma-list'),null);
 assert(h.container.querySelector('.motion-amendments__row-button'));
});

test('exact amendment, list and wording language reach the shared context; adopted selection stays separate',async t=>{
 const h=await harness(t,query({}),{motions:url=>{
  const payload=motionResponse(url);
  for(const item of [...payload.items,...(payload.selection.item?[payload.selection.item]:[])])if(item.id===AMENDMENT){
   item.originalText='1. Pontos magyar forrásszöveg.';item.proposedText='1. Pontos magyar javaslat.';item.language='hu';item.wording={...item.wording,language:'hu',languageFallback:true};item.wordingSource={...SOURCE,language:'hu'};
  }
  return payload;
 }});
 await h.click(h.container.querySelector('.motion-amendments__disclosure'));
 await h.click(h.container.querySelector('.motion-amendments__row-button'));
 assert.equal(wordingText(h.container.querySelector('.motion-amendments__detail'),'proposed'),'1. Pontos magyar javaslat.');
 const before=history.length;
 await h.click(button(h.container,'Read in context'));
 assert.equal(history.length,before+1);assert.equal(params().get('ma-amendment'),AMENDMENT);assert.equal(params().get('ma-list'),LIST);assert.equal(params().get('ma-wording-lang'),'hu');
 const source=h.requests.filter(url=>url.pathname==='/api/document-context/'+ORIGINAL&&url.searchParams.get('adopted')!=='1').at(-1);
 const semanticQuery=new URLSearchParams(source.searchParams),transportVersion=semanticQuery.getAll('v');
 assert(transportVersion.length===0||transportVersion.length===1&&transportVersion[0]===String(API_VERSION),'only the admitted transport version may accompany the semantic query');
 semanticQuery.delete('v');
 assert.deepEqual(Object.fromEntries(semanticQuery),{lang:'hu',amendment:AMENDMENT,list:LIST,'wording-lang':'hu'});
 assert.equal(params().get('lang'),null,'default English is implicit');assert.equal(document.documentElement.lang,'en','source language is independent of the interface language');
 assert.equal(h.container.querySelector('.document-context-reader [data-context-target="true"]')?.textContent,'1. Pontos magyar forrásszöveg.');
 const context=location.href;await h.click(button(h.container,'Profile'));await h.go(-1);assert.equal(location.href,context);
 assert.equal(h.container.querySelector('.document-context-text')?.lang,'hu');
 await h.click(h.container.querySelector('.document-context-back'));
 assert.equal(params().get('ma-view'),'amendments');assert.equal(params().get('ma-amendment'),AMENDMENT);assert.equal(params().get('ma-list'),LIST);assert.equal(params().get('ma-wording-lang'),'hu');
 assert.equal(wordingText(h.container.querySelector('.motion-amendments__detail'),'proposed'),'1. Pontos magyar javaslat.');
 await h.click(button(h.container,'Find the adopted text'));
 const choices=location.href,choice=[...h.container.querySelectorAll('.document-context-choices button')].find(node=>node.textContent.includes('Source '+ADOPTED));
 assert(choice);const choiceLength=history.length;await h.click(choice);
 assert.equal(history.length,choiceLength+1);assert.equal(params().get('ma-ta'),ADOPTED);assert.equal(params().get('ma-amendment'),AMENDMENT);
 assert.equal(h.container.querySelector('.document-context-heading h3')?.textContent,'Source '+ADOPTED);
 const adoptedRequest=h.requests.filter(url=>url.pathname==='/api/document-context/'+ADOPTED).at(-1);
 assert.equal(adoptedRequest.searchParams.get('amendment'),null);assert.equal(adoptedRequest.searchParams.get('list'),null);
 await h.go(-1);assert.equal(location.href,choices);assert.equal(params().get('ma-ta'),null);assert(h.container.querySelector('.document-context-choices'));
 await h.go(1);assert.equal(params().get('ma-ta'),ADOPTED);assert.equal(h.container.querySelector('.document-context-heading h3')?.textContent,'Source '+ADOPTED);
});
