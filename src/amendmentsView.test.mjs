import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {parseSplitRequest} from '../server/amendment-splits.mjs';

test('amendment reader preserves empty edits, exact split bindings, source languages and recorded parse failures',async t=>{
  const window=new Window({url:'http://localhost/?view=amendments'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const amendment={id:'B-10-2026-0424-AM-114',number:114,targetDocumentId:'B-10-2026-0424',language:'fr',originalText:'',proposedText:'Texte nouveau',outcome:'mixed',authors:[{name:'Christophe Bay',personId:'261797',method:'voting_alias'}],procedureIds:['2025-0407'],
    decisions:[{id:'exact-decision',partId:'request-one-part-1',partNumber:1,outcome:'REJECTED',totals:{for:0,against:4,abstaining:null}},{id:'unindexed-decision',partId:'unindexed-part-1',partNumber:1,outcome:'LAPSED'}],
    splitParts:[{id:'request-one-part-1',number:1,language:'en',description:'Text as a whole without the words “carbon leakage”',status:'parsed',plan:{type:'difference',base:{type:'all'},except:{type:'text',quote:'carbon leakage'}}},{id:'request-two-part-1',number:1,language:'en',description:'A future unrecognised form',status:'unresolved',failure:{code:'unsupported_syntax',message:'Description not recognised.'}}],sources:[{url:'https://data.europarl.europa.eu/fixture',language:'fr',fetchedAt:'2026-10-16T12:00:00Z'}]};
  const frenchDescription='<partValue>«politique agricole» <img src="invalid" onerror="alert(1)"/></partValue>';
  const missingEnglish=parseSplitRequest({id:'eli/dl/event/language-SPLIT-1',had_activity_type:'def/ep-activities/REQUEST_VOTE_SPLIT',created_a_realization_of:[{id:'eli/dl/doc/language-SPLIT-1-1',number:'1',numbering:1,expressionContent:{fr:frenchDescription}}]},{language:'en',sourceUrl:'https://data.europarl.europa.eu/fixture',fetchedAt:'2026-10-16T12:00:00Z'});
  assert.equal(missingEnglish.failures[0].code,'missing_language');
  amendment.splitParts.push(missingEnglish.parts[0]);
  const unidentifiedFailures=[
    {requestId:'eli/dl/event/unidentified-request',partId:null,registryPartKey:'__component__:0:one',recordKind:'component',componentIndex:0,description:'First unidentified component',language:'en',code:'missing_part_id',source:null,sourceCandidates:[{url:'https://data.europarl.europa.eu/candidate'}],provenance:'unavailable'},
    {requestId:'eli/dl/event/unidentified-request',partId:null,registryPartKey:'__component__:1:two',recordKind:'component',componentIndex:1,description:'Second unidentified component',language:'en',code:'missing_part_id'},
    {requestId:null,partId:null,registryRequestKey:'local-request-one',registryPartKey:'__request__',recordKind:'request',componentIndex:null,description:'Request without an official identifier',language:'en',code:'missing_request_id'},
    {requestId:null,partId:null,registryRequestKey:'local-request-two',registryPartKey:'__request__',recordKind:'request',componentIndex:null,description:'Another request without an official identifier',language:'en',code:'missing_request_id'},
  ];
  const calls=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);calls.push(url);
    if(url.pathname.endsWith('/amendments/failures'))return Response.json({items:[{requestId:'request-two',partId:'request-two-part-1',description:'A future unrecognised form',language:'en',code:'unsupported_syntax',message:'Description not recognised.',parserVersion:'v1',occurrences:2,status:'unresolved'},{...missingEnglish.failures[0],description:'',occurrences:1,status:'unresolved'},...unidentifiedFailures],total:6,offset:0,limit:10});
    assert(url.pathname.endsWith('/amendments'));
    assert.equal(url.searchParams.get('document'),'B-10-2026-0424');
    return Response.json({items:[amendment,{id:'AM-delete',number:115,originalText:'Texte supprimé',proposedText:'',outcome:'ADOPTED',language:'fr'},{id:'AM-unavailable',number:116,originalText:null,proposedText:null,outcome:'unavailable'},
      {id:'AM-committee',number:117,authors:[],committeeProposer:'Committee on the Environment',date:'2026-01-01',documentDate:'2026-02-02',dateBasis:'amendment-list-document',outcome:'unavailable',language:'fr',originalText:'Earlier accepted wording',proposedText:'Earlier accepted proposal',wordingRetained:true,wordingSource:{url:'https://data.europarl.europa.eu/earlier-wording',language:'en',fetchedAt:'2026-10-15T12:00:00Z'},proposerSource:{url:'https://data.europarl.europa.eu/fresh-proposer',language:'fr',fetchedAt:'2026-10-16T12:00:00Z'},metadataSource:{url:'https://data.europarl.europa.eu/fresh-metadata',language:'fr',fetchedAt:'2026-10-16T12:00:00Z'},sources:[{url:'https://data.europarl.europa.eu/committee-source',fetchedAt:'2026-10-16T12:00:00Z',date:'2026-02-02',dateBasis:'amendment-list-document'}]},
      {id:'AM-conflicted',number:118,conflicted:true,date:'2099-01-01',authors:[{name:'Arbitrary author must be hidden',personId:'42'}],originalText:'Arbitrary text must be hidden',proposedText:'Arbitrary replacement must be hidden',outcome:'unavailable',variants:[{listId:'AM-list-1',authors:[{name:'First source author',personId:'42'}],originalText:'First source original',proposedText:'First source proposal',language:'en'},{listId:'AM-list-2',committeeProposer:'Committee on Transport',originalText:'Second source original',proposedText:'Second source proposal',language:'fr'}],gaps:['Source variants conflict.']}
    ],total:5,offset:0,limit:20,coverage:{complete:false,pending:false,gaps:['English wording unavailable']},failures:{total:2,unresolved:2}});
  });
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {Amendments}=await loadModule('/src/Amendments.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(Amendments,{document:'B-10-2026-0424',language:'en'})));
  const cards=[...container.querySelectorAll('.explorer-amendment-card')];
  assert.equal(cards.length,5);
  assert.match(cards[0].textContent,/No original text \(insertion\)/);
  assert.match(cards[1].textContent,/Text deleted/);
  assert(cards[0].querySelector('ins'));assert(cards[1].querySelector('del'));
  assert.equal(cards[2].querySelector('.wording-diff'),null);
  assert.match(cards[2].textContent,/Original text unavailable/);
  assert.match(cards[2].textContent,/No outcome is recorded/);
  assert.match(container.querySelector('.explorer-amendment-coverage').textContent,/partial coverage/);
  assert.equal(cards[0].querySelector('.wording-diff').lang,'en');
  assert.equal(cards[0].querySelector('.wording-diff__columns section:nth-child(2) p').lang,'fr');
  const parts=[...cards[0].querySelectorAll('.explorer-amendment-part')];
  assert.equal(parts[0].querySelector('blockquote').lang,'en');
  assert.equal(parts[0].querySelectorAll('.explorer-amendment-decision').length,1);
  assert.match(parts[0].querySelector('.explorer-amendment-totals').textContent,/For0/);
  assert.match(parts[1].textContent,/Outcome unavailable for this part/);
  assert.equal(parts[1].querySelectorAll('.explorer-amendment-decision').length,0);
  assert.match(parts[0].querySelector('.explorer-amendment-selection').textContent,/excluding The text “carbon leakage”/);
  assert.match(parts[2].textContent,/English split description unavailable/);
  assert.equal(parts[2].querySelector('.explorer-amendment-source-description pre').lang,'fr');
  assert.equal(parts[2].querySelector('.explorer-amendment-source-description pre').textContent,frenchDescription);
  assert.equal(parts[2].querySelector('img'),null,'source markup is displayed literally, never inserted as HTML');
  assert.equal(new URL(cards[0].querySelector('.explorer-amendment-authors a').href).searchParams.get('member'),'261797');
  assert.match(cards[3].querySelector('.explorer-amendment-authors').textContent,/Tabled by Committee on the Environment/);
  assert.doesNotMatch(cards[3].textContent,/Proposers unavailable|Authors unavailable/);
  assert.match(cards[3].querySelector('.explorer-amendment-meta').textContent,/Amendment-list document date Feb 2, 2026/);
  assert.match(cards[3].querySelector('.explorer-amendment-evidence').textContent,/retrieved Oct 16, 2026/);
  assert.doesNotMatch(cards[3].textContent,/Jan 1, 2026/);
  assert.equal(cards[3].querySelector('.wording-diff').lang,'en','retained wording keeps its actual language independently of fresh metadata');
  assert.equal(cards[3].querySelector('.wording-diff__passage').lang,'en');
  assert.match(cards[3].textContent,/Showing previously indexed wording/);
  assert.match(cards[3].textContent,/Retained wording source: official document · EN ↗ · retrieved Oct 15, 2026/);
  assert.match(cards[3].textContent,/Proposer source: official document · FR ↗ · retrieved Oct 16, 2026/);
  assert.match(cards[4].querySelector('.explorer-amendment-conflict').textContent,/Conflicting source variants/);
  assert.equal(cards[4].querySelectorAll('.explorer-amendment-variant').length,2);
  assert.equal(cards[4].querySelector('.explorer-amendment-authors'),null);
  assert.equal(cards[4].querySelector('.explorer-amendment-wording'),null);
  assert.doesNotMatch(cards[4].textContent,/Arbitrary|2099/);
  assert.match(cards[4].querySelector('.explorer-amendment-variants').textContent,/First source author/);
  const failureDetails=container.querySelector('.explorer-amendment-failures');
  await act(async()=>{failureDetails.open=true;failureDetails.dispatchEvent(new window.Event('toggle'));});
  assert.equal(calls.filter(url=>url.pathname.endsWith('/amendments/failures')).length,1);
  assert.match(failureDetails.textContent,/A future unrecognised form/);
  assert.match(failureDetails.textContent,/2 recorded occurrences/);
  const missingFailure=[...failureDetails.querySelectorAll('.explorer-amendment-failure-list>li')].find(row=>row.textContent.includes('language-SPLIT-1-1'));
  assert.match(missingFailure.textContent,/English split description unavailable/);
  assert.match(missingFailure.textContent,/FR · source description/);
  assert.equal(missingFailure.querySelector('pre').lang,'fr');
  assert.equal(missingFailure.querySelector('pre').textContent,frenchDescription);
  assert.equal(missingFailure.querySelector('img'),null);
  const failureHeadings=[...failureDetails.querySelectorAll('.explorer-amendment-failure-list>li>strong')].map(heading=>heading.textContent);
  assert.deepEqual(failureHeadings.slice(-4),['Unidentified split component 1','Unidentified split component 2','Split request failure','Split request failure']);
  assert.match(failureDetails.textContent,/Official request identifier unavailable/);
  assert.doesNotMatch(failureDetails.textContent,/__component__|__request__|local-request-/,'local registry keys are never presented as official IDs');
});

