import test from 'node:test';
import {API_VERSION} from '../server/api-version.mjs';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {freshLoader} from './test-support/viteRunner.mjs';

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

async function harness(t,{items=[questionItem],activity,module='activities',language='en',stored=false,summary=null,category,search}={}) {
  const query=new URLSearchParams({member:String(member.id),module,lang:language});if(activity)query.set('activity',activity);
  if(category)query.set('mep-speech-category',category);
  if(search)query.set('mep-speech-fts-search',search);
  const window=new Window({url:'http://localhost/?'+query}),pending=[],unexpected=[],searches=[],revealed=[];
  class ReaderDOMParser extends window.DOMParser {
    parseFromString(...args) {
      const parsed=super.parseFromString(...args),query=parsed.getElementsByTagNameNS.bind(parsed);
      // Happy DOM lacks wildcard namespace queries; these fixture paragraphs
      // have the same standard wildcard result as getElementsByTagName.
      parsed.getElementsByTagNameNS=(namespace,name)=>namespace==='*'?parsed.getElementsByTagName(name):query(namespace,name);
      return parsed;
    }
  }
  const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,DOMParser:ReaderDOMParser,HTMLElement:window.HTMLElement,HTMLButtonElement:window.HTMLButtonElement,ResizeObserver:window.ResizeObserver,IntersectionObserver:window.IntersectionObserver,getComputedStyle:window.getComputedStyle.bind(window),innerWidth:1440,requestAnimationFrame:callback=>setTimeout(callback,0),cancelAnimationFrame:id=>clearTimeout(id),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  let root,loadModule;
  t.mock.method(window.HTMLElement.prototype,'scrollIntoView',function(){revealed.push(this.id);});
  t.mock.method(window.HTMLElement.prototype,'scrollTo',function(){revealed.push(this.className);});
  t.after(async()=>{
    if(root)await act(async()=>root.unmount());
    for(const request of pending)if(!request.finished)request.resolve(Response.json({}));
    await Promise.resolve();t.mock.timers.reset();if(loadModule)await loadModule.close();await window.happyDOM.close();
    for(const [key,descriptor] of originals)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
    assert.deepEqual(unexpected,[],'all app requests use isolated public-source fixtures');
  });
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    const url=new URL(input,location.href),route=url.pathname.split('/api/')[1];if(route!=='corpus/search')assert.equal(url.searchParams.get('v'),String(API_VERSION));url.searchParams.delete('v');
    if(route?.startsWith('speech-transcript/')&&!stored)return Response.json({id:route.split('/')[1],available:false});
    if(stored&&route?.startsWith('speech-transcript/'))return new Promise(resolve=>pending.push({route:route+url.search,resolve,finished:false}));
    if(/^(document|speech)\//.test(route))return new Promise(resolve=>pending.push({route:route+url.search,resolve,finished:false}));
    if(route==='directory')return Response.json({day:'2026-10-16',members:[member],committees:[],index:{complete:true,loaded:1,total:1,failed:0,error:null}});
    if(route===`portrait/${member.id}`)return new Response(null,{status:404});
    if(route?.startsWith('latest-activities/'))return Response.json(page(items));
    if(route?.startsWith('speech-statistics/'))return Response.json((typeof summary==='function'?await summary(url):summary)||{memberId:String(member.id),items:[],counts:{groupOrations:0,blueQuestions:0,blueAnswers:0,blueReactions:0},groups:[],coverage:{complete:true,available:0,total:0},nextPage:null,sources:[]});
    if(route==='insights/speech-cloud')return Response.json({scope:{kind:'member',phase:'past'},language:url.searchParams.get('lang'),words:[{word:'fixture',label:'Fixture',speechCount:1,occurrences:1,speechIds:[speechId]}],speeches:[{id:speechId,date:'2026-03-25',title:'Plenary speech fixture',titleLanguage:'en',machineTranslation:false,people:[]}],coverage:{transcripts:1,matchedSpeechRecords:1,missingLanguage:0,unreadableText:0,complete:true,truncated:false,associationUnavailable:false},window:{start:'2026-03-25',end:'2026-03-25'},nextPage:null});
    if(route==='insights/following-status')return Response.json({epoch:'test',generation:1,marksReady:false,indexComplete:false});
    if(route==='insights/saved')return Response.json({members:[],questions:[]});
    if(route?.startsWith('speech-context/'))return Response.json({speechId:route.slice(15),unavailable:true,debates:[]});
    if(route==='corpus/search'){const request=JSON.parse(options.body);searches.push(request);return Response.json({results:[],total:0,offset:0,limit:20,nextOffset:null,truncated:false,coverage:{complete:false}});}
    unexpected.push(url.href);throw new Error('Unexpected fixture request: '+url.href);
  });
  loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
  const {default:App}=await loadModule('/src/App.tsx'),{expireActivityReads}=await loadModule('/src/data.ts');
  const {createRoot}=await import('react-dom/client'),container=document.createElement('div');document.body.append(container);root=createRoot(container);
  // Module loading uses real timers; only mounted application deadlines are advanced.
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(window,'setTimeout',(callback,delay,...args)=>setTimeout(callback,delay,...args));
  t.mock.method(window,'clearTimeout',timer=>clearTimeout(timer));
  const tick=async(ms=350)=>{await act(async()=>{});await act(async()=>{t.mock.timers.tick(ms);});};
  await act(async()=>root.render(createElement(App)));
  const click=node=>{assert(node,'Missing control');return act(async()=>node.click());};
  const finish=(route,data,status=200)=>act(async()=>{
    const request=pending.find(request=>request.route===route&&!request.finished);assert(request,'Missing request: '+route);request.finished=true;request.resolve(Response.json(data,{status}));
  });
  return {window,container,pending,searches,revealed,click,finish,expireActivityReads,tick,wait:()=>tick(350)};
}
const status=reader=>reader.querySelector('[role="status"][aria-live="polite"]');
test('an uncancelled inline draft commits when the controlled window debounce expires',async t=>{
  const h=await harness(t,{module:'speeches',items:[speechItem]});
  const field=h.container.querySelector('.explorer-text-search-inline input');
  await act(async()=>{Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype,'value').set.call(field,'energy');field.dispatchEvent(new h.window.InputEvent('input',{bubbles:true,inputType:'insertText',data:'energy'}));});
  await h.tick(299);assert.equal(h.searches.length,0);
  await h.tick(1);assert.equal(h.searches.length,1);assert.equal(h.searches[0].query,'energy');
  assert.equal(new URLSearchParams(location.search).get('mep-speech-fts-search'),'energy');
});

