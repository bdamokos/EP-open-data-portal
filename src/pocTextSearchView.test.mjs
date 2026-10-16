import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act,useRef} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const speech='MTG-PL-2026-10-07-OTH-123';
const otherSpeech='MTG-PL-2026-10-07-OTH-456';
const hit=(sourceKey='en',language='en')=>({sourceId:speech,sourceKey,kind:'speech',parentId:null,date:'2026-10-07',language,translationType:'original',sourceUrl:'https://www.europarl.europa.eu/example',sha256:'fixture-hash',snippet:'<img src=x onerror=alert(1)> \u0002énergie\u0003 & policy',people:[{id:42,name:'Fixture speaker',role:'Speaker'}]});
const english=hit('mul','en'),french=hit('fr@part-2','fr');
function results(request={},hits=[english,french]) {
  const included=request.sourceIds?.length===0?[]:hits;
  return {total:included.length?1:0,limit:20,offset:request.offset||0,nextOffset:null,truncated:false,coverage:{complete:false,note:'Saved fixture texts only.'},results:included.length?[{sourceId:speech,kind:'speech',date:'2026-10-07',title:'Energy <strong>policy</strong>',reference:'Fixture contribution',hits:included}]:[]};
}
function stored(version) {
  return {...version,body:'<script>window.injected=true</script> énergie & policy',highlightedBody:'<script>window.injected=true</script> \u0002énergie\u0003 & policy',fetchedAt:'2026-10-08T12:00:00Z',checkedAt:'2026-10-08T12:00:00Z'};
}

