import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {sourceAvailability} from '../server/source-availability.mjs';

test('coverage names concrete gaps without inferring missing records from dates or maturity',async t=>{
  const window=new Window({url:'http://localhost/'}),globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {AvailabilityNote}=await load('/src/AvailabilityNote.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const render=(source,options={})=>act(async()=>root.render(createElement(AvailabilityNote,{sources:source,label:'text',end:'2026-10-24',...options})));
  await render(sourceAvailability({sourceKey:'speech-text',latestObservedDate:'2026-10-16'}));
  assert.equal(container.textContent,'Latest text: Oct 16, 2026');
  assert.equal(container.querySelector('time').getAttribute('datetime'),'2026-10-16');
  assert.doesNotMatch(container.textContent,/Partial|Later dates unavailable/);
  await render(sourceAvailability({sourceKey:'speech-text',observedRecords:3,limited:true,publicationMaturity:'unknown'}));
  assert.equal(container.textContent,'','an unspecified archive limit must not fabricate a selected missing record');
  await render(sourceAvailability({sourceKey:'questions',family:'questions',gaps:[{sourceId:'/parliamentary-questions/E-10-2026-001715'}]}));
  assert.equal(container.textContent,'','an undated archive failure cannot be assigned to the selected period');
  await render(sourceAvailability({sourceKey:'questions',family:'questions',gaps:[{sourceId:'/parliamentary-questions/E-10-2026-001715'}]}),{sourceIds:['E-10-2026-001715']});
  assert.match(container.textContent,/Question E-10-2026-001715.*last read failed/);
  assert.equal(container.querySelector('a').href,'https://www.europarl.europa.eu/doceo/document/E-10-2026-001715_EN.html');
  assert.doesNotMatch(container.innerHTML,/data\.europarl|api\/v2/);
  for(const [retained,expected] of [[true,'could not be updated'],[false,'not loaded']]) {
    await render(sourceAvailability({sourceKey:'questions',family:'questions',gaps:[{sourceId:'/parliamentary-questions/E-10-2026-001715',retained}]}),{sourceIds:['E-10-2026-001715']});
    assert.match(container.textContent,new RegExp(expected));
  }
  await render(sourceAvailability({sourceKey:'speeches',family:'speeches',start:'2024-07-16',end:'2026-10-24',gaps:[
    {start:'2026-03-11',end:'2026-03-11',sourceId:'speech:MTG-PL-2026-03-11-OTH-123'},
    {start:'2026-03-11',end:'2026-03-11',sourceId:'speech-metadata-detail:MTG-PL-2026-03-11-OTH-123'},
    {start:'2023-11-21',end:'2023-11-21',sourceId:'outside:gap:outside:roster:2023-11-21'},
  ]}));
  assert.match(container.textContent,/Speech archive failed reads: 1.*Mar 11, 2026/);
  assert.doesNotMatch(container.textContent,/2023|MTG-PL|2 speech/);
  assert.equal(container.querySelector('a'),null,'URI-only speech identities cannot invent human document links');
  await render(sourceAvailability({sourceKey:'questions',family:'questions',gaps:[{start:'2026-10-27',sourceId:'feed:/parliamentary-questions'}]}));
  assert.equal(container.textContent,'','a later open-ended failure does not affect an earlier selection');
  await render(sourceAvailability({sourceKey:'speech-text',observedRecords:0}));
  assert.equal(container.textContent,'','the containing view owns its empty or unavailable state');
  const overflow=sourceAvailability({sourceKey:'questions',family:'questions',gaps:[{reason:'gap-list-limit',minimumCount:501}]});
  await render(overflow,{archive:true});assert.match(container.textContent,/Failed question reads: at least 501/);
  await render(overflow);assert.equal(container.textContent,'','an unscoped aggregate cannot qualify every selected page');
  await render(sourceAvailability({sourceKey:'speech',family:'speeches',latestObservedDate:'2026-10-16',gaps:[{start:'2024-10-07',end:'2024-10-07',sourceId:'speech:MTG-PL-2024-10-07-OTH-123'}]}),{start:'2026-10-01'});
  assert.equal(container.textContent,'Latest text: Oct 16, 2026');
  await render(sourceAvailability({sourceKey:'speech',family:'speeches',latestObservedDate:'2026-10-16',gaps:[{start:'2026-10-07',end:'2026-10-07',sourceId:'speech:MTG-PL-2026-10-07-OTH-123'}]}),{showGaps:false});
  assert.equal(container.textContent,'Latest text: Oct 16, 2026','archive gaps cannot be attributed to a selected person');
});

test('coverage messages use the selected formatter and keep exact source identifiers in rich slots',async t=>{
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  t.after(()=>load.close());
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {AvailabilityNote}=await load('/src/AvailabilityNote.tsx');
  const {UiI18nProvider}=await load('/src/UiI18nReact.tsx');
  const {createAppUiI18n}=await load('/src/uiCatalogues.mjs');
  const id='E-10-2026-001715';
  const i18n=createAppUiI18n({fr:{
    'coverage.questionOverflow':'Lectures de questions échouées : au moins {count}.',
    'coverage.questionReference':'Question officielle {id}',
    'coverage.question.unloaded':'{record} non chargée',
  }});
  const html=renderToStaticMarkup(createElement(UiI18nProvider,{i18n,language:'fr'},createElement(AvailabilityNote,{
    archive:true,language:'fr',sources:sourceAvailability({sourceKey:'questions',family:'questions',gaps:[
      {sourceId:'/parliamentary-questions/'+id,retained:false},
      {reason:'gap-list-limit',minimumCount:1234},
    ]}),
  })));
  assert(html.includes('Lectures de questions échouées : au moins '+new Intl.NumberFormat('fr').format(1234)+'.'));
  assert(html.includes('<span lang="">'+id+'</span>'));
  assert(html.includes('non chargée'));
  assert(html.includes('<span lang="fr">Question officielle <span lang="">'+id+'</span>'));
  const documentId='A-10-2026-0042';
  const documentUi=createAppUiI18n({fr:{'coverage.documentReference':'Document officiel {id}','coverage.document.unloaded':'{record} non chargé'}});
  const documentHtml=renderToStaticMarkup(createElement(UiI18nProvider,{i18n:documentUi,language:'fr'},createElement(AvailabilityNote,{archive:true,language:'fr',sources:sourceAvailability({sourceKey:'documents',family:'documents',gaps:[{sourceId:'/plenary-documents/'+documentId,retained:false}]})})));
  assert(documentHtml.includes('<span lang="fr">Document officiel <span lang="">'+documentId+'</span>'));
  assert(documentHtml.includes('document/'+documentId+'_FR.html'));
  assert(html.includes('document/'+id+'_FR.html'));
  assert(!html.includes('data.europarl.europa.eu'));
});
