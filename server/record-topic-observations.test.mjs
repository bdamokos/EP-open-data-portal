import {test} from 'node:test';
import assert from 'node:assert/strict';
import {topicObservationNodes} from './record-topic-observations.mjs';
import {projectRecordTopics} from './record-topics.mjs';
const event='MTG-PL-2026-10-07-PVCRE-ITM-12',speech='MTG-PL-2026-10-07-OTH-100',doc='B-10-2026-0423';
const source=day=>({url:'https://data.europarl.europa.eu/api/v2/events/'+event,fetchedAt:'2026-10-'+day+'T12:00:00Z'});
const observation=(work,day,projection='raw')=>({work,source:source(day),projection});
const document={id:'eli/dl/doc/'+doc,identifier:doc,work_type:'def/ep-document-types/MOTION',is_about:['http://eurovoc.europa.eu/245'],inverse_based_on_a_realization_of:['eli/dl/event/'+event]};
const agenda=docs=>({id:'eli/dl/event/'+event,activity_id:event,based_on_a_realization_of:docs.map(id=>'eli/dl/doc/'+id)});
const contribution=observation({identifier:speech,parentIds:[event]},'24','outside-speech');
function result(observations){return projectRecordTopics(topicObservationNodes(observations)).records.find(r=>r.id===speech);}
test('new event observations retract old document links, including older inverse evidence',()=>{
 const old=[observation(document,'23'),observation(agenda([doc]),'23'),contribution];
 assert.equal(result(old).assignments.length,1);
 for(const rows of [[...old,observation(agenda([]),'24')],[observation(agenda([]),'24'),...old]])assert.equal(result(rows).assignments.length,0);
});
test('incompatible simultaneous event observations withhold context',()=>{
 const rows=[observation(document,'23'),observation(agenda([doc]),'24'),observation(agenda([]),'24'),contribution];
 const nodes=topicObservationNodes(rows);assert.equal(nodes.find(n=>n.id===event).conflicted,true);assert.equal(result(rows).assignments.length,0);
});
test('new document inverse observations retract earlier event evidence',()=>{
 assert.equal(result([observation(agenda([doc]),'23'),observation({...document,inverse_based_on_a_realization_of:[]},'24'),contribution]).assignments.length,0);
});

const procedure=docs=>({id:'eli/dl/proc/2026-2790',label:'2026/2790(RSP)',consists_of:[agenda(docs)]});
test('procedure-embedded event observations retract older inverse document edges',()=>{
 const rows=[observation(document,'23'),observation(procedure([]),'24'),contribution];assert.equal(result(rows).assignments.length,0);
});
test('equal-time embedded event conflicts withhold context in either input order',()=>{
 const a=observation(procedure([doc]),'24'),b=observation(procedure([]),'24');
 for(const pair of [[a,b],[b,a]]){const r=result([observation(document,'23'),...pair,contribution]);assert.equal(r.assignments.length,0);assert.equal(r.status,'ambiguous');}
});
test('a partial embedded event does not erase the exact executed edge from its full observation',()=>{
 const scheduled='MTG-PL-2026-10-07-OJ-ITM-D-61',oldFull={...agenda([]),executed:['eli/dl/event/'+scheduled]},partial=procedure([]);
 const rows=[observation({...document,inverse_based_on_a_realization_of:['eli/dl/event/'+scheduled]},'23'),observation({activity_id:scheduled,based_on_a_realization_of:['eli/dl/doc/'+doc]},'23'),observation(oldFull,'23'),observation(partial,'24'),contribution];
 const r=result(rows);assert(r.assignments.some(a=>a.key==='eurovoc:245'));assert(r.assignments[0].paths.some(p=>p.steps.some(s=>s.field==='executed'&&s.to===scheduled)));
});
test('equal-time compact and raw speech observations must agree on normalized parents',()=>{
 const compact=contribution,raw=observation({activity_id:speech,activity_date:'2026-10-07',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',inverse_consists_of:['eli/dl/event/MTG-PL-2026-10-07-PVCRE-ITM-13']},'24');
 for(const pair of [[compact,raw],[raw,compact]]){const r=result([observation(document,'23'),observation(agenda([doc]),'23'),...pair]);assert.equal(r.status,'ambiguous');assert.equal(r.assignments.length,0);}
});

test('published procedure URIs survive when the target metadata is not yet retained',()=>{
 const nodes=topicObservationNodes([observation({activity_id:event,inverse_was_scheduled_in:['eli/dl/proc/2026-2790']},'24')]);assert.deepEqual(nodes.find(n=>n.id===event).procedureEdges.map(e=>e.id),['2026-2790']);
});