test('inline full-text results replace the list, combine with exact chair records and clear back to the selected list',async t=>{
  const records=[{id:speechId,date:'2026-03-25',titles:{en:'Chair contribution'},kind:'PLENARY_DEBATE_SPEECH',intervention:{type:'chair',onBehalfOf:[]}},{id:speechId+'2',date:'2026-03-25',titles:{en:'Ordinary speech'},kind:'PLENARY_DEBATE_SPEECH',intervention:{type:'speech',onBehalfOf:[]}}];
  const summary={memberId:String(member.id),items:records,counts:{groupOrations:0,blueQuestions:0,blueAnswers:0,blueReactions:0},groups:[],coverage:{complete:true,available:2,total:2,unclassified:0,issues:[]},nextPage:null,sources:[]};
  const h=await harness(t,{module:'speeches',items:[speechItem],summary,search:'energy'});
  await act(async()=>{});
  assert.equal(h.container.querySelectorAll('article.explorer-speech').length,0);
  assert.match(h.container.querySelector('.explorer-search-count')?.textContent||h.container.textContent,/0 matching documents/);
  assert.equal(h.searches.at(-1).member,member.id);assert.deepEqual(h.searches.at(-1).kinds,['speech']);
  await h.click(h.container.querySelector('a[aria-label^="Chairing contributions:"]'));
  assert.deepEqual(h.searches.at(-1).sourceIds,[speechId]);
  assert.match(h.container.querySelector('#speech-filter-results-'+member.id).textContent,/Chairing contributions · 1 loaded/);
  await h.click(h.container.querySelector('button[aria-label="Clear speech search"]'));
  assert.equal(new URLSearchParams(location.search).has('mep-speech-fts-search'),false);
  assert.equal(h.container.querySelector('.explorer-search-result,.explorer-search-count'),null);
  assert.deepEqual([...h.container.querySelectorAll('article.explorer-speech')].map(row=>row.id),['speech-'+speechId]);
  await h.click([...h.container.querySelectorAll('button')].find(node=>node.textContent==='Clear filter'));
  assert.equal(new URLSearchParams(location.search).has('mep-speech-category'),false);
  assert.equal(h.container.querySelectorAll('article.explorer-speech').length,1);
  await act(async()=>{const url=new URL(location.href);url.searchParams.set('mep-speech-fts-search','energy');history.replaceState(null,'',url);window.dispatchEvent(new h.window.PopStateEvent('popstate'));});
  assert.equal(h.container.querySelectorAll('article.explorer-speech').length,0);
  await h.click(h.container.querySelector('.explorer-cloud-words button'));
  await h.tick(0);
  const cloudSource=h.container.querySelector('.explorer-cloud-source');cloudSource.focus();
  const reveals=h.revealed.length;
  const committedSearches=h.searches.length;
  await h.click(cloudSource);
  assert.equal(h.searches.length,committedSearches,'cloud navigation must not fetch the old committed query');
  assert.equal(new URLSearchParams(location.search).has('mep-speech-fts-search'),false);
  assert.equal(h.container.querySelector('.explorer-speech-toggle').getAttribute('aria-expanded'),'true','cloud selection reveals its exact reader after leaving search');
  assert.equal(document.activeElement,h.container.querySelector('.explorer-speech-toggle'));
  assert(h.revealed.length>reveals,'the newly mounted reader is revealed');
  await act(async()=>{const url=new URL(location.href);url.searchParams.set('mep-speech-fts-search','energy');history.replaceState(null,'',url);window.dispatchEvent(new h.window.PopStateEvent('popstate'));});
  cloudSource.focus();await h.click(cloudSource);
  assert.equal(document.activeElement,h.container.querySelector('.explorer-speech-toggle'),'selecting the same reader again creates a fresh focus intent');
  const searchField=h.container.querySelector('.explorer-text-search-inline input');
  await act(async()=>{Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype,'value').set.call(searchField,'uncommitted draft');searchField.dispatchEvent(new h.window.InputEvent('input',{bubbles:true,inputType:'insertText',data:'uncommitted draft'}));});
  const searches=h.searches.length;
  cloudSource.focus();await h.click(cloudSource);
  await h.tick(1000);
  assert.equal(new URLSearchParams(location.search).has('mep-speech-fts-search'),false,'cloud navigation cancels the uncommitted draft');
  assert.equal(h.container.querySelector('.explorer-text-search-inline input').value,'');
  assert.equal(h.searches.length,searches,'the cancelled debounce cannot restart search');
  assert.equal(document.activeElement===h.container.querySelector('.explorer-speech-toggle'),true);
});

