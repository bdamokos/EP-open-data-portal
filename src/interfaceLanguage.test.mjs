import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {INTERFACE_LANGUAGE_KEY,INTERFACE_LANGUAGES,saveInterfaceLanguage,defaultInterfaceLanguage,interfaceLanguageInUrl} from './interfaceLanguage.mjs';
import {interfaceLanguages} from './interfaceCopy.ts';

const script=await readFile(new URL('../public/assets/interface-language.js',import.meta.url),'utf8');

function boot(t,{search='',stored=null,browser=['en-GB']}={}) {
  const window=new Window({url:'http://localhost/explorer/'+search+'#reader'});
  t.after(()=>window.happyDOM.close());
  Object.defineProperty(window.navigator,'languages',{value:browser,configurable:true});
  Object.defineProperty(window.navigator,'language',{value:browser[0],configurable:true});
  if(stored!==null)window.localStorage.setItem(INTERFACE_LANGUAGE_KEY,stored);
  window.history.replaceState({kept:true},'',window.location.href);
  new window.Function(script)();
  return window;
}

test('the startup script and app share the 24 interface languages in EU protocol order',()=>{
  assert.deepEqual([...INTERFACE_LANGUAGES].sort(),[...interfaceLanguages].sort());
  assert.match(script,new RegExp(`\\[${INTERFACE_LANGUAGES.map(code=>`'${code}'`).join(', ')}\\]`));
  assert(script.includes(`'${INTERFACE_LANGUAGE_KEY}'`));
});

test('an explicit language wins, then the saved choice, then the first supported browser language',async t=>{
  const cases=[
    [{search:'?lang=fr&view=questions',stored:'de',browser:['hu']},'?lang=fr&view=questions'],
    [{search:'?view=questions',stored:'de',browser:['hu']},'?view=questions&lang=de'],
    [{search:'?view=questions',stored:'en',browser:['hu']},'?view=questions'],
    [{search:'?view=questions',browser:['nb-NO','pt-BR','fr']},'?view=questions&lang=pt'],
    [{search:'?view=questions',stored:'xx',browser:['ga-IE']},'?view=questions&lang=ga'],
    [{search:'?lang=xx',browser:['hu-HU']},'?lang=hu'],
    [{search:'',browser:['ja','zh']},''],
    [{search:'',browser:['en-US','de']},''],
  ];
  for(const [options,expected] of cases)await t.test(JSON.stringify(options),t=>{
    const window=boot(t,options);
    assert.equal(window.location.search,expected);
    assert.equal(window.location.hash,'#reader');assert.equal(window.location.pathname,'/explorer/');
    assert.deepEqual(window.history.state,{kept:true});
  });
});

test('the startup script runs blocking in the head before the shell and app read the language',async()=>{
  const [html,vite]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../vite.config.ts',import.meta.url),'utf8')]);
  const page=new Window({url:'http://localhost/',settings:{disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
  try {
    page.document.write(html);
    const scripts=[...page.document.querySelectorAll('script')],index=src=>scripts.findIndex(node=>node.getAttribute('src')===src);
    const bootstrap=scripts[index('./assets/interface-language.js')];
    assert(bootstrap&&page.document.head.contains(bootstrap));
    for(const attribute of ['type','async','defer','nomodule'])assert.equal(bootstrap.hasAttribute(attribute),false,`bootstrap must be blocking: ${attribute}`);
    for(const later of ['./assets/initial-shell.js','/src/initialShell.ts','/src/main.tsx'])assert(index('./assets/interface-language.js')<index(later),later);
  } finally {await page.happyDOM.close();}
  assert.match(vite,/startupAssets = \[[^\]]*'interface-language'/,'production builds fingerprint the startup script');
});

test('saving and reading a choice tolerate unavailable storage, including a denied storage getter',t=>{
  const values=new Map();
  saveInterfaceLanguage('hu',{setItem:(key,value)=>values.set(key,value)});
  assert.equal(values.get(INTERFACE_LANGUAGE_KEY),'hu');
  assert.doesNotThrow(()=>saveInterfaceLanguage('hu',{setItem(){throw new Error('blocked');}}));
  assert.doesNotThrow(()=>saveInterfaceLanguage('hu',null));
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('SecurityError');}});
  t.after(()=>original?Object.defineProperty(globalThis,'localStorage',original):delete globalThis.localStorage);
  assert.doesNotThrow(()=>saveInterfaceLanguage('fr'));
  assert.equal(defaultInterfaceLanguage({languages:['fi-FI']}),'fi');
});

