import {proposalContextResponse} from './test-support/proposalContext.mjs';
import {contextOverlayResponse,assertContextOverlay} from './test-support/contextOverlay.mjs';
import {wordingText,wordingViewText} from './test-support/wordingText.mjs';
import test from 'node:test';
import {API_VERSION} from '../server/api-version.mjs';
import assert from 'node:assert/strict';
import {act,createElement,useState} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const documentId='B-10-2026-0441',memberId='101';
const source={url:'https://data.europarl.europa.eu/distribution/example/reader_en.docx',language:'en',fetchedAt:'2026-10-18T12:00:00Z'};
const initialState={open:false,scope:'member',offset:0,amendmentId:null,variantListId:null,view:'amendments',contextView:'document',contextTarget:'text'};
const match=(matched=true)=>({memberId,matched,aggregateMatched:matched,basis:matched?'aggregate':null,variantListIds:[],status:matched?'recorded':'not-recorded'});
const wording=(extra={})=>({language:'en',requestedLanguage:'en',languageFallback:false,originalStatus:'available',proposedStatus:'available',...extra});

function amendment(number=13,extra={}) {
  return {id:`${documentId}-AM-${number}`,number,targetDocumentId:documentId,listId:`${documentId}-AM-001-020`,
    targetLabel:'Paragraph 1',language:'en',requestedLanguage:'en',originalText:'Exact original & <public-text> wording.',
    proposedText:'Exact proposed & <public-text> wording.',textIntegrity:'complete',
    authors:[{name:'Checked member',personId:memberId,status:'resolved'}],memberMatch:match(),wording:wording(),
    sources:[source],wordingSource:source,proposerSource:source,outcome:'unavailable',wholeAmendmentOutcome:'unavailable',
    decisions:[],splitParts:[],...extra};
}
function page({items=[amendment()],document=documentId,scope='member',language='en',offset=0,total=items.length,
  selected=null,requestedId=selected?.id??null,selectionStatus=selected?'available':'not-requested',...extra}={}) {
  return {schemaVersion:2,text:{id:document,reference:document,status:'indexed',kind:document.startsWith('RC-')?'joint':'original',
    title:'A public motion title',titleLanguage:language,date:'2026-10-08',files:[],availableLanguages:[language],preferredFile:null,languageFallback:false,
    authors:[],memberAuthorship:{memberId,status:'not-recorded',relationships:[],sources:[]},sources:[source],generation:1,
    outcome:{status:'unavailable',totalsStatus:'unavailable',evidenceGaps:[]},
    memberPosition:{memberId,status:'unavailable',position:null,reason:'named-member-votes-not-in-motion-sources'}},
    relations:{originalMotions:[],jointMotions:[],adoptedTexts:[],adoptedCoverage:{status:'unavailable',complete:false,gaps:[]},complete:false,limit:5},
    scope:{documentId:document,memberId,results:scope,requestedLanguage:language},items,total,totals:{allIndexed:total,memberMatched:total},offset,limit:20,
    selection:{requestedId,status:selectionStatus,item:selected,inRequestedScope:selected?true:null,inPage:selected?items.some(item=>item.id===selected.id):false},
    coverage:{complete:false,observationComplete:false,indexed:true,indexStatus:'indexed',resultState:items.length?'records':'unavailable',
      backgroundPending:false,backgroundPendingScope:'index',targetProcessing:'unknown',observationScope:'indexed-plenary-amendment-sources',
      emptyObservation:null,gaps:[],lastUpdated:'2026-10-18T12:00:00Z',parserVersion:'fixture',scope:'plenary',servingGeneration:1,workingGeneration:false},
    snapshots:{amendments:1,text:1},...extra};
}

