import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {createMotionJourney,motionJourneyUrl,motionTextChoices,readMotionJourney} from './motionJourney.mjs';

const original='B-10-2026-0441',joint='RC-10-2026-0441',ta='TA-10-2026-0339',memberId=101;
const activity={id:'motions:'+original,sourceId:original,category:'motions',title:'Public original title',titleLanguage:'en',relatedJointMotions:[{sourceId:joint,title:'Public joint title',memberAuthorship:'not-recorded'}]};
const binding={memberId,sourceId:original,ownerId:activity.id,choices:motionTextChoices(activity)};
const source={url:'https://data.europarl.europa.eu/distribution/example/public_en.docx',language:'en',fetchedAt:'2026-10-18T12:00:00Z'};
const baseHref='http://localhost/?member=101&module=activities&activity=motions%3A'+original+'&mv-offset=20';
const share=patch=>motionJourneyUrl(baseHref,binding,{...createMotionJourney(binding),...patch});

function fixturePage(url,wordingLanguage='en') {
  const documentId=decodeURIComponent(url.pathname.split('/').at(-1)),member=url.searchParams.get('member'),offset=Number(url.searchParams.get('offset')),language=url.searchParams.get('lang');
  const matched=documentId===original,match={memberId:member,matched,aggregateMatched:matched,basis:matched?'aggregate':null,variantListIds:[],status:matched?'recorded':'not-recorded'};
  const wording={language:wordingLanguage,requestedLanguage:language,languageFallback:wordingLanguage!==language,originalStatus:'available',proposedStatus:'available'};
  const variant=listId=>({listId,language:'de',targetLabel:'Paragraph 1',originalText:'Public original wording',proposedText:'Public proposed wording',authors:[],memberMatch:match,wording,sources:[source],wordingSource:source});
  const number=offset+13,item={...variant(documentId+'-AM-001-050'),id:documentId+'-AM-'+number,number,targetDocumentId:documentId,requestedLanguage:language,wholeAmendmentOutcome:'unavailable',decisions:[],splitParts:[],variants:[variant(documentId+'-AM-001-050'),variant(documentId+'-AM-013-050')]};
  const requested=url.searchParams.get('amendment'),selected=requested===item.id?item:null;
  return {schemaVersion:1,text:{id:documentId},scope:{documentId,memberId:member,results:url.searchParams.get('scope'),requestedLanguage:language},offset,limit:20,total:45,items:[item],totals:{allIndexed:45,memberMatched:matched?45:0},
    selection:{requestedId:requested,status:requested?selected?'available':'unavailable':'not-requested',item:selected,inPage:Boolean(selected),inRequestedScope:Boolean(selected)},
    relations:{adoptedTexts:[]},coverage:{complete:false,resultState:'records'},snapshots:{amendments:1,text:1}};
}
function fixtureContext(url) {
  const documentId=decodeURIComponent(url.pathname.split('/').at(-1)),adopted=url.searchParams.get('adopted')==='1',pin=url.searchParams.get('wording-lang');
  const choice={id:ta,titles:{en:'Public adopted title'},date:'2026-10-08',files:[],relationship:{from:ta,field:'adopts',to:documentId},source};
  return {documentId,requestedLanguage:url.searchParams.get('lang'),...(pin!==null?{requestedWordingLanguage:pin==='unknown'?null:pin}:{}),document:adopted?null:{id:documentId,titles:{en:'Public complete text'},files:[],selectedDocumentId:documentId,
    selectedText:{status:'available',paragraphs:['Public complete document body.'],textLanguage:url.searchParams.get('lang'),availableTextLanguages:[url.searchParams.get('lang')],sourceUrl:source.url,notes:[],noteAnchors:[],documentLinks:[]}},
    related:{status:adopted?'available':'not-requested',items:adopted?[choice]:[],gaps:[]},amendment:null,target:{status:'not-requested',paragraphs:[]},sources:[]};
}

