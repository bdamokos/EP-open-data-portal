import {automaticRecovery,installRetryClock,exhaustAutomaticRetries} from './test-support/automaticRecovery.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExactTopicStories,storyFactsRoute,storyRecord,storyVariant} from './exactTopicStories.mjs';
// Pins the base wording; variant choice has its own tests.
const baseWording={hasMessage:id=>!/\.v\d+$/.test(id)};
const base=()=>({ready:true,counts:{questions:53,questionElsewhere:7,questionUnknown:2,debates:9,adoptedTexts:0,groups:73},periodCounts:[],periodWinners:{},winners:{},sets:{},questions:[{id:'one',d:'2026-01-01',t:'Only hydrated question',places:['IRN'],home:[]}],debates:[],docs:[],topic:{label:'Trade'}});
const flatten=v=>v==null?'':typeof v==='string'?v:Array.isArray(v)?v.map(flatten).join('|'):v.text?flatten(v.text):v.message?JSON.stringify(v):'';
test('live totals use exact counters even when evidence arrays have one record',()=>{const x=base(),lines=buildExactTopicStories(x,{place:'IRN',language:'en'});assert.match(flatten(lines[0].values.questions),/53/);assert.match(flatten(lines[1].values.debates),/nine/);assert.equal(lines[0].values.questions.browse.list,'questions');const topic=buildExactTopicStories(x,{topic:'oeil:1.10',language:'en'});assert.match(flatten(topic[0].values.groups),/73/);});
test('all tied busiest winners are retained together and low-speaker evidence cannot feature',()=>{const x=base();x.periodCounts=[{period:'2026-Q1',questions:0}];x.debates=Array.from({length:6},(_,i)=>({id:'D'+i,date:'2026-01-01',q:'2026-Q1',title:'19.2. REPORT on Exact '+i,rawTitle:'19.2. REPORT on Exact '+i,meps:i===5?2:10,places:{IRN:['title']},docs:[]}));x.periodWinners['2026-Q1']={busiestNonUrgencyDebates:x.debates.map(d=>({id:d.id,meps:d.meps}))};const rows=buildExactTopicStories(x,{period:'2026-Q1'});assert.equal(rows[0].values.debates.length,5);assert.equal(rows[0].values.debates[0].values.title.text,'Exact 0');assert.equal(rows.length,1);});
test('leaders use winner counters, include every tie, and never infer leadership from evidence',()=>{const x=base();x.periodCounts=[{period:'2026-Q1'}];x.periodWinners['2026-Q1']={mostQuestionedPlaces:[{id:'GRC',count:18},{id:'ESP',count:18}]};const rows=buildExactTopicStories(x,{...baseWording,period:'2026-Q1',labels:{GRC:'Greece',ESP:'Spain'}});assert.equal(rows[0].id,'topics.story.integrated.lead.tied');assert.equal(rows.length,1);assert.equal(rows[0].values.places[1],'Spain');assert.match(flatten(rows[0].values.questions),/18/);});
test('browse requests preserve qualification, quarter, place and opaque cursor',()=>{const route=storyFactsRoute({place:'GRC',period:'2026-Q1',excludeOwn:true},{list:'questions',cursor:'opaque_123'}),p=new URLSearchParams(route.split('?')[1]);assert.equal(p.get('scope'),'place');assert.equal(p.get('key'),'place:GRC');assert.equal(p.get('period'),'2026-Q1');assert.equal(p.get('askers'),'not-home');assert.equal(p.get('cursor'),'opaque_123');});
test('unavailable facts do not manufacture zero stories',()=>{assert.deepEqual(buildExactTopicStories({ready:false},{}),[]);assert.deepEqual(buildExactTopicStories(null,{}),[]);});

test('caption title cleanup strips only agenda numbers and the specified prefixes',async()=>{const {cleanStoryTitle}=await import('./topicStoryModel.mjs');assert.equal(cleanStoryTitle('19.2. JOINT MOTION FOR A RESOLUTION on Iran (debate)'), 'Iran');assert.equal(cleanStoryTitle('RECOMMENDATION on Iran'),'Iran');for(const text of ['OPINION on Iran','Plain title: 16. Part'])assert.equal(cleanStoryTitle(text),text);});

test('live story counters open keyset pages and More preserves every prior record',async t=>{
 const {Window}=await import('happy-dom'),{createElement:h,act}=await import('react'),{freshLoader}=await import('./test-support/viteRunner.mjs');const window=new Window({url:'http://localhost/?view=geopolitics&place=IRN'}),globals={window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,Event:window.Event,PopStateEvent:window.PopStateEvent,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load,stale=true,transient=true;const calls=[];t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);if(u.pathname==='/api/source-record')return Response.json({payload:{data:[]}});assert.equal(u.pathname,'/api/topics/story-facts');calls.push(u);if(u.searchParams.get('cursor')==='page-two'&&stale){stale=false;return Response.json({error:{code:'story_cursor',message:'Reload this list.'}},{status:409});}if(u.searchParams.get('cursor')==='page-two'&&transient){transient=false;return Response.json({error:{message:'Busy'}},{status:503});}const x=base();x.counts.debates=0;if(u.searchParams.has('list')){const second=u.searchParams.get('cursor')==='page-two',id=second?'E-10-2026-000002':'E-10-2026-000001';x.questions=[{id,d:'2026-01-01',t:second?'Second exact record':'First exact record',places:['IRN'],home:[]}];x.page={list:'questions',total:53,items:[{id,kind:'question',date:'2026-02-01'}],nextCursor:second?null:'page-two'};}return Response.json(x);});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'exact-story-pagination'});const {TopicStories}=await load('/src/TopicStories.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const wait=async text=>{for(let i=0;i<30&&!node.textContent.includes(text);i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(node.textContent.includes(text),node.textContent);};
 await act(async()=>root.render(h(TopicStories,{selection:{periods:[],place:'IRN',labels:{IRN:'Iran'}}})));await wait('53 questions');await act(async()=>node.querySelector('.topic-story a').click());await wait('First exact record');assert(node.querySelector('.topic-story-records article small').textContent.includes('Feb'));assert(!node.textContent.includes('Second exact record'));const more=[...node.querySelectorAll('button')].find(b=>/^Show \d+ more$/.test(b.textContent));assert(more);await act(async()=>more.click());await act(async()=>new Promise(resolve=>setTimeout(resolve,30)));assert.equal([...node.querySelectorAll('button')].some(b=>b.textContent==='Reload'),false);await wait('First exact record');assert(calls.filter(u=>u.searchParams.get('list')==='questions'&&!u.searchParams.get('cursor')).length>=2,'an expired cursor starts a fresh first page without re-requesting that cursor');await act(async()=>[...node.querySelectorAll('button')].find(b=>/^Show \d+ more$/.test(b.textContent)).click());await act(async()=>new Promise(resolve=>setTimeout(resolve,30)));assert(node.textContent.includes('First exact record'));assert(!node.textContent.includes('Second exact record'));await automaticRecovery(t);await wait('Second exact record');assert(node.textContent.includes('First exact record'));assert(calls.some(u=>u.searchParams.get('cursor')==='page-two'));assert(![...node.querySelectorAll('button')].some(b=>/^Show \d+ more$/.test(b.textContent)));
 await act(async()=>root.render(h(TopicStories,{selection:{periods:[],place:'IRN',mode:'d',excludeOwn:true,unknownHistory:true},facts:base()})));assert(!node.textContent.includes('Question comparisons unavailable'),'Texts mode does not show a question-comparison gap');
});

test('not-home uses exact subset counters and retains winners despite unknown origins',()=>{const x=base();x.counts.questionHome=40;const line=buildExactTopicStories(x,{place:'IRN',excludeOwn:true})[0];assert.match(flatten(line.values.questions),/53/);assert.equal(x.counts.questions,53);x.periodCounts=[{period:'2026-Q1'}];x.periodWinners['2026-Q1']={mostQuestionedPlaces:[{id:'GRC',count:18}]};assert.equal(buildExactTopicStories(x,{period:'2026-Q1',excludeOwn:true,unknownQuestions:true}).length,1);assert.equal(new URLSearchParams(storyFactsRoute({place:'IRN',excludeOwn:true}).split('?')[1]).get('askers'),'not-home');});

test('fused source prefixes are removed without changing the remaining title',async()=>{const {cleanStoryTitle}=await import('./topicStoryModel.mjs');assert.equal(cleanStoryTitle('MOTION FOR A RESOLUTIONSystematic repression'),'Systematic repression');assert.equal(cleanStoryTitle('REPORTChosen policy'),'Chosen policy');assert.equal(cleanStoryTitle('REPORT‘Cohesion policy’'),'‘Cohesion policy’');assert.equal(cleanStoryTitle('REPORTING on policy'),'REPORTING on policy');});

test('paged decision evidence retains show-of-hands outcomes',()=>{assert.equal(storyRecord({id:'RC-1',title:'Text',outcome:{outcome:'ADOPTED',decisionMethod:'show-of-hands'}},'document').outcome.method,'VOTE_HAND');assert.equal(storyRecord({id:'RC-2',title:'Unknown',outcome:null},'document').outcome,null);});

test('featured place debates do not turn the primary-first selection into a busiest claim',()=>{const x=base();x.periodCounts=[{period:'2026-Q1',questions:0}];x.periodWinners['2026-Q1']={leadingPlaceDebates3Plus:[{id:'D',meps:3}]};x.debates=[{id:'D',title:'Place debate',date:'2026-01-01',q:'2026-Q1',meps:3,docs:[],places:{IRN:['title']}}];const row=buildExactTopicStories(x,{place:'IRN',period:'2026-Q1'})[0];assert.equal(row.id,'topics.story.exact.placeDebates');});

