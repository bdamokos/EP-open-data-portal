import {stageStoryInput,storyTables} from './story-facts-storage.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {RECORD_TOPICS_VERSION,projectRecordTopics} from './record-topics.mjs';
import {RecordTopics,writeTopicProjection,finishTopicProjectionBatched,quarter,topicPeriods} from './topics-store.mjs';
import officialSubjects from './oeil-subjects.json' with {type:'json'};
import {countryMatches,eurovocCountries} from './topic-roles.mjs';
const doc='B-10-2026-0423',event='MTG-PL-2026-10-07-PVCRE-ITM-12',speech='MTG-PL-2026-10-07-OTH-100',proc='2026-2790';
const nodes=()=>[{id:doc,kind:'document',date:'2026-10-07',titles:{en:'Georgia'},eurovoc:['http://eurovoc.europa.eu/245','http://eurovoc.europa.eu/5652'],subjectMatter:['http://publications.europa.eu/resource/authority/subject-matter/DDLH'],procedureIds:[proc]}, {id:proc,kind:'procedure',reference:'2026/2790(RSP)'},{id:event,kind:'event',date:'2026-10-07',documentIds:[doc],procedureEdges:[{id:proc,field:'inverse_consists_of'}]},{id:speech,kind:'speech',date:'2026-10-07',parentIds:[event]}, {id:'E-10-2026-003158',kind:'question',date:'2026-10-07',titles:{en:'Georgia and Ukraine'},eurovoc:['http://eurovoc.europa.eu/245']}];
const options=()=>({procedureTopics:new Map([[proc,{reference:'2026/2790(RSP)',assignments:[{concept:{key:'oeil:7.30.30.06',uri:'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2026/2790(RSP)',labels:{en:'Human rights',fr:'Droits humains'}},steps:[],sources:[]}]}]])});
function fixture(t){const dir=mkdtempSync(path.join(tmpdir(),'topics-')),store=new ActivityStore(dir,{initializeIndexes:true});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});store.acquire();store.set('active',1);return store;}
test('one-to-one country mapping excludes either direction of ambiguity',()=>{const rows=[{concept:'a',country:'x/A'},{concept:'a',country:'x/B'},{concept:'c',country:'x/C'},{concept:'d',country:'x/C'},{concept:'e',country:'x/E'}];assert.deepEqual([...countryMatches(rows)],[['e','E']]);assert(!eurovocCountries.has('http://eurovoc.europa.eu/5458'));assert(![...eurovocCountries.values()].includes('EUR'));assert(eurovocCountries.size>200);});
test('roles and exact inheritance keep written questions unclassified with title places',t=>{const store=fixture(t),projection=projectRecordTopics(nodes(),options());writeTopicProjection(store,projection);const service=new RecordTopics(store);const r=service.record(speech,'fr');assert.equal(r.topics[0].label,officialSubjects.subjects['7.30.30.06'].labels.fr);assert(r.keywords.some(k=>k.key==='eurovoc:245'));assert(r.places.some(p=>p.id==='GEO'&&p.basis==='official'));assert(!r.keywords.some(k=>k.key==='eurovoc:5652'));assert.throws(()=>service.query(new URLSearchParams('key=eurovoc:5652'),'detail'));assert(!r.keywords.some(k=>k.key.startsWith('subject-matter:')));const q=service.record('E-10-2026-003158','en');assert.deepEqual(q.topics,[]);assert.deepEqual(q.keywords,[]);assert.equal(q.status,'not-classified');assert(q.places.some(p=>p.id==='GEO'&&p.basis==='title'));});
test('ambiguous speech parents withhold all inherited annotations',()=>{const ns=nodes();ns.find(n=>n.id===speech).parentIds=[event,'MTG-PL-2026-10-07-PVCRE-ITM-13'];const r=projectRecordTopics(ns,options()).records.find(r=>r.id===speech);assert.equal(r.status,'ambiguous');assert.deepEqual(r.assignments,[]);});
test('quarters use Brussels calendar date and include partial term boundaries',()=>{assert.equal(quarter('2024-07-16'),'2024-Q3');assert.deepEqual(topicPeriods(Date.parse('2024-09-30T22:30:00Z')),['2024-Q3','2024-Q4']);});
test('overview uses sparse period objects, localized search and grouped detail',t=>{const store=fixture(t);writeTopicProjection(store,projectRecordTopics(nodes(),options()));const service=new RecordTopics(store),run=(view,query)=>service.query(new URLSearchParams(query),view);const overview=run('overview','');assert.equal(overview.items.length,1);assert.equal(overview.items[0].total,3);assert.equal(overview.items[0].series[0].period,'2026-Q4');assert.equal(run('search','q=fraude&lang=fr').results[0].role,'topic');assert.equal(run('search','q=corruption').results[0].total,3);const detail=run('detail','key=oeil:7.30.30.06');assert.equal(detail.total,3);assert.equal(detail.groups.length,1);assert.equal(detail.groups[0].speechCount,1);assert.equal(detail.groups[0].items.length,2);assert.equal(detail.facets.topics[0].n,3);assert.equal(run('detail','key=oeil:7.30.30.06&kind=speech').groups[0].speechCount,1);assert.equal(run('detail','key=oeil:7.30.30.06&to=2025-01-01').total,0);});
test('pagination counts groups rather than records; readiness never turns missing into zero',t=>{const store=fixture(t),ns=Array.from({length:43},(_,i)=>({id:'B-10-2026-'+String(i).padStart(6,'0'),kind:'document',date:'2026-10-07',eurovoc:['http://eurovoc.europa.eu/245']}));const service=new RecordTopics(store);assert.deepEqual(service.query(new URLSearchParams('key=eurovoc:245'),'detail'),{ready:false});writeTopicProjection(store,projectRecordTopics(ns));let offset=0,seen=[];do{const r=service.query(new URLSearchParams('key=eurovoc:245&offset='+offset),'detail');assert.equal(r.total,43);seen.push(...r.groups.map(g=>g.key));offset=r.nextOffset;}while(offset!==null);assert.equal(new Set(seen).size,43);store.set('active',2);assert.deepEqual(service.query(new URLSearchParams(''),'overview'),{ready:false});assert.throws(()=>service.query(new URLSearchParams('ids='+Array(51).fill('x').join(','))));});

