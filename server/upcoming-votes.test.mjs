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
test('a voting list places a report the agenda has no vote item for',async()=>{
 const {placeVotingLists}=await import('./ballot-placement.mjs');
 const vote=(id,docs,proc)=>({activity_id:sitting+'-OJ-ITM-'+id,id:'eli/dl/event/'+sitting+'-OJ-ITM-'+id,had_activity_type:'def/ep-activities/PLENARY_VOTE',based_on_a_realization_of:docs.map(d=>'eli/dl/doc/'+d),inverse_was_scheduled_in:proc?['eli/dl/proc/'+proc]:[]});
 const closed={activity_id:sitting+'-OJ-ITM-D-3',id:'eli/dl/event/'+sitting+'-OJ-ITM-D-3',had_activity_type:'def/ep-activities/PLENARY_DEBATE'};
 const other={activity_id:sitting+'-OJ-ITM-D-51',id:'eli/dl/event/'+sitting+'-OJ-ITM-D-51',had_activity_type:'def/ep-activities/PLENARY_DEBATE'};
 const slot={activity_id:sitting+'-TF-1100',had_activity_type:'def/ep-activities/MEETING_PART',consists_of:['eli/dl/event/'+sitting+'-OJ-ITM-V-46','eli/dl/event/'+sitting+'-OJ-ITM-V-45','eli/dl/event/'+sitting+'-OJ-ITM-D-3']};
 const agenda=[vote('V-45',['A-10-2026-0269']),vote('V-46',[],'2025-2118'),closed,other,slot];
 const list=documentId=>({sittingId:sitting,documentId,agendaItemId:null,rows:[]});
 const held={'A-10-2026-0280':{inverse_based_on_a_realization_of:['eli/dl/event/2025-2118-DEPOT-2026-10-26']},'A-10-2026-0271':{inverse_based_on_a_realization_of:['eli/dl/event/2025-0223-DEPOT-2026-10-12','eli/dl/event/MTG-PL-2026-11-11-OJ-ITM-D-37']},'A-10-2026-0261':{inverse_based_on_a_realization_of:[]}};
 const placed=placeVotingLists(['A-10-2026-0269','A-10-2026-0280','A-10-2026-0271','A-10-2026-0261'].map(list),agenda,id=>held[id]);
 assert.deepEqual(placed.map(p=>[p.agendaItemId,p.placement,p.alsoOn]),[[sitting+'-OJ-ITM-V-45','vote-item',undefined],[sitting+'-OJ-ITM-V-46','procedure',undefined],['MTG-PL-2026-11-11-OJ-ITM-D-37','debate',[sitting+'-OJ-ITM-D-3']],[sitting+'-OJ-ITM-D-3','debate',[]]]);
 // A binding the collector already made survives a day without its agenda.
 assert.equal(placeVotingLists([{...list('A-10-2026-0261'),agendaItemId:sitting+'-OJ-ITM-V-45'}],[],()=>{throw Error('Not needed');})[0].agendaItemId,sitting+'-OJ-ITM-V-45');
 // No slot item and no held debate reference: nothing is guessed.
 assert.equal(placeVotingLists([list('A-10-2026-0261')],[vote('V-45',['A-10-2026-0269'])],id=>held[id])[0].agendaItemId,null);
 // A debate from an earlier session is not this vote's debate.
 assert.equal(placeVotingLists([list('A-10-2026-0261')],[],()=>({inverse_based_on_a_realization_of:['eli/dl/event/MTG-PL-2026-10-07-OJ-ITM-D-9']}))[0].agendaItemId,null);
});
test('placed reports get their ballot, wording and results through exact references',async()=>{
 const report='A-10-2026-0271',debate='MTG-PL-2026-11-11-OJ-ITM-D-37',ai='A-10-2026-0280',result='MTG-PL-2026-11-12-VOT-ITM-1';
 const data=await inputs();data.amendments=[{...row,id:report+'-AM-5',number:5,proposedText:'Text',scheduledVotes:[]}];
 data.day.agenda=[{...agenda,activity_id:sitting+'-OJ-ITM-V-46',based_on_a_realization_of:[],inverse_was_scheduled_in:['eli/dl/proc/2025-2118']}];
 const rows=number=>[{kind:'amendment',row:1,subject:['§ 1'],amendments:[{number,cp:null}],part:null}];
 data.lists=[{documentId:report,sittingId:sitting,agendaItemId:debate,placement:'debate',alsoOn:[sitting+'-OJ-ITM-D-3'],procedureIds:['2025-0223'],heading:{title:'Union Civil Protection Mechanism'},rows:rows(5),revision:{sha256:'one'},notes:{}},{documentId:ai,sittingId:sitting,agendaItemId:sitting+'-OJ-ITM-V-46',placement:'procedure',rows:rows(1),revision:{sha256:'two'},notes:{}}];
 data.day.results=[{activity_id:result,id:'eli/dl/event/'+result,had_activity_type:'def/ep-activities/PLENARY_VOTE_RESULTS',based_on_a_realization_of:['eli/dl/doc/'+report],executed:[]}];
 data.day.decisions=[{activity_id:'MTG-PL-2026-11-12-DEC-1',id:'eli/dl/event/MTG-PL-2026-11-12-DEC-1',activity_order:'1.0',decided_on_a_realization_of:['eli/dl/doc/'+report+'-AM-5'],decision_outcome:'def/ep-statuses/ADOPTED',inverse_consists_of:['eli/dl/event/'+result]}];
 const response=await upcomingVotes({sitting,language:'en'},{inputs:async()=>data});
 const byDocument=Object.fromEntries(response.items.map(item=>[item.documentId,item]));
 assert.equal(byDocument[ai].id,sitting+'-OJ-ITM-V-46');assert.equal(byDocument[ai].source,'voting-list');
 assert.equal(byDocument[report].id,debate);assert.deepEqual(byDocument[report].alsoOn,[sitting+'-OJ-ITM-D-3']);assert.equal(byDocument[report].title,'Union Civil Protection Mechanism');assert.deepEqual(byDocument[report].procedureIds,['2025-0223']);
 assert.equal(byDocument[report].rows[0].amendmentRows[0].proposedText,'Text');assert.equal(byDocument[report].rows[0].outcome,'ADOPTED');
});
test('results reach a report without a vote item only through a record that is its own',async()=>{
 const report='A-10-2026-0271',other='A-10-2026-0261',debate='MTG-PL-2026-11-11-OJ-ITM-D-37',record='MTG-PL-2026-11-12-VOT-ITM-1';
 const decision=(n,extra)=>({activity_id:'MTG-PL-2026-11-12-DEC-'+n,id:'eli/dl/event/MTG-PL-2026-11-12-DEC-'+n,activity_order:'1.0',referenceText:{en:'Motion for a resolution (as a whole)'},decision_outcome:'def/ep-statuses/ADOPTED',inverse_consists_of:['eli/dl/event/'+record],...extra});
 const votingList={documentId:report,sittingId:sitting,agendaItemId:debate,placement:'debate',alsoOn:[],procedureIds:[],heading:{title:'Report'},rows:[{kind:'final',row:1,subject:[],amendments:[],label:'vote: resolution (as a whole)',part:null}],revision:{sha256:'one'},notes:{}};
 const outcome=async(results,decisions,voteNodes=[])=>{const data=await inputs();data.amendments=[];data.lists=[votingList];data.day.agenda=voteNodes;data.day.results=results;data.day.decisions=decisions;return (await upcomingVotes({sitting,language:'en'},{inputs:async()=>data})).items.find(item=>item.documentId===report).rows[0].outcome;};
 const result=(documents,executed=[])=>({activity_id:record,id:'eli/dl/event/'+record,based_on_a_realization_of:documents.map(d=>'eli/dl/doc/'+d),executed:executed.map(e=>'eli/dl/event/'+e)});
 assert.equal(await outcome([result([report])],[decision(1)]),'ADOPTED');
 // The record names another report too: it cannot identify this report's final vote.
 assert.equal(await outcome([result([report,other])],[decision(1)]),null);
 // A decision naming another document never binds here.
 assert.equal(await outcome([result([report])],[decision(1,{decided_on_a_realization_of:['eli/dl/doc/'+other]})]),null);
 // The record executes a vote item that belongs to another report.
 const foreign=sitting+'-OJ-ITM-V-99';
 assert.equal(await outcome([result([report],[foreign])],[decision(1)],[{...agenda,activity_id:foreign,based_on_a_realization_of:['eli/dl/doc/'+other]}]),null);
 // Two records name the report.
 assert.equal(await outcome([result([report]),{...result([report]),activity_id:record+'0',id:'eli/dl/event/'+record+'0'}],[decision(1)]),null);
});
test('retained bindings stay on their vote item and follow a report only off a removed item',async()=>{
 const report='A-10-2026-0271',v46=sitting+'-OJ-ITM-V-46',v47=sitting+'-OJ-ITM-V-47',debate='MTG-PL-2026-11-11-OJ-ITM-D-37',binding=agendaId=>[{agenda:agendaId,document:report,key:report+':final',decisionId:'MTG-PL-2026-11-12-DEC-1'}];
 const named=id=>({...agenda,activity_id:id,based_on_a_realization_of:['eli/dl/doc/'+report]});
 const run=async(nodes,bindings)=>{const data=await inputs();data.amendments=[];data.lists=[];data.day.agenda=nodes;data.bindings=bindings;return (await upcomingVotes({sitting,language:'en'},{inputs:async()=>data})).items;};
 const two=await run([named(v46),named(v47)],binding(v46));
 assert.deepEqual(two.map(item=>[item.id,item.rows.length]),[[v46,1],[v47,0]]);
 // Parliament adds a vote item for a report that was placed on its debate item.
 const moved=await run([named(v46)],binding(debate));
 assert.deepEqual(moved.map(item=>[item.id,item.documentId,item.source,item.rows[0]?.key]),[[v46,report,'retained',report+':final']]);
 // Several vote items name it: a report identifier alone can't choose between them.
 assert.deepEqual((await run([named(v46),named(v47)],binding(debate))).map(item=>item.rows.length),[0,0]);
});
test('a report that never got a vote item keeps its results after the voting list is purged',async()=>{
 const report='A-10-2026-0271',debate='MTG-PL-2026-11-11-OJ-ITM-D-37',data=await inputs();
 data.amendments=[];data.lists=[];data.day.agenda=[agenda];data.bindings=[{agenda:debate,document:report,key:report+':final',decisionId:'MTG-PL-2026-11-12-DEC-1'}];
 data.documentOf=id=>id===report?{title_dcterms:{en:'Union Civil Protection Mechanism'},inverse_based_on_a_realization_of:['eli/dl/event/2025-0223-DEPOT-2026-10-12']}:null;
 data.day.results=[{activity_id:'MTG-PL-2026-11-12-VOT-ITM-1',id:'eli/dl/event/MTG-PL-2026-11-12-VOT-ITM-1',based_on_a_realization_of:['eli/dl/doc/'+report],executed:[]}];
 data.day.decisions=[{activity_id:'MTG-PL-2026-11-12-DEC-1',id:'eli/dl/event/MTG-PL-2026-11-12-DEC-1',decision_outcome:'def/ep-statuses/ADOPTED',inverse_consists_of:['eli/dl/event/MTG-PL-2026-11-12-VOT-ITM-1']}];
 const item=(await upcomingVotes({sitting,language:'en'},{inputs:async()=>data})).items.find(entry=>entry.documentId===report);
 assert.deepEqual([item.id,item.source,item.title,item.procedureIds,item.rows[0].key,item.rows[0].outcome],[debate,'retained','Union Civil Protection Mechanism',['2025-0223'],report+':final','ADOPTED']);
});
test('a report without a vote item keeps every retained binding after the purge',async()=>{
 const report='A-10-2026-0271',data=await inputs();data.amendments=[];data.lists=[];data.day.agenda=[agenda];
 data.bindings=[{agenda:sitting+'-OJ-ITM-D-3',document:report,key:report+':final',decisionId:'DEC-1'},{agenda:'MTG-PL-2026-11-11-OJ-ITM-D-37',document:report,key:report+':am:1',decisionId:'DEC-2'}];
 const items=(await upcomingVotes({sitting,language:'en'},{inputs:async()=>data})).items.filter(item=>item.documentId===report);
 assert.equal(items.length,1);assert.deepEqual(items[0].rows.map(row=>row.key).sort(),[report+':am:1',report+':final']);
});
