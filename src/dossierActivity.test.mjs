import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {dossierAmendmentVotes,dossierVoteCards,dossierHref,dossierTimeline,mergeDossierPage,retainDossierContributors,dossierEmptyLabel} from './dossierActivityModel.mjs';
import {dataTimeoutFor} from './client.mjs';
import {readFile} from 'node:fs/promises';
import {contrast,paintedBackground,themeCss,tokenValue} from './test-support/themeStyles.mjs';

const reference='2025/0176(COD)',source={url:'https://data.europarl.europa.eu/api/v2/procedures/2025-0176',fetchedAt:'2026-10-23T12:00:00Z',language:'en'};
const role={kind:'role',id:'participation/257727',personId:'257727',role:'RAPPORTEUR_CO',committee:'ENVI',date:'2026-02-11',dateBasis:'recorded',stage:'RDG1',source};
const speech={kind:'speech',id:'MTG-PL-2026-09-15-OTH-1',date:'2026-09-15',start:null,stage:'RDG1',title:'Official joint debate title',titleLanguage:'en',debateId:'exact-debate',jointDebate:true,source};
const amendment={kind:'amendment',id:'A-10-2026-0010-AM-3@list',date:'2026-09-08',dateBasis:'tabling',stage:'RDG1',source,tabling:{status:'recorded',date:'2026-09-08',observations:[{id:'tabling-event',date:'2026-09-08',stage:'RDG1',source}]},amendment:{id:'A-10-2026-0010-AM-3',number:3,listId:'A-10-2026-0010-AM-001-003',targetDocumentId:'A-10-2026-0010',documentDate:'2026-09-09',dateBasis:'individual-amendment-document',outcome:'ADOPTED',textIntegrity:'complete',listRelationship:'current',authors:[{personId:'257727',name:'Named member'},{personId:'2',name:'Exact coauthor'}],onBehalfOf:['ENVI','SEDE'],decisions:[{id:'MTG-PL-2026-09-16-DEC-196161',outcome:'ADOPTED'}],sources:[source]}};
function ballot(id,position='for',outcome='ADOPTED') {return {kind:'vote',id,date:'2026-09-16',stage:null,source,vote:{id,uri:'https://data.europarl.europa.eu/'+id,sittingId:'MTG-PL-2026-09-16',date:'2026-09-16',title:'Official decision title',titles:{en:'Official decision title'},titleLanguage:'en',referenceTexts:{en:'Provisional agreement'},scope:{kind:'amendment'},actualPosition:{status:'recorded',position},outcome,method:'VOTE_ELECTRONIC_ROLLCALL',ballotStatus:'conducted',totals:{for:1,against:2,abstaining:3},context:{amendmentIds:[],componentIds:[]},parts:[],intention:{status:'not-reported',positions:[]}}};}
const agreement=ballot('MTG-PL-2026-09-16-DEC-196161'),rejection=ballot('MTG-PL-2026-09-16-DEC-196519','against','REJECTED');

test('loading the known target batches clears only their pending coverage',()=>{
  const batch=(checked,unchecked,{gaps=[],status=unchecked.length?'partial':'complete',checkedComplete=status==='complete'||Boolean(unchecked.length)}={})=>({items:[],participants:[],coverage:{status,checkedComplete,checkedTargets:checked,uncheckedTargets:unchecked,gaps,sources:[]},participantCoverage:{status,checkedComplete,checkedTargets:checked,uncheckedTargets:unchecked,gaps,sources:[]}});
  const first=batch(['debate-one'],['debate-two']),last=batch(['debate-two'],['debate-one']);
  const complete=mergeDossierPage(first,last);
  for(const scope of [complete.coverage,complete.participantCoverage]){
    assert.equal(scope.status,'complete');assert.deepEqual(scope.uncheckedTargets,[]);assert.deepEqual(scope.gaps,[]);
    assert.deepEqual(scope.checkedTargets,['debate-one','debate-two']);
  }
  const failed=mergeDossierPage(batch(['debate-one'],['debate-two'],{gaps:['A linked debate is unavailable.']}),last);
  assert.equal(failed.coverage.status,'partial');assert.equal(failed.participantCoverage.status,'partial');
  assert.deepEqual(failed.coverage.gaps,['A linked debate is unavailable.']);
  const unknown=mergeDossierPage(batch([],[],{status:'partial'}),last);
  assert.equal(unknown.coverage.status,'partial','a real partial source without a target checklist must not be cleared');
  const incomplete=mergeDossierPage(batch(['debate-one'],['debate-two'],{checkedComplete:false}),last);
  assert.equal(incomplete.coverage.status,'partial','loading remaining pages cannot repair an incomplete checked source');
});

function page(section,member='257727',items,extra={}) {return {version:6,procedure:{id:'2025-0176',reference,title:'Official full dossier title',titleLanguage:'en',source},memberId:member,section,participants:[{id:'257727',name:'Named member',roles:[role]},{id:'124984',name:'Other member',roles:[{...role,id:'role-2',personId:'124984',role:'RAPPORTEUR_SHADOW'}]}],items:items??({roles:[role],speeches:[speech],amendments:[amendment],votes:[agreement,rejection]}[section]),pagination:{offset:0,targetOffset:0,limit:25,next:null},coverage:{status:'partial',gaps:['Some targets have not been checked.'],sources:[source]},generation:1,...extra};}

