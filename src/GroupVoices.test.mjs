import {viewReady} from './test-support/viewReady.mjs';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {ActivityStore} from '../server/activity-index-store.mjs';
import {ActivityWorker} from '../server/activity-index-worker.mjs';
import {initializeGroupVoices,recordGroupVoice,groupVoicesPage} from '../server/group-voices-store.mjs';
import {groupVoicesQuery,GROUP_VOICE_LIMITS,groupVoiceProjection} from '../server/group-voices-model.mjs';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {Window} from 'happy-dom';
import {sourceAvailability} from '../server/source-availability.mjs';
import {freshLoader} from './test-support/viteRunner.mjs';
const basePeople=[{id:'42',name:'Éva Example',total:3,subjects:{foreign:2,climate:1}},...Array.from({length:22},(_,i)=>({id:String(100+i),name:'Speaker '+String(i+1).padStart(2,'0'),total:1,subjects:{foreign:1}}))];
const coverage={initialized:true,observedOralRecords:25,pending:0,truncated:false,note:'Available recorded designations · partial coverage'};
async function harness(t,query='?view=groups&gv-group=PPE&gv-tab=people',{websiteUrl=true,stored=true,response={}}={}){
 const window=new Window({url:'http://localhost/'+query,settings:{disableIframePageLoading:true,disableCSSFileLoading:true}});
 class ReaderDOMParser extends window.DOMParser {
  parseFromString(...args){const parsed=super.parseFromString(...args),query=parsed.getElementsByTagNameNS.bind(parsed);parsed.getElementsByTagNameNS=(namespace,name)=>namespace==='*'?parsed.getElementsByTagName(name):query(namespace,name);return parsed;}
 }
 const globals={window,document:window.document,location:window.location,history:window.history,Event:window.Event,PopStateEvent:window.PopStateEvent,DOMParser:ReaderDOMParser,HTMLElement:window.HTMLElement,ResizeObserver:class {observe(){} disconnect(){}},IntersectionObserver:class {observe(){} disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true};
 const originals=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLElement.prototype.scrollTo=function(){};
 let loadModule,root,fail=false,deferPerson=false;const calls=[],delays=[],personResponses=[];
 t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input,location.href);if(url.pathname.startsWith('/api/portrait/'))return new Response(null,{status:404});if(url.pathname==='/api/insights/record-topics')return Response.json({ready:false});calls.push(url);
  const speechRoute=url.pathname.match(/^\/api\/(speech-transcript|speech|speech-context)\/(MTG-PL-2026-10-06-OTH-\d+)$/);
  if(speechRoute){
   const [,route,id]=speechRoute,language=url.searchParams.get('lang'),speech={id,date:'2026-10-06',start:null,end:null,kind:'PLENARY_DEBATE_SPEECH',titles:{en:'Exact contribution'},participants:[id.split('-').at(-1)],speakers:[],websiteUrl:websiteUrl?'https://www.europarl.europa.eu/doceo/document/'+id+'_EN.html':null,websiteLanguage:'en',xml:'<speech><p>Exact inline transcript for '+id+'</p></speech>',textLanguage:language,availableTextLanguages:[language],translationType:'original'};
   if(route==='speech-context')return Response.json({speechId:id,unavailable:true,debates:[]});
   if(route==='speech-transcript')return Response.json(stored?{...speech,available:true,metadata:speech}:{id,available:false});
   return Response.json(speech);
  }
  assert.equal(url.pathname,'/api/insights/group-voices','No directory, corpus or upstream fetch is needed.');
  if(fail)return Response.json({error:{message:'Unavailable'}},{status:503});
  if(url.searchParams.get('group')==='RENEW')return new Promise(resolve=>delays.push(resolve));
  const people=url.searchParams.get('group')==='ESN'?[{id:'7',name:'Zero Example',total:1,subjects:{climate:1}}]:basePeople,selected=people.filter(p=>!url.searchParams.get('person')||url.searchParams.get('person')===p.id),subject=url.searchParams.get('subject'),total=selected.reduce((n,p)=>n+(subject?p.subjects[subject]||0:p.total),0);
  const result={availability:sourceAvailability({sourceKey:'oral-speeches',start:'2024-07-16',end:'2026-10-17',latestObservedDate:'2026-10-18',today:'2026-10-24'}),people,months:['2026-10','2026-09'],window:{from:'2024-07-16',to:'2026-10-17'},contributions:selected.slice(0,20).map(p=>({id:'MTG-PL-2026-10-06-OTH-'+p.id,personId:p.id,date:'2026-10-06',subject:subject||'foreign',title:'Exact contribution '+p.id,titleLanguage:'en',websiteUrl:websiteUrl?'https://www.europarl.europa.eu/doceo/document/CRE-10-2026-10-06-OTH-'+p.id+'_EN.html':null})),total,nextOffset:null,coverage,groupSubjects:[{id:'PPE',total:12,subjects:{foreign:6,climate:2,unclassified:4}},{id:'ECR',total:5,subjects:{foreign:1,unclassified:1}},{id:'ESN',total:3,subjects:{unclassified:3}}]};
  if(deferPerson&&url.searchParams.has('person'))return new Promise(resolve=>personResponses.push(()=>resolve(Response.json(result))));
  return Response.json({...result,...response});
 });
 loadModule=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}});
 const {default:App}=await loadModule('/src/App.tsx'),{createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);root=createRoot(container);
 t.after(async()=>{await act(async()=>root.unmount());delays.forEach(resolve=>resolve(Response.json({people:[],months:[],coverage,window:{}})));await loadModule.close();await window.happyDOM.close();for(const [key,d] of originals)d?Object.defineProperty(globalThis,key,d):delete globalThis[key];});
 await act(async()=>root.render(createElement(App)));await viewReady(container);
 const click=async node=>{await act(async()=>{assert(node);node.focus();node.click();});await viewReady(container);};
 const restore=url=>act(async()=>{history.replaceState(null,'',url);window.dispatchEvent(new window.PopStateEvent('popstate'));});
 const input=async text=>act(async()=>{const field=container.querySelector('.gv-search input');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(field,text);field.dispatchEvent(new window.InputEvent('input',{bubbles:true,data:text,inputType:'insertText'}));});
 return {window,container,calls,click,restore,input,fail:()=>{fail=true;},delays,deferPerson:()=>{deferPerson=true;},finishPerson:()=>act(async()=>{personResponses.splice(0).forEach(resolve=>resolve());})};
}
test('integrated group navigation preserves the independent People selector, exact subject counts and Back state',async t=>{
 const h=await harness(t),name=()=>h.container.querySelector('[data-gv-person="42"]'),first=name();
 assert.equal(h.container.querySelectorAll('.gv-person').length,15);assert.match(h.container.textContent,/Foreign affairs 2/);
 await h.click(first);assert.equal(new URLSearchParams(location.search).get('gv-person'),'42');assert.equal(h.container.querySelectorAll('.gv-person').length,15);assert.equal(document.activeElement,first);assert.equal(name(),first);
 await h.click(h.container.querySelector('.gv-person.is-selected .gv-person-subjects button'));assert.match(h.container.querySelector('.gv-person.is-selected').textContent,/2Also this period: Climate & energy 1/);assert.match(h.container.querySelector('.gv-summary').textContent,/2recorded oral contributions1speaker1subject/);
 await h.click(name());assert.equal(new URLSearchParams(location.search).get('gv-person'),null);assert.equal(new URLSearchParams(location.search).get('gv-subject'),'foreign');
 await h.click(name());await h.click(h.container.querySelector('.gv-jump'));assert.equal(document.activeElement,h.container.querySelector('.gv-contributions h2'));assert.equal(location.hash,'');
 const before=location.href;await h.click(name());await act(async()=>{const popped=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history.back();await popped;});assert.equal(location.href,before);assert.equal(new URLSearchParams(location.search).get('gv-person'),'42');
 assert.equal(h.container.querySelector('[role="dialog"]'),null);
});
test('contribution titles open the exact speech inline without leaving group filters',async t=>{
 for(const tab of ['people','subjects'])for(const websiteUrl of [true,false])await t.test(`${tab}, source URL ${websiteUrl}`,async t=>{
  const h=await harness(t,`?view=groups&lang=fr&gv-group=PPE&gv-tab=${tab}&gv-subject=foreign`,{websiteUrl,stored:websiteUrl}),id='MTG-PL-2026-10-06-OTH-42',url=location.href;
  const button=h.container.querySelector('.gv-contribution-title');
  assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(button.querySelector('[lang]').lang,'en');
  assert.equal(h.container.querySelector('.insight-inline-reader'),null);assert(!h.calls.some(url=>url.pathname.startsWith('/api/speech')));
  await h.click(button);
  assert.equal(location.href,url);assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(document.activeElement,button);
  const panel=document.getElementById(button.getAttribute('aria-controls'));
  assert.match(panel.querySelector('.insight-reader-text').textContent,new RegExp('Exact inline transcript for '+id));
  assert(h.calls.some(url=>url.pathname===`/api/speech-transcript/${id}`&&url.searchParams.get('lang')==='fr'));
  assert.equal(h.calls.some(url=>url.pathname===`/api/speech/${id}`),!websiteUrl,'Only an unavailable saved transcript needs the speech fallback.');
  assert.equal(panel.querySelector('a.insight-source-document'),null);
  await h.click(button);assert.equal(h.container.querySelector('.insight-inline-reader'),null);assert.equal(document.activeElement,button);assert.equal(button.getAttribute('aria-expanded'),'false');
  await h.click(button);assert.match(h.container.querySelector('.insight-reader-text').textContent,new RegExp(id));
  await h.restore(`/?view=groups&lang=fr&gv-group=ESN&gv-tab=${tab}&gv-subject=foreign`);assert.equal(h.container.querySelector('.insight-inline-reader'),null);assert.equal(location.search.includes('gv-group=ESN'),true);
 });
});
test('search typing is one undo step; selected rows past 15 remain visible without expanding the saved limit',async t=>{
 const h=await harness(t,'?view=groups&gv-tab=people&gv-person=121');assert.equal(h.container.querySelectorAll('.gv-person').length,23);assert.equal(new URLSearchParams(location.search).has('gv-people-limit'),false);
 await h.click(h.container.querySelector('[data-gv-person="121"]'));assert.equal(h.container.querySelectorAll('.gv-person').length,15);
 const length=history.length;await h.input('É');await h.input('Éva');assert.equal(history.length,length+1);assert.equal(h.container.querySelectorAll('.gv-person').length,1);
 await act(async()=>{const popped=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));history.back();await popped;});assert.equal(h.container.querySelector('.gv-search input').value,'');assert.equal(h.container.querySelectorAll('.gv-person').length,15);
 await h.restore('/?view=groups&gv-tab=time&gv-person=42&gv-subject=climate');assert.equal(h.container.querySelector('.gv-tabs [aria-pressed=true]').textContent,'Topics');assert.match(h.container.querySelector('.gv-subjects').textContent,/Climate & energy/);assert.equal(h.container.querySelector('.gv-person'),null);
});
test('changing scope with delayed or failed data hides previous results and ignores late responses',async t=>{
 const h=await harness(t);const select=h.container.querySelector('.gv-controls select');
 await act(async()=>{select.value='RENEW';select.dispatchEvent(new window.Event('change',{bubbles:true}));});assert.equal(h.container.querySelector('.gv-person'),null);assert.equal(h.container.querySelector('.gv-contributions article'),null);
 h.fail();await h.restore('/?view=groups&gv-group=ECR&gv-tab=people');assert(h.container.querySelector('[role=alert]'));assert.equal(h.container.querySelector('.gv-person'),null);
 await act(async()=>{h.delays.forEach(resolve=>resolve(Response.json({people:basePeople,months:[],coverage,window:{}})));});assert.equal(new URLSearchParams(location.search).get('gv-group'),'ECR');assert.equal(h.container.querySelector('.gv-person'),null);
});