test('closest-vote display keeps the reviewed sub-100-vote threshold',()=>{const x=base();x.periodCounts=[{period:'2026-Q1',groups:1,adoptedTexts:3}];x.periodWinners['2026-Q1']={closestAdoptedTexts:[{id:'R',margin:100}]};x.docs=[{id:'R',title:'REPORT on Exact',type:'REPORT',date:'2026-01-01',keywords:[],places:[],outcome:{outcome:'ADOPTED',for:200,against:100}}];assert(!buildExactTopicStories(x,{topic:'oeil:1.10',period:'2026-Q1'}).some(r=>/exact\.closest(One)?$/.test(r.id)));x.periodWinners['2026-Q1'].closestAdoptedTexts[0].margin=99;assert(buildExactTopicStories(x,{topic:'oeil:1.10',period:'2026-Q1'}).some(r=>r.id.endsWith('exact.closestOne')),'one closest text uses the singular sentence');});

test('unknown joint authorship does not become an exact group count',()=>{const x=base();x.periodCounts=[{period:'2026-Q1'}];x.periodWinners['2026-Q1']={busiestNonUrgencyDebates:[{id:'D',meps:5}]};x.debates=[{id:'D',title:'Exact debate',date:'2026-01-01',meps:5,places:{IRN:['title']},docs:['R']}];x.docs=[{id:'R',title:'Exact joint text',type:'RESOLUTION_MOTION_JOINT',groups:['PPE','ECR'],groupsAvailable:false,outcome:{outcome:'ADOPTED',for:100,against:20}}];const line=buildExactTopicStories(x,{period:'2026-Q1'})[0];assert.equal(line.values.outcome.values.value.message,'topics.story.links.outcome');delete x.docs[0].groupsAvailable;assert.equal(buildExactTopicStories(x,{period:'2026-Q1'})[0].values.outcome.values.value.message,'topics.story.links.outcome');x.docs[0].groupsAvailable=true;assert.equal(buildExactTopicStories(x,{period:'2026-Q1'})[0].values.outcome.values.value.message,'topics.story.links.jointOutcome');});

test('headline winners below three linked MEP speakers cannot feature',()=>{const x=base();x.periodCounts=[{period:'2026-Q1',adoptedTexts:3}];x.periodWinners['2026-Q1']={headlineAdoptedTexts3Plus:[{id:'R',debateMeps:0}]};x.docs=[{id:'R',title:'Exact adopted text',type:'REPORT',outcome:{outcome:'ADOPTED',for:100,against:20}}];const row=()=>buildExactTopicStories(x,{topic:'oeil:1.10',period:'2026-Q1'}).find(r=>r.id==='topics.story.exact.adopted');assert.equal(row().values.texts,null);x.periodWinners['2026-Q1'].headlineAdoptedTexts3Plus[0].debateMeps=3;assert.equal(row().values.texts.message,'topics.story.exact.including');});

test('story prose fallback covers nested helpers, model grammar and headings without changing reader locale',async t=>{
 const {Window}=await import('happy-dom'),{createElement:h,act}=await import('react'),{freshLoader}=await import('./test-support/viteRunner.mjs');
 const window=new Window({url:'http://localhost/?view=geopolitics&place=TUR&lang=fi'}),globals={window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,Event:window.Event,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const calls=[];let payload=base();payload.counts={questions:2,debates:0};payload.questions=[{id:'E-10-2026-000001',d:'2026-01-01',t:'Exact source title — Türkiye',places:['TUR'],home:[]}];
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);calls.push(u);if(u.pathname==='/api/topics/story-facts')return Response.json({...payload,...(u.searchParams.has('list')?{page:{total:2,items:payload.questions.map(q=>({id:q.id,date:q.d})),nextCursor:null}}:{})});return Response.json({ready:false});});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'exact-story-locale'});
 const {TopicStories}=await load('/src/TopicStories.tsx'),{UiI18nProvider,UiMessage,useUiI18n}=await load('/src/UiI18nReact.tsx'),{createAppUiI18n}=await import('./uiCatalogues.mjs'),{createRoot}=await import('react-dom/client');
 const node=document.createElement('div');document.body.append(node);installRetryClock(t);root=createRoot(node);
 const parent={'topics.story.place.summary.questions':'{questions} mainitsi kohteen {place} tällä kaudella.'},child={'topics.story.count.questions':'{count} kysymystä','topics.story.count.questionsOne':'{count} kysymys'};
 function Surrounding(){const ui=useUiI18n();return h('aside',{'data-language':ui.language},h(UiMessage,{id:'topics.story.count.questions',values:{count:2},counts:{count:2}}));}
 const render=async(messages,facts,selection={})=>{const i18n=createAppUiI18n({fi:messages},{});await act(async()=>root.render(h(UiI18nProvider,{i18n,language:'fi'},h('div',null,h(TopicStories,{selection:{place:'TUR',labels:{TUR:'Türkiye'},periods:[],...selection},...(facts?{facts}:{})}),h(Surrounding)))));};
 const wait=async text=>{for(let i=0;i<30&&!node.textContent.includes(text);i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(node.textContent.includes(text),node.textContent);};
 await render(child);await wait('two questions');assert.equal(node.querySelector('.topic-story').lang,'en');assert.match(node.querySelector('.topic-story').textContent,/two questions named Türkiye this term/);assert.equal(node.querySelector('aside').textContent,'2 kysymystä');assert.equal(node.querySelector('aside').dataset.language,'fi');
 const opener=node.querySelector('.topic-story a'),href=opener.getAttribute('href'),origin=location.href,id=opener.id;
 await act(async()=>opener.click());await wait('Exact source title — Türkiye');assert.equal(document.activeElement,node.querySelector('.topic-story-records h1'));assert.equal(node.querySelector('aside').dataset.language,'fi');
 const target=new URL(node.querySelector('article > a').href);assert.equal(target.searchParams.get('view'),'questions');assert.equal(target.searchParams.get('q-read'),'E-10-2026-000001');assert(calls.some(u=>u.searchParams.get('lang')==='fi'));
 const saved={storyLinkId:id,storyScroll:0};t.mock.method(history,'back',()=>{history.replaceState(saved,'',origin);window.dispatchEvent(new window.Event('popstate'));});
 await act(async()=>node.querySelector('.topic-story-records > a').click());await wait('two questions');assert.equal(document.activeElement.id,id);assert.equal(document.getElementById(id).getAttribute('href'),href);
 await render(parent);assert.equal(node.querySelector('.topic-story').lang,'en');assert.match(node.querySelector('.topic-story').textContent,/two questions named Türkiye/);
 await render({...parent,...child});assert.equal(node.querySelector('.topic-story').lang,'fi');assert.equal(node.querySelector('.topic-story').textContent,'2 kysymystä mainitsi kohteen Türkiye tällä kaudella. ');
 // The reference model has the same coverage policy, without changing source text.
 await render(child,payload);assert.equal(node.querySelector('.topic-story').lang,'en');assert.match(node.querySelector('.topic-story').textContent,/one question named Türkiye/);
 await render({...parent,...child},payload);assert.equal(node.querySelector('.topic-story').lang,'fi');assert.match(node.querySelector('.topic-story').textContent,/1 kysymys mainitsi kohteen Türkiye/);
 const periods=['2025-Q1','2025-Q2','2025-Q3','2025-Q4'],streakFacts={questions:periods.slice(0,3).map((p,i)=>({id:'E-10-2025-00000'+i,d:['2025-01-01','2025-04-01','2025-07-01'][i],t:'Exact '+i,places:['TUR'],home:[]})),debates:[],docs:[]};
 const streakParent={'topics.story.map.lead.streak':'{place}: {ordinal} ({questions}).'};
 // A translated parent and counts cannot certify missing ordinal grammar.
 await render({...child,...streakParent},streakFacts,{place:undefined,period:'2025-Q3',periods});assert.equal(node.querySelector('.topic-story').lang,'en');assert.match(node.querySelector('.topic-story').textContent,/third quarter running \(one question\)/);
 await render({...child,...streakParent,'topics.story.ordinal.other':'{count}.'},streakFacts,{place:undefined,period:'2025-Q3',periods});assert.equal(node.querySelector('.topic-story').lang,'fi');assert.match(node.querySelector('.topic-story').textContent,/Türkiye: 3\. \(1 kysymys\)/);
 const dated={questions:[],docs:[],debates:[{id:'MTG-PL-2025-07-09-ITM-1',date:'2025-07-09',q:'2025-Q3',title:'Exact source title — Türkiye',rawTitle:'Exact source title — Türkiye',meps:1234,places:{TUR:['title']},docs:[]}]};
 await render(child,dated,{period:'2025-Q3',periods});assert.equal(node.querySelector('.topic-story').lang,'en');assert.match(node.querySelector('.topic-story').textContent,/9 July/);assert.match(node.querySelector('.topic-story').textContent,/1,234 MEPs/);assert(node.textContent.includes('Exact source title — Türkiye'));assert.equal(node.querySelector('i').lang,'en');
 // Tied references need the prose conjunction even when counts are native.
 const tied={questions:[...streakFacts.questions.filter(q=>q.d==='2025-07-01'),{id:'E-10-2025-999999',d:'2025-07-01',t:'Exact Iran',places:['IRN'],home:[]}],docs:[],debates:[]};
 await render(child,tied,{place:undefined,period:'2025-Q3',periods,labels:{TUR:'Türkiye',IRN:'Iran'}});assert.equal(node.querySelector('.topic-story').lang,'en');assert.match(node.querySelector('.topic-story').textContent,/Iran and Türkiye/);
});

test('a missing concept label remains plain text rather than a story reference',()=>{
 const payload=base();payload.topic={key:'oeil:9.99',label:'oeil:9.99',labelLanguage:null};
 const line=buildExactTopicStories(payload,{topic:'oeil:9.99'})[0];assert.equal(line.values.topic,'oeil:9.99');
 payload.topic={label:'Élargissement',labelLanguage:'fr'};assert.equal(buildExactTopicStories(payload,{topic:'oeil:8.20'})[0].values.topic.labelLanguage,'fr');
 assert.equal(new URLSearchParams(storyFactsRoute({topic:'oeil:8.20',language:'fr'}).split('?')[1]).get('lang'),'fr');
});

