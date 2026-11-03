import test from 'node:test';
import assert from 'node:assert/strict';
import {upcomingVotes,upcomingVotesQuery,ballotInputs} from './upcoming-votes.mjs';
const sitting='MTG-PL-2026-11-12',agendaItemId=sitting+'-OJ-ITM-V-48',documentId='A-10-2026-0270';
const agenda={activity_id:agendaItemId,had_activity_type:'def/ep-activities/PLENARY_VOTE',based_on_a_realization_of:['eli/dl/doc/'+documentId],activity_label:{en:'Statute: proxy voting'}};
const row={id:documentId+'-AM-1',number:1,scheduledVotes:[{sittingId:sitting,agendaItemId}],listId:documentId+'-AM-001-001',targetLabel:'Article 1',targetLabelLanguage:'en',authors:[{name:'Author'}],proposedText:'Exact wording'};
const inputs=async()=>({day:{sittingId:sitting,agenda:[agenda],results:[],decisions:[],requests:[]},amendments:[row,{...row,id:documentId+'-AM-2',number:2,scheduledVotes:[]}],lists:[]});
test('ballot endpoint validates selectors and uses scoped rows only',async()=>{for(const query of ['','sitting=no','sitting=MTG-PL-2026-02-30','sitting='+sitting+'&sitting='+sitting,'sitting='+sitting+'&unknown=1'])assert.throws(()=>upcomingVotesQuery(new URLSearchParams(query)),e=>e.status===400);const response=await upcomingVotes(upcomingVotesQuery(new URLSearchParams({sitting})),{inputs});assert.equal(response.items.length,1);assert.deepEqual(response.items[0].rows.map(r=>r.key),[documentId+':am:1']);assert.equal(response.items[0].rows[0].amendmentRows[0].proposedText,'Exact wording');assert.deepEqual(response.items[0].rows[0].authors,['Author']);assert.deepEqual(response.items[0].rows[0].subject,['Article 1']);});
test('official list controls ballot identity and joins exact amendment IDs',async()=>{const data=await inputs();data.lists=[{documentId,agendaItemId,rows:[{kind:'amendment',amendments:[{number:1,cp:null}],subject:[],row:1,part:null}],revision:{sha256:'real-revision'},notes:{}}];data.amendments[0].scheduledVotes=[];const response=await upcomingVotes({sitting,language:'en'},{inputs:async()=>data});assert.equal(response.items[0].source,'voting-list');assert.equal(response.items[0].rows[0].revision,'real-revision');assert.equal(response.items[0].rows[0].amendmentRows[0].id,row.id);});
test('vote without a published document remains available to star',async()=>{const data=await inputs();data.day.agenda=[{...agenda,based_on_a_realization_of:[]}];const response=await upcomingVotes({sitting,language:'en'},{inputs:async()=>data});assert.equal(response.items[0].id,agendaItemId);assert.equal(response.items[0].documentId,null);assert.deepEqual(response.items[0].rows,[]);});

test('Commission proposals on a vote item do not become separate ballots',async()=>{
 const data=await inputs();
 data.day.agenda=[{...agenda,based_on_a_realization_of:['eli/dl/doc/C-10-2025-0141','eli/dl/doc/'+documentId]},{...agenda,activity_id:sitting+'-OJ-ITM-V-13',based_on_a_realization_of:['eli/dl/doc/C-9-2023-0182','eli/dl/doc/A-9-2024-0162']},{...agenda,activity_id:sitting+'-OJ-ITM-V-99',based_on_a_realization_of:['eli/dl/doc/C-10-2026-0176']}];
 const response=await upcomingVotes({sitting,language:'en'},{inputs:async()=>data});
 assert.deepEqual(response.items.map(item=>[item.id,item.documentId]),[[agendaItemId,documentId],[sitting+'-OJ-ITM-V-13','A-9-2024-0162'],[sitting+'-OJ-ITM-V-99',null]]);
});

test('unverified scope remains a gap when no amendments can be displayed',async()=>{const data=await inputs();data.amendments=[];data.partialDocuments=[documentId];const response=await upcomingVotes({sitting,language:'en'},{inputs:async()=>data});assert.equal(response.items[0].partial,true);assert.deepEqual(response.items[0].rows,[]);});

test('an unavailable held sitting cannot become an empty successful ballot',async()=>{await assert.rejects(()=>ballotInputs({sitting:'MTG-PL-2026-09-15',language:'en'},{store:{},reader:{snapshot:async()=>({days:[]})}}),error=>error.status===503);});

