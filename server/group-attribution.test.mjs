import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroupOn,generationGroupOn,datedPerson} from './group-attribution.mjs';
import {namedVote,topicRoles} from './insights-legislation-model.mjs';
import {finalVotePatterns} from './insights-legislation-model.mjs';

const group=(code,org,start,end=null)=>({code,org:'org/'+org,groupId:'org/'+code,start,end});
const person=(groups,end=null)=>({coverage:'complete',mandateCoverage:'complete',mandates:[{start:'2024-07-16',end}],groups,ambiguous:[]});
// Exact switch boundaries observed in public /meps/{id} records, 23 October 2026.
const members={
  '124846':person([group('S&D',7038,'2024-07-16','2026-06-16'),group('Renew',7035,'2026-06-17')]),
  '256852':person([group('PfE',7150,'2024-07-16','2026-02-03'),group('NI',6561,'2026-02-04','2026-06-16'),group('ECR',7037,'2026-06-17')]),
  '257125':person([group('PfE',7150,'2024-07-16','2026-02-03'),group('NI',6561,'2026-02-04','2026-02-23'),group('ESN',7151,'2026-02-24')]),
  '256921':person([group('PPE',7018,'2024-07-16','2026-01-20'),group('PfE',7150,'2026-01-21','2026-09-26')],'2026-09-26'),
};
const groupOn=createGroupOn({members});

