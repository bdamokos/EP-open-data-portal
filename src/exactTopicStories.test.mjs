import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExactTopicStories,storyFactsRoute,storyRecord} from './exactTopicStories.mjs';
const base=()=>({ready:true,counts:{questions:53,questionElsewhere:7,questionUnknown:2,debates:9,adoptedTexts:0,groups:73},periodCounts:[],periodWinners:{},winners:{},sets:{},questions:[{id:'one',d:'2026-01-01',t:'Only hydrated question',places:['IRN'],home:[]}],debates:[],docs:[],topic:{label:'Trade'}});
const flatten=v=>v==null?'':typeof v==='string'?v:Array.isArray(v)?v.map(flatten).join('|'):v.text?flatten(v.text):v.message?JSON.stringify(v):'';
test('live totals use exact counters even when evidence arrays have one record',()=>{const x=base(),lines=buildExactTopicStories(x,{place:'IRN',language:'en'});assert.match(flatten(lines[0].values.questions),/53/);assert.match(flatten(lines[1].values.debates),/nine/);assert.equal(lines[0].values.questions.browse.list,'questions');const topic=buildExactTopicStories(x,{topic:'oeil:1.10',language:'en'});assert.match(flatten(topic[0].values.groups),/73/);});
test('all tied busiest winners are retained together and low-speaker evidence cannot feature',()=>{const x=base();x.periodCounts=[{period:'2026-Q1',questions:0}];x.debates=Array.from({length:6},(_,i)=>({id:'D'+i,date:'2026-01-01',q:'2026-Q1',title:'19.2. REPORT on Exact '+i,rawTitle:'19.2. REPORT on Exact '+i,meps:i===5?2:10,places:{IRN:['title']},docs:[]}));x.periodWinners['2026-Q1']={busiestNonUrgencyDebates:x.debates.map(d=>({id:d.id,meps:d.meps}))};const rows=buildExactTopicStories(x,{period:'2026-Q1'});assert.equal(rows[0].values.debates.length,5);assert.equal(rows[0].values.debates[0].values.title.text,'Exact 0');assert.equal(rows.length,1);});
test('leaders use winner counters, include every tie, and never infer leadership from evidence',()=>{const x=base();x.periodCounts=[{period:'2026-Q1'}];x.periodWinners['2026-Q1']={mostQuestionedPlaces:[{id:'GRC',count:18},{id:'ESP',count:18}]};const rows=buildExactTopicStories(x,{period:'2026-Q1',labels:{GRC:'Greece',ESP:'Spain'}});assert.equal(rows[0].id,'topics.story.map.lead.tied');assert.equal(rows[0].values.places.length,2);assert.match(flatten(rows[0].values.questions),/18/);});
test('browse requests preserve qualification, quarter, place and opaque cursor',()=>{const route=storyFactsRoute({place:'GRC',period:'2026-Q1',excludeOwn:true},{list:'questions',cursor:'opaque_123'}),p=new URLSearchParams(route.split('?')[1]);assert.equal(p.get('scope'),'place');assert.equal(p.get('key'),'place:GRC');assert.equal(p.get('period'),'2026-Q1');assert.equal(p.get('askers'),'not-home');assert.equal(p.get('cursor'),'opaque_123');});
test('unavailable facts do not manufacture zero stories',()=>{assert.deepEqual(buildExactTopicStories({ready:false},{}),[]);assert.deepEqual(buildExactTopicStories(null,{}),[]);});

test('caption title cleanup strips only agenda numbers and the specified prefixes',async()=>{const {cleanStoryTitle}=await import('./topicStoryModel.mjs');assert.equal(cleanStoryTitle('19.2. JOINT MOTION FOR A RESOLUTION on Iran (debate)'), 'Iran');assert.equal(cleanStoryTitle('RECOMMENDATION on Iran'),'Iran');for(const text of ['OPINION on Iran','Plain title: 16. Part'])assert.equal(cleanStoryTitle(text),text);});

