import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act,useRef} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

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

async function setup(t,{query='',respond,highlights=false,members}={}) {
  const window=new Window({url:'http://localhost/?'+query});
  const registry=new Map(),frames=new Map();let nextFrame=0;
  window.requestAnimationFrame=callback=>{const id=++nextFrame;frames.set(id,callback);return id;};
  window.cancelAnimationFrame=id=>frames.delete(id);
  class Highlight {constructor(...ranges){this.ranges=ranges;}}
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,CSS:highlights?{highlights:registry}:window.CSS,Highlight:highlights?Highlight:undefined,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let loadModule,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(loadModule)await loadModule.close();frames.clear();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const calls=[];
  t.mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(input,window.location.href),body=options.body?JSON.parse(options.body):null,call={url,options,body};calls.push(call);
    if(respond){const response=await respond(call);if(response)return response;}
    if(url.pathname.endsWith('/corpus/search'))return Response.json(results(body));
    if(url.pathname.endsWith('/corpus/text'))return Response.json(stored(url.searchParams.get('source-key')===french.sourceKey?french:english));
    throw new Error('Unexpected request: '+url);
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const module=await loadModule('/src/TextSearch.tsx');
  const {PersonNamesProvider}=await loadModule('/src/PersonName.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const defaults={prefix:'fixture-fts',label:'Search fixture speeches',language:'en'};
  const render=props=>act(async()=>root.render(createElement(PersonNamesProvider,{members},createElement(module.TextSearch,{...defaults,...props}))));
  const find=selector=>{const node=container.querySelector(selector);assert(node,'Missing '+selector);return node;};
  const button=label=>{const node=[...container.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===label||node.textContent===label);assert(node,'Missing button '+label);return node;};
  const click=label=>act(async()=>button(label).click());
  async function flushFrames(){for(let round=0;round<5&&frames.size;round++)await act(async()=>{const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(performance.now());});}
  async function input(selector,value){await act(async()=>{const node=find(selector);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new window.InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));});}
  async function select(selector,value){await act(async()=>{const node=find(selector);node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));});}
  const submit=()=>act(async()=>find('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  const searches=()=>calls.filter(call=>call.url.pathname.endsWith('/corpus/search'));
  const texts=()=>calls.filter(call=>call.url.pathname.endsWith('/corpus/text'));
  return {...module,window,root,container,calls,registry,render,find,button,click,flushFrames,input,select,submit,searches,texts,loadModule:path=>loadModule(path)};
}

test('search coverage stays partial independently of unavailable corpus status',async t=>{
  const view=await setup(t,{query:'fixture-fts-search=energy',respond:({url})=>{
    if(url.pathname.endsWith('/corpus/status'))return Response.json({error:{code:'corpus_status_timeout',message:'Corpus status is temporarily unavailable.'}},{status:503});
  }});
  await view.render();
  assert.match(view.find('.explorer-search-count').textContent,/1 matching document · Partial text coverage/);
  assert.equal(view.calls.some(call=>call.url.pathname.endsWith('/corpus/status')),false,'search does not turn unavailable global counts into zero coverage');
  assert.equal(view.container.querySelector('[role="alert"]'),null);
});

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
  assert.equal(request.options.method,'POST');assert.equal(request.url.searchParams.has('v'),false);assert.equal(request.options.credentials,'omit');
  assert.equal(request.options.headers['Content-Type'],'application/json');
  assert.deepEqual(request.body,{query:'energy policy',...scope,language:'en',uiLanguage:'en',sort:'relevance',limit:20,offset:0});
  assert.equal(new URL(view.window.location.href).searchParams.get('fixture-fts-text-lang'),'en','submitting pins the actual text language');
  await view.render({...scope,sourceIds:[]});
  assert.deepEqual(view.searches().at(-1).body.sourceIds,[],'empty exact scope must never become an unrestricted search');
  assert.equal(view.container.querySelectorAll('.explorer-search-result').length,0);
  assert.match(view.container.textContent,/No matches in indexed text/);
});

test('the reader opens the selected exact language fragment, escapes source markup and stays closed after closing',async t=>{
  const view=await setup(t,{query:'fixture-fts-search=energy&fixture-fts-text-lang=all'});
  await view.render();
  assert.equal(view.container.querySelector('img'),null);
  assert.equal(view.find('.explorer-search-excerpt').textContent,'<img src=x onerror=alert(1)> énergie & policy');
  assert.equal(view.find('.explorer-search-excerpt mark').textContent,'énergie');
  await view.select('.explorer-search-versions select',french.sourceKey);await view.click('Read speech');await view.flushFrames();
  assert.equal(view.texts().length,1);
  assert.equal(view.texts()[0].url.searchParams.get('source-id'),speech);
  assert.equal(view.texts()[0].url.searchParams.get('source-key'),french.sourceKey);
  assert.equal(view.find('.explorer-search-body').lang,'fr');
  assert.match(view.find('.explorer-search-body').textContent,/<script>window.injected=true<\/script>/);
  assert.equal(view.find('.explorer-search-body').querySelector('script'),null);
  assert.equal(view.window.injected,undefined);
  assert.equal(view.find('.explorer-search-body mark').textContent,'énergie');
  assert.equal(new URL(view.window.location.href).searchParams.get('fixture-fts-read'),JSON.stringify([speech,french.sourceKey]));
  await view.click('Close text search');await view.flushFrames();
  assert.equal(view.container.querySelector('.explorer-search-panel'),null);
  assert.equal(view.button('Search fixture speeches').getAttribute('aria-expanded'),'false');
  assert.equal(view.window.document.activeElement,view.button('Search fixture speeches'));
  assert.equal(new URL(view.window.location.href).searchParams.has('fixture-fts-read'),false);
  await view.flushFrames();assert.equal(view.container.querySelector('.explorer-search-panel'),null,'clearing a selected reader must not reopen the panel');
});