test('person toggles from Contributions retain their local focus while the filtered page loads',async t=>{
 for(const tab of ['subjects','people'])await t.test(tab,async t=>{
  const h=await harness(t,'?view=groups&gv-tab='+tab),button=h.container.querySelector('.gv-contribution-person'),key=button.dataset.gvContribution;
  h.deferPerson();await h.click(button);assert.equal(document.activeElement,h.container.querySelector('.gv-contributions h2'));assert.equal(h.container.querySelector('.gv-contribution-person'),null);
  await h.finishPerson();const restored=h.container.querySelector('[data-gv-contribution="'+key+'"]');assert.equal(document.activeElement,restored);assert(!document.activeElement.hasAttribute('data-gv-person'));
  await h.click(restored);assert.equal(new URLSearchParams(location.search).get('gv-person'),null);assert.equal(document.activeElement,h.container.querySelector('[data-gv-contribution="'+key+'"]'));
 });
});

test('defaults to People and retains subject counts and filters without bar charts or group comparisons',async t=>{
 const h=await harness(t,'?view=groups'),params=()=>new URLSearchParams(location.search);
 assert.equal(h.calls[0].searchParams.get('group'),'PPE');assert.equal(h.container.querySelector('.gv-tabs [aria-pressed=true]').textContent,'People');assert.match(h.container.querySelector('.gv-people h2').textContent,/Who speaks for PPE/);
 assert(h.container.querySelector('.gv-person .insight-portrait'));
 await h.click(h.container.querySelector('[data-gv-person="100"]').closest('.gv-person').querySelector('.gv-person-subjects button'));
 assert.equal(params().get('gv-person'),'100');assert.equal(params().get('gv-subject'),'foreign');assert.equal(h.calls.at(-1).searchParams.get('person'),'100');assert.equal(h.calls.at(-1).searchParams.get('subject'),'foreign');
 const chip=h.container.querySelector('.gv-person.is-selected .gv-person-subjects button');assert.equal(chip.getAttribute('aria-pressed'),'true');
 await h.click(chip);assert.equal(params().get('gv-person'),'100');assert.equal(params().get('gv-subject'),null);
 await h.click([...h.container.querySelectorAll('.gv-tabs button')].find(b=>b.textContent==='Topics'));
 assert.equal(h.container.querySelector('.gv-bar, .gv-compare, [data-gv-compare]'),null);
 assert.match(h.container.querySelector('.gv-subject-title').textContent,/Foreign affairs1/);
 assert.doesNotMatch(h.container.querySelector('.gv-section-heading').textContent,/columns|classified contributions/);
 await h.click(h.container.querySelector('.gv-subject-title button'));assert.equal(params().get('gv-subject'),'foreign');
 const group=h.container.querySelector('.gv-controls select');
 await act(async()=>{group.value='ECR';group.dispatchEvent(new window.Event('change',{bubbles:true}));});await viewReady(h.container);
 assert.equal(params().get('gv-group'),'ECR');assert.equal(params().get('gv-subject'),'foreign');assert.equal(params().get('gv-person'),null);
 assert.match(h.container.querySelector('.gv-subject-title').textContent,/Foreign affairs24/);
 await act(async()=>{group.value='ESN';group.dispatchEvent(new window.Event('change',{bubbles:true}));});await viewReady(h.container);
 assert.equal(params().get('gv-group'),'ESN');assert.equal(params().get('gv-subject'),'foreign');
 const card=h.container.querySelector('.gv-subject');assert.match(card.textContent,/Foreign affairs0/);assert.equal(card.querySelector('.gv-bar, .gv-compare'),null);assert(h.container.querySelector('.gv-subjects .gv-empty'));
 await h.click(card.querySelector('.gv-subject-title button'));assert.equal(params().get('gv-subject'),null);assert.match(h.container.querySelector('.gv-subject-title').textContent,/Climate & energy1/);
});

