import test from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {wordingText} from './test-support/wordingText.mjs';

test('wording comparison modes, accessible announcements, source language, defaults and empty semantics',async t=>{
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {WordingDiff}=await loadModule('/src/components/WordingDiff.tsx'),{createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  let props={original:'La vieille politique.\n',proposed:'La nouvelle politique.\n',language:'fr',emptySemantics:'insertion-deletion'};
  const render=async patch=>{props={...props,...patch};await act(async()=>root.render(createElement(WordingDiff,props)));};
  const button=text=>[...container.querySelectorAll('button')].find(node=>node.textContent===text);
  await render({});
  assert.equal(button('Changes').getAttribute('aria-pressed'),'true');
  assert(container.querySelector('del'));assert(container.querySelector('ins'));
  assert.equal(container.querySelector('del .wording-diff__sr').textContent,'Deleted text: ');
  assert.equal(container.querySelector('ins .wording-diff__sr').textContent,'Inserted text: ');
  assert.equal(container.querySelector('ins .wording-diff__sr:last-child').textContent,' end');
  assert.equal(container.querySelector('.wording-diff__passage').lang,'fr');
  assert.equal(wordingText(container,'original'),props.original);assert.equal(wordingText(container,'proposed'),props.proposed);
  await act(async()=>button('Side by side').click());
  assert.equal(button('Side by side').getAttribute('aria-pressed'),'true');
  assert.equal(container.querySelectorAll('.wording-diff__columns section').length,2);
  assert.equal(wordingText(container,'original'),props.original);assert.equal(wordingText(container,'proposed'),props.proposed);
  await render({});assert.equal(button('Side by side').getAttribute('aria-pressed'),'true');
  await render({original:'Completely different',proposed:'Ново съдържание',language:'bg'});
  assert.match(container.textContent,/Mostly rewritten/);assert.equal(button('Side by side').getAttribute('aria-pressed'),'true');
  await act(async()=>button('Changes').click());assert.equal(button('Changes').getAttribute('aria-pressed'),'true');
  // Changing the wording resets an explicitly selected view to the operation's default.
  await act(async()=>button('Side by side').click());
  for(const [original,proposed,label,tag] of [['','Insertion','New text','ins'],['Deletion','','Deleted text','del']]){
    await render({original,proposed});
    assert.equal(button('Changes').getAttribute('aria-pressed'),'true');
    assert.equal(container.querySelector('.wording-diff__note').textContent,label);
    assert(!container.textContent.includes('Mostly rewritten'));
    assert.equal(container.querySelectorAll('.wording-diff__passage').length,1);
    assert(container.querySelector('.wording-diff__passage>'+tag));
    assert.equal(wordingText(container,'original'),original);assert.equal(wordingText(container,'proposed'),proposed);
    await act(async()=>button('Side by side').click());
    assert.equal(button('Side by side').getAttribute('aria-pressed'),'true');
    assert.equal(container.querySelectorAll('.wording-diff__columns section').length,2);
    assert.equal(wordingText(container,'original'),original);assert.equal(wordingText(container,'proposed'),proposed);
    await render({});assert.equal(button('Side by side').getAttribute('aria-pressed'),'true');
  }
  await render({original:'',proposed:''});assert.equal(container.querySelector('button,ins,del'),null);
  assert.match(container.textContent,/No original text \(insertion\).*Text deleted/);
  await render({original:'',proposed:'Not an evidenced insertion',emptySemantics:'not-supplied'});
  assert.equal(container.querySelector('button,ins,del'),null);assert.match(container.textContent,/The source supplies no original wording/);
  await render({original:null,proposed:'Available wording'});assert.equal(container.querySelector('button,ins,del'),null);
  assert.match(container.textContent,/Original wording is unavailable/);
  for(const [original,proposed] of [[null,'Available'],['Available',null],[null,''],['',null]]){
    await render({original,proposed,emptySemantics:'insertion-deletion'});
    assert.equal(container.querySelector('button,ins,del'),null);
    assert.equal(container.querySelector('.wording-diff__note'),null);
    assert.match(container.textContent,/wording is unavailable/);
  }
  await render({original:'Completely different',proposed:'Ново съдържание',language:'bg',presentation:'context'});
  assert.equal(button('Changes').getAttribute('aria-pressed'),'true');
  assert.equal(container.querySelectorAll('.wording-diff__passage').length,1);
  assert(container.querySelector('del'));assert(container.querySelector('ins'));
  assert.equal(container.querySelector('.wording-diff__legend,.wording-diff__note'),null);
  assert.equal(container.querySelector('.wording-diff__passage').lang,'bg');
  assert.equal(wordingText(container,'original'),props.original);assert.equal(wordingText(container,'proposed'),props.proposed);
  await act(async()=>button('Side by side').click());
  assert.equal(button('Side by side').getAttribute('aria-pressed'),'true');
  assert.equal(container.querySelectorAll('.wording-diff__columns section').length,2);
  assert.equal(container.querySelector('.wording-diff__legend,.wording-diff__note'),null);
  await render({});assert.equal(button('Side by side').getAttribute('aria-pressed'),'true');
  await render({presentation:'comparison'});assert.equal(button('Side by side').getAttribute('aria-pressed'),'true');
  assert.match(container.textContent,/Mostly rewritten/);
  await render({original:'x'.repeat(20_001),proposed:'Small text'});assert.equal(container.querySelector('button,ins,del'),null);
  assert.match(container.textContent,/Too extensively changed to highlight\./);assert.equal(wordingText(container,'original'),props.original);
});
