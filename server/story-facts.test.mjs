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
import {storyDocument,wholeTextOutcome,debateAgenda,debatePlaces,proceduralAgenda,STORY_FACTS_VERSION} from './story-facts-model.mjs';
import {collectStorySource,STORY_PAGE_SIZE} from './story-facts-collector.mjs';
import {eurovocCountries} from './topic-roles.mjs';
const stamp='2026-11-01T12:00:00Z',source={url:'https://data.europarl.europa.eu/api/v2/events/example',fetchedAt:stamp};
const geo=id=>[...eurovocCountries].find(([,country])=>country===id)[0];
const candidate=(id,label,extra={})=>({id,labels:{en:label},headings:{},references:{},outcome:'ADOPTED',decisionMethod:'VOTE_ROLLCALL',date:'2025-03-12',for:100,against:20,abstentions:0,on:[],...extra});
async function fixture(t){const dir=await mkdtemp(path.join(tmpdir(),'story-facts-')),store=new ActivityStore(dir,{initializeIndexes:true});store.acquire();store.set('active',1);storyTables(store.db);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {dir,store};}

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
 const all=storyFacts(store,new URLSearchParams('scope=place&key=GRC&period=2025-Q1'));assert.equal(all.questions.length,2);assert.deepEqual(all.questionsByPlace.GRC['2025-Q1'].map(q=>q.askers),['home','home']);
 const elsewhere=storyFacts(store,new URLSearchParams('scope=place&key=CYP&period=2025-Q1&askers=elsewhere'));assert.equal(elsewhere.questions.length,1);assert.equal(elsewhere.questions[0].askers.CYP,'elsewhere');assert.equal(elsewhere.questionsByPlace.CYP['2025-Q1'][0].home,false);
 assert.equal(storyFacts(store,new URLSearchParams('scope=place&key=GRC&askers=elsewhere')).questions.length,0);
});


test('procedural exclusions use only agenda types and format labels',()=>{
 assert(proceduralAgenda({type:'PLENARY_VOTE'}));
 for(const format of ['Voting time','Explanations of votes','Opening of the sitting','Closing of the session','Approval of the minutes','Order of business'])assert(proceduralAgenda({type:'PLENARY_DEBATE',formats:{en:[format]}}));
 assert.equal(proceduralAgenda({type:'PLENARY_DEBATE',titles:{en:'Voting time'},headings:{en:'Explanations of votes'},formats:{en:['Commission statement']}}),false);
 assert.equal(proceduralAgenda(null),false);
});

test('each story quarter returns the top fifty debates plus every urgency with explicit totals',async t=>{
 const {store}=await fixture(t);await buildTopics(store);
 const insert=store.db.prepare('INSERT INTO story_facts VALUES (?,?,?,?,?)'),place=store.db.prepare('INSERT INTO story_places VALUES (?,?,?,?,?,?)');
 for(let n=0;n<62;n++){
  const date=n<60?'2025-03-12':'2025-04-02',id='MTG-PL-'+date+'-PVCRE-ITM-'+n;
  const body={id,date,titles:{en:'Debate '+n},meps:n===59?1:100-n,speeches:100,format:n===59?'urgency':null,procedures:[],docs:[],places:[{id:'UKR',basis:'title',bases:['title']}]};
  insert.run(1,'debate',id,date,JSON.stringify(body));place.run(1,'UKR','debate',id,date,'title');
 }
 const response=storyFacts(store,new URLSearchParams('scope=place&key=UKR'));
 assert.equal(response.debatesTotal,62);assert.equal(response.debatesTruncated,true);assert.equal(response.debates.length,53);assert(response.debates.some(d=>d.meps===1&&d.format==='urgency'));
 const q1=response.blocks.find(b=>b.period==='2025-Q1');assert.equal(q1.debatesTotal,60);assert.equal(q1.debatesTruncated,true);assert.equal(q1.debates.length,51);assert.equal(response.series.UKR['2025-Q1'].debates,60);
 const q2=storyFacts(store,new URLSearchParams('scope=place&key=UKR&period=2025-Q2'));assert.equal(q2.debates.length,2);assert.equal(q2.debatesTruncated,false);
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
 writeTopicProjection(store,{records:[record],concepts:[{key:'place:CYP',role:'place',labels:{en:'Cyprus'}},{key:'oeil:8.20',role:'topic',labels:{en:'Enlargement'}}]});store.set('storyProjection',{generation:1,version:STORY_FACTS_VERSION});
 const selected=storyFacts(store,new URLSearchParams('scope=topic&key=oeil:8.20&askers=elsewhere'));assert.equal(selected.questions[0].id,record.id);assert.equal(selected.questions[0].askers.CYP,'elsewhere');
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