// Wording: render lines to plain English with the shipped catalogue.
const en=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./ui-locales/en.json',import.meta.url),'utf8'));
const say=v=>v==null?'':typeof v==='string'?v:Array.isArray(v)?new Intl.ListFormat('en-GB',{type:'conjunction'}).format(v.map(say)):v.message?(v.counts?.count===1&&en[v.message+'One']?en[v.message+'One']:en[v.message]).replace(/\{(\w+)\}/g,(_,k)=>say(v.values?.[k])):v.text!==undefined?say(v.text):'';
const lineText=rows=>rows.map(r=>en[r.id].replace(/\{(\w+)\}/g,(_,k)=>say(r.values[k]))).join(' ');
const quarter=x=>{x.periodCounts=[{period:'2026-Q1'}];x.periodWinners['2026-Q1']={};x.periods=['2025-Q3','2025-Q4','2026-Q1','2026-Q2'];x.partial={first:null,last:null};x.series={};return x;};
const joint={id:'RC-10-2026-0110',title:'JOINT MOTION FOR A RESOLUTION on the systemic oppression in Iran',type:'RESOLUTION_MOTION_JOINT',groups:['PPE','S_D','RENEW','ECR','VERTS_ALE','THE_LEFT'],groupsAvailable:true,date:'2026-02-11',outcome:{outcome:'ADOPTED',for:524,against:3,date:'2026-02-12'}};

test('wording: the busiest debate leads with its place, tallies are digits and the resolution takes "the"',()=>{
 const x=quarter(base());x.debates=[{id:'D',title:'Brutal repression against protesters in Iran (joint debate)',date:'2026-01-20',meps:63,places:{IRN:['title']},primaryPlace:'IRN',docs:[joint.id]}];x.docs=[joint];x.periodWinners['2026-Q1'].busiestNonUrgencyDebates=[{id:'D',meps:63}];
 const text=lineText(buildExactTopicStories(x,{period:'2026-Q1',labels:{IRN:'Iran'},...baseWording}));
 assert.match(text,/^Iran drew the busiest debate on the map: 63 MEPs spoke on Brutal repression against protesters in Iran \(20 January\); the resolution, a joint text by six groups, passed 524 to 3\./);
 x.debates[0].places={};x.debates[0].primaryPlace=null;assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1',...baseWording})),/^The busiest debate on the map was Brutal repression against protesters in Iran \(20 January\), with 63 MEPs speaking; /);
});
test('wording: urgency debates list countries only, in date order, and say when others were not placed',()=>{
 const x=quarter(base());x.periodCounts[0].urgencyDebates=3;x.debates=[['U3','2026-03-11','Case of Elene Khoshtaria','GEO'],['U1','2026-01-21','Execution spree in Iran','IRN'],['U2','2026-02-11','Freedom of religion worldwide',null]].map(([id,date,title,p])=>({id,date,title,meps:12,format:'urgency',places:p?{[p]:['title']}:{},primaryPlace:p,docs:[]}));x.sets={urgencyDebates:{'2026-Q1':['U3','U1','U2']}};
 const text=lineText(buildExactTopicStories(x,{period:'2026-Q1',labels:{IRN:'Iran',GEO:'Georgia'}}));
 assert.match(text,/Three urgency debates on human rights took up Iran and Georgia, among other cases\./);assert(!text.includes('Freedom of religion'));
 x.debates.forEach(d=>{d.places={};d.primaryPlace=null;});assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1'})),/Three urgency debates on human rights were held\./);
});
test('wording: names that take "the" read naturally at the start and inside sentences',()=>{
 const x=quarter(base());x.periodWinners['2026-Q1']={mostQuestionedPlaces:[{id:'USA',count:43}],risingQuestionPlaces:[{id:'GBR',count:12,ratio:3,baselineMean:4}]};
 const text=lineText(buildExactTopicStories(x,{period:'2026-Q1',labels:{USA:'United States',GBR:'United Kingdom'},...baseWording}));
 assert.match(text,/Questions about the United Kingdom rose to 12, from an average of 4 a quarter\./);assert.match(text,/The United States drew the most questions \(43\)\./);
});
test('wording: places with the same change share one sentence, others get their own, averages say "a quarter"',()=>{
 const x=quarter(base());x.periodWinners['2026-Q1']={risingQuestionPlaces:[{id:'ROU',count:9,ratio:4.5,baselineMean:2},{id:'TUN',count:9,ratio:4.5,baselineMean:2}]};
 assert.match(lineText(buildExactTopicStories(x,{...baseWording,period:'2026-Q1',labels:{ROU:'Romania',TUN:'Tunisia'}})),/Questions about Romania and Tunisia each jumped to nine, from an average of 2 a quarter\./);
 x.periodWinners['2026-Q1'].risingQuestionPlaces[1]={id:'TUN',count:8,ratio:2,baselineMean:4};const text=lineText(buildExactTopicStories(x,{...baseWording,period:'2026-Q1',labels:{ROU:'Romania',TUN:'Tunisia'}}));
 assert.match(text,/Questions about Romania jumped to nine, from an average of 2 a quarter\. Questions about Tunisia rose to eight, from an average of 4 a quarter\./);assert(!/ and Questions/.test(text));
 x.periodWinners['2026-Q1'].risingQuestionPlaces=[{id:'ROU',count:9,ratio:9,baselineMean:0.6}];assert.match(lineText(buildExactTopicStories(x,{...baseWording,period:'2026-Q1',labels:{ROU:'Romania'}})),/from fewer than one a quarter\./);
});
test('wording: Texts mode names the top four places and never writes "(one)"',()=>{
 const x=quarter(base());x.periodCounts[0].placesWithAdoptedTexts=27;x.periodWinners['2026-Q1']={topAdoptedPlaces:[['RUS',3],['UKR',3],['ESP',2],['AGO',1],['AZE',1],['BEL',1]].map(([id,count])=>({id,count}))};
 const text=lineText(buildExactTopicStories(x,{period:'2026-Q1',mode:'d',labels:{RUS:'Russia',UKR:'Ukraine',ESP:'Spain',AGO:'Angola',AZE:'Azerbaijan',BEL:'Belgium'}}));
 assert.match(text,/Parliament adopted texts naming Russia \(three\), Ukraine \(three\), Spain \(two\) and Angola, among 27 places\./);assert(!text.includes('(one)'));
});
test('wording: a resolution told with its debate is not repeated on a place quarter',()=>{
 const x=quarter(base());x.periodCounts[0].adoptedTexts=2;const other={id:'RC-10-2026-0071',title:'JOINT MOTION FOR A RESOLUTION on the brutal repression against protesters in Iran',type:'RESOLUTION_MOTION_JOINT',groups:[],date:'2026-01-21',outcome:{outcome:'ADOPTED',for:562,against:9,date:'2026-01-22'}};
 x.debates=[{id:'D',title:'Systemic oppression',date:'2026-02-11',meps:28,format:'urgency',places:{IRN:['title']},primaryPlace:'IRN',docs:[joint.id]}];x.docs=[joint,other];x.periodWinners['2026-Q1'].leadingPlaceDebates3Plus=[{id:'D',meps:28}];x.sets={adoptedTexts:{'2026-Q1':[joint.id,other.id]}};
 const text=lineText(buildExactTopicStories(x,{place:'IRN',period:'2026-Q1',labels:{IRN:'Iran'}}));
 assert.match(text,/Parliament also adopted one text: the brutal repression against protesters in Iran \(562–9\)\./);assert.equal(text.match(/524/g).length,1);
});
test('wording: a topic quarter tells its busiest debate and that dossier\'s adoption once',()=>{
 const x=quarter(base());x.periodCounts[0].adoptedTexts=5;const edip={id:'A-10-2025-0200',title:'REPORT on the proposal for a regulation of the European Parliament and of the Council establishing the European Defence Industry Programme',type:'REPORT_PLENARY',date:'2026-01-15',outcome:{outcome:'ADOPTED',for:457,against:148,date:'2026-01-20'}};
 x.debates=[{id:'D',title:'European Defence Industry Programme (EDIP)',date:'2026-01-20',meps:57,places:{},docs:[edip.id]}];x.docs=[edip];x.periodWinners['2026-Q1']={busiestDebates:[{id:'D',meps:57}],headlineAdoptedTexts3Plus:[{id:edip.id,debateMeps:57}],closestAdoptedTexts:[]};
 const text=lineText(buildExactTopicStories(x,{topic:'eurovoc:2499',period:'2026-Q1'}));
 assert.match(text,/The busiest debate, on European Defence Industry Programme \(EDIP\) \(20 January, 57 MEPs\), ended in its adoption, 457 to 148\./);assert.match(text,/Parliament also adopted four texts\./);assert(!/biggest debate/.test(text));
});
test('wording: legislative boilerplate is dropped from text titles',async()=>{const {cleanStoryTitle}=await import('./topicStoryModel.mjs');assert.equal(cleanStoryTitle('REPORT on the proposal for a regulation of the European Parliament and of the Council establishing the European Defence Industry Programme'),'regulation establishing the European Defence Industry Programme');assert.notEqual(cleanStoryTitle('REPORT on the proposal for a regulation on cross-border services'),cleanStoryTitle('REPORT on the proposal for a directive on cross-border services'),'the instrument stays');assert.equal(cleanStoryTitle('REPORT on the proposal for a directive on cross-border services'),'directive on cross-border services');assert.equal(cleanStoryTitle('REPORT on the proposal for a directive amending Directive 2003/87/EC'),'the proposal for a directive amending Directive 2003/87/EC');assert.equal(cleanStoryTitle('Ukraine (joint debate)'),'Ukraine');});
test('wording: English story lists use British punctuation',async()=>{const fs=await import('node:fs/promises');for(const [f,context] of [['./TopicStories.tsx','proseUi'],['./TopicStory.tsx','ui']])assert.match(await fs.readFile(new URL(f,import.meta.url),'utf8'),new RegExp("Intl\\.ListFormat\\("+context+"\\.language==='en'\\?'en-GB'"));});

