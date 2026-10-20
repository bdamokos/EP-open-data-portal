import test from 'node:test';
import {API_VERSION} from '../server/api-version.mjs';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const body='Distinctive reader content that must stay outside every live announcement.';
const questionId='E-10-2026-003031',speechId='MTG-PL-2026-03-25-OTH-2017069380111';
const question=(id=questionId,language='en',status='available')=>({
  id,selectedDocumentId:id,files:[{format:'PDF',language,url:'https://www.europarl.europa.eu/doceo/document/'+id+'_EN.pdf'}],answers:[],
  selectedText:{status,paragraphs:status==='available'?[body]:[],textLanguage:language,availableTextLanguages:['en','fr'],translationType:'original',sourceFormat:'DOCX',sourceUrl:'https://www.europarl.europa.eu/doceo/document/'+id+'_EN.docx'},
});
const speech=(id=speechId,language='en',available=true)=>({
  id,kind:'PLENARY_DEBATE_SPEECH',speakers:[],xml:available?'<speech><p>'+body+'</p></speech>':null,textLanguage:language,
  availableTextLanguages:['en','fr'],translationType:'original',websiteUrl:'https://www.europarl.europa.eu/doceo/document/'+id+'_EN.html',
});

async function harness(t,{stored=false}={}) {
  const window=new Window({url:'http://localhost/'}),requests=[];
  class ReaderDOMParser extends window.DOMParser {
    parseFromString(...args) {
      const parsed=super.parseFromString(...args),query=parsed.getElementsByTagNameNS.bind(parsed);
      // Happy DOM lacks wildcard namespace queries. These unnamespaced fixtures
      // have the same standard wildcard result as getElementsByTagName.
      parsed.getElementsByTagNameNS=(namespace,name)=>namespace==='*'?parsed.getElementsByTagName(name):query(namespace,name);
      return parsed;
    }
  }
  const globals={window,document:window.document,DOMParser:ReaderDOMParser,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,vite;
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    for(const request of requests)if(!request.finished)request.resolve(Response.json({}));
    await Promise.resolve();
    if(vite)await vite.close();
    await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  });
  t.mock.method(globalThis,'fetch',input=>{
    const url=new URL(input,window.location.href);assert.equal(url.searchParams.get('v'),String(API_VERSION));url.searchParams.delete('v');const route=url.pathname.split('/api/')[1]+url.search;
    if(!stored&&route.startsWith('speech-transcript/'))return Promise.resolve(Response.json({id:route.split('/')[1].split('?')[0],available:false}));
    assert.match(route,/^(document|speech|speech-transcript)\//,'reader tests must not contact unrelated services');
    return new Promise((resolve,reject)=>requests.push({route,resolve,reject,finished:false}));
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const readers=await vite.ssrLoadModule('/src/InsightReaders.tsx');
  const {expireActivityReads}=await vite.ssrLoadModule('/src/data.ts');
  const {createRoot}=await import('react-dom/client');
  const trigger=document.createElement('button');trigger.textContent='Read selected item';document.body.append(trigger);trigger.focus();
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=element=>act(async()=>root.render(element));
  const reader=(kind,props={})=>createElement(kind==='question'?readers.InsightQuestionReader:readers.InsightSpeechReader,{id:kind==='question'?questionId:speechId,language:'en',...props});
  const finish=(route,data,error=false)=>act(async()=>{
    const request=requests.find(request=>request.route===route&&!request.finished);
    assert(request,'Missing request: '+route);request.finished=true;
    if(error)request.reject(new Error('Fixture request failed.'));else request.resolve(data instanceof Response?data:Response.json(data));
  });
  const wait=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,400)));
  const status=()=>container.querySelector('[role="status"][aria-live="polite"]');
  return {window,container,trigger,reader,render,finish,wait,status,expireActivityReads,requests};
}