async function readerHarness(t,{state={},props={},focusContextChild=false,realContext=false,members}={}) {
  const window=new Window({url:'http://localhost/'}),requests=[];
  const globals={window,document:window.document,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root,currentState,setState,lastContext,currentProps={documentId,memberId,memberName:'Checked member',language:'en',...props};
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    for(const request of requests)if(!request.done)request.resolve(Response.json({}));
    if(vite)await vite.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  t.mock.method(globalThis,'fetch',input=>new Promise(resolve=>requests.push({url:new URL(input,window.location.href),resolve,done:false})));
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {MotionAmendments}=await vite.ssrLoadModule('/src/MotionAmendments.tsx'),{createRoot}=await import('react-dom/client');
  const DocumentContextReader=realContext?(await vite.ssrLoadModule('/src/DocumentContextReader.tsx')).DocumentContextReader:null;
  const {PersonNamesProvider}=await vite.ssrLoadModule('/src/PersonName.tsx');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  function Host() {
    [currentState,setState]=useState({...initialState,...state});
    return createElement(MotionAmendments,{...currentProps,state:currentState,onStateChange:setState,renderContext:context=>{
      lastContext=context;
      if(realContext)return createElement(DocumentContextReader,{request:context,language:currentProps.language});
      return createElement('div',{'data-test-context':true},`Context ${context.documentId} ${context.amendmentId??''} ${context.listId??''} ${context.view}`,
        createElement('button',{onClick:context.onBack,autoFocus:focusContextChild},'Back from test context'));
    }});
  }
  const draw=()=>root.render(createElement(PersonNamesProvider,{members},createElement(Host)));
  await act(async()=>draw());
  const respond=(data,{request=requests.at(-1),status=200}={})=>act(async()=>{
    assert(request,'The reader must make a request before receiving a response.');request.done=true;request.resolve(Response.json(data,{status}));
  });
  const buttons=()=>[...container.querySelectorAll('button')];
  const button=label=>buttons().find(node=>typeof label==='string'?node.textContent.trim()===label:label.test(node.textContent));
  const click=label=>act(async()=>{const node=button(label);assert(node,`Missing button ${label}; visible text: ${container.textContent}`);node.focus();node.click();});
  const change=(selector,value)=>act(async()=>{const node=container.querySelector(selector);assert(node,`Missing ${selector}`);node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const updateState=patch=>act(async()=>setState(previous=>({...previous,...patch})));
  const updateProps=patch=>act(async()=>{currentProps={...currentProps,...patch};draw();});
  return {container,requests,respond,button,buttons,click,change,updateState,updateProps,state:()=>currentState,context:()=>lastContext};
}

test('the closed reader is lazy, opens the member page in batches of 20, and selects loaded wording without another request',async t=>{
  const h=await readerHarness(t);
  assert.equal(h.requests.length,0);
  await h.click(/^Amendments/);
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].url.pathname,'/api/motion-amendments/'+documentId);
  assert.deepEqual(Object.fromEntries(h.requests[0].url.searchParams),{member:memberId,scope:'member',lang:'en',offset:'0',limit:'20',v:String(API_VERSION)});
  await h.respond(page({items:[amendment(13,{originalText:''}),amendment(14,{originalText:null,wording:wording({originalStatus:'unavailable'})})]}));
  await h.click(/^Amendment 13/);
  assert.equal(h.requests.length,1,'selecting a loaded row is a local action');
  let detail=h.container.querySelector('.motion-amendments__detail');
  assert.deepEqual([...detail.querySelectorAll('.motion-amendments__passage')].map(node=>node.textContent),[' ','Exact proposed & <public-text> wording.']);
  assert.match(wordingViewText(detail),/No original wording supplied\./);
  assert.doesNotMatch(wordingViewText(detail),/Original wording is unavailable/);
  assert.equal(detail.querySelector('public-text'),null,'source wording must be escaped');
  assert.equal(detail.querySelector('.motion-amendments__source a').href,source.url);
  await h.click(/^Amendment 14/);
  detail=h.container.querySelector('.motion-amendments__detail');
  assert.match(wordingViewText(detail),/Original wording is unavailable\./);
  assert.doesNotMatch(wordingViewText(detail),/No original wording\./);
  assert.equal(h.requests.length,1);
});

function variant(listId,extra={}) {
  return {listId,language:'en',targetLabel:'Paragraph 1',originalText:'Variant original',proposedText:'Variant proposed',
    authors:[{name:'Checked variant proposer',personId:memberId,status:'resolved'}],wording:wording(),memberMatch:match(),sources:[source],wordingSource:source,...extra};
}

test('context uses the exact motion, amendment and chosen list, and Back retains the page, scope and version',async t=>{
  const listA=`${documentId}-AM-001-020`,listB=`${documentId}-AM-013-014`;
  const h=await readerHarness(t,{state:{open:true,scope:'all',offset:20}});
  const item=amendment(13,{variants:[variant(listA),variant(listB)]});
  const result=page({items:[item],scope:'all',offset:20,total:45});
  result.relations.adoptedTexts=[{id:'TA-10-2026-0339'}];
  await h.respond(result);await h.click(/^Amendment 13/);
  await h.change('.motion-amendments__version select',listB);
  await h.click('Read in context');
  const region=h.container.querySelector('[role="region"][aria-label="Amendment in context"]');
  assert(region,'amendment context has a named region');
  assert.equal(region.tabIndex,-1);
  assert(region.contains(document.activeElement),'focus follows the removed detail action into its named context');
  assert.deepEqual({documentId:h.context().documentId,amendmentId:h.context().amendmentId,listId:h.context().listId,view:h.context().view},
    {documentId,amendmentId:item.id,listId:listB,view:'document'});
  assert.equal(h.requests.length,1);
  await h.click('Back from test context');
  assert.deepEqual(h.state(),{...initialState,open:true,scope:'all',offset:20,amendmentId:item.id,variantListId:listB,contextTarget:'amendment',wordingLanguage:'en'});
  assert.equal(document.activeElement,h.button('Read in context'));
  assert.equal(h.container.querySelector('.motion-amendments__version select').value,listB);
  assert.match(h.container.querySelector('.motion-amendments__pages').textContent,/21–21 of 45/);
  await h.click('Read adopted text');
  assert.deepEqual({documentId:h.context().documentId,amendmentId:h.context().amendmentId,listId:h.context().listId,view:h.context().view},
    {documentId,amendmentId:undefined,listId:undefined,view:'adopted'},'the downstream reader resolves an observed adopted relation from the same B/RC target');
  assert.equal(h.requests.length,1);
});

test('context entry preserves focus already placed on a child by the parent reader',async t=>{
  const h=await readerHarness(t,{state:{open:true},focusContextChild:true});
  await h.respond(page());await h.click(/^Amendment 13/);await h.click('Read in context');
  assert.equal(document.activeElement,h.button('Back from test context'));
  assert(h.container.querySelector('[role="region"][aria-label="Amendment in context"]').contains(document.activeElement));
  await h.click('Back from test context');
  assert.equal(document.activeElement,h.button('Read in context'));
});

test('pending and unavailable amendment context keep focus in the same named region',async t=>{
  const requestedId=`${documentId}-AM-99`;
  const h=await readerHarness(t,{state:{open:true,amendmentId:requestedId}}),base=page();
  await h.respond(base);
  await h.updateState({view:'context',contextTarget:'amendment'});
  const region=h.container.querySelector('[role="region"][aria-label="Amendment in context"]');
  assert(region,'pending context has a named region');
  assert.match(region.textContent,/Loading amendment information/);
  assert.equal(document.activeElement,region);
  await h.respond({...base,selection:{requestedId,status:'unavailable',item:null,inRequestedScope:null,inPage:false}});
  assert.equal(h.container.querySelector('[role="region"][aria-label="Amendment in context"]'),region);
  assert.match(region.textContent,/The requested context is unavailable/);
  assert.equal(document.activeElement,region);
});

test('whole-text context ignores a missing amendment or wording version and Back preserves the selected identity',async t=>{
  const requestedId=`${documentId}-AM-99`,missingList=`${documentId}-AM-900-901`;
  const h=await readerHarness(t,{state:{open:true,scope:'all',offset:20,amendmentId:requestedId,variantListId:missingList}});
  const base=page({scope:'all',offset:20,total:45});await h.respond(base);
  await h.respond({...base,selection:{requestedId,status:'unavailable',item:null,inRequestedScope:null,inPage:false}});
  assert.match(h.container.textContent,/Amendment unavailable\./);
  await h.click('Read motion');
  assert.deepEqual({documentId:h.context().documentId,amendmentId:h.context().amendmentId,listId:h.context().listId,view:h.context().view},
    {documentId,amendmentId:undefined,listId:undefined,view:'document'});
  assert.equal(h.state().contextTarget,'text');
  await h.click('Back from test context');
  assert.equal(h.state().amendmentId,requestedId);assert.equal(h.state().variantListId,missingList);
  assert.equal(document.activeElement,h.button('Read motion'));
  assert.equal(h.state().scope,'all');assert.equal(h.state().offset,20);
  await h.updateState({amendmentId:base.items[0].id});
  assert.match(h.container.querySelector('.motion-amendments__detail').textContent,/That version is no longer available\./);
  assert.equal(h.button('Read in context').disabled,true);
  await h.click('Find the adopted text');
  assert.deepEqual({documentId:h.context().documentId,amendmentId:h.context().amendmentId,listId:h.context().listId,view:h.context().view},
    {documentId,amendmentId:undefined,listId:undefined,view:'adopted'});
  await h.click('Back from test context');
  assert.equal(h.state().amendmentId,base.items[0].id);assert.equal(h.state().variantListId,missingList);
  assert.equal(h.state().scope,'all');assert.equal(h.state().offset,20);
  assert.equal(h.requests.length,2,'whole-text navigation does not need another amendment selection read');
});

test('a closed reader can open the exact whole motion without an amendment response or a selected-wording fallback',async t=>{
  const h=await readerHarness(t,{state:{amendmentId:`${documentId}-AM-99`,variantListId:`${documentId}-AM-900-901`}});
  assert.equal(h.requests.length,0);
  await h.click('Read motion');
  assert.equal(h.state().contextTarget,'text');
  assert.deepEqual({documentId:h.context().documentId,amendmentId:h.context().amendmentId,listId:h.context().listId,view:h.context().view},
    {documentId,amendmentId:undefined,listId:undefined,view:'document'});
  assert.equal(h.container.querySelector('.motion-amendments__detail'),null);
  await h.click('Back from test context');
  assert.equal(h.state().amendmentId,`${documentId}-AM-99`);
  assert.equal(h.state().variantListId,`${documentId}-AM-900-901`);
});

test('invalid linked amendments preserve exact whole-text access and require explicit selection clearing',async t=>{
  const cases=[
    {label:'wrong-motion B amendment',target:documentId,requestedId:'B-10-2026-0442-AM-13'},
    {label:'malformed amendment on an RC motion',target:'RC-10-2026-0441',requestedId:'malformed amendment identifier'},
  ];
  for(const {label,target,requestedId} of cases)await t.test(label,async t=>{
    const listId=`${target}-AM-900-901`;
    const h=await readerHarness(t,{props:{documentId:target},state:{open:true,scope:'all',offset:20,amendmentId:requestedId,variantListId:listId}});
    assert.equal(h.requests.length,0,'an invalid linked amendment must not be fetched or replaced');
    assert.match(h.container.textContent,/The linked amendment is unavailable for this motion\./);
    assert.equal(h.container.querySelector('.motion-amendments__row'),null);
    assert.equal(h.button('Read motion').disabled,false);
    assert.equal(h.button('Find the adopted text').disabled,false);
    for(const [action,view] of [['Read motion','document'],['Find the adopted text','adopted']]) {
      await h.click(action);
      assert.deepEqual({documentId:h.context().documentId,amendmentId:h.context().amendmentId,listId:h.context().listId,view:h.context().view},
        {documentId:target,amendmentId:undefined,listId:undefined,view});
      assert.equal(h.requests.length,0);
      await h.click('Back from test context');
      assert.equal(document.activeElement,h.button(action));
      assert.equal(h.state().amendmentId,requestedId);assert.equal(h.state().variantListId,listId);
      assert.equal(h.state().scope,'all');assert.equal(h.state().offset,20);
      assert.match(h.container.textContent,/The linked amendment is unavailable for this motion\./);
      assert.equal(h.requests.length,0,'Back must retain the invalid selection without an automatic fallback');
    }
    await h.click('Clear selection');
    assert.equal(document.activeElement,h.container.querySelector('h3'));
    assert.equal(document.activeElement.textContent,'Proposed changes');
    assert.equal(h.state().amendmentId,null);assert.equal(h.state().variantListId,null);
    assert.equal(h.state().scope,'all');assert.equal(h.state().offset,20);
    assert.equal(h.requests.length,1);
    assert.equal(h.requests[0].url.pathname,'/api/motion-amendments/'+target);
    assert.deepEqual(Object.fromEntries(h.requests[0].url.searchParams),{member:memberId,scope:'all',lang:'en',offset:'20',limit:'20',v:String(API_VERSION)});
    const item=amendment(13,{id:`${target}-AM-13`,targetDocumentId:target,listId:`${target}-AM-001-020`});
    await h.respond(page({document:target,scope:'all',offset:20,total:45,items:[item]}));
    assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,1);
    assert.doesNotMatch(h.container.textContent,/The linked amendment is unavailable/);
    assert.equal(h.requests.length,1);
  });
});

test('an exact off-page selection is fetched separately and does not change member filtering, totals or its retained wording version',async t=>{
  const requestedId=`${documentId}-AM-020`,canonicalId=`${documentId}-AM-20`,listId=`${documentId}-AM-020-021`;
  const h=await readerHarness(t,{state:{open:true,amendmentId:requestedId,variantListId:listId}});
  const base=page({items:[amendment()],total:1,totals:{allIndexed:5,memberMatched:1}});
  await h.respond(base);
  assert.equal(h.requests.length,2);
  assert.equal(h.requests[0].url.searchParams.has('amendment'),false);
  assert.equal(h.requests[1].url.searchParams.get('amendment'),requestedId);
  const selected=amendment(20,{id:canonicalId,officialIds:[requestedId],memberMatch:match(false),
    variants:[variant(`${documentId}-AM-001-020`,{memberMatch:match(false)}),variant(listId,{proposedText:'The exact off-page wording',memberMatch:match(false)})]});
  await h.respond({...base,selection:{requestedId,status:'available',item:selected,inRequestedScope:false,inPage:false}});
  assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,1);
  assert.match(h.container.querySelector('.motion-amendments__outside').textContent,/outside this filter/);
  assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/The exact off-page wording/);
  assert.deepEqual([...h.container.querySelectorAll('.motion-amendments__scope button')].map(node=>node.textContent),['Checked member’s proposals · 1','All available amendments · 5']);
  assert.match(h.container.querySelector('.motion-amendments__pages').textContent,/1–1 of 1/);
  assert.equal(h.container.querySelector('.motion-amendments__version select').value,listId);
  await h.click('Read in context');
  assert.equal(h.context().amendmentId,canonicalId);assert.equal(h.context().listId,listId);
  await h.click('Back from test context');
  assert.equal(h.state().amendmentId,requestedId);assert.equal(h.state().scope,'member');assert.equal(h.state().variantListId,listId);
  assert.equal(h.requests.length,2);
});

test('missing amendment identity and unavailable wording versions stay explicit without choosing another proposal',async t=>{
  const requestedId=`${documentId}-AM-99`,h=await readerHarness(t,{state:{open:true,amendmentId:requestedId}});
  const base=page();await h.respond(base);
  await h.respond({...base,selection:{requestedId,status:'unavailable',item:null,inRequestedScope:null,inPage:false}});
  assert.match(h.container.textContent,/Amendment unavailable\./);
  assert.equal(h.container.querySelector('.motion-amendments__detail'),null);
  assert.equal(h.container.querySelector('.motion-amendments__row-button').getAttribute('aria-expanded'),'false');
  await h.updateState({amendmentId:base.items[0].id,variantListId:`${documentId}-AM-900-901`});
  assert.match(h.container.querySelector('.motion-amendments__detail').textContent,/That version is no longer available\./);
  assert.equal(h.container.querySelector('.motion-amendments__passage'),null);
  assert.equal(h.button('Read in context').disabled,true);
  assert.equal(h.requests.length,2);
});