test('oral questions inherit only their explicit debate, while vote records retain their own kind',t=>{
 const store=fixture(t),ns=nodes(),q='O-10-2026-000031';ns.push({id:q,kind:'question',date:'2026-10-07',titles:{en:'Question on Ukraine'}});ns.find(n=>n.id===event).documentIds.push(q);
 ns.push({id:'MTG-PL-2026-10-07-OJ-ITM-V-1',kind:'event',activityType:'def/ep-activities/PLENARY_VOTE',date:'2026-10-07',documentIds:[doc]});
 writeTopicProjection(store,projectRecordTopics(ns,options()));const service=new RecordTopics(store),question=service.record(q,'en');assert(question.topics.length);assert(question.places.some(p=>p.id==='UKR'&&p.basis==='title'));assert(!question.places.some(p=>p.id==='GEO'));assert.equal(service.record('MTG-PL-2026-10-07-OJ-ITM-V-1','en').kind,'vote');
});

test('Belarus uses the published replacement and typed ISO alpha-3 notation',async t=>{
 const {countryIdentity}=await import('./topic-country-identity.mjs');assert.deepEqual(countryIdentity('BYS'),{id:'BLR',iso2:'BY',iso3:'BLR'});assert.equal(countryIdentity('1A0').iso3,null);
 const store=fixture(t);writeTopicProjection(store,projectRecordTopics([{id:'E-10-2026-000001',kind:'question',date:'2026-10-07',titles:{en:'Belarus'}}]));const r=new RecordTopics(store).record('E-10-2026-000001','en');assert.equal(r.places[0].id,'BLR');assert.equal(r.places[0].iso3,'BLR');assert.equal(r.places[0].basis,'title');
});
test('group units, spike captions and denominators accompany sparse overview and filtered detail series',t=>{
 const store=fixture(t);writeTopicProjection(store,projectRecordTopics(nodes(),options()));const service=new RecordTopics(store),overview=service.query(new URLSearchParams(),'overview'),item=overview.items[0],s=item.series[0];assert.equal(item.total,3);assert.equal(item.groupsTotal,1);assert.equal(s.groups,1);assert(s.top.key&&s.top.date&&s.top.title!==s.top.key);assert.equal(overview.periodTotals['2026-Q4'].question,1);assert.equal(overview.periodTotals['2026-Q4'].document,1);assert.equal(overview.sittingDays['2026-Q4'],1);assert.equal(overview.sittingDays['2024-Q3'],null);assert.deepEqual(overview.partial,{first:'2024-07-16',last:'2026-10-07'});
 const detail=service.query(new URLSearchParams('key=oeil:7.30.30.06&kind=speech'),'detail');assert.equal(detail.series[0].groups,1);assert.equal(detail.series[0].speech,1);assert(detail.series[0].top.key&&detail.series[0].top.title!==detail.series[0].top.key);assert.equal(detail.groupsTotal,1);
 const places=service.query(new URLSearchParams('role=place'),'overview');for(const p of places.items)assert.equal(p.total,Object.values(p.counts).reduce((a,b)=>a+b,0));assert(places.items.find(p=>p.id==='GEO').iso3==='GEO');
});