async function harness(t,query='?view=legislation&pl-mode=dossier&dossier-ref='+encodeURIComponent(reference)+'&dossier-person=257727',handler) {
  const window=new Window({url:'http://localhost/'+query});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,load;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const calls=[];
  t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input,location.href);calls.push(url);if(handler){const result=await handler(url);if(result)return result;}
    if(url.pathname.endsWith('/insights/dossier-activity'))return Response.json(page(url.searchParams.get('section'),url.searchParams.get('member')));
    if(url.pathname.endsWith('/insights/dossier-references'))return Response.json({items:[page('roles').procedure],coverage:{status:'complete',gaps:[]}});
    if(url.pathname.includes('/portrait/'))return new Response(null,{status:404});
    throw new Error('Unexpected read '+url.href);
  });
  load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const module=await load('/src/DossierActivity.tsx'),{createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const settle=async()=>{const until=Date.now()+5000;while(container.querySelector('[data-dossier-pending="true"],[data-reader-pending="true"]')){assert(Date.now()<until,'Dossier rendering did not settle');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});}};
  const render=async element=>{await act(async()=>root.render(element));await settle();};
  const click=async text=>{await act(async()=>{const control=[...container.querySelectorAll('button,a,summary')].find(node=>node.textContent.trim()===text||node.textContent.trim().startsWith(text+' '));assert(control,'Missing '+text);control.click();});await settle();};
  const navigate=async query=>{await act(async()=>{history.replaceState(null,'',query);window.dispatchEvent(new Event('popstate'));});await settle();};
  return {window,container,calls,module,load,render,click,navigate};
}

test('electronic secret dossier ballots keep unrecorded positions separate from declared intentions',async t=>{
  const item=structuredClone(agreement);
  item.vote.method='VOTE_ELECTRONIC_SECRET';item.vote.actualPosition={status:'not-individually-recorded',position:null};item.vote.intention={status:'reported',positions:['for']};
  const h=await harness(t,undefined,url=>url.pathname.endsWith('/insights/dossier-activity')?Response.json(page(url.searchParams.get('section'),url.searchParams.get('member'),url.searchParams.get('section')==='votes'?[item]:[])):null);
  await h.render(createElement(h.module.DossierActivity,{reference}));
  const card=h.container.querySelector('[data-dossier-vote]');assert(card);
  assert.equal(card.querySelector('.member-votes-position strong').textContent,'Not individually recorded');
  assert.match(card.textContent,/Declared intention: For/);assert.match(card.textContent,/Adopted/);
  assert.equal(card.querySelector('.member-votes-position-for'),null);
});

test('All renders exact amendment ballot once, preserves dates/coauthors and joint debate scope; Votes renders every ballot once',async t=>{
  const h=await harness(t);await h.render(createElement(h.module.DossierActivity,{reference}));
  assert.equal(h.calls.filter(url=>url.pathname.endsWith('dossier-activity')).length,4,'one bounded first page per section');
  assert.equal(h.calls.filter(url=>url.pathname.includes('/speech/')).length,0,'closed speech readers stay lazy');
  assert.match(h.container.textContent,/Joint debate/);assert.match(h.container.textContent,/Exact coauthor/);assert.match(h.container.textContent,/ENVI, SEDE/);
  assert.match(h.container.textContent,/Sep 8, 2026/);assert.match(h.container.textContent,/Sep 9, 2026/);
  assert.equal(h.container.querySelectorAll('[data-dossier-vote="'+agreement.id+'"]').length,1);
  assert(h.container.querySelector('.dossier-amendment [data-dossier-vote="'+agreement.id+'"]'));
  assert.equal(h.container.querySelectorAll('[data-dossier-vote="'+rejection.id+'"]').length,1);
  assert.deepEqual([...h.container.querySelectorAll('.dossier-timeline>.dossier-event-date')],[]);
  const timeline=h.container.querySelector('.dossier-timeline').textContent;assert(timeline.indexOf('Co-rapporteur')<timeline.indexOf('Amendment 3'));assert(timeline.indexOf('Amendment 3')<timeline.indexOf('Official joint debate title'));
  await h.click('Votes');
  assert.equal(h.container.querySelectorAll('.dossier-amendment').length,0);
  assert.equal(h.container.querySelectorAll('[data-dossier-vote="'+agreement.id+'"]').length,1);
  assert.equal(h.container.querySelectorAll('[data-dossier-vote="'+rejection.id+'"]').length,1);
  await h.navigate('?view=legislation&pl-mode=dossier&dossier-ref='+encodeURIComponent(reference)+'&dossier-person=257727&dossier-show=speeches');
  assert.equal(h.container.querySelectorAll('[data-dossier-vote]').length,0);
});

test('section failures retain independent content and retry; generic next cursor appends without guessing totals',async t=>{
  let fail=true;
  const h=await harness(t,undefined,url=>{
    if(!url.pathname.endsWith('dossier-activity'))return;
    const section=url.searchParams.get('section');
    if(section==='speeches'&&fail)return Response.json({error:{message:'A source failed.'}},{status:502});
    if(section==='amendments'&&url.searchParams.get('target-offset')==='0')return Response.json(page(section,'257727',[amendment],{pagination:{offset:0,targetOffset:0,limit:25,next:{offset:0,targetOffset:1}}}));
    if(section==='amendments')return Response.json(page(section,'257727',[{...amendment,id:'exact-second-variant',amendment:{...amendment.amendment,id:'exact-second',number:4,listId:'second-list',decisions:[]}}]));
  });
  await h.render(createElement(h.module.DossierActivity,{reference}));
  assert.match(h.container.textContent,/Speeches could not be loaded/);assert.match(h.container.textContent,/Co-rapporteur/);assert.match(h.container.textContent,/Amendment 3/);assert.match(h.container.textContent,/Partial coverage/);
  assert.match([...h.container.querySelectorAll('.dossier-filters button')].find(node=>node.textContent.startsWith('Speeches')).textContent,/—/);
  assert.equal(h.container.querySelectorAll('.dossier-amendment').length,1);
  await h.click('Load more amendments');assert.equal(h.container.querySelectorAll('.dossier-amendment').length,2);
  const last=h.calls.filter(url=>url.searchParams.get('section')==='amendments').at(-1);assert.equal(last.searchParams.get('target-offset'),'1');assert.equal(last.searchParams.get('offset'),'0');
  assert.equal(h.calls.filter(url=>url.searchParams.get('section')==='amendments').length,2,'pagination never walks additional targets automatically');
  fail=false;await h.click('Retry speeches');assert.match(h.container.textContent,/Official joint debate title/);assert.doesNotMatch(h.container.textContent,/Speeches could not be loaded/);
});