for(const mode of ['gap','observed','partial'])test(`group summary and selected subject keep ${mode} counts distinct`,async t=>{
 const availability=sourceAvailability({sourceKey:'oral-speeches',start:'2026-09-01',end:'2026-09-30',latestObservedDate:'2026-10-16',gaps:mode==='gap'?[{start:'2026-09-01',end:'2026-09-30'}]:[],limited:mode==='partial',today:'2026-10-24'});
 const h=await harness(t,'?view=groups&gv-period=2026-09&gv-tab=subjects&gv-subject=foreign',{response:{availability,people:[],contributions:[],total:0,window:{from:'2026-09-01',to:'2026-09-30'}}});
 const values=[...h.container.querySelectorAll('.gv-summary strong,.gv-subject-title button:last-child,.gv-contributions h2 > small')].map(el=>el.textContent.replace(/^·\s*/,''));
 assert.equal(Boolean(h.container.querySelector('.gv-subjects .gv-empty')),mode!=='partial');
 assert.equal(values.length,5);assert(values.every(value=>value===(mode==='partial'?'Unavailable':'0')),JSON.stringify(values));
});

for(const limited of [false,true])test('People empty message requires an observed zero, limited='+limited,async t=>{
 const availability=sourceAvailability({sourceKey:'oral-speeches',start:'2026-09-01',end:'2026-09-30',latestObservedDate:'2026-10-16',limited,today:'2026-10-30'});
 const h=await harness(t,'?view=groups&gv-period=2026-09&gv-tab=people',{response:{availability,people:[],contributions:[],total:0,window:{from:'2026-09-01',to:'2026-09-30'}}});
 assert.equal(Boolean(h.container.querySelector('.gv-people .gv-empty')),!limited);
});