test('unlisted future sittings never probe a meeting, including repeated arbitrary dates',async()=>{
 let calls=0;for(const sitting of ['MTG-PL-9999-12-31','MTG-PL-2026-12-25','MTG-PL-2026-12-25'])await assert.rejects(()=>ballotInputs({sitting,language:'en'},{store:{},clock:()=>Date.parse('2026-11-03'),meetings:{catalogue:async()=>({nodes:[],coverage:{status:'complete'}})},request:()=>{calls++;throw Error('No upstream meeting probe');}}),error=>error.status===404);assert.equal(calls,0);
});
test('one evidence context and source-revision response cache cover every agenda item',async()=>{
 const {ballotContext}=await import('./your-vote-ballot.mjs'),{BallotResponseCache}=await import('./ballot-response-cache.mjs');let contexts=0,derivations=0,amendmentReads=0;
 const data=await inputs();data.day.agenda=Array.from({length:19},(_,i)=>({...agenda,activity_id:agendaItemId+'-'+i}));data.revision='one';data.loadAmendments=()=>{amendmentReads++;return {amendments:data.amendments,partialDocuments:[]};};const cache=new BallotResponseCache();
 const makeContext=(day,amendments)=>{contexts++;return ballotContext(day,amendments,(...args)=>{derivations++;return derive(...args);});},derive=(await import('./vote-evidence.mjs')).deriveVoteEvidence;
 const options={inputs:async()=>data,cache,makeContext},query={sitting,language:'en'};
 const first=await upcomingVotes(query,options);assert.equal(first.items.length,19);assert.equal(contexts,1);assert.equal(derivations,1);assert.strictEqual(await upcomingVotes(query,options),first);assert.equal(contexts,1);assert.equal(amendmentReads,1);
 data.revision='two';assert.notStrictEqual(await upcomingVotes(query,options),first);assert.equal(contexts,2);
});
test('public response cache is bounded by entry count, bytes and expiry',async()=>{
 const {BallotResponseCache}=await import('./ballot-response-cache.mjs');let time=0;const cache=new BallotResponseCache({clock:()=>time,maxEntries:2,maxBytes:60,ttl:10});cache.set('one',{n:1});cache.set('two',{n:2});cache.set('three',{n:3});assert.equal(cache.get('one'),null);cache.set('large',{n:'x'.repeat(100)});assert.equal(cache.get('large'),null);time=11;assert.equal(cache.get('two'),null);assert(cache.bytes<=60);
});
test('bulk comparison returns every bound roll call with one shared snapshot',async()=>{
 const {voteFixture}=await import('./test-support/decision-votes.mjs'),{ballotComparisons}=await import('./upcoming-votes.mjs');const f=voteFixture(),document='B-10-2026-0424',agendaItem=f.day.agenda.find(a=>a.had_activity_type?.endsWith('PLENARY_VOTE'));
 const parent=f.day.results.find(r=>r.id===f.raw.inverse_consists_of[0]),agendaId=String(parent.executed[0]?.id||parent.executed[0]).split('/').at(-1);
 for(const [n,amendment]of [[999991,115],[999992,116]]){const copy={...f.raw,id:'eli/dl/event/MTG-PL-2026-10-07-DEC-'+n,activity_id:'MTG-PL-2026-10-07-DEC-'+n,decided_on_a_realization_of:['eli/dl/doc/'+document+'-AM-'+amendment]};f.day.decisions.push(copy);parent.consists_of.push(copy.id);}
 const data={day:{...f.day,agenda:[{...agendaItem,activity_id:agendaId,had_activity_type:'def/ep-activities/PLENARY_VOTE',based_on_a_realization_of:['eli/dl/doc/'+document]}]},amendments:[],lists:[{documentId:document,agendaItemId:agendaId,rows:[114,115].map((number,i)=>({kind:'amendment',row:i+1,amendments:[{number,cp:null}],subject:[],part:null})),notes:{}}]};
 const result=await ballotComparisons({sitting:f.day.sittingId,language:'en'},{reader:f.reader,store:f.store,inputs:async()=>data});assert.equal(f.reads(),1);assert.equal(result.items.length,2);assert.deepEqual(result.items.map(r=>r.decisionId).sort(),[f.raw.activity_id,'MTG-PL-2026-10-07-DEC-999991'].sort());assert(result.items.every(r=>r.integrity==='complete'));assert(!JSON.stringify(result).includes('choice'));
});
test('an unsettled future agenda is never pinned in the assembled response cache',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),{prepareBallotBindings}=await import('./ballot-bindings-store.mjs');const db=new DatabaseSync(':memory:');prepareBallotBindings(db);
 try{const data=await ballotInputs({sitting,language:'en'},{store:{db,status:()=>({servingGeneration:1}),get:()=>null},clock:()=>Date.parse('2026-11-03'),meetings:{catalogue:async()=>({nodes:[{activity_id:sitting}],coverage:{status:'complete'}})},lists:async()=>[],request:async endpoint=>({stale:true,payload:{data:endpoint.endsWith('/foreseen-activities')?[]:[{activity_id:sitting,had_activity_type:'def/ep-activities/PLENARY_SITTING'}]}})});assert.equal(data.revision,null);}finally{db.close();}
});