test('an exact-selection response for a different amendment cannot substitute its wording',async t=>{
  const requestedId=`${documentId}-AM-99`,h=await readerHarness(t,{state:{open:true,amendmentId:requestedId}});
  const base=page();await h.respond(base);
  await h.respond({...base,selection:{requestedId,status:'available',item:amendment(20,{proposedText:'Unrelated selected wording'}),inRequestedScope:true,inPage:false}});
  assert.equal(h.container.querySelector('.motion-amendments__detail'),null);
  assert.doesNotMatch(wordingViewText(h.container),/Unrelated selected wording/);
  assert.match(h.container.textContent,/selected amendment could not be loaded/i);
});

test('scope, language and target changes immediately clear old wording and reject responses for another request',async t=>{
  const h=await readerHarness(t,{state:{open:true}});
  await h.respond(page());await h.click(/^Amendment 13/);
  assert.match(wordingViewText(h.container),/Exact proposed/);
  await h.click(/^All available amendments/);
  assert.equal(h.container.querySelector('.motion-amendments__detail'),null);
  await h.respond(page({scope:'all',items:[amendment(13,{proposedText:'All-scope wording'})]}));
  assert.match(wordingViewText(h.container),/All-scope wording/);
  await h.updateProps({language:'fr'});
  assert.equal(h.container.querySelector('.motion-amendments__passage'),null);
  assert.equal(h.requests.at(-1).url.searchParams.get('lang'),'fr');
  await h.respond(page({scope:'all',items:[amendment(13,{proposedText:'Wrong language payload'})]}));
  assert.doesNotMatch(wordingViewText(h.container),/Wrong language payload|All-scope wording/);
  assert.match(h.container.textContent,/Amendment information could not be loaded/);
  await h.click('Try again');
  await h.respond(page({scope:'all',language:'fr',items:[amendment(13,{proposedText:'Libellé français',wording:wording({language:'fr',requestedLanguage:'fr'})})]}));
  assert.match(h.container.textContent,/Libellé français/);
  const newTarget='RC-10-2026-0441';await h.updateProps({documentId:newTarget});
  assert.equal(h.container.querySelector('.motion-amendments__passage'),null);
  assert.match(h.container.textContent,/The linked amendment is unavailable for this motion/);
  assert.notEqual(h.requests.at(-1).url.pathname,'/api/motion-amendments/'+newTarget,'a selected B amendment cannot become an RC selection');
  await h.updateState({amendmentId:null,variantListId:null});
  assert.equal(h.requests.at(-1).url.pathname,'/api/motion-amendments/'+newTarget);
  await h.respond(page({scope:'all',language:'fr',items:[amendment(13,{proposedText:'Wrong target payload',wording:wording({language:'fr',requestedLanguage:'fr'})})]}));
  assert.doesNotMatch(h.container.textContent,/Wrong target payload|Libellé français/);
  assert.match(h.container.textContent,/Amendment information could not be loaded/);
});

test('a failed read can be retried, and invalid target or payload version never falls back to existing records',async t=>{
  const h=await readerHarness(t,{state:{open:true}});
  await h.respond({error:{message:'Temporary public source failure'}},{status:503});
  assert.match(h.container.textContent,/Amendment information could not be loaded/);
  await h.click('Try again');assert.equal(h.requests.length,2);
  await h.respond({...page(),schemaVersion:3});
  assert.equal(h.container.querySelector('.motion-amendments__row'),null);
  await h.click('Try again');await h.respond(page());
  assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,1);
  await h.updateProps({documentId:'TA-10-2026-0339'});
  assert.match(h.container.textContent,/This motion reader selection is unavailable/);
  assert.equal(h.button('Read motion').disabled,true);
  assert.equal(h.button('Find the adopted text').disabled,true);
  assert.equal(h.container.querySelector('.motion-amendments__row'),null);
  assert.equal(h.requests.length,3,'invalid motion identity must not open another route');
});

test('a late response from an obsolete language request cannot overwrite the current wording',async t=>{
  const h=await readerHarness(t,{state:{open:true}}),english=h.requests[0];
  await h.updateProps({language:'fr'});const french=h.requests[1];
  await h.respond(page({language:'fr',items:[amendment(13,{proposedText:'Libellé actuel',wording:wording({language:'fr',requestedLanguage:'fr'})})]}),{request:french});
  await h.click(/^Amendment 13/);
  assert.match(h.container.querySelector('.motion-amendments__detail').textContent,/Libellé actuel/);
  await h.respond(page({items:[amendment(13,{proposedText:'Obsolete English wording'})]}),{request:english});
  assert.match(h.container.querySelector('.motion-amendments__detail').textContent,/Libellé actuel/);
  assert.doesNotMatch(wordingViewText(h.container),/Obsolete English wording/);
  assert.equal(h.requests.length,2);
});

test('conflicting source versions require a choice and only checked variant proposers receive the member label',async t=>{
  const listA=`${documentId}-AM-001-020`,listB=`${documentId}-AM-013-014`;
  const item=amendment(13,{conflicted:true,authors:[{name:'Aggregate-only author',personId:memberId}],memberMatch:match(),
    variants:[variant(listA,{authors:[{name:'Another checked proposer',personId:'102'}],memberMatch:match(false),proposedText:'First variant wording',justification:'First published reason.'}),
      variant(listB,{authors:[{name:'Checked variant proposer',personId:memberId}],memberMatch:match(),proposedText:'Second variant wording',justification:'Second published reason.'})]});
  const h=await readerHarness(t,{state:{open:true,scope:'all'}});await h.respond(page({scope:'all',items:[item]}));
  await h.click(/^Amendment 13/);
  let detail=h.container.querySelector('.motion-amendments__detail');
  assert.match(wordingViewText(detail),/Choose a wording version/);
  assert.equal(detail.querySelector('.motion-amendments__passage'),null);
  assert.equal(detail.querySelector('.amendment-justification'),null);
  assert.equal(h.button('Read in context').disabled,true);
  assert.doesNotMatch(detail.textContent,/Aggregate-only author/);
  await h.change('.motion-amendments__version select',listA);detail=h.container.querySelector('.motion-amendments__detail');
  assert.match(wordingViewText(detail),/First variant wording/);assert.match(wordingViewText(detail),/Another checked proposer/);
  assert.equal(detail.querySelector('.amendment-justification p').textContent,'First published reason.');
  assert.equal(detail.querySelector('.motion-amendments__member-tag'),null);
  assert.doesNotMatch(wordingViewText(detail),/Aggregate-only author|Checked variant proposer|Second variant wording/);
  await h.change('.motion-amendments__version select',listB);detail=h.container.querySelector('.motion-amendments__detail');
  assert.match(wordingViewText(detail),/Second variant wording/);
  assert.equal(detail.querySelector('.amendment-justification p').textContent,'Second published reason.');assert.match(wordingViewText(detail),/Checked variant proposer/);
  assert.equal(detail.querySelector('.motion-amendments__member-tag').textContent,'Selected MEP’s proposal');
  assert.doesNotMatch(detail.textContent,/Aggregate-only author|Another checked proposer/);
  assert.equal(h.requests.length,1);
});

test('all-scope row highlights distinguish aggregate authorship from one or multiple checked wording versions',async t=>{
  const listA=`${documentId}-AM-001-020`,listB=`${documentId}-AM-013-014`,listC=`${documentId}-AM-015-016`;
  const aggregate=amendment(13,{memberMatch:match(),variants:[variant(listA,{memberMatch:match(false)})]});
  const oneVersion=amendment(14,{memberMatch:match(false),variants:[variant(listA,{memberMatch:match(false)}),variant(listB,{memberMatch:match()})]});
  const multipleVersions=amendment(15,{memberMatch:match(false),variants:[variant(listA,{proposedText:'First checked version'}),
    variant(listB,{proposedText:'Second checked version'}),variant(listC,{memberMatch:match(false),authors:[{name:'Checked member',personId:'999'}],proposedText:'Unmatched chosen version'})]});
  const unrelated=amendment(16,{memberMatch:match(false),variants:[variant(listA,{memberMatch:match(false),authors:[{name:'Checked member',personId:'999'}]})]});
  const h=await readerHarness(t,{state:{open:true,scope:'all'}});
  await h.respond(page({scope:'all',items:[aggregate,oneVersion,multipleVersions,unrelated],totals:{allIndexed:4,memberMatched:3}}));
  const rows=[...h.container.querySelectorAll('.motion-amendments__row')];
  assert.equal(rows[0].querySelector('.motion-amendments__member-tag').textContent,'Selected MEP’s proposal');
  assert.equal(rows[1].querySelector('.motion-amendments__member-tag').textContent,'Selected MEP’s proposal in one version');
  assert.equal(rows[2].querySelector('.motion-amendments__member-tag').textContent,'Selected MEP’s proposal in multiple versions');
  assert.equal(rows[3].querySelector('.motion-amendments__member-tag'),null,'same display name does not establish authorship');
  assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,4,'all scope retains other authors');
  await h.click(/^Amendment 15/);await h.change('.motion-amendments__version select',listA);
  let detail=h.container.querySelector('.motion-amendments__detail');
  assert.match(detail.textContent,/First checked version/);
  assert.equal(detail.querySelector('.motion-amendments__member-tag').textContent,'Selected MEP’s proposal');
  await h.change('.motion-amendments__version select',listC);detail=h.container.querySelector('.motion-amendments__detail');
  assert.match(detail.textContent,/Unmatched chosen version/);
  assert.equal(detail.querySelector('.motion-amendments__member-tag'),null,'the row count cannot attribute an unmatched chosen version');
  assert.equal(rows[2].querySelector('.motion-amendments__row-button .motion-amendments__member-tag').textContent,'Selected MEP’s proposal in multiple versions');
});

