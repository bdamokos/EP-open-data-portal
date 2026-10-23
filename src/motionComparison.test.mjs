import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

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
  let loadModule,root;const pending=[],calls=[];
  t.after(async()=>{if(root)await act(async()=>{root.unmount();for(const item of pending.splice(0))item.resolve(Response.json(comparison(item.stage)));});await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);calls.push(url);const stage=url.searchParams.get('stage');
    if(stage==='original-joint')return Response.json(comparison(stage,url.searchParams.get('lang')));
    return new Promise(resolve=>pending.push({resolve,stage}));
  });
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {MotionOutcome}=await loadModule('/src/MotionOutcome.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(MotionOutcome,{sourceId:'B-10-2026-0441',reference:'B10-0441/2026',language:'en',outcome:{status:'lapsed'},related:[{sourceId:'RC-10-2026-0441',reference:'RC-B10-0441/2026',title:'Public joint text',url:null,outcome:{status:'adopted'}}]})));
  assert.equal(calls.length,0);
  await act(async()=>{const details=container.querySelector('.explorer-motion-compare');details.open=true;details.dispatchEvent(new window.Event('toggle'));});
  assert.equal(calls.length,1);assert.equal(container.querySelectorAll('.explorer-diff-row').length,2);
  assert.equal(container.querySelector('.explorer-diff-rows del').childNodes[1].textContent,'.');assert.equal(container.querySelector('.explorer-diff-rows ins').childNodes[1].textContent,',');
  await act(async()=>container.querySelector('input[type="checkbox"]').click());
  assert.equal(container.querySelectorAll('.explorer-diff-row').length,1);
  const selects=()=>container.querySelectorAll('.explorer-diff-controls select');
  const change=async(index,value)=>act(async()=>{const select=selects()[index];select.value=value;select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  await change(1,'fr');assert.equal(calls.at(-1).searchParams.get('lang'),'fr');assert.equal(container.querySelector('.explorer-diff-rows').lang,'fr');
  await change(0,'joint-adopted');assert.equal(pending.length,1);assert.equal(container.querySelector('del'),null);assert.match(container.textContent,/Loading the linked texts/);
  await act(async()=>pending.shift().resolve(Response.json({error:{message:'Temporary source failure'}},{status:503})));
  assert.match(container.querySelector('.explorer-diff-error').textContent,/Temporary source failure/);
  await act(async()=>container.querySelector('.explorer-diff-error button').click());assert.equal(pending.length,1);
  await act(async()=>pending.shift().resolve(Response.json({...comparison('joint-adopted','fr'),status:'unavailable',reason:'No published adopted text explicitly links to this joint motion.',summary:null,rows:[]})));
  assert.match(container.textContent,/No published adopted text explicitly links/);assert.equal(container.querySelector('.explorer-diff-row'),null);
  await change(0,'original-joint');assert.equal(container.querySelectorAll('.explorer-diff-row').length,2,'returning to the saved stage includes unchanged passages');
});

const fullBlock=(index,kind,label,text)=>({index,kind,label,text});
function fullComparison(stage='original-joint') {
  const result=comparison(stage),moved=fullBlock(1,'recital','A','A retained recital, moved to the opening.'),before=fullBlock(2,'paragraph','2','Calls for original wording & <public text>.'),after=fullBlock(1,'paragraph','1','Calls for revised wording & <public text>.');
  result.rows=[
    {kind:'unchanged',before:moved,after:{...moved,index:0},referenceChanged:false,segments:[{type:'equal',text:moved.text}]},
    {kind:'removed',before:fullBlock(0,'citation','1','A passage present only in the original.'),after:null,referenceChanged:false,segments:[{type:'removed',text:'A passage present only in the original.'}]},
    {kind:'changed',before,after,referenceChanged:true,segments:[{type:'equal',text:'Calls for '},{type:'removed',text:'original'},{type:'added',text:'revised'},{type:'equal',text:' wording & <public text>.'}]},
    {kind:'added',before:null,after:fullBlock(2,'paragraph','2','A new target passage.'),referenceChanged:false,segments:[{type:'added',text:'A new target passage.'}]},
    {kind:'unchanged',before:fullBlock(3,'footnote','7','The complete public footnote.'),after:fullBlock(3,'footnote','7','The complete public footnote.'),referenceChanged:false,segments:[{type:'equal',text:'The complete public footnote.'}]},
  ];
  result.summary={changed:1,added:1,removed:1,unchanged:2,referenceChanged:1};return result;
}
async function readerHarness(t) {
  const window=new Window({url:'http://localhost/'}),requests=[];
  const globals={window,document:window.document,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());for(const request of requests)if(!request.done)request.resolve(Response.json({}));await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(globalThis,'fetch',input=>new Promise(resolve=>requests.push({url:new URL(input,window.location.href),resolve,done:false})));
  loadModule=await freshLoader(t,{configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {MotionComparison}=await loadModule('/src/MotionComparison.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(MotionComparison,{originalId:'B-10-2026-0441',jointId:'RC-10-2026-0441',language:'en'})));
  const respond=data=>act(async()=>{const request=requests.at(-1);request.done=true;request.resolve(Response.json(data));});
  const click=label=>act(async()=>{const button=[...container.querySelectorAll('.explorer-diff-views button')].find(node=>node.textContent===label);assert(button);button.focus();button.click();});
  const change=(selector,value)=>act(async()=>{const select=container.querySelector(selector);assert(select);select.focus();select.value=value;select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const visibleText=node=>{const copy=node.cloneNode(true);for(const marker of copy.querySelectorAll('.explorer-diff-sr'))marker.remove();return copy.textContent;};
  return {container,requests,respond,click,change,visibleText};
}

test('inline comparison opens as the whole document, keeps both change directions and non-colour cues, and switches views without requests',async t=>{
  const h=await readerHarness(t);await h.respond(fullComparison());
  const rows=h.container.querySelector('.explorer-diff-rows');
  assert.equal(rows.dataset.view,'inline');assert.equal(rows.querySelectorAll('.explorer-diff-row').length,5);
  assert.equal(h.container.querySelector('.explorer-diff-checkbox input').checked,true);
  assert.deepEqual([...rows.querySelectorAll('del')].map(h.visibleText),['A passage present only in the original.','original']);
  assert.deepEqual([...rows.querySelectorAll('ins')].map(h.visibleText),['revised','A new target passage.']);
  assert.match(h.visibleText(rows),/A retained recital.*Calls for originalrevised wording & <public text>.*complete public footnote/s);
  assert.match(rows.textContent,/Start removed wording:.*End removed wording/s);assert.match(rows.textContent,/Start added wording:.*End added wording/s);
  assert.match(rows.textContent,/Only in original/);assert.match(rows.textContent,/Only in joint/);assert.match(rows.textContent,/§ 1 · was § 2/);
  assert.equal(rows.querySelector('public'),null,'source text is escaped, never inserted as markup');
  assert.equal(rows.closest('[aria-live],[role="status"],[role="alert"]'),null);
  await h.click('Side by side');assert.equal(h.container.querySelectorAll('.explorer-diff-columns').length,5);
  assert.equal(h.container.querySelector('.explorer-diff-views [aria-pressed="true"]').textContent,'Side by side');
  assert.equal(document.activeElement.textContent,'Side by side');
  await h.click('Inline changes');assert.equal(h.requests.length,1,'local presentation changes must not refetch source texts');
});

test('clean readers preserve each exact document order and all wording/notes regardless of the comparison filter',async t=>{
  const h=await readerHarness(t);await h.respond(fullComparison());
  await act(async()=>h.container.querySelector('.explorer-diff-checkbox input').click());assert.equal(h.container.querySelectorAll('.explorer-diff-row').length,3);
  await h.click('Full text');
  assert.equal(h.container.querySelector('.explorer-diff-checkbox'),null);
  assert.equal(h.container.querySelector('.explorer-diff-read-control select').value,'after','start with the selected stage target, not its original');
  assert.equal(h.container.querySelector('.explorer-diff-reader h5').textContent,'Joint motion · RC-10-2026-0441');
  const texts=()=>[...h.container.querySelectorAll('.explorer-diff-reader .explorer-diff-wording')].map(node=>node.textContent);
  assert.deepEqual(texts(),['A retained recital, moved to the opening.','Calls for revised wording & <public text>.','A new target passage.','The complete public footnote.']);
  assert.equal(h.container.querySelector('.explorer-diff-reader del,.explorer-diff-reader ins,.explorer-diff-reader .explorer-diff-sr'),null);
  await h.change('.explorer-diff-read-control select','before');
  assert.equal(h.container.querySelector('.explorer-diff-reader h5').textContent,'Original motion · B-10-2026-0441');
  assert.deepEqual(texts(),['A passage present only in the original.','A retained recital, moved to the opening.','Calls for original wording & <public text>.','The complete public footnote.']);
  assert.equal(h.container.querySelector('.explorer-diff-reader').closest('[aria-live],[role="status"],[role="alert"]'),null);
  assert.equal(h.requests.length,1);assert.equal(document.activeElement,h.container.querySelector('.explorer-diff-read-control select'));
  await h.change('.explorer-diff-read-control select','after');await h.change('.explorer-diff-controls select','joint-adopted');
  assert.equal(h.container.querySelector('.explorer-diff-reader'),null,'stage change clears the old document immediately');
  await h.respond(fullComparison('joint-adopted'));
  assert.equal(h.container.querySelector('.explorer-diff-reader h5').textContent,'Adopted text · TA-10-2026-0339');
  assert.deepEqual([...h.container.querySelector('.explorer-diff-read-control select').options].map(node=>node.textContent),['Joint motion','Adopted text']);
  assert.equal(document.activeElement,h.container.querySelector('.explorer-diff-controls select'),'completion does not steal focus');
});

test('a common-language fallback does not claim both source documents lack the requested language',async t=>{
  const h=await readerHarness(t),result=fullComparison();
  // A common-language catalog cannot establish which of the two documents lacks English.
  result.textLanguage='fr';result.availableLanguages=['fr'];result.documents=result.documents.map(doc=>({...doc,language:'fr'}));
  await h.respond(result);
  assert.equal(h.container.querySelector('.explorer-diff-notice').textContent,'English is unavailable in one or both texts. Showing French.');
  await h.click('Full text');assert.equal(h.container.querySelector('.explorer-diff-reader').lang,'fr');
  const language=h.container.querySelectorAll('.explorer-diff-controls select')[1];await h.change('.explorer-diff-controls label:nth-child(2) select','fr');
  assert.equal(h.container.querySelector('.explorer-diff-reader'),null);assert.equal(document.activeElement,language);
  await h.respond({...result,requestedLanguage:'fr'});
  assert.equal(h.container.querySelector('.explorer-diff-notice'),null);assert.equal(h.container.querySelectorAll('.explorer-diff-controls select')[1],language);assert.equal(document.activeElement,language);
});
