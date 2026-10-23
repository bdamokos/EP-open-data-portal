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
  const loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {TextLanguagePicker,TextLanguageFallback}=await loadModule('/src/TextLanguagePicker.tsx');
  const {createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  t.after(async()=>{await act(async()=>root.unmount());await loadModule.close();await window.happyDOM.close();for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  const render=props=>act(async()=>root.render(createElement(TextLanguagePicker,{available:['bg','de','es','fr','en','ga'],requested:'ga',value:'en',onChange(){},...props})));
  return {window,container,render,TextLanguageFallback};
}

test('native picker orders all options, uses endonyms with lang, selects actual text and emits changes',async t=>{
  const h=await harness(t),changes=[];await h.render({onChange:code=>changes.push(code)});
  const select=h.container.querySelector('select');
  assert.equal(select.getAttribute('aria-label'),'Text language');
  assert.match(select.parentElement.textContent,/Text language/);
  assert.deepEqual([...select.options].map(option=>option.value),['ga','en','fr','es','de','bg']);
  assert.equal(select.options[0].textContent,'Gaeilge');assert.equal(select.options[4].textContent,'Deutsch');
  for(const option of select.options)assert.equal(option.lang,option.value);
  assert.equal(select.value,'en');
  await act(async()=>{select.value='es';select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
  assert.deepEqual(changes,['es']);assert.equal(h.window.location.search,'');
});

test('one language hides the select and retains a plain interface-language fallback notice',async t=>{
  const h=await harness(t);
  await h.render({available:['en'],note:createElement(h.TextLanguageFallback,{requested:'ga',actual:'en',interfaceLanguage:'en'})});
  assert.equal(h.container.querySelector('select'),null);assert.equal(h.container.textContent,'Irish unavailable · showing English');
  assert.equal(h.container.querySelector('[role],[aria-live]'),null);
  await h.render({available:['en'],note:createElement(h.TextLanguageFallback,{requested:'en',actual:'en',interfaceLanguage:'en'})});
  assert.equal(h.container.textContent,'');
  await h.render({available:['fr'],value:'fr',note:createElement(h.TextLanguageFallback,{requested:'ga',actual:'fr',interfaceLanguage:'fr'})});
  assert.match(h.container.textContent,/irlandais unavailable · showing français/);
});

test('opt-in focus preservation keeps a shrinking picker until blur for one or zero languages',async t=>{
  const h=await harness(t);
  for(const available of [['en'],[]]){
    await h.render({preserveFocus:true});const select=h.container.querySelector('select');
    await act(async()=>select.focus());
    await h.render({available,preserveFocus:true,value:available[0]||null});
    assert.equal(h.container.querySelector('select'),select);assert.equal(document.activeElement,select);
    assert.deepEqual([...select.options].map(option=>option.value),available.length?available:['']);
    if(!available.length)assert.equal(select.options[0].disabled,true);
    await act(async()=>select.blur());assert.equal(h.container.querySelector('select'),null);
  }
});