test('amendment context requires an exact source-list identity while whole-motion context remains available',async t=>{
  const h=await readerHarness(t,{state:{open:true}});
  await h.respond(page({items:[amendment(13,{listId:null})]}));await h.click(/^Amendment 13/);
  assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Exact proposed/);
  assert.equal(h.button('Read in context').disabled,true,'unidentified wording cannot pin a context version');
  await h.click('Read motion');
  assert.deepEqual({documentId:h.context().documentId,amendmentId:h.context().amendmentId,listId:h.context().listId,view:h.context().view},
    {documentId,amendmentId:undefined,listId:undefined,view:'document'});
});

test('legacy aggregate outcomes and split descriptions do not become whole-amendment adoption or validated wording',async t=>{
  const item=amendment(13,{outcome:'ADOPTED',wholeAmendmentOutcome:'unavailable',
    decisions:[{id:'decision-1',scope:'split-part',partId:'part-1',partNumber:1,outcome:'REJECTED',provenance:'exact',componentBinding:'single-amendment'},
      {id:'decision-2',scope:'split-part',partId:'part-2',partNumber:2,outcome:'LAPSED',provenance:'exact',componentBinding:'single-amendment'}],
    splitParts:[{id:'part-1',number:1,description:'Published location description only',language:'en',wordingGrounding:'not-validated'},
      {id:'part-2',number:2,description:'Second published location only',language:'en',wordingGrounding:'not-validated'}]});
  const h=await readerHarness(t,{state:{open:true}});await h.respond(page({items:[item]}));await h.click(/^Amendment 13/);
  assert.equal(h.container.querySelector('.motion-amendments__row-button .motion-amendments__outcome').textContent,'Voted in parts');
  const detail=h.container.querySelector('.motion-amendments__detail'),decisions=detail.querySelector('.motion-amendments__decisions');
  assert(detail.querySelector('ins'));assert(detail.querySelector('del'));
  await h.click('Side by side');assert.equal(detail.querySelectorAll('.wording-diff__columns section').length,2);
  await h.click('Changes');assert.equal(h.button('Changes').getAttribute('aria-pressed'),'true');
  assert.match(decisions.textContent,/Whole amendmentVoted in parts/);
  assert.deepEqual([...decisions.querySelectorAll('.motion-amendments__decision')].map(row=>[row.querySelector('strong').textContent,row.querySelector('.motion-amendments__outcome').textContent]),[['Part 1','Rejected'],['Part 2','Lapsed']]);
  assert.doesNotMatch(decisions.textContent,/Adopted|Vote records disagree/);
  assert.deepEqual(['original','proposed'].map(side=>wordingText(detail,side)),[item.originalText,item.proposedText]);
  assert.match(decisions.textContent,/Published split description\./);
  assert.equal(detail.querySelector('.motion-amendments__split-description').closest('.motion-amendments__wording'),null);
  assert.doesNotMatch(detail.textContent,/member voted|MEP voted|secured adoption|caused.*adopt|supported.*adopt/i);
});

test('empty and withheld motion wording retain per-side source status without claiming insertion or deletion',async t=>{
  const items=[amendment(13,{originalText:'',proposedText:''}),
    amendment(14,{originalText:'Withheld old wording',proposedText:'Withheld new wording',wording:wording({originalStatus:'withheld',proposedStatus:'withheld'})}),
    amendment(15,{proposedText:''})];
  const h=await readerHarness(t,{state:{open:true}});await h.respond(page({items}));
  for(const number of [13,14,15]) {
    await h.click(new RegExp('^Amendment '+number));
    const detail=h.container.querySelector('.motion-amendments__detail');
    assert.equal(detail.querySelector('.wording-diff,ins,del'),null);
    if(number===14){assert.match(detail.textContent,/This wording could not be read reliably/);assert.doesNotMatch(detail.textContent,/Withheld old|Withheld new/);}
    else assert.match(detail.textContent,/No proposed wording supplied\./);
    assert.doesNotMatch(detail.textContent,/Text deleted|No original text \(insertion\)/);
  }
});

test('missing English document distribution does not hide available English amendment wording',async t=>{
  const h=await readerHarness(t,{state:{open:true}}),result=page();
  result.text.availableLanguages=['fr'];result.text.files=[{url:source.url.replace('_en','_fr'),language:'fr',format:'docx'}];
  result.text.languageFallback=true;
  await h.respond(result);await h.click(/^Amendment 13/);
  const passages=[...h.container.querySelectorAll('.wording-diff__passage')];
  assert.deepEqual(['original','proposed'].map(side=>wordingText(h.container,side)),[result.items[0].originalText,result.items[0].proposedText]);
  assert(passages.every(node=>node.lang==='en'));
  assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Wording language: EN/);
  assert.doesNotMatch(h.container.querySelector('.motion-amendments__detail').textContent,/English.*unavailable|Showing FR/);
});

test('not indexed, observed empty and no member matches remain distinct, and global background work never claims target processing',async t=>{
  const h=await readerHarness(t,{state:{open:true}}),base=page({items:[],total:0});
  const empty=state=>({...base,coverage:{...base.coverage,resultState:state,indexed:state!=='not-indexed',indexStatus:state==='not-indexed'?'not-indexed':'indexed',
    observationComplete:state==='observed-empty',backgroundPending:true,workingGeneration:true}});
  await h.respond(empty('not-indexed'));
  assert.match(h.container.textContent,/Amendment information is unavailable for this motion/);
  assert.doesNotMatch(h.container.querySelector('.motion-amendments__disclosure').textContent,/0|available/);
  assert([...h.container.querySelectorAll('.motion-amendments__scope button')].every(button=>!button.textContent.includes('· 0')));
  assert.doesNotMatch(h.container.textContent,/No published amendment lists|No matching proposals|processing|indexing|background work/i);
  assert.equal(h.requests.length,1);
  await h.updateProps({language:'fr'});const observed=empty('observed-empty');observed.scope.requestedLanguage='fr';await h.respond(observed);
  assert.match(h.container.textContent,/No published amendment lists are recorded for this motion\./);
  assert.doesNotMatch(h.container.textContent,/Amendment information is unavailable|No matching proposals|processing|indexing|background work/i);
  await h.updateProps({language:'de'});const none=empty('no-indexed-member-matches');none.scope.requestedLanguage='de';none.totals={allIndexed:3,memberMatched:0};await h.respond(none);
  assert.match(h.container.textContent,/No matches in available amendments/,'incomplete coverage keeps the empty result scoped');
  assert.doesNotMatch(h.container.querySelector('.motion-amendments__scope button').textContent,/· 0/);
  assert.doesNotMatch(h.container.textContent,/No published amendment lists|Amendment information is unavailable|processing|indexing|background work/i);
  assert.equal(h.requests.length,3,'backgroundPending does not start a polling loop');
});

test('a later exact-selection snapshot replaces its page and counts together instead of mixing index generations',async t=>{
  const chosen=amendment(31,{proposedText:'Newly indexed exact proposal'});
  const h=await readerHarness(t,{state:{open:true,scope:'all',amendmentId:chosen.id}});
  await h.respond(page({scope:'all',items:[amendment(13,{targetLabel:'Earlier provision'}),amendment(15)],total:2}));
  assert.equal(h.requests.length,2);
  assert.match(h.container.textContent,/Earlier provision/);
  const later=page({scope:'all',items:[amendment(13,{targetLabel:'Updated provision'}),amendment(15),chosen],total:3,selected:chosen});
  later.snapshots={amendments:2,text:2};
  await h.respond(later);
  assert.doesNotMatch(h.container.textContent,/Earlier provision/);
  assert.match(h.container.textContent,/Updated provision/);
  assert.match(h.container.textContent,/Newly indexed exact proposal/);
  assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,3);
  assert.match(h.container.querySelector('.motion-amendments__disclosure').textContent,/3 available/);
  assert.equal(h.container.querySelector('.motion-amendments__selected'),null);
  assert.equal(h.requests.length,2);
});

test('row switches retain the newest exact-response page, wording and counts without another request',async t=>{
  for(const firstNumber of [13,15])await t.test(`first select displayed amendment ${firstNumber}`,async t=>{
    const offPage=amendment(31,{proposedText:'Generation two off-page wording'});
    const h=await readerHarness(t,{state:{open:true,scope:'all',amendmentId:offPage.id}});
    await h.respond(page({scope:'all',items:[amendment(13,{proposedText:'Generation one obsolete wording'})],total:1}));
    assert.equal(h.requests.length,2);
    const updated=page({scope:'all',items:[
      amendment(13,{proposedText:'Generation two amendment 13 wording'}),
      amendment(15,{proposedText:'Generation two amendment 15 wording'}),
    ],total:4,selected:offPage});
    updated.text.generation=2;updated.coverage.servingGeneration=2;updated.snapshots={amendments:2,text:2};
    await h.respond(updated);
    assert.match(wordingViewText(h.container.querySelector('.motion-amendments__selected')),/Generation two off-page wording/);
    assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,2);
    for(const number of [firstNumber,firstNumber===13?15:13,firstNumber,firstNumber===13?15:13]) {
      await h.click(new RegExp(`^Amendment ${number}`));
      assert.equal(h.requests.length,2,'every displayed primary-ID row belongs to the retained generation and stays local');
      assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,2,'a local switch must not restore the earlier page');
      assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),new RegExp(`Generation two amendment ${number} wording`));
      assert.doesNotMatch(wordingViewText(h.container),/Generation one obsolete wording/);
      assert.match(h.container.querySelector('.motion-amendments__disclosure').textContent,/4 available/);
      assert.deepEqual([...h.container.querySelectorAll('.motion-amendments__scope button')].map(node=>node.textContent),
        ['Checked member’s proposals · 4','All available amendments · 4']);
      assert.match(h.container.querySelector('.motion-amendments__pages').textContent,/1–2 of 4/);
      assert.equal(h.container.querySelector('.motion-amendments__selected'),null);
    }
  });
});