async function setup(t,{query='',respond,highlights=false}={}) {
  const window=new Window({url:'http://localhost/?'+query});
  const registry=new Map(),frames=new Map();let nextFrame=0;
  window.requestAnimationFrame=callback=>{const id=++nextFrame;frames.set(id,callback);return id;};
  window.cancelAnimationFrame=id=>frames.delete(id);
  class Highlight {constructor(...ranges){this.ranges=ranges;}}
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,CSS:highlights?{highlights:registry}:window.CSS,Highlight:highlights?Highlight:undefined,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();frames.clear();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const calls=[];
  t.mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(input,window.location.href),body=options.body?JSON.parse(options.body):null,call={url,options,body};calls.push(call);
    if(respond){const response=await respond(call);if(response)return response;}
    if(url.pathname.endsWith('/corpus/search'))return Response.json(results(body));
    if(url.pathname.endsWith('/corpus/text'))return Response.json(stored(url.searchParams.get('source-key')===french.sourceKey?french:english));
    throw new Error('Unexpected request: '+url);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const module=await vite.ssrLoadModule('/src/PocTextSearch.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const defaults={prefix:'fixture-fts',label:'Search fixture speeches',language:'en'};
  const render=props=>act(async()=>root.render(createElement(module.PocTextSearch,{...defaults,...props})));
  const find=selector=>{const node=container.querySelector(selector);assert(node,'Missing '+selector);return node;};
  const button=label=>{const node=[...container.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===label||node.textContent===label);assert(node,'Missing button '+label);return node;};
  const click=label=>act(async()=>button(label).click());
  async function flushFrames(){for(let round=0;round<5&&frames.size;round++)await act(async()=>{const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(performance.now());});}
  async function input(selector,value){await act(async()=>{const node=find(selector);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new window.InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));});}
  async function select(selector,value){await act(async()=>{const node=find(selector);node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));});}
  const submit=()=>act(async()=>find('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  const searches=()=>calls.filter(call=>call.url.pathname.endsWith('/corpus/search'));
  const texts=()=>calls.filter(call=>call.url.pathname.endsWith('/corpus/text'));
  return {...module,window,root,container,calls,registry,render,find,button,click,flushFrames,input,select,submit,searches,texts};
}

test('text search stays collapsed without requests, opens with focus, and posts exact context including an empty scope',async t=>{
  const view=await setup(t),scope={member:42,country:'IT',from:'2026-10-01',to:'2026-10-11',sourceIds:[speech,otherSpeech],kinds:['speech'],group:'document',dateBasis:'document'};
  await view.render(scope);
  assert.equal(view.container.querySelector('input'),null);
  assert.equal(view.calls.length,0);
  assert(view.button('Search fixture speeches').querySelector('svg'));
  await view.click('Search fixture speeches');await view.flushFrames();
  assert.equal(view.window.document.activeElement,view.find('input[type="search"]'));
  assert.equal(view.calls.length,0,'opening an empty search does not load a corpus');
  await view.input('input[type="search"]','  energy policy  ');await view.submit();
  assert.equal(view.searches().length,1);
  const request=view.searches()[0];
  assert.equal(request.options.method,'POST');assert.equal(request.options.credentials,'omit');
  assert.equal(request.options.headers['Content-Type'],'application/json');
  assert.deepEqual(request.body,{query:'energy policy',...scope,language:'en',uiLanguage:'en',sort:'relevance',limit:20,offset:0});
  assert.equal(new URL(view.window.location.href).searchParams.get('fixture-fts-text-lang'),'en','submitting pins the actual text language');
  await view.render({...scope,sourceIds:[]});
  assert.deepEqual(view.searches().at(-1).body.sourceIds,[],'empty exact scope must never become an unrestricted search');
  assert.equal(view.container.querySelectorAll('.poc-search-result').length,0);
  assert.match(view.container.textContent,/No matches in indexed text/);
});

test('the reader opens the selected exact language fragment, escapes source markup and stays closed after closing',async t=>{
  const view=await setup(t,{query:'fixture-fts-search=energy&fixture-fts-text-lang=all'});
  await view.render();
  assert.equal(view.container.querySelector('img'),null);
  assert.equal(view.find('.poc-search-excerpt').textContent,'<img src=x onerror=alert(1)> énergie & policy');
  assert.equal(view.find('.poc-search-excerpt mark').textContent,'énergie');
  await view.select('.poc-search-versions select',french.sourceKey);await view.click('Read speech');await view.flushFrames();
  assert.equal(view.texts().length,1);
  assert.equal(view.texts()[0].url.searchParams.get('source-id'),speech);
  assert.equal(view.texts()[0].url.searchParams.get('source-key'),french.sourceKey);
  assert.equal(view.find('.poc-search-body').lang,'fr');
  assert.match(view.find('.poc-search-body').textContent,/<script>window.injected=true<\/script>/);
  assert.equal(view.find('.poc-search-body').querySelector('script'),null);
  assert.equal(view.window.injected,undefined);
  assert.equal(view.find('.poc-search-body mark').textContent,'énergie');
  assert.equal(new URL(view.window.location.href).searchParams.get('fixture-fts-read'),JSON.stringify([speech,french.sourceKey]));
  await view.click('Close text search');await view.flushFrames();
  assert.equal(view.container.querySelector('.poc-search-panel'),null);
  assert.equal(view.button('Search fixture speeches').getAttribute('aria-expanded'),'false');
  assert.equal(view.window.document.activeElement,view.button('Search fixture speeches'));
  assert.equal(new URL(view.window.location.href).searchParams.has('fixture-fts-read'),false);
  await view.flushFrames();assert.equal(view.container.querySelector('.poc-search-panel'),null,'clearing a selected reader must not reopen the panel');
});

test('a same-query busy response and retry keep the previous matching results visible',async t=>{
  let searchCount=0,finishRetry;
  const view=await setup(t,{query:'fixture-fts-search=energy&fixture-fts-text-lang=en',respond:call=>{
    if(!call.url.pathname.endsWith('/corpus/search'))return;
    searchCount++;
    if(searchCount===2)return Response.json({error:{code:'corpus_busy',message:'Busy'}},{status:503});
    if(searchCount===3)return new Promise(resolve=>{finishRetry=resolve;});
  }});
  await view.render();const title=view.find('.poc-search-result h4');
  await view.submit();assert.equal(searchCount,2);
  assert.equal(view.find('.poc-search-result h4'),title);
  assert.match(view.find('[role="alert"]').textContent,/Search is busy/);
  await view.click('Retry');assert.equal(searchCount,3);
  assert.equal(view.find('.poc-search-result h4'),title);
  assert.equal(view.find('.poc-search-results').getAttribute('aria-busy'),'true');
  await act(async()=>finishRetry(Response.json(results())));
  assert.equal(view.container.querySelector('[role="alert"]'),null);
  assert.equal(view.find('.poc-search-result h4'),title);
});

test('changing interface language preserves explicit search language and selected hit identity',async t=>{
  const view=await setup(t,{query:'fixture-fts-search=energy&fixture-fts-text-lang=all'});
  await view.render();await view.select('.poc-search-versions select',french.sourceKey);await view.click('Read speech');
  await view.render({language:'hu'});
  assert.equal(view.searches().at(-1).body.uiLanguage,'hu');
  assert.equal(view.searches().at(-1).body.language,undefined);
  assert.equal(view.find('.poc-search-facets select').value,'all');
  assert.equal(view.find('.poc-search-versions select').value,french.sourceKey);
  assert.equal(view.find('.poc-search-body').lang,'fr');
  assert.equal(new URL(view.window.location.href).searchParams.get('fixture-fts-read'),JSON.stringify([speech,french.sourceKey]));
});

test('a URL-selected language fragment opens independently of the interface-default version',async t=>{
  const query=new URLSearchParams({'fixture-fts-search':'energy','fixture-fts-text-lang':'all','fixture-fts-read':JSON.stringify([speech,french.sourceKey])});
  const view=await setup(t,{query:query.toString()});await view.render();
  assert.equal(view.texts().length,1,'a saved French reader link must open even when the interface defaults to English');
  assert.equal(view.texts()[0].url.searchParams.get('source-key'),french.sourceKey);
  assert.equal(view.find('.poc-search-body').lang,'fr');
});

test('a saved exact reader link opens without a search query or an unrelated corpus search',async t=>{
  const query=new URLSearchParams({'fixture-fts-read':JSON.stringify([speech,french.sourceKey])});
  const view=await setup(t,{query:query.toString()});await view.render();
  assert.equal(view.searches().length,0);
  assert.equal(view.texts().length,1);
  assert.equal(view.texts()[0].url.searchParams.get('source-id'),speech);
  assert.equal(view.texts()[0].url.searchParams.get('source-key'),french.sourceKey);
  assert.equal(view.texts()[0].url.searchParams.has('q'),false);
  assert.equal(view.find('.poc-search-body').lang,'fr');
});

test('changing entity scope clears the old page and reader before requesting the new entity',async t=>{
  const query=new URLSearchParams({'fixture-fts-search':'energy','fixture-fts-text-lang':'all','fixture-fts-page':'3','fixture-fts-read':JSON.stringify([speech,english.sourceKey])});
  const view=await setup(t,{query:query.toString()});await view.render({member:42,sourceIds:[speech]});
  assert.equal(view.searches()[0].body.offset,60);
  const before=view.searches().length;
  await view.render({member:43,sourceIds:[otherSpeech]});
  const changed=view.searches().slice(before);assert(changed.length>0);
  assert(changed.every(call=>call.body.member===43&&call.body.offset===0));
  assert.equal(new URL(view.window.location.href).searchParams.has('fixture-fts-page'),false);
  assert.equal(new URL(view.window.location.href).searchParams.has('fixture-fts-read'),false);
  assert.equal(view.container.querySelector('.poc-search-reader'),null);
});

test('local find uses CSS highlights without changing React links or footnotes and restores focus on close',async t=>{
  const view=await setup(t,{highlights:true});let opens=0;
  function TextFixture(){const target=useRef(null);return createElement('section',null,
    createElement(view.PocFindInText,{target,label:'Find in fixture text',onOpen:()=>opens++}),
    createElement('div',{ref:target,id:'fixture-text'},createElement('p',null,'Énergie and ',createElement('a',{id:'fixture-link',href:'https://example.test/source'},'énergie'),createElement('sup',null,createElement('a',{id:'fixture-note-link',href:'#fixture-note'},'1'))),createElement('p',{id:'fixture-note'},'Footnote: énergie.')));}
  await act(async()=>view.root.render(createElement(TextFixture)));
  const body=view.find('#fixture-text'),markup=body.innerHTML,link=view.find('#fixture-link'),footnote=view.find('#fixture-note'),noteLink=view.find('#fixture-note-link');
  await view.click('Find in fixture text');await view.flushFrames();
  assert.equal(opens,1);assert.equal(view.window.document.activeElement,view.find('input[type="search"]'));
  await view.input('input[type="search"]','energie');await view.flushFrames();
  assert.equal(view.find('[role="status"]').textContent,'1 / 3');
  const all=[...view.registry.entries()].find(([key])=>!key.endsWith('active'))?.[1];assert(all);
  assert.deepEqual(all.ranges.map(range=>range.toString()),['Énergie','énergie','énergie']);
  await view.click('Next match');assert.equal(view.find('[role="status"]').textContent,'2 / 3');
  assert.equal(view.find('#fixture-link'),link);assert.equal(view.find('#fixture-note'),footnote);assert.equal(view.find('#fixture-note-link'),noteLink);assert.equal(body.innerHTML,markup);
  assert.equal(body.querySelector('mark'),null,'find must not replace React-managed text with markup');
  await view.click('Close find');await view.flushFrames();
  assert.equal(view.registry.size,0);assert.equal(view.container.querySelector('input'),null);
  assert.equal(view.window.document.activeElement,view.button('Find in fixture text'));
  assert.equal(body.innerHTML,markup);assert.equal(view.calls.length,0);
});