test('inclusive ends and next-day starts across Picierno, Bartůšek and Vannacci switches',()=>{
  for(const [id,days] of Object.entries({124846:[['2026-06-16','S&D'],['2026-06-17','Renew']],256852:[['2026-02-03','PfE'],['2026-02-04','NI'],['2026-06-16','NI'],['2026-06-17','ECR']],257125:[['2026-02-03','PfE'],['2026-02-04','NI'],['2026-02-23','NI'],['2026-02-24','ESN']]}))for(const [date,code] of days)assert.equal(groupOn(id,date).code,code);
  assert.deepEqual(groupOn('124846','2026-06-16'),{code:'S&D',orgId:'org/7038',groupId:'org/S&D'});
});
test('a one-day NI interval is explicit; outgoing Castillo retains affiliation through his final mandate day',()=>{
  const one=createGroupOn({members:{one:person([group('PfE',7150,'2024-07-16','2026-05-04'),group('NI',6561,'2026-05-05','2026-05-05'),group('ECR',7037,'2026-05-06')])}});
  assert.deepEqual(['2026-05-04','2026-05-05','2026-05-06'].map(day=>one('one',day).code),['PfE','NI','ECR']);
  for(const [day,result] of [['2026-01-20','PPE'],['2026-01-21','PfE'],['2026-09-26','PfE']])assert.equal(groupOn('256921',day).code,result);
  assert.equal(groupOn('256921','2026-09-27'),'not-serving');
});
test('missing or ambiguous evidence falls back; only complete mandates establish not-serving',()=>{
  const partial={...members['124846'],coverage:'partial',mandateCoverage:'partial',mandates:[]};
  const resolve=createGroupOn({members:{partial,ambiguous:{...members['124846'],ambiguous:[{start:'2026-06-15',end:'2026-06-17'}]},overlap:person([group('PPE',7018,'2024-07-16'),group('PfE',7150,'2025-01-01')]),unmapped:person([{...group('NI',6561,'2024-07-16'),groupId:null}]),gap:person([group('PPE',7018,'2026-01-01')])}});
  for(const date of [null,undefined,'2026-02-30','2024-07-15','2030-01-01'])assert.equal(groupOn('124846',date),'unavailable');
  assert.equal(groupOn('999','2026-06-16'),'unavailable');
  assert.equal(groupOn('0124846','2026-06-16'),'unavailable');
  assert.equal(resolve('partial','2026-06-16'),'unavailable');
  for(const id of ['ambiguous','overlap'])assert.equal(resolve(id,'2026-06-16'),'ambiguous');
  assert.equal(resolve('unmapped','2026-06-16'),'unavailable');assert.equal(resolve('gap','2025-06-16'),'unavailable');
  for(const id of ['partial','ambiguous'])assert.equal(datedPerson({id,group:'Renew'},'2026-06-16',resolve).affiliationGroup,'Renew');
  assert.equal(datedPerson({id:'256921',group:'PfE'},'2026-09-27',groupOn).affiliationGroup,null);
});
test('generation is captured once, indexed once and retained while the serving snapshot changes',()=>{
  let reads=0;const snapshots=new Map([[1,JSON.stringify({members})],[2,JSON.stringify({members:{...members,'124846':person([group('NI',6561,'2024-07-16')])}})]]);
  const store={db:{prepare(sql){assert.match(sql,/group_history_snapshots/);return {get(generation){reads++;return {body:snapshots.get(generation)};}};}}};
  const first=generationGroupOn(store,1);assert.equal(reads,1);
  for(let n=0;n<1000;n++)assert.equal(generationGroupOn(store,1)('124846','2026-06-16').code,'S&D');
  assert.equal(reads,1);const second=generationGroupOn(store,2);assert.equal(second('124846','2026-06-16').code,'NI');
  snapshots.delete(1);assert.equal(first('124846','2026-06-16').code,'S&D');assert.equal(reads,2);
  let traversals=0;const once=new Proxy(members,{ownKeys(target){traversals++;return Reflect.ownKeys(target);}});
  const indexed=createGroupOn({members:once});for(let n=0;n<1000;n++)indexed('124846','2026-06-16');assert.equal(traversals,1);
});
test('dated named voters, intended corrections and document roles preserve roster fields separately from contribution groups',()=>{
  const roster=new Map([['124846',{name:'Pina Picierno',groupCode:'Renew'}]]),metadata=new Map();
  const source={url:'https://data.europarl.europa.eu/api/v2/decisions/example',fetchedAt:'2026-06-16T12:00:00Z'};
  const vote=namedVote({id:'eli/dl/event/test',activity_date:'2026-06-16',referenceText:{en:'Motion for a resolution (as a whole)'},had_voter_favor:['person/124846'],had_voter_against:[],had_voter_abstention:[],had_voter_intended_against:['person/124846']},source,roster,metadata,'2026-06-16',groupOn);
  assert.equal(vote.groups.for[0].affiliationGroup,'S&D');assert.equal(vote.groups.for[0].group,'Renew');assert.equal(vote.intendedCorrections.against[0].affiliationGroup,'S&D');
  assert.equal(finalVotePatterns([vote],roster,metadata,groupOn).groups.for[0].contributionGroup,'S&D');
  const roles=topicRoles({documentIds:['Q']},[{sourceId:'Q',mepId:'124846',date:'2026-06-16',provenance:{role:'AUTHOR'}}],[],roster,metadata,groupOn);
  assert.equal(roles[0].affiliationGroup,'S&D');assert.equal(roles[0].date,'2026-06-16');
});
test('question authors use the response generation even when publication changes during metadata loading',async()=>{
  const {QuestionInsights,insightQuery}=await import('./insights-store.mjs');
  let generation=1,reads=0;
  const question={id:'eli/dl/doc/E-10-2026-000001',identifier:'E-10-2026-000001',work_type:'def/ep-document-types/QUESTION_WRITTEN',document_date:'2026-06-16',inverse_answers_to:[{identifier:'E-10-2026-000001-ASW',document_date:'2026-06-20'}],title_dcterms:{en:'Digital safeguards'},creator:['person/124846']};
  const store={clock:()=>Date.now(),get:()=>null,readSnapshot:fn=>fn(),status:()=>({currentMeps:1,servingGeneration:generation,complete:false,sourceCounts:{document:1}}),db:{prepare(sql){
    if(sql.includes('FROM group_history_snapshots'))return {get(g){reads++;assert.equal(g,1);return {body:JSON.stringify({members})};}};
    if(sql.includes('FROM refresh_gaps'))return {all:()=>[]};
    if(sql.startsWith("SELECT json_extract(body,'$.work_type')"))return {all:()=>[{subtype:question.work_type,date:question.document_date,fetchedAt:'2026-10-23T10:00:00Z'}]};
    if(sql.startsWith('SELECT COUNT'))return {get:()=>({n:1})};
    if(sql.startsWith('SELECT key,body'))return {all:()=>[{key:'/parliamentary-questions/'+question.identifier,body:JSON.stringify(question),fetched_at:'2026-10-23T10:00:00Z'}]};
    if(sql.startsWith('SELECT id,body'))return {all:()=>[{id:'124846',body:JSON.stringify({name:'Pina Picierno',groupCode:'Renew'})}]};
    assert.fail(sql);
  }}};
  const clock=()=>Date.parse('2026-10-23T12:00:00Z');
  const service=new QuestionInsights(store,{clock,loadMetadata:async()=>{generation=2;return new Map();},loadQuestionBodies:async()=>new Map()});
  const response=await service.query(insightQuery(new URLSearchParams('days=term&end=2026-06-16'),{now:clock()}));
  assert.equal(response.coverage.servingGeneration,1);assert.equal(response.questions[0].authors[0].affiliationGroup,'S&D');assert.equal(response.questions[0].authors[0].group,'Renew');assert.equal(reads,1);
  assert.equal(response.selectedStats.groupContributions.rows[0].label,'S&D');
  assert.equal(response.selectedStats.groupContributions.rows[0].answered,1);
  assert.equal(response.selectedStats.groupContributions.rows[0].medianAnswerDays,4);
  const captured=service.cache.values().next().value.value;service.analysis=async()=>captured;
  const query=insightQuery(new URLSearchParams('days=term&end=2026-06-16'),{now:clock()});
  assert.equal((await service.query({...query,group:'Renew'})).counts.selectedQuestions,0);
  const oldGroup=await service.query({...query,group:'S&D'});assert.equal(oldGroup.counts.selectedQuestions,1);assert.equal(oldGroup.selectedStats.groupContributions.rows[0].answered,1);
});

test('a prepublication read does not pin missing history after the same generation is frozen',()=>{
  let body=null,reads=0;
  const store={db:{prepare:()=>({get:()=>{reads++;return body?{body}:undefined;}})}};
  assert.equal(generationGroupOn(store,1)('124846','2026-06-16'),'unavailable');
  body=JSON.stringify({members});
  const published=generationGroupOn(store,1);
  assert.equal(published('124846','2026-06-16').code,'S&D');
  assert.equal(generationGroupOn(store,1),published);assert.equal(reads,2);
});
