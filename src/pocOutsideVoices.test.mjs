import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const source={url:'https://example.test/public-fixture',fetchedAt:'2026-10-16T12:00:00Z'};
const coverage={complete:false,pending:0,unresolved:0,gaps:1,truncated:false,initialized:true,generation:1,updatedAt:source.fetchedAt,tasks:[],source:'Public test fixture'};
const item=(date,index)=>`MTG-PL-${date}-PVCRE-ITM-${index}`;
const speech=(date,index,parents)=>({date,index,parents});

function speaker(id,name,rows,classifications={}) {
  const contributions=rows.map(({date,index,parents})=>({
    id:`MTG-PL-${date}-OTH-${id}${index}`,personId:id,date,term:10,start:null,end:null,
    titles:{en:`Fixture speech ${id}-${index}`},parentIds:parents,documentId:null,parentDocumentId:null,
    reference:`Fixture ${id}-${index}`,originalLanguages:['en'],websiteUrl:null,websiteLanguage:null,
    header:{personId:id,name,role:'Guest speaker',languageTag:'en',original:true,capacity:'other'},
    source,rosterSource:{date,sources:[source]},
  }));
  const agendas=[...new Set(contributions.flatMap(c=>c.parentIds))].map(id=>({
    id,date:contributions.find(c=>c.parentIds.includes(id)).date,titles:{en:`Fixture agenda ${id}`},
    kind:classifications[id]?.kind||'PLENARY_DEBATE',
    procedureIds:classifications[id]?.legislative?['2025-0001']:[],
    procedures:classifications[id]?.legislative?[{id:'2025-0001',type:'COD',source}]:[],source,
  }));
  const dates=[...new Set(contributions.map(c=>c.date))].sort();
  const days=dates.map(date=>{
    const rows=contributions.filter(c=>c.date===date),itemIds=[...new Set(rows.flatMap(c=>c.parentIds))];
    const items=itemIds.map(id=>({id,kind:agendas.find(a=>a.id===id).kind,legislative:Boolean(classifications[id]?.legislative)}));
    return {date,contributions:rows.length,itemIds,items,formal:items.some(a=>a.kind==='PLENARY_ACTIVITY'),legislative:items.some(a=>a.legislative)};
  });
  const person={id,name,role:'Guest speaker',capacity:'other',contributions:contributions.length,
    appearances:agendas.length,unlinkedContributions:contributions.filter(c=>!c.parentIds.length).length,
    sittingDays:dates.length,first:dates[0],last:dates.at(-1),terms:[10],days,roles:['Guest speaker'],roleConflicts:[]};
  return {person,contributions,agendas,coSpeakers:[],coverage};
}