test('a same-query busy response and retry keep the previous matching results visible',async t=>{
  let searchCount=0,finishRetry;
  const view=await setup(t,{query:'fixture-fts-search=energy&fixture-fts-text-lang=en',respond:call=>{
    if(!call.url.pathname.endsWith('/corpus/search'))return;
    searchCount++;
    if(searchCount===2)return Response.json({error:{code:'corpus_busy',message:'Busy'}},{status:503});
    if(searchCount===3)return new Promise(resolve=>{finishRetry=resolve;});
  }});
  await view.render();const title=view.find('.explorer-search-result h4');
  await view.submit();assert.equal(searchCount,2);
  assert.equal(view.find('.explorer-search-result h4'),title);
  assert.match(view.find('[role="alert"]').textContent,/Search is busy/);
  await view.click('Retry');assert.equal(searchCount,3);
  assert.equal(view.find('.explorer-search-result h4'),title);
  assert.equal(view.find('.explorer-search-results').getAttribute('aria-busy'),'true');
  await act(async()=>finishRetry(Response.json(results())));
  assert.equal(view.container.querySelector('[role="alert"]'),null);
  assert.equal(view.find('.explorer-search-result h4'),title);
});

test('answer card dates follow document dates for document search and question dates for grouped questions',async t=>{
  const question='E-10-2026-000001',answer=question+'-ASW';
  const answerHit={...english,sourceId:answer,kind:'answer',parentId:question,date:'2026-06-01'};
  const view=await setup(t,{query:'fixture-fts-search=energy&fixture-fts-text-lang=en&fixture-fts-sort=newest',respond:call=>{
    if(!call.url.pathname.endsWith('/corpus/search'))return;
    const grouped=call.body.group==='question';
    return Response.json({total:1,limit:20,offset:0,nextOffset:null,truncated:false,coverage:{complete:false},results:[{sourceId:grouped?question:answer,kind:grouped?'question':'answer',parentId:grouped?null:question,date:'2026-06-01',questionDate:'2026-05-01',answerDate:'2026-06-01',title:'Energy policy question and institutional answer',reference:question,hits:[answerHit]}]});
  }});
  const formatted=value=>new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(value+'T12:00:00Z'));
  const headingDate=()=>view.find('.explorer-search-result > .explorer-search-meta > span:last-child').textContent;
  await view.render({kinds:['answer'],group:'document',dateBasis:'document',from:'2026-06-01',to:'2026-06-30'});
  assert.equal(view.searches().at(-1).body.sort,'newest');
  assert.equal(view.searches().at(-1).body.dateBasis,'document');
  assert.equal(view.searches().at(-1).body.from,'2026-06-01');
  assert.equal(view.searches().at(-1).body.to,'2026-06-30');
  assert.equal(headingDate(),formatted('2026-06-01'),'a June answer must show its June publication date at the top of its document card');
  assert.match(view.find('.explorer-search-match > .explorer-search-meta').textContent,/Match in institutional answer/);
  await view.render({kinds:['answer'],group:'question',dateBasis:'question',from:'2026-05-01',to:'2026-05-31'});
  assert.equal(view.searches().at(-1).body.group,'question');
  assert.equal(view.searches().at(-1).body.dateBasis,'question');
  assert.equal(headingDate(),formatted('2026-05-01'),'a grouped question card must keep the parent question date');
  assert.match(view.find('.explorer-search-match > .explorer-search-meta').textContent,new RegExp(formatted('2026-06-01')),'the matched answer still displays its own June publication date');
});

test('changing interface language preserves explicit search language and selected hit identity',async t=>{
  const view=await setup(t,{query:'fixture-fts-search=energy&fixture-fts-text-lang=all'});
  await view.render();await view.select('.explorer-search-versions select',french.sourceKey);await view.click('Read speech');
  await view.render({language:'hu'});
  assert.equal(view.searches().at(-1).body.uiLanguage,'hu');
  assert.equal(view.searches().at(-1).body.language,undefined);
  assert.equal(view.find('.explorer-search-facets select').value,'all');
  assert.equal(view.find('.explorer-search-versions select').value,french.sourceKey);
  assert.equal(view.find('.explorer-search-body').lang,'fr');
  assert.equal(new URL(view.window.location.href).searchParams.get('fixture-fts-read'),JSON.stringify([speech,french.sourceKey]));
});

test('history restoration of text language keeps the restored result page and exact reader',async t=>{
  const view=await setup(t,{query:'fixture-fts-search=energy&fixture-fts-text-lang=en'});await view.render();
  const read=JSON.stringify([speech,french.sourceKey]);
  const restored=new URLSearchParams({'fixture-fts-search':'energy','fixture-fts-text-lang':'fr','fixture-fts-page':'3','fixture-fts-read':read});
  await act(async()=>{view.window.history.replaceState(null,'','/?'+restored);view.window.dispatchEvent(new view.window.Event('popstate'));});
  assert.equal(view.searches().at(-1).body.language,'fr');
  assert.equal(view.searches().at(-1).body.offset,60);
  assert.equal(new URL(view.window.location.href).searchParams.get('fixture-fts-page'),'3');
  assert.equal(new URL(view.window.location.href).searchParams.get('fixture-fts-read'),read);
  assert.equal(view.find('.explorer-search-body').lang,'fr');
  assert.equal(view.find('.explorer-search-facets select').value,'fr');
});