test('full dossier keeps exact participant roles; document role dates do not become appointments',async t=>{
  const docRole={...role,dateBasis:'document',documentId:'A-10-2026-0010'};
  const h=await harness(t,'?view=legislation&pl-mode=dossier&dossier-ref='+encodeURIComponent(reference),url=>url.searchParams.get('section')==='roles'?Response.json(page('roles',null,[docRole],{participants:[{id:'257727',name:'Named member',roles:[docRole,{...role,id:'other-exact-role',role:'RAPPORTEUR_OPINION'}]}]})):null);
  await h.render(createElement(h.module.DossierActivity,{reference}));
  assert.match(h.container.textContent,/Co-rapporteur/);assert.match(h.container.textContent,/Opinion rapporteur/);assert.match(h.container.textContent,/document date/);
  assert.equal(h.calls.filter(url=>url.pathname.endsWith('dossier-activity')).length,1);
  const name=h.container.querySelector('.dossier-participants li>a');assert.equal(new URL(name.href).searchParams.get('module'),'profile');
  assert.equal(new URL([...h.container.querySelectorAll('a')].find(node=>node.textContent==='Work on this dossier').href).searchParams.get('dossier-person'),'257727');
});

test('multiple exact references require a choice and resolver labels gaps without a COD guess',async t=>{
  const h=await harness(t,undefined,url=>url.pathname.endsWith('dossier-references')?Response.json({items:[page('roles').procedure],coverage:{status:'partial',gaps:[{id:'2025-0233',code:'unavailable',message:'Exact procedure source unavailable.'}]}}):null);
  await h.render(createElement(h.module.DossierWorkLinks,{person:'257727',references:[{id:'2025-0176',reference},{id:'2025-0233',reference:'2025/0233(INI)'}]}));
  assert.match(h.container.querySelector('summary').textContent,/choose a procedure/);assert.equal(h.container.querySelector('details').open,false);assert.equal(h.container.querySelectorAll('a').length,2);
  const anchor=h.container.querySelector('a'),before=location.href;
  let prevented;document.addEventListener('click',event=>{prevented=event.defaultPrevented;event.preventDefault();},{once:true});
  anchor.dispatchEvent(new h.window.MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));assert.equal(prevented,false,'modifier click retains the normal href');assert.equal(location.href,before);
  await h.render(createElement(h.module.ActivityDossierLinks,{person:257727,procedureIds:['2025-0176','2025-0233','2025-0407','2025-0999','invalid']}));
  const resolver=h.calls.find(url=>url.pathname.endsWith('dossier-references'));assert.equal(resolver.searchParams.get('procedures'),'2025-0176,2025-0233,2025-0407');
  assert.equal(h.container.querySelectorAll('a').length,1);assert.match(h.container.textContent,/Some dossier references unavailable/);assert.match(h.container.textContent,/First 3 of 4 procedures shown\./);
  assert(!h.container.innerHTML.includes('2025%2F0233%28COD%29'));
});

test('exact joins reject number/title/tally coincidence and accept only a recorded component or decision',()=>{
  const sameNumber=ballot('different-decision');sameNumber.vote.context.amendmentIds=[amendment.amendment.id];
  assert.deepEqual(dossierAmendmentVotes(amendment,[sameNumber]),[]);
  const component=ballot('split-decision');component.vote.parts=[{componentId:'exact-component'}];
  assert.deepEqual(dossierAmendmentVotes({...amendment,amendment:{...amendment.amendment,decisions:[{id:'another',partId:'exact-component'}]}},[component]),[component]);
  assert.deepEqual(dossierAmendmentVotes({...amendment,amendment:{...amendment.amendment,conflicted:true}},[agreement]),[]);
  assert.equal(dossierTimeline([speech,amendment,role])[0].kind,'role');
  assert.equal(dossierTimeline([{...role,dateBasis:'document'}]).length,0,'document observations stay outside appointment chronology');
  assert.equal(mergeDossierPage(page('roles'),page('roles')).items.length,1);
  assert.equal(new URL(dossierHref(reference,null,'en','https://example.org/explorer?member=1&country=HU'),'https://example.org').searchParams.has('member'),false);
  assert.equal(dataTimeoutFor('insights/dossier-activity?reference=exact'),35000);assert.equal(dataTimeoutFor('insights/dossier-references?procedures=exact'),35000);
});

test('HTTP 200 unavailable target retains continuation and can retry the failed target after later successes; null tabling dates stay explicit',async t=>{
  let failed=true;
  const h=await harness(t,undefined,url=>{
    if(url.searchParams.get('section')!=='amendments')return;
    if(url.searchParams.get('target-offset')==='0')return Response.json(page('amendments','257727',failed?[]:[{...amendment,tabling:{...amendment.tabling,observations:[{id:'unknown-date',date:null,stage:null,source}]}}],{coverage:{status:failed?'unavailable':'complete',gaps:failed?['Exact target read failed.']:[],sources:[source]},pagination:{offset:0,targetOffset:0,limit:25,next:{offset:0,targetOffset:1}}}));
    return Response.json(page('amendments','257727',[{...amendment,id:'other-variant',amendment:{...amendment.amendment,id:'other-amendment',number:4,decisions:[]}}],{pagination:{offset:0,targetOffset:1,limit:25,next:null}}));
  });
  await h.render(createElement(h.module.DossierActivity,{reference}));
  assert.match(h.container.textContent,/Unavailable/);assert([...h.container.querySelectorAll('button')].some(node=>node.textContent==='Retry amendments'));
  assert.equal(h.container.querySelectorAll('.dossier-amendment').length,0);assert.equal(h.container.querySelectorAll('[data-dossier-vote="'+agreement.id+'"]').length,1,'an unavailable AM cannot suppress its standalone vote');
  await h.click('Load more amendments');assert.equal(h.container.querySelectorAll('.dossier-amendment').length,1);assert.match(h.container.querySelector('[aria-label="Amendments coverage"]').textContent,/Partial coverage/);
  failed=false;await h.click('Retry amendments');assert.equal(h.container.querySelectorAll('.dossier-amendment').length,2);assert.doesNotMatch(h.container.textContent,/Date unavailable/);assert.doesNotMatch(h.container.textContent,/Exact target read failed/);
  assert.equal([...h.container.querySelectorAll('button')].filter(node=>node.textContent==='Load more amendments').length,0,'retrying an earlier target cannot reopen the completed continuation');
  assert.equal(h.container.querySelectorAll('[data-dossier-vote="'+agreement.id+'"]').length,1);
});