for(const outcome of ['unavailable','empty'])test('category transcript search distinguishes pending metadata from '+outcome,async t=>{
  let resolve,reject;
  const summary=()=>new Promise((yes,no)=>{resolve=yes;reject=no;});
  const h=await harness(t,{module:'speeches',items:[speechItem],summary,category:'chair',search:'energy'});
  assert.equal(h.searches.length,0);
  assert.match(h.container.querySelector('.explorer-text-search-inline').textContent,/Loading category…/);
  assert.equal(h.container.querySelector('.explorer-search-count'),null);
  await act(async()=>{if(outcome==='unavailable')reject(new Error('Statistics fixture unavailable.'));else resolve({memberId:String(member.id),items:[],counts:{groupOrations:0,blueQuestions:0,blueAnswers:0,blueReactions:0},groups:[],coverage:{complete:true,available:0,total:0,unclassified:0,issues:[]},nextPage:null,sources:[]});});
  if(outcome==='unavailable'){
    assert.equal(h.searches.length,0);
    assert.match(h.container.querySelector('.explorer-text-search-inline').textContent,/Category unavailable\./);
    assert.equal(h.container.querySelector('.explorer-search-count'),null);
  }else{
    assert.equal(h.searches.length,1);assert.deepEqual(h.searches[0].sourceIds,[]);
    assert.match(h.container.querySelector('.explorer-search-count').textContent,/0 matching documents/);
  }
  const clear=[...h.container.querySelectorAll('button')].find(node=>node.textContent==='Clear category');clear.focus();
  await h.click(clear);
  assert.equal(document.activeElement,h.container.querySelector('.explorer-text-search-inline input'));
  assert.equal(new URLSearchParams(location.search).has('mep-speech-category'),false);
});