test('wording: deduplication leaves out only a text narrated, adopted and counted in this quarter',()=>{
 const x=quarter(base());x.periodCounts[0].adoptedTexts=1;const prior={...joint,id:'RC-10-2025-0300',outcome:{...joint.outcome,date:'2025-12-18'}},current={id:'RC-10-2026-0071',title:'JOINT MOTION FOR A RESOLUTION on the brutal repression against protesters in Iran',type:'RESOLUTION_MOTION_JOINT',groups:[],date:'2026-01-21',outcome:{outcome:'ADOPTED',for:562,against:9,date:'2026-01-22'}};
 x.debates=[{id:'D',title:'Follow-up debate',date:'2026-02-11',meps:28,places:{IRN:['title']},primaryPlace:'IRN',docs:[prior.id]}];x.docs=[prior,current];x.periodWinners['2026-Q1'].leadingPlaceDebates3Plus=[{id:'D',meps:28}];x.sets={adoptedTexts:{'2026-Q1':[current.id]}};
 const text=lineText(buildExactTopicStories(x,{place:'IRN',period:'2026-Q1',labels:{IRN:'Iran'}}));
 assert.match(text,/Parliament adopted one text: the brutal repression against protesters in Iran \(562–9\)\./,'a prior-quarter resolution linked to a debate does not hide this quarter\'s adoption');assert(!/also adopted/.test(text));
});
test('wording: counted claims are whole phrases with plural forms',async()=>{
 const pairs=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./ui-locales/plural-pairs.json',import.meta.url),'utf8'));assert(pairs.some(p=>p.one==='topics.story.count.urgencyDebatesOne'&&p.other==='topics.story.count.urgencyDebates'));
 for(const id of ['topics.story.map.urgency.many','topics.story.exact.urgencyPartial','topics.story.exact.urgencyCount'])assert(en[id].startsWith('{urgencyDebates} on human rights'),id);
 for(const id of ['topics.story.exact.questionRare','topics.story.exact.questionRareEach'])assert(en[id].includes('drew {questions}')&&!en[id].includes('{count} questions'),id);
 const x=quarter(base());x.periodCounts[0].urgencyDebates=1;x.debates=[{id:'U1',date:'2026-01-21',title:'Execution spree in Iran',meps:12,format:'urgency',places:{IRN:['title']},primaryPlace:'IRN',docs:[]},{id:'U2',date:'2026-02-21',title:'Case in Georgia',meps:12,format:'urgency',places:{GEO:['title']},primaryPlace:'GEO',docs:[]}];x.periodCounts[0].urgencyDebates=2;x.sets={urgencyDebates:{'2026-Q1':['U1','U2']}};
 const row=buildExactTopicStories(x,{...baseWording,period:'2026-Q1',labels:{IRN:'Iran',GEO:'Georgia'}}).find(r=>r.id==='topics.story.map.urgency.many');assert.equal(row.values.urgencyDebates.text.message,'topics.story.count.urgencyDebates');assert.deepEqual(row.values.urgencyDebates.text.counts,{count:2});assert(row.values.urgencyDebates.records.length>0);
 x.periodWinners['2026-Q1'].risingQuestionPlaces=[{id:'ROU',count:8,ratio:8,baselineMean:0.2}];const rare=buildExactTopicStories(x,{...baseWording,period:'2026-Q1',labels:{ROU:'Romania'}}).find(r=>r.id==='topics.story.exact.rises');assert.equal(rare.values.changes[0].values.questions.text.message,'topics.story.count.questions');assert.match(lineText([rare]),/Romania, rarely asked about before, drew eight questions\./);
});

test('wording: without proof of membership a narrated text is not subtracted from the adopted count',()=>{
 const x=quarter(base());x.periodCounts[0].adoptedTexts=3;const unrelated={...joint,id:'RC-10-2026-0099',outcome:{...joint.outcome,date:'2026-02-12'}};
 x.debates=[{id:'D',title:'Busy topic debate',date:'2026-02-11',meps:40,places:{},docs:[unrelated.id]}];x.docs=[unrelated];x.periodWinners['2026-Q1']={busiestDebates:[{id:'D',meps:40}]};
 // Topic payloads omit the adopted set above two adoptions: no positive evidence, so nothing is subtracted.
 assert.match(lineText(buildExactTopicStories(x,{topic:'eurovoc:584',period:'2026-Q1'})),/Parliament adopted three texts\./);
 x.periodWinners['2026-Q1'].headlineAdoptedTexts3Plus=[{id:unrelated.id,debateMeps:40}];const proven=lineText(buildExactTopicStories(x,{topic:'eurovoc:584',period:'2026-Q1'}));assert.match(proven,/ended in its adoption, 524 to 3\. Parliament also adopted two texts\./,'a winner drawn from the counted texts proves membership');
});
test('wording: exclusions follow the final narration after the headline fusion',()=>{
 const x=quarter(base());x.periodCounts[0].adoptedTexts=2;const A={...joint,id:'RC-10-2026-0100',title:'JOINT MOTION FOR A RESOLUTION on text A',outcome:{...joint.outcome,date:'2026-02-12'}},B={id:'A-10-2026-0010',title:'REPORT on text B',type:'REPORT_PLENARY',date:'2026-02-10',outcome:{outcome:'ADOPTED',for:400,against:200,date:'2026-02-12'}};
 x.debates=[{id:'D',title:'Debate on B',date:'2026-02-11',meps:40,places:{},docs:[A.id,B.id]}];x.docs=[A,B];x.sets={adoptedTexts:{'2026-Q1':[A.id,B.id]}};x.periodWinners['2026-Q1']={busiestDebates:[{id:'D',meps:40}],headlineAdoptedTexts3Plus:[{id:B.id,debateMeps:40}]};
 const text=lineText(buildExactTopicStories(x,{topic:'eurovoc:584',period:'2026-Q1'}));
 assert.match(text,/ended in its adoption, 400 to 200\./);assert.match(text,/Parliament also adopted one text: text A \(524–3\)\./,'A is no longer narrated, so it stays in the adoption sentence');
});

test('story records and title references preserve a non-English fallback language',()=>{
 const x=base();x.docs=[{id:'R',title:'MOTION FOR A RESOLUTION on Titre français',titleLanguage:'fr',type:'REPORT',outcome:{outcome:'ADOPTED',for:100,against:20}}];x.counts.adoptedTexts=1;x.winners={headlineAdoptedTexts3Plus:[{id:'R',debateMeps:3}]};
 assert.equal(storyRecord(x.docs[0],'document').titleLanguage,'fr');
 const lines=buildExactTopicStories(x,{topic:'oeil:9.99'});assert(JSON.stringify(lines).includes('"titleLanguage":"fr"'));
});

test('months: the busiest-quarter reference names months in the interface language',async()=>{
 const {monthRangeLabel}=await import('./topicPresentation.mjs');
 assert.match(monthRangeLabel('2026-Q1','en'),/^January\s*[–-]\s*March 2026$/);assert.match(monthRangeLabel('2026-Q4','fr'),/octobre.*décembre 2026/);assert.equal(monthRangeLabel('bad','en'),'bad');
 const x=base();x.periodCounts=[{period:'2026-Q1',debateSpeakerAppearances:40},{period:'2026-Q2',debateSpeakerAppearances:10}];
 const row=buildExactTopicStories(x,{place:'IRN',language:'en',labels:{IRN:'Iran'}}).find(r=>r.id==='topics.story.place.summary.peak');
 assert.match(lineText([row]),/^Busiest quarter: January\s*[–-]\s*March 2026\.$/);assert.equal(row.values.quarter[0].period,'2026-Q1','links keep the quarter key');
});

test('record page month ranges cover complete baseline periods without changing quarter keys',async()=>{
 const {monthRangeLabel}=await import('./topicPresentation.mjs');assert.match(monthRangeLabel('2026-Q1,2026-Q2','en'),/January.*June 2026/);assert.match(monthRangeLabel('2024-Q4,2026-Q2','en'),/October 2024.*June 2026/);assert.equal(monthRangeLabel('bad','en'),'bad');
});

