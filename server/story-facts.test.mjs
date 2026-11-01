import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ActivityStore} from './activity-index-store.mjs';
import {buildTopics} from './topics-project.mjs';
import {RecordTopics} from './topics-store.mjs';
import {storyTables,stageStoryInput,queueStoryRead} from './story-facts-storage.mjs';
import {storyFacts} from './story-facts-reader.mjs';
import {storyDocument,wholeTextOutcome,debateAgenda,debatePlaces} from './story-facts-model.mjs';
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
 assert(result.ready);assert.equal(result.debates.length,1);const d=result.debates[0];assert.equal(d.meps,1);assert.equal(d.speeches,2);assert.equal(d.agendaVia,'executed');assert.equal(d.format,'council-commission');assert.equal(d.creId,'CRE-10-'+day+'-ITM-001');assert.deepEqual(d.places.map(p=>p.id),['UKR']);assert.deepEqual(d.procedures,[proc]);
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
