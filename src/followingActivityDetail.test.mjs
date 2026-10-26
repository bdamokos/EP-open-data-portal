import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

const questionId='E-10-2026-000001',answerId=questionId+'-ASW',motionId='B-10-2026-0441',jointId='RC-10-2026-0441';
const activity=(sourceId,extra={})=>({id:'written-questions:'+sourceId,sourceId,category:'written-questions',recordKind:'document',title:'Same source title',titleLanguage:'en',date:'2026-10-22',reference:sourceId,files:[],provenance:{role:'AUTHOR'},...extra});
const documentResult=id=>({id,selectedDocumentId:id,titles:{en:'Source title'},roles:['AUTHOR'],files:[],coAuthors:[],answers:id===questionId?[{id:answerId,date:'2026-10-23',files:[]}]:[],selectedText:{status:'available',paragraphs:[id===answerId?'Exact answer body.':id===questionId?'Exact question body.':'Exact document body.'],textLanguage:'en',availableTextLanguages:['en'],notes:[],noteAnchors:[],documentLinks:[]}});
const page=(selectedItems,items=[],complete=false)=>({selectedItems,items,categories:{},categoryGroups:[],categoryCoverage:{},indexedTotal:items.length,cache:{complete}});

async function harness(t,{sourceId=questionId,selected=[],items=[],complete=false,deferred=false,failFirst=false}={}) {
  const window=new Window({url:'http://localhost/?view=saved'}),requests=[],unexpected=[],pending=[],opened=[];
  class ReaderDOMParser extends window.DOMParser {
    parseFromString(...args) {
      const parsed=super.parseFromString(...args),query=parsed.getElementsByTagNameNS.bind(parsed);
      parsed.getElementsByTagNameNS=(namespace,name)=>namespace==='*'?parsed.getElementsByTagName(name):query(namespace,name);
      return parsed;
    }
  }
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:ReaderDOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  window.HTMLElement.prototype.scrollIntoView=function(){};
  let root,loadModule,attempts=0,props={member:'42',sourceId,lang:'en',profileHref:'/?member=42&module=activities&activity='+encodeURIComponent(sourceId),onOpenProfile:()=>opened.push(sourceId)};
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    for(const resolve of pending)resolve(Response.json(page([])));
    if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];
    assert.deepEqual(unexpected,[],'all reads use offline fixtures');
  });
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href);requests.push(url);
    if(url.pathname==='/api/latest-activities/42') {
      if(failFirst&&attempts++===0)return Response.json({error:{code:'temporarily_unavailable',message:'Activity fixture unavailable.'}},{status:503});
      if(deferred)return new Promise(resolve=>pending.push(resolve));
      return Response.json(page(selected,items,complete));
    }
    if(url.pathname.startsWith('/api/document/'))return Response.json(documentResult(url.pathname.split('/').at(-1)));
    if(url.pathname.startsWith('/api/speech-transcript/')) {
      const id=url.pathname.split('/').at(-1);
      return Response.json({id,available:true,xml:'<speech><p>Exact speech body.</p></speech>',textLanguage:'en',translationType:'original',availableTextLanguages:['en'],metadata:{id}});
    }
    if(url.pathname.startsWith('/api/document-context/')) {
      const id=url.pathname.split('/').at(-1);
      return Response.json({documentId:id,requestedLanguage:'en',document:documentResult(id),related:{status:'not-requested',items:[],gaps:[]},amendment:null,target:{status:'not-requested',paragraphs:[]},sources:[]});
    }
    if(url.pathname.startsWith('/api/motion-amendments/')) {
      const id=url.pathname.split('/').at(-1);
      return Response.json({schemaVersion:1,text:{id},scope:{documentId:id,memberId:'42',results:'member',requestedLanguage:'en'},offset:0,limit:20,total:0,items:[],totals:{allIndexed:0,memberMatched:0},relations:{adoptedTexts:[]},coverage:{complete:true,resultState:'records'},snapshots:{amendments:1,text:1},selection:{requestedId:null,status:'not-requested',item:null}});
    }
    unexpected.push(url.href);throw new Error('Unexpected fixture request: '+url.href);
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {FollowingActivityDetail}=await loadModule('/src/App.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=()=>root.render(createElement(FollowingActivityDetail,props));
  await act(async()=>render());
  const flush=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,30)));
  const button=label=>[...container.querySelectorAll('button')].find(node=>node.textContent.trim()===label);
  return {container,requests,opened,window,button,flush,
    update:patch=>act(async()=>{props={...props,...patch};render();}),
    finish:body=>act(async()=>{assert(pending.length);pending.shift()(Response.json(body));}),
    click:label=>act(async()=>{const node=button(label);assert(node,'Missing '+label+'; '+container.textContent);node.click();})};
}