test('keyword co-occurrence counts a shared record once across several policy areas',t=>{
 const store=fixture(t),topicKeys=['oeil:3.10.01','oeil:7.30.30.06'],keywords=['eurovoc:100','eurovoc:200'];
 const records=[['B-10-2026-000001',[...topicKeys,...keywords]],['B-10-2026-000002',[...topicKeys,'eurovoc:200']],['B-10-2026-000003',[topicKeys[0],'eurovoc:100']]].map(([id,keys])=>({id,kind:'document',date:'2026-10-07',status:'classified',titles:{en:'A saved heading'},assignments:keys.map(key=>({key,role:key.startsWith('oeil:')?'topic':'keyword',paths:[]}))}));
 const concepts=[...topicKeys,...keywords].map(key=>({key,role:key.startsWith('oeil:')?'topic':'keyword',uri:'http://eurovoc.europa.eu/'+key.split(':')[1],labels:{en:'Descriptor '+key},alternatives:{en:[]}}));writeTopicProjection(store,{records,concepts});const r=new RecordTopics(store).record(records[0].id,'en');assert.deepEqual(r.keywords.map(k=>k.key),keywords);assert(r.keywords.every(k=>k.featured));assert.deepEqual(r.topics.map(k=>k.key),topicKeys);
});

test('Greek question authors match Greece through authority ISO notation and Cyprus remains elsewhere',t=>{
 const store=fixture(t);store.setMembers([{id:'42',name:'Member',countryCode:'GR'}]);const ns=[{id:'E-10-2026-000001',kind:'question',date:'2026-10-07',titles:{en:'Greece and Cyprus'},members:['42']},{id:'E-10-2026-000002',kind:'question',date:'2026-10-07',titles:{en:'Greece and Cyprus'},members:['99']}];writeTopicProjection(store,projectRecordTopics(ns));const service=new RecordTopics(store),r=service.record(ns[0].id,'en');assert.equal(r.places.find(p=>p.id==='GRC').askers,'home');assert.equal(r.places.find(p=>p.id==='CYP').askers,'elsewhere');
 const overview=askers=>service.query(new URLSearchParams({role:'place',askers}),'overview'),all=overview('all'),greece=all.items.find(p=>p.id==='GRC').series[0];assert.equal(greece.question,2);assert.equal(greece.questionHome,1);assert.equal(greece.questionElsewhere,0);assert.equal(greece.questionUnknown,1);assert.equal(overview('elsewhere').items.find(p=>p.id==='CYP').counts.question,1);assert(!overview('elsewhere').items.some(p=>p.id==='GRC'));assert.equal(overview('home').items.find(p=>p.id==='GRC').counts.question,1);
 const detail=service.query(new URLSearchParams('key=place:GRC&askers=home'),'detail');assert.equal(detail.total,1);assert.equal(detail.groups[0].items[0].id,ns[0].id);assert.equal(detail.series[0].questionHome,1);assert.equal(detail.series[0].questionUnknown,0);assert(!service.query(new URLSearchParams('q=Greece&askers=elsewhere'),'search').results.some(p=>p.key==='place:GRC'));assert.throws(()=>overview('unknown'));
});

