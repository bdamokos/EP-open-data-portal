import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const effectiveLanguage=node=>node?.closest('[lang]')?.getAttribute('lang');
const source=(language,name)=>({url:'https://data.europarl.europa.eu/'+name,language,fetchedAt:'2026-10-16T12:00:00Z'});
const fmt=(value,language)=>new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value));

for(const locale of ['en','hu','fr'])test(`${locale}: amendment controls, source roles, empty wording, variants and parser evidence retain their actual languages`,async t=>{
  const window=new Window({url:'http://localhost/?view=amendments'});window.document.documentElement.lang=locale;
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const base={targetDocumentId:'A-10-2026-0254',procedureIds:['2025-0407'],outcome:'unavailable'};
  const items=[
    {...base,id:'known-fr',number:1,title:'API-selected title',titles:{en:'English dossier',hu:'Magyar dosszié',fr:'Dossier français'},language:'hu',originalText:'Ancien texte français',proposedText:'Nouveau texte français',wordingSource:source('fr','wording'),metadataSource:source('hu','metadata'),proposerSource:source('fr','proposer'),targetLabel:'1. cikk',targetLabelLanguage:'hu',committeeProposer:'Commission de l’environnement',onBehalfOf:'Renew Europe',authors:[{name:'Ágnes Source',personId:'42'},{name:'Nom non résolu',personId:null}],documentDate:'2026-10-06',listDocumentDate:'2026-10-07',dateBasis:'amendment-list-document',sources:[{...source('fr','document'),date:'2026-10-01',dateBasis:'amendment-list-document'}],decisions:[{id:'decision-1',outcome:'ADOPTED',date:'2026-10-07',method:'VOTE_HAND',totals:{for:1000,against:0,abstaining:null}}],splitParts:[
      {id:'split-fr',number:1,description:'Description française',language:'fr',status:'parsed',plan:{type:'text',quote:'mot français'}},
      {id:'split-unknown',number:2,description:'Legacy unlabelled description',status:'parsed',plan:{type:'text',quote:'legacy phrase'}},
    ]},
    {...base,id:'deleted',number:2,language:'fr',originalText:'Texte supprimé',proposedText:''},
    {...base,id:'inserted',number:3,language:'hu',originalText:'',proposedText:'Új szöveg'},
    {...base,id:'unavailable',number:4,language:'fr',originalText:null,proposedText:null},
    {...base,id:'unknown',number:5,title:'Unlabelled title',originalText:'Unlabelled original',proposedText:'Unlabelled proposed'},
    {...base,id:'explicit-unknown',number:6,title:'Titre de repli',titles:{fr:'Titre de repli'},language:'fr',wordingSource:null,metadataSource:null,originalText:'Earlier unlabelled original',proposedText:'Earlier unlabelled proposed'},
    {...base,id:'mixed',number:7,language:'mul',originalText:'Mixed source',proposedText:'Mixed proposal'},
    {...base,id:'undetermined',number:8,language:'und',originalText:'Undetermined source',proposedText:'Undetermined proposal'},
    {...base,id:'variants',number:9,conflicted:true,variants:[
      {listId:'variant-fr',language:'hu',wordingSource:source('fr','variant-wording'),metadataSource:source('hu','variant-metadata'),proposerSource:source('fr','variant-proposer'),originalText:'Original français de la variante',proposedText:'Proposition française de la variante',targetLabel:'2. cikk',targetLabelLanguage:'hu',committeeProposer:'Commission des transports',onBehalfOf:'Renew Europe',authors:[{name:'Source Variant',personId:null}],documentDate:'2026-10-06',dateBasis:'individual-amendment-document'},
      {listId:'variant-unknown',originalText:'Unknown variant original',proposedText:'Unknown variant proposed'},
      {listId:'variant-empty',language:'fr',originalText:'',proposedText:''},
      {listId:'variant-unavailable',language:'fr',originalText:null,proposedText:null},
      {listId:'variant-mul',language:'mul',originalText:'Mixed variant original',proposedText:'Mixed variant proposed'},
      {listId:'variant-und',language:'und',originalText:'Undetermined variant original',proposedText:'Undetermined variant proposed'},
    ]},
  ];
  const failures=[
    {requestId:'request-fr',partId:'failure-fr',description:'',language:'en',code:'missing_language',message:'The requested language has no split description.',sourceDescriptions:{fr:'<partValue>«politique»</partValue>',mul:'<partValue>Mixed source</partValue>',und:'<partValue>Undetermined source</partValue>'},lastSeen:'2026-10-10T12:00:00Z'},
    {requestId:'request-unknown',partId:'failure-unknown',description:'',language:null,rawDescription:'<partValue>Unlabelled fragment</partValue>',message:'Unreadable source.',lastSeen:'2026-10-11T12:00:00Z'},
  ];
  const calls=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);calls.push(url);
    if(url.pathname.endsWith('/directory'))return Response.json({members:[{id:42,firstName:'Ágnes',lastName:'Source'}],index:{complete:true}});
    assert.equal(url.searchParams.get('lang'),locale);
    if(url.pathname.endsWith('/amendments/failures'))return Response.json({items:failures,total:2,offset:0,limit:10});
    assert(url.pathname.endsWith('/amendments'));
    const selected=items.map(item=>item.titles?{...item,title:item.titles[locale]||item.titles.en||Object.values(item.titles)[0]}:item);
    return Response.json({items:selected,total:items.length,offset:0,limit:20,coverage:{complete:false,pending:false,gaps:['Some sources unavailable.'],lastUpdated:'2026-10-16T12:00:00Z'},failures:{total:2,unresolved:2}});
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {AmendmentsPage,Amendments}=await vite.ssrLoadModule('/src/Amendments.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(AmendmentsPage,{language:locale,onBack(){}})));
  await act(async()=>{for(const button of container.querySelectorAll('.wording-diff button'))if(button.textContent==='Side by side')button.click();});
  const card=id=>container.querySelector('#amendment-'+id),wording=(row,index)=>row.querySelectorAll('.explorer-amendment-texts section>p,.wording-diff__columns section>p')[index];
  assert.equal(document.documentElement.lang,locale);
  assert.equal(effectiveLanguage(container.querySelector('main')),locale);
  for(const control of container.querySelectorAll('.explorer-amendment-finder button,.explorer-amendment-finder input,.explorer-amendment-finder select,.explorer-amendment-controls select,.explorer-amendment-pagination button'))assert.equal(effectiveLanguage(control),'en');
  assert.equal(effectiveLanguage(container.querySelector('.explorer-amendment-finder option[value="42"]')),'');
  assert.equal(effectiveLanguage(card('known-fr').querySelector('.explorer-amendment-title')),locale);
  assert.equal(card('known-fr').querySelector('.explorer-amendment-title').textContent,items[0].titles[locale]);
  assert.equal(effectiveLanguage(card('unknown').querySelector('.explorer-amendment-title')),'');
  assert.equal(effectiveLanguage(card('explicit-unknown').querySelector('.explorer-amendment-title')),'fr');
  assert.equal(effectiveLanguage(card('known-fr').querySelector('.explorer-amendment-target')),'hu');
  assert.equal(effectiveLanguage(card('known-fr').querySelector('.explorer-amendment-authors a span')),'');
  assert.equal(effectiveLanguage(card('known-fr').querySelector('.explorer-amendment-authors small')),'en');
  const proposer=[...card('known-fr').querySelectorAll('.explorer-amendment-authors p span')];
  assert.deepEqual(proposer.map(effectiveLanguage),['fr','']);
  for(const row of container.querySelectorAll('.explorer-amendment-card'))for(const label of row.querySelectorAll('.wording-diff h5,.explorer-amendment-texts h5,.explorer-amendment-wording summary,.explorer-amendment-evidence summary'))assert.equal(effectiveLanguage(label),'en');
  assert.equal(effectiveLanguage(wording(card('known-fr'),0)),'fr');assert.equal(effectiveLanguage(wording(card('known-fr'),1)),'fr');
  assert.equal(effectiveLanguage(wording(card('deleted'),1)),'en');assert.equal(wording(card('deleted'),1).textContent,'Text deleted.');
  assert.equal(effectiveLanguage(wording(card('inserted'),0)),'en');assert.equal(effectiveLanguage(wording(card('inserted'),1)),'hu');
  for(const paragraph of card('unavailable').querySelectorAll('.explorer-amendment-texts p'))assert.equal(effectiveLanguage(paragraph),'en');
  for(const id of ['unknown','explicit-unknown'])for(const paragraph of card(id).querySelectorAll('.wording-diff__passage'))assert.equal(effectiveLanguage(paragraph),'');
  assert.equal(effectiveLanguage(wording(card('mixed'),0)),'mul');assert.equal(effectiveLanguage(wording(card('undetermined'),0)),'und');
  const parts=card('known-fr').querySelectorAll('.explorer-amendment-part');
  assert.equal(effectiveLanguage(parts[0].querySelector('blockquote')),'fr');assert.equal(effectiveLanguage(parts[1].querySelector('blockquote')),'');
  for(const part of parts){assert.equal(effectiveLanguage(part.querySelector('.explorer-amendment-selection strong')),'en');assert.equal(effectiveLanguage(part.querySelector('.explorer-amendment-selection li')),'en');}
  assert.equal(effectiveLanguage(parts[0].querySelector('.explorer-amendment-selection li span')),'fr');assert.equal(effectiveLanguage(parts[1].querySelector('.explorer-amendment-selection li span')),'');
  const variants=card('variants').querySelectorAll('.explorer-amendment-variant');
  assert.equal(effectiveLanguage(wording(variants[0],0)),'fr');assert.equal(effectiveLanguage(variants[0].querySelector('p[lang="hu"]')),'hu');
  assert.equal(effectiveLanguage(wording(variants[1],0)),'');
  for(const index of [2,3])for(const paragraph of variants[index].querySelectorAll('.explorer-amendment-texts p'))assert.equal(effectiveLanguage(paragraph),'en');
  assert.equal(effectiveLanguage(wording(variants[4],0)),'mul');assert.equal(effectiveLanguage(wording(variants[5],0)),'und');
  const grouping=container.querySelectorAll('.explorer-amendment-controls select')[1];
  await act(async()=>{grouping.value='target';grouping.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const targetHeading=[...container.querySelectorAll('.explorer-amendment-group-heading h3 span')].find(node=>node.textContent==='1. cikk');
  assert.equal(effectiveLanguage(targetHeading),'hu');
  await act(async()=>{grouping.value='topic';grouping.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(container.querySelector('.explorer-amendment-group-heading h3').textContent,'Topic unavailable');
  assert.equal(effectiveLanguage(container.querySelector('.explorer-amendment-group-heading h3')),'en');
  await act(async()=>{grouping.value='dossier';grouping.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const failureDetails=container.querySelector('.explorer-amendment-failures');
  await act(async()=>{failureDetails.open=true;failureDetails.dispatchEvent(new window.Event('toggle'));});
  assert.equal(effectiveLanguage(failureDetails.querySelector('summary')),'en');
  const failureRows=failureDetails.querySelectorAll('.explorer-amendment-failure-list>li');
  assert.equal(effectiveLanguage(failureRows[0].querySelector('.explorer-amendment-description-fallback>p')),'en');
  assert.deepEqual([...failureRows[0].querySelectorAll('pre')].map(effectiveLanguage),['fr','mul','und']);
  assert.equal(effectiveLanguage(failureRows[1].querySelector('pre')),'');
  for(const scope of ['.explorer-amendment-card>.explorer-amendment-meta','.explorer-amendment-decision','.explorer-amendment-evidence','.explorer-amendment-variant','.explorer-amendment-coverage','.explorer-amendment-failure-list']){
    const dates=[...container.querySelectorAll(scope+' time')];assert(dates.length,scope);
    for(const date of dates){assert.equal(effectiveLanguage(date),locale);assert.equal(effectiveLanguage(date.parentElement),'en');}
  }
  assert.equal(card('known-fr').querySelector(':scope>.explorer-amendment-meta time').textContent,fmt('2026-10-06',locale));
  assert.equal(container.querySelector('.explorer-amendment-coverage time').textContent,fmt('2026-10-16',locale));
  assert.equal(failureRows[0].querySelector('time').textContent,fmt('2026-10-10',locale));
  const authorSelect=container.querySelector('.explorer-amendment-finder select');
  await act(async()=>{authorSelect.value='42';authorSelect.dispatchEvent(new window.Event('change',{bubbles:true}));});
  await act(async()=>container.querySelector('.explorer-amendment-finder').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(effectiveLanguage(container.querySelector('.explorer-amendment-section-heading h2')),'en');
  assert.equal(effectiveLanguage(container.querySelector('.explorer-amendment-section-heading h2 span')),'');
  assert(calls.some(url=>url.pathname.endsWith('/amendments')&&url.searchParams.get('member')==='42'));
  await act(async()=>root.render(createElement('div',{lang:locale},createElement(Amendments,{language:locale,document:'A-10-2026-0254',heading:'Amendments tabled',showFailures:false}))));
  assert.equal(effectiveLanguage(container.querySelector('.explorer-amendment-section-heading h2')),'en','embedded MEP trails do not inherit the selected locale for English UI');
});
