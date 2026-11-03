import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retryable,retryDelay,retryableGap} from './automaticRetry.mjs';
import {createElement as h,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

test('retry policy admits transient statuses, network failures and timeouts only',()=>{
 for(const status of [408,425,429,500,502,503,504])assert(retryable({status}));
 for(const status of [400,401,403,404,409,410,422])assert(!retryable({status}));
 assert(retryable(new TypeError('network')));assert(retryable(new DOMException('timeout','TimeoutError')));
 assert(!retryable(new DOMException('cancel','AbortError')));assert(!retryable(new Error('invalid payload')));
 assert(!retryableGap({coverage:{status:'partial',retryable:false}}));
 assert(retryableGap({document:{selectedText:{refreshError:'download'}}}));
});
test('backoff has small jitter, caps its schedule and honours server deadlines',()=>{
 for(const [i,delay]of [5000,15000,45000,120000,300000,300000].entries())assert.equal(retryDelay(i,0,0,0.5),delay);
 assert.equal(retryDelay(20,0,0,0.5),300000);assert.equal(retryDelay(0,40000,10000,0.5),30000);
 assert.equal(retryDelay(0,0,0,0),4750);
});
test('automatic episodes pause hidden timers, resume online, cap attempts, retain data and clean up',async t=>{
 const win=new Window({url:'http://localhost/'}),originals=new Map();
 for(const[key,value]of Object.entries({window:win,document:win.document,HTMLElement:win.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
 let root,loader,state,calls=0,fail=false;
 t.after(async()=>{if(root)await act(async()=>root.unmount());t.mock.timers.reset();if(loader)await loader.close();await win.happyDOM.close();for(const[k,d]of originals)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 t.mock.method(globalThis,'fetch',async()=>{calls++;return fail?Response.json({error:{message:'Busy'}},{status:503}):Response.json({value:'kept'});});
 loader=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true}});
 const {useData}=await loader('/src/data.ts');const {createRoot}=await import('react-dom/client');
 function Reader(){state=useData('automatic-test');return h('output',null,state.data?.value);}
 const container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(h(Reader)));assert.equal(state.data.value,'kept');
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});t.mock.method(Math,'random',()=>0.5);
 fail=true;await act(async()=>state.retry());assert.equal(state.data.value,'kept');assert.equal(state.error,null);
 Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});await act(async()=>document.dispatchEvent(new win.Event('visibilitychange')));
 await act(async()=>t.mock.timers.tick(10000));assert.equal(calls,2);
 Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});await act(async()=>document.dispatchEvent(new win.Event('visibilitychange')));assert.equal(calls,3);
 for(const delay of [15000,45000,120000,300000,300000])await act(async()=>t.mock.timers.tick(delay));
 assert.equal(calls,8);assert.equal(state.retrying,false);assert.equal(state.error,'Busy');assert.equal(state.data.value,'kept');
 await act(async()=>t.mock.timers.tick(900000));assert.equal(calls,8);
 fail=false;await act(async()=>window.dispatchEvent(new win.Event('online')));assert.equal(calls,9);assert.equal(state.error,null);
 fail=true;await act(async()=>state.retry());const before=calls;
 await act(async()=>root.unmount());root=null;await act(async()=>t.mock.timers.tick(900000));window.dispatchEvent(new win.Event('online'));assert.equal(calls,before);
});