for(const capped of [false,true])test('actual group producer distinguishes a checked empty selection from a capped one: '+capped,async t=>{
 const clock=()=>Date.parse('2026-10-30T12:00Z'),directory=mkdtempSync('/tmp/group-empty-producer-'),store=new ActivityStore(directory,{clock});
 t.after(()=>{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});});
 store.acquire();const {generation}=store.beginCycle(),worker=new ActivityWorker(store,{clock});
 initializeGroupVoices(worker,generation,[]);store.setMembers([{id:'42',name:'Fixture member'}]);
 const speech=number=>({activity_id:'MTG-PL-2026-10-06-OTH-'+number,activity_date:'2026-10-06',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',had_participation:[{participation_role:'def/ep-roles/SPEAKER',had_participant_person:['person/42'],participation_in_name_of:'org/PPE'}]});
 worker.saveSpeech(generation,speech('1'),new Date(clock()).toISOString());
 if(capped)store.transaction(()=>{
  const put=(number,foreign=false)=>recordGroupVoice(store,generation,groupVoiceProjection({...speech(number),...(foreign?{inverse_consists_of:['eli/dl/event/MTG-PL-2026-10-06-PVCRE-ITM-18']}:{})},{fetchedAt:new Date(clock()).toISOString()}),null);
  for(let i=1;i<=GROUP_VOICE_LIMITS.rows;i++)put(String(i+10000));
  put('9999999',true);
 });
 store.db.prepare('UPDATE tasks SET done=1 WHERE generation=?').run(generation);store.publish(generation);store.release();store.db.exec('PRAGMA query_only=ON');
 const response=groupVoicesPage(store,groupVoicesQuery(new URLSearchParams('group=PPE&subject=foreign'),{now:clock()}));
 if(capped)assert.equal(store.db.prepare("SELECT COUNT(*) n FROM group_voice_designations WHERE generation=? AND group_id='PPE' AND subject='unclassified'").get(generation).n,GROUP_VOICE_LIMITS.rows+2,'editorial identifiers no longer classify retained contributions');
 assert.equal(response.coverage.truncated,capped);assert.equal(response.total,0);
 const h=await harness(t,'?view=groups&gv-group=PPE&gv-tab=subjects&gv-subject=foreign',{response});
 assert.equal(Boolean(h.container.querySelector('.gv-contributions .gv-empty')),!capped);
 assert.match(h.container.querySelector('.gv-contributions h2').textContent,capped?/Unavailable/:/0/);
});
