import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,Fragment,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';
import {selectLanguageText} from './pocLanguage.mjs';

const effectiveLanguage=node=>node?.closest('[lang]')?.getAttribute('lang');
async function harness(t,{locale='hu',query='',items=[],respond=()=>{throw Error('Unexpected request');}}={}) {
  const window=new Window({url:'http://localhost/?'+query});window.document.documentElement.lang=locale;
  window.localStorage.setItem('ep.bookmarks.v1',JSON.stringify({version:1,items}));
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,vite;const calls=[];
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async(input,options)=>{const url=new URL(input,location.href);calls.push(url);return Response.json(await respond(url,options));});
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  return {window,container,calls,load:path=>vite.ssrLoadModule(path),render:element=>act(async()=>root.render(element)),click:node=>act(async()=>node.click())};
}

test('question save controls update with the UI locale without changing source titles or saved records',async t=>{
  const item={kind:'question',id:'E-10-2026-003031',title:'Titre français',titleLanguage:'fr',memberId:'257043'};
  const h=await harness(t,{items:[item]});const {SaveButton}=await h.load('/src/PocSaved.tsx');
  const before=window.localStorage.getItem('ep.bookmarks.v1');
  for(const [language,label] of [['hu','Mentett kérdés'],['fr','Question enregistrée'],['en','Saved question']]) {
    await h.render(createElement(SaveButton,{item,language}));
    const button=h.container.querySelector('button'),visible=button.querySelector('span[lang]');
    assert.equal(visible.textContent,label);assert.equal(visible.lang,language);
    assert.equal(button.getAttribute('aria-label'),label+' · Titre français');
    assert.equal(button.lang,language==='fr'?'fr':'');assert.equal(button.getAttribute('aria-pressed'),'true');
    assert.equal(window.localStorage.getItem('ep.bookmarks.v1'),before,'changing the locale is not a bookmark write');
  }
  await h.render(createElement(SaveButton,{item,language:'hu'}));
  await h.click(h.container.querySelector('button'));
  const button=h.container.querySelector('button');
  assert.equal(button.getAttribute('aria-label'),'Kérdés mentése · Titre français');
  assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(button.querySelector('span[lang]').lang,'hu');
  assert.deepEqual(JSON.parse(window.localStorage.getItem('ep.bookmarks.v1')).items,[]);
});

test('title fallback language follows the selected dictionary key, including equal text and empty first entries',()=>{
  assert.deepEqual(selectLanguageText({en:'Same',hu:'Same'},'hu','Fallback'),{text:'Same',language:'hu'});
  assert.deepEqual(selectLanguageText({en:'English'},'fr','Fallback'),{text:'English',language:'en'});
  assert.deepEqual(selectLanguageText({fr:'Français',de:'Deutsch'},'hu','Fallback'),{text:'Français',language:'fr'});
  assert.deepEqual(selectLanguageText({fr:'',de:'Do not choose a later key'},'hu','Fallback'),{text:'Fallback',language:'en'});
  assert.deepEqual(selectLanguageText({},'hu','public-ID',''),{text:'public-ID',language:''});
  assert.deepEqual(selectLanguageText({mul:'Mixed'},'hu','Fallback'),{text:'Mixed',language:'mul'});
});

for(const locale of ['en','hu','fr'])test(`English shell and Following preserve ${locale} dates, exact titles and legacy unknowns`,async t=>{
  const items=[{kind:'question',id:'E-10-2026-003031',title:'Titre français',titleLanguage:'fr',memberId:'257043',newAnswer:true,updated:true,unreadAnswers:[{id:'answer-fr',title:'Réponse',titleLanguage:'fr',recordKind:'answer',date:'2026-10-16'}]},
    {kind:'question',id:'E-10-2026-003032',title:'Legacy unknown',memberId:'257043',newAnswer:true,updated:true,unreadAnswers:[{id:'answer-old',title:'Legacy answer',recordKind:'answer',date:'2026-10-15'}]}];
  const h=await harness(t,{locale,items});const {ParliamentHeader}=await h.load('/src/ParliamentHeader.tsx'),{PocSaved}=await h.load('/src/PocSaved.tsx');
  const props={language:locale,onBack(){},onMember(){}};
  await h.render(createElement(Fragment,null,createElement(ParliamentHeader,{view:'saved',language:locale,onMembers(){},onSaved(){}}),createElement(PocSaved,props)));
  assert.equal(document.documentElement.lang,locale);
  assert.equal(effectiveLanguage(h.container.querySelector('nav button')),'en');
  assert.equal(effectiveLanguage(h.container.querySelector('.parliament-brand')),'en');
  assert.equal(effectiveLanguage(h.container.querySelector('.poc-saved-heading h1')),'en');
  const titles=h.container.querySelectorAll('.poc-saved-items h3');
  assert.equal(effectiveLanguage(titles[0]),'fr');assert.equal(effectiveLanguage(titles[1]),'');
  const links=h.container.querySelectorAll('.poc-saved-items article a');
  assert.equal(effectiveLanguage(links[0]),'en');assert.equal(effectiveLanguage(links[0].querySelector('span')),'fr');
  assert.equal(effectiveLanguage(links[0].querySelector('small')),locale);
  assert.equal(effectiveLanguage(links[1].querySelector('span')),'');
  const save=h.container.querySelector('.poc-save-button');
  const savedLabel={en:'Saved question',hu:'Mentett kérdés',fr:'Question enregistrée'}[locale];
  assert.equal(save.getAttribute('aria-label'),savedLabel+' · Titre français','the selected UI locale governs the prefix, not the source title language');
  assert.equal(save.getAttribute('lang'),locale==='fr'?'fr':'','a known matching title is homogeneous; differing languages remain explicit');
  const legacy=h.container.querySelectorAll('.poc-save-button')[1];
  assert.equal(legacy.getAttribute('lang'),'','translating a prefix does not supply missing source-title metadata');
  assert.equal(save.hasAttribute('aria-labelledby'),false,'the native button keeps its existing naming mechanism');
  const before=JSON.parse(window.localStorage.getItem('ep.bookmarks.v1'));
  await h.click(links[0]);
  const after=JSON.parse(window.localStorage.getItem('ep.bookmarks.v1'));
  assert.equal(after.version,1);assert.deepEqual(after.items.map(x=>x.id),before.items.map(x=>x.id));
  assert(after.items[1].newAnswer);assert.equal(after.items[0].unreadAnswers.length,0);
});

