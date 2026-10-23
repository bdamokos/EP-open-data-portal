import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {Window} from 'happy-dom';
import {speakerPresentation} from './speakerPresentation.mjs';

test('speaker affiliation is separate from explicit on-behalf-of and committee capacities',()=>{
  const speaker={id:'124846',name:'Pina Picierno',affiliationGroup:'S&D'};
  assert.deepEqual(speakerPresentation(speaker).roles,[{text:'S&D',language:''}]);
  for(const designation of [{id:'ECR',politicalGroup:true},{id:'AFET',politicalGroup:false}]) {
    const intervention={speaker,onBehalfOf:[{...designation,source:'participation_in_name_of'}]};
    assert.deepEqual(speakerPresentation(speaker,'en',{intervention}).roles,[]);
  }
  assert.deepEqual(speakerPresentation({...speaker,affiliationGroup:null}).roles,[]);
  assert.deepEqual(speakerPresentation({...speaker,sittingRole:'chair'}).roles.map(role=>role.text),['Chairing the sitting']);
});
test('person cards render dated affiliation, explicit null and legacy current-group fallback',async t=>{
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,location:window.location,history:window.history};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  t.after(async()=>{await window.happyDOM.close();for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  t.after(()=>vite.close());
  const {InsightPeople}=await vite.ssrLoadModule('/src/InsightShared.tsx');
  const person={id:'124846',name:'Pina Picierno',currentMep:false,group:'Renew'};
  const render=value=>renderToStaticMarkup(createElement(InsightPeople,{people:[value]}));
  assert.match(render({...person,affiliationGroup:'S&D'}),/S&amp;D/);
  assert(!render({...person,affiliationGroup:'S&D'}).includes('Renew'));
  assert(!render({...person,affiliationGroup:null}).includes('insight-person-group'));
  assert.match(render(person),/Renew/);
});
