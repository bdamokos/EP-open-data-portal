import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {parseSplitRequest} from '../server/amendment-splits.mjs';

test('amendment reader preserves empty edits, exact split bindings, source languages and recorded parse failures',async t=>{
  const window=new Window({url:'http://localhost/?view=amendments'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(vite)await vite.close();
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
  const calls=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);calls.push(url);
    if(url.pathname.endsWith('/amendments/failures'))return Response.json({items:[{requestId:'request-two',partId:'request-two-part-1',description:'A future unrecognised form',language:'en',code:'unsupported_syntax',message:'Description not recognised.',parserVersion:'v1',occurrences:2,status:'unresolved'},{...missingEnglish.failures[0],description:'',occurrences:1,status:'unresolved'}],total:2,offset:0,limit:10});
    assert(url.pathname.endsWith('/amendments'));
    assert.equal(url.searchParams.get('document'),'B-10-2026-0424');
    return Response.json({items:[amendment,{id:'AM-delete',number:115,originalText:'Texte supprimé',proposedText:'',outcome:'ADOPTED',language:'fr'},{id:'AM-unavailable',number:116,originalText:null,proposedText:null,outcome:'unavailable'},
      {id:'AM-committee',number:117,authors:[],committeeProposer:'Committee on the Environment',date:'2026-01-01',documentDate:'2026-02-02',dateBasis:'amendment-list-document',outcome:'unavailable',sources:[{url:'https://data.europarl.europa.eu/committee-source',fetchedAt:'2026-10-16T12:00:00Z',date:'2026-02-02',dateBasis:'amendment-list-document'}]},
      {id:'AM-conflicted',number:118,conflicted:true,date:'2099-01-01',authors:[{name:'Arbitrary author must be hidden',personId:'42'}],originalText:'Arbitrary text must be hidden',proposedText:'Arbitrary replacement must be hidden',outcome:'unavailable',variants:[{listId:'AM-list-1',authors:[{name:'First source author',personId:'42'}],originalText:'First source original',proposedText:'First source proposal',language:'en'},{listId:'AM-list-2',committeeProposer:'Committee on Transport',originalText:'Second source original',proposedText:'Second source proposal',language:'fr'}],gaps:['Source variants conflict.']}
    ],total:5,offset:0,limit:20,coverage:{complete:false,pending:false,gaps:['English wording unavailable']},failures:{total:2,unresolved:2}});
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocAmendments}=await vite.ssrLoadModule('/src/PocAmendments.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocAmendments,{document:'B-10-2026-0424',language:'en'})));
  const cards=[...container.querySelectorAll('.poc-amendment-card')];
  assert.equal(cards.length,5);
  assert.match(cards[0].textContent,/No original text \(insertion\)/);
  assert.match(cards[1].textContent,/Text deleted/);
  assert.match(cards[2].textContent,/Original text unavailable/);
  assert.match(cards[2].textContent,/No outcome is recorded/);
  assert.match(container.querySelector('.poc-amendment-coverage').textContent,/partial coverage/);
  assert.equal(cards[0].querySelector('.poc-amendment-texts').lang,'fr');
  const parts=[...cards[0].querySelectorAll('.poc-amendment-part')];
  assert.equal(parts[0].querySelector('blockquote').lang,'en');
  assert.equal(parts[0].querySelectorAll('.poc-amendment-decision').length,1);
  assert.match(parts[0].querySelector('.poc-amendment-totals').textContent,/For0/);
  assert.match(parts[1].textContent,/Outcome unavailable for this part/);
  assert.equal(parts[1].querySelectorAll('.poc-amendment-decision').length,0);
  assert.match(parts[0].querySelector('.poc-amendment-selection').textContent,/excluding The text “carbon leakage”/);
  assert.match(parts[2].textContent,/English split description unavailable/);
  assert.equal(parts[2].querySelector('.poc-amendment-source-description pre').lang,'fr');
  assert.equal(parts[2].querySelector('.poc-amendment-source-description pre').textContent,frenchDescription);
  assert.equal(parts[2].querySelector('img'),null,'source markup is displayed literally, never inserted as HTML');
  assert.equal(new URL(cards[0].querySelector('.poc-amendment-authors a').href).searchParams.get('member'),'261797');
  assert.match(cards[3].querySelector('.poc-amendment-authors').textContent,/Tabled by Committee on the Environment/);
  assert.doesNotMatch(cards[3].textContent,/Proposers unavailable|Authors unavailable/);
  assert.match(cards[3].querySelector('.poc-amendment-meta').textContent,/Amendment-list document date Feb 2, 2026/);
  assert.match(cards[3].querySelector('.poc-amendment-evidence').textContent,/retrieved Oct 16, 2026/);
  assert.doesNotMatch(cards[3].textContent,/Jan 1, 2026/);
  assert.match(cards[4].querySelector('.poc-amendment-conflict').textContent,/Conflicting source variants/);
  assert.equal(cards[4].querySelectorAll('.poc-amendment-variant').length,2);
  assert.equal(cards[4].querySelector('.poc-amendment-authors'),null);
  assert.equal(cards[4].querySelector('.poc-amendment-wording'),null);
  assert.doesNotMatch(cards[4].textContent,/Arbitrary|2099/);
  assert.match(cards[4].querySelector('.poc-amendment-variants').textContent,/First source author/);
  const failureDetails=container.querySelector('.poc-amendment-failures');
  await act(async()=>{failureDetails.open=true;failureDetails.dispatchEvent(new window.Event('toggle'));});
  assert.equal(calls.filter(url=>url.pathname.endsWith('/amendments/failures')).length,1);
  assert.match(failureDetails.textContent,/A future unrecognised form/);
  assert.match(failureDetails.textContent,/2 recorded occurrences/);
  const missingFailure=[...failureDetails.querySelectorAll('.poc-amendment-failure-list>li')].find(row=>row.textContent.includes('language-SPLIT-1-1'));
  assert.match(missingFailure.textContent,/English split description unavailable/);
  assert.match(missingFailure.textContent,/FR · source description/);
  assert.equal(missingFailure.querySelector('pre').lang,'fr');
  assert.equal(missingFailure.querySelector('pre').textContent,frenchDescription);
  assert.equal(missingFailure.querySelector('img'),null);
});