test('a URL-selected language fragment opens independently of the interface-default version',async t=>{
  const query=new URLSearchParams({'fixture-fts-search':'energy','fixture-fts-text-lang':'all','fixture-fts-read':JSON.stringify([speech,french.sourceKey])});
  const view=await setup(t,{query:query.toString()});await view.render();
  assert.equal(view.texts().length,1,'a saved French reader link must open even when the interface defaults to English');
  assert.equal(view.texts()[0].url.searchParams.get('source-key'),french.sourceKey);
  assert.equal(view.find('.explorer-search-body').lang,'fr');
});

test('a saved exact reader link opens without a search query or an unrelated corpus search',async t=>{
  const query=new URLSearchParams({'fixture-fts-read':JSON.stringify([speech,french.sourceKey])});
  const view=await setup(t,{query:query.toString()});await view.render();
  assert.equal(view.searches().length,0);
  assert.equal(view.texts().length,1);
  assert.equal(view.texts()[0].url.searchParams.get('source-id'),speech);
  assert.equal(view.texts()[0].url.searchParams.get('source-key'),french.sourceKey);
  assert.equal(view.texts()[0].url.searchParams.has('q'),false);
  assert.equal(view.find('.explorer-search-body').lang,'fr');
});

test('Back reopens a closed reader-only link without changing the search query',async t=>{
  const query=new URLSearchParams({'fixture-fts-read':JSON.stringify([speech,french.sourceKey])});
  const view=await setup(t,{query:query.toString()});await view.render();
  await view.click('Close text search');await view.flushFrames();
  assert.equal(view.container.querySelector('.explorer-search-panel'),null);
  await act(async()=>{const restored=new Promise(resolve=>view.window.addEventListener('popstate',resolve,{once:true}));view.window.history.back();await restored;});
  assert.equal(view.button('Search fixture speeches').getAttribute('aria-expanded'),'true');
  assert.equal(view.find('.explorer-search-body').lang,'fr');
  assert.equal(view.searches().length,0);
});

test('an explicitly closed global search stays collapsed across navigation remounts while retaining its query',async t=>{
  const view=await setup(t,{query:'global-fts-search=energy&global-fts-text-lang=en'});
  await view.render({prefix:'global-fts',key:'first-header'});
  assert.equal(view.searches().length,1);
  await view.click('Close text search');await view.flushFrames();
  assert.equal(new URL(view.window.location.href).searchParams.get('global-fts-closed'),'1');
  await view.render({prefix:'global-fts',key:'second-header'});
  assert.equal(view.container.querySelector('.explorer-search-panel'),null);
  assert.equal(view.searches().length,1,'a header remount must not silently reopen or rerun a closed global query');
  assert.equal(new URL(view.window.location.href).searchParams.get('global-fts-search'),'energy');
  await view.click('Search fixture speeches');
  assert(view.container.querySelector('.explorer-search-panel'));
  assert.equal(view.searches().length,2);
  assert.equal(new URL(view.window.location.href).searchParams.has('global-fts-closed'),false);
});

test('changing entity scope clears the old page and reader before requesting the new entity',async t=>{
  const query=new URLSearchParams({'fixture-fts-search':'energy','fixture-fts-text-lang':'all','fixture-fts-page':'3','fixture-fts-offset':'37','fixture-fts-read':JSON.stringify([speech,english.sourceKey])});
  const view=await setup(t,{query:query.toString()});await view.render({member:42,sourceIds:[speech]});
  assert.equal(view.searches()[0].body.offset,37);
  const before=view.searches().length;
  await view.render({member:43,sourceIds:[otherSpeech]});
  const changed=view.searches().slice(before);assert(changed.length>0);
  assert(changed.every(call=>call.body.member===43&&call.body.offset===0));
  assert.equal(new URL(view.window.location.href).searchParams.has('fixture-fts-page'),false);
  assert.equal(new URL(view.window.location.href).searchParams.has('fixture-fts-offset'),false);
  assert.equal(new URL(view.window.location.href).searchParams.has('fixture-fts-read'),false);
  assert.equal(view.container.querySelector('.explorer-search-reader'),null);
});

test('short grouped pages follow exact offsets, retain predecessors and restore shared positions',async t=>{
  const view=await setup(t,{query:'fixture-fts-search=energy&fixture-fts-text-lang=all',respond:call=>{
    if(!call.url.pathname.endsWith('/corpus/search'))return;
    const offset=call.body.offset,count=offset===0?7:12,nextOffset=offset===0?7:offset===7?19:null;
    return Response.json({...results(call.body),total:31,nextOffset,responseLimited:nextOffset!==null,
      results:Array.from({length:count},(_,n)=>({sourceId:'Q-'+(offset+n),kind:'question',title:'Saved question '+(offset+n),hits:[{...english,sourceId:'Q-'+(offset+n),kind:'question'}]}))});
  }});
  await view.render();assert.match(view.find('.explorer-search-pages').textContent,/1–7 of 31/);
  await view.click('Next');assert.equal(view.searches().at(-1).body.offset,7);assert.match(view.find('.explorer-search-pages').textContent,/8–19 of 31/);
  assert.equal(new URL(view.window.location.href).searchParams.get('fixture-fts-offset'),'7');
  await view.click('Next');assert.equal(view.searches().at(-1).body.offset,19);assert.match(view.find('.explorer-search-pages').textContent,/20–31 of 31/);
  assert.equal(view.button('Next').disabled,true);
  await view.click('Previous');await view.click('Previous');
  assert.deepEqual(view.searches().map(call=>call.body.offset),[0,7,19,7,0]);
  await view.click('Next');
  await act(async()=>{const restored=new Promise(resolve=>view.window.addEventListener('popstate',resolve,{once:true}));view.window.history.back();await restored;});
  assert.equal(view.searches().at(-1).body.offset,0);
  await act(async()=>{const restored=new Promise(resolve=>view.window.addEventListener('popstate',resolve,{once:true}));view.window.history.forward();await restored;});
  assert.equal(view.searches().at(-1).body.offset,7);
  await view.render({key:'remount'});assert.equal(view.searches().at(-1).body.offset,7);
  assert(view.button('First page'));await view.click('First page');assert.equal(view.searches().at(-1).body.offset,0);
  await view.click('Next');await view.select('.explorer-search-facets select','fr');
  assert.equal(view.searches().at(-1).body.offset,0);assert.equal(new URL(view.window.location.href).searchParams.has('fixture-fts-offset'),false);
});