test('the app resolves a missing language exactly like the startup script and keeps explicit English when it differs',async t=>{
  const cases=[[{stored:'de',browser:['hu']},'de'],[{stored:'en',browser:['hu']},'en'],[{browser:['nb-NO','pt-BR']},'pt'],[{stored:'xx',browser:['ga-IE']},'ga'],[{browser:['ja']},'en']];
  for(const [options,expected] of cases) {
    const storage={getItem:key=>key===INTERFACE_LANGUAGE_KEY?options.stored??null:null};
    assert.equal(defaultInterfaceLanguage({storage,languages:options.browser}),expected);
    const window=boot(t,{search:'?view=questions',...options});
    assert.equal(new URLSearchParams(window.location.search).get('lang')??'en',expected,'startup script agrees');
    assert.equal(interfaceLanguageInUrl('en',{storage,languages:options.browser}),expected!=='en');
    assert.equal(interfaceLanguageInUrl('fr',{storage,languages:options.browser}),true);
  }
});

test('the header control shows the translate mark and code and lists endonyms in protocol order',async t=>{
  const {createElement,act}=await import('react');
  const {freshLoader}=await import('./test-support/viteRunner.mjs');
  const window=new Window({url:'http://localhost/'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {ParliamentHeader,headerRowFits}=await load('/src/ParliamentHeader.tsx');
  const {createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  t.after(async()=>{await act(async()=>root.unmount());await load.close();await window.happyDOM.close();for(const [key,value] of originals)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  const changes=[],render=props=>act(async()=>root.render(createElement(ParliamentHeader,{view:'legislation',onMembers(){},language:'hu',...props})));
  await render({});assert.equal(container.querySelector('.explorer-language-control'),null,'no control without a change handler');
  await render({onLanguageChange:code=>changes.push(code)});
  const control=container.querySelector('.explorer-language-control'),select=control.querySelector('select');
  assert(control.querySelector('svg[aria-hidden="true"]'));assert.equal(control.querySelector('.explorer-language-code').textContent,'HU');
  assert.equal(select.getAttribute('aria-label'),'Interface language');assert.equal(select.value,'hu');
  assert.deepEqual([...select.options].map(option=>option.value),[...INTERFACE_LANGUAGES]);
  for(const option of select.options)assert.equal(option.lang,option.value);
  assert.equal(select.options[1].textContent,'español');assert.equal(select.options[14].textContent,'magyar');
  const order=[...container.querySelector('.parliament-header-tools').children].map(node=>node.className.baseVal??node.className);
  assert.deepEqual(order.map(name=>name.split(' ')[0]),['explorer-scheme-toggle','explorer-language-control','explorer-text-search'],'theme, language and search stay together in that order');
  await act(async()=>{select.value='fr';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.deepEqual(changes,['fr']);
  assert.equal(container.querySelector('.parliament-header').hasAttribute('data-stacked'),false,'one row until measured otherwise');
  // Destinations take their own row only when brand, destinations and tools cannot share one.
  const row={brand:380,destinations:[100,150,100,80,130,260,90],destinationGap:2,tools:140,gap:20};
  assert.equal(headerRowFits({...row,available:1440-80}),false,'Hungarian labels at 1440px');
  assert.equal(headerRowFits({...row,available:1600-80}),true);
  assert.equal(headerRowFits({...row,destinations:[60,130,90,80,120,110,90],available:1440-80}),true,'English labels at 1440px');
});

