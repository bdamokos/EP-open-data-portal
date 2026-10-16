import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

for(const language of ['en','hu','fr'])test(`${language}: source-variant author matches and incomplete split bindings retain their evidence scope`,async t=>{
  const window=new Window({url:'http://localhost/?view=amendments'});
  window.document.documentElement.lang=language;
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();
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
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocAmendments}=await vite.ssrLoadModule('/src/PocAmendments.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocAmendments,{member:'42',language,showFailures:false})));
  const card=id=>container.querySelector('#amendment-'+id);
  const evidence=card('normal-evidence').querySelector('.poc-amendment-author-evidence');
  assert.match(evidence.textContent,/Official voting-record alias with an active mandate/);
  assert.match(evidence.textContent,/individual amendment document/);
  assert.equal(evidence.querySelector('time').lang,language);
  assert.equal(evidence.querySelector('time').textContent,new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(proposerDate)));
  assert.equal(evidence.querySelector('span').getAttribute('lang'),'','names have no inferred language');
  assert.equal(evidence.closest('[lang]').getAttribute('lang'),'en');
  const unknown=card('missing-date-evidence').querySelector('.poc-amendment-author-evidence');
  assert.match(unknown.textContent,/Recorded method legacy_recorded_method/);
  assert.match(unknown.textContent,/supported proposer date unavailable/);
  assert.equal(unknown.querySelector('time'),null,'neither metadata, target nor retrieval dates become author-resolution dates');
  const conflict=card('variant-evidence');
  assert.match(conflict.querySelector('.poc-amendment-conflict').textContent,/supported source-variant evidence.*Combined proposer attribution remains withheld/s);
  assert.equal(conflict.querySelector('.poc-amendment-authors'),null);
  assert.doesNotMatch(conflict.textContent,/Withheld aggregate/);
  const variants=[...conflict.querySelectorAll('.poc-amendment-variant')];assert.equal(variants.length,2);
  for(const variant of variants){
    assert.match(variant.textContent,/Matches the selected MEP author through this source variant/);
    assert.match(variant.querySelector('.poc-amendment-author-evidence').textContent,/proposer date/);
    assert.equal(variant.querySelector('.poc-amendment-author-evidence time').lang,language);
  }
  assert.match(variants[0].textContent,/amendment-list document/);assert.match(variants[1].textContent,/amendment-list metadata/);
  const split=card('incomplete-split');
  assert.equal(split.querySelector('header [data-outcome]').dataset.outcome,'unavailable');
  assert.match(split.textContent,/Split-request coverage is incomplete/);
  assert.match(split.textContent,/2 source components · 1 recorded references · 1 verified bindings · incomplete/);
  assert.doesNotMatch(split.textContent,/local-key-not-an-official-reference/);
  assert.equal(split.querySelectorAll('.poc-amendment-part').length,1,'unbound siblings never become assigned parts');
  assert.match(split.querySelector('.poc-amendment-part').textContent,/Outcome unavailable for this part/);
  const decision=split.querySelector('.poc-amendment-decision');
  assert.equal(decision.querySelector('strong').textContent,'Collective decision');
  assert.equal(decision.querySelector('[data-outcome]').dataset.outcome,'ADOPTED','the recorded collective outcome stays visible');
  assert.match(decision.textContent,/not bound to an individual amendment’s split part/);
  assert.match(decision.textContent,/eli\/dl\/doc\/request-one-part-1/);
  assert.equal(decision.querySelector('a'),null,'candidate provenance never becomes an invented source hyperlink');
  const collectiveReferences=[...decision.querySelectorAll('.poc-amendment-collective-references li')];
  assert.deepEqual(collectiveReferences.map(node=>node.textContent),['eli/dl/doc/A-10-2026-0254-AM-1','eli/dl/doc/B-10-2026-0424-AM-2'],'the full recorded subject list includes co-decided amendments from other targets');
  assert(collectiveReferences.every(node=>node.getAttribute('lang')===''));
  assert.equal(decision.querySelector('.poc-amendment-collective-references a'),null,'public identifiers are not converted into guessed hyperlinks');
  const unverified=card('unverified-component').querySelector('.poc-amendment-decision');
  assert.equal(unverified.querySelector('strong').textContent,'Unverified split-component decision');
  assert.match(unverified.textContent,/not a verified outcome for an individual part/);
  const retained=card('retained-variant-match');
  assert.match(retained.textContent,/supported source-variant evidence/);
  assert.match(retained.querySelector('.poc-amendment-variant').textContent,/Matches the selected MEP author/);
  assert.match(retained.querySelector('.poc-amendment-authors').textContent,/Current aggregate author/);
  assert.doesNotMatch(retained.textContent,/Combined proposer attribution remains withheld|Conflicting source variants/,'independently retained variants do not invent a source conflict');
  assert.match(container.querySelector('.poc-amendment-group-heading').textContent,/First recorded procedure reference/);
  assert.match(card('normal-evidence').querySelector('.poc-amendment-evidence').textContent,/Recorded procedure references: 2025-0407, 2025-0408/);
  const grouping=container.querySelectorAll('.poc-amendment-controls select')[1];
  await act(async()=>{grouping.value='topic';grouping.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.match(container.querySelector('.poc-amendment-group-heading').textContent,/First recorded topic/);
  assert.match(card('normal-evidence').querySelector('.poc-amendment-evidence').textContent,/Additional recorded subject/);
});