test('a statistics restart clamps a filtered page when fewer matching records remain',async t=>{
  const records=Array.from({length:25},(_,index)=>({id:`MTG-PL-2026-03-25-OTH-${100+index}`,date:'2026-03-25',start:null,end:null,titles:{en:'Written contribution '+index},kind:'PLENARY_DEBATE_WRITTEN_STATEMENT',intervention:{type:'written',onBehalfOf:[]}}));
  const result=items=>({memberId:String(member.id),items,counts:{groupOrations:0,blueQuestions:0,blueAnswers:0,blueReactions:0},groups:[],coverage:{complete:false,available:items.length,total:25,unclassified:0,issues:[]},nextPage:null,sources:[]});
  let finish;
  const h=await harness(t,{module:'speeches',items:[speechItem],summary:url=>url.searchParams.get('page')==='0'?{...result(records),nextPage:1}:new Promise(resolve=>finish=resolve)});
  await h.click(h.container.querySelector('a[aria-label^="Written statements:"]'));
  const older=()=>[...h.container.querySelectorAll('button')].find(node=>node.textContent==='Older');
  await h.click(older());await h.click(older());
  assert.equal(h.container.querySelector('article.explorer-speech').id,'speech-'+records[20].id);
  await act(async()=>finish({...result(records.slice(0,5)),restarted:true}));
  assert.match(h.container.querySelector('#speech-filter-results-'+member.id).textContent,/5 loaded/);
  assert.equal(h.container.querySelectorAll('article.explorer-speech').length,5);
  assert.equal(h.container.querySelector('article.explorer-speech').id,'speech-'+records[0].id);
  assert.equal(older(),undefined);
});
test('summary links filter all loaded records, paginate, preserve the reader category and clear back to the indexed list',async t=>{
  const types=['speech','blue-card-question','blue-card-intervention','blue-card-answer','blue-card-reaction','blue-card','unclassified'];
  const records=Array.from({length:22},(_,index)=>({id:`MTG-PL-2026-03-25-OTH-${100+index}`,date:'2026-03-25',start:null,end:null,titles:{en:'Contribution '+index},kind:index>=7?'PLENARY_DEBATE_WRITTEN_STATEMENT':'PLENARY_DEBATE_SPEECH',intervention:{type:index>=7?'written':types[index],onBehalfOf:index===0?[{id:'EPP',uri:'org/EPP',label:'EPP',politicalGroup:true}]:[]}}));
  const summary={memberId:String(member.id),items:records,counts:{groupOrations:1,blueQuestions:2,blueAnswers:1,blueReactions:1},groups:[],coverage:{complete:false,available:22,total:22,unclassified:2,issues:['retained-corpus']},nextPage:null,sources:[]};
  const h=await harness(t,{module:'speeches',items:[speechItem],summary});
  const link=label=>[...h.container.querySelectorAll('.intervention-stats-grid a')].find(node=>node.getAttribute('aria-label').startsWith(label+':'));
  const ids=()=>[...h.container.querySelectorAll('article.explorer-speech')].map(node=>node.id);
  assert.equal(ids().length,1);
  assert.match(link('Written statements').href,/mep-speech-category=written/);
  await h.click(link('Written statements'));
  assert.equal(new URLSearchParams(location.search).get('mep-speech-category'),'written');
  assert.equal(ids().length,10);assert.equal(ids()[0],'speech-'+records[7].id);
  assert.match(h.container.querySelector('#speech-filter-results-'+member.id).textContent,/Written statements · 15 loaded/);
  assert.equal(document.activeElement.id,'speech-filter-results-'+member.id);
  await h.click([...h.container.querySelectorAll('button')].find(node=>node.textContent==='Older'));
  assert.equal(ids().length,5);assert.equal(ids()[0],'speech-'+records[17].id);
  await h.click(h.container.querySelector('.explorer-speech-toggle'));
  assert.equal(new URLSearchParams(location.search).get('speech'),records[17].id);
  assert.equal(new URLSearchParams(location.search).get('mep-speech-category'),'written');
  for(const [label,expected] of [['Blue cards raised',[1,2]],['Blue cards answered',[3]],['Blue-card reactions',[4]],['On behalf of a group',[0]]]){
    await h.click(link(label));assert.deepEqual(ids(),expected.map(index=>'speech-'+records[index].id));
  }
  await h.click(link('Total contributions'));assert.equal(ids().length,10);
  await h.click([...h.container.querySelectorAll('button')].find(node=>node.textContent==='Clear filter'));
  assert.equal(new URLSearchParams(location.search).has('mep-speech-category'),false);
  assert.deepEqual(ids(),['speech-'+speechId]);
});