test('document-only role cards use a separate document section and never claim an appointment date',async t=>{
  const h=await harness(t,undefined,url=>url.searchParams.get('section')==='roles'?Response.json(page('roles','257727',[{...role,dateBasis:'document',documentId:'exact-document'}])):null);
  await h.render(createElement(h.module.DossierActivity,{reference}));assert.doesNotMatch(h.container.querySelector('.dossier-document-roles').textContent,/appointment dates unavailable/);assert.match(h.container.querySelector('.dossier-document-roles').textContent,/Document date/);
  assert(!h.container.querySelector('.dossier-timeline .dossier-role'));
});

test('same-generation partial and complete resolver snapshots revalidate when reopened instead of using the five-minute insight cache',async t=>{
  const h=await harness(t),{useInsightData}=await h.load('/src/InsightData.ts');
  function Read(){const state=useInsightData('insights/dossier-references?procedures=2025-0176&lang=en');return createElement('p',null,state.data?'ready':'loading');}
  await h.render(createElement(Read,{key:1}));await h.render(createElement(Read,{key:2}));
  assert.equal(h.calls.filter(url=>url.pathname.endsWith('dossier-references')).length,2);
});

test('complete target reads are not made partial by unrelated discovery failures',async t=>{
  const h=await harness(t,undefined,url=>{
    if(url.searchParams.get('section')!=='amendments')return;
    return Response.json(page('amendments','257727',[amendment],{coverage:{status:'complete',gaps:[],sources:[source],discovery:{pending:false,refreshGaps:true,capacityGaps:['Discovery limit reached.']}}}));
  });
  await h.render(createElement(h.module.DossierActivity,{reference}));
  const coverage=h.container.querySelector('[aria-label="Amendments coverage"] .dossier-coverage');
  assert.equal(coverage,null,'unrelated discovery failures do not downgrade this complete target');
  assert.equal(h.container.querySelectorAll('.dossier-amendment').length,1);
});

test('global discovery capacity does not invent a gap in a complete dossier target',async t=>{
  const h=await harness(t,undefined,url=>{
    if(url.searchParams.get('section')!=='amendments')return;
    return Response.json(page('amendments','257727',[amendment],{coverage:{status:'complete',gaps:[],sources:[source],discovery:{pending:false,refreshGaps:false,capacityGaps:['Discovery limit reached.']}}}));
  });
  await h.render(createElement(h.module.DossierActivity,{reference}));
  assert.equal(h.container.querySelector('[aria-label="Amendments coverage"] .dossier-coverage'),null);
  assert.equal(dossierEmptyLabel({status:'complete',gaps:[],discovery:{pending:true,refreshGaps:true,capacityGaps:['Historical capacity limit.']}}),'No linked records.');
});

test('an unestablished target is unavailable without an unsupported retry promise',async t=>{
  const h=await harness(t,undefined,url=>url.searchParams.get('section')==='amendments'?Response.json(page('amendments','257727',[],{coverage:{status:'unavailable',retryable:false,gaps:['No checked amendment target is linked in this procedure observation.'],sources:[source]}})):null);
  await h.render(createElement(h.module.DossierActivity,{reference}));
  assert.match(h.container.querySelector('[aria-label="Amendments coverage"]').textContent,/Unavailable/);
  assert(![...h.container.querySelectorAll('button')].some(node=>node.textContent==='Retry amendments'));
});

test('coverage retains a short partial label when a later amendment target fails',async t=>{
  const h=await harness(t,undefined,url=>{
    if(url.searchParams.get('section')!=='amendments')return;
    const first=url.searchParams.get('target-offset')==='0';
    return Response.json(page('amendments','257727',first?[amendment]:[],{checkedTarget:first?'A-10-2026-0010':'A-10-2026-0011',pagination:{offset:0,targetOffset:first?0:1,limit:25,next:first?{offset:0,targetOffset:1}:null},coverage:{status:first?'complete':'unavailable',gaps:first?[]:['Exact target read failed.'],sources:[source]}}));
  });
  await h.render(createElement(h.module.DossierActivity,{reference}));await h.click('Load more amendments');
  const coverage=h.container.querySelector('[aria-label="Amendments coverage"] .dossier-coverage');
  assert.match(coverage.textContent,/Partial coverage/);
  assert.equal(coverage.querySelector('details'),null);
});

test('a mismatched section/person response fails locally while valid sections remain readable',async t=>{
  const h=await harness(t,undefined,url=>url.searchParams.get('section')==='speeches'?Response.json(page('speeches','124984',[speech])):null);
  await h.render(createElement(h.module.DossierActivity,{reference}));assert.match(h.container.textContent,/Speeches could not be loaded/);assert.match(h.container.textContent,/Amendment 3/);assert(!h.container.querySelector('.dossier-speech'));
});