test('settled readers announce concise status once and keep document bodies out of live regions',async t=>{
  for(const kind of ['question','speech'])await t.test(kind,async t=>{
    const h=await harness(t);
    await h.render(h.reader(kind));
    const status=h.status(),announcements=[];
    assert(status,'a stable status region exists before completion');assert.equal(status.textContent,'');
    const observer=new h.window.MutationObserver(()=>{if(status.textContent)announcements.push(status.textContent);});
    observer.observe(status,{subtree:true,childList:true,characterData:true});t.after(()=>observer.disconnect());
    await h.finish(kind==='question'?`document/${questionId}?lang=en`:`speech/${speechId}?lang=en`,kind==='question'?question():speech());
    await h.wait();
    const expected=kind==='question'?'Question: Text loaded.':'Speech loaded.';
    assert.equal(h.status(),status,'completion updates the existing status region');assert.equal(status.textContent,expected);
    assert.equal(status.getAttribute('aria-atomic'),'true');assert.equal(status.getAttribute('lang'),'en');
    assert.equal(h.container.querySelector('.insight-reader-text').textContent,body);
    assert.equal(h.container.querySelector('.insight-reader-text').closest('[aria-live],[role="status"],[role="alert"]'),null);
    for(const region of h.container.querySelectorAll('[aria-live],[role="status"],[role="alert"]'))assert(!region.textContent.includes(body));
    assert.equal(document.activeElement,h.trigger,'completion must not move focus');
    assert(h.container.querySelector(kind==='question'?'.insight-reader-source a':'.insight-source-document'),'source access remains available');
    await h.render(h.reader(kind,{highlight:'reader'}));await h.wait();
    assert.deepEqual(announcements,[expected],'unrelated rerenders must not repeat the completed announcement');
  });
});

test('reader request errors announce the current failure without moving focus or duplicating alerts',async t=>{
  for(const kind of ['question','speech'])await t.test(kind,async t=>{
    const h=await harness(t),id=kind==='question'?questionId+'-ASW':speechId;
    await h.render(h.reader(kind,{id,heading:'Answer'}));
    await h.finish(`${kind==='question'?'document':'speech'}/${id}?lang=en`,null,true);await h.wait();
    assert.equal(h.status().textContent,kind==='question'?'Answer: Text temporarily unavailable.':'Speech temporarily unavailable.');
    assert.equal(h.container.querySelectorAll('[role="status"],[role="alert"]').length,1,'the visible error does not create a second live announcement');
    assert.equal(document.activeElement,h.trigger);
  });
});

test('superseded reader IDs and languages cannot announce obsolete completion or failure',async t=>{
  for(const kind of ['question','speech'])for(const change of ['id','language'])await t.test(`${kind} ${change}`,async t=>{
    const h=await harness(t),id=kind==='question'?questionId:speechId,prefix=kind==='question'?'document':'speech';
    const nextId=change==='id'?id+'-next':id,nextLanguage=change==='language'?'fr':'en';
    await h.render(h.reader(kind));
    await h.render(h.reader(kind,{id:nextId,language:nextLanguage}));
    await h.finish(`${prefix}/${id}?lang=en`,kind==='question'?question():speech(),change==='language');await h.wait();
    assert.equal(h.status().textContent,'','the current reader remains silent while its request is pending');
    assert.equal(h.container.querySelector('.insight-reader-text'),null,'obsolete content must not replace the selected reader');
    await h.finish(`${prefix}/${nextId}?lang=${nextLanguage}`,kind==='question'?question(nextId,nextLanguage):speech(nextId,nextLanguage));await h.wait();
    assert.equal(h.status().textContent,kind==='question'?'Question: Text loaded.':'Speech loaded.');
    assert.equal(h.container.querySelector('.insight-reader-text').getAttribute('lang'),nextLanguage);
    assert.equal(document.activeElement,h.trigger);
  });
});

test('unavailable text stays explicit with source access, and failed document refresh preserves cached text',async t=>{
  for(const kind of ['question','speech'])await t.test(`${kind} unavailable`,async t=>{
    const h=await harness(t);
    await h.render(h.reader(kind));
    await h.finish(kind==='question'?`document/${questionId}?lang=en`:`speech/${speechId}?lang=en`,kind==='question'?question(questionId,'en','unavailable'):speech(speechId,'en',false));await h.wait();
    assert.equal(h.status().textContent,kind==='question'?'Question: Text unavailable.':'Transcript unavailable.');
    assert(h.container.querySelector('a[href]'),'unavailable text retains its original source or download route');
    assert.equal(document.activeElement,h.trigger);
  });
  await t.test('cached document refresh failure',async t=>{
    const h=await harness(t);
    await h.render(h.reader('question'));await h.finish(`document/${questionId}?lang=en`,question());await h.wait();
    await h.render(null);h.expireActivityReads();await h.render(h.reader('question'));
    assert.equal(h.container.querySelector('.insight-reader-text').textContent,body,'cached text remains readable during refresh');
    assert.equal(h.status().textContent,'','cached content is not announced as a completed refresh');
    await h.finish(`document/${questionId}?lang=en`,null,true);await h.wait();
    assert.equal(h.status().textContent,'Question: Text temporarily unavailable.');
    assert.equal(h.container.querySelector('.insight-reader-text').textContent,body,'a refresh error does not discard cached text');
    assert(h.container.querySelector('.insight-reader-source a'));
    assert.equal(document.activeElement,h.trigger);
  });
});

