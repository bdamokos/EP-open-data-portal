import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DossierStatus,dossierStatusQuery,leadCommittees} from './dossier-status.mjs';
import {dossierStatusLines,mergeDossierStatus,resolutionStage} from './dossier-status-model.mjs';

const {procedures,votes}=JSON.parse(readFileSync(new URL('./fixtures/reader-first-helpers.json',import.meta.url)));
const [erasmus,fisheries]=procedures;
const tally={for:454,against:34,abstaining:93};
const rapporteur={id:'p',participation_role:'def/ep-roles/RAPPORTEUR',participation_in_name_of:'org/CULT',had_participant_person:['person/124893']};
const work=(fixture,extra={})=>({consists_of:fixture.indexEvents.map(event=>({...event,id:'eli/dl/event/'+event.activity_id})),had_participation:[rapporteur],...extra});
const vote={id:'MTG-PL-2026-10-22-DEC-198405',date:'2026-10-22',outcome:'ADOPTED',method:'VOTE_ELECTRONIC_ROLLCALL',ballotStatus:'conducted',totals:tally};
const lines=(stage,values={})=>dossierStatusLines({stage,...values});
const step=(key,date,state='done')=>({key,state,date,partial:false});

test('Erasmus+ reads its position with the tally of the same day',()=>{
  const merged=mergeDossierStatus({reference:erasmus.reference,indexEvents:erasmus.indexEvents},{cellarEvents:erasmus.cellarEvents,summaries:erasmus.summaries,asOf:erasmus.asOf});
  assert.equal(merged.stage,'position-talks');
  assert.equal(merged.steps.find(row=>row.key==='proposal').date,'2025-07-16','the OEIL proposal date wins over the Cellar registration date');
  assert.deepEqual(merged.steps.find(row=>row.key==='council'),{key:'council',state:'done',date:'2026-05-11',partial:true});
  const {sentence,next}=dossierStatusLines({...merged,indexEvents:erasmus.indexEvents,slots:{mainVote:vote}});
  assert.equal(sentence.id,'dossierstatus.position_talks');assert.equal(sentence.values.date,'2026-10-22');assert.deepEqual(sentence.values.tally,tally);
  assert.equal(next.id,'dossierstatus.next_talks');
});
test('a tally of another day, or none, never reaches the sentence',()=>{
  const steps=[step('parliament','2026-10-22'),step('council',null,'current')];
  assert.equal(lines('position',{steps,slots:{mainVote:{...vote,date:'2026-09-01'}}}).sentence.id,'dossierstatus.position_no_tally');
  assert.equal(lines('position',{steps,slots:{mainVote:{...vote,totals:null}}}).sentence.id,'dossierstatus.position_no_tally');
  assert.equal(lines('position',{steps,slots:{mainVote:{...vote,totals:{for:1,against:null,abstaining:0}}}}).sentence.id,'dossierstatus.position_no_tally');
  assert.equal(lines('position',{steps}).next.id,'dossierstatus.next_council_reading');
});
test('fisheries ignores cancelled Council rows and reads as still in committee',()=>{
  const merged=mergeDossierStatus({reference:fisheries.reference,indexEvents:fisheries.indexEvents},{cellarEvents:fisheries.cellarEvents,summaries:fisheries.summaries,asOf:fisheries.asOf});
  assert.equal(merged.stage,'drafting');
  assert.deepEqual(merged.steps.find(row=>row.key==='council'),{key:'council',state:'done',date:'2026-09-29',partial:true});
  const committees=[{code:'PECH',name:'Committee on Fisheries',language:'en'}];
  const {sentence,next}=dossierStatusLines({...merged,indexEvents:fisheries.indexEvents,slots:{committees}});
  assert.equal(sentence.id,'dossierstatus.drafting_amendments');assert.equal(sentence.values.date,'2026-06-10');assert.deepEqual(sentence.values.committees,committees);
  assert.equal(next.id,'dossierstatus.next_committee_vote');assert.equal(next.values,undefined,'no committee date is ever stated');
});
test('every stage has one template, and the next step follows it',()=>{
  const steps=[step('proposal','2025-01-01'),step('committee','2025-02-01'),step('parliament','2025-03-01'),step('council','2025-04-01'),step('deal','2025-05-01'),step('signed','2025-06-01'),step('journal','2025-07-01')];
  const committees=[{code:'CULT',name:'Committee on Culture and Education',language:'en'}],indexEvents=[{had_activity_type:'REFERRAL',activity_date:'2025-01-15'},{had_activity_type:'COMMITTEE_TABLING_REPORT',activity_date:'2025-01-20'}];
  const ids=(stage,values={})=>{const {sentence,next}=lines(stage,{steps,indexEvents,slots:{committees},...values});return [sentence?.id.replace('dossierstatus.',''),next?.id.replace('dossierstatus.','')??null,sentence?.values?.date];};
  assert.deepEqual(ids('proposal'),['proposal','next_committee_takes_up','2025-01-01']);
  assert.deepEqual(ids('referred'),['referred','next_committee_vote','2025-01-15']);
  assert.deepEqual(ids('drafting'),['drafting_report','next_committee_vote','2025-01-20']);
  assert.deepEqual(ids('reported'),['reported','next_plenary_vote','2025-02-01']);
  assert.deepEqual(lines('reported',{steps,slots:{plenaryDate:'2026-11-11'}}).next,{id:'dossierstatus.next_plenary_vote_on',values:{date:'2026-11-11'}});
  assert.deepEqual(ids('deal'),['deal','next_plenary_vote','2025-05-01']);
  assert.deepEqual(ids('council-approved',{councilApproval:{date:'2025-05-20'}}),['council_approved','next_signature','2025-05-20']);
  assert.deepEqual(ids('signed'),['signed','next_journal','2025-06-01']);
  assert.deepEqual(ids('journal'),['journal',null,'2025-07-01']);
  assert.equal(lines('referred',{indexEvents}).sentence.id,'dossierstatus.referred_no_committee');
});
test('both positions with no referral or deal leave no next step, and a final vote dates the position',()=>{
  const both=[step('parliament','2026-03-01'),step('council','2026-01-01')];
  const none=lines('position',{steps:both});assert.equal(none.next,null);assert.equal(none.sentence.values.date,'2026-03-01');
  const final=[step('parliament','2026-03-01'),step('deal','2026-06-01'),step('final','2026-07-01'),step('signed',null,'current')];
  const voted=lines('position',{steps:final,slots:{mainVote:{...vote,date:'2026-07-01'}}});
  assert.equal(voted.sentence.id,'dossierstatus.position');assert.equal(voted.sentence.values.date,'2026-07-01');assert.equal(voted.next.id,'dossierstatus.next_council_reading');
});
test('a rejected main vote reads as rejected, with no next step',()=>{
  const rejected={...vote,outcome:'REJECTED'};
  const position=lines('position',{steps:[step('parliament','2026-10-22')],slots:{mainVote:rejected}});
  assert.equal(position.sentence.id,'dossierstatus.rejected');assert.equal(position.next,null);
});
test('other families get a resolution sentence only from the exact main vote, otherwise the latest labelled step',()=>{
  assert.equal(resolutionStage(vote),'resolution-adopted');assert.equal(resolutionStage({...vote,outcome:'REJECTED'}),'unknown');assert.equal(resolutionStage(null),'unknown');
  assert.equal(lines('resolution-adopted',{slots:{mainVote:vote}}).sentence.id,'dossierstatus.resolution_adopted');
  assert.equal(lines('unknown',{slots:{mainVote:{...vote,outcome:'REJECTED'}}}).sentence.id,'dossierstatus.rejected');
  const cellarEvents=[{status:'recorded',label:'Tabling',labelLanguage:'en',date:'2026-01-01'},{status:'cancelled',label:'Cancelled',date:'2026-03-01'},{status:'recorded',label:'Debate',labelLanguage:'en',date:'2026-02-01'}];
  assert.deepEqual(lines('unknown',{latest:{had_activity_type:'X',activity_date:'2026-02-02'},cellarEvents}).sentence,{id:'dossierstatus.latest',values:{label:'Debate',labelLanguage:'en',date:'2026-02-01'}});
  assert.deepEqual(lines('unknown'),{sentence:null,next:null});
  assert.equal(mergeDossierStatus({reference:'2026/2000(RSP)',stage:'resolution-adopted',indexEvents:[]},{asOf:'2026-11-06'}).stage,'resolution-adopted');
});

