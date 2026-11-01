import {finishStoryProjection} from './story-facts-aggregate.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ActivityStore} from './activity-index-store.mjs';
import {buildTopics} from './topics-project.mjs';
import {RecordTopics,writeTopicProjection} from './topics-store.mjs';
import {storyTables,stageStoryInput,queueStoryRead} from './story-facts-storage.mjs';
import {storyFacts} from './story-facts-reader.mjs';
import {storyDocument,wholeTextOutcome,debateAgenda,debatePlaces,proceduralAgenda} from './story-facts-model.mjs';
import {collectStorySource,STORY_PAGE_SIZE} from './story-facts-collector.mjs';
import {eurovocCountries} from './topic-roles.mjs';
const stamp='2026-11-01T12:00:00Z',source={url:'https://data.europarl.europa.eu/api/v2/events/example',fetchedAt:stamp};
const geo=id=>[...eurovocCountries].find(([,country])=>country===id)[0];
const candidate=(id,label,extra={})=>({id,labels:{en:label},headings:{},references:{},outcome:'ADOPTED',decisionMethod:'VOTE_ROLLCALL',date:'2025-03-12',for:100,against:20,abstentions:0,on:[],...extra});
async function fixture(t,options={}){const dir=await mkdtemp(path.join(tmpdir(),'story-facts-')),store=new ActivityStore(dir,{initializeIndexes:true,...options});store.acquire();store.set('active',1);storyTables(store.db);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {dir,store};}