test('a shared summary category restores directly and unknown counts remain unavailable',async t=>{
  const summary={memberId:String(member.id),items:[],counts:{groupOrations:null,blueQuestions:null,blueAnswers:null,blueReactions:null},groups:[],coverage:{complete:false,available:0,total:null,unclassified:0,issues:['retained-corpus']},nextPage:null,sources:[]};
  const h=await harness(t,{module:'speeches',items:[speechItem],summary,category:'blueAnswers'});
  assert.match(h.container.textContent,/No matching contributions\./);
  assert.equal(h.container.querySelectorAll('.intervention-stats-grid a').length,1,'only the known total has a filter link');
  assert.equal(h.container.querySelectorAll('article.explorer-speech').length,0);
  await act(async()=>{const url=new URL(location.href);url.searchParams.set('mep-speech-category','written');history.replaceState(null,'',url);window.dispatchEvent(new h.window.PopStateEvent('popstate'));});
  assert.match(h.container.querySelector('#speech-filter-results-'+member.id).textContent,/Written statements/);
});

function assertOrdinaryText(reader) {
  const transcript=reader.querySelector('.explorer-transcript');assert(transcript,'the full reader text is rendered');
  assert.equal(transcript.textContent,paragraphs.join(''));
  assert.equal(transcript.closest('[aria-live],[role="status"],[role="alert"]'),null,'no enclosing live region may absorb the reader');
  for(const region of document.querySelectorAll('[aria-live],[role="status"],[role="alert"]'))for(const paragraph of paragraphs)assert(!region.textContent.includes(paragraph));
}
function assertNoDownloads(reader) {
  assert.equal(reader.querySelector('.explorer-reader-download'),null);
  assert.equal(reader.querySelector('.explorer-publication-files'),null);
}