test('dossier controls and cards retain readable dark/light tokens and 44px targets at the mobile breakpoint',async()=>{
  const css=await readFile(new URL('./DossierActivity.css',import.meta.url),'utf8');
  assert.match(css,/@media\(max-width:680px\)/);assert.match(css,/min-height:44px/);
  for(const scheme of ['light','dark']){
    const window=new Window({url:'http://localhost/'});
    try{
      const style=window.document.createElement('style');style.textContent=themeCss(scheme)+css;window.document.head.append(style);
      window.document.body.innerHTML='<section class="dossier-activity"><nav class="dossier-filters"><button aria-pressed="true">All</button></nav><article class="dossier-vote"><p class="dossier-muted">Source date unavailable</p></article></section>';
      for(const element of window.document.querySelectorAll('button,.dossier-muted'))assert(contrast(window.getComputedStyle(element).color,paintedBackground(window,element,scheme))>=4.5,scheme+' '+element.className);
      assert.equal(window.getComputedStyle(window.document.querySelector('button')).minHeight,'44px');
    }finally{await window.happyDOM.close();}
  }
});

test('collective decisions render once with a shared reference in All and Amendments, and once in Votes',async t=>{
  const second={...amendment,id:'A-10-2026-0010-AM-4@list',amendment:{...amendment.amendment,id:'A-10-2026-0010-AM-4',number:4}};
  const h=await harness(t,undefined,url=>url.searchParams.get('section')==='amendments'?Response.json(page('amendments','257727',[amendment,second])):null);
  await h.render(createElement(h.module.DossierActivity,{reference}));
  const count=()=>h.container.querySelectorAll('[data-dossier-vote="'+agreement.id+'"]').length;
  assert.equal(count(),1);assert.equal(h.container.querySelectorAll('.dossier-amendment .explorer-amendment-card header .explorer-amendment-outcome').length,0,'whole collective ballots suppress the duplicate outcome on own and shared-only cards');const link=[...h.container.querySelectorAll('a')].find(a=>a.textContent==='View the vote');assert(link);assert(h.container.querySelector(link.getAttribute('href')));
  await h.click('Amendments');assert.equal(count(),1);assert.equal(h.container.querySelectorAll('.dossier-amendment').length,2);
  await h.click('Votes');assert.equal(count(),1);assert.equal(h.container.querySelectorAll('[data-dossier-vote]').length,2);
});


test('later vote pages stay explicit at their amendment and join once when loaded',async t=>{
  const unresolved={...amendment,amendment:{...amendment.amendment,outcome:null}};
  const h=await harness(t,undefined,url=>{
    if(url.searchParams.get('section')==='amendments')return Response.json(page('amendments','257727',[unresolved]));
    if(url.searchParams.get('section')==='votes')return Response.json(url.searchParams.get('offset')==='0'?
      page('votes','257727',[rejection],{pagination:{offset:0,targetOffset:0,limit:25,next:{offset:25,targetOffset:0}}}):
      page('votes','257727',[agreement],{pagination:{offset:25,targetOffset:0,limit:25,next:null}}));
  });
  await h.render(createElement(h.module.DossierActivity,{reference}));
  assert.match(h.container.querySelector('.dossier-amendment').textContent,/Vote details not loaded/);
  assert.equal(h.container.querySelectorAll('.dossier-amendment [data-dossier-vote]').length,0);
  await h.click('Check more votes');
  const card=h.container.querySelector('.dossier-amendment');
  assert.equal(card.querySelectorAll('[data-dossier-vote]').length,1);
  assert.equal(h.container.querySelectorAll('[data-dossier-vote="'+agreement.id+'"]').length,1);
  assert.equal(card.querySelector('.explorer-amendment-card header .explorer-amendment-outcome'),null,'do not contradict the exact bound ballot with an unavailable badge');
  assert.doesNotMatch(card.textContent,/Vote details not loaded/);
  assert.equal(card.querySelector('.dossier-source[href*="data.europarl.europa.eu"]'),null,'machine-readable records are not linked');
  assert.doesNotMatch(card.querySelector('.dossier-vote>.dossier-muted').textContent,/Stage not stated/);
  assert.match(card.querySelector('.dossier-vote>.dossier-muted').textContent,/Sep 16, 2026/);
  assert.equal(h.calls.filter(url=>url.searchParams.get('section')==='votes').at(-1).searchParams.get('offset'),'25');
});

test('dossier vote bars and positions paint the shared vote tokens in both schemes',async()=>{
  const css=await readFile(new URL('./DossierActivity.css',import.meta.url),'utf8'),voteCss=await readFile(new URL('./MemberVotes.css',import.meta.url),'utf8');
  for(const scheme of ['light','dark']){
    const window=new Window({url:'http://localhost/'});
    try{
      const style=window.document.createElement('style');style.textContent=themeCss(scheme)+voteCss+css;window.document.head.append(style);
      window.document.body.innerHTML='<article class="dossier-vote"><span class="member-votes-position member-votes-position-for">For</span><span class="member-votes-bar"><span class="member-votes-for"></span><span class="member-votes-against"></span><span class="member-votes-abstaining"></span></span></article>';
      for(const [selector,token] of [['.member-votes-for','vote-for'],['.member-votes-against','vote-against'],['.member-votes-abstaining','vote-abstain']]){
        const expected=window.document.createElement('span');expected.style.backgroundColor=tokenValue(scheme,token);window.document.body.append(expected);
        assert.equal(window.getComputedStyle(window.document.querySelector(selector)).backgroundColor,window.getComputedStyle(expected).backgroundColor,scheme+' '+selector);
      }
      const position=window.getComputedStyle(window.document.querySelector('.member-votes-position-for'));
      assert(contrast(position.color,paintedBackground(window,window.document.querySelector('.dossier-vote'),scheme))>=4.5);
    }finally{await window.happyDOM.close();}
  }
});