test('whole-text decisions require exact references and a unique highest-priority match',()=>{
 const doc={id:'RC-10-2025-0010',reference:'RC-B10-0010/2025'};
 assert.equal(wholeTextOutcome(doc,[candidate('wrong','RC-B10-0011/2025 – Motion for a resolution')]).outcome,null);
 assert.equal(wholeTextOutcome(doc,[candidate('amendment','RC-B10-0010/2025 – Amendment 1')]).outcome,null);
 const motion=candidate('motion','RC-B10-0010/2025 – Motion for a resolution (as a whole)'),single=candidate('single','RC-B10-0010/2025 – Single vote');
 assert.equal(wholeTextOutcome(doc,[motion,single]).outcome.decisionId,'single');
 assert.equal(wholeTextOutcome(doc,[motion,{...motion,id:'other'}]).outcomeStatus,'ambiguous');
 const provisional=candidate('provisional','RC-B10-0010/2025 – Provisional agreement – Am 2',{on:['RC-10-2025-0010-AM-2']});assert.equal(wholeTextOutcome(doc,[motion,provisional]).outcome.decisionId,'provisional');
 assert.equal(wholeTextOutcome(doc,[{...provisional,on:['RC-10-2025-0010-AM-1']}]).outcome,null);
});
test('unlabelled whole motions and show-of-hands decisions preserve unknown tallies',()=>{
 const doc={id:'RC-10-2025-0010',reference:'RC-B10-0010/2025'},d=candidate('hand','',{headings:{en:'Joint motion for a resolution RC-B10-0010/2025'},references:{en:'Motion for a resolution (as a whole)'},decisionMethod:'VOTE_HAND'}),o=wholeTextOutcome(doc,[d]).outcome;
 assert.equal(o.decisionId,'hand');assert.equal(o.decisionMethod,'VOTE_HAND');assert.equal(o.for,null);assert.equal(o.against,null);assert.equal(o.abstentions,null);assert.equal(wholeTextOutcome(doc,[]).outcome,null);
});
test('agenda links and country claims withhold ambiguous and incidental associations',()=>{
 const docs=[{events:['MTG-PL-2025-03-12-OJ-ITM-D-1']}];assert.equal(debateAgenda(null,docs).agendaVia,'document');
 assert.equal(debateAgenda({executed:['OJ-ITM-D-2']},docs).agendaId,'OJ-ITM-D-2');assert.equal(debateAgenda({executed:['OJ-ITM-D-2','OJ-ITM-D-3']},docs).agendaId,null);assert.equal(debateAgenda(null,[...docs,{events:['MTG-PL-2025-03-12-OJ-ITM-D-2']}]).agendaId,null);
 assert.deepEqual(debatePlaces('Support for Ukraine',['UKR','HUN'],null).places.map(p=>p.id),['UKR']);assert.equal(debatePlaces('The steel market',['UKR'],'report').places.length,0);assert.equal(debatePlaces('Human rights',['IRN'],'urgency').primaryPlace,'IRN');assert.equal(debatePlaces('Human rights',['IRN','UKR'],'urgency').places.length,0);
});
test('joint motions retain their own explicit author groups',()=>{
 const d=storyDocument({identifier:'RC-10-2025-0010',work_type:'def/ep-document-types/RESOLUTION_MOTION_JOINT',creator:['org/RENEW','org/ENVI','person/1'],workHadParticipation:[{participation_role:'def/ep-participation-roles/RECIPIENT',participation_in_name_of:'org/PPE'},{participation_role:'def/ep-participation-roles/AUTHOR',participation_in_name_of:'org/S_D'}],is_derivative_of:['eli/dl/doc/B-10-2025-0010']},source);assert.deepEqual(d.groups,['RENEW','S_D']);assert.deepEqual(d.derivedFrom,['B-10-2025-0010']);
});
test('story projection links exact records, excludes institutions and statements, and narrows debate places',async t=>{
 const {dir,store}=await fixture(t),day='2025-03-12',debate='MTG-PL-'+day+'-PVCRE-ITM-1',agenda='MTG-PL-'+day+'-OJ-ITM-D-1',vote='MTG-PL-'+day+'-VOT-ITM-10',decision='MTG-PL-'+day+'-DEC-1',proc='2025-2110',joint='RC-10-2025-0010';
 store.putSource(1,'/procedures/'+proc,'procedure',{id:'eli/dl/proc/'+proc,label:'2025/2110(INI)'},stamp);
 const makeDoc=(id,type,groups,extra={})=>({id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/'+type,document_date:day,title_dcterms:{en:'MOTION FOR A RESOLUTION on Ukraine'},creator:groups.map(g=>'org/'+g),is_about:[geo('UKR'),geo('HUN'),'http://eurovoc.europa.eu/245'],inverse_based_on_a_realization_of:['eli/dl/event/'+debate,'eli/dl/event/'+agenda,'eli/dl/event/'+vote],inverse_created_a_realization_of:['eli/dl/proc/'+proc],...extra});
 for(const [id,type,groups,extra] of [['B-10-2025-0010','RESOLUTION_MOTION',['PPE'],{}],['B-10-2025-0011','RESOLUTION_MOTION',['ECR'],{}],[joint,'RESOLUTION_MOTION_JOINT',['RENEW'],{is_derivative_of:['eli/dl/doc/B-10-2025-0010','eli/dl/doc/B-10-2025-0011'],inverse_based_on_a_realization_of:['eli/dl/event/'+debate,'eli/dl/event/'+agenda]}]])store.putSource(1,'/plenary-documents/'+id,'document',makeDoc(id,type,groups,extra),stamp);
 stageStoryInput(store,{activity_id:agenda,activity_date:day,activity_label:{en:'Support for Ukraine'},headingLabel:{en:'Joint debate - Support for Ukraine'},structuredContent:{en:'<root><type>Council and Commission statements</type></root>'},inverse_was_scheduled_in:['eli/dl/proc/'+proc]},source,{rank:4});
 stageStoryInput(store,{activity_id:debate,activity_date:day,executed:['eli/dl/event/'+agenda]},source,{rank:4});
 stageStoryInput(store,{activity_id:vote,consists_of:['eli/dl/event/'+decision]},source,{rank:4});
 stageStoryInput(store,{activity_id:decision,activity_date:day,inverse_consists_of:['eli/dl/event/'+vote],activity_label:{en:'RC-B10-0010/2025 – Motion for a resolution (as a whole)'},decision_outcome:'def/ep-decision-outcomes/ADOPTED',decision_method:'def/ep-decision-methods/VOTE_HAND'},source,{rank:4});
 for(const [n,person,kind,capacity,role] of [[1,'1','PLENARY_DEBATE_SPEECH',null,null],[2,'2','PLENARY_DEBATE_SPEECH','commission',null],[3,'3','PLENARY_DEBATE_WRITTEN_STATEMENT',null,null],[4,'4','PLENARY_DEBATE_SPEECH',null,'CHAIR'],[5,'1','PLENARY_DEBATE_SPEECH',null,null]]){
  const id='MTG-PL-'+day+'-OTH-'+n;store.putSource(1,'/speeches/'+id,'speech',{outside:{id,date:day,titles:{en:'1. Support for Ukraine (debate)'},participants:[person],parentIds:[debate],parentDocumentIds:['CRE-10-'+day+'-ITM-001'],parentDocumentId:'CRE-10-'+day+'-ITM-001',headers:[{personId:person,capacity}],source}},stamp);
  store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(1,'/speeches/'+id,id,person,'plenary-contributions',day,JSON.stringify({speechKind:kind,speechRole:role}));
 }
 await buildTopics(store);const result=storyFacts(store,new URLSearchParams('scope=place&key=place:UKR&period=2025-Q1'));
 const keywordStory=storyFacts(store,new URLSearchParams('scope=topic&key=eurovoc:245'));assert.equal(keywordStory.debates.length,1);assert.equal(keywordStory.docs.length,3,'topic joins are ready on the first full build');
 assert(result.ready);assert.equal(result.debates.length,1);const d=result.debates[0];assert.equal(d.meps,1);assert.equal(d.speeches,2);assert.equal(d.agendaVia,'executed');assert.equal(d.format,'council-commission');assert.equal(d.creId,'CRE-10-'+day+'-ITM-001');assert.deepEqual(d.places.map(p=>p.id),['UKR']);assert.deepEqual(d.procedures,[proc]);assert.equal(new RecordTopics(store).record('MTG-PL-'+day+'-OTH-1','en').places.find(p=>p.id==='UKR').basis,'title','inherited title places never become official classifications');
 const j=result.docs.find(d=>d.id===joint);assert.deepEqual(j.groups,['RENEW']);assert.equal(j.outcome.decisionId,decision);assert.equal(j.outcome.for,null);assert.equal(result.docs.find(d=>d.id==='B-10-2025-0010').outcome,null);
 const hun=storyFacts(store,new URLSearchParams('scope=place&key=HUN'));assert.equal(hun.debates.length,0);assert.equal(new RecordTopics(store).record(debate,'en').places.some(p=>p.id==='HUN'),false);
 assert.equal(result.blocks[0].debates[0],debate);assert(result.coverage.speakers.nullCapacityChairLimit);
 const pdb=new DatabaseSync(path.join(dir,'press-v1.sqlite'));pdb.exec('CREATE TABLE links(kind,value,release);CREATE TABLE releases(id,url,body)');pdb.prepare('INSERT INTO links VALUES (?,?,?)').run('procedure','2025/2110(INI)','release');pdb.prepare('INSERT INTO releases VALUES (?,?,?)').run('release','https://www.europarl.europa.eu/news/en/press-room/example',JSON.stringify({title:'Release',publishedAt:stamp}));pdb.close();assert.equal(storyFacts(store,new URLSearchParams('scope=place&key=UKR'),{pressFilename:path.join(dir,'press-v1.sqlite')}).press[proc][0].id,'release');
});
test('unavailable projections never become zero story counts',async t=>{const {store}=await fixture(t);assert.deepEqual(storyFacts(store,new URLSearchParams()),{ready:false});assert.throws(()=>storyFacts(store,new URLSearchParams('scope=place&key=not-a-place')),/Choose a place/);});
test('decisions are read once with no pager, and early agendas stay unavailable without retries',async t=>{
 const {store}=await fixture(t),sitting='MTG-PL-2025-03-12';queueStoryRead(store,'decisions',sitting);let calls=0;
 const worker={store,clock:Date.now,requests:0,budget:10,controller:new AbortController(),request:async(endpoint,params,options)=>{calls++;worker.requests++;assert.equal(endpoint,'/meetings/'+sitting+'/decisions');assert.deepEqual(params,{'filter-output':'voters'});assert.equal(options.backgroundLow,true);return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:stamp,payload:{data:[{activity_id:sitting+'-DEC-1'}]}};}};
 assert(await collectStorySource(worker));assert.equal(await collectStorySource(worker),false);assert.equal(calls,1);
 queueStoryRead(store,'agenda','MTG-PL-2024-09-17');assert(await collectStorySource(worker));assert.equal(await collectStorySource(worker),false);assert.equal(calls,1);assert.equal(store.db.prepare("SELECT state FROM story_jobs WHERE kind='agenda'").get().state,'unavailable');
});
test('an agenda source that repeats a page stops with an explicit partial observation',async t=>{
 const {store}=await fixture(t),sitting='MTG-PL-2025-03-12';queueStoryRead(store,'agenda',sitting);let calls=0;
 const data=Array.from({length:STORY_PAGE_SIZE},(_,i)=>({activity_id:sitting+'-OJ-ITM-D-'+i})),worker={store,clock:Date.now,requests:0,budget:10,controller:new AbortController(),request:async()=>{calls++;worker.requests++;return {url:'https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/foreseen-activities',fetchedAt:stamp,payload:{data}};}};
 assert(await collectStorySource(worker));assert(await collectStorySource(worker));assert.equal(await collectStorySource(worker),false);assert.equal(calls,2);assert.equal(store.db.prepare('SELECT state,error FROM story_jobs').get().error,'repeated-page');
});

test('an actual 204 agenda is terminal and a 429 retains a deferred lowest-priority job',async t=>{
 const {store}=await fixture(t);let now=Date.parse(stamp),calls=0;
 queueStoryRead(store,'agenda','MTG-PL-2025-03-12');
 const worker={store,clock:()=>now,requests:0,budget:10,controller:new AbortController(),request:async(_endpoint,_params,options)=>{calls++;assert.equal(options.backgroundLow,true);return {status:204};}};
 assert(await collectStorySource(worker));assert.equal(await collectStorySource(worker),false);assert.equal(calls,1);assert.equal(store.db.prepare("SELECT state,error FROM story_jobs WHERE kind='agenda'").get().error,'http-204');
 queueStoryRead(store,'event','MTG-PL-2025-03-12-PVCRE-ITM-1');
 worker.request=async(_endpoint,_params,options)=>{calls++;assert.equal(options.backgroundLow,true);throw Object.assign(new Error('Rate limited'),{status:429,retryAfter:60});};
 assert(await collectStorySource(worker));const job=store.db.prepare("SELECT state,next_read FROM story_jobs WHERE kind='event'").get();assert.equal(job.state,'pending');assert.equal(job.next_read,now+60_000);assert.equal(await collectStorySource(worker),false);assert.equal(calls,2);
});

test('story questions preserve per-place home flags and elsewhere selections',async t=>{
 const {store}=await fixture(t);store.setMembers([{id:'1',name:'Greek member',countryCode:'GR'}]);
 for(const [id,title] of [['P-10-2025-000001','Greece and Cyprus'],['P-10-2025-000002','Greece']])store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(1,'/questions/'+id,id,'1','written-questions','2025-03-12',JSON.stringify({titles:{en:title}}));
 await buildTopics(store);
 const all=storyFacts(store,new URLSearchParams('scope=place&key=GRC&period=2025-Q1&list=questions'));assert.equal(all.questions.length,2);assert.equal(all.counts.questions,2);assert.equal(all.counts.questionHome,2);assert(all.questions.every(q=>q.askers.GRC==='home'));
 const elsewhere=storyFacts(store,new URLSearchParams('scope=place&key=CYP&period=2025-Q1&askers=elsewhere&list=questions'));assert.equal(elsewhere.questions.length,1);assert.equal(elsewhere.questions[0].askers.CYP,'elsewhere');assert.equal(elsewhere.counts.questionElsewhere,1);assert.deepEqual(elsewhere.questions[0].home,[]);
 assert.equal(storyFacts(store,new URLSearchParams('scope=place&key=GRC&askers=elsewhere')).questions.length,0);
});


test('procedural exclusions use only agenda types and format labels',()=>{
 assert(proceduralAgenda({type:'PLENARY_VOTE'}));
 for(const format of ['Voting time','Explanations of votes','Opening of the sitting','Closing of the session','Approval of the minutes','Order of business'])assert(proceduralAgenda({type:'PLENARY_DEBATE',formats:{en:[format]}}));
 assert.equal(proceduralAgenda({type:'PLENARY_DEBATE',titles:{en:'Voting time'},headings:{en:'Explanations of votes'},formats:{en:['Commission statement']}}),false);
 assert.equal(proceduralAgenda(null),false);
});

test('exact counters, all tied winners, complete urgencies and cursor pages replace the debate cap',async t=>{
 const {store}=await fixture(t);await buildTopics(store);
 const insert=store.db.prepare('INSERT INTO story_facts VALUES (?,?,?,?,?)'),place=store.db.prepare('INSERT INTO story_places VALUES (?,?,?,?,?,?)');
 for(let n=0;n<62;n++){
  const date=n<60?'2025-03-12':'2025-04-02',id='MTG-PL-'+date+'-PVCRE-ITM-'+n;
  const body={id,date,titles:{en:'Debate '+n},meps:n===59?1:n===1?100:100-n,speeches:100,format:n===59?'urgency':null,procedures:[],docs:[],places:[{id:'UKR',basis:'title',bases:['title']}]};
  insert.run(1,'debate',id,date,JSON.stringify(body));place.run(1,'UKR','debate',id,date,'title');
 }
 await finishStoryProjection(store,1);
 const response=storyFacts(store,new URLSearchParams('scope=place&key=UKR'));
 assert.equal(response.counts.debates,62);assert.equal(response.counts.debates3Plus,61);assert.equal(response.counts.urgencyDebates,1);assert.equal(response.debatesTruncated,undefined);
 assert.equal(response.winners.busiestDebates.length,2);assert(response.winners.busiestDebates.every(d=>d.meps===100));assert.equal(response.sets.urgencyDebates['2025-Q1'].length,1);assert(response.debates.length<response.counts.debates);
 assert.equal(response.periodCounts.find(p=>p.period==='2025-Q1').debates,60);assert.equal(response.series.UKR['2025-Q1'].debates,60);
 let cursor=null,seen=[];do{const params=new URLSearchParams('scope=place&key=UKR&list=debates');if(cursor)params.set('cursor',cursor);const r=storyFacts(store,params);assert.equal(r.page.total,62);seen.push(...r.page.items.map(x=>x.id));cursor=r.page.nextCursor;}while(cursor);
 assert.equal(new Set(seen).size,62);assert.equal(seen.length,62);
 const first=storyFacts(store,new URLSearchParams('scope=place&key=UKR&list=debates'));assert(first.page.nextCursor);assert.throws(()=>storyFacts(store,new URLSearchParams({scope:'place',key:'GRC',list:'debates',cursor:first.page.nextCursor})),/Reload this list/);
 const published=store.get('storyProjection');store.set('storyProjection',{...published,builtAt:'2030-01-01T00:00:00Z'});assert.throws(()=>storyFacts(store,new URLSearchParams({scope:'place',key:'UKR',list:'debates',cursor:first.page.nextCursor})),/Reload this list/);store.set('storyProjection',published);
 const q2=storyFacts(store,new URLSearchParams('scope=place&key=UKR&period=2025-Q2'));assert.equal(q2.counts.debates,2);

});

test('full projection pruning retains only the serving and previous story generations',async t=>{
 const {store}=await fixture(t);store.set('active',2);store.set('previous',1);
 for(const generation of [0,1,2,3]){
  store.db.prepare('INSERT INTO story_facts VALUES (?,?,?,?,?)').run(generation,'debate','old','2025-03-12','{}');
  store.db.prepare('INSERT INTO story_links VALUES (?,?,?,?)').run(generation,'debate-document','old','document');
  store.db.prepare('INSERT INTO story_places VALUES (?,?,?,?,?,?)').run(generation,'UKR','debate','old','2025-03-12','title');
  store.db.prepare('INSERT INTO story_topics VALUES (?,?,?,?,?)').run(generation,'oeil:8.20','debate','old','2025-03-12');
  store.db.prepare('INSERT INTO story_parents VALUES (?,?,?)').run(generation,'old','speech');
 }
 await buildTopics(store);
 for(const table of ['story_facts','story_links','story_places','story_topics','story_parents'])assert.deepEqual(store.db.prepare('SELECT DISTINCT generation FROM '+table+' ORDER BY generation').all().map(r=>r.generation),[1]);
});


test('topic stories retain placed oral questions from their exact policy memberships',async t=>{
 const {store}=await fixture(t);store.setMembers([{id:'1',countryCode:'GR'}]);
 const record={id:'O-10-2025-000001',kind:'question',date:'2025-03-12',titles:{en:'Cyprus'},members:['1'],status:'classified',assignments:[{key:'place:CYP',role:'place',paths:[{basis:'title',steps:[],sources:[]}]},{key:'oeil:8.20',role:'topic',paths:[{basis:'debate',steps:[],sources:[]}]}]};
 writeTopicProjection(store,{records:[record],concepts:[{key:'place:CYP',role:'place',labels:{en:'Cyprus'}},{key:'oeil:8.20',role:'topic',labels:{en:'Enlargement'}}]});await finishStoryProjection(store,1);
 const selected=storyFacts(store,new URLSearchParams('scope=topic&key=oeil:8.20&askers=elsewhere&list=questions'));assert.equal(selected.questions[0].id,record.id);assert.equal(selected.questions[0].askers.CYP,'elsewhere');
 assert.equal(storyFacts(store,new URLSearchParams('scope=topic&key=oeil:4.40')).questions.length,0);
});

test('retained unavailable procedure reads propagate through exact document, debate and speech links',async t=>{
 const {store}=await fixture(t),{topicCollectorTables}=await import('./topics-project.mjs');topicCollectorTables(store.db);
 const day='2025-03-12',proc='2025-0001',doc='B-10-2025-0001',debate='MTG-PL-'+day+'-PVCRE-ITM-1',speech='MTG-PL-'+day+'-OTH-1';
 store.putSource(1,'/procedures/'+proc,'procedure',{id:'eli/dl/proc/'+proc,label:'2025/0001(INI)'},stamp);
 store.db.prepare('INSERT INTO topic_procedure_pages VALUES (?,?,?)').run(proc,'2025/0001(INI)',JSON.stringify({state:'unavailable',reason:'source-too-large',subjects:[]}));
 store.putSource(1,'/plenary-documents/'+doc,'document',{id:'eli/dl/doc/'+doc,identifier:doc,work_type:'def/ep-document-types/RESOLUTION_MOTION',document_date:day,inverse_created_a_realization_of:['eli/dl/proc/'+proc],inverse_based_on_a_realization_of:['eli/dl/event/'+debate]},stamp);
 stageStoryInput(store,{activity_id:debate,activity_date:day,based_on_a_realization_of:['eli/dl/doc/'+doc]},source,{rank:4});
 store.putSource(1,'/speeches/'+speech,'speech',{outside:{id:speech,date:day,titles:{en:'Debate'},parentIds:[debate],participants:['1'],source}},stamp);
 await buildTopics(store);const reader=new RecordTopics(store);
 assert.equal(reader.record(doc,'en').status,'unavailable');assert.equal(reader.record(debate,'en').status,'unavailable');assert.equal(reader.record(speech,'en').status,'unavailable');
});

test('map ties, question mentions, complete adopted sets and cross-quarter outcomes use all records',async t=>{
 const {store}=await fixture(t);await buildTopics(store);const put=store.db.prepare('INSERT INTO story_facts VALUES (?,?,?,?,?)');
 for(let n=0;n<4;n++){
  const id='MTG-PL-2025-03-12-PVCRE-ITM-'+n,place=n<2?'GRC':'CYP',d={id,date:'2025-03-12',titles:{en:'Debate '+n},meps:n%2?1:50,speeches:50,format:n%2?'urgency':null,agendaClassified:true,procedures:[],docs:n===0?['B-10-2025-0001','B-10-2025-0002']:[],places:[{id:place,basis:'title',bases:['title']}]};put.run(1,'debate',id,d.date,JSON.stringify(d));
  for(const doc of d.docs)store.db.prepare('INSERT INTO story_links VALUES (?,?,?,?)').run(1,'debate-document',id,doc);
 }
 for(let n=1;n<=4;n++){
  const id='B-10-2025-000'+n,o=n===4?null:{decisionId:'decision-'+n,date:'2025-04-02',outcome:'ADOPTED',for:n===3?null:100,against:n===3?null:98,abstentions:n===3?null:0,decisionMethod:n===3?'VOTE_HAND':'VOTE_ROLLCALL',labels:{en:'Whole text'},references:{en:'Motion for a resolution (as a whole)'}};
  const d={id,reference:'B10-000'+n+'/2025',type:'RESOLUTION_MOTION',date:'2025-03-12',titles:{en:'Motion '+n},rule:[],groups:[],groupsAvailable:true,places:['GRC'],keywords:[],procedures:[],derivedFrom:[],outcome:o,outcomeStatus:o?'known':'unknown'};put.run(1,'document',id,d.date,JSON.stringify(d));
 }
 const q='E-10-2025-000001';store.db.prepare('INSERT INTO record_topic_records VALUES (?,?,?,?,?,?,?)').run(1,q,'question','2025-03-12',q,'record',JSON.stringify({titles:{en:'Greece and Cyprus'},members:['1']}));
 for(const [place,askers] of [['GRC','home'],['CYP','elsewhere']])store.db.prepare('INSERT INTO record_topic_question_places VALUES (?,?,?,?,?,?)').run(1,'place:'+place,q,askers,'2025-03-12',q);
 await finishStoryProjection(store,1);
 const map=storyFacts(store,new URLSearchParams('scope=map&period=2025-Q1'));assert.equal(map.counts.questions,1);assert.equal(map.counts.questionMentions,2);assert.equal(map.counts.questionHome,1);assert.equal(map.counts.questionElsewhere,1);assert.equal(map.counts.debates,4);assert.equal(map.counts.debates3Plus,2);assert.equal(map.winners.busiestDebates.length,2);assert.equal(map.winners.mostQuestionedPlaces.length,2);assert.equal(map.winners.mostDebatedPlaces.length,2);assert.equal(map.counts.placesWithQuestions,2);
 const elsewhere=storyFacts(store,new URLSearchParams('scope=map&period=2025-Q1&askers=elsewhere'));assert.equal(elsewhere.counts.questions,1);assert.equal(elsewhere.counts.questionMentions,1);assert.equal(elsewhere.winners.mostQuestionedPlaces[0].id,'CYP');
 const publication=storyFacts(store,new URLSearchParams('scope=place&key=GRC&period=2025-Q1'));assert.equal(publication.counts.documents,4);assert.equal(publication.counts.documentsWithUnknownOutcome,1);assert.equal(publication.counts.adoptedTexts,0);
 const adoption=storyFacts(store,new URLSearchParams('scope=place&key=GRC&period=2025-Q2'));assert.equal(adoption.counts.adoptedTexts,3);assert.equal(adoption.counts.adoptedTextsWithTallies,2);assert.equal(adoption.sets.adoptedTexts['2025-Q2'].length,3);assert.equal(adoption.winners.closestAdoptedTexts.length,2);assert(adoption.winners.closestAdoptedTexts.every(x=>x.margin===2));assert.equal(adoption.winners.headlineAdoptedTexts.length,2);assert.equal(adoption.docs.find(d=>d.id.endsWith('0003')).outcome.for,null);
});

test('question totals remain exact beyond the former 20000-row evidence limit',async t=>{
 const {store}=await fixture(t);store.setMembers([{id:'1',countryCode:'GR'}]);await buildTopics(store);
 store.db.prepare('INSERT INTO record_topic_concepts VALUES (?,?,?,?)').run(1,'place:GRC','place',JSON.stringify({key:'place:GRC',role:'place',labels:{en:'Greece'}}));
 store.transaction(()=>{store.db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<20005) INSERT INTO record_topic_records SELECT 1,'E-10-2025-'||printf('%06d',x),'question','2025-03-12','E-10-2025-'||printf('%06d',x),'record',json_object('titles',json_object('en','Greece'),'members',json_array('1'),'assignments',json_array()) FROM n`);store.db.exec("INSERT INTO record_topic_memberships SELECT generation,'place:GRC',id,kind,date,group_key FROM record_topic_records WHERE generation=1 AND kind='question'");});
 const {finishTopicProjection}=await import('./topics-store.mjs');finishTopicProjection(store,1,[]);await finishStoryProjection(store,1);
 const prepare=store.db.prepare.bind(store.db);let captured;
 store.db.prepare=sql=>{const stmt=prepare(sql);if(sql.startsWith('SELECT id,kind,date FROM story_scope_records')){const all=stmt.all.bind(stmt);stmt.all=(...args)=>{captured={sql,args};return all(...args);};}return stmt;};
 const response=storyFacts(store,new URLSearchParams('scope=place&key=GRC&period=2025-Q1&list=questions'));
 store.db.prepare=prepare;assert(captured);const plan=store.db.prepare('EXPLAIN QUERY PLAN '+captured.sql).all(...captured.args).map(r=>r.detail).join(' ');assert.match(plan,/COVERING INDEX story_scope_period/);assert.doesNotMatch(plan,/USE TEMP B-TREE/);

 assert.equal(response.counts.questions,20005);assert.equal(response.counts.questionMentions,20005);assert.equal(response.counts.questionHome,20005);assert.equal(response.counts.groups,20005);assert.equal(response.page.total,20005);assert.equal(response.page.items.length,20);assert(response.page.nextCursor);assert.equal(response.questions.length,20);assert.equal(response.coverage.truncated,undefined);
 const next=storyFacts(store,new URLSearchParams({scope:'place',key:'GRC',period:'2025-Q1',list:'questions',cursor:response.page.nextCursor}));assert.equal(new Set([...response.page.items,...next.page.items].map(r=>r.id)).size,40);
});

test('agenda collection continues beyond the former page ceiling and keeps deep source trees',async t=>{
 const {store}=await fixture(t),sitting='MTG-PL-2025-03-12';queueStoryRead(store,'agenda',sitting);store.db.prepare('UPDATE story_jobs SET offset=?').run(STORY_PAGE_SIZE*31);let calls=0;
 const worker={store,clock:Date.now,requests:0,budget:10,controller:new AbortController(),request:async(_endpoint,params)=>{calls++;worker.requests++;return {url:'https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/foreseen-activities?offset='+params.offset,fetchedAt:stamp,payload:{data:calls===1?Array.from({length:STORY_PAGE_SIZE},(_,i)=>({activity_id:sitting+'-OJ-ITM-D-'+(params.offset+i)})):[]}};}};
 assert(await collectStorySource(worker));assert.equal(store.db.prepare('SELECT state FROM story_jobs').get().state,'pending');assert(await collectStorySource(worker));assert.equal(store.db.prepare('SELECT state FROM story_jobs').get().state,'available');assert.equal(calls,2);
 const other='MTG-PL-2025-03-13';queueStoryRead(store,'agenda',other);let tree={activity_id:other+'-OJ-ITM-D-12'};for(let i=11;i>=0;i--)tree={activity_id:other+'-OJ-ITM-D-'+i,consists_of:[tree]};worker.request=async()=>({url:'https://data.europarl.europa.eu/api/v2/meetings/'+other+'/foreseen-activities',fetchedAt:stamp,payload:{data:[tree]}});assert(await collectStorySource(worker));assert.equal(store.db.prepare("SELECT COUNT(*) n FROM story_inputs WHERE id LIKE ?").get(other+'%').n,13);assert.equal(store.db.prepare('SELECT state FROM story_jobs WHERE id=?').get(other).state,'available');
});

test('rank-four adoption evidence retains every boundary tie',async t=>{
 const {store}=await fixture(t);await buildTopics(store);let n=0;
 for(const place of ['GRC','CYP','UKR','HUN','BLR']){const id='B-10-2025-'+String(++n).padStart(4,'0'),d={id,reference:'B10-'+String(n).padStart(4,'0')+'/2025',type:'RESOLUTION_MOTION',date:'2025-03-12',titles:{en:place},rule:[],groups:[],places:[place],keywords:[],procedures:[],derivedFrom:[],outcomeStatus:'known',outcome:{decisionId:'d'+n,date:'2025-03-12',outcome:'ADOPTED',for:100,against:0,abstentions:0,labels:{},references:{}}};store.db.prepare('INSERT INTO story_facts VALUES (?,?,?,?,?)').run(1,'document',id,d.date,JSON.stringify(d));}
 await finishStoryProjection(store,1);const r=storyFacts(store,new URLSearchParams('scope=map&period=2025-Q1&mode=d'));assert.equal(r.counts.adoptedTexts,5);assert.equal(r.counts.placesWithAdoptedTexts,5);assert.equal(r.winners.mostAdoptedPlaces.length,5);assert.equal(r.winners.topAdoptedPlaces.length,5);
});

test('riser winners use complete earlier quarters, thresholds and all ties',async t=>{
 const {store}=await fixture(t,{clock:()=>Date.parse(stamp)});await buildTopics(store);let seq=0;
 for(const place of ['GRC','CYP'])for(const [date,n] of [['2024-08-12',12],['2024-12-12',1],['2025-03-12',8],['2025-06-12',7],['2026-10-12',100]])for(let i=0;i<n;i++){
  const id='E-10-2025-'+String(++seq).padStart(6,'0');store.db.prepare('INSERT INTO record_topic_records VALUES (?,?,?,?,?,?,?)').run(1,id,'question',date,id,'record',JSON.stringify({titles:{en:place},members:[]}));store.db.prepare('INSERT INTO record_topic_question_places VALUES (?,?,?,?,?,?)').run(1,'place:'+place,id,'elsewhere',date,id);
 }
 await finishStoryProjection(store,1);
 const q1=storyFacts(store,new URLSearchParams('scope=map&period=2025-Q1'));assert.equal(q1.winners.risingQuestionPlaces.length,2);for(const p of q1.winners.risingQuestionPlaces){assert.equal(p.count,8);assert.equal(p.baselineTotal,1);assert.equal(p.baselinePeriods,1);assert.equal(p.ratio,8);}
 assert.deepEqual(storyFacts(store,new URLSearchParams('scope=map&period=2025-Q2')).winners.risingQuestionPlaces,[]);assert.deepEqual(storyFacts(store,new URLSearchParams('scope=map&period=2026-Q4')).winners.risingQuestionPlaces,[]);
});


test('retaining an identical story observation performs no disk rewrite but keeps newer source dates',async t=>{
 const {store}=await fixture(t),work={identifier:'B-10-2025-0001',work_type:'def/ep-document-types/RESOLUTION_MOTION',document_date:'2025-03-12',title_dcterms:{en:'Motion'}};
 stageStoryInput(store,work,source,{rank:2});const changes=()=>store.db.prepare('SELECT total_changes() n').get().n,before=changes();stageStoryInput(store,work,source,{rank:2});assert.equal(changes(),before);
 const newer={...source,fetchedAt:'2026-11-01T12:00:01Z'};stageStoryInput(store,work,newer,{rank:2});assert.equal(changes(),before+1);assert.equal(JSON.parse(store.db.prepare("SELECT source FROM story_inputs WHERE kind='document'").get().source).fetchedAt,newer.fetchedAt);
});