test('variants: every alternative keeps its base sentence’s slots and the choice is stable',()=>{
 const slots=t=>[...t.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join(',');
 const alternatives=Object.keys(en).filter(k=>/^topics\.story\..+\.(?:v\d+|eu)$/.test(k));assert(alternatives.length>=20);
 for(const k of alternatives)assert.equal(slots(en[k]),slots(en[k.replace(/\.(?:v\d+|eu)$/,'')]),k);
 const quarters=['2024-Q3','2024-Q4','2025-Q1','2025-Q2','2025-Q3','2025-Q4','2026-Q1','2026-Q2','2026-Q3','2026-Q4'],has=id=>Object.hasOwn(en,id);
 const bases=[...new Set(alternatives.filter(k=>/\.v\d+$/.test(k)).map(k=>k.replace(/\.v\d+$/,'')))];
 for(const id of bases)for(const scope of ['map','place:UKR','topic:oeil:1.10']){
  const picks=quarters.map(p=>storyVariant(id,p,scope,has));
  assert.deepEqual(picks,quarters.map(p=>storyVariant(id,p,scope,has)),'stable '+id);
  for(let i=1;i<picks.length;i++)assert.notEqual(picks[i],picks[i-1],`${id} ${scope} ${quarters[i-1]}→${quarters[i]}`);
 }
 assert.equal(storyVariant('topics.story.map.lead.first','2025-Q2','map',()=>false),'topics.story.map.lead.first');
 // Without its own variants a language keeps the base sentence.
 const x=quarter(base());x.periodWinners['2026-Q1']={mostQuestionedPlaces:[{id:'USA',count:43}]};
 for(const period of ['2025-Q3','2025-Q4','2026-Q1','2026-Q2']){x.periodCounts=[{period}];x.periodWinners[period]=x.periodWinners['2026-Q1'];assert.doesNotMatch(buildExactTopicStories(x,{period,language:'fr'})[0].id,/\.v\d+$/);}
});

const rejectedFacts=(originalStatus='known')=>{const x=quarter(base());const rc={id:'RC-10-2024-0173',type:'RESOLUTION_MOTION_JOINT',title:'JOINT MOTION FOR A RESOLUTION on Exact',date:'2026-01-20',outcomeStatus:'known',outcome:{outcome:'REJECTED',for:152,against:378,date:'2026-01-21'}},b={id:'B-10-2024-0175',type:'RESOLUTION_MOTION',title:'MOTION FOR A RESOLUTION on Exact',date:'2026-01-19',outcomeStatus:originalStatus,outcome:originalStatus==='known'?{outcome:'LAPSED',date:'2026-01-21'}:null};
 x.debates=[{id:'D',title:'Exact debate',date:'2026-01-20',meps:12,places:{},docs:[rc.id,b.id]}];x.docs=[rc,b];x.periodWinners['2026-Q1'].busiestNonUrgencyDebates=[{id:'D',meps:12}];return x;};
test('outcomes: a rejection is told only from exact outcomes and never when one is unknown',()=>{
 const told=buildExactTopicStories(rejectedFacts(),{period:'2026-Q1',...baseWording});
 assert.match(lineText(told),/with 12 MEPs speaking; the resolution was rejected 152 to 378\./);
 const link=told[0].values.outcome.values.value.values.outcome;assert.equal(link.records[0].id,'RC-10-2024-0173');
 assert.match(lineText(buildExactTopicStories(rejectedFacts('unknown'),{period:'2026-Q1',...baseWording})),/with 12 MEPs speaking\.$/);
 const x=rejectedFacts();x.docs[1].outcome={outcome:'ADOPTED',for:300,against:200,date:'2026-01-21'};assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1',...baseWording})),/the resolution passed 300 to 200\./);
});

const leadFacts=(winners,partial={first:null,last:null})=>{const periods=['2025-Q1','2025-Q2','2025-Q3','2025-Q4'],x={...base(),periods,partial,periodCounts:periods.map(period=>({period})),periodWinners:Object.fromEntries(periods.map((p,i)=>[p,{mostQuestionedPlaces:winners[i].map(id=>({id,count:20}))}])),series:{}};return x;};
test('continuity: again and running streaks come from exact sole winners of full quarters',()=>{
 const say4=(x,period='2025-Q4')=>lineText(buildExactTopicStories(x,{period,labels:{UKR:'Ukraine',ISR:'Israel'},...baseWording}));
 assert.match(say4(leadFacts([['ISR'],['UKR'],['UKR'],['UKR']])),/^Ukraine drew the most questions for the third quarter running \(20\)\.$/);
 assert.match(say4(leadFacts([['UKR'],['ISR'],['ISR'],['UKR']])),/^Ukraine drew the most questions \(20\)\.$/);
 assert.match(say4(leadFacts([['UKR'],['UKR'],['UKR','ISR'],['UKR']])),/^Ukraine drew the most questions \(20\)\.$/,'a tie breaks the streak');
 assert.match(say4(leadFacts([['UKR'],['UKR'],['ISR'],['ISR']])),/^Israel again drew the most questions/);
 assert.match(say4(leadFacts([['UKR'],['ISR','UKR'],['UKR'],['UKR']])),/^Ukraine and Israel were the most asked-about places|^Ukraine again drew the most questions/);
 // The current partial quarter makes no continuity claim, and a partial first quarter ends a streak.
 assert.match(say4(leadFacts([['UKR'],['UKR'],['UKR'],['UKR']],{first:null,last:'2025-11-02'})),/^Ukraine has so far drawn the most questions \(20\)\.$/);
 assert.match(say4(leadFacts([['UKR'],['UKR'],['UKR'],['UKR']],{first:'2025-02-16',last:null})),/for the third quarter running/);
});

test('zoom: the same quarter reads with a Europe scope and names only places in view',()=>{
 const x=quarter(base());x.debates=[{id:'D',title:'Situation in Venezuela',date:'2026-01-20',meps:40,places:{VEN:['title'],NLD:['official']},primaryPlace:'VEN',docs:[]}];x.periodWinners['2026-Q1']={busiestNonUrgencyDebates:[{id:'D',meps:40}],mostQuestionedPlaces:[{id:'NLD',count:30}]};
 const labels={VEN:'Venezuela',NLD:'Netherlands'},world=lineText(buildExactTopicStories(x,{period:'2026-Q1',zoom:'world',labels,...baseWording})),eu=lineText(buildExactTopicStories(x,{period:'2026-Q1',zoom:'eu',labels,...baseWording}));
 assert.match(world,/^Venezuela drew the busiest debate on the map: 40 MEPs spoke on Situation in Venezuela \(20 January\)\. The Netherlands drew the most questions \(30\)\.$/);
 assert.match(eu,/^In Europe and its neighbours, the busiest debate was Situation in Venezuela \(20 January\), with 40 MEPs speaking\. The Netherlands drew the most questions \(30\)\.$/);
 x.periodWinners['2026-Q1'].busiestNonUrgencyDebates=[];
 assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1',zoom:'eu',labels,...baseWording})),/^In Europe and its neighbours, the Netherlands drew the most questions \(30\)\.$/);
 x.periodWinners['2026-Q1']={risingQuestionPlaces:[{id:'GBR',count:12,ratio:3,baselineMean:4}]};
 assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1',zoom:'eu',labels:{GBR:'United Kingdom'},...baseWording})),/^In Europe and its neighbours, questions about the United Kingdom rose to 12, from an average of 4 a quarter\.$/);
 // Europe-only urgency debates name only their places in view.
 x.periodCounts[0].urgencyDebates=2;x.debates=[{id:'U1',title:'Case in Venezuela',date:'2026-01-21',meps:9,format:'urgency',places:{VEN:['title']},primaryPlace:'VEN',docs:[]},{id:'U2',title:'Case in Georgia',date:'2026-02-11',meps:9,format:'urgency',places:{GEO:['title']},primaryPlace:'GEO',docs:[]}];x.sets={urgencyDebates:{'2026-Q1':['U1','U2']}};x.periodWinners['2026-Q1']={};
 assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1',zoom:'eu',labels:{...labels,GEO:'Georgia'},...baseWording})),/^In Europe and its neighbours, two urgency debates on human rights took up Georgia, among other cases\.$/);
 assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1',zoom:'world',labels:{...labels,GEO:'Georgia'},...baseWording})),/^Two urgency debates on human rights took up Venezuela and Georgia\.$/);
});

test('zoom: the Europe opener changes only the leading slot, never titles',()=>{
 const x=quarter(base());x.debates=[{id:'D',title:'The Netherlands',date:'2026-01-20',meps:40,places:{},primaryPlace:null,docs:[]}];x.periodWinners['2026-Q1']={busiestNonUrgencyDebates:[{id:'D',meps:40}]};
 assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1',zoom:'eu',labels:{NLD:'Netherlands'},...baseWording})),/^In Europe and its neighbours, the busiest debate was The Netherlands \(20 January\), with 40 MEPs speaking\.$/);
 x.debates[0].places={NLD:['title']};x.debates[0].primaryPlace='NLD';
 assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1',zoom:'eu',labels:{NLD:'Netherlands'},...baseWording})),/^In Europe and its neighbours, the Netherlands drew the busiest debate: 40 MEPs spoke on The Netherlands \(20 January\)\.$/);
});

test('zoom: Russia is in the Europe view and named in its urgency debates',()=>{
 const x=quarter(base());x.periodCounts[0].urgencyDebates=2;x.debates=[['U1','2026-01-21','Case in Russia','RUS'],['U2','2026-02-11','Case in Georgia','GEO']].map(([id,date,title,p])=>({id,date,title,meps:9,format:'urgency',places:{[p]:['title']},primaryPlace:p,docs:[]}));x.sets={urgencyDebates:{'2026-Q1':['U1','U2']}};
 assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1',zoom:'eu',labels:{RUS:'Russia',GEO:'Georgia'},...baseWording})),/^In Europe and its neighbours, two urgency debates on human rights took up Russia and Georgia\.$/);
});

test('zoom: places in view follow the Europe set reported with the story facts',()=>{
 const x=quarter(base());x.periodCounts[0].urgencyDebates=2;x.debates=[['U1','2026-01-21','Case in Russia','RUS'],['U2','2026-02-11','Case in Georgia','GEO']].map(([id,date,title,p])=>({id,date,title,meps:9,format:'urgency',places:{[p]:['title']},primaryPlace:p,docs:[]}));x.sets={urgencyDebates:{'2026-Q1':['U1','U2']}};
 x.europe=['GEO','UKR'];
 assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1',zoom:'eu',labels:{RUS:'Russia',GEO:'Georgia'},...baseWording})),/^In Europe and its neighbours, two urgency debates on human rights took up Georgia, among other cases\.$/);
});


test('outside speakers enumerate all names, retain date ties and link only names to complete address sets',()=>{
 const x=base();x.periodCounts=[{period:'2026-Q1'}];const a=(personId,name,country,date,debateId)=>({personId,name,country,date,debateId,id:personId+':'+debateId});
 x.outsideSpeakers=[a('4','Nikol','ARM','2026-03-11','D4'),a('2','Marcelo','PRT','2026-01-21','D2'),a('1','Felipe','ESP','2026-01-21','D1'),a('3','Volodymyr','UKR','2026-02-24','D3'),a('3','Volodymyr','UKR','2026-02-25','D5'),a('5','Canadian','CAN','2026-03-12','D6')];
 const map=zoom=>buildExactTopicStories(x,{period:'2026-Q1',zoom,labels:{ESP:'Spain',PRT:'Portugal',UKR:'Ukraine',ARM:'Armenia',CAN:'Canada'}}).find(l=>l.id.startsWith('topics.story.map.outside'));
 const speakers=map('world').values.speakers;assert.deepEqual(speakers.map(s=>s.values.speaker.text),['Felipe','Marcelo','Volodymyr','Nikol','Canadian']);assert.equal(speakers[2].values.speaker.records.length,2);assert.equal(speakers[0].values.place,'Spain');assert.equal(speakers[0].values.speaker.records[0].id,'D1');assert.equal(map('eu').values.speakers.length,4);
 const place=buildExactTopicStories(x,{period:'2026-Q1',place:'UKR',labels:{UKR:'Ukraine'}}).filter(l=>l.id==='topics.story.place.outside');assert.equal(place.length,2);assert.equal(place[0].values.date,'24 February 2026');assert.equal(place[0].values.place,'Ukraine');assert.equal(place[0].values.speaker.records[0].id,'D3');
 delete x.outsideSpeakers;assert(!buildExactTopicStories(x,{period:'2026-Q1'}).some(l=>l.id.includes('outside')));
});

test('outside Europe scope follows the published generation rather than the current static set',()=>{
 const x=base();x.periodCounts=[{period:'2026-Q1'}];x.outsideSpeakers=[{id:'1',personId:'1',name:'Example speaker',country:'UKR',date:'2026-02-24',debateId:'D'}];
 x.europe=['ESP'];assert(!buildExactTopicStories(x,{period:'2026-Q1',zoom:'eu'}).some(l=>l.id.includes('outside')));
 x.europe=['UKR'];assert(buildExactTopicStories(x,{period:'2026-Q1',zoom:'eu'}).some(l=>l.id.includes('outside')));
});

test('place-led map merges both channels with quarter-specific browse links',()=>{
 const x=quarter(base()),q='2026-Q1',labels={UKR:'Ukraine',TUR:'Türkiye',MAR:'Morocco'};
 x.debates=[{id:'D',title:'Ukraine report',date:'2026-01-20',meps:69,primaryPlace:'UKR',places:{UKR:['title']},docs:[]}];
 x.periodWinners[q]={busiestNonUrgencyDebates:[{id:'D',meps:69}],mostQuestionedPlaces:[{id:'TUR',count:23}],risingQuestionPlaces:[{id:'MAR',count:9,ratio:2.5,baselineMean:3.6}],mostDebatedPlaces:[{id:'UKR',count:3}]};
 x.series={UKR:{[q]:{questions:11,debates:3}},TUR:{[q]:{questions:23,debates:1}},MAR:{[q]:{questions:9,debates:2}}};
 const selection={period:q,labels,excludeOwn:true,...baseWording},rows=buildExactTopicStories(x,selection),text=lineText(rows);
 assert.match(text,/Ukraine came up in the most debates \(three\), including the busiest on the map, and drew 11 questions: 69 MEPs spoke on Ukraine report \(20 January\)\./);
 assert.match(text,/Türkiye drew the most questions \(23\) and one debate\./);
 assert.match(text,/Questions about Morocco rose to nine, from an average of 3.6 a quarter; it also came up in two debates\./);
 assert.equal((text.match(/Ukraine/g)||[]).length,2,'one sentence, including source title');assert.equal((text.match(/most debates/g)||[]).length,1);
 assert.equal(rows[0].values.questions.browse.place,'UKR');assert.match(rows[0].values.questions.setKey,/not-home/);assert.match(rows[0].values.questions.setKey,/2026-Q1/);
 assert.equal(rows[1].values.debates.browse.list,'debates');assert.equal(rows[2].values.changes[0].values.debates.browse.place,'MAR');
 x.periodWinners[q].mostQuestionedPlaces=[{id:'UKR',count:11}];
 assert.match(lineText(buildExactTopicStories(x,selection)),/and drew the most questions \(11\)/);assert.equal(buildExactTopicStories(x,selection).filter(r=>r.id.includes('lead.')).length,0);
 x.periodWinners[q].mostQuestionedPlaces=[{id:'MAR',count:9}];
 const merged=lineText(buildExactTopicStories(x,selection));assert.match(merged,/more than for any other place/);assert.equal((merged.match(/Morocco/g)||[]).length,1);
 for(const n of [0,undefined,null]){x.series.UKR[q].questions=n;x.series.MAR[q].debates=n;const t=lineText(buildExactTopicStories(x,selection));assert(!t.includes('11 questions'));assert(!t.includes('and zero'));assert(!t.includes('two debates'));}
 x.series.UKR[q].questions=7;assert.match(lineText(buildExactTopicStories(x,{...selection,zoom:'eu'})),/^In Europe and its neighbours, Ukraine/);
 const all=buildExactTopicStories(x,{...selection,excludeOwn:false});assert.match(all[0].values.questions.setKey,/:all:/);
 x.series.UKR[q].questions=12;assert.match(lineText(buildExactTopicStories(x,{...selection,excludeOwn:false})),/and drew 12 questions/);
});

test('place-led ties retain joint winners, omit already told places and keep exact counts',()=>{
 const x=quarter(base()),q='2026-Q1',s={period:q,labels:{UKR:'Ukraine',TUR:'Türkiye',MAR:'Morocco'},...baseWording};
 x.periodWinners[q]={mostQuestionedPlaces:[{id:'UKR',count:11},{id:'TUR',count:11}],mostDebatedPlaces:[{id:'UKR',count:3},{id:'MAR',count:3}]};x.series={UKR:{[q]:{questions:11,debates:3}},TUR:{[q]:{questions:11,debates:1}},MAR:{[q]:{questions:2,debates:3}}};
 const text=lineText(buildExactTopicStories(x,s));assert.match(text,/Ukraine \(three debates\) and Türkiye \(one debate\) drew the most questions \(11 each\)/);assert.match(text,/Morocco also came up in three debates/);assert(!text.includes('more than any other place'));assert.equal((text.match(/Ukraine/g)||[]).length,1);
});

test('the busiest place retains a rise and a simultaneous leader streak in one sentence',()=>{
 const x=quarter(base()),q='2026-Q1';x.debates=[{id:'D',title:'Report',date:'2026-01-20',meps:69,primaryPlace:'UKR',places:{UKR:['title']},docs:[]}];
 x.periodWinners[q]={busiestNonUrgencyDebates:[{id:'D',meps:69}],mostQuestionedPlaces:[{id:'UKR',count:11}],risingQuestionPlaces:[{id:'UKR',count:11,ratio:3,baselineMean:3.6}]};
 x.periodWinners['2025-Q3']={mostQuestionedPlaces:[{id:'UKR',count:9}]};x.periodWinners['2025-Q4']={mostQuestionedPlaces:[{id:'UKR',count:10}]};x.series={UKR:{[q]:{questions:11,debates:1}}};
 const text=lineText(buildExactTopicStories(x,{period:q,labels:{UKR:'Ukraine'},...baseWording}));assert.match(text,/both the busiest debate/);assert.match(text,/third quarter running/);assert.match(text,/up from an average of 3.6 a quarter/);assert.equal((text.match(/Ukraine/g)||[]).length,1);
});

test('documents mode preserves main’s busiest, adopted leader, rise and every debate co-leader',()=>{
 const x=quarter(base()),q='2026-Q1';x.debates=[{id:'D',title:'Report',date:'2026-01-20',meps:10,primaryPlace:'USA',places:{USA:['title']},docs:[]}];
 x.periodWinners[q]={busiestNonUrgencyDebates:[{id:'D',meps:10}],topAdoptedPlaces:[{id:'USA',count:3},{id:'TUR',count:2}],risingDocumentPlaces:[{id:'USA',count:9,baselineMean:2,ratio:4.5}],mostDebatedPlaces:[{id:'USA',count:3},{id:'UKR',count:3}]};x.series={USA:{[q]:{questions:7,debates:3}}};
 const rows=buildExactTopicStories(x,{period:q,mode:'d',labels:{USA:'United States',TUR:'Türkiye',UKR:'Ukraine'},...baseWording});
 // Rendered by main's builder for the same exact winner payload (base 92ebf130).
 assert.equal(lineText(rows),'The United States drew the busiest debate on the map: 10 MEPs spoke on Report (20 January). The United States and Ukraine came up in the most debates (three debates each). Parliament adopted texts naming the United States (three) and Türkiye (two). Plenary texts on the United States rose to nine, from an average of 2 a quarter.');
 assert.equal(rows.length,4);assert.equal(rows[1].id,'topics.story.exact.mostDebatedMany');assert.equal(rows[1].values.count.text.message,'topics.story.links.debatesEach');assert.equal(rows[1].values.places.length,2);
 x.periodWinners[q].risingDocumentPlaces.push({id:'UKR',count:9,baselineMean:2,ratio:4.5});const grouped=buildExactTopicStories(x,{period:q,mode:'d',labels:{USA:'United States',TUR:'Türkiye',UKR:'Ukraine'},...baseWording});const rise=grouped.find(l=>l.id==='topics.story.exact.rises').values.changes[0];assert.equal(rise.message,'topics.story.exact.documentRiseEach');assert.equal(rise.values.places.length,2);
});

test('a busiest debate place retains its tied question lead without being named twice',()=>{
 const x=quarter(base()),q='2026-Q1';x.debates=[{id:'D',title:'Report',date:'2026-01-20',meps:10,primaryPlace:'UKR',places:{UKR:['title']},docs:[]}];x.periodWinners[q]={busiestNonUrgencyDebates:[{id:'D',meps:10}],mostQuestionedPlaces:[{id:'UKR',count:11},{id:'TUR',count:11}]};x.series={UKR:{[q]:{questions:11}}};
 const text=lineText(buildExactTopicStories(x,{period:q,labels:{UKR:'Ukraine',TUR:'Türkiye'},...baseWording}));assert.match(text,/11 questions \(joint leader in questions\)/);assert.match(text,/Türkiye shared the lead in questions/);assert.equal((text.match(/Ukraine/g)||[]).length,1);
});

test('most-debated prose groups co-leaders and drops unavailable question parentheses',()=>{
 const x=quarter(base()),q='2026-Q1',s={period:q,labels:{RUS:'Russia',USA:'United States'},...baseWording};
 x.periodWinners[q]={mostDebatedPlaces:[{id:'RUS',count:3},{id:'USA',count:3}]};x.series={RUS:{[q]:{questions:12,debates:3}},USA:{[q]:{questions:13,debates:3}}};
 let rows=buildExactTopicStories(x,s);assert.equal(lineText(rows),'Russia (12 questions) and the United States (13 questions) came up in the most debates, three each.');
 assert.match(rows[0].values.places[0].values.questions.setKey,/questions:RUS:2026-Q1/);assert.match(rows[0].values.count.setKey,/debates:RUS%2CUSA:2026-Q1/);
 for(const count of [0,null,undefined]){x.series.USA[q].questions=count;assert.equal(lineText(buildExactTopicStories(x,s)),'Russia (12 questions) and the United States came up in the most debates, three each.');}
 x.periodWinners[q].mostDebatedPlaces=[{id:'RUS',count:3}];assert.equal(lineText(buildExactTopicStories(x,s)),'Russia came up in the most debates (three) and drew 12 questions.');
 x.series.RUS[q].questions=0;assert.equal(lineText(buildExactTopicStories(x,s)),'Russia came up in the most debates (three).');
});

test('rising question co-leaders retain every main winner in one budgeted sentence',()=>{
 const x=quarter(base()),q='2026-Q1',labels={UKR:'Ukraine',TUR:'Türkiye',MAR:'Morocco'};
 x.periodWinners[q]={mostQuestionedPlaces:['UKR','TUR','MAR'].map(id=>({id,count:11})),risingQuestionPlaces:[{id:'MAR',count:11,baselineMean:1,ratio:11}]};x.series={UKR:{[q]:{debates:2}},TUR:{[q]:{debates:0}}};
 const rows=buildExactTopicStories(x,{period:q,labels,...baseWording}),text=lineText(rows);
 assert.equal(rows.length,1);assert.equal(text,'Ukraine (two debates), Türkiye and Morocco (up from an average of 1 a quarter) drew the most questions (11 each).');
 assert.deepEqual(rows[0].values.places.map(p=>typeof p==='string'?p:p.values.place),x.periodWinners[q].mostQuestionedPlaces.map(p=>labels[p.id]));assert.equal(rows[0].values.questions.expected,11);
 assert.match(rows[0].values.places[2].values.average.setKey,/questions:MAR/);
 x.periodWinners[q].risingQuestionPlaces.push({id:'IND',count:12,baselineMean:1,ratio:12});x.periodWinners[q].busiestNonUrgencyDebates=[{id:'D',meps:40}];x.debates=[{id:'D',title:'Report',date:'2026-01-20',meps:40,places:{},docs:[]},{id:'U',title:'Urgency',date:'2026-01-21',meps:10,primaryPlace:'ZMB',places:{ZMB:['title']},docs:[]}];x.sets.urgencyDebates={[q]:['U']};x.periodCounts[0].urgencyDebates=1;
 const budgeted=buildExactTopicStories(x,{period:q,labels:{...labels,IND:'India',ZMB:'Zambia'},...baseWording});assert.equal(budgeted.length,4);assert.match(lineText(budgeted),/Ukraine \(two debates\), Türkiye and Morocco .*drew the most questions \(11 each\)/);assert.match(lineText(budgeted),/India jumped to 12/);assert.match(lineText(budgeted),/urgency/);
});

test('the busiest place keeps main’s most-debated fact and names a co-leader when its line cannot fit',()=>{
 const x=quarter(base()),q='2026-Q1',labels={UKR:'Ukraine',SRB:'Serbia',TUR:'Türkiye',MAR:'Morocco',ZMB:'Zambia'};
 x.debates=[{id:'D',title:'Report',date:'2026-01-20',meps:86,primaryPlace:'UKR',places:{UKR:['title']},docs:[]},{id:'U',title:'Urgency',date:'2026-01-21',meps:10,primaryPlace:'ZMB',places:{ZMB:['title']},docs:[]}];x.sets.urgencyDebates={[q]:['U']};x.periodCounts[0].urgencyDebates=1;
 x.periodWinners[q]={busiestNonUrgencyDebates:[{id:'D',meps:86}],mostDebatedPlaces:[{id:'UKR',count:4},{id:'SRB',count:4}],mostQuestionedPlaces:[{id:'TUR',count:23}],risingQuestionPlaces:[{id:'MAR',count:9,baselineMean:3.6,ratio:2.5}]};x.series={UKR:{[q]:{questions:16,debates:4}},SRB:{[q]:{questions:1,debates:4}}};
 const selection={period:q,labels,...baseWording};let rows=buildExactTopicStories(x,selection),text=lineText(rows);
 assert.equal(rows.length,4);assert.match(text,/Ukraine came up in the most debates \(four, as did Serbia\), including the busiest on the map, and drew 16 questions:/);assert.equal(rows[0].values.debateCount.values.count.expected,4);
 x.periodWinners[q].risingQuestionPlaces=[];rows=buildExactTopicStories(x,{...selection,zoom:'eu'});text=lineText(rows);assert.match(text,/In Europe and its neighbours, Ukraine came up in the most debates \(four\), including the busiest,/);assert.match(text,/Serbia also came up in four debates and drew one question/);assert(!text.includes('as did Serbia'));
 x.periodWinners[q].mostQuestionedPlaces=[{id:'UKR',count:16}];assert.match(lineText(buildExactTopicStories(x,selection)),/and drew the most questions \(16\):/);
 x.series.UKR[q].questions=0;x.periodWinners[q].mostQuestionedPlaces=[];assert.match(lineText(buildExactTopicStories(x,selection)),/including the busiest on the map: 86 MEPs/);
});

test('partial combined wins keep so far in both plain and rising shapes, including Europe',()=>{
 const x=quarter(base()),q='2026-Q1',s={period:q,labels:{NLD:'Netherlands'},...baseWording};x.partial={first:null,last:'2026-02-01'};
 x.debates=[{id:'D',title:'Report',date:'2026-01-20',meps:10,primaryPlace:'NLD',places:{USA:['title']},docs:[]}];x.periodWinners[q]={busiestNonUrgencyDebates:[{id:'D',meps:10}],mostQuestionedPlaces:[{id:'NLD',count:11}]};x.series={NLD:{[q]:{questions:11}}};
 for(const rising of [false,true]){x.periodWinners[q].risingQuestionPlaces=rising?[{id:'NLD',count:11,baselineMean:1,ratio:11}]:[];for(const zoom of ['world','eu']){
  const text=lineText(buildExactTopicStories(x,{...s,zoom}));assert.match(text,/[Ss]o far, the Netherlands has drawn both the busiest debate/);assert.match(text,/the most questions \(11/);assert.equal(text.includes('up from an average of 1 a quarter'),rising);assert(!text.includes('quarter running'));
  if(zoom==='eu')assert.match(text,/^In Europe and its neighbours, so far,/);
  x.periodWinners[q].mostDebatedPlaces=[{id:'NLD',count:4}];const ranked=lineText(buildExactTopicStories(x,{...s,zoom}));assert.match(ranked,/[Ss]o far, the Netherlands has come up in the most debates \(four\), including the busiest[^,]*, and has drawn the most questions/);assert.match(ranked,/the most questions \(11/);delete x.periodWinners[q].mostDebatedPlaces;
 }}
});

test('approved quarter continuity and a rise with debates render without repeated units',()=>{
 const x=quarter(base()),q='2026-Q1';x.periods=['2024-Q4','2025-Q1','2025-Q2','2025-Q3','2025-Q4',q];x.periodWinners=Object.fromEntries(x.periods.map(p=>[p,{mostQuestionedPlaces:[{id:'USA',count:p===q?22:17}]}]));x.series={USA:{[q]:{debates:3}}};
 assert.equal(lineText(buildExactTopicStories(x,{period:q,labels:{USA:'United States'},...baseWording})),'The United States drew the most questions for the sixth quarter running (22) and three debates.');
 x.periodWinners['2024-Q4']={};assert.equal(lineText(buildExactTopicStories(x,{period:q,labels:{USA:'United States'},...baseWording})),'The United States drew the most questions for the fifth quarter running (22) and three debates.');
 x.periodWinners['2025-Q4']={risingQuestionPlaces:[{id:'CHN',count:13,baselineMean:4.8,ratio:2.7}]};x.periodCounts.push({period:'2025-Q4'});x.series.CHN={'2025-Q4':{debates:2}};
 assert.equal(lineText(buildExactTopicStories(x,{period:'2025-Q4',labels:{CHN:'China'},...baseWording})),'Questions about China rose to 13, from an average of 4.8 a quarter; it also came up in two debates.');
});

test('a busiest place keeps its joint question lead when the series has no question count',()=>{
 const x=quarter(base()),q='2026-Q1',s={period:q,labels:{UKR:'Ukraine',TUR:'Türkiye'},...baseWording};x.debates=[{id:'D',title:'Report',date:'2026-01-20',meps:40,primaryPlace:'UKR',places:{UKR:['title']},docs:[]}];
 x.periodWinners[q]={busiestNonUrgencyDebates:[{id:'D',meps:40}],mostQuestionedPlaces:[{id:'UKR',count:16},{id:'TUR',count:16}]};
 // Main renders "Ukraine and Türkiye were the most asked-about places (16 questions each)."
 const text=lineText(buildExactTopicStories(x,s));
 assert.match(text,/^Ukraine drew the busiest debate on the map and 16 questions \(joint leader in questions\): 40 MEPs/);assert.match(text,/Türkiye shared the lead in questions \(16\)\./);
});

test('tied leaders with the same rise share one rise clause and keep jumped or rose',()=>{
 const x=quarter(base()),q='2026-Q1',s={period:q,labels:{UKR:'Ukraine',TUR:'Türkiye',MAR:'Morocco'},...baseWording};
 x.periodWinners[q]={mostQuestionedPlaces:['UKR','TUR','MAR'].map(id=>({id,count:11})),risingQuestionPlaces:[{id:'UKR',count:11,baselineMean:1,ratio:11},{id:'MAR',count:11,baselineMean:1,ratio:11}]};x.series={UKR:{[q]:{debates:2}}};
 let rows=buildExactTopicStories(x,s);assert.equal(rows.length,1);
 assert.equal(lineText(rows),'Ukraine (two debates), Türkiye and Morocco drew the most questions (11 each), with Ukraine and Morocco each jumping from an average of 1 a quarter.');
 assert.equal(rows[0].values.average.browse.places,'MAR,UKR');
 x.periodWinners[q].mostQuestionedPlaces=['UKR','MAR'].map(id=>({id,count:11}));for(const r of x.periodWinners[q].risingQuestionPlaces){r.baselineMean=4;r.ratio=2.75;}
 assert.equal(lineText(buildExactTopicStories(x,s)),'Ukraine (two debates) and Morocco drew the most questions (11 each), each rising from an average of 4 a quarter.');
 x.periodWinners[q].risingQuestionPlaces[1].baselineMean=3;
 assert.equal(lineText(buildExactTopicStories(x,s)),'Ukraine (two debates; up from an average of 4 a quarter) and Morocco (up from an average of 3 a quarter) drew the most questions (11 each).');
});

test('rising leaders inside the EU keep their questions from home-elected authors',()=>{
 const x=quarter(base()),q='2026-Q1',s={period:q,labels:{ESP:'Spain',ITA:'Italy'},...baseWording};
 x.periodWinners[q]={mostQuestionedPlaces:[{id:'ESP',count:9},{id:'ITA',count:9}],risingQuestionPlaces:[{id:'ESP',count:9,baselineMean:4,ratio:2.25}]};x.series={ESP:{[q]:{questionHome:9}}};
 assert.equal(lineText(buildExactTopicStories(x,s)),'Spain (up from an average of 4 a quarter, each with an author elected there) and Italy drew the most questions (9 each).');
 assert(!lineText(buildExactTopicStories(x,{...s,excludeOwn:true})).includes('elected there'));
 x.debates=[{id:'D',title:'Report',date:'2026-01-20',meps:40,primaryPlace:'ESP',places:{ESP:['title']},docs:[]}];x.periodWinners[q]={busiestNonUrgencyDebates:[{id:'D',meps:40}],mostQuestionedPlaces:[{id:'ESP',count:9}],risingQuestionPlaces:[{id:'ESP',count:9,baselineMean:4,ratio:2.25}]};
 assert.match(lineText(buildExactTopicStories(x,s)),/the most questions \(9, up from an average of 4 a quarter, each with an author elected there\): 40 MEPs/);
});

test('a rising busiest place keeps its rise without a series question count',()=>{
 const x=quarter(base()),q='2026-Q1',s={period:q,labels:{UKR:'Ukraine',TUR:'Türkiye'},...baseWording};x.debates=[{id:'D',title:'Report',date:'2026-01-20',meps:40,primaryPlace:'UKR',places:{UKR:['title']},docs:[]}];
 x.periodWinners[q]={busiestNonUrgencyDebates:[{id:'D',meps:40}],mostQuestionedPlaces:[{id:'TUR',count:23}],risingQuestionPlaces:[{id:'UKR',count:7,baselineMean:2,ratio:3.5}]};
 // Main renders "Questions about Ukraine rose to seven, from an average of 2 a quarter."
 assert.match(lineText(buildExactTopicStories(x,s)),/^Ukraine drew the busiest debate on the map and seven questions, up from an average of 2 a quarter: 40 MEPs/);
});

test('a rare-baseline co-leader keeps the rarely-asked sense',()=>{
 const x=quarter(base()),q='2026-Q1',s={period:q,labels:{UKR:'Ukraine',MAR:'Morocco'},...baseWording};
 x.periodWinners[q]={mostQuestionedPlaces:[{id:'UKR',count:11},{id:'MAR',count:11}],risingQuestionPlaces:[{id:'MAR',count:11,baselineMean:0.2,ratio:55}]};x.series={MAR:{[q]:{debates:2}}};
 assert.equal(lineText(buildExactTopicStories(x,s)),'Ukraine and Morocco (two debates; rarely asked about before) drew the most questions (11 each).');
});

for(const language of ['en','fr','hu'])test('outside map title in '+language+' and country fallback',()=>{
 const roles={en:{role:'King of Spain',languageTag:'es-t-en-mtec'},fr:{role:"roi d’Espagne",languageTag:'fr'},hu:{role:'spanyol király',languageTag:'hu'}};
 const x=base();x.periodCounts=[{period:'2026-Q1'}];x.outsideSpeakers=[{personId:'1',name:'Felipe VI',country:'ESP',date:'2026-01-21',debateId:'D',roles}];
 for(const zoom of ['world','eu']){
  const row=()=>buildExactTopicStories(x,{language,period:'2026-Q1',zoom,labels:{ESP:'Local country'}}).find(l=>l.id.startsWith('topics.story.map.outside'));
  const phrase=row().values.speakers[0];assert.equal(phrase.message,'topics.story.outside.speakerRole');assert.equal(phrase.values.role.text,roles[language].role);assert.equal(phrase.values.role.labelLanguage,language);assert.equal(phrase.values.speaker.records[0].id,'D');
 }
 delete roles[language];const fallback=buildExactTopicStories(x,{language,period:'2026-Q1',labels:{ESP:'Local country'}}).find(l=>l.id.startsWith('topics.story.map.outside')).values.speakers[0];assert.equal(fallback.values.place,{en:'Spain',fr:'Espagne',hu:'Spanyolország'}[language]);
 roles[language]={role:null};assert.equal(buildExactTopicStories(x,{language,period:'2026-Q1',labels:{ESP:'Local country'}}).find(l=>l.id.startsWith('topics.story.map.outside')).values.speakers[0].values.place,{en:'Spain',fr:'Espagne',hu:'Spanyolország'}[language]);
});

test('every title keeps its lang in a multi-speaker rendered story',async t=>{
 const {Window}=await import('happy-dom'),{createElement:h,act}=await import('react'),{freshLoader}=await import('./test-support/viteRunner.mjs');
 const window=new Window({url:'http://localhost/?view=geopolitics&t-q=2026-Q1'}),globals={window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,Event:window.Event,PopStateEvent:window.PopStateEvent,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const[k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const[k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const payload=base();payload.counts={questions:0,debates:0};payload.periodCounts=[{period:'2026-Q1'}];payload.outsideSpeakers=[['1','Felipe VI','ESP','King of Spain'],['2','Marcelo Rebelo de Sousa','PRT','President of the Republic of Portugal']].map(([personId,name,country,role])=>({personId,name,country,date:'2026-01-21',debateId:'D'+personId,roles:{en:{role}}}));
 t.mock.method(globalThis,'fetch',async()=>Response.json(payload));load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'outside-role-render'});
 const {TopicStories}=await load('/src/TopicStories.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);root=createRoot(node);
 await act(async()=>root.render(h(TopicStories,{selection:{period:'2026-Q1',periods:['2026-Q1']}})));
 for(let i=0;i<30&&!node.textContent.includes('King of Spain');i++)await act(async()=>new Promise(r=>setTimeout(r,20)));
 for(const title of ['King of Spain','President of the Republic of Portugal'])assert([...node.querySelectorAll('span[lang="en"]')].some(span=>span.textContent===title),node.innerHTML);
 assert.equal([...node.querySelectorAll('a')].filter(a=>['Felipe VI','Marcelo Rebelo de Sousa'].includes(a.textContent)).length,2);
});

test('two guests at the same formal sitting retain distinct exact speech focus in map and place stories',()=>{
 const x=base(),debateId='MTG-PL-2026-01-21-PVCRE-ITM-5';x.periodCounts=[{period:'2026-Q1'}];
 x.outsideSpeakers=[['1','Felipe','ESP','100'],['2','Marcelo','PRT','200']].map(([personId,name,country,n])=>({id:personId+':'+debateId,personId,name,country,date:'2026-01-21',debateId,headerSource:{url:'https://data.europarl.europa.eu/api/v2/speeches/MTG-PL-2026-01-21-OTH-'+n+'?language=mul'}}));
 const map=buildExactTopicStories(x,{period:'2026-Q1'}).find(l=>l.id==='topics.story.map.outside');assert.deepEqual(map.values.speakers.map(s=>s.values.speaker.records[0].speechId),['MTG-PL-2026-01-21-OTH-100','MTG-PL-2026-01-21-OTH-200']);
 const place=buildExactTopicStories(x,{period:'2026-Q1',place:'ESP'}).find(l=>l.id==='topics.story.place.outside');assert.equal(place.values.speaker.records[0].speechId,'MTG-PL-2026-01-21-OTH-100');
 x.outsideSpeakers=x.outsideSpeakers.map(a=>{const speechId=a.headerSource.url.split('/speeches/')[1].split('?')[0];const {headerSource,...publicRow}=a;return {...publicRow,speechId};});
 const narrowed=buildExactTopicStories(x,{period:'2026-Q1'}).find(l=>l.id==='topics.story.map.outside');assert.deepEqual(narrowed.values.speakers.map(s=>s.values.speaker.records[0].speechId),['MTG-PL-2026-01-21-OTH-100','MTG-PL-2026-01-21-OTH-200']);
});
