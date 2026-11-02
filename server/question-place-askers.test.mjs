import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ActivityStore} from './activity-index-store.mjs';
import {retainDemographicRecord} from './demographic-metadata.mjs';
import {questionPlaceTables,questionCountryMetadata,writeQuestionPlaceAskers} from './question-place-askers.mjs';
import {writeTopicProjection} from './topics-store.mjs';
import {projectRecordTopics} from './record-topics.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {questionPlaceAskers} from './question-place-askers.mjs';
test('known co-author home takes precedence, former metadata is used, and missing countries remain unknown',()=>{
 const members=new Map([['1',{countryCode:'GR'}],['2',{countryCode:'CY'}]]),metadata=new Map([['3',{'api:country-of-representation':'EL'}]]);
 assert.equal(questionPlaceAskers(['1'],'GRC',members),'home');assert.equal(questionPlaceAskers(['1'],'CYP',members),'elsewhere');assert.equal(questionPlaceAskers(['1','9'],'GRC',members),'home');assert.equal(questionPlaceAskers(['1','9'],'CYP',members),'unknown');assert.equal(questionPlaceAskers(['3'],'GRC',members,metadata),'home');assert.equal(questionPlaceAskers(['1','2'],'USA',members),'elsewhere');assert.equal(questionPlaceAskers(['9'],'USA',members),'unknown');assert.equal(questionPlaceAskers([],'GRC',members),'unknown');
});

test('retained former-MEP roster country survives absence from the current roster',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'former-question-country-')),store=new ActivityStore(dir,{initializeIndexes:true});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});store.acquire();store.set('active',1);store.setMembers([{id:'42',countryCode:'GR'}]);
 retainDemographicRecord(store,1,'99',{url:'https://data.europarl.europa.eu/api/v2/meps/show-current',fetchedAt:'2025-01-01T12:00:00Z',payload:{data:[{id:'person/99','api:country-of-representation':'CY'}]}},{kind:'roster'});
 writeTopicProjection(store,projectRecordTopics([{id:'E-10-2026-000001',kind:'question',date:'2026-10-07',titles:{en:'Cyprus'},members:['99']}]));const countries=await questionCountryMetadata(store,1,null);writeQuestionPlaceAskers(store,1,countries);assert.equal(store.db.prepare('SELECT askers FROM record_topic_question_places').get().askers,'home');assert.equal(store.get('recordTopicAskerCoverage').formerAuthorsWithSavedCountry,1);assert.equal(store.get('recordTopicAskerCoverage').currentOnly.unknown,1);
});
