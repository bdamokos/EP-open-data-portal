import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

test('story reveal checks its top, respects reduced motion and leaves focus alone',async t=>{
 const window=new Window(),old=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{value:window,configurable:true});
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null}},{sharedServerKey:'story-visibility'});t.after(async()=>{await load.close();await window.happyDOM.close();old?Object.defineProperty(globalThis,'window',old):delete globalThis.window;});
 const {revealStoryPeriod}=await load('/src/storyPeriodVisibility.ts'),calls=[],element=window.document.createElement('div');element.scrollIntoView=options=>calls.push(options);let top=0; element.getBoundingClientRect=()=>({top});
 const control=window.document.createElement('button');window.document.body.append(control);control.focus();
 for(top of [0,20,window.innerHeight-65,window.innerHeight-64])revealStoryPeriod(element);assert.deepEqual(calls,[]);
 for(const reduced of [false,true]){window.matchMedia=()=>({matches:reduced});for(top of [-1,window.innerHeight-63,window.innerHeight-1,window.innerHeight,window.innerHeight+1])revealStoryPeriod(element);assert.deepEqual(calls.splice(0),Array(5).fill({block:'start',behavior:reduced?'instant':'smooth'}));}
 revealStoryPeriod(null);assert.equal(window.document.activeElement,control);
});