test('failed and older exact reads preserve the accepted newer page until a coherent selection retry succeeds',async t=>{
  const first=amendment(31,{proposedText:'Accepted generation two first selection'}),nextId=`${documentId}-AM-32`;
  const h=await readerHarness(t,{state:{open:true,scope:'all',amendmentId:first.id}});
  const oldPage=page({scope:'all',items:[amendment(13,{targetLabel:'Obsolete generation one provision',proposedText:'Obsolete generation one wording'})],total:1});
  await h.respond(oldPage);
  const newItems=[amendment(13,{targetLabel:'Current generation two provision',proposedText:'Current generation two wording'}),amendment(15)];
  const latest=(selected)=>{
    const result=page({scope:'all',items:newItems,total:4,selected});
    result.text.generation=2;result.coverage.servingGeneration=2;result.snapshots={amendments:2,text:2};
    return result;
  };
  await h.respond(latest(first));
  const assertNewerPage=()=>{
    assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,2);
    assert.match(h.container.textContent,/Current generation two provision/);
    assert.doesNotMatch(h.container.textContent,/Obsolete generation one/);
    assert.match(h.container.querySelector('.motion-amendments__disclosure').textContent,/4 available/);
    assert.match(h.container.querySelector('.motion-amendments__pages').textContent,/1–2 of 4/);
  };
  assertNewerPage();
  await h.updateState({amendmentId:nextId});
  assert.equal(h.requests.at(-1).url.searchParams.get('amendment'),nextId);
  await h.respond({error:{message:'Temporary exact-read failure'}},{status:503});
  assertNewerPage();
  assert.match(h.container.textContent,/The selected amendment could not be loaded\./);
  assert.equal(h.container.querySelector('.motion-amendments__detail'),null,'a failed new selection must not keep the earlier selected wording');
  await h.click('Try again');
  const staleSelected=amendment(32,{proposedText:'Obsolete generation one selected wording'});
  await h.respond({...oldPage,selection:{requestedId:nextId,status:'available',item:staleSelected,inRequestedScope:true,inPage:false}});
  assertNewerPage();
  assert.match(h.container.textContent,/The selected amendment could not be loaded\./);
  assert.equal(h.container.querySelector('.motion-amendments__detail'),null,'an older exact response must not contribute selected wording to the newer page');
  await h.click('Try again');
  await h.respond(latest(amendment(32,{proposedText:'Current generation two selected wording'})));
  assertNewerPage();
  assert.match(wordingViewText(h.container.querySelector('.motion-amendments__selected')),/Current generation two selected wording/);
  assert.doesNotMatch(h.container.textContent,/The selected amendment could not be loaded/);
  assert.equal(h.requests.length,5);
  await h.click(/^Amendment 13/);
  assertNewerPage();
  assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Current generation two wording/);
  assert.equal(h.requests.length,5,'the successful retry leaves its displayed primary rows selectable locally');
});

test('an earlier list refresh cannot overwrite a later exact response from the same working generation',async t=>{
  for(const completionOrder of ['exact first','list first'])await t.test(completionOrder,async t=>{
    const old=page({scope:'all',items:[amendment(13,{targetLabel:'Earlier list provision',proposedText:'Earlier list wording'}),amendment(15)],total:2});
    old.coverage.workingGeneration=true;
    const current=page({scope:'all',items:[amendment(13,{targetLabel:'Current exact provision',proposedText:'Current exact page wording'}),amendment(15),amendment(18)],total:3});
    current.coverage.workingGeneration=true;
    const selected=amendment(31,{proposedText:'Current off-page selection wording'});
    const h=await readerHarness(t,{state:{open:true,scope:'all'}});
    await h.respond(old);
    await h.click(/^Amendments/);await h.click(/^Amendments/);
    const pendingList=h.requests.at(-1);
    assert.equal(pendingList.url.searchParams.has('amendment'),false);
    assert.equal(pendingList.done,false,'the earlier list refresh remains pending');
    await h.updateState({amendmentId:selected.id});
    const pendingExact=h.requests.at(-1);
    assert.equal(pendingExact.url.searchParams.get('amendment'),selected.id);
    if(completionOrder==='list first')await h.respond(old,{request:pendingList});
    await h.respond({...current,selection:{requestedId:selected.id,status:'available',item:selected,inRequestedScope:true,inPage:false}},{request:pendingExact});
    assert.match(h.container.querySelector('.motion-amendments__disclosure').textContent,/3 available/);
    if(completionOrder==='exact first')await h.respond(old,{request:pendingList});
    assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,3,'request completion order must not roll the page back');
    assert.match(h.container.querySelector('.motion-amendments__disclosure').textContent,/3 available/);
    assert.match(h.container.textContent,/Current exact provision/);
    assert.doesNotMatch(wordingViewText(h.container),/Earlier list provision|Earlier list wording/);
    assert.match(wordingViewText(h.container.querySelector('.motion-amendments__selected')),/Current off-page selection wording/);
    await h.click('Read in context');
    assert.equal(h.context().amendmentId,selected.id);assert.equal(h.context().listId,selected.listId);
    await h.click('Back from test context');
    await h.click(/^Amendment 13/);
    assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Current exact page wording/);
    assert.equal(h.requests.length,3,'the retained primary row is still a local selection');
  });
});

test('failed exact revalidation hides earlier detail and context while preserving its page until a successful retry',async t=>{
  for(const navigation of ['alias through primary','off-page disclosure'])await t.test(navigation,async t=>{
    const aliasId=`${documentId}-AM-013`,primary=amendment(13,{officialIds:[aliasId],proposedText:'Earlier selected wording'});
    const requestedId=navigation==='alias through primary'?aliasId:`${documentId}-AM-31`;
    const initialSelected=navigation==='alias through primary'?primary:amendment(31,{proposedText:'Earlier selected wording'});
    const base=page({scope:'all',items:[primary,amendment(15)],total:2});
    const h=await readerHarness(t,{state:{open:true,scope:'all',amendmentId:requestedId}});
    await h.respond(base);
    await h.respond({...base,selection:{requestedId,status:'available',item:initialSelected,inRequestedScope:true,inPage:navigation==='alias through primary'}});
    assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Earlier selected wording/);
    if(navigation==='alias through primary') {
      await h.updateState({amendmentId:primary.id});
      await h.updateState({amendmentId:requestedId});
    } else {
      await h.click(/^Amendments/);await h.click(/^Amendments/);
    }
    const exactRequest=h.requests.findLast(request=>!request.done&&request.url.searchParams.get('amendment')===requestedId);
    assert(exactRequest,'returning to the selection starts fresh authoritative revalidation');
    assert.equal(h.container.querySelector('.motion-amendments__detail'),null,'earlier selection evidence cannot remain visible while revalidation is pending');
    assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,2);
    await h.respond({error:{message:'Revalidation unavailable'}},{request:exactRequest,status:503});
    const pendingList=h.requests.findLast(request=>!request.done&&!request.url.searchParams.has('amendment'));
    if(pendingList)await h.respond(base,{request:pendingList});
    assert.equal(h.container.querySelector('.motion-amendments__detail'),null,'failed revalidation cannot expose the earlier selected record');
    assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,2);
    assert.match(h.container.querySelector('.motion-amendments__disclosure').textContent,/2 available/);
    assert.match(h.container.textContent,/The selected amendment could not be loaded\./);
    await h.updateState({view:'context',contextTarget:'amendment'});
    assert.equal(h.container.querySelector('[data-test-context]'),null,'a context deep link cannot reuse failed selection evidence');
    assert.match(h.container.textContent,/The requested context is unavailable/);
    const requestCount=h.requests.length;await h.click('Try again');
    assert.equal(h.requests.length,requestCount+1);
    const freshSelected={...initialSelected,proposedText:'Fresh authoritative selected wording'};
    const freshBase=navigation==='alias through primary'?page({scope:'all',items:[freshSelected,amendment(15)],total:2}):base;
    await h.respond({...freshBase,selection:{requestedId,status:'available',item:freshSelected,inRequestedScope:true,inPage:navigation==='alias through primary'}});
    assert.equal(h.context().amendmentId,freshSelected.id);assert.equal(h.context().listId,freshSelected.listId);
    assert(h.container.querySelector('[data-test-context]'),'successful current evidence restores context');
    await h.click('Back from test context');
    assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Fresh authoritative selected wording/);
    assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,2);
    assert.equal(h.requests.length,requestCount+1,'a successful retry does not start another revalidation loop');
  });
});