test('live story counters open keyset pages and More preserves every prior record',async t=>{
 const {Window}=await import('happy-dom'),{createElement:h,act}=await import('react'),{freshLoader}=await import('./test-support/viteRunner.mjs');const window=new Window({url:'http://localhost/?view=topics&place=IRN'}),globals={window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,Event:window.Event,PopStateEvent:window.PopStateEvent,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load,stale=true;const calls=[];t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);if(u.pathname==='/api/source-record')return Response.json({payload:{data:[]}});assert.equal(u.pathname,'/api/topics/story-facts');calls.push(u);if(u.searchParams.get('cursor')==='page-two'&&stale){stale=false;return Response.json({error:{message:'Reload this list.'}},{status:409});}const x=base();x.counts.debates=0;if(u.searchParams.has('list')){const second=u.searchParams.get('cursor')==='page-two',id=second?'E-10-2026-000002':'E-10-2026-000001';x.questions=[{id,d:'2026-01-01',t:second?'Second exact record':'First exact record',places:['IRN'],home:[]}];x.page={list:'questions',total:53,items:[{id,kind:'question',date:'2026-02-01'}],nextCursor:second?null:'page-two'};}return Response.json(x);});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'exact-story-pagination'});const {TopicStories}=await load('/src/TopicStories.tsx'),{createRoot}=await import('react-dom/client'),node=document.createElement('div');document.body.append(node);root=createRoot(node);
 const wait=async text=>{for(let i=0;i<30&&!node.textContent.includes(text);i++)await act(async()=>new Promise(r=>setTimeout(r,20)));assert(node.textContent.includes(text),node.textContent);};
 await act(async()=>root.render(h(TopicStories,{selection:{periods:[],place:'IRN',labels:{IRN:'Iran'}}})));await wait('53 questions');await act(async()=>node.querySelector('.topic-story a').click());await wait('First exact record');assert(node.querySelector('.topic-story-records article small').textContent.includes('Feb'));assert(!node.textContent.includes('Second exact record'));const more=[...node.querySelectorAll('button')].find(b=>/^Show \d+ more$/.test(b.textContent));assert(more);await act(async()=>more.click());await wait('Records unavailable.');await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='Reload').click());await wait('First exact record');assert(calls.filter(u=>u.searchParams.get('list')==='questions'&&!u.searchParams.get('cursor')).length>=2,'Reload fetches a fresh first page');await act(async()=>[...node.querySelectorAll('button')].find(b=>/^Show \d+ more$/.test(b.textContent)).click());await wait('Second exact record');assert(node.textContent.includes('First exact record'));assert(calls.some(u=>u.searchParams.get('cursor')==='page-two'));assert(![...node.querySelectorAll('button')].some(b=>/^Show \d+ more$/.test(b.textContent)));
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
 const window=new Window({url:'http://localhost/?view=topics&place=TUR&lang=fi'}),globals={window,document:window.document,location:window.location,history:window.history,HTMLElement:window.HTMLElement,Event:window.Event,IS_REACT_ACT_ENVIRONMENT:true},old=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});window.HTMLElement.prototype.scrollIntoView=function(){};
 let root,load;t.after(async()=>{if(root)await act(async()=>root.unmount());if(load)await load.close();await window.happyDOM.close();for(const [k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});
 const calls=[];let payload=base();payload.counts={questions:2,debates:0};payload.questions=[{id:'E-10-2026-000001',d:'2026-01-01',t:'Exact source title — Türkiye',places:['TUR'],home:[]}];
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(String(input),location.href);calls.push(u);if(u.pathname==='/api/topics/story-facts')return Response.json({...payload,...(u.searchParams.has('list')?{page:{total:2,items:payload.questions.map(q=>({id:q.id,date:q.d})),nextCursor:null}}:{})});return Response.json({ready:false});});
 load=await freshLoader({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},oxc:{jsx:{runtime:'automatic'}}},{sharedServerKey:'exact-story-locale'});
 const {TopicStories}=await load('/src/TopicStories.tsx'),{UiI18nProvider,UiMessage,useUiI18n}=await load('/src/UiI18nReact.tsx'),{createAppUiI18n}=await import('./uiCatalogues.mjs'),{createRoot}=await import('react-dom/client');
 const node=document.createElement('div');document.body.append(node);root=createRoot(node);
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
 const text=lineText(buildExactTopicStories(x,{period:'2026-Q1',labels:{IRN:'Iran'}}));
 assert.match(text,/^Iran drew the busiest debate on the map: 63 MEPs spoke on Brutal repression against protesters in Iran \(20 January\); the resolution, a joint text by six groups, passed 524 to 3\./);
 x.debates[0].places={};x.debates[0].primaryPlace=null;assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1'})),/^The busiest debate on the map was Brutal repression against protesters in Iran \(20 January\), with 63 MEPs speaking; /);
});
test('wording: urgency debates list countries only, in date order, and say when others were not placed',()=>{
 const x=quarter(base());x.periodCounts[0].urgencyDebates=3;x.debates=[['U3','2026-03-11','Case of Elene Khoshtaria','GEO'],['U1','2026-01-21','Execution spree in Iran','IRN'],['U2','2026-02-11','Freedom of religion worldwide',null]].map(([id,date,title,p])=>({id,date,title,meps:12,format:'urgency',places:p?{[p]:['title']}:{},primaryPlace:p,docs:[]}));x.sets={urgencyDebates:{'2026-Q1':['U3','U1','U2']}};
 const text=lineText(buildExactTopicStories(x,{period:'2026-Q1',labels:{IRN:'Iran',GEO:'Georgia'}}));
 assert.match(text,/Three urgency debates on human rights took up Iran and Georgia, among other cases\./);assert(!text.includes('Freedom of religion'));
 x.debates.forEach(d=>{d.places={};d.primaryPlace=null;});assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1'})),/Three urgency debates on human rights were held\./);
});
test('wording: names that take "the" read naturally at the start and inside sentences',()=>{
 const x=quarter(base());x.periodWinners['2026-Q1']={mostQuestionedPlaces:[{id:'USA',count:43}],risingQuestionPlaces:[{id:'GBR',count:12,ratio:3,baselineMean:4}]};
 const text=lineText(buildExactTopicStories(x,{period:'2026-Q1',labels:{USA:'United States',GBR:'United Kingdom'}}));
 assert.match(text,/Questions about the United Kingdom rose to 12, from an average of 4 a quarter\./);assert.match(text,/The United States was the most asked-about place \(43 questions\)\./);
});
test('wording: places with the same change share one sentence, others get their own, averages say "a quarter"',()=>{
 const x=quarter(base());x.periodWinners['2026-Q1']={risingQuestionPlaces:[{id:'ROU',count:9,ratio:4.5,baselineMean:2},{id:'TUN',count:9,ratio:4.5,baselineMean:2}]};
 assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1',labels:{ROU:'Romania',TUN:'Tunisia'}})),/Questions about Romania and Tunisia each jumped to nine, from an average of 2 a quarter\./);
 x.periodWinners['2026-Q1'].risingQuestionPlaces[1]={id:'TUN',count:8,ratio:2,baselineMean:4};const text=lineText(buildExactTopicStories(x,{period:'2026-Q1',labels:{ROU:'Romania',TUN:'Tunisia'}}));
 assert.match(text,/Questions about Romania jumped to nine, from an average of 2 a quarter\. Questions about Tunisia rose to eight, from an average of 4 a quarter\./);assert(!/ and Questions/.test(text));
 x.periodWinners['2026-Q1'].risingQuestionPlaces=[{id:'ROU',count:9,ratio:9,baselineMean:0.6}];assert.match(lineText(buildExactTopicStories(x,{period:'2026-Q1',labels:{ROU:'Romania'}})),/from fewer than one a quarter\./);
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
 const row=buildExactTopicStories(x,{period:'2026-Q1',labels:{IRN:'Iran',GEO:'Georgia'}}).find(r=>r.id==='topics.story.map.urgency.many');assert.equal(row.values.urgencyDebates.text.message,'topics.story.count.urgencyDebates');assert.deepEqual(row.values.urgencyDebates.text.counts,{count:2});assert(row.values.urgencyDebates.records.length>0);
 x.periodWinners['2026-Q1'].risingQuestionPlaces=[{id:'ROU',count:8,ratio:8,baselineMean:0.2}];const rare=buildExactTopicStories(x,{period:'2026-Q1',labels:{ROU:'Romania'}}).find(r=>r.id==='topics.story.exact.rises');assert.equal(rare.values.changes[0].values.questions.text.message,'topics.story.count.questions');assert.match(lineText([rare]),/Romania, rarely asked about before, drew eight questions\./);
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