async function harness(t,{url=baseHref,props={},autoApply=true,wordingLanguage='en',delayList=false,delayContext=false}={}) {
  const window=new Window({url:baseHref}),requests=[],pending=[],changes=[];
  let query=new URL(url).searchParams,currentHref=url;
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
  const saved=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  window.HTMLElement.prototype.scrollIntoView=function(){};
  const historyWrites=[];t.mock.method(window.history,'pushState',()=>historyWrites.push('push'));t.mock.method(window.history,'replaceState',()=>historyWrites.push('replace'));
  const queryListeners=[],add=window.addEventListener.bind(window);
  t.mock.method(window,'addEventListener',(type,listener,options)=>{if(['popstate','explorer-query-change'].includes(type))queryListeners.push(type);return add(type,listener,options);});
  let vite,root,currentProps={activity,memberId,language:'en',memberName:'Public member',...props};
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    for(const entry of pending.splice(0))entry.resolve(Response.json(entry.body));
    if(vite)await vite.close();await window.happyDOM.close();
    for(const [key,descriptor] of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
    assert.deepEqual(historyWrites,[],'history belongs to the parent');
  });
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);requests.push(url);
    const isList=url.pathname.startsWith('/api/motion-amendments/');
    assert(isList||url.pathname.startsWith('/api/document-context/'),'Unexpected request: '+url.href);
    const body=isList?fixturePage(url,wordingLanguage):fixtureContext(url);
    return (isList?delayList:delayContext)?new Promise(resolve=>pending.push({url,body,resolve})):Response.json(body);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {MemberMotionReader}=await vite.ssrLoadModule('/src/MemberMotionReader.tsx'),{createRoot}=await import('react-dom/client');
  const main=document.createElement('main'),panel=document.createElement('div'),container=document.createElement('div');
  main.className='explorer';panel.className='explorer-profile-body';document.body.append(main);main.append(panel);panel.append(container);root=createRoot(container);
  const accept=change=>{currentHref=motionJourneyUrl(currentHref,change.binding,change.next).href;query=new URL(currentHref).searchParams;render();};
  const onJourneyChange=(binding,next,reason)=>{const change={binding,next,reason};changes.push(change);if(autoApply)accept(change);};
  const render=()=>root.render(createElement(MemberMotionReader,{...currentProps,query,onJourneyChange}));await act(async()=>render());
  const button=label=>[...container.querySelectorAll('button')].find(node=>typeof label==='string'?node.textContent.trim()===label:label.test(node.textContent));
  const click=label=>act(async()=>{const node=button(label);assert(node,'Missing button '+label+'; '+container.textContent);node.focus();node.click();});
  const change=(selector,value)=>act(async()=>{const node=container.querySelector(selector);assert(node);node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const restore=url=>act(async()=>{currentHref=url;query=new URL(url).searchParams;render();});
  const state=()=>readMotionJourney(query,binding),updateProps=patch=>act(async()=>{currentProps={...currentProps,...patch};render();});
  const finish=(body=pending[0]?.body)=>act(async()=>{assert(pending.length);pending.shift().resolve(Response.json(body));});
  const unmount=()=>act(async()=>{root.unmount();root=null;});
  return {window,container,main,panel,requests,pending,changes,button,click,change,restore,state,updateProps,query:()=>query,queryListeners,finish,unmount,accept:()=>act(async()=>accept(changes.at(-1)))};
}

test('host emits controlled proposals, reads only supplied query and owns no history/listeners/scroll',async t=>{
  const h=await harness(t,{autoApply:false});h.main.scrollTop=91;h.panel.scrollTop=430;
  assert.equal(h.requests.length,0);assert.deepEqual(h.queryListeners,[]);
  await h.click(/^Amendments/);assert.equal(h.changes.length,1);assert.deepEqual(h.changes[0].binding,binding);assert.equal(h.changes[0].reason,'toggle');assert.equal(h.changes[0].next.amendments.open,true);
  assert.equal(h.container.querySelector('.motion-amendments__panel'),null,'proposal alone cannot change controlled UI');assert.equal(h.requests.length,0);
  await h.accept();assert(h.container.querySelector('.motion-amendments__panel'));assert.equal(h.requests.length,1);assert.equal(h.main.scrollTop,91);assert.equal(h.panel.scrollTop,430);
  assert.equal(h.window.location.href,baseHref,'supplied query is independent of global location');
});

test('exact original to joint choice clears AM/list/page/context/language/TA without transferring authorship',async t=>{
  const state={...createMotionJourney(binding),amendments:{...createMotionJourney(binding).amendments,open:false,scope:'all',offset:20,amendmentId:original+'-AM-33',variantListId:original+'-AM-013-050',contextTarget:'amendment',wordingLanguage:'fr'},selectedTA:ta};
  const h=await harness(t,{url:share(state).href});assert.equal(h.requests.length,0);
  await h.change('[aria-label="Motion text"]',joint);assert.equal(h.changes.length,1);assert.equal(h.changes[0].reason,'text');
  assert.equal(h.state().documentId,joint);assert.deepEqual(h.state().amendments,createMotionJourney(binding).amendments);assert.equal(h.state().selectedTA,null);assert.equal(h.query().get('member'),'101');assert.equal(h.query().get('mv-offset'),'20');assert.equal(h.requests.length,0);
  await h.click(/^Amendments/);assert.equal(h.container.querySelector('.motion-amendments__member-tag'),null);assert(h.requests.every(url=>url.pathname.endsWith(joint)));
  await h.restore(share(state).href);assert.equal(h.state().amendments.wordingLanguage,'fr');assert.equal(h.state().amendments.offset,20);assert.equal(h.state().amendments.open,false);
});

test('detail gesture pins exact wording language and list; Back retains it and text headers omit it',async t=>{
  const h=await harness(t,{wordingLanguage:'fr'});
  await h.click(/^Amendments/);await h.click('All available amendments · 45');await h.click('Next');await h.click(/^Amendment 33/);await h.change('.motion-amendments__version select',original+'-AM-013-050');
  assert.equal(h.requests.filter(url=>url.pathname.includes('document-context')).length,0);
  await h.click('Read in context');assert.equal(h.changes.at(-1).reason,'context');
  let context=h.requests.filter(url=>url.pathname.includes('document-context')).at(-1);
  assert.equal(context.searchParams.get('amendment'),original+'-AM-33');assert.equal(context.searchParams.get('list'),original+'-AM-013-050');assert.equal(context.searchParams.get('wording-lang'),'fr');assert.equal(context.searchParams.get('lang'),'fr','wording pin wins over record and interface language');
  assert.equal(h.query().get('ma-wording-lang'),'fr');const pinned=new URLSearchParams(h.query()).toString();
  await h.click('← Back');assert.equal(h.state().amendments.wordingLanguage,'fr');assert.equal(h.state().amendments.offset,20);
  await h.click('Read motion');context=h.requests.filter(url=>url.pathname.includes('document-context')).at(-1);
  assert.equal(context.searchParams.get('amendment'),null);assert.equal(context.searchParams.get('list'),null);assert.equal(context.searchParams.get('wording-lang'),null);assert.equal(h.query().has('ma-wording-lang'),false);
  await h.restore('http://localhost/?'+pinned);assert.equal(h.state().amendments.wordingLanguage,'fr');assert.equal(h.state().amendments.variantListId,original+'-AM-013-050');
});

test('unknown wording language is explicit null; old absent context links remain legacy',async t=>{
  const h=await harness(t,{wordingLanguage:null});await h.click(/^Amendments/);await h.click(/^Amendment 13/);await h.change('.motion-amendments__version select',original+'-AM-001-050');await h.click('Read in context');
  assert.equal(h.state().amendments.wordingLanguage,null);assert.equal(h.query().get('ma-wording-lang'),'unknown');assert.equal(h.requests.at(-1).searchParams.get('wording-lang'),'unknown');
  const legacy=new URL('http://localhost/?'+h.query());legacy.searchParams.delete('ma-wording-lang');await h.restore(legacy.href);
  assert.equal(Object.hasOwn(h.state().amendments,'wordingLanguage'),false);assert.equal(h.requests.at(-1).searchParams.has('wording-lang'),false);
});

test('bad saved AM/list remain unavailable but exact motion/adopted headers recover without transferring identity',async t=>{
  const url=share();url.searchParams.set('ma-amendment',joint+'-AM-13');url.searchParams.set('ma-list',joint+'-AM-001-020');
  const h=await harness(t,{url:url.href});assert(h.container.querySelector('.motion-amendments'));assert.match(h.container.textContent,/linked amendment is unavailable/);assert.equal(h.requests.length,0);
  await h.click('Read motion');assert.equal(h.state().amendments.amendmentId,joint+'-AM-13');assert.equal(h.state().amendments.variantListId,joint+'-AM-001-020');assert.match(h.container.textContent,/Public complete document body/);
  assert.equal(h.requests.at(-1).pathname,'/api/document-context/'+original);assert.equal(h.requests.at(-1).searchParams.has('amendment'),false);assert.equal(h.requests.at(-1).searchParams.has('list'),false);
  await h.click('← Back');await h.click('Find the adopted text');assert(h.button(/Public adopted title/));assert.equal(h.query().has('ma-ta'),false,'a single related TA is never selected automatically');
  await h.click(/Public adopted title/);assert.equal(h.changes.at(-1).reason,'adopted-choice');assert.equal(h.state().selectedTA,ta);assert.equal(h.requests.at(-1).pathname,'/api/document-context/'+ta);
});

test('unsupported/duplicate text shares never mount a fallback; valid closed RC restores from controlled query',async t=>{
  const url=share();url.searchParams.set('ma-text','constructor');const h=await harness(t,{url:url.href});assert.match(h.container.textContent,/requested motion text is unavailable/i);assert.equal(h.container.querySelector('.motion-amendments'),null);assert.equal(h.requests.length,0);
  const duplicate=share();duplicate.searchParams.append('ma-text',joint);await h.restore(duplicate.href);assert.equal(h.container.querySelector('.motion-amendments'),null);assert.equal(h.query().getAll('ma-text').length,2);
  const closed={...createMotionJourney(binding),documentId:joint,amendments:{...createMotionJourney(binding).amendments,offset:40,amendmentId:joint+'-AM-00013',variantListId:joint+'-AM-013-050',contextTarget:'amendment',wordingLanguage:null},selectedTA:ta};
  await h.restore(share(closed).href);assert.equal(h.container.querySelector('[aria-label="Motion text"]').value,joint);assert.equal(h.state().amendments.amendmentId,joint+'-AM-00013');assert.equal(h.query().get('ma-wording-lang'),'unknown');assert.equal(h.requests.length,0);assert.equal(h.changes.length,0);
});

test('malformed saved wording pin never loads replacement context and whole-text action clears it',async t=>{
  const state={...createMotionJourney(binding),amendments:{...createMotionJourney(binding).amendments,open:true,view:'context',contextTarget:'amendment',amendmentId:original+'-AM-13',variantListId:original+'-AM-001-050',wordingLanguage:'en'}};
  const url=share(state);url.searchParams.set('ma-wording-lang','constructor');const h=await harness(t,{url:url.href});
  assert.equal(h.requests.length,0);assert.equal(h.state().amendments.wordingLanguage,'constructor');assert.match(h.container.textContent,/wording language is unavailable/);
  await h.click('Read motion');assert.equal(h.changes.length,1);assert.equal(h.changes[0].reason,'context');assert.equal(h.query().has('ma-wording-lang'),false);
  assert.equal(h.state().amendments.amendmentId,original+'-AM-13');assert.equal(h.state().amendments.variantListId,original+'-AM-001-050');
  const context=h.requests.find(url=>url.pathname.includes('document-context'));assert(context);assert.equal(context.searchParams.has('amendment'),false);assert.equal(context.searchParams.has('list'),false);assert.equal(context.searchParams.has('wording-lang'),false);
});

test('expanded list/exact response readiness is exposed, while closed and settled unavailable views are ready',async t=>{
  const selected={...createMotionJourney(binding),amendments:{...createMotionJourney(binding).amendments,open:true,amendmentId:original+'-AM-99'}};
  const h=await harness(t,{url:share(selected).href,delayList:true});assert(h.container.querySelector('[data-motion-pending="true"]'));assert.equal(h.pending.length,1);
  await h.finish();assert.equal(h.pending.length,1);assert(h.container.querySelector('[data-motion-pending="true"]'),'exact selection remains unsettled');
  await h.finish();assert.equal(h.container.querySelector('[data-motion-pending="true"]'),null);assert.match(h.container.textContent,/requested amendment is unavailable/i);
  await h.click(/^Amendments/);assert.equal(h.container.querySelector('[data-motion-pending="true"]'),null);
});

test('pending source marker remains visible for parent restoration; unknown TA never requests a replacement',async t=>{
  const state={...createMotionJourney(binding),amendments:{...createMotionJourney(binding).amendments,open:true,view:'context',contextTarget:'text'}};
  const h=await harness(t,{url:share(state).href,delayContext:true});assert(h.container.querySelector('[data-context-pending="true"]'));assert.equal(h.pending.length,1);
  await h.finish();assert.equal(h.container.querySelector('[data-context-pending="true"]'),null);assert.match(h.container.textContent,/Public complete document body/);
  const unknown='TA-10-2026-9999',adopted={...state,amendments:{...state.amendments,contextView:'adopted'},selectedTA:unknown};
  await h.restore(share(adopted).href);await h.finish();assert.equal(h.state().selectedTA,unknown);assert.match(h.container.textContent,/This adopted text is unavailable/);assert(h.requests.every(url=>!url.pathname.endsWith(unknown)&&!url.pathname.endsWith(ta)));
});

test('member/activity prop changes consume no other owner state and require no URL listeners',async t=>{
  const selected={...createMotionJourney(binding),amendments:{...createMotionJourney(binding).amendments,open:true,amendmentId:original+'-AM-13'},selectedTA:ta};
  const h=await harness(t,{url:share(selected).href});await h.updateProps({memberId:102});assert.equal(h.container.querySelector('.motion-amendments__panel'),null);
  await h.updateProps({memberId,activity:{...activity,id:'other:'+joint,sourceId:joint,relatedJointMotions:[]}});assert.equal(h.container.querySelector('[aria-label="Motion text"]').value,joint);assert.equal(h.container.querySelector('.motion-amendments__panel'),null);assert.deepEqual(h.queryListeners,[]);
  assert.equal(h.changes.length,0);await h.unmount();
});
