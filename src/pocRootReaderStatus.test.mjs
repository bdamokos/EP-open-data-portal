import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {createServer} from 'vite';

const member={id:257043,firstName:'Mika',lastName:'Aaltola',sortName:'AALTOLA Mika',gender:'m',countryCode:'FI',groupCode:'EPP',memberships:[],accounts:[]};
const questionId='E-10-2026-003031',speechId='MTG-PL-2026-03-25-OTH-2017069380111';
const paragraphs=[
  'Distinctive copper heron reader fixture. This paragraph remains ordinary readable content while a delayed public document request completes. Every sentence must survive rendering without becoming part of a live announcement.',
  'Distinctive silver willow reader fixture. A second substantial paragraph checks that the reader preserves the complete supplied text. Result and error messages can change nearby without absorbing this document into their announcement boundary.',
];
const files=['en','fr'].flatMap(language=>['PDF','DOCX'].map(format=>({format,language,url:`https://www.europarl.europa.eu/doceo/document/${questionId}_${language.toUpperCase()}.${format.toLowerCase()}`})));
const documentResult=(language='en',available=true)=>({id:questionId,selectedDocumentId:questionId,date:'2026-10-01',titles:{en:'Written question fixture'},roles:['AUTHOR'],files,answers:[],selectedText:{status:available?'available':'unavailable',paragraphs:available?paragraphs:[],textLanguage:language,availableTextLanguages:['en','fr'],translationType:'original',sourceFormat:'DOCX',sourceUrl:files.find(file=>file.language===language&&file.format==='DOCX').url}});
const questionItem={id:'question:'+questionId,sourceId:questionId,date:'2026-10-01',title:'Written question fixture',recordKind:'document',category:'written-questions',categoryLabel:'Written questions',reference:questionId,files,provenance:{role:'QUESTION_AUTHOR'}};
const speechItem={id:'speech:'+speechId,sourceId:speechId,date:'2026-03-25',title:'Plenary speech fixture',titles:{en:'Plenary speech fixture'},recordKind:'speech',category:'plenary-contributions',categoryLabel:'Plenary contributions',reference:speechId,files:[],speechKind:'PLENARY_DEBATE_SPEECH',start:'2026-03-25T10:00:00Z',end:'2026-03-25T10:01:00Z',websiteUrl:'https://www.europarl.europa.eu/doceo/document/CRE-10-2026-03-25-INT-2017069380111_EN.html',websiteLanguage:'en',provenance:{role:'SPEAKER'}};
const page=items=>({categories:{'written-questions':'Written questions','plenary-contributions':'Plenary contributions'},categoryGroups:[],categoryCoverage:{},items,selectedItems:[],indexedTotal:items.length,nextOffset:null,cache:{complete:true}});

