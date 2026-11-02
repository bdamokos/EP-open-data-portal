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
import {storyTables,stageStoryInput,queueStoryRead,storyInput,storyEventType} from './story-facts-storage.mjs';
import {storyFacts} from './story-facts-reader.mjs';
import {storyDocument,wholeTextOutcome,debateAgenda,debatePlaces,proceduralAgenda,votingItem,votingDebate,voteActivity} from './story-facts-model.mjs';
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
 const docs=[{events:['MTG-PL-2025-03-12-OJ-ITM-D-1']}];assert.equal(debateAgenda(null,docs).agendaVia,'document');assert.equal(debateAgenda({executed:[],executedKnown:false},docs).agendaVia,'document');assert.equal(debateAgenda({executed:[],executedKnown:true},docs).agendaId,null);
 assert.equal(debateAgenda({executed:['OJ-ITM-D-2']},docs).agendaId,'OJ-ITM-D-2');assert.equal(debateAgenda({executed:['OJ-ITM-D-2','OJ-ITM-D-3']},docs).agendaId,null);assert.equal(debateAgenda(null,[...docs,{events:['MTG-PL-2025-03-12-OJ-ITM-D-2']}]).agendaId,null);
 assert.deepEqual(debatePlaces('Support for Ukraine',['UKR','HUN'],null).places.map(p=>p.id),['UKR']);assert.equal(debatePlaces('The steel market',['UKR'],'report').places.length,0);assert.equal(debatePlaces('Human rights',['IRN'],'urgency').primaryPlace,'IRN');assert.equal(debatePlaces('Human rights',['IRN','UKR'],'urgency').places.length,0);
});
test('joint motions retain their own explicit author groups',()=>{
 const d=storyDocument({identifier:'RC-10-2025-0010',work_type:'def/ep-document-types/RESOLUTION_MOTION_JOINT',creator:['org/RENEW','org/ENVI','person/1'],workHadParticipation:[{participation_role:'def/ep-participation-roles/RECIPIENT',participation_in_name_of:'org/PPE'},{participation_role:'def/ep-participation-roles/AUTHOR',participation_in_name_of:'org/S_D'}],is_derivative_of:['eli/dl/doc/B-10-2025-0010']},source);assert.deepEqual(d.groups,['RENEW','S_D']);assert.deepEqual(d.derivedFrom,['B-10-2025-0010']);
});
test('hyphenated ODP group codes resolve to the group vocabulary',()=>{
 const d=storyDocument({identifier:'RC-10-2026-0110',work_type:'def/ep-document-types/RESOLUTION_MOTION_JOINT',creator:['org/S-D','org/VERTS-ALE','org/THE-LEFT','org/PATRIOTS','org/AFET'],workHadParticipation:[{participation_role:'def/ep-roles/AUTHOR',participation_in_name_of:'org/S-D'}]},source);
 assert.deepEqual(d.groups,['S_D','VERTS_ALE','THE_LEFT','PFE']);
});
test('verbatim items labelled as votes are voting-time items, not debates',()=>{
 assert(votingItem('Ukraine Support Loan for 2026 and 2027 (vote)'));
 assert.equal(votingItem('Situation in Venezuela (debate)'),false);
 assert.equal(votingItem('Voting on the budget'),false);
 assert.equal(votingItem(undefined),false);
});
test('a document re-parsed under a new parser revision replaces its staged input, while real conflicts remain',async t=>{
 const {store}=await fixture(t),id='RC-10-2026-0110',w={identifier:id,work_type:'def/ep-document-types/RESOLUTION_MOTION_JOINT',document_date:'2026-02-11',creator:['org/S-D','org/ECR','org/RENEW','org/THE-LEFT','org/PPE','org/VERTS-ALE']};
 // Upgrade-shaped row: the previous parser's output from the same retained bytes (three groups, no parser revision).
 const old={...storyDocument(w,source),groups:['ECR','RENEW','PPE']};delete old.parser;
 store.db.prepare('INSERT INTO story_inputs VALUES (?,?,?,?,?,?)').run('document',id,JSON.stringify({...old,source:undefined}),JSON.stringify(source),stamp,1);
 stageStoryInput(store,w,source);let d=storyInput(store,'document',id);
 assert.equal(d.conflicted,undefined);assert.deepEqual(d.groups,['S_D','ECR','RENEW','THE_LEFT','PPE','VERTS_ALE']);assert.equal(d.groupsAvailable,true);
 stageStoryInput(store,{...w,creator:['org/PPE']},source);d=storyInput(store,'document',id);
 assert.equal(d.conflicted,true,'different bytes at the same time and rank under the same parser still conflict');
 // Migration only forgives parser-derived fields: a legacy row with another changed field, or an earlier conflict, stays conflicted.
 const id2='RC-10-2026-0111',w2={...w,identifier:id2},legacy={...storyDocument(w2,source),groups:['ECR'],date:'2026-02-10'};delete legacy.parser;
 store.db.prepare('INSERT INTO story_inputs VALUES (?,?,?,?,?,?)').run('document',id2,JSON.stringify({...legacy,source:undefined}),JSON.stringify(source),stamp,1);
 stageStoryInput(store,w2,source);assert.equal(storyInput(store,'document',id2).conflicted,true,'a changed date is not a parser-derived change');
 const id3='RC-10-2026-0112',w3={...w,identifier:id3},flagged={...storyDocument(w3,source),groups:['ECR'],conflicted:true};delete flagged.parser;
 store.db.prepare('INSERT INTO story_inputs VALUES (?,?,?,?,?,?)').run('document',id3,JSON.stringify({...flagged,source:undefined}),JSON.stringify(source),stamp,1);
 stageStoryInput(store,w3,source);assert.equal(storyInput(store,'document',id3).conflicted,true,'an earlier conflict survives a parser upgrade');
});
test('vote items are classified by the verbatim item own label, never a speech copy that disagrees',()=>{
 assert.equal(votingDebate({titles:{en:'Iran (vote)'}},['Iran']),true);
 assert.equal(votingDebate({titles:{en:'Iran'}},['Iran (vote)']),false);
 assert.equal(votingDebate(null,['Iran (vote)','Iran (vote)']),true,'unread item: unanimous speech copies decide');
 assert.equal(votingDebate(null,['Iran (vote)','Iran']),false);
 assert.equal(votingDebate(null,['Iran (vote)',null]),false,'a speech without an English label keeps it a debate');
 assert.equal(votingDebate({titles:{fr:'Iran (vote)'}},['Iran (vote)']),false,'a read item without an English label stays a debate');
 assert.equal(votingDebate(null,[]),false);
 assert.equal(votingDebate({titles:{}},['Iran (vote)','Iran (vote)']),false,'a read item with no labels stays a debate');
 assert.equal(votingDebate({titles:{en:'Iran (vote)'},conflicted:true},['Iran (vote)']),false,'conflicted labels never establish a vote');
});
test('an excluded vote item leaves every topic, keyword and place counter',async t=>{
 const {store}=await fixture(t),day='2025-03-12',proc='2025-2111';
 const items=[['MTG-PL-'+day+'-PVCRE-ITM-7-2','Support for Ukraine (vote)','Support for Ukraine (debate)'],['MTG-PL-'+day+'-PVCRE-ITM-8','Support for Ukraine (debate)','Support for Ukraine (vote)']];
 store.putSource(1,'/plenary-documents/B-10-2025-0020','document',{id:'eli/dl/doc/B-10-2025-0020',identifier:'B-10-2025-0020',work_type:'def/ep-document-types/RESOLUTION_MOTION',document_date:day,title_dcterms:{en:'MOTION FOR A RESOLUTION on Ukraine'},creator:['org/PPE'],is_about:[geo('UKR'),'http://eurovoc.europa.eu/245'],inverse_based_on_a_realization_of:items.map(([id])=>'eli/dl/event/'+id),inverse_created_a_realization_of:['eli/dl/proc/'+proc]},stamp);
 let n=0;for(const [debate,own,copy] of items){stageStoryInput(store,{activity_id:debate,activity_date:day,activity_label:{en:own},executed:[]},source,{rank:4});
  for(const person of own.endsWith('(vote)')?['1','2','3','4','5']:['1','2','3']){const id='MTG-PL-'+day+'-OTH-9'+(++n);store.putSource(1,'/speeches/'+id,'speech',{outside:{id,date:day,titles:{en:copy},participants:[person],parentIds:[debate],headers:[{personId:person}],source}},stamp);store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(1,'/speeches/'+id,id,person,'plenary-contributions',day,JSON.stringify({speechKind:'PLENARY_DEBATE_SPEECH'}));}}
 await buildTopics(store);
 const [vote,debate]=items.map(x=>x[0]);
 const story=storyFacts(store,new URLSearchParams('scope=topic&key=eurovoc:245'));assert.deepEqual(story.debates.map(d=>d.id),[debate]);assert.equal(story.counts.debates,1);
 const members=id=>store.db.prepare('SELECT COUNT(*) n FROM record_topic_memberships WHERE generation=1 AND record_id=?').get(id).n;
 assert.equal(members(vote),0,'no topic, keyword or place membership remains for the vote item');
 assert(members(debate)>0);
 const debates=store.db.prepare("SELECT COALESCE(SUM(n),0) n FROM record_topic_totals WHERE generation=1 AND key='eurovoc:245' AND kind='debate'").get().n;assert.equal(debates,1,'detail series count the same debates as the story');
 assert.equal(store.get('recordTopicCalendar').periodTotals['2025-Q1'].debate,1,'global period totals leave the vote item out too');
 const detail=new RecordTopics(store).query(new URLSearchParams('key=eurovoc:245&lang=en'),'detail');
 assert.equal(detail.groups.find(g=>g.key===vote)?.kind,'record','the vote item group is not presented as a debate');
 assert.equal(detail.groups.find(g=>g.key===vote)?.agendaId,undefined);
 assert.equal(detail.groups.find(g=>g.key===debate)?.kind,'debate');
 const tops=detail.series.map(x=>x.top).filter(Boolean);assert(tops.length);for(const t of tops)assert.equal(t.kind,t.key===vote?'record':undefined,'series tops carry the voting-time kind');
 for(const peak of Object.values(detail.peaks).flat())for(const g of peak.groups)assert(!(g.key===vote&&g.kind==='debate'),'peaks never label the vote item a debate');
 assert(Object.values(detail.peaks).flat().some(p=>p.groups.some(g=>g.key===vote)),'the vote group still counts in all-kind groups');
});
test('story projection links exact records, excludes institutions and statements, and narrows debate places',async t=>{
 const {dir,store}=await fixture(t),day='2025-03-12',debate='MTG-PL-'+day+'-PVCRE-ITM-1',agenda='MTG-PL-'+day+'-OJ-ITM-D-1',vote='MTG-PL-'+day+'-VOT-ITM-10',decision='MTG-PL-'+day+'-DEC-1',proc='2025-2110',joint='RC-10-2025-0010';
 store.putSource(1,'/procedures/'+proc,'procedure',{id:'eli/dl/proc/'+proc,label:'2025/2110(INI)'},stamp);
 const makeDoc=(id,type,groups,extra={})=>({id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/'+type,document_date:day,title_dcterms:{en:'MOTION FOR A RESOLUTION on Ukraine'},creator:groups.map(g=>'org/'+g),is_about:[geo('UKR'),geo('HUN'),'http://eurovoc.europa.eu/245'],inverse_based_on_a_realization_of:['eli/dl/event/'+debate,'eli/dl/event/'+agenda,'eli/dl/event/'+vote],inverse_created_a_realization_of:['eli/dl/proc/'+proc],...extra});
 for(const [id,type,groups,extra] of [['B-10-2025-0010','RESOLUTION_MOTION',['PPE'],{}],['B-10-2025-0011','RESOLUTION_MOTION',['ECR'],{}],[joint,'RESOLUTION_MOTION_JOINT',['RENEW'],{is_derivative_of:['eli/dl/doc/B-10-2025-0010','eli/dl/doc/B-10-2025-0011'],inverse_based_on_a_realization_of:['eli/dl/event/'+debate,'eli/dl/event/'+agenda]}]])store.putSource(1,'/plenary-documents/'+id,'document',makeDoc(id,type,groups,extra),stamp);
 stageStoryInput(store,{activity_id:agenda,activity_date:day,activity_label:{en:'Support for Ukraine'},headingLabel:{en:'Joint debate - Support for Ukraine'},structuredContent:{en:'<root><type>Council and Commission statements</type></root>'},inverse_was_scheduled_in:['eli/dl/proc/'+proc]},source,{rank:4});
 stageStoryInput(store,{activity_id:debate,activity_date:day,executed:['eli/dl/event/'+agenda]},source,{rank:4});
 stageStoryInput(store,{activity_id:vote,activity_date:day,consists_of:['eli/dl/event/'+decision]},source,{rank:4});
 stageStoryInput(store,{activity_id:decision,activity_date:day,inverse_consists_of:['eli/dl/event/'+vote],activity_label:{en:'RC-B10-0010/2025 – Motion for a resolution (as a whole)'},decision_outcome:'def/ep-decision-outcomes/ADOPTED',decision_method:'def/ep-decision-methods/VOTE_HAND'},source,{rank:4});
 for(const [n,person,kind,capacity,role] of [[1,'1','PLENARY_DEBATE_SPEECH',null,null],[2,'2','PLENARY_DEBATE_SPEECH','commission',null],[3,'3','PLENARY_DEBATE_WRITTEN_STATEMENT',null,null],[4,'4','PLENARY_DEBATE_SPEECH',null,'CHAIR'],[5,'1','PLENARY_DEBATE_SPEECH',null,null]]){
  const id='MTG-PL-'+day+'-OTH-'+n;store.putSource(1,'/speeches/'+id,'speech',{outside:{id,date:day,titles:{en:'1. Support for Ukraine (debate)'},participants:[person],parentIds:[debate],parentDocumentIds:['CRE-10-'+day+'-ITM-001'],parentDocumentId:'CRE-10-'+day+'-ITM-001',headers:[{personId:person,capacity}],source}},stamp);
  store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(1,'/speeches/'+id,id,person,'plenary-contributions',day,JSON.stringify({speechKind:kind,speechRole:role}));
 }
 await buildTopics(store);assert.equal(new RecordTopics(store).record(vote,'en').kind,'vote');const result=storyFacts(store,new URLSearchParams('scope=place&key=place:UKR&period=2025-Q1'));
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

test('known undated adoptions count for the term, never a quarter, and remain in complete pages',async t=>{
 const {store}=await fixture(t);await buildTopics(store);
 for(let n=1;n<=25;n++){const id='B-10-2025-'+String(n).padStart(4,'0'),d={id,reference:'B10-'+String(n).padStart(4,'0')+'/2025',type:'RESOLUTION_MOTION',date:'2025-03-12',titles:{en:'Motion '+n},rule:[],groups:[],places:['GRC'],keywords:[],procedures:[],derivedFrom:[],outcomeStatus:'known',outcome:{decisionId:'d'+n,date:n<=12?'2025-04-02':null,outcome:'ADOPTED',for:100,against:10,abstentions:0,labels:{},references:{}}};store.db.prepare('INSERT INTO story_facts VALUES (?,?,?,?,?)').run(1,'document',id,d.date,JSON.stringify(d));}
 await finishStoryProjection(store,1);
 const whole=storyFacts(store,new URLSearchParams('scope=place&key=GRC&list=adoptedTexts'));assert.equal(whole.counts.adoptedTexts,25);assert.equal(whole.counts.adoptedTextsUndated,13);assert.equal(whole.sets.adoptedUndated.length,13);assert.equal(whole.page.total,25);assert.equal(whole.page.items.length,20);assert(whole.page.nextCursor);
 const next=storyFacts(store,new URLSearchParams({scope:'place',key:'GRC',list:'adoptedTexts',cursor:whole.page.nextCursor}));assert.equal(next.page.items.length,5);assert(next.page.items.every(r=>r.date===null));assert.equal(new Set([...whole.page.items,...next.page.items].map(r=>r.id)).size,25);assert.equal(next.page.nextCursor,null);
 const quarterResult=storyFacts(store,new URLSearchParams('scope=place&key=GRC&period=2025-Q2'));assert.equal(quarterResult.counts.adoptedTexts,12);assert.equal(quarterResult.counts.adoptedTextsUndated,0);assert.equal(quarterResult.sets.adoptedTexts['2025-Q2'].length,12);
});

test('place evidence fetches the exact two primary-first leaders and the qualified text headline',async t=>{
 const {store}=await fixture(t);await buildTopics(store);const ids=[];
 for(const [n,meps,primary] of [[1,30,true],[2,20,true],[3,20,true],[4,100,false],[5,2,true]]){const id='MTG-PL-2025-03-12-PVCRE-ITM-'+n;ids[n]=id;const d={id,date:'2025-03-12',titles:{en:'Debate '+n},meps,speeches:meps,format:null,agendaClassified:true,primaryPlace:primary?'GRC':null,places:[{id:'GRC',basis:'title',bases:['title']}],procedures:[],docs:[]};store.db.prepare('INSERT INTO story_facts VALUES (?,?,?,?,?)').run(1,'debate',id,d.date,JSON.stringify(d));}
 for(const [n,votes] of [[1,10],[2,100]]){const id='B-10-2025-000'+n,d={id,reference:'B10-000'+n+'/2025',type:'RESOLUTION_MOTION',date:'2025-03-12',titles:{en:'Motion '+n},rule:[],groups:[],places:['GRC'],keywords:[],procedures:[],derivedFrom:[],outcomeStatus:'known',outcome:{decisionId:'d'+n,date:'2025-04-02',outcome:'ADOPTED',for:votes,against:0,abstentions:0,labels:{},references:{}}};store.db.prepare('INSERT INTO story_facts VALUES (?,?,?,?,?)').run(1,'document',id,d.date,JSON.stringify(d));}
 store.db.prepare('INSERT INTO story_links VALUES (?,?,?,?)').run(1,'debate-document',ids[5],'B-10-2025-0001');await finishStoryProjection(store,1);
 const q1=storyFacts(store,new URLSearchParams('scope=place&key=GRC&period=2025-Q1'));assert.deepEqual(q1.winners.leadingPlaceDebates3Plus.map(r=>r.id),[ids[1],ids[2],ids[3]]);assert(q1.winners.leadingPlaceDebates3Plus.every(r=>r.primaryPlace));assert.equal(q1.winners.busiestDebates[0].id,ids[4]);
 const q2=storyFacts(store,new URLSearchParams('scope=place&key=GRC&period=2025-Q2'));assert.equal(q2.winners.headlineAdoptedTexts[0].id,'B-10-2025-0001');assert.deepEqual(q2.winners.headlineAdoptedTexts3Plus,[]);
 store.db.prepare('INSERT INTO story_links VALUES (?,?,?,?)').run(1,'debate-document',ids[2],'B-10-2025-0001');await finishStoryProjection(store,1);const qualified=storyFacts(store,new URLSearchParams('scope=place&key=GRC&period=2025-Q2'));assert.deepEqual(qualified.winners.headlineAdoptedTexts3Plus,[{id:'B-10-2025-0001',debateMeps:20,votesFor:10}]);
});

test('not-home story questions combine elsewhere and unknown without changing their flags',async t=>{
 const {store}=await fixture(t);store.setMembers([{id:'1',countryCode:'GR'},{id:'2',countryCode:'CY'}]);
 for(const [n,mep] of [[1,'1'],[2,'2'],[3,'99']])store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(1,'/questions/E-10-2025-00000'+n,'E-10-2025-00000'+n,mep,'written-questions','2025-03-12',JSON.stringify({titles:{en:'Greece'}}));await buildTopics(store);
 const read=askers=>storyFacts(store,new URLSearchParams({scope:'place',key:'GRC',askers,list:'questions',period:'2025-Q1'}));const all=read('all'),away=read('not-home');assert.equal(away.counts.questions,all.counts.questions-all.counts.questionHome);assert.equal(away.counts.questions,2);assert.equal(away.counts.questionHome,0);assert.equal(away.counts.questionElsewhere,1);assert.equal(away.counts.questionUnknown,1);assert.equal(away.page.total,2);assert.deepEqual(new Set(away.questions.map(q=>q.askers.GRC)),new Set(['elsewhere','unknown']));assert.equal(read('elsewhere').counts.questions,1);
});

test('stories use reconciled document-event edges and preserve absent versus empty executed',async t=>{
 const day='2025-03-12',debate='MTG-PL-'+day+'-PVCRE-ITM-1',agenda='MTG-PL-'+day+'-OJ-ITM-D-1',vote='MTG-PL-'+day+'-VOT-ITM-1',doc='B-10-2025-0010',decision='MTG-PL-'+day+'-DEC-1';
 for(const scenario of ['fallback','empty-executed','event-retracted','document-retracted'])await t.test(scenario,async t=>{
  const {store}=await fixture(t),old={...source,fetchedAt:'2026-10-01T12:00:00Z'},newer={...source,fetchedAt:'2026-10-02T12:00:00Z'};
  const work={identifier:doc,work_type:'def/ep-document-types/RESOLUTION_MOTION',document_date:day,title_dcterms:{en:'Ukraine'},is_about:[geo('UKR')],inverse_based_on_a_realization_of:(scenario==='document-retracted'?[]:[debate,agenda,vote]).map(id=>'eli/dl/event/'+id)};
  store.putSource(1,'/plenary-documents/'+doc,'document',work,scenario==='document-retracted'?newer.fetchedAt:old.fetchedAt);
  const retracted=scenario==='event-retracted';for(const id of [debate,vote])stageStoryInput(store,{activity_id:id,activity_date:day,based_on_a_realization_of:retracted?[]:['eli/dl/doc/'+doc],...(scenario==='empty-executed'&&id===debate?{executed:[]}:{}),...(id===vote?{consists_of:['eli/dl/event/'+decision]}:{})},retracted?newer:old,{rank:4});
  stageStoryInput(store,{activity_id:agenda,activity_date:day,structuredContent:{en:'<type>Commission statement</type>'}},old,{rank:4});
  stageStoryInput(store,{activity_id:decision,inverse_consists_of:['eli/dl/event/'+vote],activity_label:{en:'B10-0010/2025 – Motion for a resolution (as a whole)'},decision_outcome:'def/ep-decision-outcomes/ADOPTED'},old,{rank:4});
  const speech='MTG-PL-'+day+'-OTH-1';store.putSource(1,'/speeches/'+speech,'speech',{outside:{id:speech,date:day,titles:{en:'Ukraine'},participants:['1'],parentIds:[debate],headers:[],source:old}},old.fetchedAt);store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(1,'/speeches/'+speech,speech,'1','plenary-contributions',day,JSON.stringify({speechKind:'PLENARY_DEBATE_SPEECH'}));
  await buildTopics(store,{cache:null});const result=storyFacts(store,new URLSearchParams('scope=place&key=UKR'));
  const d=result.debates[0],body=JSON.parse(store.db.prepare("SELECT body FROM story_facts WHERE generation=1 AND kind='document' AND id=?").get(doc).body);
  if(scenario==='fallback'){assert.equal(d.agendaId,agenda);assert.equal(d.agendaVia,'document');assert.equal(body.outcomeStatus,'known');}
  else {assert.equal(d.agendaId,null);if(scenario==='empty-executed')assert(d.docs.includes(doc));else {assert(!d.docs.includes(doc));assert(!body.events.includes(debate));assert(!body.events.includes(vote));assert.equal(body.outcome,null);assert.equal(body.outcomeStatus,'unknown');}}
 });
});


test('retained story shapes gain new fields without inventing a same-source conflict',async t=>{
 const {store}=await fixture(t),id='MTG-PL-2025-03-12-VOT-ITM-1',work={activity_id:id,activity_date:'2025-03-12',based_on_a_realization_of:['eli/dl/doc/B-10-2025-0010']};stageStoryInput(store,work,source,{rank:2});const get=()=>JSON.parse(store.db.prepare("SELECT body FROM story_inputs WHERE kind='result' AND id=?").get(id).body),old=get();delete old.date;delete old.type;delete old.relationships;store.db.prepare("UPDATE story_inputs SET body=? WHERE kind='result' AND id=?").run(JSON.stringify(old),id);
 stageStoryInput(store,work,source,{rank:2});assert.equal(get().conflicted,undefined);assert.equal(get().date,'2025-03-12');assert.equal(get().type,'PLENARY_VOTE_RESULTS');stageStoryInput(store,{...work,based_on_a_realization_of:[]},source,{rank:2});assert.equal(get().conflicted,true);
});
test('vote decisions wait for the sitting day to pass and recheck empty replies on a decaying schedule',async t=>{
 const {store}=await fixture(t),{decisionRecheck}=await import('./story-facts-collector.mjs'),DAY=86400_000,sitting='MTG-PL-2026-11-02',start=Date.parse('2026-11-02T00:00:00Z');let now=Date.parse('2026-11-02T15:00:00Z'),reply={status:204,payload:{data:[]}},calls=0;
 const worker={store,clock:()=>now,requests:0,budget:100,controller:new AbortController(),request:async()=>{calls++;return {url:'https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/decisions',fetchedAt:new Date(now).toISOString(),...reply};}};
 const job=()=>store.db.prepare('SELECT state,next_read,error FROM story_jobs WHERE key=?').get('decisions:'+sitting);
 queueStoryRead(store,'decisions',sitting);assert.equal(await collectStorySource(worker),true,'postponing counts as work');assert.equal(calls,0,'no read on the sitting day');assert.equal(job().next_read,start+DAY);
 store.set('storyProjectionDirty',false);now=start+DAY;store.acquire();assert(await collectStorySource(worker));assert.equal(calls,1);assert.deepEqual({...job()},{state:'unavailable',next_read:start+3*DAY,error:'http-204'});assert(store.get('storyProjectionDirty'));
 store.set('storyProjectionDirty',false);now=start+3*DAY;store.acquire();reply={payload:{data:[]}};assert(await collectStorySource(worker));assert.deepEqual({...job()},{state:'unavailable',next_read:start+7*DAY,error:'empty-response'});
 store.set('storyProjectionDirty',false);now=start+7*DAY;store.acquire();assert(await collectStorySource(worker));assert.equal(job().next_read,start+30*DAY);assert.equal(store.get('storyProjectionDirty'),false,'an unchanged recheck does not dirty stories');
 now=start+30*DAY;store.acquire();assert(await collectStorySource(worker));assert.deepEqual({...job()},{state:'available',next_read:null,error:null});assert.equal(calls,4);
 now+=365*DAY;store.acquire();assert.equal(await collectStorySource(worker),false);assert.equal(calls,4,'the final observation is kept');
 assert.deepEqual([0,1,2,3,6,7,29,30].map(d=>decisionRecheck(sitting,start+d*DAY)),[1,3,3,7,7,30,30,null].map(d=>d===null?null:start+d*DAY));
 const held='MTG-PL-2025-03-12';queueStoryRead(store,'decisions',held);reply={payload:{data:[{activity_id:held+'-DEC-1'}]}};assert(await collectStorySource(worker));assert.equal(store.db.prepare('SELECT state FROM story_jobs WHERE key=?').get('decisions:'+held).state,'available');
});
test('each committed agenda batch marks the projection dirty',async t=>{
 const {store}=await fixture(t),sitting='MTG-PL-2025-03-12';queueStoryRead(store,'agenda',sitting);store.set('topicProjectionDirty',false);
 const items=Array.from({length:30},(_,i)=>({activity_id:sitting+'-OJ-ITM-D-'+(i+1),activity_date:'2025-03-12',activity_label:{en:'Item '+i}}));let commits=0;
 const transaction=store.transaction.bind(store);store.transaction=fn=>transaction(()=>{const result=fn();commits++;if(commits===1)assert.equal(store.get('topicProjectionDirty'),true,'the first batch commit carries the dirty flag');return result;});
 const worker={store,clock:Date.now,requests:0,budget:10,controller:new AbortController(),request:async()=>({url:'https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/foreseen-activities',fetchedAt:new Date().toISOString(),payload:{data:items}})};
 assert(await collectStorySource(worker));assert(commits>=2);assert(store.get('topicProjectionDirty'));
});
test('the projection queues vote decisions only for sittings before today',async t=>{
 let now=Date.parse('2026-10-28T10:00:00Z');const {store}=await fixture(t,{clock:()=>now}),day='2026-10-28',vote='MTG-PL-'+day+'-VOT-ITM-10',id='B-10-2026-0400';
 store.putSource(1,'/plenary-documents/'+id,'document',{id:'eli/dl/doc/'+id,identifier:id,work_type:'def/ep-document-types/RESOLUTION_MOTION',document_date:day,title_dcterms:{en:'MOTION FOR A RESOLUTION'},creator:['org/PPE'],inverse_based_on_a_realization_of:['eli/dl/event/'+vote]},stamp);
 const queued=()=>store.db.prepare("SELECT COUNT(*) n FROM story_jobs WHERE kind='decisions'").get().n;
 await buildTopics(store);assert.equal(queued(),0,'no decision read is queued on the sitting day');
 now=Date.parse('2026-10-29T10:00:00Z');store.acquire();await buildTopics(store);assert.equal(queued(),1);
});

test('the event type decides before any label: PLENARY_VOTE excludes, PLENARY_DEBATE keeps',()=>{
 assert.equal(votingDebate({titles:{en:'Motions for resolutions - Nigeria'},type:'PLENARY_VOTE'},[]),true);
 assert.equal(votingDebate({titles:{en:'Something (vote)'},type:'PLENARY_DEBATE'},['Something (vote)']),false);
 assert.equal(votingDebate(null,['Nigeria'],'def/ep-activities/PLENARY_VOTE'),true,'a retained topic-event type counts before the read');
 assert.equal(votingDebate({titles:{en:'Nigeria'},type:'PLENARY_VOTE',conflicted:true},[],null),false,'conflicted evidence never establishes a vote');
 assert.equal(votingDebate({titles:{en:'Nigeria (vote)'}},[]),true,'labels still decide without a type');
});
test('vote-typed items leave story and topic counters, events read before types are read once more, and proceeding markers are not debates',async t=>{
 const {store}=await fixture(t),day='2026-07-09',proc='2026-2111',vote='MTG-PL-'+day+'-PVCRE-ITM-9-6',debate='MTG-PL-'+day+'-PVCRE-ITM-8',old='MTG-PL-'+day+'-PVCRE-ITM-10',marker='MTG-PL-'+day+'-OTH-2017087113155';
 store.putSource(1,'/plenary-documents/B-10-2026-0300','document',{id:'eli/dl/doc/B-10-2026-0300',identifier:'B-10-2026-0300',work_type:'def/ep-document-types/RESOLUTION_MOTION',document_date:day,title_dcterms:{en:'MOTION FOR A RESOLUTION on Nigeria'},creator:['org/PPE'],is_about:[geo('NGA'),'http://eurovoc.europa.eu/245'],inverse_based_on_a_realization_of:[vote,debate,old].map(id=>'eli/dl/event/'+id),inverse_created_a_realization_of:['eli/dl/proc/'+proc]},stamp);
 stageStoryInput(store,{activity_id:vote,activity_date:day,activity_label:{en:'Nigeria'},had_activity_type:'def/ep-activities/PLENARY_VOTE',executed:[]},source,{rank:4});
 stageStoryInput(store,{activity_id:debate,activity_date:day,activity_label:{en:'Nigeria (debate)'},had_activity_type:'def/ep-activities/PLENARY_DEBATE',executed:[]},source,{rank:4});
 // An event read before types were retained: its stored input has no type key.
 store.db.prepare('INSERT INTO story_inputs VALUES (?,?,?,?,?,?)').run('event',old,JSON.stringify({id:old,executed:[],executedKnown:true,titles:{en:'Nigeria again (debate)'},date:day,relationships:{}}),JSON.stringify(source),stamp,4);
 store.db.prepare("INSERT INTO story_jobs(key,kind,id,state,next_read) VALUES (?,?,?,'available',NULL)").run('event:'+old,'event',old);
 store.db.exec('CREATE TABLE IF NOT EXISTS story_seen_pages(job TEXT,signature TEXT,PRIMARY KEY(job,signature))');store.db.prepare('INSERT INTO story_seen_pages VALUES (?,?)').run('event:'+old,'sig');
 store.db.prepare("INSERT INTO story_jobs(key,kind,id,state,next_read) VALUES (?,?,?,'available',NULL)").run('event:'+debate,'event',debate);
 let n=0;for(const parent of [vote,debate,old])for(const person of ['1','2','3']){const id='MTG-PL-'+day+'-OTH-8'+(++n);store.putSource(1,'/speeches/'+id,'speech',{outside:{id,date:day,titles:{en:'Nigeria'},participants:[person],parentIds:[parent],headers:[{personId:person}],source}},stamp);store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(1,'/speeches/'+id,id,person,'plenary-contributions',day,JSON.stringify({speechKind:'PLENARY_DEBATE_SPEECH'}));}
 await buildTopics(store);
 const story=storyFacts(store,new URLSearchParams('scope=place&key=NGA&period=2026-Q3'));
 assert.deepEqual(story.debates.map(d=>d.id).sort(),[debate,old].sort(),'the PLENARY_VOTE item is not a debate although its label lacks "(vote)"');
 assert.equal(store.db.prepare("SELECT COUNT(*) n FROM record_topic_memberships WHERE generation=1 AND record_id=? AND kind='debate'").get(vote).n,0);
 assert.equal(store.db.prepare("SELECT state FROM story_jobs WHERE key=?").get('event:'+old).state,'pending','a type-less read is queued once more');
 assert.equal(store.db.prepare("SELECT COUNT(*) n FROM story_seen_pages WHERE job=?").get('event:'+old).n,0,'its page signature is cleared so the re-read is staged');
 assert.equal(store.db.prepare("SELECT state FROM story_jobs WHERE key=?").get('event:'+debate).state,'available','a typed read is not repeated');
 // Proceeding markers and chair announcements carry their own type from the speech feed; they are never debate records or groups.
 const {putTopicRecords}=await import('./topics-store.mjs');const record=(id,type)=>({id,kind:'event',activityType:'def/ep-activities/'+type,date:day,titles:{en:'Catch-the-eye procedure'},assignments:[{key:'place:NGA',role:'place',paths:[]}],parentIds:[],procedureIds:[],agendaIds:[],members:[],status:'classified'});
 putTopicRecords(store,1,[record(marker,'PROCEEDING_ACTIVITY'),record('MTG-PL-'+day+'-OTH-2017087113160','MEETING_NAME_CHAIR'),record('MTG-PL-'+day+'-PVCRE-ITM-11','PLENARY_DEBATE')]);
 for(const id of [marker,'MTG-PL-'+day+'-OTH-2017087113160']){assert.equal(store.db.prepare('SELECT COUNT(*) n FROM record_topic_records WHERE generation=1 AND id=?').get(id).n,0,'proceeding markers are not debate records');assert.equal(store.db.prepare('SELECT COUNT(*) n FROM record_topic_memberships WHERE generation=1 AND record_id=?').get(id).n,0);}
 assert.equal(store.db.prepare('SELECT kind FROM record_topic_records WHERE generation=1 AND id=?').get('MTG-PL-'+day+'-PVCRE-ITM-11').kind,'debate','real debates keep their kind');
});

test('a held legacy event takes its type from the retained raw observation with no network read',async t=>{
 const {store}=await fixture(t),day='2026-03-26',id='MTG-PL-'+day+'-PVCRE-ITM-9-2';
 // Legacy collector input (rank 4) without a type key, and its completed read job.
 const legacy={id,executed:[],executedKnown:true,titles:{en:'Explanations of vote'},date:day,relationships:{executed:[]}};
 store.db.prepare('INSERT INTO story_inputs VALUES (?,?,?,?,?,?)').run('event',id,JSON.stringify(legacy),JSON.stringify(source),stamp,4);
 store.db.prepare("INSERT INTO story_jobs(key,kind,id,state,next_read) VALUES (?,?,?,'available',NULL)").run('event:'+id,'event',id);
 // The same observation retained as raw bytes (rank 3) carries the type.
 assert(stageStoryInput(store,{activity_id:id,activity_date:day,activity_label:{en:'Explanations of vote'},had_activity_type:'def/ep-activities/PLENARY_VOTE_EXPLANATIONS',executed:[]},source,{rank:3}));
 const d=storyInput(store,'event',id);assert.equal(d.type,'PLENARY_VOTE_EXPLANATIONS');assert.equal(d.conflicted,undefined,'enrichment of the same observation is not a conflict');
 for(const person of ['1','2','3']){const sid='MTG-PL-'+day+'-OTH-7'+person;store.putSource(1,'/speeches/'+sid,'speech',{outside:{id:sid,date:day,titles:{en:'Explanations of vote'},participants:[person],parentIds:[id],headers:[{personId:person}],source}},stamp);store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(1,'/speeches/'+sid,sid,person,'plenary-contributions',day,JSON.stringify({speechKind:'PLENARY_DEBATE_SPEECH'}));}
 await buildTopics(store);
 assert.equal(store.db.prepare('SELECT state FROM story_jobs WHERE key=?').get('event:'+id).state,'available','no network read is queued for a held event');
 assert.equal(store.db.prepare("SELECT COUNT(*) n FROM story_facts WHERE generation=1 AND kind='debate' AND id=? AND json_extract(body,'$.procedural')=0").get(id).n,0,'explanations of vote are not a debate');
 // A legacy input whose type is held only by an older retained observation keeps its body, yet is typed and not read again.
 const other='MTG-PL-'+day+'-PVCRE-ITM-9-3';store.db.prepare('INSERT INTO story_inputs VALUES (?,?,?,?,?,?)').run('event',other,JSON.stringify({...legacy,id:other}),JSON.stringify(source),stamp,4);
 store.db.prepare("INSERT INTO story_jobs(key,kind,id,state,next_read) VALUES (?,?,?,'available',NULL)").run('event:'+other,'event',other);
 stageStoryInput(store,{id:other,date:day,kind:'PLENARY_VOTE_EXPLANATIONS'},{...source,fetchedAt:'2026-01-01T00:00:00Z'},{rank:2});assert.equal(storyEventType(store,other).type,'PLENARY_VOTE_EXPLANATIONS');assert.equal(Object.hasOwn(storyInput(store,'event',other),'type'),false);
 for(const person of ['1','2','3']){const sid='MTG-PL-'+day+'-OTH-6'+person;store.putSource(1,'/speeches/'+sid,'speech',{outside:{id:sid,date:day,titles:{en:'Explanations of vote'},participants:[person],parentIds:[other],headers:[{personId:person}],source}},stamp);store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(1,'/speeches/'+sid,sid,person,'plenary-contributions',day,JSON.stringify({speechKind:'PLENARY_DEBATE_SPEECH'}));}
 await buildTopics(store);
 assert.equal(store.db.prepare('SELECT state FROM story_jobs WHERE key=?').get('event:'+other).state,'available','retained type evidence prevents a re-download');
 assert.equal(store.db.prepare("SELECT json_extract(body,'$.procedural') p FROM story_facts WHERE generation=1 AND kind='debate' AND id=?").get(other)?.p,1,'the retained type excludes it');
});
test('every vote-related type in the retained vocabulary is excluded and non-vote types are not',async()=>{
 const fs=await import('node:fs/promises'),dir=new URL('./fixtures/',import.meta.url),terms=new Set();
 for(const f of await fs.readdir(dir))if(f.endsWith('.json'))for(const m of (await fs.readFile(new URL(f,dir),'utf8')).matchAll(/ep-activities\/([A-Z_]+)/g))terms.add(m[1]);
 const vote=[...terms].filter(t=>/VOTE|OUTCOME|DECISION/.test(t));assert(vote.includes('PLENARY_VOTE_EXPLANATIONS'));
 for(const t of vote)assert(voteActivity(t),t);
 for(const t of ['PLENARY_DEBATE','PLENARY_DEBATE_SPEECH','PLENARY_DEBATE_WRITTEN_STATEMENT','PROCEEDING_ACTIVITY','MEETING_PART','MEETING_NAME_CHAIR','PLENARY_SITTING','PLENARY_ACTIVITY'])assert.equal(voteActivity(t),false,t);
 assert.equal(votingDebate({titles:{en:'Explanations of vote'},type:'PLENARY_VOTE_EXPLANATIONS'}),true);
});
test('conflicting type evidence from any source never excludes',async t=>{
 const {store}=await fixture(t),id='MTG-PL-2026-03-26-PVCRE-ITM-5';
 stageStoryInput(store,{activity_id:id,activity_label:{en:'Item'},had_activity_type:'def/ep-activities/PLENARY_VOTE'},{...source,url:'a'},{rank:3});
 stageStoryInput(store,{activity_id:id,activity_label:{en:'Item'},had_activity_type:'def/ep-activities/PLENARY_DEBATE'},{...source,url:'b'},{rank:3});
 const evidence=storyEventType(store,id);assert.equal(evidence.conflicted,1,'same-time opposite types conflict whatever their order');
 assert.equal(votingDebate(storyInput(store,'event',id),['Item (vote)'],evidence.type,Boolean(evidence.conflicted)),false);
 assert.equal(votingDebate({titles:{en:'Item (vote)'},type:'PLENARY_VOTE',conflicted:true},['Item (vote)']),false,'without resolved evidence a conflicted story event never excludes');
 assert.equal(votingDebate({titles:{en:'Item'},type:'PLENARY_DEBATE',conflicted:true},[],'PLENARY_VOTE',false),true,'the shared resolver decides, as for topic records');
});

// Integration: held types arrive through the real ingestion paths, never by a network read.
async function heldEventFixture(t,{child,parent,day}){
 const dir=await mkdtemp(path.join(tmpdir(),'story-held-')),cache=path.join(dir,'cache');await (await import('node:fs/promises')).mkdir(cache);const store=new ActivityStore(path.join(dir,'index'),{initializeIndexes:true});store.acquire();store.set('active',1);storyTables(store.db);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const legacy={id:child,executed:[],executedKnown:true,titles:{en:'Nigeria'},date:day,relationships:{executed:[]}};
 store.db.prepare('INSERT INTO story_inputs VALUES (?,?,?,?,?,?)').run('event',child,JSON.stringify(legacy),JSON.stringify(source),stamp,4);
 store.db.prepare("INSERT INTO story_jobs(key,kind,id,state,next_read) VALUES (?,?,?,'available',NULL)").run('event:'+child,'event',child);
 store.putSource(1,'/plenary-documents/B-10-2026-0310','document',{id:'eli/dl/doc/B-10-2026-0310',identifier:'B-10-2026-0310',work_type:'def/ep-document-types/RESOLUTION_MOTION',document_date:day,title_dcterms:{en:'MOTION FOR A RESOLUTION on Nigeria'},creator:['org/PPE'],is_about:[geo('NGA'),'http://eurovoc.europa.eu/245'],inverse_based_on_a_realization_of:['eli/dl/event/'+child]},stamp);
 for(const person of ['1','2','3']){const sid='MTG-PL-'+day+'-OTH-5'+person;store.putSource(1,'/speeches/'+sid,'speech',{outside:{id:sid,date:day,titles:{en:'Nigeria'},participants:[person],parentIds:[child],headers:[{personId:person}],source}},stamp);store.db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?,?)').run(1,'/speeches/'+sid,sid,person,'plenary-contributions',day,JSON.stringify({speechKind:'PLENARY_DEBATE_SPEECH'}));}
 return {store,cache};
}
const heldChecks=(store,child)=>{
 assert.equal(storyEventType(store,child)?.type,'PLENARY_VOTE','the held type is recorded');
 assert.equal(store.db.prepare('SELECT state FROM story_jobs WHERE key=?').get('event:'+child).state,'available','no read is queued');
 assert.equal(store.db.prepare("SELECT json_extract(body,'$.procedural') p FROM story_facts WHERE generation=1 AND kind='debate' AND id=?").get(child)?.p,1,'the vote is not a debate');
 assert.equal(store.db.prepare("SELECT COUNT(*) n FROM record_topic_memberships WHERE generation=1 AND record_id=? AND kind='debate'").get(child).n,0);
};
test('an outside-agenda record supplies a held type through ingestion with no read',async t=>{
 const day='2026-07-09',child='MTG-PL-'+day+'-PVCRE-ITM-9-6',{store}=await heldEventFixture(t,{child,day});
 store.putSource(1,'outside:agenda:'+child,'outside-agenda',{id:child,date:day,titles:{en:'Nigeria'},kind:'PLENARY_VOTE',procedureIds:[],source:{url:'https://data.europarl.europa.eu/api/v2/events/'+child,fetchedAt:'2026-10-20T11:10:24.838Z'}},stamp);
 await buildTopics(store,{cache:null});heldChecks(store,child);
});
test('a retained raw parent supplies its embedded child type through ingestion with no read',async t=>{
 const day='2026-07-09',parent='MTG-PL-'+day+'-PVCRE-ITM-9',child=parent+'-6',{store,cache}=await heldEventFixture(t,{child,day});
 await (await import('node:fs/promises')).writeFile(path.join(cache,'b'.repeat(64)+'.json'),JSON.stringify({url:'https://data.europarl.europa.eu/api/v2/events/'+parent,fetchedAt:Date.parse('2026-10-20T12:00Z'),payload:{data:[{id:'eli/dl/event/'+parent,activity_id:parent,activity_date:day,activity_label:{en:'Voting time'},had_activity_type:'def/ep-activities/PLENARY_VOTE',consists_of:[{id:'eli/dl/event/'+child,activity_id:child,activity_date:day,had_activity_type:'def/ep-activities/PLENARY_VOTE',activity_label:{en:'Nigeria'},inverse_consists_of:['eli/dl/event/'+parent]}]}]}}));
 await buildTopics(store,{cache});heldChecks(store,child);
});
for(const order of [['PLENARY_DEBATE','PLENARY_VOTE'],['PLENARY_VOTE','PLENARY_DEBATE']])test('stories and topic records agree when same-time types conflict: '+order.join(' then '),async t=>{
 const day='2026-07-09',child='MTG-PL-'+day+'-PVCRE-ITM-12',{store,cache}=await heldEventFixture(t,{child,day});
 const fs=await import('node:fs/promises'),at=Date.parse('2026-11-02T12:00Z');
 for(const [n,type] of [['c',order[0]],['d',order[1]]])await fs.writeFile(path.join(cache,n.repeat(64)+'.json'),JSON.stringify({url:'https://data.europarl.europa.eu/api/v2/events/'+child+'?'+n,fetchedAt:at,payload:{data:[{id:'eli/dl/event/'+child,activity_id:child,activity_date:day,activity_label:{en:'Nigeria'},had_activity_type:'def/ep-activities/'+type}]}}));
 await buildTopics(store,{cache});
assert.equal(storyEventType(store,child).conflicted,1);
 assert.equal(store.db.prepare("SELECT json_extract(body,'$.procedural') p FROM story_facts WHERE generation=1 AND kind='debate' AND id=?").get(child)?.p,0,'conflicting evidence keeps a story debate');
 assert.equal(store.db.prepare('SELECT kind FROM record_topic_records WHERE generation=1 AND id=?').get(child)?.kind,'debate','the topic record agrees');
 const totals=store.get('recordTopicCalendar').periodTotals['2026-Q3'];assert.equal(totals.debate,1);assert.equal(totals.vote,0);
});

// One resolver: a standalone child observation and a newer retained parent embedding it.
for(const [older,newer] of [['PLENARY_DEBATE','PLENARY_VOTE'],['PLENARY_VOTE','PLENARY_DEBATE']])test('stories and topics resolve the newest type the same way: '+older+' then '+newer,async t=>{
 const day='2026-07-09',parent='MTG-PL-'+day+'-PVCRE-ITM-9',child=parent+'-6',{store,cache}=await heldEventFixture(t,{child,day}),fs=await import('node:fs/promises');
 await fs.writeFile(path.join(cache,'e'.repeat(64)+'.json'),JSON.stringify({url:'https://data.europarl.europa.eu/api/v2/events/'+child,fetchedAt:Date.parse('2026-11-02T12:00Z'),payload:{data:[{id:'eli/dl/event/'+child,activity_id:child,activity_date:day,activity_label:{en:'Nigeria'},had_activity_type:'def/ep-activities/'+older}]}}));
 await fs.writeFile(path.join(cache,'f'.repeat(64)+'.json'),JSON.stringify({url:'https://data.europarl.europa.eu/api/v2/events/'+parent,fetchedAt:Date.parse('2026-11-03T12:00Z'),payload:{data:[{id:'eli/dl/event/'+parent,activity_id:parent,activity_date:day,activity_label:{en:'Voting time'},had_activity_type:'def/ep-activities/PLENARY_VOTE',consists_of:[{id:'eli/dl/event/'+child,activity_id:child,activity_date:day,activity_label:{en:'Nigeria'},had_activity_type:'def/ep-activities/'+newer,inverse_consists_of:['eli/dl/event/'+parent]}]}]}}));
 await buildTopics(store,{cache});
 const vote=newer==='PLENARY_VOTE';assert.equal(storyEventType(store,child).type,newer,'the newest observation is the resolved type');
 assert.equal(store.db.prepare("SELECT json_extract(body,'$.procedural') p FROM story_facts WHERE generation=1 AND kind='debate' AND id=?").get(child)?.p,vote?1:0,'story');
 assert.equal(store.db.prepare('SELECT kind FROM record_topic_records WHERE generation=1 AND id=?').get(child)?.kind,vote?'vote':'debate','topic record');
 const totals=store.get('recordTopicCalendar').periodTotals['2026-Q3'];assert.equal(totals.debate,vote?0:1);
 assert.equal(store.db.prepare("SELECT COUNT(*) n FROM record_topic_memberships WHERE generation=1 AND record_id=?").get(child).n>0,!vote||store.db.prepare("SELECT COUNT(*) n FROM record_topic_memberships WHERE generation=1 AND record_id=? AND kind='vote'").get(child).n>0,'a resolved debate keeps its memberships');
 const story=storyFacts(store,new URLSearchParams('scope=place&key=NGA&period=2026-Q3'));assert.equal(story.debates.some(d=>d.id===child),!vote);
});

// A type conflict must not discard the record: ingestion, eviction of the raw cache, rebuild.
for(const order of [['PLENARY_DEBATE','PLENARY_VOTE'],['PLENARY_VOTE','PLENARY_DEBATE']])test('a same-time type conflict keeps the record and its date after the raw cache is evicted: '+order.join(' then '),async t=>{
 const day='2026-07-09',child='MTG-PL-'+day+'-PVCRE-ITM-12',{store,cache}=await heldEventFixture(t,{child,day}),fs=await import('node:fs/promises'),at=Date.parse('2026-11-02T12:00Z');
 const files=[['c',order[0]],['d',order[1]]].map(([n,type])=>[path.join(cache,n.repeat(64)+'.json'),type]);
 for(const [file,type] of files)await fs.writeFile(file,JSON.stringify({url:'https://data.europarl.europa.eu/api/v2/events/'+child+'?'+type,fetchedAt:at,payload:{data:[{id:'eli/dl/event/'+child,activity_id:child,activity_date:day,activity_label:{en:'Nigeria'},had_activity_type:'def/ep-activities/'+type}]}}));
 await buildTopics(store,{cache});
 const input=storyInput(store,'event',child);assert.equal(input.conflicted,undefined,'a type disagreement does not mark the input conflicted');assert.equal(input.date,day);assert.equal(input.type,null);assert.equal(storyEventType(store,child).conflicted,1);
 for(const [file] of files)await fs.rm(file);
 await buildTopics(store,{cache});
 const record=store.db.prepare('SELECT kind,date FROM record_topic_records WHERE generation=1 AND id=?').get(child);assert.deepEqual({...record},{kind:'debate',date:day},'the rebuilt record keeps its kind and date');
 assert(store.db.prepare('SELECT COUNT(*) n FROM record_topic_memberships WHERE generation=1 AND record_id=? AND date=?').get(child,day).n>0);
 assert.equal(store.get('recordTopicCalendar').periodTotals['2026-Q3'].debate,1);
 assert(storyFacts(store,new URLSearchParams('scope=place&key=NGA&period=2026-Q3')).debates.some(d=>d.id===child));
});