test('shared insights mark English labels while localized countries and dates keep their locale',async t=>{
  const h=await harness(t,{locale:'fr'}),{InsightShell,InsightDemographics,InsightPeople}=await h.load('/src/PocInsightShared.tsx');
  const stats={denominator:1,uniqueCurrentMeps:1,peopleOutsideCurrentRoster:0,referenceDate:'2026-10-16',dimensions:{country:[{label:'HU',count:1},{label:'Unknown',count:1},{label:'raw-country',count:1}],group:[],gender:[],age:[]}};
  await h.render(createElement(InsightShell,{title:'Questions',language:'fr',view:'questions',onBack(){}},createElement(InsightDemographics,{stats,language:'fr'}),createElement(InsightPeople,{people:[{id:'9',name:'A name',office:'Unspecified source role',country:'HU',currentMep:false}],language:'fr'})));
  assert.equal(effectiveLanguage(h.container.querySelector('main')),'fr');
  assert.equal(effectiveLanguage(h.container.querySelector('.insight-intro h1')),'en');
  assert.equal(effectiveLanguage(h.container.querySelector('.insight-country-table h3')),'en');
  assert.equal(effectiveLanguage(h.container.querySelector('.insight-country-table li span')),'fr');
  const countryLabels=[...h.container.querySelectorAll('.insight-country-table li span')];
  assert.equal(countryLabels[1].textContent,'Unknown');assert.equal(effectiveLanguage(countryLabels[1]),'en');
  assert.equal(countryLabels[2].textContent,'raw-country');assert.equal(effectiveLanguage(countryLabels[2]),'');
  assert.equal(effectiveLanguage(h.container.querySelector('.insight-age .insight-chart-caption')),'fr');
  assert.equal(effectiveLanguage(h.container.querySelector('.insight-person-office')),'');
  assert.equal(effectiveLanguage(h.container.querySelector('.data-notice')),'en');
});

test('country-map visible locale boundaries preserve its exact mixed accessible names as open cases',async t=>{
  const h=await harness(t),{CountryMap}=await h.load('/src/PocCountryMap.tsx');
  await h.render(createElement(CountryMap,{language:'hu',selected:null,onSelect(){},rows:[{code:'HU',value:1,label:'1 question'}],caption:createElement(Fragment,null,'Question count · ',createElement('span',{lang:'hu'},'2026. okt. 16.'))}));
  assert.equal(effectiveLanguage(h.container.querySelector('figcaption')),'en');
  assert.equal(effectiveLanguage(h.container.querySelector('figcaption span')),'hu');
  const target=h.container.querySelector('[data-country="HU"]');
  assert.equal(target.getAttribute('aria-label'),'Magyarország: 1 question');
  assert.equal(effectiveLanguage(target),'','unknown language is recorded, not accepted as resolving the known mixed name');
  assert.equal(target.getAttribute('role'),'button');assert.equal(target.getAttribute('tabindex'),'0');
});