async function harness(t,{items=[questionItem],activity,module='activities',language='en'}={}) {
  const query=new URLSearchParams({member:String(member.id),module,lang:language});if(activity)query.set('activity',activity);
  const window=new Window({url:'http://localhost/?'+query}),pending=[],unexpected=[];
  class ReaderDOMParser extends window.DOMParser {
    parseFromString(...args) {
      const parsed=super.parseFromString(...args),query=parsed.getElementsByTagNameNS.bind(parsed);
      // Happy DOM lacks wildcard namespace queries; these fixture paragraphs
      // have the same standard wildcard result as getElementsByTagName.
      parsed.getElementsByTagNameNS=(namespace,name)=>namespace==='*'?parsed.getElementsByTagName(name):query(namespace,name);
      return parsed;
    }
  }
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:ReaderDOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),innerWidth:1440,requestAnimationFrame:callback=>setTimeout(callback,0),cancelAnimationFrame:clearTimeout,IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,vite;
  t.mock.method(window.HTMLElement.prototype,'scrollIntoView',()=>{});
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    for(const request of pending)if(!request.finished)request.resolve(Response.json({}));
    await Promise.resolve();if(vite)await vite.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
    assert.deepEqual(unexpected,[],'all app requests use isolated public-source fixtures');
  });
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input,location.href),route=url.pathname.split('/poc/')[1];
    if(/^(document|speech)\//.test(route))return new Promise(resolve=>pending.push({route:route+url.search,resolve,finished:false}));
    if(route==='directory')return Response.json({day:'2026-10-16',members:[member],committees:[],index:{complete:true,loaded:1,total:1,failed:0,error:null}});
    if(route===`portrait/${member.id}`)return new Response(null,{status:404});
    if(route?.startsWith('latest-activities/'))return Response.json(page(items));
    if(route?.startsWith('speech-statistics/'))return Response.json({memberId:String(member.id),items:[],counts:{groupOrations:0,blueQuestions:0,blueAnswers:0,blueReactions:0},groups:[],coverage:{complete:true,available:0,total:0},nextPage:null,sources:[]});
    if(route==='insights/speech-cloud')return Response.json({scope:{kind:'member',phase:'past'},language:url.searchParams.get('lang'),words:[{word:'fixture',label:'Fixture',speechCount:1,occurrences:1,speechIds:[speechId]}],speeches:[{id:speechId,date:'2026-03-25',title:'Plenary speech fixture',titleLanguage:'en',machineTranslation:false,people:[]}],coverage:{transcripts:1,matchedSpeechRecords:1,missingLanguage:0,unreadableText:0,complete:true,truncated:false,associationUnavailable:false},window:{start:'2026-03-25',end:'2026-03-25'},nextPage:null});
    if(route==='insights/saved')return Response.json({members:[],questions:[]});
    unexpected.push(url.href);throw new Error('Unexpected fixture request: '+url.href);
  });
  vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {default:PocApp}=await vite.ssrLoadModule('/src/PocApp.tsx'),{expireActivityReads}=await vite.ssrLoadModule('/src/pocData.ts');
  const {createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(createElement(PocApp)));
  const click=node=>{assert(node,'Missing control');return act(async()=>node.click());};
  const finish=(route,data,status=200)=>act(async()=>{
    const request=pending.find(request=>request.route===route&&!request.finished);assert(request,'Missing request: '+route);request.finished=true;request.resolve(Response.json(data,{status}));
  });
  return {window,container,pending,click,finish,expireActivityReads,wait:()=>act(async()=>new Promise(resolve=>setTimeout(resolve,400)))};
}
const status=reader=>reader.querySelector('[role="status"][aria-live="polite"]');
function assertOrdinaryText(reader) {
  const transcript=reader.querySelector('.poc-transcript');assert(transcript,'the full reader text is rendered');
  assert.equal(transcript.textContent,paragraphs.join(''));
  assert.equal(transcript.closest('[aria-live],[role="status"],[role="alert"]'),null,'no enclosing live region may absorb the reader');
  for(const region of document.querySelectorAll('[aria-live],[role="status"],[role="alert"]'))for(const paragraph of paragraphs)assert(!region.textContent.includes(paragraph));
}
function assertDownloads(reader,language='en') {
  for(const file of files.filter(file=>file.language===language))assert([...reader.querySelectorAll('a[href]')].some(link=>link.href===file.url),file.format+' download remains accessible');
}