test('a mismatched response identifier is announced as unavailable instead of reading unrelated text',async t=>{
  for(const kind of ['question','speech'])await t.test(kind,async t=>{
    const h=await harness(t);
    await h.render(h.reader(kind));
    await h.finish(kind==='question'?`document/${questionId}?lang=en`:`speech/${speechId}?lang=en`,kind==='question'?question('E-10-2026-003032'):speech('MTG-PL-2026-03-25-OTH-2017069380112'));await h.wait();
    assert.equal(h.status().textContent,kind==='question'?'Question: Text temporarily unavailable.':'Speech temporarily unavailable.');
    assert.equal(h.container.querySelector('.insight-reader-text'),null);
    assert(!h.container.textContent.includes(body));
    assert.equal(document.activeElement,h.trigger);
  });
});


test('inline retries recover the same ID and chosen language once, retaining local keyboard focus',async t=>{
  for(const kind of ['question','speech'])await t.test(kind,async t=>{
    const h=await harness(t),id=kind==='question'?questionId:speechId,prefix=kind==='question'?'document':'speech';
    await h.render(h.reader(kind));
    await h.finish(`${prefix}/${id}?lang=en`,kind==='question'?question():speech());
    const select=h.container.querySelector('select');
    await act(async()=>{select.value='fr';select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
    const route=`${prefix}/${id}?lang=fr`;
    await h.finish(route,Response.json({error:{code:'upstream_busy',message:'Busy.'}},{status:503}));await h.wait();
    const retry=h.container.querySelector('.reader-retry button'),heading=h.container.querySelector('h3'),section=heading.closest('section');
    assert(retry,'the failed reader has a local retry');assert.equal(retry.lang,'en');
    const originalSection=section,href=h.window.location.href;section.scrollTop=147;
    assert.equal(h.container.querySelectorAll('[role="status"],[role="alert"]').length,1);
    await act(async()=>{retry.focus();retry.click();retry.click();});
    assert.equal(document.activeElement,heading,'focus moves to the stable heading before the retry control disappears');
    assert.equal(section.scrollTop,147);assert.equal(h.window.location.href,href);
    assert.equal(h.requests.filter(request=>request.route===route).length,2,'double activation starts only one replacement request');
    assert.equal(h.container.querySelector('.reader-retry button'),null,'no second retry can be issued while loading');
    await h.finish(route,kind==='question'?question(id,'fr'):speech(id,'fr'));await h.wait();
    assert.equal(heading.closest('section'),originalSection);assert.equal(section.scrollTop,147);
    assert.equal(h.container.querySelector('.insight-reader-text').lang,'fr');assert.equal(document.activeElement,heading);
    assert.equal(h.status().textContent,kind==='question'?'Question: Text loaded.':'Speech loaded.');
    assert.equal(h.requests.filter(request=>request.route===route).length,2,'completion does not start another retry');
  });
});

test('failed refresh retries retain readable text, exact source metadata and selected document',async t=>{
  const h=await harness(t),route=`document/${questionId}?lang=en`;
  await h.render(h.reader('question',{includeAnswers:true}));await h.finish(route,question());
  await h.render(null);h.expireActivityReads();await h.render(h.reader('question',{includeAnswers:true}));
  const text=h.container.querySelector('.insight-reader-text'),source=h.container.querySelector('.insight-reader-source a');
  await h.finish(route,null,true);
  assert(!h.container.textContent.includes('No answer published.'),'a failed read must not claim parliamentary absence');
  assert.match(h.container.querySelector('.reader-retry').textContent,/Saved text remains readable/);
  let retry=h.container.querySelector('.reader-retry button');
  await act(async()=>{retry.focus();retry.click();});
  assert.equal(h.container.querySelector('.insight-reader-text'),text);assert.equal(text.textContent,body);assert.equal(text.lang,'en');assert.equal(h.container.querySelector('.insight-reader-source a'),source);
  await h.finish(route,null,true);assert.equal(h.container.querySelector('.insight-reader-text'),text);
  retry=h.container.querySelector('.reader-retry button');assert(retry,'a failed retry remains recoverable');
  await act(async()=>retry.click());await h.finish(route,question());
  assert.equal(h.container.querySelector('.reader-retry'),null);assert.equal(text.textContent,body);
});

test('HTTP-200 extraction failures honor their retry hint and localized retry label without declaring absence',async t=>{
  const h=await harness(t),route=`document/${questionId}?lang=hu`,data=question(questionId,'hu','error');
  data.selectedText.nextRetryAt=new Date(Date.now()+900).toISOString();
  await h.render(h.reader('question',{language:'hu',includeAnswers:true}));await h.finish(route,data);
  const retry=h.container.querySelector('.reader-retry button');assert(retry);assert.equal(retry.disabled,true);assert.equal(retry.lang,'hu');assert.equal(retry.textContent,'Újrapróbálkozás');
  assert.equal(retry.closest('p'),null,'retry is an action outside the error paragraph');
  const hint=document.getElementById(retry.getAttribute('aria-describedby'));
  assert(hint);assert.match(hint.textContent,/Try again in 1 second\./);assert.equal(hint.getAttribute('aria-live'),'off');
  retry.click();assert.equal(h.requests.length,1);assert(!h.container.textContent.includes('No answer published.'));
  assert(!h.container.textContent.includes('Text unavailable.'));
  await act(async()=>new Promise(resolve=>setTimeout(resolve,950)));
  assert.equal(retry.disabled,false,'the server hint expiring enables a manual retry');assert.equal(h.requests.length,1,'a hint does not start an automatic retry');
  assert.equal(retry.getAttribute('aria-describedby'),null);assert.equal(h.container.querySelector('.reader-retry-hint'),null);
  await act(async()=>{retry.focus();retry.click();});await h.finish(route,question(questionId,'hu'));
  assert.equal(h.container.querySelector('.insight-reader-text').lang,'hu');assert.equal(h.container.querySelector('.reader-retry'),null);
});

test('HTTP error cooldowns disable the local speech and document retry until the supplied time',async t=>{
  for(const kind of ['question','speech'])await t.test(kind,async t=>{
    const h=await harness(t),route=kind==='question'?`document/${questionId}?lang=en`:`speech/${speechId}?lang=en`;
    await h.render(h.reader(kind));
    await h.finish(route,Response.json({error:{code:'upstream_busy',message:'Busy.',retryAt:Date.now()+60_000}},{status:503}));
    const retry=h.container.querySelector('.reader-retry button');assert(retry);assert.equal(retry.disabled,true);
    await act(async()=>retry.click());assert.equal(h.requests.length,1);
  });
});

test('retry countdown reconciles elapsed time on return to the reader and never retries automatically',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const h=await harness(t),route=`document/${questionId}?lang=en`,data=question(questionId,'en','error');
  data.selectedText.nextRetryAt=new Date(now+125_000).toISOString();
  await h.render(h.reader('question'));await h.finish(route,data);
  const retry=h.container.querySelector('.reader-retry button'),hint=()=>h.container.querySelector('.reader-retry-hint');
  assert.equal(retry.disabled,true);assert.match(hint().textContent,/3 minutes/);
  now+=66_000;await act(async()=>h.window.dispatchEvent(new h.window.Event('focus')));
  assert.match(hint().textContent,/59 seconds/);
  now+=58_000;await act(async()=>document.dispatchEvent(new h.window.Event('visibilitychange')));
  assert.match(hint().textContent,/1 second/);assert.equal(retry.disabled,true);
  now+=1000;await act(async()=>h.window.dispatchEvent(new h.window.Event('focus')));
  assert.equal(retry.disabled,false);assert.equal(hint(),null);assert.equal(h.requests.length,1);
  await act(async()=>{retry.click();retry.click();});assert.equal(h.requests.length,2);
  await h.finish(route,question());assert.equal(h.container.querySelector('.reader-retry'),null);
});


test('a background-refresh snapshot stays locally recoverable through completion or another failure',async t=>{
  for(const outcome of ['completed','failed'])await t.test(outcome,async t=>{
    const h=await harness(t),route=`document/${questionId}?lang=en`,data=question();
    data.selectedText.refreshError='Last source refresh failed.';data.selectedText.refreshInProgress=true;
    await h.render(h.reader('question',{includeAnswers:true}));await h.finish(route,data);
    const text=h.container.querySelector('.insight-reader-text'),retry=h.container.querySelector('.reader-retry button');
    assert(retry);assert.equal(retry.disabled,false,'a server snapshot is not an active browser request');
    await act(async()=>{retry.focus();retry.click();retry.click();});assert.equal(h.requests.length,2);assert.equal(h.container.querySelector('.insight-reader-text'),text);
    if(outcome==='failed'){
      await h.finish(route,data);const again=h.container.querySelector('.reader-retry button');assert(again);assert.equal(again.disabled,false);
      assert(!h.container.textContent.includes('No answer published.'));
      await act(async()=>again.click());assert.equal(h.requests.length,3);
    }
    await h.finish(route,question());assert.equal(h.container.querySelector('.reader-retry'),null);assert.equal(h.container.querySelector('.insight-reader-text'),text);
    assert.equal(document.activeElement,h.container.querySelector('h3'));assert.equal(text.lang,'en');assert.equal(text.textContent,body);
  });
});


test('retained speech refresh failures retry locally without losing body, language or source access',async t=>{
  for(const stored of [false,true])await t.test(stored?'retained corpus':'retained detail',async t=>{
    let now=Date.now();t.mock.method(Date,'now',()=>now);
    const h=await harness(t,{stored}),route=`speech/${speechId}?lang=fr`,savedRoute=`speech-transcript/${speechId}?lang=fr`,response=stored?{id:speechId,available:true,xml:speech(speechId,'fr').xml,textLanguage:'fr',availableTextLanguages:['en','fr'],metadata:speech(speechId,'fr')}:speech(speechId,'fr');
    await h.render(h.reader('speech',{language:'hu',transcriptLanguage:'fr'}));await h.finish(stored?savedRoute:route,response);
    await h.render(null);now+=31_000;await h.render(h.reader('speech',{language:'hu',transcriptLanguage:'fr'}));
    const text=h.container.querySelector('.insight-reader-text');assert(text);const source=h.container.querySelector('.insight-source-document');assert(source);
    await h.finish(stored?savedRoute:route,Response.json({error:{code:'upstream_busy',message:'Refresh failed.',retryAt:now+4_000}},{status:503}));
    const retry=h.container.querySelector('.reader-retry button');assert(retry);assert.equal(retry.disabled,true);assert.equal(retry.lang,'hu');
    assert.equal(h.container.querySelector('.insight-reader-text'),text);assert.equal(text.lang,'fr');assert.equal(text.textContent,body);assert.equal(h.container.querySelector('.insight-source-document'),source);
    now+=4_001;await act(async()=>new Promise(resolve=>setTimeout(resolve,4_050)));
    assert.equal(retry.disabled,false);
    await act(async()=>{retry.focus();retry.click();retry.click();});assert.equal(h.container.querySelector('.reader-retry'),null,'active refresh cannot start a second retry');
    assert.equal(h.container.querySelector('.insight-reader-text'),text,'manual refresh never removes the saved body');
    await h.finish(stored?savedRoute:route,null,true);assert.equal(h.container.querySelector('.insight-reader-text'),text);assert(h.container.querySelector('.reader-retry button'));
    await act(async()=>h.container.querySelector('.reader-retry button').click());await h.finish(stored?savedRoute:route,response);await h.wait();
    assert.equal(h.container.querySelector('.reader-retry'),null);assert.equal(h.status().textContent,'Speech loaded.');assert.equal(text.lang,'fr');assert.equal(document.activeElement,h.container.querySelector('h3'));
  });
});

test('stale speech source refresh errors offer a local retry while retained transcript stays readable',async t=>{
  const h=await harness(t),route=`speech/${speechId}?lang=en`,data=speech();data.textCache={refreshError:'Last source update failed.',refreshInProgress:true};
  await h.render(h.reader('speech'));await h.finish(route,data);
  const text=h.container.querySelector('.insight-reader-text'),retry=h.container.querySelector('.reader-retry button');assert(retry);assert.equal(retry.disabled,false);
  await act(async()=>{retry.focus();retry.click();});assert.equal(h.container.querySelector('.insight-reader-text'),text);
  await h.finish(route,speech());await h.wait();assert.equal(h.container.querySelector('.reader-retry'),null);assert.equal(h.status().textContent,'Speech loaded.');assert.equal(text.textContent,body);assert.equal(document.activeElement,h.container.querySelector('h3'));
});
