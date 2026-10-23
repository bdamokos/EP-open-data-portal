import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const source={url:'https://example.test/outside-language-fixture',fetchedAt:'2026-10-16T12:00:00Z'};
const coverage={complete:false,pending:0,unresolved:0,gaps:1,truncated:false,initialized:true,generation:1,updatedAt:source.fetchedAt,tasks:[],source:'Public local fixture'};
const day='2026-06-02';
const titleCases=[
  {hu:'Magyar cím',en:'English title'},
  {de:'Deutscher Titel'},
  {it:'',de:'This later entry must stay unused'},
  {'':'Source without a language'},
  {mul:'Multilingual source'},
  {und:'Undetermined source'},
  {fr:'Intitulé français'},
  {en:'Deutscher Titel'}, // Existing text-only deduplication retains the earlier German entry.
];
const roles=[
  ['Ministre invitée','fr'],['Rôle sans métadonnées',null],['Mixed source role','mul'],
  ['Unspecified source role','und'],['a Bizottság ügyvezető alelnöke','en-t-hu-mtec'],
  ['President-in-Office of the Council','hu-t-en-mtec'],['Rôle régional','FR-ca'],[null,null],
];
function fixture() {
  const contributions=[...titleCases,...Array.from({length:6},()=>({en:'Other appearance'}))].map((titles,index)=>{
    const date=index<titleCases.length?day:`2026-08-0${index-titleCases.length+1}`;
    const [role,languageTag]=roles[index]||['Guest speaker','en'];
    return {id:`MTG-PL-${date}-OTH-42${index}`,personId:'42',date,term:10,start:null,end:null,titles,
      parentIds:index===3?[]:[`MTG-PL-${date}-PVCRE-ITM-${index}`],documentId:null,parentDocumentId:null,
      reference:'Exact fixture '+index,originalLanguages:[],websiteUrl:'https://example.test/speech/'+index,websiteLanguage:null,
      header:{personId:'42',name:'Source speaker',role,languageTag,original:!languageTag?.includes('-t-'),capacity:'other'},
      source,rosterSource:{date,sources:[source]}};
  });
  const agendas=contributions.filter(c=>c.parentIds.length).map((c,index)=>({id:c.parentIds[0],date:c.date,titles:c.titles,
    kind:index===0?'PLENARY_ACTIVITY':'PLENARY_DEBATE',procedureIds:index===0?['2026-0001']:[],
    procedures:index===0?[{id:'2026-0001',type:'COD',source}]:[],source}));
  const dates=[...new Set(contributions.map(c=>c.date))];
  const person={id:'42',name:'Source speaker',role:'Ministre invitée',roleLanguageTag:'fr',capacity:'other',
    contributions:contributions.length,appearances:agendas.length,unlinkedContributions:1,sittingDays:dates.length,
    first:day,last:dates.at(-1),terms:[10],days:dates.map(date=>({date,contributions:contributions.filter(c=>c.date===date).length,
      itemIds:contributions.filter(c=>c.date===date).flatMap(c=>c.parentIds),items:[],formal:false,legislative:false})),
    roles:roles.map(([role])=>role).filter(Boolean),roleConflicts:[contributions[0].id,contributions[4].id]};
  const coSpeakers=[{...contributions[0],id:'exact-co-speaker-76',personId:'76',start:'2026-06-02T12:00:00Z',header:{...contributions[0].header,name:'Autre personne'}},
    {...contributions[0],id:'exact-co-speaker-77',personId:'77',start:'2026-06-02T12:30:00Z',header:{...contributions[0].header,name:null}}];
  return {person,contributions,agendas,coSpeakers,coverage};
}

