import {yearCatalogue} from './test-support/catalogue-fixture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {documentRows,projectDocument,speechRows} from './activity-index-model.mjs';
import {agendaCreatorIds,agendaTopics,namedVote,topicVotes,voteScope,finalVotePatterns,topicRoles,classifyProcedure} from './insights-legislation-model.mjs';
import {LegislationInsights} from './insights-legislation.mjs';
import {insightQuery} from './insights-store.mjs';
import {createInsights} from './insights.mjs';
import {InsightViewCache} from './insights-view-cache.mjs';
import {INSIGHTS_VERSION} from './insights-model.mjs';
import {participation,participationQuery} from './insights-participation.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/insights-live-20261014.json',import.meta.url)));
const members=new Map([...new Set(fixture.decisions.payload.data.flatMap(v=>[...v.had_voter_favor,...v.had_voter_against,...v.had_voter_abstention]))].map(uri=>[uri.split('/').at(-1),{id:uri.split('/').at(-1),name:uri}]));
const metadata=new Map();
const meeting={payload:{data:[fixture.meetings.payload.data.find(n=>n.activity_id==='MTG-PL-2026-10-07')]}};
const topics=agendaTopics(meeting,fixture.foreseen);
test('weekly agendas retain each exact sitting, source and unavailable day without loading other weeks',async()=>{
  const clock=()=>Date.parse('2026-10-15T12:00:00Z'),calls=[];
  const nodes=['2026-10-06','2026-10-07','2026-10-08','2026-10-19'].map(date=>JSON.parse(JSON.stringify(meeting.payload.data[0]).replaceAll('2026-10-07',date)));
  const service=new LegislationInsights({status:()=>({currentMeps:1,servingGeneration:1})},{clock,request:yearCatalogue(async(endpoint)=>{
    calls.push(endpoint);
    if(endpoint.includes('2026-10-06'))throw new Error('Agenda not supplied');
    const payload=endpoint==='/meetings'?{data:nodes}:JSON.parse(JSON.stringify(fixture.foreseen.payload).replaceAll('2026-10-07',endpoint.includes('2026-10-08')?'2026-10-08':'2026-10-07'));
    return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:clock(),payload};
  })});
  const q=value=>insightQuery(new URLSearchParams(value),{kind:'legislation',now:clock()});
  const result=await service.query(q('week=latest'));
  assert.equal(result.week,'2026-10-05');assert.equal(result.agendaSittings.length,3);
  assert.equal(result.coverage.agendaComplete,false);assert.match(result.coverage.agendaError,/2026-10-06/);
  assert(result.topics.some(t=>t.sittingId==='MTG-PL-2026-10-07'));
  assert(result.topics.some(t=>t.sittingId==='MTG-PL-2026-10-08'));
  assert(result.topics.every(t=>t.id.startsWith(t.sittingId+'-')));
  assert.deepEqual(calls,['/meetings','/meetings','/meetings',...nodes.slice(0,3).map(s=>'/meetings/'+s.activity_id+'/foreseen-activities')]);
  assert(result.coverage.sources.some(s=>s.apiUrl.includes('2026-10-08')));
  assert.equal((await service.query(q('week=2026-10-05'))).topics.length,result.topics.length);
  await assert.rejects(service.query(q('week=2026-10-12')),e=>e.status===404);
  for(const value of ['week=','week=2026-10-06','week=2026-02-30','week=latest&sitting=MTG-PL-2026-10-07','week=2026-10-05&topic=foo','week=2026-10-05&vote=foo'])assert.throws(()=>q(value),e=>e.status===400,value);
});
test('plenary catalogue retains all current-term sittings across years and pages, including every published future sitting',async()=>{
  const node=date=>({id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING'});
  const dates=Array.from({length:155},(_,i)=>new Date(Date.parse('2024-07-15T12:00:00Z')+i*86400_000).toISOString().slice(0,10));
  const nodes=[...dates.map(node),node('2025-12-18'),node('2026-10-14'),...Array.from({length:6},(_,i)=>node('2026-11-'+String(i+1).padStart(2,'0')))];
  const calls=[],clock=()=>Date.parse('2026-10-15T12:00:00Z');
  const service=new LegislationInsights({status:()=>({currentMeps:1,servingGeneration:1})},{clock,request:yearCatalogue(async(endpoint,params)=>{
    calls.push([endpoint,params]);assert([2024,2025,2026].includes(params.year));
    return {url:'https://data.europarl.europa.eu/api/v2/meetings?offset='+params.offset,fetchedAt:clock(),payload:{data:nodes.filter(n=>Number(n.activity_date.slice(0,4))===params.year).slice(params.offset,params.offset+params.limit)}};
  })});
  const result=await service.catalogue();
  assert.deepEqual(calls.map(([,p])=>p.offset),[0,50,100,150,0,0]);
  assert.equal(result.sittings.length,nodes.length-1);assert(result.complete);
  assert.deepEqual(result.years,[2024,2025,2026]);assert.equal(result.start,'2024-07-16');
  assert.equal(result.sittings[0].activity_date,'2026-10-14');
  assert(result.sittings.some(s=>s.activity_date==='2024-07-16'));
  assert(!result.sittings.some(s=>s.activity_date==='2024-07-15'));
  assert.equal(result.sittings.filter(s=>s.activity_date>='2026-11-01').length,6);
  await service.catalogue();assert.equal(calls.length,6,'catalogue metadata is reused');
});
test('repeated full catalogue pages retain exact sittings with a paging gap',async()=>{
  const nodes=Array.from({length:50},(_,index)=>{const date=new Date(Date.parse('2026-01-01T12:00:00Z')+index*86400_000).toISOString().slice(0,10);return {id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING'};});let calls=0;
  const service=new LegislationInsights(null,{clock:()=>Date.parse('2026-10-15T12:00:00Z'),request:yearCatalogue(async()=>{calls++;return {payload:{data:nodes},url:'https://data.europarl.europa.eu/api/v2/meetings',fetchedAt:0};})});
  const result=await service.catalogue();assert.equal(result.complete,false);assert.equal(result.coverage.years[2].stopReason,'repeated-page');assert.equal(result.sittings.length,50);assert.equal(calls,4);
});
test('the first current-term sitting can be selected without fetching other sitting details',async()=>{
  const clock=()=>Date.parse('2026-10-15T12:00:00Z'),calls=[];
  const service=new LegislationInsights({status:()=>({currentMeps:1,servingGeneration:1})},{clock,request:yearCatalogue(async(endpoint)=>{
    calls.push(endpoint);return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:clock(),payload:{data:endpoint==='/meetings'?[{id:'eli/dl/event/MTG-PL-2024-07-16',activity_id:'MTG-PL-2024-07-16',activity_date:'2024-07-16',had_activity_type:'def/ep-activities/PLENARY_SITTING'}]:[]}};
  })});
  const result=await service.query({language:'en',sitting:'MTG-PL-2024-07-16'});
  assert.equal(result.sitting.date,'2024-07-16');assert.equal(result.sitting.phase,'past');
  assert.equal(result.coverage.catalogueStart,'2024-07-16');
  assert.deepEqual(calls,['/meetings','/meetings','/meetings','/meetings/MTG-PL-2024-07-16/foreseen-activities']);
});
test('unavailable historical agendas preserve the selected date and the sitting catalogue with an explicit gap',async()=>{
  const clock=()=>Date.parse('2026-10-15T12:00:00Z');
  const service=new LegislationInsights({status:()=>({currentMeps:1,servingGeneration:1})},{clock,request:yearCatalogue(async(endpoint)=>{
    if(endpoint!=='/meetings')throw new Error('No agenda supplied for this date');
    return {url:'https://data.europarl.europa.eu/api/v2/meetings',fetchedAt:clock(),payload:{data:[{id:'eli/dl/event/MTG-PL-2024-07-16',activity_id:'MTG-PL-2024-07-16',activity_date:'2024-07-16',had_activity_type:'def/ep-activities/PLENARY_SITTING'}]}};
  })});
  const result=await service.query({language:'en',sitting:'MTG-PL-2024-07-16'});
  assert.equal(result.sitting.date,'2024-07-16');assert.equal(result.sittings.length,1);
  assert.equal(result.coverage.agendaComplete,false);assert.equal(result.coverage.agendaError,'No agenda supplied for this date');
  assert.equal(result.topics.length,0);
});
test('the first plenary week remains selectable and missing agendas produce null observations and explicit gaps',async()=>{
  const clock=()=>Date.parse('2026-10-15T12:00:00Z'),calls=[];
  const store={clock:()=>Date.now(),get:()=>null,readSnapshot:fn=>fn(),status:()=>({currentMeps:1,servingGeneration:1}),db:{prepare:()=>({get:()=>undefined,all:()=>[{id:'125065',body:'{"id":"125065","name":"Test member"}'}]})}};
  const service=new LegislationInsights(store,{clock,loadMetadata:async()=>new Map(),request:yearCatalogue(async(endpoint)=>{
    calls.push(endpoint);if(endpoint!=='/meetings')throw new Error('No agenda supplied for this date');
    return {url:'https://data.europarl.europa.eu/api/v2/meetings',fetchedAt:clock(),payload:{data:['2024-07-16','2024-07-17'].map(date=>({id:'eli/dl/event/MTG-PL-'+date,activity_id:'MTG-PL-'+date,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_SITTING'}))}};
  })});
  const result=await participation(service,store,participationQuery(new URLSearchParams('week=2024-07-15')),{clock});
  assert.deepEqual(result.window,{start:'2024-07-15',end:'2024-07-21'});
  assert.equal(result.coverage.gaps.length,2);assert(result.coverage.gaps.every(g=>g.kind==='agenda-unavailable'));
  assert(result.series.every(row=>row.speakers===null&&row.voters===null&&row.amendmentVotes===null));
  assert.equal(calls.length,5);assert(!calls.some(ep=>/vote-results|decisions|speeches/.test(ep)));
});
test('actual agenda contains 18 topics through supplied meeting-part child refs, with exact doc/procedure links',()=>{
  assert.equal(topics.length,18);const t=topics.find(t=>t.id.endsWith('-V-48'));
  assert.deepEqual(t.documentIds,['A-10-2026-0237']);assert.deepEqual(t.procedureIds,['2025-2117']);
  const rogue={...fixture.foreseen.payload.data.find(n=>n.activity_id.endsWith('-V-48')),id:'eli/dl/event/unlinked',activity_id:'unlinked'};
  assert.equal(agendaTopics(meeting,{...fixture.foreseen,payload:{data:[...fixture.foreseen.payload.data,rogue]}}).length,18);
});
test('real final-resolution roll-call has 454/86/110 actual named voters; intended corrections never move the actual person',()=>{
  const raw=fixture.decisions.payload.data[0],v=namedVote(raw,fixture.decisions,members,metadata,'2026-10-07');
  assert.equal(v.scope,'final-text');assert.equal(v.uniqueNamedVoters,650);assert.deepEqual(v.namedCounts,{for:454,against:86,abstaining:110});assert(v.totalsMatchNamed);
  assert.equal(v.intendedCorrections.abstaining.length,1);assert.equal(v.intendedCorrections.abstaining[0].id,'197591');
  const actual=Object.keys(v.groups).filter(k=>v.groups[k].some(p=>p.id==='197591'));
  assert.deepEqual(actual,['for']);assert.equal(v.groups.abstaining.some(p=>p.id==='197591'),false);
  assert.equal(voteScope(fixture.decisions.payload.data[2]),'amendment');
  assert.equal(voteScope({referenceText:{en:'Unknown subject'}}),'unclassified');
});
test('named votes join only exact result.executed and decision parents, not similar labels or matching report text',()=>{
  const t=topics.find(t=>t.id.endsWith('-V-48'));
  const votes=topicVotes(t,fixture.results,fixture.decisions,members,metadata,'2026-10-07');
  assert.equal(votes.length,1);assert.equal(votes[0].id,'MTG-PL-2026-10-07-DEC-197457');assert.deepEqual(votes[0].associations[0].procedureIds,['2025-2117']);
  assert.equal(topicVotes({...t,uri:'eli/dl/event/unlinked'},fixture.results,fixture.decisions,members,metadata,'2026-10-07').length,0);
  const patterns=finalVotePatterns(votes,members,metadata);assert.equal(patterns.voteCount,1);assert.equal(patterns.uniqueNamedPeople,650);assert.equal(patterns.groups.for.length,454);
});
test('aggregate-only and conflicting voter sources remain explicit; absent records are not abstention',()=>{
  const raw=fixture.decisions.payload.data[0],aggregate={...raw};delete aggregate.had_voter_favor;
  const v=namedVote(aggregate,fixture.decisions,members,metadata,'2026-10-07');assert.equal(v.groups,null);assert.equal(v.uniqueNamedVoters,null);assert.equal(v.currentRosterWithoutNamedRecord,null);
  const conflicting={...raw,had_voter_against:[...raw.had_voter_against,raw.had_voter_favor[0]]};
  const c=namedVote(conflicting,fixture.decisions,members,metadata,'2026-10-07');assert.equal(c.conflictingVoterIds.length,1);assert.equal(c.totalsMatchNamed,false);assert.equal(c.namedCounts.for,453);
  const extra=new Map([...members,['999999',{id:'999999',name:'No record'}]]);assert.equal(namedVote(raw,fixture.decisions,extra,metadata,'2026-10-07').namedCounts.abstaining,110);
});
test('real report role keeps exact source person, role and participation date; missing procedure classification stays unknown',()=>{
  const work=fixture.report.payload.data[0],topic=topics.find(t=>t.id.endsWith('-V-48'));
  const source={work,key:'/plenary-documents/'+work.identifier,fetchedAt:new Date(fixture.report.fetchedAt).toISOString()};
  const roles=topicRoles(topic,documentRows(work,source.key,source.fetchedAt).rows,[source],members,metadata);
  assert(roles.some(r=>r.role==='RAPPORTEUR'));assert(roles.every(r=>r.sourceId==='A-10-2026-0237'&&r.apiUrl.endsWith('/plenary-documents/A-10-2026-0237')));
  assert.equal(classifyProcedure({id:'eli/dl/proc/2025-2117'}).classification,'unresolved');assert.equal(classifyProcedure({process_type:'authority/COD'}).classification,'legislative');
  assert.equal(classifyProcedure(fixture.procedure.payload.data[0]).classification,'non-legislative');assert.equal(classifyProcedure(fixture.procedure.payload.data[0]).code,'INI');
});
test('read-only service uses exact parent/child speech join, bounded requests and source cache; no worker or schema mutation',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'insights-legislation-test-')),store=new ActivityStore(directory);const calls=[];
  try {
    store.acquire();const {generation}=store.beginCycle();store.setMembers([...members.values()]);
    const s=fixture.speech.payload.data[0];store.putSource(generation,'/speeches/'+s.activity_id,'speech',{id:s.activity_id},new Date(fixture.speech.fetchedAt).toISOString(),speechRows(s,new Date(fixture.speech.fetchedAt).toISOString()));
    const report=fixture.report.payload.data[0];store.putSource(generation,'/plenary-documents/'+report.identifier,'document',projectDocument(report),new Date(fixture.report.fetchedAt).toISOString(),documentRows(report,'/plenary-documents/'+report.identifier,new Date(fixture.report.fetchedAt).toISOString()).rows);
    const request=async(ep,params)=>{calls.push([ep,params]);if(ep==='/meetings')return params.offset===0?fixture.meetings:{...fixture.meetings,payload:{data:[]}};if(ep.endsWith('/foreseen-activities'))return fixture.foreseen;if(ep.startsWith('/speeches/'))return fixture.speech;if(ep==='/events/'+fixture.speechParent.payload.data[0].activity_id)return fixture.speechParent;if(ep.endsWith('/vote-results'))return fixture.results;if(ep.endsWith('/decisions')){assert.equal(params['vote-method'],'ROLL_CALL_EV');assert(!('filter-output' in params));return fixture.decisions;}if(ep.startsWith('/plenary-documents/'))return fixture.report;throw new Error('Source not retained in this projected fixture: '+ep);};
    const clock=()=>Date.parse('2026-10-14T09:30:00Z');const service=new LegislationInsights(store,{request:yearCatalogue(request),clock,loadMetadata:async()=>metadata});store.db.exec('PRAGMA query_only=ON');
    const q=s=>insightQuery(new URLSearchParams(s),{kind:'legislation',now:clock()});
    const result=await service.query(q('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-D-69'));
    assert.equal(result.detail.speeches.length,1);assert.equal(result.detail.speeches[0].sourceId,s.activity_id);assert.equal(result.detail.speeches[0].people[0].id,'257043');assert.equal(result.detail.coverage.speechAssociations.exactChildReferences,70);
    assert.equal(result.detail.coverage.speechAssociations.childrenWithoutSavedContributionRows,69);assert.equal(result.coverage.indexComplete,false);
    assert.deepEqual(result.detail.people.find(p=>p.id==='257043').demographics,{country:'Unknown',group:'Unknown',gender:'Unknown',age:'Unknown'});
    const actual=await service.query(q('sitting=MTG-PL-2026-10-07&topic='+fixture.speechParent.payload.data[0].activity_id));
    assert.equal(actual.detail.id,fixture.speechParent.payload.data[0].activity_id);
    assert.equal(actual.detail.speeches[0].sourceId,s.activity_id);
    assert.equal(actual.detail.speeches[0].people[0].id,'257043');
    assert.equal(actual.detail.coverage.speechAssociations.exactChildReferences,70);
    await assert.rejects(service.query(q('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-06-PVCRE-ITM-4')),e=>e.status===404);
    const count=calls.length;await service.query(q('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-D-69'));assert.equal(calls.length,count);
    const vote=await service.query(q('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-V-48'));assert.equal(vote.detail.selectedVote.namedCounts.for,454);
    assert(!calls.some(([ep])=>ep.endsWith('/activities')||ep.endsWith('/events')));
    const mismatchService=new LegislationInsights(store,{clock,loadMetadata:async()=>metadata,request:yearCatalogue(async(ep,params)=>ep.startsWith('/speeches/') ? {...fixture.speech,payload:{data:[{...s,id:'eli/dl/event/unrelated-record'}]}} : request(ep,params))});
    const mismatch=await mismatchService.query(q('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-D-69'));
    assert.equal(mismatch.detail.speeches.length,0);assert.equal(mismatch.detail.coverage.speechAssociations.count,null);
    assert(mismatch.detail.coverage.gaps.some(g=>g.message.includes('requested source identity')));
  }finally{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});}
});

test('sitting, speech and vote display titles follow the shared order without changing exact source joins',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'insights-title-language-')),store=new ActivityStore(directory);
  const labels={bg:'Bulgarian display title',de:'German display title',es:'Spanish display title',fr:'French display title'};
  try {
    store.acquire();const {generation}=store.beginCycle();store.setMembers([...members.values()]);
    const speech=structuredClone(fixture.speech),s=speech.payload.data[0];s.activity_label=labels;
    store.putSource(generation,'/speeches/'+s.activity_id,'speech',{id:s.activity_id},new Date(speech.fetchedAt).toISOString(),speechRows(s,new Date(speech.fetchedAt).toISOString()));
    const meetings=structuredClone(fixture.meetings),decisions=structuredClone(fixture.decisions);
    for(const sitting of meetings.payload.data)sitting.activity_label=labels;
    for(const decision of decisions.payload.data){decision.activity_label=labels;decision.referenceText=labels;}
    const request=async(ep,params)=>{
      if(ep==='/meetings')return params.offset===0?meetings:{...meetings,payload:{data:[]}};
      if(ep.endsWith('/foreseen-activities'))return fixture.foreseen;
      if(ep.startsWith('/speeches/'))return speech;
      if(ep==='/events/'+fixture.speechParent.payload.data[0].activity_id)return fixture.speechParent;
      if(ep.endsWith('/vote-results'))return fixture.results;
      if(ep.endsWith('/decisions'))return decisions;
      if(ep.startsWith('/plenary-documents/'))return fixture.report;
      throw new Error('Unexpected source: '+ep);
    };
    const clock=()=>Date.parse('2026-10-14T09:30:00Z'),service=new LegislationInsights(store,{request:yearCatalogue(request),clock,loadMetadata:async()=>metadata});
    store.db.exec('PRAGMA query_only=ON');
    for(const [language,expected] of [['ga',labels.fr],['bg',labels.bg],['es',labels.es]]){
      const query=topic=>insightQuery(new URLSearchParams({lang:language,sitting:'MTG-PL-2026-10-07',topic:'MTG-PL-2026-10-07-OJ-ITM-'+topic}),{kind:'legislation',now:clock()});
      const debate=await service.query(query('D-69'));
      assert.equal(debate.sitting.title,expected);assert(debate.sittings.every(sitting=>sitting.title===expected));
      assert.equal(debate.detail.speeches[0].title,expected);assert.equal(debate.detail.speeches[0].sourceId,s.activity_id);
      const vote=await service.query(query('V-48'));
      assert.equal(vote.detail.votes[0].title,expected);assert.equal(vote.detail.votes[0].subject,expected);
      assert.equal(vote.detail.selectedVote.id,'MTG-PL-2026-10-07-DEC-197457');
    }
  }finally{store.db.exec('PRAGMA query_only=OFF');store.close();rmSync(directory,{recursive:true,force:true});}
});

// October 7 is upcoming at this clock. Source models are explicitly projected test inputs.
test('upcoming sittings skip unheld votes, retain exact previous procedure debates and do not manufacture future speeches',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'insights-upcoming-test-')),store=new ActivityStore(directory),calls=[];
  try {
    store.acquire();const {generation}=store.beginCycle();store.setMembers([...members.values()]);
    const oldSpeech={...fixture.speech.payload.data[0],activity_id:'MTG-PL-2026-10-06-OTH-2017097993206',id:'eli/dl/event/MTG-PL-2026-10-06-OTH-2017097993206',activity_date:'2026-10-06'};
    store.putSource(generation,'/speeches/'+oldSpeech.activity_id,'speech',{id:oldSpeech.activity_id},new Date(fixture.speech.fetchedAt).toISOString(),speechRows(oldSpeech,new Date(fixture.speech.fetchedAt).toISOString()));
    const parent={...fixture.speechParent.payload.data[0],id:'eli/dl/event/MTG-PL-2026-10-06-PVCRE-ITM-18',activity_id:'MTG-PL-2026-10-06-PVCRE-ITM-18',activity_date:'2026-10-06',consists_of:[oldSpeech.id]};
    const procedure={...fixture.procedure.payload.data[0],label:'2025/2117(INI)',consists_of:[{id:parent.id,activity_id:parent.activity_id,activity_date:parent.activity_date,had_activity_type:parent.had_activity_type},{id:'eli/dl/event/AFET-PR-775469-DEPOT-2025-10-22',activity_id:'AFET-PR-775469-DEPOT-2025-10-22',activity_date:'2025-10-22',had_activity_type:'def/ep-activities/COMMITTEE_TABLING_REPORT',based_on_a_realization_of:['eli/dl/doc/AFET-PR-775469']}]};
    const request=async(ep,params)=>{calls.push(ep);if(ep==='/meetings')return params.offset===0?fixture.meetings:{...fixture.meetings,payload:{data:[]}};if(ep.endsWith('/foreseen-activities'))return fixture.foreseen;if(ep.startsWith('/procedures/'))return {...fixture.procedure,payload:{data:[procedure]}};if(ep==='/events/'+parent.activity_id)return {...fixture.speechParent,payload:{data:[parent]}};throw new Error('unexpected source '+ep);};
    const clock=()=>Date.parse('2026-10-06T18:00:00Z'),service=new LegislationInsights(store,{request:yearCatalogue(request),clock,loadMetadata:async()=>metadata});
    const query=s=>insightQuery(new URLSearchParams(s),{kind:'legislation',now:clock()});
    const result=await service.query(query('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-V-48'));
    assert.equal(result.sitting.phase,'upcoming');assert.equal(result.detail.phase,'upcoming');assert.equal(result.detail.votes.length,0);assert.equal(result.detail.selectedVote,null);assert(!calls.some(ep=>/decisions|vote-results/.test(ep)));
    assert.equal(result.detail.coverage.speechAssociations.context,'previous-debates');assert.equal(result.detail.speeches.length,1);assert.equal(result.detail.speeches[0].date,'2026-10-06');
    assert(result.detail.procedures[0].websiteUrl.endsWith('reference=2025%2F2117(INI)'));assert.equal(result.detail.committeeWork[0].kind,'COMMITTEE_TABLING_REPORT');
    await assert.rejects(service.query(query('sitting=MTG-PL-2026-10-07&vote=MTG-PL-2026-10-07-DEC-197457')),e=>e.status===400);
    const gapService=new LegislationInsights(store,{clock,loadMetadata:async()=>metadata,request:yearCatalogue(async(ep,params)=>ep.endsWith('/foreseen-activities')?Promise.reject(new Error('upstream unavailable')):request(ep,params))});
    const gap=await gapService.query(query('sitting=MTG-PL-2026-10-07'));assert.equal(gap.coverage.agendaError,'upstream unavailable');assert.equal(gap.coverage.agendaComplete,false);assert.equal(gap.topics.length,0);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('actual October 19 agenda has six upcoming items and no expectation of future contributions',async()=>{
  const f=JSON.parse(readFileSync(new URL('./fixtures/insights-upcoming-live-20261014.json',import.meta.url)));
  const directory=mkdtempSync(path.join(os.tmpdir(),'insights-actual-upcoming-')),store=new ActivityStore(directory),calls=[];
  try {
    store.acquire();store.beginCycle();store.setMembers([{id:'257043',name:'Maravillas Abadía Jover'}]);
    const request=async(ep,params)=>{calls.push(ep);if(ep==='/meetings')return params.offset===0?f.meeting:{...f.meeting,payload:{data:[]}};if(ep.endsWith('/foreseen-activities'))return f.foreseen;throw new Error('No earlier source supplied');};
    const clock=()=>Date.parse('2026-10-14T12:00:00Z'),service=new LegislationInsights(store,{clock,request:yearCatalogue(request),loadMetadata:async()=>new Map()});
    const base=await service.query(insightQuery(new URLSearchParams(),{kind:'legislation',now:clock()}));
    assert.equal(base.sitting.phase,'upcoming');assert.equal(base.topics.length,6);
    const detail=await service.query(insightQuery(new URLSearchParams('sitting=MTG-PL-2026-10-19&topic=MTG-PL-2026-10-19-OJ-ITM-D-22'),{kind:'legislation',now:clock()}));
    assert.equal(detail.detail.coverage.speechAssociations.status,'not-yet-held');assert(detail.detail.roles.some(p=>p.id==='256968'&&p.role==='AGENDA_CONTRIBUTOR'));assert.deepEqual(agendaCreatorIds({'en':'<item><creators><label typeof="person" resource="https://example.com/person/256968">Wrong</label></creators></item>'}),[]);assert.equal(detail.detail.speeches.length,0);assert(!calls.some(ep=>ep.startsWith('/speeches/')||ep.includes('/decisions')||ep.includes('/vote-results')));
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('legislation responses from before per-person demographic buckets are not reused after restart',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'insights-chair-cache-')),store=new ActivityStore(path.join(directory,'index'));
  const clock=()=>Date.parse('2026-10-14T12:00:00Z'),views=path.join(directory,'views');
  try {
    store.acquire();store.beginCycle();store.setMembers([{id:'257043',name:'MEP'}]);
    const query=insightQuery(new URLSearchParams('sitting=MTG-PL-2026-10-07'),{kind:'legislation',now:clock()});
    await new InsightViewCache({directory:views,clock}).get([INSIGHTS_VERSION,'legislation',store.status().servingGeneration,'2026-10-14',query],async()=>({view:'legislation',oldSchema:true}));
    const service=createInsights(store,{clock,viewCache:{directory:views},loadMetadata:async()=>metadata,request:yearCatalogue(async(endpoint,params)=>endpoint==='/meetings'?params.offset===0?fixture.meetings:{...fixture.meetings,payload:{data:[]}}:fixture.foreseen)});
    const result=await service.query('legislation',new URLSearchParams('sitting=MTG-PL-2026-10-07'));
    assert.equal(result.oldSchema,undefined);assert.equal(result.topics.length,18);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

// Projected public source shapes exercise the routes without any live API reads.
function actualEventHarness(t,change={},options={}) {
 const directory=mkdtempSync(path.join(os.tmpdir(),'actual-topic-')),store=new ActivityStore(directory),calls=[];
 t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
 store.acquire();const {generation}=store.beginCycle();store.setMembers([...members.values()]);
 const speech=fixture.speech.payload.data[0];store.putSource(generation,'/speeches/'+speech.activity_id,'speech',{id:speech.activity_id},new Date(fixture.speech.fetchedAt).toISOString(),speechRows(speech,new Date(fixture.speech.fetchedAt).toISOString()));
 const sitting='MTG-PL-2026-10-07',container=sitting+'-OJ',date='2026-10-07',uri=id=>'eli/dl/event/'+id;
 const scheduled=[1,2].map(i=>({id:uri(sitting+'-OJ-ITM-D-'+i),activity_id:sitting+'-OJ-ITM-D-'+i,activity_date:date,had_activity_type:'def/ep-activities/PLENARY_DEBATE',activity_label:{en:'Joint topic '+i},based_on_a_realization_of:['eli/dl/doc/B-10-2026-00000'+i],inverse_was_scheduled_in:['eli/dl/proc/2026-000'+i],documented_by_a_realization_of:['eli/dl/doc/OJ-2026-000'+i],structuredContent:{en:`<item><creators><label typeof="person" resource="person/${i}"/></creators></item>`}}));
 const vote={...scheduled[0],id:uri(sitting+'-OJ-ITM-V-94'),activity_id:sitting+'-OJ-ITM-V-94',had_activity_type:'def/ep-activities/PLENARY_VOTE',based_on_a_realization_of:[],inverse_was_scheduled_in:[]};
 const votes=[vote,...(options.multipleVotes?[{...vote,id:uri(sitting+'-OJ-ITM-V-95'),activity_id:sitting+'-OJ-ITM-V-95'}]:[])];
 if(options.sharedCreator)scheduled[1].structuredContent=scheduled[0].structuredContent;
 const event={...fixture.speechParent.payload.data[0],executed:scheduled.map(r=>r.id),...change};
 const agenda={url:'https://data.europarl.europa.eu/api/v2/meetings/'+sitting+'/foreseen-activities',fetchedAt:fixture.foreseen.fetchedAt,payload:{data:[{id:uri(container),activity_id:container,had_activity_type:'def/ep-activities/MEETING_PART',consists_of:[...scheduled,...votes].map(r=>r.id)},...scheduled,...votes]}};
 const catalogue={sittings:[{activity_id:sitting,activity_date:date,was_scheduled_in:[uri(container)],consists_of:[event.id]}],sources:[],year:2026,years:[2026],start:'2024-07-16',complete:true,coverage:{years:[]}};
 const clock=()=>Date.parse('2026-10-14T09:30:00Z'),service=new LegislationInsights(store,{clock,loadMetadata:async()=>metadata,request:async(ep,params)=>{
  calls.push([ep,params]);if(ep.endsWith('/foreseen-activities')){if(!options.paged)return agenda;return {...agenda,url:agenda.url+'?offset='+params.offset,fetchedAt:agenda.fetchedAt+params.offset*1000,payload:{data:params.offset?[scheduled[1]]:[agenda.payload.data[0],scheduled[0],vote,...Array.from({length:47},(_,i)=>({id:'unused-'+i}))]}};}
  if(ep==='/events/'+event.activity_id&&options.upstreamStatus)throw Object.assign(new Error('Fixture source error'),{status:502,code:'odp_unavailable',upstreamStatus:options.upstreamStatus,source:{url:'https://data.europarl.europa.eu/api/v2'+ep,httpStatus:options.upstreamStatus}});
  if(ep==='/events/'+event.activity_id)return {url:'https://data.europarl.europa.eu/api/v2'+ep,fetchedAt:fixture.speechParent.fetchedAt,payload:{data:[event]}};
  if(ep.startsWith('/procedures/')){const id=ep.split('/').at(-1);return {url:'https://data.europarl.europa.eu/api/v2'+ep,fetchedAt:fixture.procedure.fetchedAt,payload:{data:[{id:'eli/dl/proc/'+id,consists_of:options.procedureEvents?[event]:[]}]}};}
  if(ep.startsWith('/meps/')&&options.formerMembers?.[ep.split('/').at(-1)]){const id=ep.split('/').at(-1);return {url:'https://data.europarl.europa.eu/api/v2'+ep,fetchedAt:fixture.speech.fetchedAt,payload:{data:[{id:'person/'+id,identifier:id,label:options.formerMembers[id]}]}};}
  if(ep.endsWith('/vote-results'))return {...fixture.results,payload:{data:[]}};
  if(ep.endsWith('/decisions'))return {...fixture.decisions,payload:{data:[]}};
  throw Error('Unexpected fixture source: '+ep);
 }});
 const query=(topic=event.activity_id)=>service.query({language:'en',sitting,topic},catalogue);
 return {query,calls,event,scheduled,vote,store,generation};
}
test('actual joint debates merge all exact executed contexts and retain their own speakers',async t=>{
 const h=actualEventHarness(t),r=await h.query();
 assert.deepEqual(r.detail.documentIds,['B-10-2026-000001','B-10-2026-000002']);assert.deepEqual(r.detail.procedureIds,['2026-0001','2026-0002']);
 assert.deepEqual(r.detail.agendaCreatorIds,['1','2']);assert.deepEqual(r.detail.agendaDocumentIds,['OJ-2026-0001','OJ-2026-0002']);assert.deepEqual(r.detail.scheduledAgendaIds,h.scheduled.map(r=>r.activity_id));
 assert.equal(r.detail.speeches.length,1);assert(h.calls.filter(([ep])=>ep.startsWith('/procedures/')).length<=2);
});
test('topical debates without executed and actual debate sub-items resolve by exact identity',async t=>{
 const h=actualEventHarness(t,{activity_id:'MTG-PL-2026-10-07-PVCRE-ITM-4-1',id:'eli/dl/event/MTG-PL-2026-10-07-PVCRE-ITM-4-1',executed:undefined});
 const r=await h.query();assert.equal(r.detail.id,h.event.activity_id);assert.equal(r.detail.speeches.length,1);assert.deepEqual(r.detail.documentIds,[]);assert.deepEqual(r.detail.scheduledAgendaIds,[]);
});
test('actual vote sub-items open only their exact scheduled vote item',async t=>{
 const h=actualEventHarness(t,{activity_id:'MTG-PL-2026-10-07-PVCRE-ITM-9-6',id:'eli/dl/event/MTG-PL-2026-10-07-PVCRE-ITM-9-6',had_activity_type:'def/ep-activities/PLENARY_VOTE',executed:['eli/dl/event/MTG-PL-2026-10-07-OJ-ITM-V-94']});
 const r=await h.query();assert.equal(r.detail.id,h.vote.activity_id);assert.equal(r.detail.kind,'PLENARY_VOTE');assert(h.calls.some(([ep])=>ep.endsWith('/vote-results')));
});
for(const change of [{had_activity_type:'def/ep-activities/PROCEEDING_ACTIVITY'},{activity_date:'2026-10-06'},{had_activity_type:'def/ep-activities/PLENARY_VOTE',executed:undefined},{had_activity_type:'def/ep-activities/PLENARY_VOTE',executed:['eli/dl/event/MTG-PL-2026-10-07-OJ-ITM-D-1']}])test('actual event route rejects unrelated type, date or vote context '+JSON.stringify(change),async t=>{
 const h=actualEventHarness(t,change);await assert.rejects(h.query(),e=>e.status===404);assert(!h.calls.some(([ep])=>ep.endsWith('/vote-results')));
});
test('malformed actual topic IDs are rejected before any upstream request; OTH IDs are not agenda aliases',async t=>{
 const h=actualEventHarness(t);
 for(const id of ['MTG-PL-2026-10-07-PVCRE-ITM-1/../../meps/1','MTG-PL-2026-10-07-PVCRE-ITM-1-2-3','MTG-PL-2026-10-07-PVCRE-ITM-1?x=1'])await assert.rejects(h.query(id),e=>e.status===400);
 assert.equal(h.calls.length,0);await assert.rejects(h.query('MTG-PL-2026-10-07-OTH-2017087113155'),e=>e.status===404);assert(!h.calls.some(([ep])=>ep.startsWith('/events/')));
});

test('joint creators retain every exact scheduled item and its source page observation',async t=>{
 const h=actualEventHarness(t,{}, {sharedCreator:true,paged:true}),r=await h.query(),roles=r.detail.roles.filter(r=>r.role==='AGENDA_CONTRIBUTOR');
 assert.deepEqual(roles.map(r=>[r.id,r.sourceId]),h.scheduled.map(item=>['1',item.activity_id]));
 for(const [i,role]of roles.entries()){assert.equal(role.apiUrl,'https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-2026-10-07/foreseen-activities?offset='+i*50);assert.equal(role.fetchedAt,new Date(fixture.foreseen.fetchedAt+i*50*1000).toISOString());assert(!role.apiUrl.includes('/events/'));}
});
for(const type of ['PLENARY_VOTE_RESULTS','PLENARY_OUTCOME','PLENARY_DECISION','REQUEST_VOTE_URGENCY','VOTE_URGENCY','PLENARY_EXPLANATIONS_OF_VOTES','PLENARY_VOTE_SECRET'])test('exact scheduled vote resolution accepts retained vote family '+type,async t=>{
 const h=actualEventHarness(t,{had_activity_type:'def/ep-activities/'+type,executed:['eli/dl/event/MTG-PL-2026-10-07-OJ-ITM-V-94']});assert.equal((await h.query()).detail.id,h.vote.activity_id);
});
test('a voting-time parent with several exact scheduled vote targets is unavailable',async t=>{
 const h=actualEventHarness(t,{had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',executed:['eli/dl/event/MTG-PL-2026-10-07-OJ-ITM-V-94','eli/dl/event/MTG-PL-2026-10-07-OJ-ITM-V-95']},{multipleVotes:true});await assert.rejects(h.query(),e=>e.status===404&&e.code==='topic_not_found');
});
for(const status of [404,429,503])test('exact-ID upstream '+status+' keeps the domain status or source failure',async t=>{
 const h=actualEventHarness(t,{}, {upstreamStatus:status});await assert.rejects(h.query(),e=>{assert.equal(e.status,status===404?404:502);assert.equal(e.code,status===404?'topic_not_found':'odp_unavailable');assert.equal(e.source.httpStatus,status);return true;});
});

test('formal addresses without a scheduled agenda item retain exact title and child speeches',async t=>{
 const h=actualEventHarness(t,{had_activity_type:'def/ep-activities/PLENARY_ACTIVITY',executed:undefined,activity_label:{en:'Formal sitting – address by a head of state'}});
 const r=await h.query();assert.equal(r.detail.id,h.event.activity_id);assert.equal(r.detail.title,'Formal sitting – address by a head of state');assert.equal(r.detail.speeches.length,1);assert.deepEqual(r.detail.scheduledAgendaIds,[]);assert.deepEqual(r.detail.documentIds,[]);assert.deepEqual(r.detail.procedureIds,[]);
});

test('formal address includes held outside speech headers without roster or name matching',async t=>{
 const h=actualEventHarness(t,{had_activity_type:'def/ep-activities/PLENARY_ACTIVITY',executed:undefined});
 const id='MTG-PL-2026-10-07-OTH-123456';h.event.consists_of=[...h.event.consists_of,'eli/dl/event/'+id];
 h.store.db.prepare('INSERT INTO outside_contributions VALUES (?,?,?,?,?)').run(h.generation,id,'999999','2026-10-07',JSON.stringify({id,personId:'999999',date:'2026-10-07',header:{name:'Visiting head of state'},titles:{en:'Address'},source:{url:'https://data.europarl.europa.eu/api/v2/speeches/'+id,fetchedAt:'2026-10-14T09:30:00Z'}}));
 const r=await h.query(),speech=r.detail.speeches.find(s=>s.sourceId===id);assert(speech);assert.equal(speech.people[0].name,'Visiting head of state');assert.equal(speech.people[0].currentMep,false);assert(!h.calls.some(([ep])=>ep==='/meps/999999'));
});

function heldGuest(h,id,personId,name,start,date='2026-10-07',indexed=true){
 h.event.consists_of=[...h.event.consists_of,'eli/dl/event/'+id];
 if(indexed){const work={...fixture.speech.payload.data[0],activity_id:id,activity_date:date,activity_start_date:start,had_participation:[{had_participant_person:['person/'+personId]}]};h.store.putSource(h.generation,'/speeches/'+id,'speech',work,'2026-10-14T09:30:00Z',speechRows(work,'2026-10-14T09:30:00Z'));}
 h.store.db.prepare('INSERT INTO outside_contributions VALUES (?,?,?,?,?)').run(h.generation,id,personId,date,JSON.stringify({id,personId,date,start,header:{name},titles:{en:'Address'},source:{url:'https://data.europarl.europa.eu/api/v2/speeches/'+id,fetchedAt:'2026-10-14T09:30:00Z'}}));
}
for(const type of ['PLENARY_DEBATE','PLENARY_ACTIVITY'])test(type+' orders speakers held in both tables and preserves its participation policy',async t=>{
 const h=actualEventHarness(t,{had_activity_type:'def/ep-activities/'+type,executed:undefined});
 const before=await h.query();const first=before.detail.speeches[0].sourceId;
 h.store.db.prepare("UPDATE items SET body=json_set(body,'$.start','2026-10-07T12:10:00+02:00') WHERE generation=?").run(h.generation);
 const closing={...fixture.speech.payload.data[0],activity_id:'MTG-PL-2026-10-07-OTH-999999',activity_start_date:'2026-10-07T12:46:00+02:00'};
 h.store.putSource(h.generation,'/speeches/'+closing.activity_id,'speech',{id:closing.activity_id},'2026-10-14T09:30:00Z',speechRows(closing,'2026-10-14T09:30:00Z'));h.event.consists_of=[...h.event.consists_of,'eli/dl/event/'+closing.activity_id];
 const formalBaseline=await h.query();
 const second='MTG-PL-2026-10-07-OTH-222222',third='MTG-PL-2026-10-07-OTH-333333';
 heldGuest(h,third,'999998','Second guest','2026-10-07T12:32:00+02:00');heldGuest(h,second,'999997','First guest','2026-10-07T12:20:00+02:00');
 const saved=h.store.db.prepare('SELECT * FROM outside_contributions WHERE generation=?').all(h.generation);h.store.db.prepare('DELETE FROM outside_contributions WHERE generation=?').run(h.generation);const indexOnlyBaseline=await h.query();for(const row of saved)h.store.db.prepare('INSERT INTO outside_contributions VALUES (?,?,?,?,?)').run(row.generation,row.speech,row.person,row.date,row.body);const reads=h.calls.length;
 const r=await h.query(),baseline=type==='PLENARY_DEBATE'?indexOnlyBaseline:formalBaseline;assert.deepEqual(r.detail.speeches.map(s=>s.sourceId),[first,second,third,closing.activity_id]);assert.deepEqual(r.detail.stats,baseline.detail.stats);assert.deepEqual(r.detail.people.map(p=>p.id),baseline.detail.people.map(p=>p.id));assert.equal(r.detail.kind,type);assert(!r.topics.some(t=>t.kind==='PLENARY_ACTIVITY'));assert(!h.calls.slice(reads).some(([ep])=>ep.startsWith('/meps/')));
});
test('procedural activity without held speeches keeps the previous not-found response',async t=>{
 const h=actualEventHarness(t,{had_activity_type:'def/ep-activities/PLENARY_ACTIVITY',executed:undefined,consists_of:[]});await assert.rejects(h.query(),e=>e.status===404);
});
test('guests match an earlier associated debate date rather than the scheduled topic date',async t=>{
 const h=actualEventHarness(t,{id:'eli/dl/event/MTG-PL-2026-10-06-PVCRE-ITM-5',activity_id:'MTG-PL-2026-10-06-PVCRE-ITM-5',activity_date:'2026-10-06'},{procedureEvents:true});
 const id='MTG-PL-2026-10-06-OTH-222222',wrong='MTG-PL-2026-10-07-OTH-333333';heldGuest(h,id,'999997','Earlier guest','2026-10-06T12:20:00+02:00','2026-10-06',false);heldGuest(h,wrong,'999998','Wrong date','2026-10-07T12:20:00+02:00','2026-10-07',false);
 const r=await h.query(h.scheduled[0].activity_id);assert(r.detail.speeches.some(s=>s.sourceId===id));assert(!r.detail.speeches.some(s=>s.sourceId===wrong));assert(r.detail.speeches.some(s=>s.sourceId===fixture.speech.payload.data[0].activity_id));
});
test('procedure-backed candidates remain debate-only even with held guest speeches',async t=>{
 const h=actualEventHarness(t,{had_activity_type:'def/ep-activities/PLENARY_ACTIVITY'},{procedureEvents:true});heldGuest(h,'MTG-PL-2026-10-07-OTH-222222','999997','Guest','2026-10-07T12:20:00+02:00');const r=await h.query(h.scheduled[0].activity_id);assert.equal(r.detail.speeches.length,0);
});

test('untimed written statements sort after spoken speeches and tie by exact ID',async t=>{
 const h=actualEventHarness(t),r=await h.query(),spoken=r.detail.speeches[0].sourceId;
 h.store.db.prepare("UPDATE items SET body=json_set(body,'$.start','2026-10-07T12:10:00+02:00') WHERE generation=?").run(h.generation);
 const ids=['MTG-PL-2026-10-07-OTH-000002','MTG-PL-2026-10-07-OTH-000001'];for(const id of ids){const work={...fixture.speech.payload.data[0],activity_id:id,activity_start_date:null,had_activity_type:'def/ep-activities/PLENARY_DEBATE_WRITTEN_STATEMENT'};h.store.putSource(h.generation,'/speeches/'+id,'speech',work,'2026-10-14T09:30:00Z',speechRows(work,'2026-10-14T09:30:00Z'));h.event.consists_of=[...h.event.consists_of,'eli/dl/event/'+id];}
 const next=await h.query();assert.deepEqual(next.detail.speeches.map(s=>s.sourceId),[spoken,...ids.toSorted()]);assert.equal(next.detail.speeches[0].kind,'PLENARY_DEBATE_SPEECH');
});
test('document-backed formal candidates actually reach the bounded event type check and remain excluded',async t=>{
 const h=actualEventHarness(t,{had_activity_type:'def/ep-activities/PLENARY_ACTIVITY'}),id=h.scheduled[0].based_on_a_realization_of[0].split('/').at(-1);
 const work={id:'eli/dl/doc/'+id,identifier:id,inverse_based_on_a_realization_of:[h.event.id]};h.store.putSource(h.generation,'/plenary-documents/'+id,'document',work,'2026-10-14T09:30:00Z');heldGuest(h,'MTG-PL-2026-10-07-OTH-222222','999997','Guest','2026-10-07T12:20:00+02:00');
 const r=await h.query(h.scheduled[0].activity_id);assert(h.calls.some(([ep])=>ep==='/events/'+h.event.activity_id));assert.equal(r.detail.speeches.length,0);
});
test('former MEP name lookup is capped at four and skips all held outsiders',async t=>{
 const names=Object.fromEntries(['910001','910002','910003','910004','910005'].map(id=>[id,'Former Member'])),h=actualEventHarness(t,{}, {formerMembers:names});
 for(const id of Object.keys(names)){const speech='MTG-PL-2026-10-07-OTH-'+id,work={...fixture.speech.payload.data[0],activity_id:speech,had_participation:[{had_participant_person:['person/'+id]}]};h.store.putSource(h.generation,'/speeches/'+speech,'speech',work,'2026-10-14T09:30:00Z',speechRows(work,'2026-10-14T09:30:00Z'));h.event.consists_of=[...h.event.consists_of,'eli/dl/event/'+speech];}
 heldGuest(h,'MTG-PL-2026-10-07-OTH-222222','999997','Held outsider','2026-10-07T12:20:00+02:00');const r=await h.query(),reads=h.calls.filter(([ep])=>ep.startsWith('/meps/'));assert.equal(reads.length,4);assert(!reads.some(([ep])=>ep==='/meps/999997'));const former=r.detail.people.filter(p=>p.name==='Former Member');assert.equal(former.length,4);assert(former.every(p=>p.profileUrl==='https://www.europarl.europa.eu/meps/en/'+p.id));
});