const day={sittingId:'MTG-PL-2026-10-22'};
function service(fixture,{extra,votesRead,sittings=[],agenda,now='2026-11-06T12:00:00Z',reference=fixture.reference}={}) {
  const calls={votes:0,agenda:[]};
  const activity={procedure:async(id,language,given)=>{assert.equal(given,reference);return {work:work(fixture,extra),procedure:{id,reference}};}};
  const reader={catalogue:async()=>({sittings})};
  const votes=votesRead===null?{snapshot:async()=>{throw Object.assign(new Error('unavailable'),{status:503});}}:{snapshot:async query=>{calls.votes++;assert.equal(query.sitting,'MTG-PL-2026-10-22');return votesRead||{days:[]};}};
  return {calls,status:new DossierStatus({activity,reader,votes,readAgenda:agenda||(async endpoint=>{calls.agenda.push(endpoint);throw Object.assign(new Error('miss'),{code:'odp_cache_miss'});}),clock:()=>Date.parse(now)})};
}
test('query identity is exact',()=>{
  assert.deepEqual(dossierStatusQuery(new URLSearchParams({reference:'2025/0222(COD)',lang:'fr'})),{reference:'2025/0222(COD)',language:'fr'});
  for(const text of ['reference=2025/0222(COD)&other=1','reference=2025/0222(COD)&lang=en&lang=fr','reference=nope'])assert.throws(()=>dossierStatusQuery(new URLSearchParams(text)),error=>error.status===400);
});
test('lead committee names come from the exact rapporteur role and the requested language',()=>{
  assert.deepEqual(leadCommittees({had_participation:[rapporteur,{...rapporteur,id:'q'},{participation_role:'def/ep-roles/RAPPORTEUR_OPINION',participation_in_name_of:'org/BUDG'}]},'fr').map(row=>row.code),['CULT']);
  assert.equal(leadCommittees({had_participation:[rapporteur]},'en')[0].name,'Committee on Culture and Education');
  assert.deepEqual(leadCommittees({had_participation:[{...rapporteur,participation_in_name_of:'org/ZZZZ'}]},'en'),[{code:'ZZZZ',name:'ZZZZ',language:null}]);
  assert.deepEqual(leadCommittees({},'en'),[]);
});
test('a failed vote read drops the tally and leaves the steps',async()=>{
  const {status}=service(erasmus,{votesRead:null});
  const result=await status.query({reference:erasmus.reference,language:'en'});
  assert.equal(result.stage,'position-talks');assert.equal(result.slots.mainVote,null);assert.equal(result.family,'COD');
  assert.equal(result.indexEvents.length,erasmus.indexEvents.length);assert.equal(result.indexEvents[0].had_activity_type,'PLENARY_AMEND');
});
test('a file with no plenary vote event reads no sitting at all',async()=>{
  const {status,calls}=service(fisheries);
  const result=await status.query({reference:fisheries.reference,language:'en'});
  assert.equal(calls.votes,0);assert.equal(result.stage,'drafting');assert.equal(result.slots.plenaryDate,null);
  assert.equal(calls.agenda.length,0,'the agenda is read only for a reported file');
});
const reportedEvents=[{activity_id:'A',activity_date:'2026-09-29',had_activity_type:'def/ep-activities/COMMITTEE_ADOPTING_REPORT'}];
const reported={...fisheries,reference:'2025/0235(COD)',indexEvents:reportedEvents};
const sitting=(date)=>({activity_id:'MTG-PL-'+date,activity_date:date,was_scheduled_in:['eli/dl/event/MTG-PL-'+date+'-TF']});
const agendaFor=(date,procedure,kind='PLENARY_VOTE')=>({url:'u',fetchedAt:1,payload:{data:[
  {id:'eli/dl/event/MTG-PL-'+date+'-TF',had_activity_type:'def/ep-activities/MEETING_PART',consists_of:['eli/dl/event/MTG-PL-'+date+'-OJ-ITM-V-1']},
  {id:'eli/dl/event/MTG-PL-'+date+'-OJ-ITM-V-1',activity_id:'MTG-PL-'+date+'-OJ-ITM-V-1',activity_date:date,had_activity_type:'def/ep-activities/'+kind,activity_label:{en:'Item'},inverse_was_scheduled_in:['eli/dl/proc/'+procedure]},
]}});
test('the plenary date needs the exact procedure on a foreseen vote in the next two part-sessions',async()=>{
  const sittings=['2026-10-22','2026-11-11','2026-11-12','2026-11-23','2026-12-14'].map(sitting);
  const read=(hit,kind)=>async endpoint=>{const date=endpoint.match(/MTG-PL-([\d-]+)\//)[1];reads.push(date);return agendaFor(date,date===hit?'2025-0235':'2024-0001',kind);};
  let reads=[];
  const found=await service(reported,{sittings,agenda:read('2026-11-23')}).status.query({reference:reported.reference,language:'en'});
  assert.equal(found.stage,'reported');assert.equal(found.slots.plenaryDate,'2026-11-23');
  assert(!reads.includes('2026-10-22'),'a past sitting is never read');
  reads=[];const beyond=await service(reported,{sittings,agenda:read('2026-12-14')}).status.query({reference:reported.reference,language:'en'});
  assert.equal(beyond.slots.plenaryDate,null);assert(!reads.includes('2026-12-14'),'the third part-session is out of scope');
  const debate=await service(reported,{sittings,agenda:read('2026-11-11','PLENARY_DEBATE')}).status.query({reference:reported.reference,language:'en'});
  assert.equal(debate.slots.plenaryDate,null,'a debate is not a vote');
  const missing=await service(reported,{sittings}).status.query({reference:reported.reference,language:'en'});
  assert.equal(missing.slots.plenaryDate,null,'an agenda that is not held leaves the date out');
});
test('a non-COD file becomes resolution-adopted only through its exact main vote',async()=>{
  const reference='2026/2000(RSP)',fixture={reference,indexEvents:[{activity_id:'MTG-PL-2026-10-22-VOT-ITM-993260',activity_date:'2026-10-22',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS'}]};
  const unavailable=await service(fixture,{votesRead:null}).status.query({reference,language:'en'});
  assert.equal(unavailable.stage,'unknown');assert.deepEqual(unavailable.steps,[]);assert.equal(unavailable.family,'RSP');
});
test('the main vote comes from the exact subject of the held vote event',async()=>{
  assert(votes.subjects.length>0);
  const raw={activity_id:'MTG-PL-2026-10-22-DEC-198405'};
  const reference='2026/2000(RSP)',fixture={reference,indexEvents:[{activity_id:'MTG-PL-2026-10-22-VOT-ITM-993260',activity_date:'2026-10-22',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS'}]};
  const decision=(id,en,outcome='ADOPTED')=>({id:'eli/dl/event/'+id,activity_id:id,activity_date:'2026-10-22',type:'Vote',had_activity_type:'def/ep-activities/PLENARY_VOTE',decision_method:'def/ep-decision-methods/VOTE_ELECTRONIC_ROLLCALL',decision_outcome:'def/ep-decision-outcomes/'+outcome,activity_label:{en},referenceText:{en},number_of_votes_favor:454,number_of_votes_against:34,number_of_votes_abstention:93,inverse_consists_of:['eli/dl/event/MTG-PL-2026-10-22-VOT-ITM-993260'],recorded_in_a_realization_of:[],had_voter_favor:['person/1'],had_voter_against:[],had_voter_abstention:[]});
  const main=decision(raw.activity_id,'Motion for a resolution');
  const day={sittingId:'MTG-PL-2026-10-22',date:'2026-10-22',decisions:[main,decision('MTG-PL-2026-10-22-DEC-2','Am 1')],results:[{id:'eli/dl/event/MTG-PL-2026-10-22-VOT-ITM-993260',activity_id:'MTG-PL-2026-10-22-VOT-ITM-993260',had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',consists_of:[main.id,'eli/dl/event/MTG-PL-2026-10-22-DEC-2'],based_on_a_realization_of:[],executed:[]}],agenda:[],requests:[],sources:{results:[],decisions:[]},coverage:{},chairing:null};
  const result=await service(fixture,{votesRead:{days:[day]}}).status.query({reference,language:'en'});
  assert.equal(result.slots.mainVote?.id,raw.activity_id);assert.equal(result.stage,'resolution-adopted');
  assert.deepEqual(result.slots.mainVote.totals,{for:454,against:34,abstaining:93});
});