test('selected written question keeps full text without repeated source downloads while announcing settled, unavailable and refresh-error outcomes',async t=>{
  const h=await harness(t),toggle=h.container.querySelector('.explorer-speech-toggle');toggle.focus();await h.click(toggle);
  const reader=h.container.querySelector('.explorer-document-text'),announcement=status(reader);
  assert.equal(announcement.textContent,'');
  await h.finish(`document/${questionId}?member=${member.id}&lang=en`,documentResult());await h.wait();
  assert.equal(status(reader),announcement);assert.equal(announcement.textContent,'Question: Text loaded.');
  assertOrdinaryText(reader);assertNoDownloads(reader);assert.equal(document.activeElement,toggle);

  // A later source check expires document reads. Reopening revalidates the
  // cached text, which must survive a failed refresh together with its files.
  h.expireActivityReads();await h.click(toggle);await h.click(toggle);
  const refreshed=h.container.querySelector('.explorer-document-text');assertOrdinaryText(refreshed);
  await h.finish(`document/${questionId}?member=${member.id}&lang=en`,{error:{message:'Document fixture temporarily unavailable.'}},503);await h.wait();
  assert.equal(status(refreshed).textContent,'Question: Text temporarily unavailable.');assertOrdinaryText(refreshed);assertNoDownloads(refreshed);
  assert.equal(refreshed.querySelectorAll('[role="status"],[role="alert"]').length,1,'the reader error has one narrow announcement');
  const language=refreshed.querySelector('select[aria-label="Text language"]');
  await act(async()=>{language.value='fr';language.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
  await h.finish(`document/${questionId}?member=${member.id}&lang=fr`,documentResult('fr',false));await h.wait();
  assert.equal(status(refreshed).textContent,'Question: Text unavailable.');assert.match(refreshed.textContent,/Text unavailable\./);assertNoDownloads(refreshed);
  assert.equal(document.activeElement,toggle,'reader outcomes must not move focus from the activity control');
});

test('member reader uses exact structured ECR instead of the conflicting Bulgarian source-role translation',async t=>{
  const h=await harness(t,{module:'speeches',language:'bg',items:[speechItem]});
  await h.click(h.container.querySelector('.explorer-speech-toggle'));
  const person={id:'256986',name:'Geadis Geadi',roleLabels:{en:{text:'on behalf of the Group',language:'en'},bg:{text:'от името на групата Verts/ALE',language:'bg'}}};
  const intervention={type:'speech',speaker:person,onBehalfOf:[{id:'ECR',uri:'org/ECR',label:'ECR',politicalGroup:true,source:'participation_in_name_of'}]};
  await h.finish(`speech/${speechId}?lang=bg`,{id:speechId,speakers:[person],intervention,xml:'<speech><p>Exact source body.</p></speech>',textLanguage:'bg',translationType:'machine'});
  const reader=h.container.querySelector('.explorer-speech-detail');
  assert.equal(reader.querySelector('strong').textContent,'Geadis Geadi');
  assert(!reader.querySelector('.insight-secondary'),'raw translated role must not contradict the exact group badge');
  assert.equal(reader.querySelector('.intervention-group').textContent,'On behalf of ECR');
  assert(!reader.textContent.includes('Verts/ALE'));
  assert(reader.textContent.includes('Exact source body.'));
});

test('member cloud opens the chosen transcript while names and chair roles retain the interface language',async t=>{
  for(const [language,transcript] of [['bg','en'],['en','el']])await t.test(language+'/'+transcript,async t=>{
    const h=await harness(t,{module:'speeches',language,items:[speechItem]});
    if(transcript!=='en')await act(async()=>{const select=h.container.querySelector('.explorer-cloud-controls select');select.value=transcript;select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
    await h.click(h.container.querySelector('.explorer-cloud-words button'));
    await h.click(h.container.querySelector('.explorer-cloud-source'));
    const person={id:'34232',name:'Kristian Vigenin',sittingRole:'chair',office:{code:'vice-president-parliament'},nameVariants:[{value:'Kristian Vigenin',script:'Latn',language:null,source:'fixture'},{value:'Кристиан Вигенин',script:'Cyrl',language:null,source:'fixture'}]};
    await h.finish(`speech/${speechId}?lang=${transcript}`,{id:speechId,speakers:[person],intervention:{type:'chair',onBehalfOf:[]},xml:'<speech><p>Fixture transcript.</p></speech>',textLanguage:transcript,translationType:'original'});
    const reader=h.container.querySelector('.explorer-speech-detail');
    assert.equal(reader.querySelector('.explorer-transcript').lang,transcript);
    assert.equal(reader.querySelector('strong').textContent,language==='bg'?'Кристиан Вигенин':'Kristian Vigenin');
    const roles=[...reader.querySelectorAll('.insight-secondary span')];assert(roles.length===2);
    assert(roles.every(role=>role.lang===language));
    assert.equal(roles[0].textContent,language==='bg'?'Заместник-председател на Европейския парламент':'Vice-President of the European Parliament');
  });
});

test('selected root speech announces an error once, retries successfully, and preserves transcript and player controls',async t=>{
  const h=await harness(t,{items:[speechItem]}),toggle=h.container.querySelector('.explorer-speech-toggle');toggle.focus();await h.click(toggle);
  const reader=h.container.querySelector('.explorer-speech-detail'),source=speechItem.websiteUrl;
  const video=reader.querySelector('.explorer-speech-transcript-heading .explorer-video-toggle');assert(video);
  const panel=document.getElementById(video.getAttribute('aria-controls'));assert(panel.hidden);assert(panel.previousElementSibling.classList.contains('explorer-speech-transcript-heading'));
  await h.finish(`speech/${speechId}?lang=en`,{error:{message:'Speech fixture temporarily unavailable.'}},503);await h.wait();
  assert.equal(status(reader).textContent,'','the existing error alert is not repeated through the status region');
  assert.equal(reader.querySelectorAll('[role="alert"]').length,1);assert.match(reader.querySelector('[role="alert"]').textContent,/Speech fixture temporarily unavailable\./);
  assert.equal([...reader.querySelectorAll('a[href]')].some(link=>link.href===source),false);assert([...reader.querySelectorAll('button')].some(button=>button.textContent==='Video'));
  assert.equal(document.activeElement,toggle);
  await h.click([...reader.querySelectorAll('button')].find(button=>button.textContent==='Try again'));
  await h.finish(`speech/${speechId}?lang=en`,{id:speechId,xml:'<speech>'+paragraphs.map(text=>'<p>'+text+'</p>').join('')+'</speech>',textLanguage:'en',translationType:'original'});await h.wait();
  assert.equal(status(reader).textContent,'Transcript loaded.');assert.equal(reader.querySelector('[role="alert"]'),null);assertOrdinaryText(reader);
  assert.equal([...reader.querySelectorAll('a[href]')].some(link=>link.href===source),false);assert([...reader.querySelectorAll('button')].some(button=>button.textContent==='Video'));
});

test('retained transcript renders before metadata and survives a failed metadata load without replacing the text',async t=>{
  const h=await harness(t,{items:[speechItem],stored:true});
  await h.click(h.container.querySelector('.explorer-speech-toggle'));
  const reader=h.container.querySelector('.explorer-speech-detail');
  const xml='<speech><p>Retained <inline name="i">editorial note</inline> and readable speech.</p></speech>';
  await h.finish(`speech-transcript/${speechId}?lang=en`,{id:speechId,available:true,xml,textLanguage:'en',translationType:'machine',sourceFragmentKey:'en',availableTextLanguages:['en','fr']});
  await h.wait();
  const text=reader.querySelector('.explorer-transcript');assert(text);
  assert.equal(text.lang,'en');assert.equal(text.querySelector('i').textContent,'editorial note');
  assert.match(reader.querySelector('.explorer-text-meta').textContent,/Machine translation/);
  assert.equal(status(reader).textContent,'Transcript loaded.');
  assert(reader.querySelector('[aria-label="Find in speech"]'));
  assert(h.pending.some(request=>request.route===`speech/${speechId}?lang=en`&&!request.finished),'metadata is still pending');
  await h.finish(`speech/${speechId}?lang=en`,{error:{message:'Metadata fixture unavailable.'}},503);
  assert.equal(reader.querySelector('.explorer-transcript'),text);
  assert.equal(reader.querySelector('[role="alert"]'),null);
  assert.equal(status(reader).textContent,'Transcript loaded.');
});

test('late metadata does not overwrite the corpus variant or replace its DOM',async t=>{
  const h=await harness(t,{items:[speechItem],stored:true});
  await h.click(h.container.querySelector('.explorer-speech-toggle'));
  const reader=h.container.querySelector('.explorer-speech-detail');
  await h.finish(`speech-transcript/${speechId}?lang=en`,{id:speechId,available:true,xml:'<speech><p>Retained variant.</p></speech>',textLanguage:'en',translationType:'original'});
  const text=reader.querySelector('.explorer-transcript');
  await h.finish(`speech/${speechId}?lang=en`,{id:speechId,xml:'<speech><p>Other detail variant.</p></speech>',textLanguage:'fr',speakers:[{id:'42',name:'Exact speaker'}]});
  assert.equal(reader.querySelector('.explorer-transcript'),text);
  assert.equal(text.textContent,'Retained variant.');assert.equal(text.lang,'en');
  assert.equal(reader.querySelector('strong').textContent,'Exact speaker');
});

test('complete retained speech metadata renders without a foreground speech-detail request',async t=>{
  const h=await harness(t,{items:[speechItem],stored:true});
  await h.click(h.container.querySelector('.explorer-speech-toggle'));
  assert(!h.pending.some(request=>request.route.startsWith('speech/')),'the corpus is checked first');
  await h.finish(`speech-transcript/${speechId}?lang=en`,{id:speechId,available:true,xml:'<speech><p>Complete retained speech.</p></speech>',textLanguage:'en',translationType:'original',availableTextLanguages:['en'],
    metadata:{id:speechId,xml:null,speakers:[{id:'42',name:'Retained speaker'}],intervention:{type:'speech',onBehalfOf:[]},availableTextLanguages:['en']}});
  await h.wait();
  const reader=h.container.querySelector('.explorer-speech-detail');
  assert.equal(reader.querySelector('strong').textContent,'Retained speaker');
  assert.equal(reader.querySelector('.explorer-transcript').textContent,'Complete retained speech.');
  assert.equal(status(reader).textContent,'Transcript loaded.');
  assert(!h.pending.some(request=>request.route.startsWith('speech/')),'a complete corpus hit needs no detail fetch');
});

test('an explicitly checked linked activity keeps its nested document outside the fallback announcement',async t=>{
  const h=await harness(t,{items:[],activity:questionId}),fallback=h.container.querySelector('aside.explorer-notice');assert(fallback);
  assert.equal(h.pending.length,0,'a linked source is checked only after the explicit action');
  await h.click([...fallback.querySelectorAll('button')].find(button=>button.textContent==='Look it up'));
  await h.finish(`document/${questionId}?member=${member.id}&lang=en`,documentResult());await h.wait();
  const reader=fallback.querySelector('.explorer-document-text');assert(reader);assertOrdinaryText(reader);assertNoDownloads(reader);
  const fallbackStatus=[...fallback.children].find(node=>node.matches('[role="status"]'));
  assert.equal(fallbackStatus.textContent,'Linked item loaded.');assert.equal(status(reader).textContent,'Question: Text loaded.');
  assert.equal(h.pending.length,1,'the nested reader reuses the completed exact-source request');
});

test('member transcript preserves editorial italics in place without importing source attributes',async t=>{
  const h=await harness(t,{module:'speeches',items:[speechItem]});
  await h.click(h.container.querySelector('.explorer-speech-toggle'));
  const xml='<speech xml:lang="en"><p>Before the video.</p><p><inline name="i" style="display:none" onclick="alert(1)">(A video was played in the Chamber)</inline></p><p>After <inline name="i">(Applause)</inline> we continue (spoken aside).</p><p>&lt;script&gt;literal text&lt;/script&gt;</p></speech>';
  await h.finish(`speech/${speechId}?lang=en`,{id:speechId,speakers:[],xml,textLanguage:'en',translationType:'original'});
  const body=h.container.querySelector('.explorer-transcript');
  assert.deepEqual([...body.querySelectorAll('p')].map(node=>node.textContent),['Before the video.','(A video was played in the Chamber)','After (Applause) we continue (spoken aside).','<script>literal text</script>']);
  assert.deepEqual([...body.querySelectorAll('i')].map(node=>node.textContent),['(A video was played in the Chamber)','(Applause)']);
  assert.equal(body.querySelector('script,[style],[onclick],inline'),null);
});


test('member question retries the selected source language locally and keeps saved text through repeated failure',async t=>{
  const h=await harness(t),toggle=h.container.querySelector('.explorer-speech-toggle');await h.click(toggle);
  const route=`document/${questionId}?member=${member.id}&lang=fr`;
  await h.finish(`document/${questionId}?member=${member.id}&lang=en`,documentResult());
  const reader=h.container.querySelector('.explorer-document-text'),select=reader.querySelector('select');
  await act(async()=>{select.value='fr';select.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
  await h.finish(route,documentResult('fr'));
  h.expireActivityReads();await h.click(toggle);await h.click(toggle);
  // Reopening resets the reader to the interface language; choose the same source variant.
  const reopened=h.container.querySelector('.explorer-document-text'),picker=reopened.querySelector('select');
  await act(async()=>{picker.value='fr';picker.dispatchEvent(new h.window.Event('change',{bubbles:true}));});
  const text=reopened.querySelector('.explorer-transcript'),source=reopened.querySelector('.explorer-reader-download');
  await h.finish(route,{error:{code:'upstream_busy',message:'Busy.'}},503);
  assert(!reopened.textContent.includes('No answer published.'));assertOrdinaryText(reopened);
  const retry=reopened.querySelector('.reader-retry button');assert(retry);const heading=reopened.querySelector('h3');
  await act(async()=>{retry.focus();retry.click();retry.click();});
  assert.equal(document.activeElement,heading);assert.equal(reopened.querySelector('.explorer-transcript'),text);assert.equal(reopened.querySelector('.explorer-reader-download'),source);
  assert.equal(h.pending.filter(request=>request.route===route).length,3,'initial read, failed refresh and exactly one retry');
  await h.finish(route,{error:{message:'Still busy.'}},503);assert.equal(reopened.querySelector('.explorer-transcript'),text);assert(reopened.querySelector('.reader-retry button'));
  await h.click(reopened.querySelector('.reader-retry button'));await h.finish(route,documentResult('fr'));await h.wait();
  assert.equal(reopened.querySelector('.reader-retry'),null);assert.equal(reopened.querySelector('.explorer-transcript').lang,'fr');assertOrdinaryText(reopened);assertNoDownloads(reopened);
  assert.equal(document.activeElement,heading);assert.equal(status(reopened).textContent,'Question: Text loaded.');
});

test('main speech reader retains the translation return control through an unavailable original',async t=>{
  const h=await harness(t,{module:'speeches',items:[speechItem]});
  await h.click(h.container.querySelector('.explorer-speech-toggle'));
  const translated={id:speechId,xml:'<speech xml:lang="fr-t-en-mtec"><p>Exact English translation.</p></speech>',textLanguage:'en',translationType:'machine'};
  await h.finish(`speech/${speechId}?lang=en`,translated);await h.wait();
  const reader=h.container.querySelector('.explorer-speech-detail');
  const button=label=>[...reader.querySelectorAll('button')].find(node=>node.textContent===label);
  await h.click(button('Show original (French)'));await h.wait();
  assert(button('Show translation (English)'),'return control remains available during loading');
  await h.finish(`speech/${speechId}?lang=fr`,translated);await h.wait();
  assert(reader.textContent.includes('Original text unavailable.'));
  assert.equal(reader.querySelector('.explorer-transcript'),null);
  await h.click(button('Show translation (English)'));await h.wait();
  assert.equal(reader.querySelector('.explorer-transcript').textContent,'Exact English translation.');
});
