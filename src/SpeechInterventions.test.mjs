import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {readFileSync} from 'node:fs';
import {speechSummary} from '../server/odp.mjs';
import {SpeechInterventions} from '../server/speech-intervention-service.mjs';

test('every contribution opens from its header while type badges remain informational',async t=>{
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/speech-interventions-live-20261015.json',import.meta.url)));
  const available=fixture.activities.map(speechSummary);
  const types=['speech','chair','written','blue-card-question','blue-card-answer','blue-card-reaction','blue-card-intervention'];
  const records=types.map(type=>{
    const row=available.find(row=>row.intervention.type===type);assert(row,`Missing ${type} fixture`);
    return {...row,replyTo:null,exchangeId:null};
  });
  t.mock.method(globalThis,'fetch',async url=>{
    if(String(url).includes('speech-context/'))return Response.json({speechId:records[0].id,debates:[{id:fixture.parent.activity_id,titles:{en:'Debate'},records,exchanges:[],coverage:{complete:true}}]});
    const row=records.find(row=>String(url).includes(row.id));assert(row);
    return Response.json({id:row.id,xml:null,textLanguage:'en'});
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {SpeechContextPanel}=await loadModule('/src/SpeechInterventions.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(SpeechContextPanel,{id:records[0].id,language:'en',preload:false})));
  const toggle=container.querySelector('.intervention-context-toggle');assert.match(toggle.textContent,/^View speech in context/);
  await act(async()=>toggle.click());
  assert.equal(container.querySelectorAll('.intervention-badges button').length,0);
  const entries=[...container.querySelectorAll('.intervention-sequence>li')];assert.equal(entries.length,types.length);
  for(const [index,entry] of entries.entries()) {
    const button=entry.querySelector('.intervention-read');
    assert.equal(entry.querySelectorAll('button').length,1,`${types[index]} has one disclosure`);
    assert.equal(button.type,'button');assert.equal(button.getAttribute('aria-expanded'),'false');
    assert.equal(button.querySelector('.intervention-read-chevron').getAttribute('aria-hidden'),'true');
    // Names, times and the opening indicator belong to the same target.
    assert(button.querySelector('.intervention-read-label > span'));assert(button.querySelector('small'));
    await act(async()=>button.click());
    assert.equal(button.getAttribute('aria-expanded'),'true');
    const reader=document.getElementById(button.getAttribute('aria-controls'));assert(reader);
    assert.equal(document.activeElement,reader);assert(reader.querySelector('.intervention-connected-text'));
    assert.equal(container.querySelectorAll('.intervention-read[aria-expanded=true]').length,1);
    await act(async()=>button.click());
    assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(container.querySelector('.intervention-connected-text'),null);
  }
});

test('procedural notes explain later contributions without speech controls, while trailing notes are omitted',async t=>{
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/speech-interventions-live-20261015.json',import.meta.url)));
  const procedures=JSON.parse(readFileSync(new URL('../server/fixtures/speech-procedures-live-20261016.json',import.meta.url)));
  const speech=n=>fixture.activities.find(a=>a.recorded_in_a_realization_of?.[0]?.numbering===n);
  const row=activity=>({...speechSummary(activity),replyTo:null,exchangeId:null});
  const first=row(speech(172)),last=row(speech(179)),unconfirmed=row(speech(180)),notes=procedures.activities.map(row),calls=[];
  const unmatched=structuredClone(procedures.activities[1]);unmatched.had_participation.had_participant_person=['person/999999'];
  const unmatchedRow=row(unmatched);
  // Older cached responses can still contain the unverified heading text.
  unmatchedRow.intervention.narrative='ESTEBAN GONZÁLEZ PONS PRESIDELS: · Vice-President';
  t.mock.method(globalThis,'fetch',async url=>{
    calls.push(String(url));assert(String(url).includes('speech-context/'),'procedural notes must not fetch individual speech pages');
    const records=String(url).includes(first.id)?[first,...notes,last]:String(url).includes(last.id)?[first,last,...notes]:[first,unmatchedRow,unconfirmed];
    return Response.json({speechId:first.id,unavailable:false,debates:[{id:fixture.parent.activity_id,titles:{bg:'Bulgarian debate',fr:'Débat français'},records,exchanges:[],coverage:{complete:true,available:4,expected:4,missingIds:[]}}]});
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {SpeechContextPanel}=await loadModule('/src/SpeechInterventions.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(SpeechContextPanel,{key:first.id,id:first.id,language:'en'})));
  await act(async()=>container.querySelector('button').click());
  const caption=window.document.querySelector('.intervention-debate > .intervention-caption');assert.equal(caption.textContent,'Débat français');assert.equal(caption.lang,'fr');
  const entries=[...container.querySelectorAll('.intervention-sequence>li')];
  assert.equal(entries.length,4);assert.match(entries[1].textContent,/The sitting was briefly suspended/);
  assert.match(entries[2].textContent,/ESTEBAN GONZÁLEZ PONSVice-President · Chairing the sitting/);
  for(const entry of entries.slice(1,3)) {
    assert.equal(entry.querySelector('button,a,.intervention-badge'),null);
    assert(!entry.textContent.includes('Contribution'));assert(!entry.textContent.includes('Speech'));
  }
  assert.equal(container.querySelectorAll('.intervention-read').length,2);
  await act(async()=>root.render(createElement(SpeechContextPanel,{key:last.id,id:last.id,language:'en'})));
  await act(async()=>container.querySelector('button').click());
  assert.equal(container.querySelectorAll('.intervention-sequence>li').length,2);
  assert(!container.textContent.includes('briefly suspended'));assert(!container.textContent.includes('ESTEBAN'));
  assert(!container.textContent.includes('records available'),'intentional display omission must not imply missing source records');
  await act(async()=>root.render(createElement(SpeechContextPanel,{key:unconfirmed.id,id:unconfirmed.id,language:'en'})));
  await act(async()=>container.querySelector('button').click());
  const unknownChair=container.querySelectorAll('.intervention-sequence>li')[1];
  assert.equal(unknownChair.textContent,'Chair change · identity unconfirmed');
  assert(!container.textContent.includes('ESTEBAN'));assert(!container.textContent.includes('PRESIDELS'));
  assert.equal(unknownChair.querySelector('button,a'),null);
  assert.equal(calls.length,3);
});

test('failed debate sections offer a real retry that bypasses the partial-result cache and recovers',async t=>{
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root,calls=0,finish;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const id='MTG-PL-2026-03-25-OTH-2017069380111',parent='MTG-PL-2026-03-25-PVCRE-ITM-13';
  const result={speechId:id,unavailable:false,debates:[{id:parent,titles:{en:'European Council conclusions'},records:[],exchanges:[],coverage:{complete:false,available:0,expected:null},error:'Parliament data is unavailable (429). Please try again.'}]};
  t.mock.method(globalThis,'fetch',async url=>{
    assert(String(url).includes('speech-context/'));calls++;
    if(calls===1)return Response.json(result);
    return new Promise(resolve=>finish=()=>resolve(Response.json({...result,debates:[{...result.debates[0],error:undefined,coverage:{complete:true,available:0,expected:0}}]})));
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {SpeechContextPanel}=await loadModule('/src/SpeechInterventions.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(SpeechContextPanel,{id,language:'en'})));
  assert.equal(calls,0,'automatic preload is deferred');
  await act(async()=>container.querySelector('button').click());
  const retry=()=>[...container.querySelectorAll('button')].find(button=>button.textContent.includes('Retry'));
  assert.equal(retry().textContent,'Retry sequence');assert.equal(calls,1);
  await act(async()=>retry().click());assert.equal(calls,2);assert.equal(retry().disabled,true);
  assert(container.textContent.includes('Retrying sequence…'));assert(container.querySelector('[role="status"]'));
  await act(async()=>finish());assert.equal(retry(),undefined);assert(!container.textContent.includes('429'));assert(container.querySelector('ol'));
});

test('top-level rate errors show a countdown and enable retry after the cooldown',async t=>{
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());t.mock.timers.reset();if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{message:'Parliament is temporarily limiting requests.',retryAt:Date.now()+500}},{status:503});});
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {SpeechContextPanel}=await loadModule('/src/SpeechInterventions.tsx');
  t.mock.timers.enable({apis:['Date','setInterval','setTimeout'],now:Date.now()});
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');root=createRoot(container);
  await act(async()=>root.render(createElement(SpeechContextPanel,{id:'MTG-PL-2026-03-25-OTH-2017069380108',language:'en'})));
  await act(async()=>container.querySelector('button').click());
  const retry=()=>[...container.querySelectorAll('button')].find(button=>button.textContent.startsWith('Retry sequence'));
  assert.equal(retry().disabled,true);assert.match(retry().textContent,/in 1s/);
  await act(async()=>{t.mock.timers.tick(499);});assert.equal(retry().disabled,true);
  await act(async()=>retry().click());assert.equal(calls,1,'cooldown blocks early retry');
  // This countdown samples once per second: the original 500ms hint is
  // reflected at the first 1000ms update, without an automatic request.
  await act(async()=>{t.mock.timers.tick(1);});assert.equal(calls,1);
  await act(async()=>{t.mock.timers.tick(499);});assert.equal(retry().disabled,true);
  await act(async()=>{t.mock.timers.tick(1);});
  assert.equal(calls,1,'expiry enables retry without automatically requesting');
  assert.equal(retry().disabled,false);assert.equal(retry().textContent,'Retry sequence');
});

test('missing debate records remain visible without the sequence sources disclosure',async t=>{
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/speech-interventions-live-20261015.json',import.meta.url)));
  const row={...speechSummary(fixture.activities.find(a=>a.recorded_in_a_realization_of?.[0]?.numbering===172)),replyTo:null,exchangeId:null};
  t.mock.method(globalThis,'fetch',async()=>Response.json({speechId:row.id,unavailable:false,debates:[{id:fixture.parent.activity_id,titles:{en:'Debate'},records:[row],exchanges:[],coverage:{complete:false,available:1,expected:2,missingIds:['missing']},sources:[{url:'https://example.org/sequence-source',fetchedAt:'2026-10-16T12:00:00Z',stale:false}]}]}));
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {SpeechContextPanel}=await loadModule('/src/SpeechInterventions.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');root=createRoot(container);
  await act(async()=>root.render(createElement(SpeechContextPanel,{id:row.id,language:'en'})));
  await act(async()=>container.querySelector('button').click());
  assert.match(container.textContent,/1 of 2 debate records available\. Links stop at missing contributions\./);
  assert.equal(container.querySelector('details,a[href="https://example.org/sequence-source"]'),null);
  assert(!container.textContent.includes('Sequence sources'));
});

test('resolved adjacent-chapter records do not show as missing, while unfetched records still do',async t=>{
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const fixture=JSON.parse(readFileSync(new URL('../server/fixtures/outside-agenda-conflict.json',import.meta.url)));
  const adjacent=JSON.parse(readFileSync(new URL('../server/fixtures/speech-agenda-coverage.json',import.meta.url)));
  const rows=[...fixture.contributions.map(c=>c.activity),adjacent.reassigned.activity];
  const record=data=>({url:'https://data.europarl.europa.eu/api/v2/speeches',fetchedAt:Date.now(),payload:{data,meta:{total:data.length}}});
  const context=async missing=>new SpeechInterventions({request:async endpoint=>
    record(endpoint.startsWith('/events/')?[{...adjacent.agenda.activity,consists_of:rows.map(a=>a.id)}]:endpoint.startsWith('/speeches/')?[rows[0]]:missing?[rows[0],rows[2]]:rows)
  }).context(rows[0].activity_id);
  const contexts=[await context(false),await context(true)];let calls=0;
  t.mock.method(globalThis,'fetch',async()=>Response.json(contexts[calls++]));
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {SpeechContextPanel}=await loadModule('/src/SpeechInterventions.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');root=createRoot(container);
  for(const [index,id] of [rows[0].activity_id,rows[1].activity_id].entries()) {
    await act(async()=>root.render(createElement(SpeechContextPanel,{key:id,id,language:'en'})));
    await act(async()=>container.querySelector('button').click());
    assert.equal(container.querySelectorAll('.intervention-sequence>li').length,index===0?2:1);
    if(index===0)assert(!container.textContent.includes('records available'));
    else assert.match(container.textContent,/1 of 2 debate records available\. Links stop at missing contributions\./);
  }
  assert.equal(calls,2);
});