test('an adopted split-part ballot preserves the rejected overall amendment in both exact binding shapes',async t=>{
  for(const componentOnly of [false,true])await t.test(componentOnly?'component ID only':'exact part decision ID',async t=>{
    const split={...amendment,amendment:{...amendment.amendment,outcome:'REJECTED',splitParts:[{id:'exact-part-one',number:1,description:'First part'},{id:'exact-part-two',number:2,description:'Second part'}],decisions:[{id:componentOnly?'component-source-decision':agreement.id,partId:'exact-part-one',partNumber:1,outcome:'ADOPTED'},{id:'unloaded-part-two',partId:'exact-part-two',partNumber:2,outcome:'REJECTED'}]}};
    const vote={...agreement,vote:{...agreement.vote,title:'Split part 1',context:{amendmentIds:[],componentIds:['exact-part-one']}}};
    const h=await harness(t,undefined,url=>url.searchParams.get('section')==='amendments'?Response.json(page('amendments','257727',[split])):url.searchParams.get('section')==='votes'?Response.json(page('votes','257727',[vote])):null);
    await h.render(createElement(h.module.DossierActivity,{reference}));
    const card=h.container.querySelector('.dossier-amendment');
    assert.equal(card.querySelector('.explorer-amendment-card header [data-outcome]').textContent,'Rejected');
    assert.equal(card.querySelectorAll('[data-dossier-vote]').length,1);
    assert.match(card.querySelector('.dossier-vote .member-votes-result-heading').textContent,/Adopted/);
    assert.equal(card.querySelector('.explorer-amendment-voting').tagName,'DIV','overall result and split decisions are visible without opening details');
  });
});

test('component markers without indexed parts and incomplete split coverage retain the amendment outcome',()=>{
  for(const extra of [{decisions:[{id:agreement.id,partNumber:1}]},{decisions:[{id:agreement.id,partId:'unindexed-part'}]},{decisions:[{id:agreement.id,componentBinding:'unverified'}]},{decisions:[{id:agreement.id,componentReferences:['exact-component']}]},{splitCoverageComplete:false},{splitCoverage:[{requestId:'exact-request'}]}]){
    const split={...amendment,amendment:{...amendment.amendment,...extra}};
    assert.equal(dossierVoteCards([split],[agreement]).get(split.id).showOutcome,true,JSON.stringify(extra));
  }
  const second={...amendment,id:'shared-only'};
  const cards=dossierVoteCards([amendment,second],[agreement]);
  assert.equal(cards.get(amendment.id).showOutcome,false);
  assert.equal(cards.get(second.id).showOutcome,false);
  assert.equal(cards.get(second.id).shared.length,1);
});

const rsp=JSON.parse(await readFile(new URL('../server/fixtures/dossier-no-role-rsp.json',import.meta.url),'utf8'));
const rspPage=(section,member)=>page(section,member,section==='speeches'?[rsp.speech]:[],{procedure:{id:'2026-2925',reference:rsp.procedure.label,title:rsp.procedure.process_title.en,titleLanguage:'en',source:rsp.procedureSource},participants:member?[]:[{id:rsp.personId,name:'Gabriele Bischoff',roles:[],speeches:[rsp.speech]}],coverage:{status:section==='roles'?'unavailable':'partial',gaps:section==='roles'?['Procedure role records are unavailable.']:['Checked observation is incomplete.'],sources:[rsp.procedureSource]},...(!member?{participantCoverage:{status:'partial',gaps:['Showing saved contributions linked to the checked debates.'],sources:[rsp.procedureSource]}}:{})});
test('no-role RSP opens from a cold person link, keeps speech before gaps, and full dossier finds its contributor',async t=>{
  const query='?pl-mode=dossier&dossier-ref='+encodeURIComponent(rsp.procedure.label)+'&dossier-person='+rsp.personId+'&lang=en&role=both&view=legislation';
  let failVotes=true;
  const h=await harness(t,query,url=>{
    if(!url.pathname.endsWith('dossier-activity'))return;
    const section=url.searchParams.get('section');
    if(section==='votes'&&failVotes)return Response.json({error:{message:'Unavailable'}},{status:502});
    return Response.json(rspPage(section,url.searchParams.get('member')));
  });
  await h.render(createElement(h.module.DossierActivity,{reference:rsp.procedure.label}));
  assert.equal(h.container.querySelector('.dossier-speech h4').textContent,rsp.speech.title);
  assert(h.container.innerHTML.indexOf('dossier-timeline')<h.container.innerHTML.indexOf('dossier-section-status'));
  assert.match(h.container.textContent,/Votes could not be loaded/);assert.doesNotMatch(h.container.textContent,/No linked records|No participants|rapporteur/i);
  failVotes=false;await h.click('Retry votes');assert(h.container.querySelector('.dossier-speech'));
  await h.click('Amendments');assert.match(h.container.textContent,/No matching amendments/);
  await h.click('Full dossier');assert.equal(h.container.querySelector('.dossier-participants a').textContent,'Gabriele Bischoff');assert.match(h.container.textContent,/Speeches · 1 shown/);
  await h.click('Work on this dossier');assert(h.container.querySelector('.dossier-speech'));assert.equal(new URL(location.href).searchParams.get('dossier-person'),rsp.personId);
});