test('motion and contribution shared renderers keep English actions apart from source text and localized dates',async t=>{
  const h=await harness(t,{respond:url=>{assert(url.pathname.includes('/speech-context/'));return {debates:[{id:'exact-debate',titles:{fr:'Titre français du débat'},records:[],exchanges:[],coverage:{complete:true},sources:[]}],unavailable:false};}});
  const {PocMotionOutcome}=await h.load('/src/PocMotionOutcome.tsx'),{InterventionBadges,PocSpeechContext}=await h.load('/src/PocSpeechInterventions.tsx');
  await h.render(createElement(Fragment,null,createElement(PocMotionOutcome,{outcome:{status:'adopted',date:'2026-10-07',method:'VOTE_HAND',totals:{for:20,against:2,abstaining:1}},reference:'B-10-2026-0001',sourceId:'B-10-2026-0001',language:'hu'}),createElement(InterventionBadges,{value:{type:'speech',process:'Unknown source process',onBehalfOf:[{uri:'exact-group',label:'Source group label'}]}}),createElement(PocSpeechContext,{id:'MTG-PL-2026-10-07-OTH-101',language:'fr'})));
  assert.equal(effectiveLanguage(h.container.querySelector('.poc-motion-text-outcome h3')),'en');
  assert.equal(effectiveLanguage(h.container.querySelector('.poc-motion-vote-meta span')),'hu');
  assert.equal(effectiveLanguage(h.container.querySelector('.intervention-badge > span')),'en');
  assert.equal(effectiveLanguage(h.container.querySelector('.intervention-group span')),'');
  const toggle=h.container.querySelector('.intervention-context-toggle');assert.equal(effectiveLanguage(toggle),'en');
  await h.click(toggle);
  assert.equal(effectiveLanguage(h.container.querySelector('.intervention-debate > .intervention-caption')),'fr');
  assert.equal(effectiveLanguage(h.container.querySelector('.intervention-sequence-heading h4')),'en');
  assert.equal(toggle.getAttribute('aria-expanded'),'true');
});

test('source dialog keeps exact title fallback and raw value languages distinct from English controls',async t=>{
  const source='https://data.europarl.europa.eu/api/v2/procedures/2025-0407';
  const h=await harness(t,{respond:()=>({sourceUrl:source,requestUrl:source,fetchedAt:'2026-10-16T12:00:00Z',records:[{title:'English procedure',websiteUrl:null},{title:'Unlabelled title',websiteUrl:null}],payload:{data:[{id:'eli/dl/proc/2025-0407',process_title:{en:'English procedure',fr:'Procédure française'},raw_note:'Unlabelled content'},{label:'Unlabelled title'}]}})});
  const {PocSourceLink}=await h.load('/src/PocSourceLink.tsx');
  await h.render(createElement(PocSourceLink,{url:source,language:'hu',contentLanguage:'fr'},'Procédure française'));
  assert.equal(effectiveLanguage(h.container.querySelector('.source-primary span')),'fr');
  await h.click(h.container.querySelector('button'));
  const dialog=document.querySelector('dialog');assert(dialog.open);
  assert.equal(effectiveLanguage(dialog.querySelector('h2')),'en');
  assert.equal(effectiveLanguage(dialog.querySelector('h3')),'en');
  assert.equal(effectiveLanguage(dialog.querySelector('.source-retrieved span')),'hu');
  const options=dialog.querySelector('.source-record-picker select').options;
  assert.equal(effectiveLanguage(options[0]),'en');assert.equal(effectiveLanguage(options[1]),'');
  const raw=[...dialog.querySelectorAll('dt')].find(node=>node.textContent==='Raw note').nextElementSibling.querySelector('span');
  assert.equal(effectiveLanguage(raw),'');
  assert.equal(effectiveLanguage(dialog.querySelector('.source-close')),'en');
});

test('text-search snippets use source language while dates/options use UI locale and unknown titles remain unknown',async t=>{
  const hit={sourceId:'MTG-PL-2026-10-07-OTH-1',sourceKey:'fr',kind:'speech',parentId:null,date:'2026-10-07',language:'fr',translationType:'unspecified',sourceUrl:'https://example.test/source',sha256:'fixture',snippet:'Un passage français',people:[{id:42,name:'Source speaker',role:'SPEAKER'}]};
  const h=await harness(t,{locale:'hu',query:'fixture-search=passage',respond:()=>({total:1,limit:20,offset:0,nextOffset:null,coverage:{complete:false},results:[{sourceId:hit.sourceId,kind:'speech',date:hit.date,title:'Unlabelled source title',hits:[hit]}]})});
  const {PocTextSearch}=await h.load('/src/PocTextSearch.tsx');await h.render(createElement(PocTextSearch,{prefix:'fixture',label:'Search fixture',language:'hu'}));
  assert.equal(effectiveLanguage(h.container.querySelector('.poc-search-heading h3')),'en');
  assert.equal(effectiveLanguage(h.container.querySelector('option[value="fr"]')),'hu');
  assert.equal(effectiveLanguage(h.container.querySelector('option[value="all"]')),'en');
  assert.equal(effectiveLanguage(h.container.querySelector('.poc-search-result h4')),'');
  assert.equal(effectiveLanguage(h.container.querySelector('.poc-search-excerpt')),'fr');
  assert.equal(effectiveLanguage(h.container.querySelector('.poc-search-attribution > span')),'en');
  assert.equal(effectiveLanguage(h.container.querySelector('.poc-search-attribution > span > span')),'');
  assert.equal(effectiveLanguage(h.container.querySelector('.poc-search-actions button')),'en');
  assert.equal(effectiveLanguage(h.container.querySelector('.poc-search-result .poc-search-meta span:last-child')),'hu');
});
