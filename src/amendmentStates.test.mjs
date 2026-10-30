import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';
import {wordingText} from './test-support/wordingText.mjs';

const effectiveLanguage=node=>node?.closest('[lang]')?.getAttribute('lang');

for(const language of ['en','hu','fr'])test(`${language}: incomplete wording and retained list evidence remain distinct from missing source text`,async t=>{
  const window=new Window({url:'http://localhost/?view=amendments'});window.document.documentElement.lang=language;
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  const base={targetDocumentId:'A-10-2026-0254',language:'fr',outcome:'unavailable',documentDate:'2026-10-16',dateBasis:'individual-amendment-document'};
  const items=[
    {...base,id:'withheld',number:1,textIntegrity:'incomplete',originalText:null,proposedText:null,listRelationship:'unverified',recordRetained:true},
    {...base,id:'unsafe-baseline',number:2,textIntegrity:'incomplete',originalText:'Unverified old original must be withheld',proposedText:'Unverified old proposal must be withheld'},
    {...base,id:'absent-list',number:3,textIntegrity:'complete',originalText:'',proposedText:'Proposition conservée',wordingRetained:true,listRelationship:'absent-current-relationship'},
    {...base,id:'missing',number:4,textIntegrity:'unavailable',originalText:null,proposedText:null,listRelationship:'current'},
    {...base,id:'variants',number:5,conflicted:true,variants:[
      {...base,listId:'variant-withheld',textIntegrity:'incomplete',originalText:null,proposedText:null,listRelationship:'unverified'},
      {...base,listId:'variant-absent',textIntegrity:'complete',originalText:'Original conservé',proposedText:'',wordingRetained:true,listRelationship:'absent-current-relationship',recordRetained:true},
    ]},
  ];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,window.location.href);assert(url.pathname.endsWith('/amendments'));
    return Response.json({items,total:1234,offset:0,limit:20,coverage:{complete:false,pending:false,gaps:[]}});
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {Amendments}=await loadModule('/src/Amendments.tsx');
  const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement('div',{lang:language},createElement(Amendments,{language,document:'A-10-2026-0254'}))));
  const card=id=>container.querySelector('#amendment-'+id);
  const withheld=card('withheld');
  assert.equal(withheld.querySelector('.wording-diff,ins,del'),null);
  assert.equal(withheld.querySelector('.explorer-amendment-evidence-state').textContent,'Wording unavailable.');
  assert.deepEqual([...withheld.querySelectorAll('.explorer-amendment-texts section>p')].map(node=>node.textContent),['Unavailable.','Unavailable.']);
  assert.doesNotMatch(withheld.textContent,/No original text \(insertion\)|Text deleted/);
  assert.doesNotMatch(card('unsafe-baseline').textContent,/Unverified old original must be withheld|Unverified old proposal must be withheld/);
  const absent=card('absent-list');
  assert.equal(absent.querySelector('.wording-diff__note').textContent,'New text');
  assert.equal(absent.querySelector('.wording-diff__toggle button[aria-pressed="true"]').textContent,'Side by side');
  const insertion=absent.querySelector('.wording-diff__passage>ins');assert(insertion);
  assert.equal(wordingText(absent,'original'),'');assert.equal(wordingText(absent,'proposed'),'Proposition conservée');
  assert.equal(effectiveLanguage(insertion),'fr');
  assert.doesNotMatch(absent.textContent,/Original (?:text|wording) (?:is )?unavailable/);
  await act(async()=>[...absent.querySelectorAll('button')].find(button=>button.textContent==='Side by side').click());
  assert.match(absent.querySelector('.wording-diff__columns section:first-child>p').textContent,/No original text \(insertion\)/);
  assert.equal(absent.querySelector('.wording-diff__columns section:nth-child(2)>p').lang,'fr');
  assert.doesNotMatch(absent.textContent,/record is retained from an earlier indexed source/,'a retained wording flag does not invent whole-record retention');
  const missing=card('missing');
  assert.match(missing.querySelector('.explorer-amendment-texts section>p').textContent,/^Unavailable\.$/);
  assert.equal(missing.querySelector('.wording-diff,ins,del'),null,'unavailable original wording does not imply an insertion');
  assert.doesNotMatch(missing.textContent,/New text|No original text \(insertion\)/);
  assert.equal(missing.querySelector('.explorer-amendment-evidence-state'),null,'a current list does not receive an unverified or stale label');
  const variants=card('variants').querySelectorAll('.explorer-amendment-variant');
  assert.equal(variants[0].querySelector('.explorer-amendment-evidence-state').textContent,'Wording unavailable.');
  assert.equal(variants[1].querySelector('.explorer-amendment-evidence-state'),null,'retention and list-relationship states are not shown');
  await act(async()=>[...variants[1].querySelectorAll('button')].find(button=>button.textContent==='Side by side').click());
  assert.match(variants[1].textContent,/Text deleted/);
  for(const state of container.querySelectorAll('.explorer-amendment-evidence-state'))assert.equal(effectiveLanguage(state),'en');
  for(const row of [withheld,card('unsafe-baseline'),missing,variants[0]])for(const paragraph of row.querySelectorAll('.explorer-amendment-texts p'))assert.equal(effectiveLanguage(paragraph),'en','withheld and unavailable wording explanations stay English');
  assert.equal(variants[1].querySelector('.wording-diff__columns section:first-child>p').lang,'fr');
  assert.equal(effectiveLanguage(variants[1].querySelector('.wording-diff__columns section:nth-child(2)>p')),'en');
  const count=container.querySelector('.explorer-amendment-coverage strong>span');
  assert.equal(count.textContent,(1234).toLocaleString(language));assert.equal(count.lang,language);assert.equal(effectiveLanguage(count.parentElement),'en');
  for(const date of container.querySelectorAll('time'))assert.equal(date.lang,language);
});
