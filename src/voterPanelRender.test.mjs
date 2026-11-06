import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,createRef} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

let load;after(async()=>{if(load)await load.close();});
const rows=[{id:'1',name:'Ana Beta',country:'DE',group:'PPE',position:'for'},{id:'2',name:'Carl Gamma',country:'FR',group:'ESN',position:'against'},{id:'3',name:null,country:null,group:'unavailable',position:'abstaining'}];
async function render(props) {
  const window=new Window({url:'http://localhost/'}),old=new Map();
  for(const [k,v] of Object.entries({window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,Event:window.Event,innerWidth:1280,IntersectionObserver:class{observe(){}disconnect(){}}})){old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}
  try {
  load??=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {VoterPanel}=await load('/src/VoterPanel.tsx');
  return renderToStaticMarkup(createElement(VoterPanel,{rows,counts:{all:3,for:1,against:1,abstaining:1},position:'all',group:null,country:null,query:'',language:'en',headingRef:createRef(),onPosition(){},onQuery(){},onClearGroup(){},onClearCountry(){},onClose(){},...props}));
  } finally {await window.happyDOM.close();for(const [k,d] of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];}
}
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();

test('the panel lists a compact row per voter with the position in words, tabs with counts, a search and a close control',async()=>{
  const html=await render({});
  assert.equal((html.match(/class="vote-voter-row"/g)||[]).length,3);
  assert.match(text(html),/All 3 For 1 Against 1 Abstained 1/);
  assert.match(html,/vote-voter-position vote-for">For</);
  assert.match(html,/vote-voter-position vote-against">Against</);
  assert.match(html,/vote-voter-position vote-abstaining">Abstained</);
  assert.match(html,/type="search"/);assert.match(html,/aria-label="Close"/);
  assert.match(text(html),/Group unknown/,'a voter without a group keeps a labelled row');
  assert.doesNotMatch(html,/Loading/);
});
test('a chosen tab lists only its voters, and active filters offer their own reset',async()=>{
  const html=await render({position:'against',group:'ESN',country:'FR'});
  assert.equal((html.match(/class="vote-voter-row"/g)||[]).length,1);
  assert.match(text(html),/France · /);
  assert.match(text(html),/All countries/);assert.match(text(html),/All groups/);
  const none=await render({rows:[],counts:{all:0,for:0,against:0,abstaining:0}});
  assert.match(text(none),/No named voters in this selection/);
});