async function harness(t,details,query='?view=outside',sourceData=null) {
  const window=new Window({url:'http://localhost/'+query});
  const globals={window,document:window.document,location:window.location,history:window.history,
    Event:window.Event,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,
    ResizeObserver:class {observe(){} disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(vite)await vite.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const calls=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);calls.push(url);
    if(url.pathname==='/api/poc/source-record'&&sourceData)return Response.json(sourceData);
    if(url.pathname==='/api/poc/outside/directory')return Response.json({term:url.searchParams.get('term'),people:details.map(d=>d.person),coverage});
    const detail=details.find(d=>url.pathname==='/api/poc/outside/'+d.person.id);
    if(detail)return Response.json(detail);
    throw new Error('Unexpected request: '+url);
  });
  // Exercise the real component and URL/data hooks without opening a listening server.
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocOutsideVoices}=await vite.ssrLoadModule('/src/PocOutsideVoices.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocOutsideVoices,{language:'en',onBack(){}})));
  const select=label=>{
    const node=[...container.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(label))?.querySelector('select');
    assert(node,'Missing labelled select: '+label);return node;
  };
  const change=async(label,value)=>act(async()=>{const node=select(label);node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const click=async text=>act(async()=>{const node=[...container.querySelectorAll('button')].find(b=>b.textContent===text);assert(node,'Missing button: '+text);node.click();});
  const navigate=async query=>act(async()=>{history.replaceState(null,'','/'+query);window.dispatchEvent(new window.Event('popstate'));});
  return {window,container,calls,select,change,click,navigate};
}

const sourceIds=container=>[...new Set([...container.querySelectorAll('.ov-evidence dl')].map(dl=>dl.querySelector('dd').textContent))].sort();
const contributionIds=detail=>detail.contributions.map(c=>c.id).sort();

test('resolved agenda membership shows one debate and retains the original API links in evidence',async t=>{
  const wrong=item('2026-04-28',11),right=item('2026-04-28',12);
  const detail=speaker('238669','Tony Murphy',[speech('2026-04-28','01',[right]),speech('2026-04-28','02',[right])]);
  detail.agendas[0].titles={en:'12. Discharge 2024 (joint debate)'};
  for(const c of detail.contributions){c.reportedParentIds=[wrong,right];c.parentDocumentId='CRE-10-2026-04-28-ITM-012';}
  const {container}=await harness(t,[detail],'?view=outside&ov-person=238669');
  await act(async()=>container.querySelector('.ov-appearance-cards button').click());
  const drawer=container.querySelector('.ov-drawer');
  assert.equal(drawer.querySelectorAll('.ov-item').length,1);assert.equal(drawer.querySelectorAll('.ov-contribution').length,2);
  assert.equal(drawer.querySelector('h3').textContent,'12. Discharge 2024 (joint debate)');
  assert(!drawer.textContent.includes('Special event'));
  assert.equal(drawer.querySelectorAll('a[href$="CRE-10-2026-04-28-ITM-012_EN.html"]').length,2);
  for(const evidence of drawer.querySelectorAll('.ov-evidence')){
    assert(evidence.textContent.includes('Transcript chapterCRE-10-2026-04-28-ITM-012'));
    assert(evidence.textContent.includes('API agenda links'+wrong+', '+right));
  }
});

test('only populated capacity buttons appear and stale empty-group links show all speakers',async t=>{
  const detail=speaker('42','Current guest',[speech('2026-10-07','01',[item('2026-10-07',4)])]);
  const {container,click}=await harness(t,[detail],'?view=outside&ov-group=parliaments');
  assert.deepEqual([...container.querySelectorAll('.ov-groups button')].map(n=>n.textContent),['All speakers','Other speakers']);
  assert.equal(container.querySelector('.ov-groups button[aria-pressed=true]').textContent,'All speakers');
  assert.equal(container.querySelector('.ov-results strong').textContent,'1');
  await click('Other speakers');assert.equal(container.querySelector('.ov-results strong').textContent,'1');
});

test('historical URL filters cannot broaden directory, speaker or day-panel requests',async t=>{
  const detail=speaker('42','Current guest',[speech('2026-10-07','01',[item('2026-10-07',4)])]);
  const {container,calls,click,navigate}=await harness(t,[detail],'?view=outside&ov-term=9');
  assert(![...container.querySelectorAll('label')].some(n=>n.textContent.startsWith('Term')));
  assert(calls.some(u=>u.pathname.endsWith('/directory')));
  await act(async()=>container.querySelector('.ov-mark').click());
  assert(container.querySelector('[role=dialog]'));
  await act(async()=>container.querySelector('[aria-label="Close speeches"]').click());
  await navigate('?view=outside&ov-term=all');await click('Current guest');
  assert(container.querySelector('.ov-person-heading'));
  assert(calls.filter(u=>u.pathname.includes('/outside/')).every(u=>u.searchParams.get('term')==='10'));
});

test('month controls preserve all 11 monthly counts, unlinked speeches and equivalent filtering',async t=>{
  const detail=speaker('42','Monthly guest',[
    speech('2025-12-15','01',[item('2025-12-15',1)]),
    speech('2025-12-15','02',[item('2025-12-15',1)]),
    speech('2025-12-15','03',[item('2025-12-15',2),item('2025-12-15',3)]),
    speech('2026-01-20','04',[item('2026-01-20',1)]),
    speech('2026-02-10','05',[item('2026-02-10',1)]),
    speech('2026-04-11','06',[]),
    speech('2026-05-12','07',[item('2026-05-12',1)]),
    speech('2026-06-13','08',[item('2026-06-13',1)]),
    speech('2026-07-14','09',[item('2026-07-14',1)]),
    speech('2026-08-15','10',[item('2026-08-15',1)]),
    speech('2026-09-16','11',[item('2026-09-16',1)]),
    speech('2026-10-17','12',[item('2026-10-17',1)]),
  ]);
  const {window,container,select,change,click}=await harness(t,[detail],'?view=outside&ov-person=42');
  const expected=[
    ['2025-12','Dec 2025: 3 agenda items',3],['2026-01','Jan 2026: 1 agenda item',1],
    ['2026-02','Feb 2026: 1 agenda item',1],['2026-03','Mar 2026: no indexed contributions',0],
    ['2026-04','Apr 2026: no linked agenda items, 1 indexed speech',0],['2026-05','May 2026: 1 agenda item',1],
    ['2026-06','Jun 2026: 1 agenda item',1],['2026-07','Jul 2026: 1 agenda item',1],
    ['2026-08','Aug 2026: 1 agenda item',1],['2026-09','Sep 2026: 1 agenda item',1],
    ['2026-10','Oct 2026: 1 agenda item',1],
  ];
  assert.deepEqual([...select('Month').options].map(o=>[o.value,o.textContent]),[['','All months'],...expected.map(([value,label])=>[value,label])]);
  assert.deepEqual([...select('Month').options].filter(o=>o.disabled).map(o=>o.value),['2026-03']);
  const bars=[...container.querySelectorAll('.ov-monthly button')];
  assert.equal(bars.length,11,'the equivalent selector must retain the full chart');
  for(const [i,[value,label,count]] of expected.entries()) {
    assert.equal(bars[i].getAttribute('aria-label'),label);
    assert.equal(bars[i].querySelector('b').textContent,String(count));
    assert.equal(bars[i].querySelector('small').textContent,label.split(':')[0]);
    assert.equal(bars[i].disabled,value==='2026-03');
  }
  assert.match(container.querySelector('.ov-sources summary').textContent,/partial/);
  await change('Month','2025-12');
  assert.equal(window.location.search.includes('ov-month=2025-12'),true);
  assert.equal(new URL(window.location.href).searchParams.get('ov-tab'),'appearances');
  assert.equal(select('Month').value,'2025-12');
  assert.deepEqual([...container.querySelectorAll('.ov-appearance>summary>b')].map(n=>n.textContent),['15 Dec 2025']);
  assert.deepEqual(sourceIds(container),detail.contributions.filter(c=>c.date.startsWith('2025-12')).map(c=>c.id).sort());
  await change('Month','2026-04');
  const unlinkedIds=detail.contributions.filter(c=>!c.parentIds.length).map(c=>c.id);
  assert.deepEqual(sourceIds(container),unlinkedIds,'a month without linked agenda items must still open its indexed speech');
  await change('Month','');
  assert.equal(new URL(window.location.href).searchParams.has('ov-month'),false);
  assert.equal(container.querySelectorAll('.ov-appearance').length,10);
  assert.deepEqual(sourceIds(container),contributionIds(detail));
  await click('Timeline');
  const unlinkedBar=[...container.querySelectorAll('.ov-monthly button')].find(b=>b.getAttribute('aria-label').startsWith('Apr 2026:'));
  await act(async()=>unlinkedBar.click());
  assert.equal(select('Month').value,'2026-04');
  assert.deepEqual(sourceIds(container),unlinkedIds,'chart activation must provide the same complete filtered result');
  await act(async()=>container.querySelector('.ov-clear').click());
  assert.equal(select('Month').value,'');
  assert.deepEqual(sourceIds(container),contributionIds(detail));
});

test('multi-year month controls keep same-named months distinct and retain every chart month',async t=>{
  const months=['2024-12','2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08','2025-09','2025-10','2025-11','2025-12','2026-01'];
  const detail=speaker('43','Multi-year guest',months.map((month,i)=>speech(month+'-15',String(i),[item(month+'-15',1)])));
  const {container,select,change}=await harness(t,[detail],'?view=outside&ov-person=43');
  assert.deepEqual([...select('Month').options].map(o=>o.value),['',...months]);
  const options=[...select('Month').options];
  for(const label of ['Dec 2024: 1 agenda item','Jan 2025: 1 agenda item','Dec 2025: 1 agenda item','Jan 2026: 1 agenda item'])assert(options.some(o=>o.textContent===label),label);
  assert.equal(container.querySelectorAll('.ov-monthly button').length,14);
  assert.deepEqual([...container.querySelectorAll('.ov-monthly button b')].map(n=>n.textContent),Array(14).fill('1'));
  await change('Month','2025-01');
  assert.deepEqual(sourceIds(container),detail.contributions.filter(c=>c.date.startsWith('2025-01')).map(c=>c.id));
  await change('Month','2026-01');
  assert.deepEqual(sourceIds(container),detail.contributions.filter(c=>c.date.startsWith('2026-01')).map(c=>c.id));
  await change('Month','');
  assert.deepEqual(sourceIds(container),contributionIds(detail));
});

test('timeline names and visible legislative cues follow all classifications, filters and clustered dates',async t=>{
  const day='2025-01-15',special='PLENARY_ACTIVITY';
  const ordinary=speaker('44','Ordinary guest',[speech(day,'1',[item(day,1)])]);
  const formal=speaker('45','Special guest',[speech(day,'2',[item(day,2)])],{[item(day,2)]:{kind:special}});
  const law=speaker('46','Legislative guest',[speech(day,'3',[item(day,3)])],{[item(day,3)]:{legislative:true}});
  const both=speaker('47','Combined guest',[speech(day,'4',[item(day,4)]),speech(day,'5',[item(day,5)])],{[item(day,4)]:{kind:special},[item(day,5)]:{legislative:true}});
  const clustered=speaker('48','Clustered guest',[
    speech('2025-01-20','6',[item('2025-01-20',1)]),speech('2025-01-21','7',[item('2025-01-21',1)]),speech('2026-10-01','8',[item('2026-10-01',1)]),
  ],{[item('2025-01-20',1)]:{kind:special},[item('2025-01-21',1)]:{legislative:true}});
  const {container,change}=await harness(t,[ordinary,formal,law,both,clustered],'?view=outside&ov-term=all');
  const row=name=>[...container.querySelectorAll('.ov-person-row')].find(r=>r.querySelector('.ov-person-name button').textContent===name);
  const mark=name=>{const node=row(name)?.querySelector('.ov-mark');assert(node,'Missing marker for '+name);return node;};
  assert.equal(mark('Ordinary guest').getAttribute('aria-label'),'Ordinary guest, 15 Jan 2025: 1 agenda item');
  assert.equal(mark('Special guest').getAttribute('aria-label'),'Special guest, 15 Jan 2025: 1 agenda item, special event');
  assert.equal(mark('Legislative guest').getAttribute('aria-label'),'Legislative guest, 15 Jan 2025: 1 agenda item, legislative file');
  assert.equal(mark('Combined guest').getAttribute('aria-label'),'Combined guest, 15 Jan 2025: 2 agenda items, special event, legislative file');
  for(const name of ['Legislative guest','Combined guest'])assert.match(mark(name).textContent,/L/,'legislative status must have a visible non-color cue');
  for(const name of ['Ordinary guest','Special guest'])assert.doesNotMatch(mark(name).textContent,/L/);
  assert.match(container.querySelector('.ov-legend .ov-legislative').textContent,/L.*Legislative file/);
  const cluster=mark('Clustered guest');
  assert.equal(cluster.getAttribute('aria-label'),'Clustered guest, 2 sitting days: 2 agenda items, special event, legislative file');
  assert.equal(cluster.querySelector('.ov-mark-symbol').textContent,'L');
  assert.equal(cluster.querySelector('.ov-mark-count').textContent,'2');
  assert.equal(cluster.querySelector('.ov-mark-symbol .ov-mark-count'),null,'a cluster count must not replace the special-event symbol');
  await act(async()=>cluster.click());
  const panel=container.querySelector('[role="dialog"]');assert(panel);
  assert.deepEqual([...panel.querySelectorAll('.ov-day>h2')].map(n=>n.textContent),['20 Jan 2025','21 Jan 2025']);
  assert.deepEqual(sourceIds(panel),clustered.contributions.slice(0,2).map(c=>c.id).sort());
  await act(async()=>panel.querySelector('[aria-label="Close speeches"]').click());
  await change('Event','special');
  assert.equal(row('Legislative guest'),undefined);
  assert.equal(mark('Combined guest').getAttribute('aria-label'),'Combined guest, 15 Jan 2025: 1 agenda item, special event');
  assert.doesNotMatch(mark('Combined guest').textContent,/L/,'classification must be recomputed after the law item is filtered out');
  await change('Event','debate');
  assert.equal(row('Special guest'),undefined);
  assert.equal(mark('Combined guest').getAttribute('aria-label'),'Combined guest, 15 Jan 2025: 1 agenda item, legislative file');
  assert.match(mark('Combined guest').textContent,/L/);
  assert.equal(mark('Combined guest').classList.contains('ov-special'),false);
});

test('a special timeline marker reveals its exact agenda item and keeps every clustered sitting',async t=>{
  const first='2026-04-28',last='2026-04-29',special=item(last,3);
  const detail=speaker('42','Commission guest',[
    speech(first,'1',[item(first,1)]),speech(last,'2',[item(last,2)]),speech(last,'3',[special]),
    speech('2026-10-07','4',[item('2026-10-07',4)]),
  ],{[special]:{kind:'PLENARY_ACTIVITY'}});
  const {window,container,click}=await harness(t,[detail]);
  const scrolls=[];
  window.HTMLElement.prototype.scrollTo=function(options){scrolls.push({element:this,options});};
  window.HTMLElement.prototype.getBoundingClientRect=function(){return {top:this.matches('h3')?900:100};};
  const mark=container.querySelector('.ov-special');
  const open=()=>act(async()=>{mark.focus();mark.click();});
  await open();
  const panel=container.querySelector('.ov-drawer'),heading=panel.querySelector(`[data-ov-item="${special}"] h3`);
  assert(document.activeElement===heading,'arrival focuses the special agenda, rather than the first debate');
  assert.deepEqual([...panel.querySelectorAll('.ov-day')].map(node=>node.dataset.ovDate),[first,last]);
  assert.equal(panel.querySelector('header small').textContent,'29 Apr 2026');
  assert.deepEqual(scrolls.map(s=>s.options),[{top:800,behavior:'instant'}]);
  assert(scrolls.every(s=>s.element===panel.querySelector('.ov-drawer-content')),'only the drawer body scrolls');
  await click('Close');
  assert(document.activeElement===mark,'closing restores the initiating marker');
  await open();
  assert(document.activeElement===container.querySelector(`[data-ov-item="${special}"] h3`),'cached reopen lands on the same exact event');
  await click('Close');
  await click('Commission guest');await click('Subjects & dossiers');
  const dossier=[...container.querySelectorAll('.ov-dossier>button')].find(button=>button.dataset.ovFocus.endsWith(':'+special));
  await act(async()=>{dossier.focus();dossier.click();});
  assert(document.activeElement===container.querySelector(`.ov-drawer [data-ov-item="${special}"] h3`),'an exact dossier selection also reveals that item');
});

test('Escape closes only the source reader inside an Outside voices drawer',async t=>{
  const detail=speaker('42','Source reader guest',[speech('2026-10-07','01',[item('2026-10-07',4)])]);
  const url='https://data.europarl.europa.eu/api/v2/speeches/'+detail.contributions[0].id+'?format=application%2Fld%2Bjson';
  detail.contributions[0].source={url,fetchedAt:source.fetchedAt};
  const sourceData={sourceUrl:url,requestUrl:url,fetchedAt:source.fetchedAt,stale:false,collection:false,limited:false,records:[{title:'Guest contribution',websiteUrl:null}],payload:{data:[{id:'eli/dl/event/'+detail.contributions[0].id}]}};
  const {window,container}=await harness(t,[detail],'?view=outside&ov-person=42',sourceData);
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  await act(async()=>container.querySelector('.ov-appearance-cards button').click());assert(container.querySelector('.ov-drawer'));
  const evidence=container.querySelector('.ov-drawer .ov-evidence');evidence.open=true;
  const trigger=evidence.querySelector('button.source-read');assert(trigger);
  await act(async()=>trigger.click());const dialog=document.querySelector('dialog.source-dialog');assert(dialog?.open);
  await act(async()=>dialog.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  assert(container.querySelector('.ov-drawer'),'Escape does not reach the containing drawer listener');
  await act(async()=>dialog.dispatchEvent(new window.Event('cancel',{cancelable:true})));
  assert.equal(document.querySelector('dialog.source-dialog'),null);assert(container.querySelector('.ov-drawer'));assert.equal(document.activeElement,trigger);
  await act(async()=>container.querySelector('.ov-drawer').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(container.querySelector('.ov-drawer'),null,'a subsequent Escape still closes the drawer');
});