test('official urgency-request ballots remain votes rather than debates',t=>{
 const store=fixture(t),id='MTG-PL-2026-10-20-OJ-ITM-V-88';
 writeTopicProjection(store,projectRecordTopics([{id,kind:'event',activityType:'def/ep-activities/REQUEST_VOTE_URGENCY',date:'2026-10-20'}]));
 assert.equal(new RecordTopics(store).record(id,'en').kind,'vote');
});

test('detail has no arbitrary offset ceiling and long searches fail explicitly',t=>{
 const store=fixture(t);writeTopicProjection(store,projectRecordTopics(nodes(),options()));const reader=new RecordTopics(store);
 const beyond=reader.query(new URLSearchParams('key=oeil:7.30.30.06&offset=20020'),'detail');assert.equal(beyond.total,3);assert.deepEqual(beyond.groups,[]);assert.equal(beyond.nextOffset,null);
 assert.throws(()=>reader.query(new URLSearchParams({q:'x'.repeat(121)}),'search'),/shorter search/);
});

test('not-home includes elsewhere and unknown, with exact detail groups and overview counts',t=>{
 const store=fixture(t);store.setMembers([{id:'1',countryCode:'GR'},{id:'2',countryCode:'CY'}]);const ns=['1','2','99'].map((id,n)=>({id:'E-10-2026-00000'+(n+1),kind:'question',date:'2026-10-07',titles:{en:'Greece'},members:[id]}));writeTopicProjection(store,projectRecordTopics(ns));const reader=new RecordTopics(store);
 const detail=reader.query(new URLSearchParams('key=place:GRC&askers=not-home'),'detail');assert.equal(detail.total,2);assert.equal(detail.groupsTotal,2);assert.equal(detail.series[0].questionHome,0);assert.equal(detail.series[0].questionElsewhere,1);assert.equal(detail.series[0].questionUnknown,1);assert.deepEqual(new Set(detail.groups.flatMap(g=>g.items.map(i=>i.id))),new Set(ns.slice(1).map(n=>n.id)));
 const overview=reader.query(new URLSearchParams('role=place&askers=not-home'),'overview');assert.equal(overview.items[0].counts.question,2);assert.equal(overview.items[0].series[0].questionUnknown,1);assert.equal(reader.query(new URLSearchParams('key=place:GRC&askers=elsewhere'),'detail').total,1);
});

