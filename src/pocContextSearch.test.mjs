import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

test('question text search keeps country and dates while visual topic filters remain a separate browsing state',async t=>{
  const window=new Window({url:'http://localhost/?view=questions&q-days=365&q-until=2026-10-11&q-country=IT&q-word=water&q-range=2026-10-05_2026-10-11'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const stats={uniqueCurrentMeps:0,denominator:0,referenceDate:'2026-10-11',dimensions:{country:[],group:[],gender:[],age:[]}},searches=[];
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    const url=new URL(input,window.location.href);
    if(url.pathname.endsWith('/insights/questions'))return Response.json({window:{start:'2025-10-12',end:'2026-10-11'},counts:{selectedQuestions:0},selection:{word:'water',wordLabel:'water'},stats,selectedStats:stats,clusters:[],words:[],questions:[],nextOffset:null,facets:{countries:[{code:'IT',count:0,authors:0}]},analysis:{unassignedQuestions:0,missingEnglishTitles:0},coverage:{indexComplete:false,truncated:false}});
    if(url.pathname.endsWith('/corpus/search')){
      searches.push(options?.method==='POST'?JSON.parse(options.body):Object.fromEntries(url.searchParams));
      return Response.json({results:[],hits:[],total:0,limit:20,offset:0,nextOffset:null,truncated:false,query:'water',group:'question',dateBasis:'question',coverage:{complete:false,phase:'waiting',note:'Saved texts only.'}});
    }
    if(url.pathname.endsWith('/corpus/status'))return Response.json({phase:'waiting',coverage:{complete:false,note:'Saved texts only.'}});
    throw new Error('Unexpected request: '+url);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocQuestionTopics}=await vite.ssrLoadModule('/src/PocQuestionTopics.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocQuestionTopics,{language:'en',onBack(){}})));
  assert.equal(container.querySelectorAll('input[type="search"]').length,0,'text fields are collapsed initially');
  assert(container.querySelector('.insight-question-dimensions'));
  const toggle=container.querySelector('button[aria-label="Search question and answer text"]');assert(toggle,'question text search icon');
  await act(async()=>toggle.click());
  assert.equal(container.querySelector('.insight-question-dimensions'),null);
  assert.equal(container.querySelector('.insight-topic-picker'),null);
  assert.equal(container.querySelector('.insight-active-filters'),null,'analytical topic chips must not imply a full-text filter');
  assert.equal(container.querySelector('[data-question-country]').value,'IT');
  assert.match(container.textContent,/across all topics in the selected period/);
  await act(async()=>{const url=new URL(location.href);url.searchParams.set('q-fts-search','water');history.pushState(null,'',url);window.dispatchEvent(new window.Event('popstate'));});
  assert.equal(searches.length,1);
  const search=searches[0];
  assert.equal(search.country,'IT');assert.equal(search.from,'2026-10-05');assert.equal(search.to,'2026-10-11');assert.equal(search.group,'question');
  assert.equal(search.dateBasis||search['date-basis'],'question');
  assert.deepEqual(Array.isArray(search.kinds)?search.kinds:search.kinds.split(','),['question','answer']);
  assert.equal('word' in search,false);assert.equal('cluster' in search,false);
  await act(async()=>toggle.click());
  assert(container.querySelector('.insight-question-dimensions'));
  assert.equal(new URL(location.href).searchParams.get('q-word'),'water','closing text search restores the visual context');
  assert.equal(new URL(location.href).searchParams.get('q-country'),'IT');
  assert.equal(new URL(location.href).searchParams.get('q-range'),'2026-10-05_2026-10-11');
});

test('a large plenary cloud searches by exact period and country while delayed hydration preserves a restored page and reader',async t=>{
  const speech='MTG-PL-2026-10-07-OTH-123',read=JSON.stringify([speech,'fr']);
  const query=new URLSearchParams({'view':'legislation','agenda-fts-search':'energy','agenda-fts-text-lang':'fr','agenda-fts-page':'3','agenda-fts-read':read});
  const window=new Window({url:'http://localhost/?'+query});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root,resolveCloud;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const searches=[],cloudCalls=[];
  const speeches=Array.from({length:1001},(_,i)=>({id:'MTG-PL-2026-10-07-OTH-'+i,date:'2026-10-07',title:'Speech '+i,machineTranslation:false,people:[]}));
  const cloud={scope:{kind:'week',phase:'past'},language:'en',words:[{word:'energy',label:'Energy',speechCount:1001,occurrences:1001,speechIds:[speech]}],speeches,window:{start:'2026-10-05',end:'2026-10-09'},nextPage:null,coverage:{transcripts:1001,matchedSpeechRecords:1001,missingLanguage:0,unreadableText:0,complete:true,truncated:false,associationUnavailable:false}};
  const hit={sourceId:speech,sourceKey:'fr',kind:'speech',parentId:null,date:'2026-10-07',language:'fr',translationType:'original',sourceUrl:'https://www.europarl.europa.eu/example',sha256:'fixture-hash',snippet:'\u0002Energy\u0003 policy',people:[]};
  t.mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(input,window.location.href);
    if(url.pathname.endsWith('/insights/speech-cloud')){
      cloudCalls.push(url);
      if(cloudCalls.length===1)return new Promise(resolve=>{resolveCloud=resolve;});
      return Response.json({...cloud,language:url.searchParams.get('lang')});
    }
    if(url.pathname.endsWith('/corpus/search')){
      const body=JSON.parse(options.body);searches.push(body);
      assert.equal('sourceIds' in body,false,'large period scopes must not enumerate speech IDs');
      return Response.json({total:61,limit:20,offset:body.offset,nextOffset:null,truncated:false,coverage:{complete:false},results:[{sourceId:speech,kind:'speech',date:'2026-10-07',title:'Energy policy',reference:speech,hits:[hit]}]});
    }
    if(url.pathname.endsWith('/corpus/text'))return Response.json({...hit,body:'Energy policy',highlightedBody:'\u0002Energy\u0003 policy',fetchedAt:'2026-10-08T12:00:00Z',checkedAt:'2026-10-08T12:00:00Z'});
    throw new Error('Unexpected request: '+url);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {PocSpeechCloud}=await vite.ssrLoadModule('/src/PocSpeechCloud.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocSpeechCloud,{week:'2026-10-05',country:'IT',interfaceLanguage:'en'})));
  assert.equal(searches.length,0,'no unbounded search may run before period dates arrive');
  assert.equal(new URL(location.href).searchParams.get('agenda-fts-page'),'3');
  assert.equal(new URL(location.href).searchParams.get('agenda-fts-read'),read);
  await act(async()=>resolveCloud(Response.json(cloud)));
  assert.equal(searches.length,1);
  assert.deepEqual(searches[0],{query:'energy',kinds:['speech'],language:'fr',uiLanguage:'en',country:'IT',from:'2026-10-05',to:'2026-10-09',group:'document',dateBasis:'document',sort:'relevance',limit:20,offset:60});
  assert.equal(new URL(location.href).searchParams.get('agenda-fts-page'),'3','hydrating dates must preserve the restored page');
  assert.equal(new URL(location.href).searchParams.get('agenda-fts-read'),read,'hydrating dates must preserve the restored exact reader');
  assert.equal(container.querySelector('.poc-search-body')?.lang,'fr');
  assert.match(container.textContent,/all indexed speech contributions within this plenary week/);
  assert.match(container.textContent,/available text languages beyond the word cloud’s current language/);
  await act(async()=>{const select=container.querySelector('.poc-cloud-controls select');select.value='de';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(cloudCalls.length,2);
  assert.deepEqual(searches.at(-1),searches[0],'changing the cloud analysis language must preserve the exact corpus search scope and page');
  assert.equal(new URL(location.href).searchParams.get('agenda-fts-page'),'3');
  assert.equal(new URL(location.href).searchParams.get('agenda-fts-read'),read);
});