async function harness(t,language,query='?view=outside',deferDetail=false) {
  const window=new Window({url:'http://localhost/'+query,settings:{disableIframePageLoading:true,disableCSSFileLoading:true}});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,
    HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,DOMParser:window.DOMParser,
    ResizeObserver:class {observe(){} disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  document.documentElement.lang=language;
  window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{width:20,height:20}];};
  window.HTMLElement.prototype.scrollTo=function(){};
  window.HTMLElement.prototype.scrollIntoView=function(){};
  window.scrollTo=()=>{};
  let vite,root,finishDetail;
  const detail=fixture(),calls=[];
  const people=[detail.person,...[null,'mul','und','en-t-hu-mtec'].map((roleLanguageTag,index)=>({...detail.person,id:String(50+index),name:'Another source '+index,roleLanguageTag}))];
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(vite)await vite.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  t.mock.method(globalThis,'fetch',input=>{
    const url=new URL(input,location.href);calls.push(url);
    assert.equal(url.origin,'http://localhost','only local fixture requests are allowed');
    assert.equal(url.searchParams.get('term'),'10','language markup preserves the current-term request');
    if(url.pathname==='/api/outside/directory')return Promise.resolve(Response.json({term:'10',people,coverage}));
    assert.equal(url.pathname,'/api/outside/42','no source, index or corpus requests are allowed');
    return deferDetail?new Promise(resolve=>{finishDetail=()=>resolve(Response.json(detail));}):Promise.resolve(Response.json(detail));
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {OutsideVoices}=await vite.ssrLoadModule('/src/OutsideVoices.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');container.lang=language;document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(OutsideVoices,{language,onBack(){}})));
  const click=async target=>{const node=typeof target==='string'?[...container.querySelectorAll('button')].find(b=>b.textContent===target):target;assert(node,'Missing fixture control '+target);await act(async()=>{node.focus();node.click();});return node;};
  return {window,container,detail,calls,click,finish:()=>act(async()=>{assert(finishDetail);finishDetail();})};
}

// Empty lang is an explicit unknown and stops inheritance; closest must not skip it.
const effective=node=>{assert(node,'Missing language boundary');return node.closest('[lang]')?.getAttribute('lang')??null;};
const expectLanguage=(node,language)=>assert.equal(effective(node),language,node?.textContent);
const selectedTitles=language=>[
  [language==='hu'?'Magyar cím':'English title',language==='hu'?'hu':'en'],['Deutscher Titel','de'],
  ['This later entry must stay unused','de'],['Source without a language',''],['Multilingual source','mul'],
  ['Undetermined source','und'],['Intitulé français','fr'],
];
const assertTitles=(host,language)=>{
  assert(host);
  assert.equal(host.textContent,selectedTitles(language).map(([text])=>text).join(' · '));
  assert.deepEqual([...host.children].map(node=>[node.textContent,effective(node)]),selectedTitles(language));
};

test('outside directory keeps English UI, locale months and exact aggregate roles separate in EN/HU/FR',async t=>{
  for(const language of ['en','hu','fr'])await t.test(language,async t=>{
    const h=await harness(t,language),q=selector=>h.container.querySelector(selector);
    for(const selector of ['.ov-filters label','.ov-filters input','.ov-filters option','.ov-groups button','.ov-results','.ov-legend','.ov-group-title','.ov-person-count','.ov-axis>span','.ov-sources summary','.ov>[role="status"]'])expectLanguage(q(selector),'en');
    for(const node of h.container.querySelectorAll('.ov-axis>div span'))expectLanguage(node,language);
    for(const node of h.container.querySelectorAll('.ov-person-name button'))expectLanguage(node,'');
    assert.deepEqual([...h.container.querySelectorAll('.ov-person-name small')].map(effective),['fr','','mul','und','']);
    const mark=q('[data-ov-focus="mark:42:'+day+'"]');
    expectLanguage(mark,'');
    const formatted=new Intl.DateTimeFormat(language==='en'?'en-GB':language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(day+'T12:00:00Z'));
    assert.equal(mark.getAttribute('aria-label'),`Source speaker, ${formatted}: 7 agenda items`,'mixed attributes retain the existing exact copy pending arbitration');
    assert.equal(mark.title,formatted);
    const updated=q('.ov-sources p span');expectLanguage(updated,new Intl.DateTimeFormat().resolvedOptions().locale);
    assert.equal(updated.textContent,new Date(source.fetchedAt).toLocaleDateString(),'the existing browser-default date stays intact');
    assert(h.calls.every(url=>url.searchParams.get('lang')===language));
  });
});

