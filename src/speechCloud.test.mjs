import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {sourceAvailability} from '../server/source-availability.mjs';
import {freshLoader} from './test-support/viteRunner.mjs';

async function cloud(t,fetch) {
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(loadModule)await loadModule.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  t.mock.method(globalThis,'fetch',fetch);
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {SpeechCloud}=await loadModule('/src/SpeechCloud.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  return {container,render:props=>act(async()=>root.render(createElement(SpeechCloud,props)))};
}
const speeches=Array.from({length:102},(_,i)=>({id:'MTG-PL-2026-10-07-OTH-'+i,date:'2026-10-07',title:'Speech '+i,machineTranslation:false,people:[]}));
const result=(rows,nextPage=null,restarted=false)=>({
  scope:{kind:'member',phase:'past'},language:'en',restarted,
  words:[{word:'climate',label:null,speechCount:rows.length,occurrences:rows.length,speechIds:rows.slice(0,5).map(row=>row.id)}],speeches:rows,
  coverage:{basis:'retained-corpus',transcripts:rows.length,matchedSpeechRecords:rows.length,missingLanguage:0,unreadableText:0,complete:false,truncated:false,associationUnavailable:false},
  window:{start:'2026-10-07',end:'2026-10-07'},nextPage,
});

test('a restarted cloud discards cached selection pages and finishes all remaining pages',async t=>{
  const pages=[],seen=[];let changed=false;
  const ui=await cloud(t,async input=>{
    const url=new URL(input,'http://localhost'),member=url.searchParams.get('member'),page=Number(url.searchParams.get('page'));
    pages.push([member,page]);
    if(member==='2')return Response.json({...result([]),words:[]});
    if(!changed&&page===0)return Response.json(result(speeches.slice(0,50),1));
    if(!changed){changed=true;return Response.json(result(speeches.slice(1,51),1,true));}
    return Response.json(result(speeches.slice(1,1+(page+1)*50),page<2?page+1:null));
  });
  const props={member:1,onSpeechSpeakers:rows=>seen.push(rows.map(row=>row.id))};
  await ui.render(props);
  assert.deepEqual(pages,[['1',0],['1',1],['1',1],['1',2]],'page one must be fetched again after the server restarts at page zero');
  assert.equal(ui.container.querySelector('[role="alert"],[role="status"]'),null);
  assert.match(ui.container.querySelector('.explorer-cloud-caption').textContent,/101 speeches/);
  assert.deepEqual(seen.at(-1),speeches.slice(1).map(row=>row.id),'the moved speech is excluded and the final page is retained');
  await ui.render({member:2});
  seen.length=0;
  await ui.render(props);
  assert.deepEqual(pages.slice(4),[['2',0],['1',0]],'returning to the selection refreshes the expired page zero and reuses the new later pages');
  assert(seen.every(ids=>!ids.includes(speeches[0].id)),'the former page zero must not flash a speech outside the restarted selection');
  assert.equal(seen.at(-1).length,101);
});

test('repeated cloud changes stop at the restart bound and an explicit retry fetches fresh pages',async t=>{
  const pages=[];let changing=true;
  const ui=await cloud(t,async input=>{
    const page=Number(new URL(input,'http://localhost').searchParams.get('page'));pages.push(page);
    return Response.json(result(speeches.slice(0,50),changing?1:null,changing&&page===1));
  });
  await ui.render({member:1});
  assert.deepEqual(pages,[0,1,1,1],'three distinct server restarts reach the bound');
  assert(ui.container.querySelector('[role="alert"]'));
  assert.equal(ui.container.querySelector('[role="status"]'),null);
  changing=false;
  await act(async()=>ui.container.querySelector('[role="alert"] button').click());
  assert.deepEqual(pages,[0,1,1,1,0],'retry begins at the expired first page');
  assert.equal(ui.container.querySelector('[role="alert"],[role="status"]'),null);
});

test('retry resumes a failed proxy page without depending on expired earlier pages',async t=>{
  const pages=[],seen=[];let finish;
  const partial=rows=>({...result(rows,2),availability:sourceAvailability({sourceKey:'speech-text',family:'speeches',stage:'text',language:'en',limited:true,observedRecords:rows.length,route:'public-api'}),coverage:{...result(rows).coverage,catalogueComplete:false,missingLanguage:3,unreadableText:1}});
  const ui=await cloud(t,async input=>{
    const page=Number(new URL(input,'http://localhost').searchParams.get('page'));pages.push(page);
    if(pages.length===1)return Response.json({...partial(speeches.slice(0,50)),nextPage:1});
    if(pages.length===2)return Response.json(partial(speeches.slice(0,100)));
    if(pages.length===3||page!==2)return new Response('error code: 502\n',{status:502});
    return new Promise(resolve=>finish=()=>resolve(Response.json({...partial(speeches),nextPage:null})));
  });
  await ui.render({member:1,onSpeechSpeakers:rows=>seen.push(rows.map(row=>row.id))});
  assert.deepEqual(pages,[0,1,2],'a proxy error stops the walk without automatic retries');
  assert.match(ui.container.querySelector('[role="alert"]').textContent,/Some speech text could not be loaded/);
  assert.match(ui.container.querySelector('.explorer-cloud-caption').textContent,/100 speeches/);
  const before=seen.at(-1);
  await act(async()=>ui.container.querySelector('[role="alert"] button').click());
  assert.deepEqual(pages,[0,1,2,2],'retry must use the failed cursor even when calendar pages have expired');
  assert.match(ui.container.querySelector('.explorer-cloud-caption').textContent,/100 speeches/);
  assert.doesNotMatch(ui.container.textContent,/Some sitting dates unavailable|period selector/,'the period selector owns its calendar notice, not each selected speech cloud');
  assert.equal(ui.container.querySelector('.availability-note'),null,'the concrete load error or missing-language counts explain the limitation');
  assert.deepEqual(seen.at(-1),before,'prior speech identities remain available during recovery');
  await act(async()=>{finish();await new Promise(resolve=>setImmediate(resolve));});
  assert.equal(Boolean(ui.container.querySelector('[role="alert"],.explorer-cloud-progress')),false);
  assert.match(ui.container.querySelector('.explorer-cloud-caption').textContent,/102 speeches/);
  assert.match(ui.container.textContent,/3 without text in this language\. 1 text unreadable\./);
  assert.equal(ui.container.querySelector('.availability-note'),null,'the concrete load error or missing-language counts explain the limitation');
  assert.deepEqual(seen.at(-1),speeches.map(row=>row.id));
});

test('an initial proxy failure retries page zero and does not become an empty result',async t=>{
  const pages=[];
  const ui=await cloud(t,async input=>{
    pages.push(Number(new URL(input,'http://localhost').searchParams.get('page')));
    return pages.length===1?new Response('error code: 502\n',{status:502}):Response.json(result(speeches.slice(0,1)));
  });
  await ui.render({member:1});
  assert.deepEqual(pages,[0]);
  assert(ui.container.querySelector('[role="alert"]'));
  assert.equal(ui.container.querySelector('.explorer-cloud-caption'),null);
  assert.doesNotMatch(ui.container.textContent,/No (saved )?oral speeches/);
  await act(async()=>ui.container.querySelector('[role="alert"] button').click());
  assert.deepEqual(pages,[0,0]);
  assert.equal(ui.container.querySelector('[role="alert"],[role="status"]'),null);
  assert.match(ui.container.querySelector('.explorer-cloud-caption').textContent,/1 speech/);
});

test('retained-speech coverage remains visible beside an incomplete calendar',async t=>{
  for(const retained of [true,false])for(const calendarComplete of [true,false])await t.test(`${retained?'retained':'public'} / calendar ${calendarComplete}`,async t=>{
    const data=result(speeches.slice(0,1));
    if(!retained)delete data.coverage.basis;
    data.coverage.catalogueComplete=calendarComplete;
    data.coverage.complete=calendarComplete;
    data.availability=sourceAvailability({sourceKey:'speech-text',family:'speeches',stage:'text',language:'en',start:'2026-10-07',end:'2026-10-07',latestObservedDate:retained?'2026-10-08':null,limited:true,observedRecords:retained?null:data.speeches.length,checkedAt:'2026-10-24T10:00:00Z',route:retained?'saved':'public-api',today:'2026-10-24'});
    const ui=await cloud(t,async()=>Response.json(data));await ui.render({member:1});
    const text=ui.container.textContent;
    assert.doesNotMatch(text,/Some sitting dates unavailable|period selector/);
    const note=ui.container.querySelector('.availability-note');
    if(retained)assert.match(note.textContent,/Latest text:/);
    else assert.equal(note,null,'unknown publication maturity is not a missing transcript');
    assert.doesNotMatch(text,/Partial coverage|Later dates unavailable/);
    assert.equal(ui.container.querySelectorAll('.availability-note').length,retained?1:0);
  });
});
