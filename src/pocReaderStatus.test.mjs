import test from 'node:test';
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

async function harness(t) {
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
    const url=new URL(input,window.location.href),route=url.pathname.split('/poc/')[1]+url.search;
    assert.match(route,/^(document|speech)\//,'reader tests must not contact unrelated services');
    return new Promise((resolve,reject)=>requests.push({route,resolve,reject,finished:false}));
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const readers=await vite.ssrLoadModule('/src/PocInsightReaders.tsx');
  const {expireActivityReads}=await vite.ssrLoadModule('/src/pocData.ts');
  const {createRoot}=await import('react-dom/client');
  const trigger=document.createElement('button');trigger.textContent='Read selected item';document.body.append(trigger);trigger.focus();
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  const render=element=>act(async()=>root.render(element));
  const reader=(kind,props={})=>createElement(kind==='question'?readers.InsightQuestionReader:readers.InsightSpeechReader,{id:kind==='question'?questionId:speechId,language:'en',...props});
  const finish=(route,data,error=false)=>act(async()=>{
    const request=requests.find(request=>request.route===route&&!request.finished);
    assert(request,'Missing request: '+route);request.finished=true;
    if(error)request.reject(new Error('Fixture request failed.'));else request.resolve(Response.json(data));
  });
  const wait=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,400)));
  const status=()=>container.querySelector('[role="status"][aria-live="polite"]');
  return {window,container,trigger,reader,render,finish,wait,status,expireActivityReads};
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
    assert.equal(h.status().textContent,kind==='question'?'Question: Text unavailable.':'Speech temporarily unavailable.');
    assert.equal(h.container.querySelector('.insight-reader-text'),null);
    assert(!h.container.textContent.includes(body));
    assert.equal(document.activeElement,h.trigger);
  });
});
