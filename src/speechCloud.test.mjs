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

test('retained-speech coverage remains visible beside an incomplete calendar',async t=>{
  for(const retained of [true,false])for(const calendarComplete of [true,false])await t.test(`${retained?'retained':'public'} / calendar ${calendarComplete}`,async t=>{
    const data=result(speeches.slice(0,1));
    if(!retained)delete data.coverage.basis;
    data.coverage.catalogueComplete=calendarComplete;
    data.coverage.complete=!retained;
    data.availability=sourceAvailability({sourceKey:'speech-text',family:'speeches',stage:'text',language:'en',start:'2026-10-07',end:'2026-10-07',latestObservedDate:'2026-10-08',limited:retained,route:retained?'saved':'public-api',today:'2026-10-24'});
    const ui=await cloud(t,async()=>Response.json(data));await ui.render({member:1});
    const text=ui.container.textContent;
    assert.equal(text.includes('Some sitting dates unavailable.'),!calendarComplete);
    assert.equal(ui.container.querySelector('.availability-note>p').textContent.includes('Partial coverage'),retained,'the saved-source qualifier remains independent of calendar coverage');
    assert.match(ui.container.querySelector('.availability-note details').textContent,/Counts describe saved records/);
    if(!retained&&!calendarComplete)assert(!text.includes('The cloud covers the available records.'),'a calendar-only gap has one notice');
  });
});
