import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

let load;after(async()=>{if(load)await load.close();});
async function shell(props) {
  const window=new Window({url:'http://localhost/'});
  const old=new Map();for(const [k,v] of Object.entries({window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,Event:window.Event,innerWidth:1280})){old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}
  try {
  load??=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {InsightShell}=await load('/src/InsightShared.tsx'),{InsightFrame}=await load('/src/InsightFrame.tsx');
  return renderToStaticMarkup(createElement(InsightFrame,{view:'legislation'},createElement(InsightShell,{view:'legislation',title:'Plenary agenda',...props},createElement('p',null,'body'))));
  } finally {await window.happyDOM.close();for(const [k,d] of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];}
}
test('the page heading stays in the document when it is only hidden visually',async()=>{
  assert.match(await shell({}),/<h1>Plenary agenda<\/h1>/);
  const quiet=await shell({quietTitle:true});
  assert.match(quiet,/class="insight-intro vote-sr-only"[^>]*><h1>Plenary agenda<\/h1>/);
  assert.doesNotMatch(await shell({hideTitle:true}),/<h1>/);
});
