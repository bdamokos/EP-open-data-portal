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
const fixture=JSON.parse(readFileSync(new URL('./fixtures/insights-live-20261014.json',import.meta.url)));
const members=new Map([...new Set(fixture.decisions.payload.data.flatMap(v=>[...v.had_voter_favor,...v.had_voter_against,...v.had_voter_abstention]))].map(uri=>[uri.split('/').at(-1),{id:uri.split('/').at(-1),name:uri}]));
const metadata=new Map();
const meeting={payload:{data:[fixture.meetings.payload.data.find(n=>n.activity_id==='MTG-PL-2026-10-07')]}};
const topics=agendaTopics(meeting,fixture.foreseen);
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
    const clock=()=>Date.parse('2026-10-14T09:30:00Z');const service=new LegislationInsights(store,{request,clock,loadMetadata:async()=>metadata});store.db.exec('PRAGMA query_only=ON');
    const q=s=>insightQuery(new URLSearchParams(s),{kind:'legislation',now:clock()});
    const result=await service.query(q('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-D-69'));
    assert.equal(result.detail.speeches.length,1);assert.equal(result.detail.speeches[0].sourceId,s.activity_id);assert.equal(result.detail.speeches[0].people[0].id,'257043');assert.equal(result.detail.coverage.speechAssociations.exactChildReferences,70);
    assert.equal(result.detail.coverage.speechAssociations.childrenWithoutSavedContributionRows,69);assert.equal(result.coverage.indexComplete,false);
    assert.deepEqual(result.detail.people.find(p=>p.id==='257043').demographics,{country:'Unknown',group:'Unknown',gender:'Unknown',age:'Unknown'});
    const count=calls.length;await service.query(q('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-D-69'));assert.equal(calls.length,count);
    const vote=await service.query(q('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-V-48'));assert.equal(vote.detail.selectedVote.namedCounts.for,454);
    assert(!calls.some(([ep])=>ep.endsWith('/activities')||ep.endsWith('/events')));
    const mismatchService=new LegislationInsights(store,{clock,loadMetadata:async()=>metadata,request:async(ep,params)=>ep.startsWith('/speeches/') ? {...fixture.speech,payload:{data:[{...s,id:'eli/dl/event/unrelated-record'}]}} : request(ep,params)});
    const mismatch=await mismatchService.query(q('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-D-69'));
    assert.equal(mismatch.detail.speeches.length,0);assert.equal(mismatch.detail.coverage.speechAssociations.count,null);
    assert(mismatch.detail.coverage.gaps.some(g=>g.message.includes('requested source identity')));
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
    const clock=()=>Date.parse('2026-10-06T18:00:00Z'),service=new LegislationInsights(store,{request,clock,loadMetadata:async()=>metadata});
    const query=s=>insightQuery(new URLSearchParams(s),{kind:'legislation',now:clock()});
    const result=await service.query(query('sitting=MTG-PL-2026-10-07&topic=MTG-PL-2026-10-07-OJ-ITM-V-48'));
    assert.equal(result.sitting.phase,'upcoming');assert.equal(result.detail.phase,'upcoming');assert.equal(result.detail.votes.length,0);assert.equal(result.detail.selectedVote,null);assert(!calls.some(ep=>/decisions|vote-results/.test(ep)));
    assert.equal(result.detail.coverage.speechAssociations.context,'previous-debates');assert.equal(result.detail.speeches.length,1);assert.equal(result.detail.speeches[0].date,'2026-10-06');
    assert(result.detail.procedures[0].websiteUrl.endsWith('reference=2025%2F2117(INI)'));assert.equal(result.detail.committeeWork[0].kind,'COMMITTEE_TABLING_REPORT');
    await assert.rejects(service.query(query('sitting=MTG-PL-2026-10-07&vote=MTG-PL-2026-10-07-DEC-197457')),e=>e.status===400);
    const gapService=new LegislationInsights(store,{clock,loadMetadata:async()=>metadata,request:async(ep,params)=>ep.endsWith('/foreseen-activities')?Promise.reject(new Error('upstream unavailable')):request(ep,params)});
    const gap=await gapService.query(query('sitting=MTG-PL-2026-10-07'));assert.equal(gap.coverage.agendaError,'upstream unavailable');assert.equal(gap.coverage.agendaComplete,false);assert.equal(gap.topics.length,0);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('actual October 19 agenda has six upcoming items and no expectation of future contributions',async()=>{
  const f=JSON.parse(readFileSync(new URL('./fixtures/insights-upcoming-live-20261014.json',import.meta.url)));
  const directory=mkdtempSync(path.join(os.tmpdir(),'insights-actual-upcoming-')),store=new ActivityStore(directory),calls=[];
  try {
    store.acquire();store.beginCycle();store.setMembers([{id:'257043',name:'Maravillas Abadía Jover'}]);
    const request=async(ep,params)=>{calls.push(ep);if(ep==='/meetings')return params.offset===0?f.meeting:{...f.meeting,payload:{data:[]}};if(ep.endsWith('/foreseen-activities'))return f.foreseen;throw new Error('No earlier source supplied');};
    const clock=()=>Date.parse('2026-10-14T12:00:00Z'),service=new LegislationInsights(store,{clock,request,loadMetadata:async()=>new Map()});
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
    const service=createInsights(store,{clock,viewCache:{directory:views},loadMetadata:async()=>metadata,request:async(endpoint,params)=>endpoint==='/meetings'?params.offset===0?fixture.meetings:{...fixture.meetings,payload:{data:[]}}:fixture.foreseen});
    const result=await service.query('legislation',new URLSearchParams('sitting=MTG-PL-2026-10-07'));
    assert.equal(result.oldSchema,undefined);assert.equal(result.topics.length,18);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
