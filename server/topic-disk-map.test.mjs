import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {TopicDiskMap} from './topic-disk-map.mjs';
import {topicObservationNodes,topicObservationSteps} from './record-topic-observations.mjs';
import {projectRecordTopics} from './record-topics.mjs';
test('disk-backed graph matches the in-memory exact-link result without copying the graph',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA temp_store=FILE');const disk=name=>new TopicDiskMap(db,name),stamp={url:'https://data.europarl.europa.eu/api/v2/speeches',fetchedAt:'2025-06-01'},doc='B-10-2025-000001',oral='O-10-2025-000002',event='MTG-PL-2025-05-06-PVCRE-ITM-1',speech='MTG-PL-2025-05-06-OTH-1';
 const observations=[{identifier:doc,work_type:'def/ep-document-types/MOTION',document_date:'2025-05-06',is_about:['http://eurovoc.europa.eu/245']},{identifier:oral,work_type:'def/ep-document-types/QUESTION_ORAL',document_date:'2025-05-06'},{activity_id:event,activity_date:'2025-05-06',based_on_a_realization_of:['eli/dl/doc/'+doc,'eli/dl/doc/'+oral]},{activity_id:speech,activity_date:'2025-05-06',had_activity_type:'def/ep-activities/PLENARY_DEBATE_SPEECH',inverse_consists_of:['eli/dl/event/'+event]}].map(work=>({work,source:stamp,projection:'raw'}));
 const expected=projectRecordTopics(topicObservationNodes(observations));
 const steps=topicObservationSteps(observations,{map:disk,stream:true});let step;do{step=steps.next();}while(!step.done);const nodes=step.value;
 const result=projectRecordTopics({[Symbol.iterator]:()=>nodes.values()},{map:disk,stream:true});
 const sort=rows=>rows.sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(sort([...result.records.values()]),sort(JSON.parse(JSON.stringify(expected.records))));
 assert.equal([...result.records.values()].find(r=>r.id===oral).assignments.length,1);
});