test('refresh removes a corrected decision binding when split descriptions are unavailable',async t=>{
  const window=new Window({url:'http://localhost/?view=amendments'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root,reads=0;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const evidence={source:null,sourceCandidates:[{url:'https://data.europarl.europa.eu/possible-decision-page'}],provenance:'unavailable'};
  const first={id:'same-official-decision',partId:'eli/dl/doc/request-SPLIT-1-1',outcome:'ADOPTED',...evidence};
  const second={id:'same-official-decision',partId:'eli/dl/doc/request-SPLIT-1-2',outcome:'REJECTED',...evidence};
  t.mock.method(globalThis,'fetch',async input=>{
    assert(new URL(input,window.location.href).pathname.endsWith('/amendments'));
    const decisions=++reads===1?[first,second]:[second];
    return Response.json({items:[{id:'A-10-2026-0254-AM-1',number:1,targetDocumentId:'A-10-2026-0254',splitParts:[],decisions,outcome:reads===1?'mixed':'REJECTED'}],total:1,offset:0,limit:20,coverage:{complete:false,pending:false,gaps:['Split descriptions unavailable.']}});
  });
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {Amendments}=await loadModule('/src/Amendments.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(Amendments,{document:'A-10-2026-0254',showFailures:false})));
  assert.equal(container.querySelectorAll('.explorer-amendment-decision').length,2);
  assert.equal(container.querySelectorAll('.explorer-amendment-decision [data-outcome="ADOPTED"]').length,1);
  assert.equal(container.querySelectorAll('.explorer-amendment-decision a').length,0,'candidate pages are not rendered as exact decision sources');
  assert.match(container.querySelector('.explorer-amendment-decision').textContent,/Exact decision source page unavailable/);
  await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='Refresh').click());
  assert.equal(reads,2);
  assert.equal(container.querySelectorAll('.explorer-amendment-decision').length,1);
  assert.equal(container.querySelectorAll('.explorer-amendment-decision [data-outcome="ADOPTED"]').length,0,'the removed binding cannot leave an adopted row mounted');
  assert.equal(container.querySelectorAll('.explorer-amendment-decision [data-outcome="REJECTED"]').length,1);
});