test('one detail response carries scoped records, whole-term chart and every tied metric peak title',t=>{
 const store=fixture(t);store.setMembers([{id:'1',countryCode:'GR'},{id:'2',countryCode:'CY'}]);const key='place:GRC',assignment=basis=>[{key,role:'place',paths:[{basis,steps:[],sources:[]}]}];
 const questions=[['1','2025-01-01'],['2','2025-01-02'],['99','2025-04-01'],['2','2025-04-02']].map(([mep,date],n)=>({id:'E-10-2025-00000'+(n+1),kind:'question',date,members:[mep],titles:{en:'Question '+n},assignments:assignment('title'),status:'classified'}));
 const docs=[1,2,3].map(n=>({id:'B-10-2025-00000'+n,kind:'document',date:'2025-08-0'+n,titles:{en:'Document '+n},procedureIds:n<3?['2025-0001']:[],assignments:assignment('official'),status:'classified'}));
 const debates=['2025-08-10','2025-10-10'].map((date,n)=>({id:'MTG-PL-'+date+'-OJ-ITM-D-1',kind:'debate',date,titles:{en:'Greece debate '+n},assignments:assignment('official'),status:'classified'}));
 writeTopicProjection(store,{records:[...questions,...docs,...debates,{id:'2025-0001',kind:'procedure',date:null,titles:{en:'Exact dossier',fr:'Procédure exacte'},assignments:[]}],concepts:[{key,role:'place',labels:{en:'Greece',fr:'Grèce'},uri:'http://publications.europa.eu/resource/authority/country/GRC'}]});
 const result=new RecordTopics(store).query(new URLSearchParams('key=place:GRC&kind=question&from=2025-04-01&to=2025-06-30&askers=not-home&lang=fr'),'detail');assert.equal(result.total,2);assert.equal(result.groups.length,2);assert.equal(result.series.length,1);assert.equal(result.series[0].period,'2025-Q2');assert.deepEqual(result.peaks.document,[]);
 assert.equal(result.chart.total,9);assert.deepEqual(result.chart.peaks.question.map(p=>p.period),['2025-Q1','2025-Q2']);assert(result.chart.peaks.question.every(p=>p.groups.length===2));assert.deepEqual(result.chart.peaks.debate.map(p=>p.period),['2025-Q3','2025-Q4']);const peak=result.chart.peaks.document[0];assert.equal(peak.period,'2025-Q3');assert.equal(peak.n,3);assert.equal(peak.groups.length,1);assert.equal(peak.groups[0].title,'Procédure exacte');assert.equal(peak.groups[0].language,'fr');assert.equal(peak.groups[0].kind,'procedure');assert.equal(peak.groups[0].n,2);assert.equal(result.chart.peaks.questionNotHome[0].period,'2025-Q2');assert.equal(result.chart.peaks.questionNotHome[0].n,2);
});
test('overview and detail count records within the same projection date bound',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'topic-bound-')),built=Date.parse('2026-10-20T10:00:00Z'),store=new ActivityStore(dir,{clock:()=>built});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});store.acquire();store.set('active',1);
 const concept={key:'oeil:8.20',role:'topic',labels:{en:'Area'},uri:'https://oeil.europarl.europa.eu/oeil/en'},record=(id,date)=>({id,kind:'document',date,titles:{en:id},status:'classified',assignments:[{key:concept.key,role:'topic',paths:[{basis:'direct',steps:[],sources:[]}]}]});
 writeTopicProjection(store,{concepts:[concept],records:[record('B-10-2026-0001','2026-10-07'),record('B-10-2026-0002','2026-11-05')]});
 assert.equal(store.get('recordTopicCalendar').end,'2026-10-20');store.clock=()=>Date.parse('2026-11-10T10:00:00Z');
 const topics=new RecordTopics(store),overview=topics.query(new URLSearchParams('role=topic'),'overview'),detail=topics.query(new URLSearchParams('key=oeil:8.20'),'detail');
 assert.equal(overview.items[0].total,1);assert.equal(detail.total,overview.items[0].total);assert.equal(topics.query(new URLSearchParams('key=oeil:8.20&to=2026-12-31'),'detail').total,1);
});

test('a country ID absent from the authority snapshot is unresolved, not a second place',async()=>{
 const {countryIdentity}=await import('./topic-country-identity.mjs');
 assert.equal(countryIdentity('XKX'),null);assert.equal(countryIdentity('1A0')?.id,'1A0');assert.equal(eurovocCountries.get('http://eurovoc.europa.eu/5695'),'XKX');
});

