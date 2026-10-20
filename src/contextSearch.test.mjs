import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

test('question text search keeps country and dates while visual topic filters remain a separate browsing state',async t=>{
  const window=new Window({url:'http://localhost/?view=questions&q-days=365&q-until=2026-10-11&q-country=IT&q-subject=USA&q-word=water&q-range=2026-10-05_2026-10-11'});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const stats={uniquePeople:0,uniqueCurrentMeps:0,peopleOutsideCurrentRoster:0,denominator:0,referenceDate:'2026-10-11',dimensions:{country:[],group:[],gender:[],age:[]}},searches=[];
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    const url=new URL(input,window.location.href);
    if(url.pathname.endsWith('/insights/questions'))return Response.json({window:{start:'2025-10-12',end:'2026-10-11'},counts:{selectedQuestions:0},selection:{subject:'USA',subjectLabel:'United States',word:'water',wordLabel:'water'},stats,selectedStats:stats,clusters:[],words:[],questions:[],nextOffset:null,facets:{countries:[{code:'IT',count:0,authors:0}]},analysis:{unassignedQuestions:0,missingEnglishTitles:0},coverage:{indexComplete:false,truncated:false}});
    if(url.pathname.endsWith('/corpus/search')){
      searches.push(options?.method==='POST'?JSON.parse(options.body):Object.fromEntries(url.searchParams));
      return Response.json({results:[],hits:[],total:0,limit:20,offset:0,nextOffset:null,truncated:false,query:'water',group:'question',dateBasis:'question',coverage:{complete:false,phase:'waiting',note:'Saved texts only.'}});
    }
    if(url.pathname.endsWith('/corpus/status'))return Response.json({phase:'waiting',coverage:{complete:false,note:'Saved texts only.'}});
    throw new Error('Unexpected request: '+url);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {QuestionTopics}=await vite.ssrLoadModule('/src/QuestionTopics.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(QuestionTopics,{language:'en',onBack(){}})));
  assert.equal(container.querySelectorAll('input[type="search"]').length,0,'text fields are collapsed initially');
  assert(container.querySelector('.insight-question-dimensions'));
  const toggle=container.querySelector('button[aria-label="Search question and answer text"]');assert(toggle,'question text search icon');
  await act(async()=>toggle.click());
  assert.equal(container.querySelector('.insight-question-dimensions'),null);
  assert.equal(container.querySelector('.insight-topic-picker'),null);
  assert.equal(container.querySelector('.insight-active-filters'),null,'analytical topic chips must not imply a full-text filter');
  assert.equal(container.querySelector('[data-question-country]').value,'IT');
  assert.match(container.textContent,/across all topics and subjects in the selected period/);
  await act(async()=>{const url=new URL(location.href);url.searchParams.set('q-fts-search','water');history.pushState(null,'',url);window.dispatchEvent(new window.Event('popstate'));});
  assert.equal(searches.length,1);
  const search=searches[0];
  assert.equal(search.country,'IT');assert.equal(search.from,'2026-10-05');assert.equal(search.to,'2026-10-11');assert.equal(search.group,'question');
  assert.equal(search.dateBasis||search['date-basis'],'question');
  assert.deepEqual(Array.isArray(search.kinds)?search.kinds:search.kinds.split(','),['question','answer']);
  assert.equal('subject' in search,false);assert.equal(new URL(location.href).searchParams.get('q-subject'),'USA');
  assert.equal('word' in search,false);assert.equal('cluster' in search,false);
  await act(async()=>toggle.click());
  assert(container.querySelector('.insight-question-dimensions'));
  assert.equal(new URL(location.href).searchParams.get('q-word'),'water','closing text search restores the visual context');
  assert.equal(new URL(location.href).searchParams.get('q-country'),'IT');
  assert.equal(new URL(location.href).searchParams.get('q-range'),'2026-10-05_2026-10-11');
});

test('question country and date gestures reset restored text results without changing genuine Back state',async t=>{
  const ids={IT:'E-10-2026-000001',HU:'E-10-2026-000002',FR:'E-10-2026-000003'},read=JSON.stringify([ids.IT,'fr']);
  const initial=new URLSearchParams({view:'questions','q-days':'365','q-until':'2026-10-11','q-country':'IT','q-fts-search':'water','q-fts-text-lang':'fr','q-fts-sort':'newest','q-fts-page':'3','q-fts-offset':'37','q-fts-read':read});
  const window=new Window({url:'http://localhost/?'+initial});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,CSS:window.CSS,requestAnimationFrame:window.requestAnimationFrame.bind(window),cancelAnimationFrame:window.cancelAnimationFrame.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root;const searches=[],readerRequests=[];
  t.after(async()=>{if(root)await act(async()=>root.unmount());if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const stats={uniquePeople:0,uniqueCurrentMeps:0,peopleOutsideCurrentRoster:0,denominator:0,referenceDate:'2026-10-11',dimensions:{country:[],group:[],gender:[],age:[]}};
  const record=id=>({sourceId:id,sourceKey:'fr',kind:'question',parentId:null,date:'2026-09-15',language:'fr',translationType:'original',sourceUrl:'https://www.europarl.europa.eu/doceo/document/'+id+'_EN.html',sha256:'fixture-hash',snippet:'\u0002Water\u0003 policy',body:id===ids.IT?'Italian saved reader':'Another saved reader',fetchedAt:'2026-10-15T12:00:00Z',checkedAt:'2026-10-15T12:00:00Z'});
  t.mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(input,window.location.href),params=url.searchParams;
    if(url.pathname.endsWith('/insights/questions')){
      const end=params.get('end')||'2026-10-11',days=Number(params.get('days')||90),start=new Date(Date.parse(end+'T12:00:00Z')-(days-1)*86400_000).toISOString().slice(0,10);
      return Response.json({window:{start,end},counts:{selectedQuestions:0},selection:{},stats,selectedStats:stats,clusters:[],words:[],questions:[],nextOffset:null,facets:{countries:Object.keys(ids).map(code=>({code,count:0,authors:0}))},analysis:{unassignedQuestions:0,missingEnglishTitles:0},coverage:{indexComplete:false,truncated:false}});
    }
    if(url.pathname.endsWith('/corpus/search')){
      const body=JSON.parse(options.body);searches.push(body);const id=ids[body.country]||ids.IT;
      return Response.json({total:61,limit:20,offset:body.offset,nextOffset:null,truncated:false,coverage:{complete:false},results:[{sourceId:id,kind:'question',date:'2026-09-15',questionDate:'2026-09-15',title:'Water policy',reference:id,hits:[record(id)]}]});
    }
    if(url.pathname.endsWith('/corpus/text')){readerRequests.push({id:params.get('source-id'),key:params.get('source-key')});return Response.json(record(params.get('source-id')));}
    throw new Error('Unexpected request: '+url);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {QuestionTopics}=await vite.ssrLoadModule('/src/QuestionTopics.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const query=()=>new URL(location.href).searchParams;
  async function select(selector,value){await act(async()=>{const node=container.querySelector(selector);assert(node,'Missing '+selector);node.focus();node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));});}
  function cleared(){assert.equal(query().has('q-fts-page'),false);assert.equal(query().has('q-fts-offset'),false);assert.equal(query().has('q-fts-read'),false);assert.equal(container.querySelector('.explorer-search-reader'),null);for(const [key,value] of [['q-fts-search','water'],['q-fts-text-lang','fr'],['q-fts-sort','newest']])assert.equal(query().get(key),value);}
  async function focusStays(selector){const control=container.querySelector(selector);await act(async()=>{await new Promise(resolve=>window.setTimeout(resolve,25));});assert.equal(document.activeElement,control,'changing '+selector+' must not move focus to the search field');}
  async function back(){await act(async()=>{const restored=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history.back();await restored;});assert.equal(query().get('q-country'),'IT');assert.equal(query().get('q-fts-page'),'3');assert.equal(query().get('q-fts-read'),read);assert.equal(searches.at(-1).country,'IT');assert.equal(searches.at(-1).offset,37);assert.match(container.querySelector('.explorer-search-body')?.textContent||'',/Italian saved reader/);}
  await act(async()=>root.render(createElement(QuestionTopics,{language:'en',onBack(){}})));
  assert.equal(query().get('q-fts-page'),'3');assert.equal(query().get('q-fts-read'),read);assert.equal(searches.at(-1).offset,37);assert.deepEqual(readerRequests,[{id:ids.IT,key:'fr'}]);
  const panel=container.querySelector('.explorer-search-panel'),exposedAnalytics=[];
  const observer=new window.MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&(node.matches('.insight-question-dimensions')||node.querySelector('.insight-question-dimensions')))exposedAnalytics.push(node);});observer.observe(container,{childList:true,subtree:true});t.after(()=>observer.disconnect());
  await select('[data-question-country]','HU');cleared();assert(searches.filter(search=>search.country==='HU').every(search=>search.offset===0));await focusStays('[data-question-country]');
  await back();const beforeFrance=searches.length,beforeReaders=readerRequests.length;
  await select('[data-question-country]','FR');cleared();assert.equal(searches.at(-1).country,'FR');assert(searches.slice(beforeFrance).every(search=>search.country==='FR'&&search.offset===0),'a new country after Back must never request the restored page');assert.equal(readerRequests.length,beforeReaders);await focusStays('[data-question-country]');
  await back();let before=searches.length;
  await act(async()=>{const input=container.querySelector('.insight-controls input[type="date"]');input.focus();Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'2026-10-10');input.dispatchEvent(new window.InputEvent('input',{bubbles:true}));});
  cleared();assert.equal(query().get('q-until'),'2026-10-10');assert(searches.slice(before).every(search=>search.offset===0&&search.to==='2026-10-10'));assert.equal(readerRequests.length,beforeReaders);await focusStays('.insight-controls input[type="date"]');
  await back();before=searches.length;await select('.insight-controls select','30');
  cleared();assert.equal(query().get('q-days'),'30');assert(searches.slice(before).every(search=>search.offset===0&&search.from==='2026-09-12'));assert.equal(readerRequests.length,beforeReaders);await focusStays('.insight-controls select');
  assert.equal(container.querySelector('.explorer-search-panel'),panel,'scope gestures keep the open panel mounted');assert.equal(exposedAnalytics.length,0,'scope changes must not briefly expose the visual exploration');
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
  const {SpeechCloud}=await vite.ssrLoadModule('/src/SpeechCloud.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(SpeechCloud,{week:'2026-10-05',country:'IT',interfaceLanguage:'en'})));
  assert.equal(searches.length,0,'no unbounded search may run before period dates arrive');
  assert.equal(new URL(location.href).searchParams.get('agenda-fts-page'),'3');
  assert.equal(new URL(location.href).searchParams.get('agenda-fts-read'),read);
  await act(async()=>resolveCloud(Response.json(cloud)));
  assert.equal(searches.length,1);
  assert.deepEqual(searches[0],{query:'energy',kinds:['speech'],language:'fr',uiLanguage:'en',country:'IT',from:'2026-10-05',to:'2026-10-09',group:'document',dateBasis:'document',sort:'relevance',limit:20,offset:60});
  assert.equal(new URL(location.href).searchParams.get('agenda-fts-page'),'3','hydrating dates must preserve the restored page');
  assert.equal(new URL(location.href).searchParams.get('agenda-fts-read'),read,'hydrating dates must preserve the restored exact reader');
  assert.equal(container.querySelector('.explorer-search-body')?.lang,'fr');
  assert.match(container.textContent,/all indexed speech contributions within this plenary week/);
  assert.match(container.textContent,/available text languages beyond the word cloud’s current language/);
  await act(async()=>{const select=container.querySelector('.explorer-cloud-controls select');select.value='de';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(cloudCalls.length,2);
  assert.deepEqual(searches.at(-1),searches[0],'changing the cloud analysis language must preserve the exact corpus search scope and page');
  assert.equal(new URL(location.href).searchParams.get('agenda-fts-page'),'3');
  assert.equal(new URL(location.href).searchParams.get('agenda-fts-read'),read);
});

test('explicit plenary navigation clears contextual result positions before remounts while saved links and Back keep them',async t=>{
  const days=['2026-10-07','2026-10-08','2026-10-14'],sittings=days.map(date=>({id:'MTG-PL-'+date,date,phase:'past'}));
  const topics=[['A',0],['B',0],['C',1],['D',2]].map(([name,index])=>({id:sittings[index].id+'-OJ-ITM-D-'+name,sittingId:sittings[index].id,date:days[index],title:'Debate '+name,kind:'PLENARY_DEBATE',documentIds:[],procedureIds:[],speech:sittings[index].id+'-OTH-'+name}));
  const [a,b,c,d]=topics,initialRead=JSON.stringify([a.speech,'fr']);
  const initial=new URLSearchParams({view:'legislation','pl-sitting':a.sittingId,'agenda-topic':a.id,'agenda-fts-search':'energy','agenda-fts-text-lang':'fr','agenda-fts-sort':'newest','agenda-fts-page':'3','agenda-fts-read':initialRead});
  const window=new Window({url:'http://localhost/?'+initial});
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:window.DOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,innerWidth:1440,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let vite,root,resolvePeriod,resolveCloud,deferPeriod=false;
  const pending=new Map(),searches=[],textRequests=[];
  t.after(async()=>{if(root)await act(async()=>root.unmount());for(const request of pending.values())request.resolve(Response.json(request.data));if(vite)await vite.close();await window.happyDOM.close();for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  const stats={denominator:0,uniquePeople:0,uniqueCurrentMeps:0,peopleOutsideCurrentRoster:0,referenceDate:days[0],dimensions:{country:[],group:[],gender:[],age:[]}};
  function legislation(sittingId,topicId){const sitting=sittings.find(day=>day.id===sittingId)||sittings[0],topic=topics.find(item=>item.id===topicId);return {view:'legislation',sitting,sittings,topics:topics.filter(item=>item.sittingId===sitting.id),coverage:{agendaError:null,agendaComplete:true,indexComplete:true},detail:topic?{...topic,phase:'past',procedures:[],committeeWork:[],roles:[],people:[],stats,speeches:[{sourceId:topic.speech,date:topic.date,title:topic.title,kind:'PLENARY_DEBATE_WRITTEN_STATEMENT',start:null,end:null,people:[]}],voteCoverage:{truncated:false},coverage:{gaps:[],roleRowsTruncated:false,speechAssociations:{sources:[],truncated:false}}}:null};}
  const stored=id=>({sourceId:id,sourceKey:'fr',kind:'speech',parentId:null,date:days[0],language:'fr',translationType:'original',sourceUrl:'https://www.europarl.europa.eu/example/'+id,sha256:'fixture-hash',snippet:'\u0002Energy\u0003 policy',body:'Energy policy',highlightedBody:'\u0002Energy\u0003 policy',fetchedAt:'2026-10-15T12:00:00Z',checkedAt:'2026-10-15T12:00:00Z'});
  t.mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(input,window.location.href),params=url.searchParams;
    if(url.pathname.endsWith('/insights/legislation')){
      const data=legislation(params.get('sitting'),params.get('topic'));
      if(params.has('topic'))return new Promise(resolve=>pending.set(params.get('topic'),{resolve,data}));
      if(deferPeriod&&params.get('sitting')===c.sittingId){deferPeriod=false;return new Promise(resolve=>{resolvePeriod=()=>resolve(Response.json(data));});}
      return Response.json(data);
    }
    if(url.pathname.endsWith('/insights/speech-cloud'))return new Promise(resolve=>{const date=params.get('sitting')?.slice(7)||c.date;resolveCloud=()=>resolve(Response.json({scope:{kind:'sitting',phase:'past'},language:'en',words:[],speeches:[],coverage:{transcripts:0,matchedSpeechRecords:0,missingLanguage:0,unreadableText:0,complete:true,truncated:false,associationUnavailable:false},window:{start:date,end:date},nextPage:null}));});
    if(url.pathname.endsWith('/insights/participation'))return Response.json({topics:[{...d,upcoming:false,speakers:1,voters:0,amendmentVotes:0,rollCalls:0}],series:[],window:{start:days[2],end:days[2]},coverage:{gaps:[]}});
    if(url.pathname.endsWith('/corpus/search')){
      const body=JSON.parse(options.body);searches.push(body);const id=body.sourceIds?.[0]||(body.from===d.date?d.speech:c.speech);
      return Response.json({total:61,limit:20,offset:body.offset,nextOffset:null,truncated:false,coverage:{complete:false},results:[{sourceId:id,kind:'speech',date:days[0],title:'Energy policy',reference:id,hits:[stored(id)]}]});
    }
    if(url.pathname.endsWith('/corpus/text')){textRequests.push(params.get('source-id'));return Response.json(stored(params.get('source-id')));}
    if(url.pathname.includes('/speech/'))return Response.json({id:url.pathname.split('/').at(-1),xml:null,speakers:[],availableTextLanguages:[],textLanguage:null});
    throw new Error('Unexpected request: '+url);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {Legislation}=await vite.ssrLoadModule('/src/Legislation.tsx');
  const {createRoot}=await import('react-dom/client');
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const query=()=>new URL(location.href).searchParams;
  const click=async text=>act(async()=>{const button=[...container.querySelectorAll('button')].find(node=>node.textContent===text||node.querySelector('strong')?.textContent===text);assert(button,'Missing '+text);button.click();});
  const select=async(selector,value)=>act(async()=>{const node=container.querySelector(selector);assert(node,'Missing '+selector);node.value=value;node.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const respond=async topic=>{const request=pending.get(topic.id);assert(request,'Expected pending '+topic.title);pending.delete(topic.id);await act(async()=>request.resolve(Response.json(request.data)));};
  function resetPosition(){assert.equal(query().has('agenda-fts-page'),false);assert.equal(query().has('agenda-fts-offset'),false);assert.equal(query().has('agenda-fts-read'),false);for(const [key,value] of [['agenda-fts-search','energy'],['agenda-fts-text-lang','fr'],['agenda-fts-sort','newest']])assert.equal(query().get(key),value);}
  async function restorePosition(speech){await act(async()=>{const url=new URL(location.href);url.searchParams.set('agenda-fts-page','2');url.searchParams.set('agenda-fts-offset','37');url.searchParams.set('agenda-fts-read',JSON.stringify([speech,'fr']));history.replaceState(null,'',url);window.dispatchEvent(new window.Event('popstate'));});}
  await act(async()=>root.render(createElement(Legislation,{language:'en',onBack(){}})));
  assert.equal(searches.length,0);assert.equal(query().get('agenda-fts-page'),'3');assert.equal(query().get('agenda-fts-read'),initialRead);
  await respond(a);assert.equal(searches.at(-1).offset,60);assert.equal(query().get('agenda-fts-read'),initialRead);assert(container.querySelector('.explorer-search-reader'));
  const initialTextRequests=textRequests.length;
  await click(b.title);resetPosition();assert.equal(container.querySelector('.insight-topic-detail .explorer-text-search'),null);
  assert.equal(textRequests.length,initialTextRequests,'loading the next item must not request the old reader');
  await respond(b);assert.equal(searches.at(-1).offset,0);assert.deepEqual(searches.at(-1).sourceIds,[b.speech]);assert(searches.filter(search=>search.sourceIds?.includes(b.speech)).every(search=>search.offset===0));assert.equal(container.querySelector('.explorer-search-reader'),null);
  assert.equal(window.history.length,2,'topic and contextual resets belong to one Back/Forward step');
  await act(async()=>{const restored=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history.back();await restored;});
  assert.equal(query().get('agenda-topic'),a.id);assert.equal(query().get('agenda-fts-page'),'3');assert.equal(query().get('agenda-fts-read'),initialRead);assert.equal(searches.at(-1).offset,60);
  deferPeriod=true;await select('.insight-controls select','sitting:'+c.sittingId);resetPosition();assert(resolvePeriod);await act(async()=>resolvePeriod());
  await click(c.title);resetPosition();await respond(c);assert.deepEqual(searches.at(-1).sourceIds,[c.speech]);assert.equal(searches.at(-1).offset,0);
  await restorePosition(c.speech);assert.equal(query().get('agenda-fts-page'),'2');
  let before=searches.length,beforeTexts=textRequests.length;
  await click('Word cloud');resetPosition();assert(resolveCloud);await act(async()=>resolveCloud());
  assert.equal(searches.at(-1).offset,0);assert.equal(searches.at(-1).from,c.date);assert.equal('sourceIds' in searches.at(-1),false);assert(searches.slice(before).every(search=>search.offset===0));assert.equal(textRequests.length,beforeTexts);assert.equal(container.querySelector('.explorer-search-reader'),null);
  await restorePosition(c.speech);before=searches.length;beforeTexts=textRequests.length;
  await select('.explorer-cloud-controls select','sitting:'+d.sittingId);resetPosition();assert.equal(searches.length,before,'a new cloud period waits for its own dates');await act(async()=>resolveCloud());
  assert.equal(searches.at(-1).from,d.date);assert(searches.slice(before).every(search=>search.offset===0));assert.equal(textRequests.length,beforeTexts);assert.equal(container.querySelector('.explorer-search-reader'),null);
  await restorePosition(d.speech);before=searches.length;beforeTexts=textRequests.length;
  await click('Agenda');resetPosition();assert.equal(searches.at(-1).offset,0);assert.deepEqual(searches.at(-1).sourceIds,[c.speech]);assert(searches.slice(before).every(search=>search.offset===0));assert.equal(textRequests.length,beforeTexts);assert.equal(container.querySelector('.explorer-search-reader'),null);
  const unseen='MTG-PL-2026-10-07-OTH-UNSEEN';
  await click('What’s hot');await restorePosition(unseen);assert.equal(query().get('agenda-fts-page'),'2');beforeTexts=textRequests.length;
  await click(d.title);resetPosition();await respond(d);assert.equal(searches.at(-1).offset,0);assert.deepEqual(searches.at(-1).sourceIds,[d.speech]);assert.equal(textRequests.length,beforeTexts);assert.equal(textRequests.includes(unseen),false,'programmatic topic navigation must not request a stale independent reader');assert.equal(container.querySelector('.explorer-search-reader'),null);
});