test('participant pages retain speech-only people and retries never erase successful pages',async t=>{
  let fail=true;
  const h=await harness(t,'?view=legislation&pl-mode=dossier&dossier-ref='+encodeURIComponent(reference),url=>{
    if(url.searchParams.get('section')!=='roles')return;
    const later=url.searchParams.get('target-offset')==='2';
    const coverage={status:later&&fail?'unavailable':'partial',gaps:later&&fail?['Debate unavailable.']:[],sources:[source]};
    return Response.json(page('roles',null,[],{participants:later?(fail?[]:[{id:'124984',name:'Other speaker',roles:[],speeches:[speech]}]):[{id:'257727',name:'First speaker',roles:[],speeches:[speech]}],participantCoverage:coverage,coverage:{status:'complete',gaps:[],sources:[source]},pagination:{offset:0,targetOffset:later?2:0,limit:25,next:later?null:{offset:0,targetOffset:2}}}));
  });
  await h.render(createElement(h.module.DossierActivity,{reference}));await h.click('Load more people');
  assert.match(h.container.textContent,/First speaker/);assert.match(h.container.textContent,/Partial coverage/);
  fail=false;await h.click('Retry people');assert.match(h.container.textContent,/First speaker/);assert.match(h.container.textContent,/Other speaker/);assert.doesNotMatch(h.container.textContent,/Debate unavailable/);
});

test('a new person and filter restart at the first page after earlier pagination',async t=>{
  const h=await harness(t,undefined,url=>{
    if(url.searchParams.get('section')!=='speeches')return;
    const member=url.searchParams.get('member');return Response.json(page('speeches',member,[{...speech,id:'speech-'+member}],{pagination:{offset:Number(url.searchParams.get('offset')),targetOffset:0,limit:25,next:url.searchParams.get('offset')==='0'?{offset:25,targetOffset:0}:null}}));
  });
  await h.render(createElement(h.module.DossierActivity,{reference}));await h.click('Load more speeches');
  const route='?view=legislation&pl-mode=dossier&dossier-ref='+encodeURIComponent(reference)+'&dossier-person=124984';
  await h.navigate(route);await h.click('Roles');await h.click('Speeches');
  assert.equal(h.calls.filter(url=>url.searchParams.get('section')==='speeches').at(-1).searchParams.get('offset'),'0');assert.equal(h.container.querySelectorAll('.dossier-speech').length,1);
});

test('failed same-cursor contributor retry retains established speech evidence until a successful refresh',async t=>{
  let attempt=0;
  const h=await harness(t,'?view=legislation&pl-mode=dossier&dossier-ref='+encodeURIComponent(rsp.procedure.label),url=>{
    if(url.searchParams.get('section')!=='roles')return;
    const data=rspPage('roles',null);attempt++;
    if(attempt===2){data.participants=[];data.participantCoverage={status:'unavailable',retryable:true,gaps:['A linked debate is unavailable.'],sources:[rsp.procedureSource]};}
    if(attempt===3){data.participants=[];data.participantCoverage={status:'partial',retryable:false,gaps:['Showing saved contributions linked to the checked debates.'],sources:[rsp.procedureSource]};}
    return Response.json(data);
  });
  await h.render(createElement(h.module.DossierActivity,{reference:rsp.procedure.label}));
  assert.match(h.container.textContent,/Gabriele Bischoff/);await h.click('Retry people');
  assert.match(h.container.textContent,/Gabriele Bischoff/);assert.match(h.container.textContent,/Partial coverage/);assert.doesNotMatch(h.container.textContent,/Earlier records retained/);
  await h.click('Retry people');assert(!h.container.querySelector('.dossier-participants'));
});

test('partial contributor failure offers retry on its original cursor and clears the failure after recovery',async t=>{
  let failed=true;
  const h=await harness(t,'?view=legislation&pl-mode=dossier&dossier-ref='+encodeURIComponent(reference),url=>{
    if(url.searchParams.get('section')!=='roles')return;
    const later=url.searchParams.get('target-offset')==='2';
    return Response.json(page('roles',null,[],{participants:[{id:later?'124984':'257727',name:later?'Later speaker':'First speaker',roles:[],speeches:[speech]}],coverage:{status:'complete',gaps:[],sources:[source]},participantCoverage:{status:'partial',retryable:later&&failed,gaps:later&&failed?['A linked debate is unavailable.']:[],sources:[source]},pagination:{offset:0,targetOffset:later?2:0,limit:25,next:later?null:{offset:0,targetOffset:2}}}));
  });
  await h.render(createElement(h.module.DossierActivity,{reference}));await h.click('Load more people');
  assert.match(h.container.textContent,/First speaker/);assert.match(h.container.textContent,/Later speaker/);
  failed=false;await h.click('Retry people');
  assert.equal(h.calls.filter(url=>url.searchParams.get('section')==='roles').at(-1).searchParams.get('target-offset'),'2');
  assert.match(h.container.textContent,/First speaker/);assert.match(h.container.textContent,/Later speaker/);assert.doesNotMatch(h.container.textContent,/A linked debate is unavailable/);
  assert(![...h.container.querySelectorAll('button')].some(node=>node.textContent==='Retry people'));
});


test('failed contributor refresh retains only failed-debate speech evidence within its original scope',()=>{
  const oldSpeaker={id:'257727',name:'Known speaker',roles:[role],speeches:[speech]},other={id:'124984',name:'Other speaker',roles:[],speeches:[{...speech,id:'second-speech',debateId:'other-debate'}]};
  const before=page('roles',null,[],{participants:[oldSpeaker,other],participantCoverage:{status:'partial',gaps:[],sources:[source]}});
  const failed=page('roles',null,[],{participants:[],participantCoverage:{status:'partial',retryable:true,failedDebates:[speech.debateId],gaps:['A linked debate is unavailable.'],sources:[source]}});
  const kept=retainDossierContributors(before,failed);assert.deepEqual(kept.participants,[{...oldSpeaker,roles:[]}]);assert.equal(kept.participantCoverage.retained,true);
  for(const changed of [{generation:before.generation+1},{memberId:'124984'},{procedure:{...before.procedure,reference:'2026/2925(RSP)'}},{pagination:{...failed.pagination,targetOffset:2}}])assert.deepEqual(retainDossierContributors(before,{...failed,...changed}).participants,[]);
});