test('proceeding and chair events are dropped, including untyped OTH parents',t=>{
 const store=fixture(t),key='place:NGA',assignment={key,role:'place',paths:[]},date='2026-07-08',oth='MTG-PL-'+date+'-OTH-2017087113155',chair='MTG-PL-'+date+'-PVCRE-ITM-1',records=[{id:oth,kind:'event',activityType:null},{id:chair,kind:'event',activityType:'def/ep-activities/MEETING_NAME_CHAIR'},{id:'MTG-PL-'+date+'-PVCRE-ITM-2',kind:'event',activityType:'def/ep-activities/PROCEEDING_ACTIVITY'},{id:'MTG-PL-'+date+'-OTH-100',kind:'speech',parentIds:[oth],members:[]}].map(r=>({...r,date,titles:{en:'Nigeria'},assignments:[assignment]}));
 writeTopicProjection(store,{records,concepts:[{key,role:'place',labels:{en:'Nigeria'}}]});const detail=new RecordTopics(store).query(new URLSearchParams({key}),'detail');assert.equal(detail.total,1);assert(detail.groups.every(g=>g.kind!=='debate'));for(const r of records.filter(r=>r.kind==='event'))assert.equal(store.db.prepare('SELECT COUNT(*) n FROM record_topic_records WHERE id=?').get(r.id).n,0);
});
test('vote-family groups expose only one retained exact scheduled vote target',t=>{
 const store=fixture(t);storyTables(store.db);const date='2026-07-09',key='place:NGA',assignment={key,role:'place',paths:[]},scheduled=n=>'MTG-PL-'+date+'-OJ-ITM-V-'+n,event=n=>'MTG-PL-'+date+'-PVCRE-ITM-9-'+n;
 for(const n of [94,95])stageStoryInput(store,{activity_id:scheduled(n),activity_date:date,had_activity_type:'def/ep-activities/PLENARY_VOTE'}, {url:'https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-'+date+'/foreseen-activities',fetchedAt:'2026-07-10T00:00:00Z'});
 const refs=[[scheduled(94)],[],[scheduled(94),scheduled(95)],['MTG-PL-'+date+'-OJ-ITM-D-1']];const records=refs.map((agendaIds,n)=>({id:event(n+1),kind:'event',activityType:'def/ep-activities/PLENARY_VOTE_RESULTS',agendaIds,date,titles:{en:'Nigeria vote'},assignments:[assignment]}));writeTopicProjection(store,{records,concepts:[{key,role:'place',labels:{en:'Nigeria'}}]});const groups=new RecordTopics(store).query(new URLSearchParams({key}),'detail').groups;
 assert.equal(groups.find(g=>g.key===event(1)).agendaId,scheduled(94));for(const n of [2,3,4])assert(!groups.find(g=>g.key===event(n)).agendaId);assert(groups.every(g=>g.kind==='record'));
});

test('a dossier group whose newest item is a vote stays a dossier when the procedure record is absent',t=>{
 const store=fixture(t),key='place:NGA',assignment={key,role:'place',paths:[]};
 writeTopicProjection(store,{concepts:[{key,role:'place',labels:{en:'Nigeria'}}],records:[{id:'A10-0001/2026',kind:'document',procedureIds:['2026-0001'],date:'2026-07-01',titles:{en:'Report'},assignments:[assignment]},{id:'MTG-PL-2026-07-09-PVCRE-ITM-9-1',kind:'event',activityType:'def/ep-activities/PLENARY_VOTE_RESULTS',procedureIds:['2026-0001'],agendaIds:[],date:'2026-07-09',titles:{en:'Vote'},assignments:[assignment]}]});
 const groups=new RecordTopics(store).query(new URLSearchParams({key}),'detail').groups,dossier=groups.find(g=>g.key==='2026-0001');
 if(dossier){assert.equal(dossier.kind,'procedure');assert.equal(dossier.procedureId,'2026-0001');assert.equal(dossier.agendaId,undefined);}
 assert(!groups.some(g=>g.kind==='record'&&g.key==='2026-0001'),'a dossier group never becomes a record because of its newest item');
});

