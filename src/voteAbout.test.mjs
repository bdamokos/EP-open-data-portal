import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

let load;after(async()=>{if(load)await load.close();});
async function mount(t,summary,reference='2026/2933(RSP)',extra={}) {
  const window=new Window({url:'http://localhost/?view=legislation'}),old=new Map(),requests=[];
  for(const [k,v] of Object.entries({window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,Event:window.Event,PopStateEvent:window.PopStateEvent,innerWidth:1280,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:fn=>{fn();return 0;}})){old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}
  t.mock.method(globalThis,'fetch',async input=>{requests.push(new URL(input,location.href));return Response.json({view:'procedure-context',reference,language:'en',summaries:summary?[{id:summary.id,documentReference:'T10-0361/2026'}]:[],summary});});
  load??=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {VoteAbout}=await load('/src/VoteAbout.tsx'),{createRoot}=await import('react-dom/client');
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  t.after(async()=>{await act(async()=>root.unmount());await window.happyDOM.close();for(const [k,d] of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
  await act(async()=>root.render(createElement(VoteAbout,{reference,language:'en',open:false,onToggle(){},votes:[],viewedId:null,onOpenVote(){},...extra})));
  for(let i=0;i<20&&!requests.length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  return {node,requests};
}
test('the item\'s own summary shows under "About this text" from the procedure-context read, with no loading text',async t=>{
  const {node,requests}=await mount(t,{id:'s1',stage:'parliament-decision',blocks:[{kind:'paragraph',text:'The European Parliament adopted a resolution.'},{kind:'paragraph',text:'It was tabled by five groups.'}]});
  assert.equal(requests[0].pathname.endsWith('/insights/procedure-context'),true);
  assert.equal(requests[0].searchParams.get('reference'),'2026/2933(RSP)');
  assert.match(node.textContent,/About this text/);assert.match(node.textContent,/adopted a resolution/);assert.doesNotMatch(node.textContent,/Loading/);
});
test('an item without a summary shows nothing at all',async t=>{
  const {node}=await mount(t,null,'2026/2935(RSP)');
  assert.equal(node.textContent,'');
});

const blocks=[{kind:'paragraph',text:'The European Parliament adopted by 454 votes to 34, with 93 abstentions, amendments to the proposal.'}];
const whole={id:'DEC-198405',outcome:'ADOPTED',decidedDocumentIds:['TA-10-2026-0361'],aggregateTotals:{for:454,against:34,abstaining:93}};
const part={id:'DEC-199360',outcome:'ADOPTED',decidedDocumentIds:[],aggregateTotals:{for:423,against:125,abstaining:32}};
test('a figure the records cannot tie to a decision by exact id is left out of the summary',async t=>{
  const {node}=await mount(t,{id:'s2',stage:'first-reading',blocks},'2025/0222(COD)',{votes:[{...whole,decidedDocumentIds:[]},part],viewedId:'DEC-199360'});
  assert.match(node.textContent,/adopted amendments to the proposal/);assert.doesNotMatch(node.textContent,/454|whole text/);
});
test('a linked whole-text vote that is not the one viewed is named, with a way to open it',async t=>{
  let opened=null;
  const {node}=await mount(t,{id:'s3',stage:'first-reading',blocks},'2025/0223(COD)',{votes:[whole,part],viewedId:'DEC-199360',onOpenVote:id=>{opened=id;}});
  assert.match(node.textContent,/adopted by 454 votes to 34/);
  assert.match(node.textContent,/The whole text was adopted by 454 to 34, with 93 abstaining\./);
  const button=[...node.querySelectorAll('button')].find(b=>b.textContent==='Open that vote');assert(button);
  await act(async()=>button.click());assert.equal(opened,'DEC-198405');
});
test('the note is not repeated when the whole-text vote is the one viewed',async t=>{
  const {node}=await mount(t,{id:'s4',stage:'first-reading',blocks},'2025/0224(COD)',{votes:[whole,part],viewedId:'DEC-198405'});
  assert.match(node.textContent,/adopted by 454 votes to 34/);assert.doesNotMatch(node.textContent,/whole text/);
});