test('selected written question keeps full text and downloads while announcing settled, unavailable and refresh-error outcomes',async t=>{
  const h=await harness(t),toggle=h.container.querySelector('.poc-speech-toggle');toggle.focus();await h.click(toggle);
  const reader=h.container.querySelector('.poc-document-text'),announcement=status(reader);
  assert.equal(announcement.textContent,'');
  await h.finish(`document/${questionId}?member=${member.id}&lang=en`,documentResult());await h.wait();
  assert.equal(status(reader),announcement);assert.equal(announcement.textContent,'Question: Text loaded.');
  assertOrdinaryText(reader);assertDownloads(reader);assert.equal(document.activeElement,toggle);

  // A later source check expires document reads. Reopening revalidates the
  // cached text, which must survive a failed refresh together with its files.
  h.expireActivityReads();await h.click(toggle);await h.click(toggle);
  const refreshed=h.container.querySelector('.poc-document-text');assertOrdinaryText(refreshed);
  await h.finish(`document/${questionId}?member=${member.id}&lang=en`,{error:{message:'Document fixture temporarily unavailable.'}},503);await h.wait();
  assert.equal(status(refreshed).textContent,'Question: Text temporarily unavailable.');assertOrdinaryText(refreshed);assertDownloads(refreshed);
  assert.equal(refreshed.querySelectorAll('[role="status"],[role="alert"]').length,1,'the reader error has one narrow announcement');
  const language=refreshed.querySelector('select[aria-label="Question language"]');
  await act(async()=>{language.value='fr';language.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
  await h.finish(`document/${questionId}?member=${member.id}&lang=fr`,documentResult('fr',false));await h.wait();
  assert.equal(status(refreshed).textContent,'Question: Text unavailable.');assert.match(refreshed.textContent,/Text unavailable\. Download the document below\./);assertDownloads(refreshed,'fr');
  assert.equal(document.activeElement,toggle,'reader outcomes must not move focus from the activity control');
});

test('member cloud opens the chosen transcript while names and chair roles retain the interface language',async t=>{
  for(const [language,transcript] of [['bg','en'],['en','el']])await t.test(language+'/'+transcript,async t=>{
    const h=await harness(t,{module:'speeches',language,items:[speechItem]});
    if(transcript!=='en')await act(async()=>{const select=h.container.querySelector('.poc-cloud-controls select');select.value=transcript;select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
    await h.click(h.container.querySelector('.poc-cloud-words button'));
    await h.click(h.container.querySelector('.poc-cloud-source'));
    const person={id:'34232',name:'Kristian Vigenin',sittingRole:'chair',office:{code:'vice-president-parliament'},nameVariants:[{value:'Kristian Vigenin',script:'Latn',language:null,source:'fixture'},{value:'Кристиан Вигенин',script:'Cyrl',language:null,source:'fixture'}]};
    await h.finish(`speech/${speechId}?lang=${transcript}`,{id:speechId,speakers:[person],intervention:{type:'chair',onBehalfOf:[]},xml:'<speech><p>Fixture transcript.</p></speech>',textLanguage:transcript,translationType:'original'});
    const reader=h.container.querySelector('.poc-speech-detail');
    assert.equal(reader.querySelector('.poc-transcript').lang,transcript);
    assert.equal(reader.querySelector('strong').textContent,language==='bg'?'Кристиан Вигенин':'Kristian Vigenin');
    const roles=[...reader.querySelectorAll('.insight-secondary span')];assert(roles.length===2);
    assert(roles.every(role=>role.lang===language));
    assert.equal(roles[0].textContent,language==='bg'?'Заместник-председател на Европейския парламент':'Vice-President of the European Parliament');
  });
});

test('selected root speech announces an error once, retries successfully, and preserves transcript source and player controls',async t=>{
  const h=await harness(t,{items:[speechItem]}),toggle=h.container.querySelector('.poc-speech-toggle');toggle.focus();await h.click(toggle);
  const reader=h.container.querySelector('.poc-speech-detail'),source=speechItem.websiteUrl;
  await h.finish(`speech/${speechId}?lang=en`,{error:{message:'Speech fixture temporarily unavailable.'}},503);await h.wait();
  assert.equal(status(reader).textContent,'','the existing error alert is not repeated through the status region');
  assert.equal(reader.querySelectorAll('[role="alert"]').length,1);assert.match(reader.querySelector('[role="alert"]').textContent,/Speech fixture temporarily unavailable\./);
  assert([...reader.querySelectorAll('a[href]')].some(link=>link.href===source));assert([...reader.querySelectorAll('button')].some(button=>button.textContent==='Play · EN'));
  assert.equal(document.activeElement,toggle);
  await h.click([...reader.querySelectorAll('button')].find(button=>button.textContent==='Try again'));
  await h.finish(`speech/${speechId}?lang=en`,{id:speechId,xml:'<speech>'+paragraphs.map(text=>'<p>'+text+'</p>').join('')+'</speech>',textLanguage:'en',translationType:'original'});await h.wait();
  assert.equal(status(reader).textContent,'Transcript loaded.');assert.equal(reader.querySelector('[role="alert"]'),null);assertOrdinaryText(reader);
  assert([...reader.querySelectorAll('a[href]')].some(link=>link.href===source));assert([...reader.querySelectorAll('button')].some(button=>button.textContent==='Play · EN'));
});

test('an explicitly checked linked activity keeps its nested document outside the fallback announcement',async t=>{
  const h=await harness(t,{items:[],activity:questionId}),fallback=h.container.querySelector('aside.poc-notice');assert(fallback);
  assert.equal(h.pending.length,0,'a linked source is checked only after the explicit action');
  await h.click([...fallback.querySelectorAll('button')].find(button=>button.textContent==='Check this source with Parliament'));
  await h.finish(`document/${questionId}?member=${member.id}&lang=en`,documentResult());await h.wait();
  const reader=fallback.querySelector('.poc-document-text');assert(reader);assertOrdinaryText(reader);assertDownloads(reader);
  const fallbackStatus=[...fallback.children].find(node=>node.matches('[role="status"]'));
  assert.equal(fallbackStatus.textContent,'Linked source available.');assert.equal(status(reader).textContent,'Question: Text loaded.');
  assert.equal(h.pending.length,1,'the nested reader reuses the completed exact-source request');
});