test('revisiting an older exact selection revalidates without restoring an earlier page from the same working generation',async t=>{
  const listId=`${documentId}-AM-001-040`,firstId=`${documentId}-AM-31`,secondId=`${documentId}-AM-32`;
  const earlierItems=[...Array.from({length:19},(_,index)=>amendment(index+1,{listId})),amendment(21,{listId})];
  earlierItems[12]=amendment(13,{listId,targetLabel:'Earlier published provision',proposedText:'Earlier same-generation amendment 13 wording'});
  const currentItems=Array.from({length:20},(_,index)=>amendment(index+1,{listId}));
  currentItems[12]=amendment(13,{listId,targetLabel:'Current published provision',proposedText:'Current same-generation amendment 13 wording'});
  currentItems[19]=amendment(20,{listId,targetLabel:'Newly displayed amendment 20 provision'});
  const snapshot=(items,total,selected=null)=>{
    const result=page({scope:'all',items,total,selected});
    result.text.generation=2;result.coverage.servingGeneration=2;result.coverage.workingGeneration=true;result.snapshots={amendments:2,text:2};
    return result;
  };
  const h=await readerHarness(t,{state:{open:true,scope:'all',amendmentId:firstId}});
  await h.respond(snapshot(earlierItems,22));
  await h.respond(snapshot(earlierItems,22,amendment(31,{listId,proposedText:'Earlier same-generation amendment 31 wording'})));
  await h.updateState({amendmentId:secondId});
  await h.respond(snapshot(currentItems,23,amendment(32,{listId,proposedText:'Current amendment 32 wording'})));
  const assertCurrentPage=()=>{
    assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,20);
    assert.match(h.container.querySelector('.motion-amendments__disclosure').textContent,/23 available/);
    assert.match(h.container.querySelector('.motion-amendments__pages').textContent,/1–20 of 23/);
    assert.match(h.button(/^Amendment 13/).textContent,/Current published provision/);
    assert.match(h.button(/^Amendment 20/).textContent,/Newly displayed amendment 20 provision/);
    assert.equal(h.button(/^Amendment 21/),undefined);
    assert.doesNotMatch(wordingViewText(h.container),/Earlier published provision|Earlier same-generation amendment (13|31) wording/);
  };
  assertCurrentPage();await h.click(/^Amendment 13/);
  assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Current same-generation amendment 13 wording/);
  assert.equal(h.requests.length,3);
  await h.updateState({amendmentId:firstId});
  assert.equal(h.requests.length,4,'Back or a deep link to an older exact selection must request current evidence');
  assert.equal(h.requests.at(-1).url.searchParams.get('amendment'),firstId);
  assertCurrentPage();
  assert.equal(h.container.querySelector('.motion-amendments__detail'),null,'cached earlier wording cannot appear while its selection is revalidated');
  await h.respond(snapshot(currentItems,23,amendment(31,{listId,proposedText:'Fresh current amendment 31 wording'})));
  assertCurrentPage();
  assert.match(wordingViewText(h.container.querySelector('.motion-amendments__selected')),/Fresh current amendment 31 wording/);
  await h.updateState({amendmentId:secondId});
  assert.equal(h.requests.length,5,'revisiting the other consumed exact response also requires one current read');
  assertCurrentPage();assert.equal(h.container.querySelector('.motion-amendments__detail'),null);
  await h.respond({error:{message:'Temporary selection revalidation failure'}},{status:503});
  assertCurrentPage();
  assert.match(h.container.textContent,/The selected amendment could not be loaded\./);
  assert.equal(h.container.querySelector('.motion-amendments__detail'),null);
  assert.equal(h.requests.length,5,'a failed revalidation waits for a user retry instead of starting a request loop');
  await h.click('Try again');assert.equal(h.requests.length,6);
  await h.respond(snapshot(currentItems,23,amendment(32,{listId,proposedText:'Retried current amendment 32 wording'})));
  assertCurrentPage();
  assert.match(wordingViewText(h.container.querySelector('.motion-amendments__selected')),/Retried current amendment 32 wording/);
  assert.doesNotMatch(h.container.textContent,/The selected amendment could not be loaded/);
  assert.equal(h.requests.length,6);
});

test('accepted page and wording survive disclosure and exact-route navigation round trips without crossing contexts',async t=>{
  for(const navigation of ['collapse','scope','language','page','text','member'])await t.test(navigation,async t=>{
    const aliasId=`${documentId}-AM-013`,primaryId=`${documentId}-AM-13`,first=amendment(31);
    const currentWording='Accepted original-route generation two wording',awayWording=`Other ${navigation} route wording`;
    const currentItems=[amendment(13,{officialIds:[aliasId],proposedText:currentWording}),amendment(15,{targetLabel:'Generation two additional provision'})];
    const h=await readerHarness(t,{state:{open:true,scope:'all',amendmentId:first.id}});
    await h.respond(page({scope:'all',items:[amendment(13,{proposedText:'Obsolete original-route generation one wording'})],total:1}));
    const currentPage=(selected=null)=>{
      const result=page({scope:'all',items:currentItems,total:4,selected});
      result.text.generation=2;result.coverage.servingGeneration=2;result.snapshots={amendments:2,text:2};
      return result;
    };
    await h.respond(currentPage(first));await h.click(/^Amendment 13/);
    const assertCurrent=()=>{
      assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,2);
      assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Accepted original-route generation two wording/);
      assert.match(h.container.textContent,/Generation two additional provision/);
      assert.doesNotMatch(wordingViewText(h.container),/Obsolete original-route generation one wording|Other .* route wording/);
      assert.match(h.container.querySelector('.motion-amendments__disclosure').textContent,/4 available/);
      assert.match(h.container.querySelector('.motion-amendments__pages').textContent,/1–2 of 4/);
    };
    const assertNoOriginalWording=()=>assert.doesNotMatch(wordingViewText(h.container),/Accepted original-route generation two wording|Obsolete original-route generation one wording/);
    const otherPage=({target=documentId,scope='all',language='en',member=memberId,offset=0,numbers=[13]}={})=>{
      const items=numbers.map(number=>amendment(number,{id:`${target}-AM-${number}`,targetDocumentId:target,listId:`${target}-AM-001-020`,
        targetLabel:'Other route provision',language,requestedLanguage:language,proposedText:awayWording,
        wording:wording({language,requestedLanguage:language}),memberMatch:{...match(),memberId:member},authors:[{personId:member,name:'Other route member',status:'resolved'}]}));
      const result=page({document:target,scope,language,offset,items,total:numbers.length===3?4:6});
      result.scope.memberId=member;result.text.memberAuthorship.memberId=member;result.text.memberPosition.memberId=member;
      result.text.generation=3;result.coverage.servingGeneration=3;result.snapshots={amendments:3,text:3};
      return result;
    };
    assertCurrent();
    if(navigation==='collapse') {
      await h.click(/^Amendments/);assert.equal(h.container.querySelector('.motion-amendments__panel'),null);assertNoOriginalWording();
      await h.click(/^Amendments/);
    } else if(navigation==='scope') {
      await h.click(/^Checked member’s proposals/);assertNoOriginalWording();await h.respond(otherPage({scope:'member'}));
      assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Other scope route wording/);assertNoOriginalWording();
      await h.click(/^All available amendments/);
    } else if(navigation==='language') {
      await h.updateProps({language:'fr'});assertNoOriginalWording();await h.respond(otherPage({language:'fr'}));
      assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Other language route wording/);assertNoOriginalWording();
      await h.updateProps({language:'en'});
    } else if(navigation==='page') {
      // A controlled history/deep-link page can use any valid API offset.
      await h.updateState({offset:1,amendmentId:null});assertNoOriginalWording();
      await h.respond(otherPage({offset:1,numbers:[15,18,20]}));await h.click(/^Amendment 15/);
      assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Other page route wording/);assertNoOriginalWording();
      await h.updateState({offset:0,amendmentId:primaryId});
    } else if(navigation==='text') {
      const joint='RC-10-2026-0441';
      await h.updateState({amendmentId:null,variantListId:null});await h.updateProps({documentId:joint});assertNoOriginalWording();
      await h.respond(otherPage({target:joint}));await h.click(/^Amendment 13/);
      assert.equal(h.state().amendmentId,`${joint}-AM-13`);
      assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Other text route wording/);assertNoOriginalWording();
      await h.updateState({amendmentId:null,variantListId:null});await h.updateProps({documentId});
      await h.updateState({amendmentId:primaryId});
    } else {
      await h.updateProps({memberId:'102',memberName:'Other checked member'});assertNoOriginalWording();
      await h.respond(otherPage({member:'102'}));
      assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Other member route wording/);assertNoOriginalWording();
      await h.updateProps({memberId,memberName:'Checked member'});
    }
    assertCurrent();
    const returnList=h.requests.findLast(request=>!request.done&&!request.url.searchParams.has('amendment')&&
      request.url.pathname==='/api/motion-amendments/'+documentId&&request.url.searchParams.get('member')===memberId&&
      request.url.searchParams.get('scope')==='all'&&request.url.searchParams.get('lang')==='en'&&request.url.searchParams.get('offset')==='0');
    if(returnList)await h.respond(currentPage(),{request:returnList});
    assertCurrent();
    const requestsBeforeAlias=h.requests.length;
    await h.updateState({amendmentId:aliasId});
    assert.equal(h.requests.length,requestsBeforeAlias+1,'returning to a route must not turn a page alias into an unchecked local identity');
    assert.equal(h.requests.at(-1).url.searchParams.get('amendment'),aliasId);
    assert.equal(h.container.querySelector('.motion-amendments__detail'),null);
    await h.respond({...currentPage(),selection:{requestedId:aliasId,status:'unavailable',item:null,inRequestedScope:null,inPage:false}});
    assert.match(h.container.textContent,/Amendment unavailable\./);
    assert.equal(h.container.querySelector('.motion-amendments__detail'),null);
    await h.click(/^Amendment 13/);assertCurrent();
    assert.equal(h.requests.length,requestsBeforeAlias+1,'exact primary rows remain local after each round trip');
  });
});

