import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

function comparison(stage,language='en') {
  const ids=stage==='original-joint'?['B-10-2026-0441','RC-10-2026-0441']:stage==='original-adopted'?['B-10-2026-0441','TA-10-2026-0339']:['RC-10-2026-0441','TA-10-2026-0339'];
  return {status:'available',stage,requestedLanguage:language,textLanguage:language,availableLanguages:['en','fr'],reason:null,
    documents:ids.map(id=>({id,reference:id,title:id,date:'2026-10-08',sourceUrl:`https://data.europarl.europa.eu/distribution/example/${id}_${language}.docx`,fetchedAt:'2026-10-16T15:00:00Z',language,translationType:'original'})),sources:[],
    summary:{changed:1,added:0,removed:0,unchanged:1,referenceChanged:0},rows:[
      {kind:'changed',before:{index:0,kind:'recital',label:'C',text:'turnout of 59.58 %'},after:{index:0,kind:'recital',label:'C',text:'turnout of 59,58 %'},referenceChanged:false,segments:[{type:'equal',text:'turnout of 59'},{type:'removed',text:'.'},{type:'added',text:','},{type:'equal',text:'58 %'}]},
      {kind:'unchanged',before:{index:1,kind:'paragraph',label:'1',text:'Public unchanged passage.'},after:{index:1,kind:'paragraph',label:'1',text:'Public unchanged passage.'},referenceChanged:false,segments:[{type:'equal',text:'Public unchanged passage.'}]},
    ]};
}
test('comparison is lazy and stage/language changes never display stale wording, with failure and retry',async t=>{
  const window=new Window({url:'http://localhost/'}),globals={window,document:window.document,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;const pending=[],calls=[];
  t.after(async()=>{if(root)await act(async()=>{root.unmount();for(const item of pending.splice(0))item.resolve(Response.json(comparison(item.stage)));});if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);calls.push(url);const stage=url.searchParams.get('stage');
    if(stage==='original-joint')return Response.json(comparison(stage,url.searchParams.get('lang')));
    return new Promise(resolve=>pending.push({resolve,stage}));
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocMotionOutcome}=await vite.ssrLoadModule('/src/PocMotionOutcome.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocMotionOutcome,{sourceId:'B-10-2026-0441',reference:'B10-0441/2026',language:'en',outcome:{status:'lapsed'},related:[{sourceId:'RC-10-2026-0441',reference:'RC-B10-0441/2026',title:'Public joint text',url:null,outcome:{status:'adopted'}}]})));
  assert.equal(calls.length,0);
  await act(async()=>{const details=container.querySelector('.poc-motion-compare');details.open=true;details.dispatchEvent(new window.Event('toggle'));});
  assert.equal(calls.length,1);assert.equal(container.querySelectorAll('.poc-diff-row').length,1);
  assert.equal(container.querySelector('del').textContent,'.');assert.equal(container.querySelector('ins').textContent,',');
  await act(async()=>container.querySelector('input[type="checkbox"]').click());
  assert.equal(container.querySelectorAll('.poc-diff-row').length,2);
  const selects=()=>container.querySelectorAll('.poc-diff-controls select');
  const change=async(index,value)=>act(async()=>{const select=selects()[index];select.value=value;select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  await change(1,'fr');assert.equal(calls.at(-1).searchParams.get('lang'),'fr');assert.equal(container.querySelector('.poc-diff-rows').lang,'fr');
  await change(0,'joint-adopted');assert.equal(pending.length,1);assert.equal(container.querySelector('del'),null);assert.match(container.textContent,/Loading the linked texts/);
  await act(async()=>pending.shift().resolve(Response.json({error:{message:'Temporary source failure'}},{status:503})));
  assert.match(container.querySelector('[role="alert"]').textContent,/Temporary source failure/);
  await act(async()=>container.querySelector('[role="alert"] button').click());assert.equal(pending.length,1);
  await act(async()=>pending.shift().resolve(Response.json({...comparison('joint-adopted','fr'),status:'unavailable',reason:'No published adopted text explicitly links to this joint motion.',summary:null,rows:[]})));
  assert.match(container.textContent,/No published adopted text explicitly links/);assert.equal(container.querySelector('.poc-diff-row'),null);
  await change(0,'original-joint');assert.equal(container.querySelectorAll('.poc-diff-row').length,1,'returning to the saved stage resets the unchanged filter');
});