test('inline question uses the exact source-id lookup and the shared question and answer readers',async t=>{
  const h=await harness(t,{selected:[activity('unrelated'),activity(questionId)]});
  assert.match(h.container.textContent,/Exact question body/);assert.match(h.container.textContent,/Exact answer body/);
  const lookup=h.requests[0];assert.equal(lookup.searchParams.get('limit'),'1');assert.equal(lookup.searchParams.get('lang'),'en');assert.equal(lookup.searchParams.get('source-id'),questionId);
  assert(!h.requests.some(url=>url.pathname.endsWith('/unrelated')));
  assert.equal(location.search,'?view=saved');
});

test('inline answer retains the shared linked-question reader',async t=>{
  const h=await harness(t,{sourceId:answerId,selected:[activity(answerId,{recordKind:'answer',relatedQuestionId:questionId})]});
  assert.match(h.container.textContent,/Exact answer body/);assert.match(h.container.textContent,/Linked question/);assert.match(h.container.textContent,/Exact question body/);
});

test('inline speech uses the existing transcript reader',async t=>{
  const sourceId='MTG-PL-2026-10-22-OTH-1';
  const h=await harness(t,{sourceId,selected:[activity(sourceId,{category:'plenary-contributions',recordKind:'speech'})]});
  assert.match(h.container.textContent,/Exact speech body/);
});

test('inline documents retain co-author and download details',async t=>{
  const sourceId='A-10-2026-0001',download='https://example.org/public-report.pdf';
  const h=await harness(t,{sourceId,selected:[activity(sourceId,{category:'reports-rapporteur',files:[{format:'PDF',language:'en',url:download}]})]});
  assert(h.container.querySelector(`a[href="${download}"]`));assert(h.requests.some(url=>url.pathname==='/api/document/'+sourceId));
});

test('an unmatched title or ordinary page item never replaces the exact selected source; profile links preserve modified clicks',async t=>{
  const h=await harness(t,{selected:[activity('different-id')],items:[activity(questionId)]});
  assert.match(h.container.textContent,/Not loaded yet\./);
  assert.doesNotMatch(h.container.textContent,/Exact question body/);
  const link=[...h.container.querySelectorAll('a')].find(node=>node.textContent==='Open in profile');assert(link);
  assert.equal(new URL(link.href).searchParams.get('activity'),questionId);
  for(const modifiers of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]) {
    const event=new h.window.MouseEvent('click',{bubbles:true,cancelable:true,...modifiers});
    await act(async()=>link.dispatchEvent(event));assert.equal(event.defaultPrevented,false);
  }
  assert.deepEqual(h.opened,[]);
  const event=new h.window.MouseEvent('click',{bubbles:true,cancelable:true,button:0});
  await act(async()=>link.dispatchEvent(event));assert(event.defaultPrevented);assert.deepEqual(h.opened,[questionId]);
});

test('loading, complete-index fallback and encoded exact source IDs stay explicit',async t=>{
  const sourceId='exact/id?lang=fr&limit=9';
  const h=await harness(t,{sourceId,deferred:true});
  assert.match(h.container.textContent,/Loading…/);
  assert.equal(h.requests[0].searchParams.get('source-id'),sourceId);assert.equal(h.requests[0].searchParams.get('limit'),'1');
  await h.finish(page([],[],true));
  assert.match(h.container.textContent,/Not in this MEP’s activity\./);
  assert.match(h.container.textContent,/Open in profile/);
});

test('lookup errors expose retry and a real profile link, then recover without losing the source selection',async t=>{
  const h=await harness(t,{selected:[activity(questionId)],failFirst:true});
  assert.match(h.container.querySelector('[role="alert"]').textContent,/Activity fixture unavailable/);
  assert(h.container.querySelector('a[href*="member=42"]'));
  await h.click('Try again');assert.match(h.container.textContent,/Exact question body/);
  assert.equal(h.requests.filter(url=>url.pathname==='/api/latest-activities/42').length,2);
});

test('inline motion controls keep local state across text choices without writing to the page URL',async t=>{
  const joint={sourceId:jointId,reference:jointId,title:'Joint motion',titleLanguage:'en',outcome:{status:'unavailable'}};
  const h=await harness(t,{sourceId:motionId,selected:[activity(motionId,{category:'motions',relatedJointMotions:[joint]})]});
  for(let attempt=0;attempt<200&&h.container.querySelector('p[data-motion-pending="true"]');attempt++)await h.flush();
  const select=h.container.querySelector('select[aria-label="Motion text"]');assert(select);assert.equal(select.value,motionId);
  await act(async()=>{select.value=jointId;select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
  assert.equal(h.container.querySelector('select[aria-label="Motion text"]').value,jointId);
  await h.click('Read motion');assert.match(h.container.textContent,/Exact document body/);
  assert(h.requests.some(url=>url.pathname==='/api/document-context/'+jointId));
  assert.equal(location.search,'?view=saved');assert.equal(history.length,1);
});