test('speaker titles retain source fallback keys and per-title boundaries through timeline, appearances and dossiers',async t=>{
  for(const language of ['en','hu','fr'])await t.test(language,async t=>{
    const h=await harness(t,language,'?view=outside&ov-person=42'),q=selector=>h.container.querySelector(selector);
    expectLanguage(q('.ov-back'),'en');expectLanguage(q('.ov-person-heading h2'),'');expectLanguage(q('.ov-person-heading p'),'fr');
    for(const selector of ['.ov-totals','.ov-tabs button','.ov-month-filter','.ov-speaker-body h3','.ov-roles summary'])expectLanguage(q(selector),'en');
    expectLanguage(q('.ov-range'),language);
    const cards=[...h.container.querySelectorAll('[data-ov-focus^="appearance:42:'+day+':"]')],card=cards[0];
    assert.deepEqual(cards.map(node=>[node.querySelector('strong').textContent,effective(node.querySelector('strong'))]),[...selectedTitles(language),['Deutscher Titel','en']]);
    expectLanguage(card.querySelector('small'),language);expectLanguage(card.querySelector(':scope>span'),'en');
    const roleRows=[...h.container.querySelectorAll('.ov-roles p')];
    assert.deepEqual(roleRows.slice(0,8).map(p=>effective(p.querySelector('span'))),['fr','','mul','und','','','FR-ca','en']);
    for(const p of roleRows){expectLanguage(p,'en');expectLanguage(p.querySelector('b'),language);}
    assert.equal(roleRows[7].querySelector('span').textContent,'Role not stated');
    const options=[...q('.ov-month-filter select').options];
    assert.equal(options[0].textContent,'All months');expectLanguage(options[0],'en');
    const localizedMonth=new Intl.DateTimeFormat(language,{month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date('2026-06-01T12:00:00Z'));
    assert.equal(options[1].textContent,localizedMonth+': 7 agenda items');expectLanguage(options[1],language==='en'?'en':'');
    assert(options[2].disabled,'the unchanged empty month remains disabled');
    const monthButton=q('.ov-monthly button');assert.equal(monthButton.getAttribute('aria-label'),options[1].textContent);expectLanguage(monthButton,language==='en'?'en':'');expectLanguage(monthButton.querySelector('small'),language);
    await h.click('Appearances');
    const appearance=[...h.container.querySelectorAll('.ov-appearance')].find(node=>node.querySelector('summary b').textContent===card.querySelector('small').textContent);
    assert(appearance);assertTitles(appearance.querySelector('summary>span'),language);expectLanguage(appearance.querySelector('summary b'),language);
    const headings=[...appearance.querySelectorAll('.ov-item>h3')];
    assert.deepEqual(headings.map(node=>[node.textContent,effective(node)]),[...selectedTitles(language),['Deutscher Titel','en']]);
    const contributionRoles=[...appearance.querySelectorAll('.ov-contribution>p')];
    assert.deepEqual(contributionRoles.map(effective),['fr','','mul','und','','','FR-ca']);
    for(const conflict of appearance.querySelectorAll('.ov-conflict'))expectLanguage(conflict,'en');
    for(const node of appearance.querySelectorAll('.ov-day>h2,.ov-contribution-head>strong,.ov-co-speakers small'))expectLanguage(node,language);
    for(const node of appearance.querySelectorAll('.ov-contribution-head button,.ov-evidence summary,.ov-links a,.ov-co-speakers h4'))expectLanguage(node,'en');
    assert.deepEqual([...appearance.querySelectorAll('.ov-co-speakers button>span')].map(effective),['','en']);
    assert.equal(appearance.querySelectorAll('.ov-evidence dl')[4].querySelectorAll('dd')[3].textContent,'en-t-hu-mtec','the exact transformed source tag remains available as evidence');
    await h.click('Subjects & dossiers');
    for(const node of h.container.querySelectorAll('.ov-dossier-group>h3,.ov-pending'))expectLanguage(node,'en');
    const dossierTitles=[...h.container.querySelectorAll('.ov-dossier strong')];
    for(const [text,tag] of selectedTitles(language).filter(([,tag])=>tag!==''))assert(dossierTitles.some(node=>node.textContent===text&&effective(node)===tag),text+' dossier language');
    for(const node of h.container.querySelectorAll('.ov-dossier button small'))expectLanguage(node,language);
  });
});

test('drawer fallback name resolves while timeline focus follows the localized destination',async t=>{
  const h=await harness(t,'hu','?view=outside',true),mark=h.container.querySelector('[data-ov-focus="mark:42:'+day+'"]');
  await h.click(mark);const close=h.container.querySelector('[aria-label="Close speeches"]'),heading=h.container.querySelector('#ov-panel-title');
  assert.equal(heading.textContent,'Speeches');expectLanguage(heading,'en');expectLanguage(close,'en');assert.equal(document.activeElement,close);
  await h.finish();assert.equal(h.container.querySelector('#ov-panel-title'),heading);assert.equal(heading.textContent,'Source speaker');expectLanguage(heading,'');assert(document.activeElement===h.container.querySelector('.ov-day>h2'),'a date-only marker focuses its localized sitting heading');expectLanguage(h.container.querySelector('.ov-drawer header small'),'en');expectLanguage(h.container.querySelector('.ov-drawer header small span'),'hu');
  expectLanguage(h.container.querySelector('.ov-day>h2'),'hu');expectLanguage(h.container.querySelector('.ov-open-person'),'en');
  await h.click(close);assert.equal(h.container.querySelector('.ov-drawer'),null);assert.equal(document.activeElement,mark);
});