test('an alias-only page match requires the authoritative exact lookup and cannot bypass an ambiguous identity',async t=>{
  const requestedId=`${documentId}-AM-013`,primary=amendment(13,{officialIds:[requestedId],proposedText:'Primary record wording'});
  const h=await readerHarness(t,{state:{open:true,scope:'all',amendmentId:requestedId}});
  const base=page({scope:'all',items:[primary],total:2});
  await h.respond(base);
  assert.equal(h.requests.length,2,'a single page alias match cannot establish uniqueness across the complete index');
  assert.equal(h.requests[1].url.searchParams.get('amendment'),requestedId);
  assert.equal(h.container.querySelector('.motion-amendments__detail'),null,'an unchecked alias must not open the first matching row');
  // Another indexed primary record can carry this alias outside this page. Only
  // the exact endpoint can reject that globally ambiguous observation.
  await h.respond({...base,selection:{requestedId,status:'unavailable',item:null,inRequestedScope:null,inPage:false}});
  assert.match(h.container.textContent,/Amendment unavailable\./);
  assert.equal(h.container.querySelector('.motion-amendments__detail'),null);
  assert.equal(h.container.querySelector('.motion-amendments__row-button').getAttribute('aria-expanded'),'false');
  assert.doesNotMatch(wordingViewText(h.container),/Primary record wording/);
  await h.click(/^Amendment 13/);
  assert.equal(h.state().amendmentId,primary.id,'a user can explicitly select the exact displayed primary identity');
  assert.equal(h.requests.length,2,'direct primary-ID row selection remains local');
  assert.match(wordingViewText(h.container.querySelector('.motion-amendments__detail')),/Primary record wording/);
  await h.updateState({amendmentId:requestedId});
  assert.equal(h.container.querySelector('.motion-amendments__detail'),null,'returning to the ambiguous alias must not reuse the primary-ID detail');
  assert.equal(h.requests.length,3,'returning to an alias requests current authoritative identity evidence');
  assert.equal(h.requests.at(-1).url.searchParams.get('amendment'),requestedId);
  await h.respond({...base,selection:{requestedId,status:'unavailable',item:null,inRequestedScope:null,inPage:false}});
  assert.match(h.container.textContent,/Amendment unavailable\./);
});

test('an unreadable competing version stays visible and cannot fall back to the readable wording',async t=>{
  const listA=`${documentId}-AM-001-020`,listB=`${documentId}-AM-013-014`;
  const item=amendment(13,{conflicted:true,originalText:null,proposedText:null,variants:[
    variant(listA,{proposedText:'Only the first version has readable wording'}),
    variant(listB,{language:null,originalText:null,proposedText:null,wording:wording({language:null,originalStatus:'unavailable',proposedStatus:'unavailable'})}),
    variant(null,{originalText:null,proposedText:null,wording:wording({originalStatus:'unavailable',proposedStatus:'unavailable'})}),
  ]});
  const h=await readerHarness(t,{state:{open:true}});await h.respond(page({items:[item]}));await h.click(/^Amendment 13/);
  assert.equal(h.container.querySelectorAll('.motion-amendments__passage').length,0);
  const options=[...h.container.querySelectorAll('.motion-amendments__version option')];
  assert(options.some(option=>option.value===listA));assert(options.some(option=>option.value===listB));
  assert(options.some(option=>option.disabled&&/without a unique source reference/.test(option.textContent)));
  await h.change('.motion-amendments__version select',listB);
  assert.match(wordingViewText(h.container),/Original wording is unavailable.*Proposed wording is unavailable/s);
  assert.doesNotMatch(wordingViewText(h.container),/Only the first version has readable wording/);
  assert.equal(h.state().variantListId,listB);
});

test('a detail gesture pins only the exact wording language and its unique list through Back and closing',async t=>{
  const item=amendment(13,{language:'de',wording:wording({language:'fr'})});
  const h=await readerHarness(t,{state:{open:true}});
  await h.respond(page({items:[item]}));await h.click(/^Amendment 13/);
  assert.equal(Object.hasOwn(h.state(),'wordingLanguage'),false,'rendering wording does not derive a pin');
  assert.equal(h.state().variantListId,null);
  await h.click('Read in context');
  assert.equal(h.state().wordingLanguage,'fr','interface EN and record DE must not replace wording FR');
  assert.equal(h.state().variantListId,item.listId,'the unique list is pinned in controlled state at the same gesture');
  assert.equal(h.context().wordingLanguage,'fr');assert.equal(h.context().listId,item.listId);
  const savedContext={...h.state()};
  await h.click('Back from test context');assert.equal(h.state().wordingLanguage,'fr');
  await h.click(/^Amendments/);assert.equal(h.state().open,false);assert.equal(h.state().wordingLanguage,'fr');
  await h.updateState(savedContext);
  assert.equal(h.context().wordingLanguage,'fr','restored controlled state retains the exact pin');
  assert.equal(h.context().listId,item.listId);
});

test('unknown wording languages are explicitly null and never inferred from record or interface metadata',async t=>{
  for(const wordingLanguage of [null,undefined,'FR'])await t.test(String(wordingLanguage),async t=>{
    const item=amendment(13,{language:'de',wording:wording({language:wordingLanguage})});
    const h=await readerHarness(t,{state:{open:true}});
    await h.respond(page({items:[item]}));await h.click(/^Amendment 13/);await h.click('Read in context');
    assert.equal(Object.hasOwn(h.state(),'wordingLanguage'),true);assert.equal(h.state().wordingLanguage,null);
    assert.equal(Object.hasOwn(h.context(),'wordingLanguage'),true);assert.equal(h.context().wordingLanguage,null);
    await h.click('Back from test context');assert.equal(h.state().wordingLanguage,null);
  });
});

test('a legacy context without a wording-language pin remains absent until a new detail gesture',async t=>{
  const item=amendment(13,{wording:wording({language:'fr'})});
  const h=await readerHarness(t,{state:{open:true,amendmentId:item.id,variantListId:item.listId,view:'context',contextTarget:'amendment'}});
  await h.respond(page({items:[item]}));
  assert.equal(Object.hasOwn(h.state(),'wordingLanguage'),false);
  assert.equal(Object.hasOwn(h.context(),'wordingLanguage'),false,'a legacy share does not acquire current metadata on render');
  await h.click('Back from test context');assert.equal(Object.hasOwn(h.state(),'wordingLanguage'),false);
  await h.click('Read in context');assert.equal(h.context().wordingLanguage,'fr');
});

test('an optional undefined wording-language pin stays legacy and is omitted from context requests',async t=>{
  const item=amendment(13,{wording:wording({language:'fr'})});
  const h=await readerHarness(t,{state:{open:true,amendmentId:item.id,variantListId:item.listId,view:'context',contextTarget:'amendment',wordingLanguage:undefined}});
  assert.equal(h.requests.length,1,'optional undefined does not invalidate an otherwise exact legacy selection');
  await h.respond(page({items:[item]}));
  assert.equal(h.state().wordingLanguage,undefined);
  assert.equal(Object.hasOwn(h.context(),'wordingLanguage'),false,'undefined is omitted instead of deriving current wording metadata');
  await h.click('Back from test context');assert.equal(h.state().wordingLanguage,undefined);
  await h.click('Read in context');assert.equal(h.context().wordingLanguage,'fr','a new detail gesture explicitly pins the displayed wording');
});

test('changing a wording version or amendment clears its old language pin',async t=>{
  const listA=`${documentId}-AM-001-020`,listB=`${documentId}-AM-013-014`;
  const item=amendment(13,{variants:[variant(listA),variant(listB,{language:'de',wording:wording({language:'fr'})})]});
  const h=await readerHarness(t,{state:{open:true}});
  await h.respond(page({items:[item,amendment(14)]}));await h.click(/^Amendment 13/);
  await h.change('.motion-amendments__version select',listA);await h.click('Read in context');
  assert.equal(h.state().wordingLanguage,'en');await h.click('Back from test context');
  await h.change('.motion-amendments__version select',listB);
  assert.equal(Object.hasOwn(h.state(),'wordingLanguage'),false);
  await h.click('Read in context');assert.equal(h.context().wordingLanguage,'fr');await h.click('Back from test context');
  await h.click(/^Amendment 14/);
  assert.equal(Object.hasOwn(h.state(),'wordingLanguage'),false);assert.equal(h.state().variantListId,null);
  await h.click('Read in context');assert.equal(h.context().wordingLanguage,'en');await h.click('Back from test context');
  await h.click(/^Amendment 14/);
  assert.equal(h.state().amendmentId,null);assert.equal(Object.hasOwn(h.state(),'wordingLanguage'),false);
});

test('whole-motion and adopted gestures clear the controlled pin and omit all amendment context fields',async t=>{
  const h=await readerHarness(t,{state:{open:true}});
  await h.respond(page());await h.click(/^Amendment 13/);
  for(const action of ['Read motion','Find the adopted text']) {
    await h.click('Read in context');const savedContext={...h.state()};
    await h.click('Back from test context');await h.click(action);
    for(const field of ['wordingLanguage','amendmentId','listId'])assert.equal(Object.hasOwn(h.context(),field),false,field);
    assert.equal(Object.hasOwn(h.state(),'wordingLanguage'),false);
    assert.equal(h.state().amendmentId,`${documentId}-AM-13`);
    assert.equal(h.state().variantListId,`${documentId}-AM-001-020`);
    await h.updateState(savedContext);assert.equal(h.context().wordingLanguage,'en','history-owned restoration keeps the earlier exact pin');
    await h.click('Back from test context');
  }
});

test('invalid pins or missing exact AM/list context remain selection errors without blocking whole-text recovery',async t=>{
  const pinned={open:true,amendmentId:`${documentId}-AM-13`,variantListId:`${documentId}-AM-001-020`,contextTarget:'amendment',wordingLanguage:'fr'};
  for(const patch of [
    {wordingLanguage:'FR'}, {wordingLanguage:7}, {variantListId:null},
    {variantListId:`${documentId}-AM-000-020`}, {variantListId:`${documentId}-AM-020-001`},
    {variantListId:'RC-10-2026-0441-AM-001-020'}, {amendmentId:'B-10-2026-0442-AM-13'},
    {contextTarget:'text'}, {contextView:'adopted'},
  ])await t.test(JSON.stringify(patch),async t=>{
    const h=await readerHarness(t,{state:{...pinned,...patch}});
    assert.equal(h.requests.length,0);assert.match(h.container.textContent,/linked amendment is unavailable/);
    assert.equal(h.container.querySelector('.motion-amendments').hasAttribute('data-motion-pending'),false);
    await h.click('Read motion');
    for(const field of ['wordingLanguage','amendmentId','listId'])assert.equal(Object.hasOwn(h.context(),field),false,field);
    assert.equal(Object.hasOwn(h.state(),'wordingLanguage'),false);
  });
});

