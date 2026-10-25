import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

for(const language of ['en','hu','fr'])test(`${language}: conflicting versions and incomplete split bindings never invent assignments`,async t=>{
  const window=new Window({url:'http://localhost/?view=amendments'});
  window.document.documentElement.lang=language;
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const name='Ágnes Source',proposerDate='2026-10-06';
  const author={name,personId:'42',method:'official_voting_alias_active_mandate',status:'resolved'};
  const base={targetDocumentId:'A-10-2026-0254',procedureIds:['2025-0407','2025-0408'],outcome:'unavailable',topics:[{id:'subject-1',label:'First recorded subject',basis:'dossier'},{id:'subject-2',label:'Additional recorded subject',basis:'dossier'}]};
  const items=[
    {...base,id:'normal-evidence',number:1,authors:[author],proposerDate,proposerDateBasis:'individual-amendment-document',documentDate:'2026-10-07',dateBasis:'individual-amendment-document'},
    {...base,id:'missing-date-evidence',number:2,authors:[{...author,method:'legacy_recorded_method'}],date:'2099-01-01',documentDate:'2026-10-07',dateBasis:'individual-amendment-document',proposerDate:null,proposerDateBasis:null,proposerSource:{url:'https://data.europarl.europa.eu/retrieval-is-not-a-proposer-date',fetchedAt:'2026-10-08'}},
    {...base,id:'variant-evidence',number:3,conflicted:true,authors:[{name:'Withheld aggregate author',personId:'999'}],originalText:'Withheld aggregate wording',proposedText:'Withheld aggregate replacement',authorMatch:{memberId:'42',basis:'variant',variantListIds:['list-one','list-two']},variants:[
      {listId:'list-one',authors:[author],proposerDate,proposerDateBasis:'amendment-list-document',originalText:'Première source',proposedText:'Première proposition',language:'fr'},
      {listId:'list-two',authors:[{...author,method:'exact_full_name_active_mandate'}],proposerDate,proposerDateBasis:'amendment-list-metadata',originalText:'Második forrás',proposedText:'Második javaslat',language:'hu'},
    ]},
    {...base,id:'incomplete-split',number:4,outcomeProofVersion:1,splitCoverageComplete:false,splitCoverage:[{requestId:'eli/dl/doc/request-one',registryRequestKey:'local-key-not-an-official-reference',componentCount:2,componentIds:['eli/dl/doc/request-one-part-1','eli/dl/doc/request-one-part-2'],recordedComponentCount:1,recordedComponentIds:['eli/dl/doc/request-one-part-1'],boundComponentCount:1,boundComponentIds:['eli/dl/doc/request-one-part-1'],unboundComponentCount:1,complete:false}],splitParts:[{id:'eli/dl/doc/request-one-part-1',number:1,description:'The first part.',language:'en'}],decisions:[
      {id:'collective-decision',collective:true,amendmentIds:['eli/dl/doc/A-10-2026-0254-AM-1','eli/dl/doc/B-10-2026-0424-AM-2'],componentBinding:'unresolved-collective',componentReferences:['eli/dl/doc/request-one-part-1'],outcome:'ADOPTED',source:null,sourceCandidates:[{url:'https://data.europarl.europa.eu/candidate-only'}],provenance:'unavailable'},
    ]},
    {...base,id:'unverified-component',number:5,decisions:[{id:'unverified-decision',componentBinding:'unverified',componentReferences:['eli/dl/doc/unverified-component'],outcome:'REJECTED'}]},
    {...base,id:'retained-variant-match',number:6,authors:[{name:'Current aggregate author',personId:'24'}],authorMatch:{memberId:'42',basis:'variant',variantListIds:['retained-list']},variants:[{listId:'retained-list',authors:[author],proposerDate,proposerDateBasis:'amendment-list-document'}]},
  ];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);assert(url.pathname.endsWith('/amendments'));assert.equal(url.searchParams.get('member'),'42');
    return Response.json({items,total:items.length,offset:0,limit:20,coverage:{complete:false,pending:false,gaps:[]}});
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {Amendments}=await loadModule('/src/Amendments.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(Amendments,{member:'42',language})));
  const card=id=>container.querySelector('#amendment-'+id);
  assert.equal(container.querySelector('.explorer-amendment-author-evidence'),null,'author-match methods are not shown');
  const conflict=card('variant-evidence');
  assert.match(conflict.querySelector('.explorer-amendment-conflict').textContent,/Conflicting source versions\. Wording and proposers unavailable\./);
  assert.equal(conflict.querySelector('.explorer-amendment-authors'),null);
  assert.doesNotMatch(conflict.textContent,/Withheld aggregate/);
  const variants=[...conflict.querySelectorAll('.explorer-amendment-variant')];assert.equal(variants.length,2);
  const split=card('incomplete-split');
  assert.equal(split.querySelector('header [data-outcome]').dataset.outcome,'unavailable');
  assert.doesNotMatch(split.textContent,/Split-request coverage|verified bindings|local-key-not-an-official-reference/);
  assert.equal(split.querySelectorAll('.explorer-amendment-part').length,1,'unbound siblings never become assigned parts');
  assert.match(split.querySelector('.explorer-amendment-part').textContent,/Outcome unavailable for this part/);
  const decision=split.querySelector('.explorer-amendment-decision');
  assert.equal(decision.querySelector('strong').textContent,'Collective decision');
  assert.equal(decision.querySelector('[data-outcome]').dataset.outcome,'ADOPTED','the recorded collective outcome stays visible');
  assert.match(decision.textContent,/eli\/dl\/doc\/request-one-part-1/);
  assert.equal(decision.querySelector('a'),null,'candidate provenance never becomes an invented source hyperlink');
  const collectiveReferences=[...decision.querySelectorAll('.explorer-amendment-collective-references li')];
  assert.deepEqual(collectiveReferences.map(node=>node.textContent),['eli/dl/doc/A-10-2026-0254-AM-1','eli/dl/doc/B-10-2026-0424-AM-2'],'the full recorded subject list includes co-decided amendments from other targets');
  assert(collectiveReferences.every(node=>node.getAttribute('lang')===''));
  const unverified=card('unverified-component').querySelector('.explorer-amendment-decision');
  assert.equal(unverified.querySelector('strong').textContent,'Split decision');
  const retained=card('retained-variant-match');
  assert.match(retained.querySelector('.explorer-amendment-authors').textContent,/Current aggregate author/);
  assert.equal(retained.querySelectorAll('.explorer-amendment-variant').length,1);
  assert.doesNotMatch(retained.textContent,/Conflicting source versions/,'independently retained variants do not invent a source conflict');
  assert.match(container.querySelector('.explorer-amendment-group-heading').textContent,/on this page/);
  assert.match(card('normal-evidence').querySelector('.explorer-amendment-evidence').textContent,/Procedures: 2025-0407, 2025-0408/);
  const grouping=container.querySelectorAll('.explorer-amendment-controls select')[1];
  await act(async()=>{grouping.value='topic';grouping.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.match(card('normal-evidence').querySelector('.explorer-amendment-evidence').textContent,/Additional recorded subject/);
});