test('local find uses CSS highlights without changing React links or footnotes and restores focus on close',async t=>{
  const view=await setup(t,{highlights:true});let opens=0;
  function TextFixture(){const target=useRef(null);return createElement('section',null,
    createElement(view.FindInText,{target,label:'Find in fixture text',onOpen:()=>opens++}),
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

for(const highlights of [true,false])for(const navigation of ['Next match','Previous match','Enter','Shift+Enter'])test('local find repeats single-match '+navigation+' reveal with '+(highlights?'CSS Highlights':'native Selection'),async t=>{
  const view=await setup(t,{highlights}),scrolls=[];
  t.mock.method(view.window.HTMLElement.prototype,'scrollIntoView',function(options){scrolls.push({node:this,options});});
  function SingleMatch(){const target=useRef(null);return createElement('section',null,
    createElement(view.FindInText,{target,label:'Find in single-match text'}),
    createElement('div',{ref:target,id:'single-match-text'},createElement('p',null,'Before ',createElement('a',{id:'single-match-link',href:'https://example.test/source'},'uniquetoken'),' after.')));}
  await act(async()=>view.root.render(createElement(SingleMatch)));
  const body=view.find('#single-match-text'),markup=body.innerHTML,link=view.find('#single-match-link'),text=link.firstChild;
  const active=()=>highlights?[...view.registry].find(([key])=>key.endsWith('active'))?.[1]?.ranges[0]:view.window.getSelection().getRangeAt(0);
  await view.click('Find in single-match text');await view.flushFrames();
  const input=view.find('input[type="search"]');
  await view.input('input[type="search"]','uniquetoken');await view.flushFrames();
  const status=view.find('[role="status"]'),range=active();
  assert.equal(status.textContent,'1 / 1');assert.equal(range.toString(),'uniquetoken');
  assert.equal(scrolls.length,1);assert.equal(scrolls[0].node,link);
  assert.equal(view.button('Next match').disabled,false);assert.equal(view.button('Previous match').disabled,false);
  for(let repeat=1;repeat<=2;repeat++){
    // Discard the initial reveal to model the user scrolling away between actions.
    scrolls.length=0;
    const keyboard=navigation.endsWith('Enter'),control=keyboard?input:view.button(navigation);
    await act(async()=>control.focus());
    if(keyboard)await act(async()=>input.dispatchEvent(new view.window.KeyboardEvent('keydown',{key:'Enter',shiftKey:navigation==='Shift+Enter',bubbles:true,cancelable:true})));
    else await view.click(navigation);
    await view.flushFrames();
    assert.equal(scrolls.length,1,navigation+' must reveal the sole match again on activation '+repeat);
    assert.equal(scrolls[0].node,link);assert.deepEqual(scrolls[0].options,{block:'nearest'});
    assert.equal(status.textContent,'1 / 1');assert.equal(view.find('[role="status"]'),status);
    assert.equal(active(),range,'navigation preserves the live match range');
    assert.equal(view.window.document.activeElement,control,'revealing a match must not steal focus');
    assert.equal(view.find('input[type="search"]'),input);assert.equal(input.value,'uniquetoken');
    assert.equal(view.find('#single-match-link'),link);assert.equal(link.firstChild,text);assert.equal(body.innerHTML,markup);
    if(highlights){assert.equal(view.registry.size,2);assert.equal(view.window.getSelection().rangeCount,0);}
    else {assert.equal(view.registry.size,0);assert.equal(view.window.getSelection().rangeCount,1);}
  }
  assert.equal(view.calls.length,0,'local navigation never requests corpus data');
});

for(const highlights of [true,false])test('local find wraps every navigation control across multiple matches with '+(highlights?'CSS Highlights':'native Selection'),async t=>{
  const view=await setup(t,{highlights}),scrolls=[];
  t.mock.method(view.window.HTMLElement.prototype,'scrollIntoView',function(){scrolls.push(this);});
  function MultipleMatches(){const target=useRef(null);return createElement('section',null,
    createElement(view.FindInText,{target,label:'Find in multiple-match text'}),
    createElement('div',{ref:target,id:'multiple-match-text'},...[1,2,3].map(number=>createElement('p',{id:'match-'+number,key:number},'sharedtoken '+number))));}
  await act(async()=>view.root.render(createElement(MultipleMatches)));
  const body=view.find('#multiple-match-text'),markup=body.innerHTML,paragraphs=[1,2,3].map(number=>view.find('#match-'+number));
  const active=()=>highlights?[...view.registry].find(([key])=>key.endsWith('active'))?.[1]?.ranges[0]:view.window.getSelection().getRangeAt(0);
  await view.click('Find in multiple-match text');await view.flushFrames();
  await view.input('input[type="search"]','sharedtoken');await view.flushFrames();
  const input=view.find('input[type="search"]');
  assert.equal(view.find('[role="status"]').textContent,'1 / 3');
  for(const [navigation,expected] of [['Previous match',3],['Next match',1],['Shift+Enter',3],['Enter',1],['Enter',2],['Next match',3],['Next match',1],['Previous match',3],['Shift+Enter',2]]){
    const before=scrolls.length,keyboard=navigation.endsWith('Enter'),control=keyboard?input:view.button(navigation);
    await act(async()=>control.focus());
    if(keyboard)await act(async()=>input.dispatchEvent(new view.window.KeyboardEvent('keydown',{key:'Enter',shiftKey:navigation==='Shift+Enter',bubbles:true,cancelable:true})));
    else await view.click(navigation);
    await view.flushFrames();
    assert.equal(view.find('[role="status"]').textContent,expected+' / 3',navigation);
    assert.equal(scrolls.length,before+1);assert.equal(scrolls.at(-1),paragraphs[expected-1]);
    assert(paragraphs[expected-1].contains(active().startContainer));assert.equal(active().toString(),'sharedtoken');
    assert.equal(view.window.document.activeElement,control);
    assert.deepEqual([...body.children],paragraphs);assert.equal(body.innerHTML,markup);
  }
  assert.equal(view.calls.length,0);
});

test('local find recomputes live ranges when a React summary collapses and expands',async t=>{
  const view=await setup(t,{highlights:true});
  function Summary({expanded}){const target=useRef(null);return createElement('section',null,
    createElement(view.FindInText,{target,label:'Find in summary'}),
    createElement('div',{ref:target,id:'summary-body'},createElement('p',null,'Énergie in the visible introduction.'),expanded&&createElement('p',{id:'extra-summary'},'Énergie in the expanded summary.')));}
  await act(async()=>view.root.render(createElement(Summary,{expanded:true})));
  await view.click('Find in summary');await view.input('input[type="search"]','energie');await view.flushFrames();
  const ranges=()=>[...view.registry.entries()].find(([key])=>!key.endsWith('active'))?.[1]?.ranges;
  assert.equal(view.find('[role="status"]').textContent,'1 / 2');
  const removed=view.find('#extra-summary');await view.click('Next match');
  await act(async()=>view.root.render(createElement(Summary,{expanded:false})));await view.flushFrames();
  assert.equal(removed.isConnected,false);
  assert.equal(view.find('[role="status"]').textContent,'1 / 1');
  assert.equal(ranges().length,1);assert(ranges().every(range=>range.startContainer.isConnected&&range.endContainer.isConnected));
  await act(async()=>view.root.render(createElement(Summary,{expanded:true})));await view.flushFrames();
  assert.equal(view.find('[role="status"]').textContent,'1 / 2');
  assert.equal(ranges().length,2);assert(ranges().every(range=>range.startContainer.isConnected&&range.endContainer.isConnected));
});

for(const highlights of [true,false])test('local find reveals actual question Notes and retains navigation with '+(highlights?'CSS Highlights':'native Selection'),async t=>{
  const id='E-10-2026-000001',view=await setup(t,{highlights,respond:call=>{
    assert.equal(call.url.pathname,'/api/document/'+id);
    return Response.json({id,selectedDocumentId:id,titles:{en:'Question fixture'},date:'2026-10-01',files:[],answers:[],selectedText:{status:'available',paragraphs:['sharedmatch in the visible body.'],textLanguage:'en',availableTextLanguages:['en'],translationType:'original',sourceFormat:'DOCX',sourceUrl:'https://example.test/source',notes:[{id:'1',label:'1',text:'uniquenotetoken sharedmatch inside the note.',links:[]}],noteAnchors:[],documentLinks:[]}});
  }});
  const {InsightQuestionReader}=await view.loadModule('/src/InsightReaders.tsx');
  const render=key=>act(async()=>view.root.render(createElement(InsightQuestionReader,{id,language:'en',key})));
  const settle=async()=>{await act(async()=>new Promise(resolve=>view.window.setTimeout(resolve,0)));await view.flushFrames();};
  const active=()=>highlights?[...view.registry].find(([key])=>key.endsWith('active'))?.[1]?.ranges[0]:view.window.getSelection().getRangeAt(0);
  const status=()=>view.find('.explorer-find-controls [role="status"]').textContent;
  const scrolls=[];
  t.mock.method(view.window.HTMLElement.prototype,'scrollIntoView',function(){scrolls.push({node:this,closed:this.closest('details:not([open])')});});
  await render('first');await settle();
  const notes=view.find('details.legal-notes'),source=view.find('details.insight-reader-source'),note=view.find('.legal-notes li'),text=note.textContent;
  assert(view.find('.insight-reader-text').contains(notes));
  await act(async()=>{notes.open=false;});
  await view.click('Find in question');await view.flushFrames();
  const input=view.find('input[type="search"]');
  await view.input('input[type="search"]','uniquenotetoken');await settle();
  assert.equal(status(),'1 / 1');assert.equal(notes.open,true);assert.equal(source.open,false);
  assert.equal(active().toString(),'uniquenotetoken');assert(notes.contains(active().startContainer));
  assert.equal(view.window.document.activeElement,input);assert.equal(scrolls.at(-1).closed,null,'reveal precedes scroll');
  const unique=active();
  await act(async()=>{notes.open=false;});await settle();
  assert.equal(notes.open,true,'an active note remains visible after manual collapse');assert.equal(active(),unique);assert.equal(status(),'1 / 1');
  await view.input('input[type="search"]','sharedmatch');await settle();
  assert.equal(status(),'1 / 2');assert(!notes.contains(active().startContainer));
  await act(async()=>{notes.open=false;});await settle();
  assert.equal(notes.open,false,'Notes can stay collapsed while the body match is active');
  await act(async()=>input.dispatchEvent(new view.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));await settle();
  assert.equal(status(),'2 / 2');assert.equal(notes.open,true);assert(notes.contains(active().startContainer));
  const second=active(),scrollCount=scrolls.length;
  await act(async()=>{notes.open=false;});await settle();
  assert.equal(status(),'2 / 2');assert.equal(active(),second);assert.equal(input.value,'sharedmatch');
  assert.equal(notes.open,true);assert.equal(view.window.document.activeElement,input);assert.equal(scrolls.length,scrollCount+1,'open observation settles without a loop');
  await act(async()=>{notes.open=true;});await settle();assert.equal(active(),second);
  await view.click('Next match');assert.equal(status(),'1 / 2');
  await view.click('Previous match');assert.equal(status(),'2 / 2');
  await act(async()=>input.dispatchEvent(new view.window.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true})));assert.equal(status(),'1 / 2');
  await view.click('Previous match');assert.equal(status(),'2 / 2');
  assert.equal(view.find('.legal-notes li'),note);assert.equal(note.textContent,text);assert.equal(source.open,false);
  assert(scrolls.every(scroll=>scroll.closed===null));
  await act(async()=>input.dispatchEvent(new view.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await settle();
  assert.equal(view.container.querySelector('input'),null);assert.equal(view.window.document.activeElement,view.button('Find in question'));
  assert.equal(view.registry.size,0);assert.equal(view.window.getSelection().rangeCount,0);
  await act(async()=>{notes.open=false;});await settle();assert.equal(notes.open,false,'close disconnects the active-details observer');
  await view.click('Find in question');await view.input('input[type="search"]','uniquenotetoken');await settle();
  await render('remounted');await settle();
  assert.equal(view.registry.size,0);assert.equal(view.window.getSelection().rangeCount,0);assert.equal(view.container.querySelector('input'),null);
  assert.equal(notes.isConnected,false);
  await act(async()=>{notes.open=false;});await settle();assert.equal(notes.open,false,'remount disconnects observers on the old Notes');
  assert.equal(view.calls.length,1,'only the mocked document request is needed');
});

test('local find reveals nested and intervening details only for searchable match text inside its target',async t=>{
  const view=await setup(t,{highlights:true});
  const details=(id,summary,...children)=>createElement('details',{id},createElement('summary',null,summary),...children);
  function Nested(){const target=useRef(null);return createElement('section',null,
    createElement(view.FindInText,{target,label:'Find in nested fixture'}),
    details('outside','Outside',createElement('div',{ref:target},
      details('outer','Outer',details('inner','Inner',createElement('p',null,'nestedtoken'))),
      details('other','Other',createElement('p',null,'unrelated text')),
      createElement('span',null,'bridge '),
      details('middle','',createElement('span',null,'middle ')),
      details('excluded','',createElement('button',null,'ignoredword'),createElement('span',{hidden:true},'ignoredword')),
      createElement('span',null,'end'),
      details('summary-only','summarytoken',createElement('p',null,'unmatched body')))));
  }
  await act(async()=>view.root.render(createElement(Nested)));
  const settle=async()=>{await act(async()=>new Promise(resolve=>view.window.setTimeout(resolve,0)));await view.flushFrames();};
  const isOpen=id=>view.find('#'+id).open;
  await view.click('Find in nested fixture');await view.flushFrames();
  await view.input('input[type="search"]','nestedtoken');await settle();
  assert.equal(view.find('[role="status"]').textContent,'1 / 1');
  assert.equal(isOpen('outer'),true);assert.equal(isOpen('inner'),true);
  for(const id of ['outside','other','middle','excluded','summary-only'])assert.equal(isOpen(id),false,id);
  await view.input('input[type="search"]','bridge middle end');await settle();
  assert.equal(view.find('[role="status"]').textContent,'1 / 1');assert.equal(isOpen('middle'),true,'a closed section between both range endpoints is revealed');
  for(const id of ['outside','other','excluded','summary-only'])assert.equal(isOpen(id),false,id);
  const ranges=[...view.registry].find(([key])=>!key.endsWith('active'))[1].ranges,range=ranges[0];
  assert.equal(range.startContainer.textContent,'bridge ');assert.equal(range.endContainer.textContent,'end');
  await view.input('input[type="search"]','ignoredword');await settle();assert.equal(view.find('[role="status"]').textContent,'No matches');assert.equal(isOpen('excluded'),false);
  await view.input('input[type="search"]','summarytoken');await settle();assert.equal(view.find('[role="status"]').textContent,'1 / 1');assert.equal(isOpen('summary-only'),false,'a visible summary needs no body expansion');
  assert.equal(isOpen('outside'),false);assert.equal(view.window.document.activeElement,view.find('input[type="search"]'));
});

test('local find separates paragraphs and line breaks while preserving words split by inline links',async t=>{
  const view=await setup(t,{highlights:true});
  function Paragraphs(){const target=useRef(null);return createElement('section',null,
    createElement(view.FindInText,{target,label:'Find in structured text'}),
    createElement('div',{ref:target,id:'structured-text'},createElement('p',null,'water'),createElement('p',null,'policy'),createElement('p',null,'en',createElement('a',{id:'inline-energy',href:'https://example.test/energy'},'er'),'gy'),createElement('p',null,'transport',createElement('br'),'policy')));}
  await act(async()=>view.root.render(createElement(Paragraphs)));
  const body=view.find('#structured-text'),original=body.innerHTML,link=view.find('#inline-energy');
  await view.click('Find in structured text');
  await view.input('input[type="search"]','waterpolicy');await view.flushFrames();
  assert.equal(view.find('[role="status"]').textContent,'No matches','adjacent paragraphs must not create a compound word');
  for(const phrase of ['water policy','transport policy','energy']){
    await view.input('input[type="search"]',phrase);await view.flushFrames();
    assert.equal(view.find('[role="status"]').textContent,'1 / 1',phrase+' should match the visible text structure');
  }
  assert.equal(view.find('#inline-energy'),link);assert.equal(body.innerHTML,original);
  const all=[...view.registry.entries()].find(([key])=>!key.endsWith('active'))?.[1];
  assert.equal(all.ranges[0].toString(),'energy');
});

test('local find includes resolved source citation buttons and preserves their reference-dialog behaviour',async t=>{
  const text='Article 5 of Regulation (EU) 2024/1689 applies.';
  const reference={key:'celex:32024R1689',kind:'act',status:'found',celex:'32024R1689',title:'Artificial Intelligence Act',titleLanguage:'en',date:'2024-06-13',inForce:true,eurLexUrl:'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689',source:{name:'Saved EUR-Lex fixture',url:'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689',fetchedAt:'2026-10-08T12:00:00Z'}};
  const view=await setup(t,{highlights:true,respond:call=>{
    if(call.url.pathname.endsWith('/references')){
      assert.equal(call.url.searchParams.get('keys'),reference.key);
      return Response.json({references:[reference]});
    }
  }});
  const {ReferenceScope,ReferenceText}=await view.loadModule('/src/References.tsx');
  let unrelatedClicks=0;
  function ReferenceReader(){const target=useRef(null);return createElement('section',null,
    createElement(view.FindInText,{target,label:'Find in cited document'}),
    createElement(ReferenceScope,{texts:[text],language:'en'},createElement('div',{ref:target,id:'citation-reader'},
      createElement('p',{id:'citation-paragraph'},createElement(ReferenceText,{text})),
      createElement('button',{id:'unrelated-reader-action',type:'button',onClick:()=>unrelatedClicks++},'Refresh reader controls'))));}
  await act(async()=>view.root.render(createElement(ReferenceReader)));
  const citation=view.find('button.legal-ref'),paragraph=view.find('#citation-paragraph'),markup=paragraph.innerHTML;
  assert.equal(citation.textContent,'Regulation (EU) 2024/1689');
  await view.click('Find in cited document');await view.input('input[type="search"]','2024/1689');await view.flushFrames();
  assert.equal(view.find('[role="status"]').textContent,'1 / 1');
  const matches=[...view.registry.entries()].find(([key])=>!key.endsWith('active'))?.[1]?.ranges;
  assert.equal(matches.length,1);assert.equal(matches[0].toString(),'2024/1689');
  assert.equal(matches[0].startContainer.parentElement.closest('button.legal-ref'),citation);
  assert.equal(view.find('button.legal-ref'),citation);assert.equal(paragraph.innerHTML,markup);
  await view.input('input[type="search"]','Refresh reader');await view.flushFrames();
  assert.equal(view.find('[role="status"]').textContent,'No matches','unrelated UI button labels are not document text');
  await act(async()=>view.find('#unrelated-reader-action').click());assert.equal(unrelatedClicks,1);
  await view.input('input[type="search"]','2024/1689');await view.flushFrames();
  await act(async()=>citation.click());
  assert.equal(view.find('button.legal-ref'),citation);assert.equal(citation.getAttribute('aria-expanded'),'true');
  assert.match(view.find('[role="dialog"]').textContent,/Artificial Intelligence Act/);
  assert.equal(view.find('[role="dialog"] a').href,reference.eurLexUrl);
  await view.click('Close');
  assert.equal(view.container.querySelector('[role="dialog"]'),null);
  assert.equal(view.find('button.legal-ref'),citation);assert.equal(citation.getAttribute('aria-expanded'),'false');
  assert.equal(paragraph.innerHTML,markup);
  assert.equal(view.calls.length,1,'only the saved legal-reference lookup is needed');
  assert.equal(view.searches().length,0);
});

for(const [family,url] of [
  ['procedure','https://data.europarl.europa.eu/api/v2/procedures/2025-0407'],
  ['speech','https://data.europarl.europa.eu/api/v2/speeches/MTG-PL-2026-10-07-OTH-123'],
])test('local find includes '+family+' source-linked document text while excluding auxiliary source controls',async t=>{
  const text='The climate transition proposal applies.';
  const view=await setup(t,{highlights:true,respond:call=>{
    if(!call.url.pathname.endsWith('/source-record'))return;
    assert.equal(call.url.searchParams.get('url'),url);assert.equal(call.url.searchParams.get('lang'),'en');
    return Response.json({sourceUrl:url,requestUrl:url+'?format=application%2Fld%2Bjson',fetchedAt:'2026-10-16T12:00:00Z',stale:false,refreshError:null,collection:false,limited:false,records:[{title:'Exact '+family+' fixture',websiteUrl:null}],payload:{data:[{id:family==='procedure'?'eli/dl/proc/2025-0407':'eli/dl/event/MTG-PL-2026-10-07-OTH-123',process_title:{en:'Exact '+family+' fixture'}}]}});
  }});
  view.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  view.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const {ReferenceScope,ReferenceText}=await view.loadModule('/src/References.tsx');
  const {SourceLink}=await view.loadModule('/src/SourceLink.tsx');
  function SourceLinkedReader(){const target=useRef(null);return createElement('section',null,
    createElement(view.FindInText,{target,label:'Find in source-linked text'}),
    createElement(ReferenceScope,{texts:[text,url],language:'en'},createElement('div',{ref:target,id:'source-linked-reader'},
      createElement('p',{id:'source-linked-paragraph'},createElement(ReferenceText,{text,links:[{start:4,end:31,url}]})),
      createElement('p',null,createElement(SourceLink,{url:'https://data.europarl.europa.eu/api/v2/procedures/2025-0407',reference:'2025/0407(COD)',compact:true},'Supplementary procedure')),
      createElement('button',{type:'button'},'Refresh reader controls'))));}
  await act(async()=>view.root.render(createElement(SourceLinkedReader)));
  const primary=view.find('button.source-primary'),paragraph=view.find('#source-linked-paragraph'),markup=paragraph.innerHTML;
  assert.equal(primary.textContent,'climate transition proposal');
  assert.equal(view.find('button.source-read:not(.source-primary)').textContent,'Read data');
  assert.equal(view.calls.length,0,'rendering source links must not fetch upstream data');
  await view.click('Find in source-linked text');await view.input('input[type="search"]','climate transition');await view.flushFrames();
  assert.equal(view.find('[role="status"]').textContent,'1 / 1');
  const matches=[...view.registry.entries()].find(([key])=>!key.endsWith('active'))?.[1]?.ranges;
  assert.equal(matches.length,1);assert.equal(matches[0].toString(),'climate transition');
  assert.equal(matches[0].startContainer.parentElement.closest('button.source-primary'),primary);
  assert.equal(view.find('button.source-primary'),primary);assert.equal(paragraph.innerHTML,markup);
  for(const controlText of ['Read data','Refresh reader']){
    await view.input('input[type="search"]',controlText);await view.flushFrames();
    assert.equal(view.find('[role="status"]').textContent,'No matches',controlText+' is a control label, not document text');
  }
  await view.input('input[type="search"]','climate transition');await view.flushFrames();
  await act(async()=>primary.click());
  const dialog=view.window.document.querySelector('dialog.source-dialog');assert(dialog?.open);
  assert.equal(view.calls.length,1);assert.equal(view.calls[0].url.searchParams.get('url'),url);
  assert.equal(dialog.querySelector('.source-actions a').href,url);assert.equal(dialog.querySelector('.source-record-content h3').textContent,'Exact '+family+' fixture');
  assert.equal(view.find('button.source-primary'),primary);assert.equal(primary.getAttribute('aria-expanded'),'true');
  await act(async()=>dialog.querySelector('button.source-close').click());await view.flushFrames();
  assert.equal(view.window.document.querySelector('dialog.source-dialog'),null);assert.equal(view.window.document.activeElement,primary);
  assert.equal(view.find('button.source-primary'),primary);assert.equal(primary.getAttribute('aria-expanded'),'false');assert.equal(paragraph.innerHTML,markup);
  assert.equal(view.calls.length,1);assert.equal(view.searches().length,0);
});

 test('search attribution uses the directory ID and keeps raw labels available',async t=>{
  const view=await setup(t,{query:'fixture-fts-search=hydrogen',members:[{id:42,firstName:'Dan-Ştefan',lastName:'Motreanu'}],respond:({url,body})=>{
    if(!url.pathname.endsWith('/corpus/search'))return;
    const version={...english,people:[{id:42,name:'Dan-Ştefan MOTREANU',role:'SPEAKER'},{id:99,name:'Guest McDONALD',role:'SPEAKER'}]};
    return Response.json(results(body,[version]));
  }});
  await view.render();
  const attribution=view.find('.explorer-search-attribution');
  assert.match(attribution.textContent,/Dan-Ştefan Motreanu, Guest McDONALD/);
  assert.equal(attribution.querySelector('[title]').title,'Source label: Dan-Ştefan MOTREANU');
});

test('search attribution skips unnamed people and preserves the answer fallback',async t=>{
  for(const [kind,people,expected] of [
    ['question',[{id:99,name:null,role:'AUTHOR'},{id:42,name:'Dan-Ştefan MOTREANU',role:'AUTHOR'}],'Question by Dan-Ştefan Motreanu'],
    ['speech',[{id:42,name:null,role:'SPEAKER'}],'Speaker: Dan-Ştefan Motreanu'],
    ['question',[{id:99,name:null,role:'AUTHOR'}],''],
    ['answer',[{id:99,name:null,role:'QUESTION_AUTHOR'}],'Answering institution’s text · linked question authorship'],
  ])await t.test(kind+JSON.stringify(people),async t=>{
    const view=await setup(t,{query:'fixture-fts-search=hydrogen',members:[{id:42,firstName:'Dan-Ştefan',lastName:'Motreanu'}],respond:({url,body})=>{
      if(!url.pathname.endsWith('/corpus/search'))return;
      return Response.json(results(body,[{...english,kind,people}]));
    }});
    await view.render();
    assert.equal(view.find('.explorer-search-attribution').textContent,expected);
  });
});
