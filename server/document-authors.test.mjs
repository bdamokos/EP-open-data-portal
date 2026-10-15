import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { documentAuthorIdentities, documentCoAuthors } from './document-authors.mjs';
import { activityDocument } from './activities.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/document-authors-live-20261014.json',import.meta.url),'utf8'));
test('real question and resolution author IDs join the documented current roster without name inference',()=>{
  const [question,motion]=fixture.documents;
  const resolve=(doc,id)=>documentCoAuthors(doc.work,{members:fixture.roster.members,selectedDocumentId:id,documentApiUrl:doc.sourceUrl,documentFetchedAt:doc.fetchedAt,rosterFetchedAt:fixture.roster.fetchedAt});
  const result=resolve(question,question.work.identifier);
  assert.equal(result.coAuthors.length,30);
  assert(result.coAuthors.every(a=>a.profileAvailable && a.name && a.role==='AUTHOR' && a.sourceDocumentId==='E-10-2026-003031'));
  assert.equal(result.coAuthors.find(a=>a.id===257043).name,'Maravillas ABADÍA JOVER');
  assert.equal(result.coAuthors.find(a=>a.id===204413).name,'Marcos ROS SEMPERE');
  assert(result.coAuthors.every(a=>a.relationships.includes('creator') && a.relationships.some(p=>p.includes('(AUTHOR)'))));
  assert.equal(result.coAuthorSource.documentFetchedAt,question.fetchedAt);
  assert.equal(result.coAuthorSource.rosterFetchedAt,fixture.roster.fetchedAt);
  const authors=resolve(motion,motion.work.identifier).coAuthors;
  assert.deepEqual(authors.map(a=>[a.id,a.name]),[[256959,'Alexander SELL']]);
  const answer=resolve(question,'E-10-2026-003031-ASW');
  assert(answer.coAuthors.every(a=>a.role==='QUESTION_AUTHOR' && a.sourceDocumentId==='E-10-2026-003031'));
});
test('authors use exact canonical person/role references; organizations, rapporteurs and malformed references stay unlinked',()=>{
  const work={identifier:'B-10-2026-000001',work_type:'def/ep-document-types/RESOLUTION_MOTION',creator:['person/42','person/42','org/PPE','https://evil.example/person/43','person/00044','person/9007199254740992'],workHadParticipation:[
    {participation_role:'https://data.europarl.europa.eu/def/ep-roles/AUTHOR',had_participant_person:[{id:'https://data.europarl.europa.eu/person/42'},'person/45']},
    {participation_role:'def/ep-roles/RAPPORTEUR',had_participant_person:['person/46']},
    {participation_role:'https://evil.example/def/ep-roles/AUTHOR',had_participant_person:['person/47']},
    {participation_role:'def/ep-roles/AUTHOR',had_participant_organization:['org/COM']},
  ]};
  const result=documentCoAuthors(work,{members:[{id:'42',name:'Verified NAME'},{id:'99',name:'A name in the question'}]});
  assert.deepEqual(result.coAuthors.map(a=>a.id),[42,45]);
  assert.equal(result.coAuthors[0].profileAvailable,true);
  assert.equal(result.coAuthors[1].name,null);assert.equal(result.coAuthors[1].profileAvailable,false);
  assert.equal(result.coAuthors[1].personUri,'https://data.europarl.europa.eu/person/45');
  assert.equal(result.coAuthorSource.rosterFetchedAt,null);
  assert.deepEqual(documentAuthorIdentities({...work,work_type:'def/ep-document-types/REPORT_PLENARY'}),[]);
  assert.deepEqual(documentAuthorIdentities({...work,work_type:'def/ep-document-types/QUESTION_WRITTEN_ANSWER'}),[]);
});
test('document handler resolves saved authors read-only while an incomplete index is serving',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'document-author-handler-'));
  const oldEnabled=process.env.ACTIVITY_INDEX_ENABLED,oldDirectory=process.env.ACTIVITY_INDEX_DIR,oldFetch=globalThis.fetch;
  process.env.ACTIVITY_INDEX_ENABLED='true';process.env.ACTIVITY_INDEX_DIR=directory;
  const {activityIndex}=await import('./activity-index-worker.mjs');
  const {store,worker}=activityIndex();
  try {
    assert(store.acquire());const cycle=store.beginCycle();
    store.setMembers(fixture.roster.members);
    const doc=fixture.documents[0],endpoint='/parliamentary-questions/'+doc.work.identifier;
    const work={...doc.work,is_realized_by:[],inverse_answers_to:[{identifier:doc.work.identifier+'-ASW',is_realized_by:[]}]};
    store.putSource(cycle.generation,endpoint,'document',work,doc.fetchedAt);store.release();
    const before=store.source(cycle.generation,endpoint),requests=[];
    globalThis.fetch=async url=>{requests.push(url);throw new Error('No author fan-out is allowed');};
    store.db.exec('PRAGMA query_only=ON');
    const question=await activityDocument(doc.work.identifier,257043,'en');
    const answer=await activityDocument(doc.work.identifier+'-ASW',257043,'en');
    assert.equal(question.coAuthors.length,30);assert(question.coAuthors.every(a=>a.profileAvailable));
    assert(answer.coAuthors.every(a=>a.role==='QUESTION_AUTHOR' && a.sourceDocumentId===doc.work.identifier));
    assert.equal(question.coAuthorSource.documentFetchedAt,new Date(doc.fetchedAt).toISOString());
    assert.equal(question.coAuthorSource.rosterFetchedAt,store.get('rosterFetchedAt'));
    assert.deepEqual(store.source(cycle.generation,endpoint),before);
    assert.equal(store.status().complete,false);assert.equal(worker.running,false);assert.deepEqual(requests,[]);
  } finally {
    globalThis.fetch=oldFetch;store.db.exec('PRAGMA query_only=OFF');store.close();
    if(oldEnabled===undefined)delete process.env.ACTIVITY_INDEX_ENABLED;else process.env.ACTIVITY_INDEX_ENABLED=oldEnabled;
    if(oldDirectory===undefined)delete process.env.ACTIVITY_INDEX_DIR;else process.env.ACTIVITY_INDEX_DIR=oldDirectory;
    await rm(directory,{recursive:true,force:true});
  }
});
