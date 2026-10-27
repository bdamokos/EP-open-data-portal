import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

test('historical tags join country by exact ID and never read directory group fields',async t=>{
 const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const window=new Window();t.after(async()=>{await load.close();await window.happyDOM.close();});
 const {PersonNamesProvider}=await load('/src/PersonName.tsx'),{RecordMemberAffiliation}=await load('/src/components/RecordMemberAffiliation.tsx');
 const members=[{id:42,firstName:'Exact',lastName:'Member',countryCode:'HU',groupCode:'PPE',group:'Renew'},
 {id:43,firstName:'Exact',lastName:'Member',countryCode:'FR',groupCode:'PPE'}];
 const render=(props,roster=members)=>{const node=window.document.createElement('div');node.innerHTML=renderToStaticMarkup(createElement(PersonNamesProvider,{members:roster},createElement(RecordMemberAffiliation,{language:'en',...props})));return node;};
 for(const id of [42,'42']){
  const tag=render({id});assert.equal(tag.textContent.trim(),'HUHungary');assert.equal(tag.querySelector('i'),null);
  assert.equal(render({id,datedGroup:'S&D'}).textContent.trim(),'S&D · HUHungary');
 }
 for(const id of [null,undefined,'042','person/42','Exact Member','43x',44])assert.equal(render({id}).innerHTML,'');
 assert.equal(render({id:43}).textContent.trim(),'FRFrance');
 assert.equal(render({id:42},[]).innerHTML,'');
 assert.equal(render({id:44,datedGroup:'S&D'}).textContent.trim(),'S&D');
});
