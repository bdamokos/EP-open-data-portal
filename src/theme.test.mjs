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

test('the slate accent is the only interface accent, including the pre-React shell and the favicon',async()=>{
  const [html,favicon]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../public/assets/favicon.svg',import.meta.url),'utf8')]);
  const pair=`light-dark(${tokenValue('light','accent')},${tokenValue('dark','accent')})`;
  assert.equal(html.split(pair).length-1,2,'the initial shell paints its current link and focus ring in the accent');
  assert.match(favicon,new RegExp(`<rect[^>]* fill="${tokenValue('light','accent')}"`));
  for(const [name,source] of [['theme.css',themeCss('light')+themeCss('dark')],['index.html',html],['favicon.svg',favicon]])
    assert.doesNotMatch(source,/#(?:0b5f69|6cc7cf|0a1c1f|163a40|dcedee|084a52|9adde3|d9e9ea|1f3437)\b/i,`${name} keeps a retired teal`);
});

test('vote positions, their washes and the accent are separate colours',()=>{
  for(const scheme of schemes) {
    const positions=['vote-for','vote-against','vote-abstain'].map(name=>tokenValue(scheme,name));
    assert.equal(new Set([...positions,tokenValue(scheme,'accent')]).size,4,`${scheme}: positions and accent are four colours`);
    for(const soft of ['vote-for-soft','vote-against-soft','vote-abstain-soft'])
      assert.notEqual(tokenValue(scheme,soft),tokenValue(scheme,'accent-soft'),`${scheme}: --${soft} is not the accent wash`);
  }
});

test('the type, space and grid scale ships with phone values under 768 px',()=>{
  const css=themeCss('light');
  const base=css.match(/:root\s*{[\s\S]*?\n}/)[0],phone=css.match(/@media \(max-width: 767px\)\s*{\s*:root\s*{([\s\S]*?)}/)[1];
  const read=(source,name)=>source.match(new RegExp(`--${name}:\\s*(\\d+)px`))?.[1];
  const scale={'t-small':[13,12],'t-meta':[15,14],'t-row':[18,16],'t-say':[22,18],'t-h2':[28,20],'t-h1':[36,24],
    s1:[4],s2:[8],s3:[12],s4:[16],s5:[24],s6:[40,32],s7:[64],num:[88,68],word:[96],gut:[104,52],table:[520],gutter:[40,16]};
  for(const [name,[wide,narrow]] of Object.entries(scale)) {
    assert.equal(Number(read(base,name)),wide,`--${name}`);
    assert.equal(read(phone,name)===undefined?undefined:Number(read(phone,name)),narrow,`--${name} on phones`);
  }
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
  assert.deepEqual(['system','dark','light'].map(scheme=>nextColourScheme(scheme,'light')),['dark','light','system'],'a light system switches to dark first');
  assert.deepEqual(['system','light','dark'].map(scheme=>nextColourScheme(scheme,'dark')),['light','dark','system'],'a dark system switches to light first');
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

test('the first-paint script applies a saved override exactly like the app, before the app module loads',async t=>{
  const {COLOUR_SCHEME_KEY,applyColourScheme}=await import('./colourScheme.mjs');
  const [script,html]=await Promise.all([readFile(new URL('../public/assets/colour-scheme.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);
  const page=new Window({url:'http://localhost/',settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  t.after(()=>page.happyDOM.close());
  page.document.write(html);
  const scripts=[...page.document.querySelectorAll('script')];
  const bootstraps=scripts.filter(node=>node.getAttribute('src')==='./assets/colour-scheme.js');
  const modules=scripts.filter(node=>node.getAttribute('src')==='/src/main.tsx');
  assert.equal(bootstraps.length,1,'one actual bootstrap script is present');
  assert.equal(modules.length,1,'one actual app module script is present');
  const [bootstrapNode]=bootstraps,[moduleNode]=modules;
  assert(page.document.head.contains(bootstrapNode),'the bootstrap runs in the document head');
  assert.equal(moduleNode.getAttribute('type'),'module');
  for(const attribute of ['type','async','defer','nomodule'])assert.equal(bootstrapNode.hasAttribute(attribute),false,`bootstrap must be blocking: ${attribute}`);
  assert(scripts.indexOf(bootstrapNode)<scripts.indexOf(moduleNode),'the blocking bootstrap precedes the actual app module');
  for(const stored of ['light','dark','sepia',null]) {
    const bootstrap=new Window({url:'http://localhost/'}),app=new Window({url:'http://localhost/'});
    t.after(()=>{bootstrap.happyDOM.close();app.happyDOM.close();});
    for(const window of [bootstrap,app])window.document.head.innerHTML='<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f5f1"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#141618">';
    if(stored)bootstrap.localStorage.setItem(COLOUR_SCHEME_KEY,stored);
    new bootstrap.Function(script)();
    applyColourScheme(stored==='light'||stored==='dark'?stored:'system',app.document);
    const state=window=>[window.document.documentElement.dataset.theme,[...window.document.querySelectorAll('meta[name="theme-color"]')].map(meta=>meta.getAttribute('content'))];
    assert.deepEqual(state(bootstrap),state(app),`stored ${stored}`);
  }
});
