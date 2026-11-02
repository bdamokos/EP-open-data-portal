import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {selectLanguageText} from './language.mjs';

test('title fallback skips empty values and follows display preference with exact language provenance',()=>{
  assert.deepEqual(selectLanguageText({bg:'Български',de:'Deutsch',es:'Español',fr:'Français'},'ga'),{text:'Français',language:'fr'});
  assert.deepEqual(selectLanguageText({en:'',de:'Deutsch',es:'Español'},'ga'),{text:'Español',language:'es'});
  assert.deepEqual(selectLanguageText({en:'English',ga:'Gaeilge'},'ga'),{text:'Gaeilge',language:'ga'});
});

async function harness(t){
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {TextLanguagePicker,TextLanguageFallback}=await load('/src/TextLanguagePicker.tsx');
  const {createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  const render=props=>act(async()=>root.render(createElement(TextLanguagePicker,{available:['bg','de','es','fr','en','ga'],requested:'ga',value:'en',onChange(){},...props})));
  return {window,container,render,TextLanguageFallback};
}

test('a fallback edition offers a native picker in EU protocol order with endonyms, the actual text selected and changes emitted',async t=>{
  const h=await harness(t),changes=[];await h.render({onChange:code=>changes.push(code)});
  const line=h.container.querySelector('.text-language-line'),select=line.querySelector('select');
  assert.equal(select.getAttribute('aria-label'),'Text language');
  assert.equal(line.textContent.includes('Text language'),false,'the picker has no visible label');
  assert.deepEqual([...select.options].map(option=>option.value),['bg','es','de','en','fr','ga']);
  assert.equal(select.options[0].textContent,'български');assert.equal(select.options[2].textContent,'Deutsch');
  for(const option of select.options)assert.equal(option.lang,option.value);
  assert.equal(select.value,'en');
  await act(async()=>{select.value='es';select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
  assert.deepEqual(changes,['es']);assert.equal(h.window.location.search,'');
});

test('the requested edition, a single edition or a withheld offer shows no picker',async t=>{
  const h=await harness(t);
  await h.render({value:'ga'});assert.equal(h.container.querySelector('select'),null,'the requested language needs no picker');
  await h.render({available:['en']});assert.equal(h.container.querySelector('select'),null,'one edition leaves nothing to choose');
  await h.render({offer:false});assert.equal(h.container.querySelector('select'),null,'an original shown by choice is not a fallback');
  await h.render({value:null});assert.equal(h.container.querySelector('select'),null,'an unloaded text has no fallback yet');
});

test('the line carries status and a plain fallback notice before the picker',async t=>{
  const h=await harness(t);
  await h.render({available:['en'],note:createElement(h.TextLanguageFallback,{requested:'ga',actual:'en',interfaceLanguage:'en'})});
  assert.equal(h.container.querySelector('select'),null);assert.equal(h.container.textContent,'Irish unavailable · showing English');
  assert.equal(h.container.querySelector('[role],[aria-live]'),null);
  await h.render({value:'ga',available:['ga'],note:createElement(h.TextLanguageFallback,{requested:'ga',actual:'ga',interfaceLanguage:'en'})});
  assert.equal(h.container.textContent,'');
  await h.render({status:createElement('span',{className:'status'},'EN · Machine translation'),note:createElement(h.TextLanguageFallback,{requested:'ga',actual:'en',interfaceLanguage:'en'})});
  const line=h.container.querySelector('.text-language-line');
  assert.deepEqual([...line.children].map(node=>node.tagName),['SPAN','SMALL','SELECT']);
  await h.render({available:['fr'],value:'fr',note:createElement(h.TextLanguageFallback,{requested:'ga',actual:'fr',interfaceLanguage:'fr'})});
  assert.match(h.container.textContent,/irlandais unavailable · showing français/);
});

test('a focused picker stays until blur after the fallback ends',async t=>{
  const h=await harness(t);
  await h.render({});const select=h.container.querySelector('select');
  await act(async()=>select.focus());
  for(const props of [{value:'ga'},{available:['en']},{available:[],value:null}]) {
    await h.render(props);
    assert.equal(h.container.querySelector('select'),select);assert.equal(document.activeElement,select);
  }
  assert.deepEqual([...select.options].map(option=>option.value),['']);assert.equal(select.options[0].disabled,true);
  await act(async()=>select.blur());assert.equal(h.container.querySelector('select'),null);
});