test('speeches under vote-family parents are records without an inferred agenda target',t=>{
 const store=fixture(t),date='2026-07-09',key='place:NGA',parent='MTG-PL-'+date+'-PVCRE-ITM-9-6',speech='MTG-PL-'+date+'-OTH-100';
 writeTopicProjection(store,{concepts:[{key,role:'place',labels:{en:'Nigeria'}}],records:[{id:parent,kind:'event',activityType:'def/ep-activities/PLENARY_VOTE_EXPLANATIONS',date,titles:{en:'Explanations of votes'},assignments:[]},{id:speech,kind:'speech',parentIds:[parent],members:[],date,titles:{en:'Speech'},assignments:[{key,role:'place',paths:[]}]}]});
 const group=new RecordTopics(store).query(new URLSearchParams({key}),'detail').groups[0];assert.equal(group.key,parent);assert.equal(group.kind,'record');assert.equal(group.speechCount,1);assert.equal(group.agendaId,undefined);
});


test('optional procedural summaries preserve overview bytes for old and new projections',async t=>{
 const store=fixture(t),projection=projectRecordTopics(nodes(),options());
 // Include an excluded parent, false and absent flags, and a missing parent.
 projection.records.find(r=>r.id===event).procedural=true;
 projection.records.find(r=>r.id===doc).procedural=false;
 writeTopicProjection(store,projection);
 for(const batched of [false,true]){
  if(batched)await finishTopicProjectionBatched(store,1,projection.concepts);
  const queries=['topic','place'].flatMap(role=>['all','home','elsewhere','not-home'].flatMap(askers=>['en','fr'].map(lang=>({role,askers,lang}))));
  const reader=new RecordTopics(store),read=()=>queries.map(q=>JSON.stringify(reader.query(new URLSearchParams(q),'overview'))),after=read();
  const tables=['record_topic_group_summary','record_topic_filtered_groups'];
  for(const table of tables){
   const rows=store.db.prepare(`SELECT top FROM ${table} WHERE top IS NOT NULL`).all();
   assert(rows.length>0);assert(rows.every(r=>[0,1].includes(JSON.parse(r.top).procedural)));
   store.db.exec(`UPDATE ${table} SET top=json_remove(top,'$.procedural') WHERE top IS NOT NULL`);
  }
  assert.deepEqual(read(),after,'legacy body lookups and projected flags serialize identically');
  const legacy=new RecordTopics({get:store.get.bind(store),readSnapshot:fn=>fn(),db:{prepare(sql){
   if(!/FROM record_topic_(?:group_summary|filtered_groups) WHERE/.test(sql))return store.db.prepare(sql);
   sql=sql.replace(' AND key IN (SELECT key FROM record_topic_concepts WHERE generation=? AND role=?)','');
   const statement=store.db.prepare(sql),n=(sql.match(/\?/g)||[]).length;
   return {iterate:(...args)=>statement.iterate(...args.slice(0,n))};
  }}});
  assert.deepEqual(queries.map(q=>JSON.stringify(legacy.query(new URLSearchParams(q),'overview'))),after,'unrestricted legacy summary scans preserve the same bytes');
 }
});

test('persisted English-only v7 place overview localises without a projection rebuild',t=>{
 const store=fixture(t),key='place:MAR';
 writeTopicProjection(store,{concepts:[{key,role:'place',labels:{en:'Morocco'}}],records:[{id:'E-10-2026-000001',kind:'question',date:'2026-07-01',titles:{en:'Morocco'},assignments:[{key,role:'place',paths:[]}]}]});
 const oldState={...store.get('recordTopicProjection'),version:7};store.set('recordTopicProjection',oldState);
 const persisted=store.db.prepare('SELECT body FROM record_topic_concepts WHERE generation=1 AND key=?').get(key).body;
 assert.deepEqual(JSON.parse(persisted).labels,{en:'Morocco'});assert.equal(RECORD_TOPICS_VERSION,7);
 const result=new RecordTopics(store).query(new URLSearchParams('role=place&lang=fr&askers=all'),'overview');
 assert.equal(result.ready,true);assert.equal(result.items[0].label,'Maroc');assert.equal(result.items[0].labelLanguage,'fr');
 assert.deepEqual(store.get('recordTopicProjection'),oldState);
 assert.equal(store.db.prepare('SELECT body FROM record_topic_concepts WHERE generation=1 AND key=?').get(key).body,persisted);
});