test('dossier participants and selected person use country only, with exact ID joins',async t=>{
 const h=await harness(t),{PersonNamesProvider}=await h.load('/src/PersonName.tsx');
 const members=[{id:257727,firstName:'Named',lastName:'member',countryCode:'HU',groupCode:'PPE'},
 {id:99,firstName:'Other',lastName:'member',countryCode:'IT',groupCode:'Renew'}];
 await h.render(createElement(PersonNamesProvider,{members},createElement(h.module.DossierActivity,{reference})));
 const chip=h.container.querySelector('.dossier-person-chip .member-affiliation');assert.equal(chip.textContent,'HUHungary');assert.equal(chip.querySelector('i'),null);
 const participants=h.container.querySelectorAll('.dossier-participants>ul>li');
 assert.equal(participants[0].querySelector('.member-affiliation').textContent,'HUHungary');
 assert.equal(participants[1].querySelector('.member-affiliation'),null,'a matching name cannot supply country');
});

test('availability disclosures keep gaps concise and source details out of the work',async t=>{
  const h=await harness(t);await h.render(createElement(h.module.DossierActivity,{reference}));
  const note=h.container.querySelector('[aria-label="Speeches coverage"] .dossier-coverage');
  assert.equal(note.tagName,'DETAILS');assert.equal(note.open,false);
  assert.equal(note.querySelector('summary').textContent,'Speeches availability');
  assert.equal(note.querySelector('li'),null);
  assert.doesNotMatch(note.textContent,/Some targets have not been checked/);
  await h.click('Speeches availability');assert.equal(note.open,true);
  assert.match(note.textContent,/Partial coverage/);
});

test('committee stage and committee filters reset the list cursor without changing speeches or roles',async t=>{
  const committeeRow=(code,number)=>({...amendment,id:`committee:${code}-AM-773343:${number}`,amendment:{...amendment.amendment,id:`committee:${code}-AM-773343:${number}`,scope:'committee',listId:code+'-AM-773343',targetDocumentId:null,targetRelationship:{status:'unavailable'},number,committees:[{code}],decisions:[]}});
  const query='?view=legislation&pl-mode=dossier&dossier-ref='+encodeURIComponent(reference)+'&dossier-person=257727&dossier-show=amendments';
  const h=await harness(t,query,url=>{
    if(url.searchParams.get('section')!=='amendments')return;
    const stage=url.searchParams.get('stage'),committee=url.searchParams.get('committee'),offset=Number(url.searchParams.get('target-offset'));
    const items=stage==='plenary'?[amendment]:committee?[committeeRow(committee,40)]:[committeeRow('AGRI',40),committeeRow('IMCO',40)];
    return Response.json(page('amendments','257727',offset?[]:items,{version:7,stage,committee:committee||null,pagination:{offset:0,targetOffset:offset,limit:25,next:offset?null:{offset:0,targetOffset:1}}}));
  });
  await h.render(createElement(h.module.DossierActivity,{reference}));await h.click('Load more amendments');
  const change=async(label,value)=>{const select=[...h.container.querySelectorAll('label')].find(node=>node.firstChild?.textContent===label)?.querySelector('select');assert(select,label);await act(async()=>{select.value=value;select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});};
  await change('Stage','committee');
  let call=h.calls.filter(url=>url.searchParams.get('section')==='amendments').at(-1);assert.equal(call.searchParams.get('stage'),'committee');assert.equal(call.searchParams.get('target-offset'),'0');
  assert.equal(h.container.querySelectorAll('[data-amendment-scope="committee"]').length,2);
  await change('Committee','IMCO');
  call=h.calls.filter(url=>url.searchParams.get('section')==='amendments').at(-1);assert.equal(call.searchParams.get('committee'),'IMCO');assert.equal(call.searchParams.get('offset'),'0');assert.equal(h.container.querySelectorAll('.dossier-amendment').length,1);
  await change('Stage','plenary');
  call=h.calls.filter(url=>url.searchParams.get('section')==='amendments').at(-1);assert.equal(call.searchParams.has('committee'),false);assert.equal(h.container.querySelectorAll('[data-amendment-scope="plenary"]').length,1);
  assert.equal(h.calls.filter(url=>url.searchParams.get('section')==='roles').length,1);assert.equal(h.calls.filter(url=>url.searchParams.get('section')==='speeches').length,0);
  await h.navigate(query+'&dossier-stage=committee&dossier-committee=AGRI');
  call=h.calls.filter(url=>url.searchParams.get('section')==='amendments').at(-1);assert.equal(call.searchParams.get('committee'),'AGRI');assert.equal(call.searchParams.get('target-offset'),'0');
});

test('amendment-only dossier participants render separate stage links and survive a failed retry',async t=>{
  let reads=0;
  const evidence={id:'committee:AGRI-AM-773343:51',scope:'committee',listId:'AGRI-AM-773343',date:'2025-05-20',source};
  const h=await harness(t,'?view=legislation&pl-mode=dossier&dossier-ref='+encodeURIComponent(reference),url=>{
    if(url.searchParams.get('section')!=='roles')return;
    return Response.json(page('roles',null,[],{participants:++reads===1?[{id:'1',name:'Amendment author',roles:[],amendments:[evidence],amendmentCounts:{committee:1,plenary:null}}]:[],participantCoverage:{status:reads===1?'partial':'unavailable',retryable:true,uncheckedTargets:['AGRI-AM-773343'],gaps:[],sources:[source]}}));
  });
  await h.render(createElement(h.module.DossierActivity,{reference}));
  assert.match(h.container.querySelector('.dossier-participants').textContent,/Amendment author/);assert.match(h.container.querySelector('.dossier-participants').textContent,/1\+ Committee amendments/);assert.doesNotMatch(h.container.querySelector('.dossier-participants').textContent,/Plenary amendments/);
  await h.click('Retry people');assert.match(h.container.querySelector('.dossier-participants').textContent,/Amendment author/);assert.match(h.container.querySelector('.dossier-participants').textContent,/1\+ Committee amendments/);
});
