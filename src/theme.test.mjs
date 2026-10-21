import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {contrast,schemes,tokenValue,themeCss} from './test-support/themeStyles.mjs';

const text=['ink','ink-muted','accent','accent-strong','positive','warning','danger','vote-for','vote-against','vote-abstain'];
const surfaces=['bg','surface','surface-2'];
const groups=['ppe','sd','renew','greens','ecr','pfe','esn','left','ni'];

for(const scheme of schemes) {
  const token=name=>tokenValue(scheme,name);
  test(`text tokens reach 4.5:1 on every page and panel surface (${scheme})`,()=>{
    for(const surface of surfaces)for(const fg of text)
      assert(contrast(token(fg),token(surface))>=4.5,`${scheme}: --${fg} on --${surface} is ${contrast(token(fg),token(surface)).toFixed(2)}`);
  });
  test(`filled, selected, marked and status pairs stay readable (${scheme})`,()=>{
    for(const [fg,bg] of [['accent-ink','accent'],['ink','accent-soft'],['accent-strong','accent-soft'],['ink-muted','accent-soft'],
      ['mark-ink','mark'],['mark-ink','mark-active'],['positive','positive-soft'],['warning','warning-soft'],['danger','danger-soft'],
      ['ink','vote-for-soft'],['ink','vote-against-soft'],['ink','vote-abstain-soft'],['surface','positive'],['surface','warning'],['surface','ink']])
      assert(contrast(token(fg),token(bg))>=4.5,`${scheme}: --${fg} on --${bg} is ${contrast(token(fg),token(bg)).toFixed(2)}`);
  });
  test(`focus, control borders and data marks reach 3:1 (${scheme})`,()=>{
    for(const surface of [...surfaces,'surface-3']) {
      assert(contrast(token('focus'),token(surface))>=3,`${scheme}: focus on --${surface}`);
    }
    for(const surface of surfaces) {
      assert(contrast(token('line-strong'),token(surface))>=3,`${scheme}: --line-strong on --${surface}`);
      for(const group of groups)assert(contrast(token('group-'+group),token(surface))>=3,`${scheme}: --group-${group} on --${surface}`);
    }
  });
}

const stylesheets=async()=>{
  const files=[];
  for(const dir of ['.','components'])for(const name of await readdir(new URL(dir+'/',import.meta.url)))
    if(name.endsWith('.css')&&name!=='theme.css')files.push(dir==='.'?name:dir+'/'+name);
  return files;
};

test('stylesheets and components use tokens instead of raw colours',async()=>{
  const raw=/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|\b(?:white|black)\b/i;
  for(const file of await stylesheets()) {
    const css=(await readFile(new URL(file,import.meta.url),'utf8')).replace(/\/\*[\s\S]*?\*\//g,'');
    // Media marks such as 16 / 9 aspect ratios and white-space are not colours.
    const declarations=css.match(/[\w-]+\s*:[^;{}]*/g)||[];
    for(const declaration of declarations)if(!/^(?:white-space|aspect-ratio)\b/.test(declaration)&&raw.test(declaration))
      assert.fail(`${file}: ${declaration.trim()} should use a theme token`);
  }
  const components=[];
  for(const dir of ['.','components'])for(const name of await readdir(new URL(dir+'/',import.meta.url)))
    if(name.endsWith('.tsx'))components.push(dir==='.'?name:dir+'/'+name);
  for(const file of components) {
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    const literal=source.match(/['"`](?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^'"`]*)['"`;}]/);
    assert.equal(literal,null,`${file} sets a raw colour: ${literal?.[0]}`);
  }
});

test('contrast helpers reject unsupported or translucent colours instead of measuring arbitrary numbers',()=>{
  for(const color of ['oklch(0.5 0.2 240)','color-mix(in srgb, #000 12%, #fff)','light-dark(rgb(0 0 0), #fff)',
    '#xyz','#12345','#0000','#ffffff80','rgba(0,0,0,.5)','rgb(0 0 0 / 20%)','rgba(0,0,0,2)',
    'rgb(300 300 300)','rgb(120% 120% 120%)'])
    assert.throws(()=>contrast(color,'#fff'),/Unsupported colour syntax|Translucent colour|Out-of-range colour channel/,color);
  for(const white of [' #fff ','#ffff','#ffffffff','rgb(255,255,255)','rgba(255,255,255,1)','rgb(100% 100% 100% / 100%)'])
    assert.equal(contrast('#000',white),21,white);
});

test('the theme resolver rejects nested unresolved pairs while ignoring comments',()=>{
  const source='/* light-dark(...) is documented here. */ :root {--fixture:light-dark(#000, #fff);}';
  assert.match(themeCss('light',source),/--fixture:#000;/);
  assert.match(themeCss('dark',source),/--fixture:#fff;/);
  for(const scheme of schemes)assert.throws(()=>themeCss(scheme,':root {--fixture:light-dark(rgb(0 0 0), #fff);}'),/Unresolved colour pair/);
});

test('the legacy Parliament palette variables are gone',async()=>{
  for(const file of [...await stylesheets(),'theme.css']) {
    const css=await readFile(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(css,/--(?:parliament-blue|signal-blue|selected-yellow|institutional-ink|midnight-ink|panel-grey|pressed-grey|accessibility-orange)\b/,file);
  }
});

function schemeWindow(t,stored) {
  const window=new Window({url:'http://localhost/'});
  t.after(()=>window.happyDOM.close());
  window.document.head.innerHTML='<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f5f1"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#141618">';
  if(stored)window.localStorage.setItem('ep.colour-scheme.v1',stored);
  const original=Object.getOwnPropertyDescriptor(globalThis,'window'),originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'window',{value:window,configurable:true,writable:true});
  Object.defineProperty(globalThis,'document',{value:window.document,configurable:true,writable:true});
  t.after(()=>{
    if(original)Object.defineProperty(globalThis,'window',original);else delete globalThis.window;
    if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else delete globalThis.document;
  });
  return window;
}

test('the colour scheme follows the system until a light or dark choice is saved on the device',async t=>{
  const {readColourScheme,nextColourScheme,applyColourScheme,saveColourScheme,COLOUR_SCHEME_KEY}=await import('./colourScheme.mjs');
  const window=schemeWindow(t);
  const root=window.document.documentElement,bars=()=>[...window.document.querySelectorAll('meta[name="theme-color"]')].map(meta=>meta.getAttribute('content'));
  assert.equal(readColourScheme(),'system');
  applyColourScheme('system');
  assert.equal(root.dataset.theme,undefined);
  assert.deepEqual(bars(),['#f6f5f1','#141618']);
  assert.deepEqual(['system','light','dark'].map(nextColourScheme),['light','dark','system']);
  saveColourScheme('dark');
  assert.equal(window.localStorage.getItem(COLOUR_SCHEME_KEY),'dark');
  assert.equal(root.dataset.theme,'dark');
  assert.deepEqual(bars(),['#141618','#141618'],'an override pins the browser bar colour');
  assert.equal(readColourScheme(),'dark');
  saveColourScheme('system');
  assert.equal(window.localStorage.getItem(COLOUR_SCHEME_KEY),null);
  assert.equal(root.dataset.theme,undefined);
  assert.deepEqual(bars(),['#f6f5f1','#141618']);
});

test('an unknown stored colour scheme falls back to the system setting',async t=>{
  const {readColourScheme}=await import('./colourScheme.mjs');
  schemeWindow(t,'sepia');
  assert.equal(readColourScheme(),'system');
});