test('readiness marks only expanded views waiting for accepted list or exact-selection evidence',async t=>{
  const h=await readerHarness(t),pending=()=>h.container.querySelector('.motion-amendments').getAttribute('data-motion-pending');
  assert.equal(pending(),null);await h.click(/^Amendments/);assert.equal(pending(),'true');
  await h.respond(page());assert.equal(pending(),null);
  await h.click(/^Amendments/);assert.equal(pending(),null);
  await h.click(/^Amendments/);assert.equal(pending(),null,'an accepted readable retained list remains ready during refresh');
  const refresh=h.requests.at(-1);
  const requestedId=`${documentId}-AM-99`;
  await h.updateState({amendmentId:requestedId});assert.equal(pending(),'true','a selected off-page AM requires fresh authoritative evidence');
  const exact=h.requests.at(-1);
  await h.respond(page(),{request:refresh});assert.equal(pending(),'true');
  await h.respond(page({requestedId,selectionStatus:'unavailable'}),{request:exact});
  assert.equal(pending(),null,'an unavailable exact selection is settled');
  assert.match(h.container.textContent,/Amendment unavailable/);
});

test('failed and malformed reader responses settle readiness and retries become pending again',async t=>{
  const h=await readerHarness(t,{state:{open:true}}),pending=()=>h.container.querySelector('.motion-amendments').getAttribute('data-motion-pending');
  assert.equal(pending(),'true');
  await h.respond({error:{message:'Fixture source unavailable'}},{status:503});assert.equal(pending(),null);
  await h.click('Try again');assert.equal(pending(),'true');
  await h.respond({schemaVersion:2});assert.equal(pending(),null,'a malformed list is a settled error');
  await h.click('Try again');assert.equal(pending(),'true');await h.respond(page());assert.equal(pending(),null);
  for(const [number,response,status] of [[98,{error:{message:'Fixture exact read unavailable'}},503],[99,{schemaVersion:2},200]]) {
    await h.updateState({amendmentId:`${documentId}-AM-${number}`});assert.equal(pending(),'true');
    await h.respond(response,{status});assert.equal(pending(),null,'an exact failure is settled while the accepted list remains readable');
  }
});


test('motion Read in context reaches the shared in-place amendment diff',async t=>{
  const h=await readerHarness(t,{state:{open:true},realContext:true});
  const item=amendment(13,{originalText:'',proposedText:'19a. New proposed provision;',targetLabel:'Paragraph 19 a (new)'});
  await h.respond(page({items:[item]}));await h.click(/^Amendment 13/);await h.click('Read in context');
  const request=h.requests.find(request=>request.url.pathname.includes('document-context/'));assert(request);
  assert.equal(request.url.searchParams.get('wording-lang'),'en');
  await h.respond(contextOverlayResponse(documentId,item.id,item.listId),{request});
  assertContextOverlay(h.container);
});


test('motion Read in context can render an explicitly identified Commission proposal',async t=>{
  const h=await readerHarness(t,{state:{open:true},realContext:true});
  const item=amendment(13,{baseline:'commission-proposal'});
  await h.respond(page({items:[item]}));await h.click(/^Amendment 13/);await h.click('Read in context');
  const request=h.requests.find(request=>request.url.pathname.includes('document-context/'));assert(request);
  await h.respond(proposalContextResponse(documentId,item.id,item.listId,7),{request});
  assert(h.container.textContent.includes('Commission proposal · COM(2025)0087'));
  assert.equal(h.container.querySelector('[data-amendment-block]').dataset.contextTarget,'true');
});

test('motion proposers use exact directory IDs and preserve unknown labels',async t=>{
  const h=await readerHarness(t,{state:{open:true},members:[{id:42,firstName:'Mika',lastName:'Aaltola'}]});
  await h.respond(page({items:[amendment(13,{authors:[{personId:'42',name:'Mika AALTOLA'},{personId:'99',name:'Guest McDONALD'}]})]}));
  await h.click(/^Amendment 13/);
  const proposers=h.container.querySelector('.motion-amendments__proposers');
  assert.match(proposers.textContent,/Proposed by Mika Aaltola, Guest McDONALD/);
  assert.equal(proposers.querySelector('[title="Source label: Mika AALTOLA"]').textContent,'Mika Aaltola');
});

test('indexed amendment decisions omit unknown methods while reusing recognised non-roll-call labels',async t=>{
  const decisions=[null,'VOTE_UNKNOWN','VOTE_ELECTRONIC'].map((method,index)=>({id:'indexed-decision-'+index,scope:'whole-amendment',date:'2026-10-08',method,outcome:'ADOPTED',provenance:'exact',totals:{for:1,against:0,abstaining:0}}));
  const h=await readerHarness(t,{state:{open:true}});await h.respond(page({items:[amendment(13,{decisions})]}));await h.click(/^Amendment 13/);
  const rows=h.container.querySelectorAll('.motion-amendments__decision');assert.equal(rows.length,3);
  for(const row of rows)assert.doesNotMatch(row.textContent,/Voting method unavailable/);
  assert.match(rows[2].textContent,/Electronic vote \(names not recorded\)/);
});

test('motion proposers get country only and cannot join by name',async t=>{
 const h=await readerHarness(t,{members:[{id:101,firstName:'Checked',lastName:'member',countryCode:'HU',groupCode:'PPE'}]});
 await h.click(/^Amendments/);await h.respond(page({items:[amendment(13,{authors:[{personId:'101',name:'Checked member'},{personId:'999',name:'Checked member'}]})]}));
 await h.click(/^Amendment 13/);
 const tags=h.container.querySelectorAll('.motion-amendments__proposers .member-affiliation');
 assert.equal(tags.length,1);assert.equal(tags[0].textContent,'HUHungary');assert.equal(tags[0].querySelector('i'),null);
});

function summaryBallot(id,position,outcome) {
  const sitting=id.slice(0,17),date=sitting.slice(7);
  const vote={id,sittingId:sitting,date,title:'Exact amendment decision',titleLanguage:'en',titles:{en:'Exact amendment decision'},referenceTexts:{en:'Amendment 13'},
    method:'VOTE_ELECTRONIC_ROLLCALL',outcome,ballotStatus:'conducted',scope:{kind:'amendment'},actualPosition:{status:'recorded',position},intention:{status:'not-reported',positions:[]},
    totals:{for:400,against:200,abstaining:0},alignment:'with',subjectId:null,context:{documentIds:[documentId],amendmentIds:[documentId+'-AM-13'],componentIds:[],partialReferenceIds:[]},parts:[],rollCallRequesters:[],resultRelationship:{binding:'consistent'}};
  return {version:10,member:{id:memberId},period:{kind:'sitting',week:null,sittingId:sitting,from:date,to:date},snapshotId:'a'.repeat(64),positions:'all',alignment:'all',alignmentCounts:{with:1,against:0,abstained:0,unclassified:0},items:[vote],subjects:[],
    pagination:{offset:0,limit:50,returned:1,observedTotal:1,recordedTotal:1,filteredTotal:1,nextOffset:null},selected:{status:'found',item:vote},coverage:{status:'partial',termWide:false}};
}

test('amendment context reuses loaded split ballots and reload restores each exact part summary',async t=>{
  const decisions=[1,2].map(number=>({id:'MTG-PL-2026-10-08-DEC-'+number,scope:'split-part',partId:'part-'+number,partNumber:number,outcome:number===1?'ADOPTED':'REJECTED',method:'VOTE_ELECTRONIC_ROLLCALL'}));
  const item=amendment(13,{decisions,splitParts:decisions.map((_,index)=>({id:'part-'+(index+1),number:index+1,description:'Texte exact '+(index+1),language:'fr',wordingGrounding:'not-validated'}))});
  for(const reload of [false,true])await t.test(reload?'reload':'open from detail',async t=>{
    const h=await readerHarness(t,{realContext:true,state:{open:true,scope:'all',amendmentId:item.id,variantListId:item.listId,...(reload?{view:'context',contextTarget:'amendment',wordingLanguage:'en'}:{})}});
    await h.respond(page({items:[item],scope:'all'}));
    for(const [index,decision] of decisions.entries()) {
      const request=h.requests.find(request=>request.url.searchParams.get('decision')===decision.id);assert(request);
      await h.respond(summaryBallot(decision.id,index===0?'for':'against',decision.outcome),{request});
    }
    if(!reload){
      const now=Date.now();t.mock.method(Date,'now',()=>now+60_000);
      await h.click('Read in context');
    }
    const summary=h.container.querySelector('[aria-label="Votes on this amendment"]');assert(summary);
    const rows=[...summary.querySelectorAll('.member-votes-context-vote')];assert.equal(rows.length,2);
    for(const [index,row] of rows.entries()) {
      assert.match(row.textContent,new RegExp('Amendment 13 · Part '+(index+1)));
      assert.equal(row.querySelector('.motion-amendments__split-description').lang,'fr');
      assert.equal(row.querySelector('.member-votes-position strong').textContent,index===0?'For':'Against');
      assert.equal(row.querySelector('.member-votes-result strong').textContent,index===0?'Adopted':'Rejected');
    }
    assert.equal(h.requests.filter(request=>request.url.pathname.includes('/member-votes/')).length,2,'opening context reuses each loaded ballot');
    await h.click('← Back to amendments');
    assert.equal(h.state().view,'amendments');assert.equal(h.state().amendmentId,item.id);assert.equal(h.state().variantListId,item.listId);
    assert.equal(document.activeElement,h.button('Read in context'));
  });
});
