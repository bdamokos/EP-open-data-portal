import test from 'node:test';
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
  return {schemaVersion:1,text:{id:document,reference:document,status:'indexed',kind:document.startsWith('RC-')?'joint':'original',
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

async function readerHarness(t,{state={},props={}}={}) {
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
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  function Host() {
    [currentState,setState]=useState({...initialState,...state});
    return createElement(MotionAmendments,{...currentProps,state:currentState,onStateChange:setState,renderContext:context=>{
      lastContext=context;
      return createElement('div',{'data-test-context':true},`Context ${context.documentId} ${context.amendmentId??''} ${context.listId??''} ${context.view}`,
        createElement('button',{onClick:context.onBack},'Back from test context'));
    }});
  }
  await act(async()=>root.render(createElement(Host)));
  const respond=(data,{request=requests.at(-1),status=200}={})=>act(async()=>{
    assert(request,'The reader must make a request before receiving a response.');request.done=true;request.resolve(Response.json(data,{status}));
  });
  const buttons=()=>[...container.querySelectorAll('button')];
  const button=label=>buttons().find(node=>typeof label==='string'?node.textContent.trim()===label:label.test(node.textContent));
  const click=label=>act(async()=>{const node=button(label);assert(node,`Missing button ${label}; visible text: ${container.textContent}`);node.focus();node.click();});
  const change=(selector,value)=>act(async()=>{const node=container.querySelector(selector);assert(node,`Missing ${selector}`);node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const updateState=patch=>act(async()=>setState(previous=>({...previous,...patch})));
  const updateProps=patch=>act(async()=>{currentProps={...currentProps,...patch};root.render(createElement(Host));});
  return {container,requests,respond,button,buttons,click,change,updateState,updateProps,state:()=>currentState,context:()=>lastContext};
}

test('the closed reader is lazy, opens the member page in batches of 20, and selects loaded wording without another request',async t=>{
  const h=await readerHarness(t);
  assert.equal(h.requests.length,0);
  await h.click(/^Amendments/);
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].url.pathname,'/api/motion-amendments/'+documentId);
  assert.deepEqual(Object.fromEntries(h.requests[0].url.searchParams),{member:memberId,scope:'member',lang:'en',offset:'0',limit:'20'});
  await h.respond(page({items:[amendment(13,{originalText:''}),amendment(14,{originalText:null,wording:wording({originalStatus:'unavailable'})})]}));
  await h.click(/^Amendment 13/);
  assert.equal(h.requests.length,1,'selecting a loaded row is a local action');
  let detail=h.container.querySelector('.motion-amendments__detail');
  assert.deepEqual([...detail.querySelectorAll('.motion-amendments__passage')].map(node=>node.textContent),[' ','Exact proposed & <public-text> wording.']);
  assert.match(detail.textContent,/The source supplies no original wording\./);
  assert.doesNotMatch(detail.textContent,/Original wording is unavailable/);
  assert.equal(detail.querySelector('public-text'),null,'source wording must be escaped');
  assert.equal(detail.querySelector('.motion-amendments__source a').href,source.url);
  await h.click(/^Amendment 14/);
  detail=h.container.querySelector('.motion-amendments__detail');
  assert.match(detail.textContent,/Original wording is unavailable\./);
  assert.doesNotMatch(detail.textContent,/The source supplies no original wording/);
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
  assert.deepEqual({documentId:h.context().documentId,amendmentId:h.context().amendmentId,listId:h.context().listId,view:h.context().view},
    {documentId,amendmentId:item.id,listId:listB,view:'document'});
  assert.equal(h.requests.length,1);
  await h.click('Back from test context');
  assert.deepEqual(h.state(),{...initialState,open:true,scope:'all',offset:20,amendmentId:item.id,variantListId:listB,contextTarget:'amendment'});
  assert.equal(document.activeElement,h.button('Read in context'));
  assert.equal(h.container.querySelector('.motion-amendments__version select').value,listB);
  assert.match(h.container.querySelector('.motion-amendments__pages').textContent,/21–21 of 45/);
  await h.click('Read adopted text');
  assert.deepEqual({documentId:h.context().documentId,amendmentId:h.context().amendmentId,listId:h.context().listId,view:h.context().view},
    {documentId,amendmentId:undefined,listId:undefined,view:'adopted'},'the downstream reader resolves an observed adopted relation from the same B/RC target');
  assert.equal(h.requests.length,1);
});

test('whole-text context ignores a missing amendment or wording version and Back preserves the selected identity',async t=>{
  const requestedId=`${documentId}-AM-99`,missingList=`${documentId}-AM-900-901`;
  const h=await readerHarness(t,{state:{open:true,scope:'all',offset:20,amendmentId:requestedId,variantListId:missingList}});
  const base=page({scope:'all',offset:20,total:45});await h.respond(base);
  await h.respond({...base,selection:{requestedId,status:'unavailable',item:null,inRequestedScope:null,inPage:false}});
  assert.match(h.container.textContent,/The requested amendment is unavailable in the available records\./);
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
  assert.match(h.container.querySelector('.motion-amendments__detail').textContent,/The exact off-page wording/);
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
  assert.match(h.container.textContent,/The requested amendment is unavailable in the available records\./);
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
  assert.doesNotMatch(h.container.textContent,/Unrelated selected wording/);
  assert.match(h.container.textContent,/selected amendment could not be loaded/i);
});

test('scope, language and target changes immediately clear old wording and reject responses for another request',async t=>{
  const h=await readerHarness(t,{state:{open:true}});
  await h.respond(page());await h.click(/^Amendment 13/);
  assert.match(h.container.textContent,/Exact proposed/);
  await h.click(/^All available amendments/);
  assert.equal(h.container.querySelector('.motion-amendments__detail'),null);
  await h.respond(page({scope:'all',items:[amendment(13,{proposedText:'All-scope wording'})]}));
  assert.match(h.container.textContent,/All-scope wording/);
  await h.updateProps({language:'fr'});
  assert.equal(h.container.querySelector('.motion-amendments__passage'),null);
  assert.equal(h.requests.at(-1).url.searchParams.get('lang'),'fr');
  await h.respond(page({scope:'all',items:[amendment(13,{proposedText:'Wrong language payload'})]}));
  assert.doesNotMatch(h.container.textContent,/Wrong language payload|All-scope wording/);
  assert.match(h.container.textContent,/Amendment information could not be loaded/);
  await h.click('Try again');
  await h.respond(page({scope:'all',language:'fr',items:[amendment(13,{proposedText:'Libellé français',wording:wording({language:'fr',requestedLanguage:'fr'})})]}));
  assert.match(h.container.textContent,/Libellé français/);
  const newTarget='RC-10-2026-0441';await h.updateProps({documentId:newTarget});
  assert.equal(h.container.querySelector('.motion-amendments__passage'),null);
  assert.match(h.container.textContent,/This motion reader selection is unavailable/);
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
  await h.respond({...page(),schemaVersion:2});
  assert.equal(h.container.querySelector('.motion-amendments__row'),null);
  await h.click('Try again');await h.respond(page());
  assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,1);
  await h.updateProps({documentId:'TA-10-2026-0339'});
  assert.match(h.container.textContent,/This motion reader selection is unavailable/);
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
  assert.doesNotMatch(h.container.textContent,/Obsolete English wording/);
  assert.equal(h.requests.length,2);
});

test('conflicting source versions require a choice and only checked variant proposers receive the member label',async t=>{
  const listA=`${documentId}-AM-001-020`,listB=`${documentId}-AM-013-014`;
  const item=amendment(13,{conflicted:true,authors:[{name:'Aggregate-only author',personId:memberId}],memberMatch:match(),
    variants:[variant(listA,{authors:[{name:'Another checked proposer',personId:'102'}],memberMatch:match(false),proposedText:'First variant wording'}),
      variant(listB,{authors:[{name:'Checked variant proposer',personId:memberId}],memberMatch:match(),proposedText:'Second variant wording'})]});
  const h=await readerHarness(t,{state:{open:true,scope:'all'}});await h.respond(page({scope:'all',items:[item]}));
  await h.click(/^Amendment 13/);
  let detail=h.container.querySelector('.motion-amendments__detail');
  assert.match(detail.textContent,/Choose a wording version/);
  assert.equal(detail.querySelector('.motion-amendments__passage'),null);
  assert.equal(h.button('Read in context').disabled,true);
  assert.doesNotMatch(detail.textContent,/Aggregate-only author/);
  await h.change('.motion-amendments__version select',listA);detail=h.container.querySelector('.motion-amendments__detail');
  assert.match(detail.textContent,/First variant wording/);assert.match(detail.textContent,/Another checked proposer/);
  assert.equal(detail.querySelector('.motion-amendments__member-tag'),null);
  assert.doesNotMatch(detail.textContent,/Aggregate-only author|Checked variant proposer|Second variant wording/);
  await h.change('.motion-amendments__version select',listB);detail=h.container.querySelector('.motion-amendments__detail');
  assert.match(detail.textContent,/Second variant wording/);assert.match(detail.textContent,/Checked variant proposer/);
  assert.equal(detail.querySelector('.motion-amendments__member-tag').textContent,'Selected MEP’s proposal');
  assert.doesNotMatch(detail.textContent,/Aggregate-only author|Another checked proposer/);
  assert.equal(h.requests.length,1);
});

test('all-scope row highlights distinguish aggregate authorship from a match in one checked wording version',async t=>{
  const listA=`${documentId}-AM-001-020`,listB=`${documentId}-AM-013-014`;
  const aggregate=amendment(13,{memberMatch:match(),variants:[variant(listA,{memberMatch:match(false)})]});
  const oneVersion=amendment(14,{memberMatch:match(false),variants:[variant(listA,{memberMatch:match(false)}),variant(listB,{memberMatch:match()})]});
  const unrelated=amendment(15,{memberMatch:match(false),variants:[variant(listA,{memberMatch:match(false),authors:[{name:'Checked member',personId:'999'}]})]});
  const h=await readerHarness(t,{state:{open:true,scope:'all'}});
  await h.respond(page({scope:'all',items:[aggregate,oneVersion,unrelated],totals:{allIndexed:3,memberMatched:2}}));
  const rows=[...h.container.querySelectorAll('.motion-amendments__row')];
  assert.equal(rows[0].querySelector('.motion-amendments__member-tag').textContent,'Selected MEP’s proposal');
  assert.equal(rows[1].querySelector('.motion-amendments__member-tag').textContent,'Selected MEP’s proposal in one version');
  assert.equal(rows[2].querySelector('.motion-amendments__member-tag'),null,'same display name does not establish authorship');
  assert.equal(h.container.querySelectorAll('.motion-amendments__row').length,3,'all scope retains other authors');
});

test('amendment context requires an exact source-list identity while whole-motion context remains available',async t=>{
  const h=await readerHarness(t,{state:{open:true}});
  await h.respond(page({items:[amendment(13,{listId:null})]}));await h.click(/^Amendment 13/);
  assert.match(h.container.querySelector('.motion-amendments__detail').textContent,/Exact proposed/);
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
  assert.match(decisions.textContent,/Whole amendmentVoted in parts.*Part 1Rejected.*Part 2Lapsed/s);
  assert.doesNotMatch(decisions.textContent,/Adopted|Vote records disagree/);
  assert.deepEqual([...detail.querySelectorAll('.motion-amendments__passage')].map(node=>node.textContent),[item.originalText,item.proposedText]);
  assert.match(decisions.textContent,/Published split description\./);
  assert.equal(detail.querySelector('.motion-amendments__split-description').closest('.motion-amendments__wording'),null);
  assert.doesNotMatch(detail.textContent,/member voted|MEP voted|secured adoption|caused.*adopt|supported.*adopt/i);
});

test('missing English document distribution does not hide available English amendment wording',async t=>{
  const h=await readerHarness(t,{state:{open:true}}),result=page();
  result.text.availableLanguages=['fr'];result.text.files=[{url:source.url.replace('_en','_fr'),language:'fr',format:'docx'}];
  result.text.languageFallback=true;
  await h.respond(result);await h.click(/^Amendment 13/);
  const passages=[...h.container.querySelectorAll('.motion-amendments__passage')];
  assert.deepEqual(passages.map(node=>node.textContent),[result.items[0].originalText,result.items[0].proposedText]);
  assert(passages.every(node=>node.lang==='en'));
  assert.match(h.container.querySelector('.motion-amendments__detail').textContent,/Wording language: EN/);
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
  assert.match(h.container.textContent,/No matching proposals in the available records/);
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
  assert.match(h.container.textContent,/Original wording is unavailable.*Proposed wording is unavailable/s);
  assert.doesNotMatch(h.container.textContent,/Only the first version has readable wording/);
  assert.equal(h.state().variantListId,listB);
});
