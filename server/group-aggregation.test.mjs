import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroupOn,generationGroupOn} from './group-attribution.mjs';
import {groupContributions,questionGroupMetrics,activityAffiliation} from './group-aggregation.mjs';
import {namedVote,finalVotePatterns} from './insights-legislation-model.mjs';
import {participationRows} from './insights-participation.mjs';
const interval=(code,start,end=null)=>({code,start,end,org:'org/'+code,groupId:'group/'+code});
const person=groups=>({coverage:'complete',mandateCoverage:'complete',mandates:[{start:'2024-07-16',end:null}],groups});
const snapshot={members:{124846:person([interval('S&D','2024-07-16','2026-06-16'),interval('Renew','2026-06-17')]),256852:person([interval('PfE','2024-07-16','2026-02-03'),interval('NI','2026-02-04','2026-06-16'),interval('ECR','2026-06-17')])}};
const resolve=createGroupOn(snapshot);
const question=(id,date,answers=[],answersObserved=true)=>({id,date,authors:[{id:'124846'}],answers,answersObserved});
test('tabling before switch and answering after preserves group for counts, status, times, filters and answer rows',()=>{
  const q=question('Q','2026-06-16',[{date:'2026-06-20'}]);
  const metrics=questionGroupMetrics([q],resolve);
  assert.deepEqual(metrics.rows,[{label:'S&D',count:1,answered:1,unanswered:0,answerStatusUnavailable:0,answeredShare:1,answerTimeObservations:1,medianAnswerDays:4,meanAnswerDays:4}]);
  assert.equal(questionGroupMetrics([q],resolve,(p,q)=>resolve(p.id,q.date).code==='Renew').total,0);
  assert.deepEqual(activityAffiliation({mepId:'124846',recordKind:'answer',date:'2026-06-20'},{document_date:'2026-06-16'},resolve,'Renew'),{affiliationDate:'2026-06-16',contributionGroup:'S&D',affiliationGroup:'S&D'});
  assert.deepEqual(activityAffiliation({mepId:'124846',recordKind:'answer',date:'2026-06-20'},null,resolve,'Renew'),{affiliationDate:null,contributionGroup:null,affiliationGroup:'Renew'});
});
test('cross-switch author totals are contribution counts, with unknown status and elapsed dates kept unavailable',()=>{
  const result=questionGroupMetrics([question('a','2026-06-16'),question('b','2026-06-17',[{date:null}]),question('c','2026-06-18',[],false),question('d',null,[{date:'2026-06-20'}])],resolve);
  assert.equal(result.total,4);assert.equal(result.unavailable,1);assert.equal(result.rows.reduce((sum,r)=>sum+r.count,0),3);
  const old=result.rows.find(r=>r.label==='S&D'),current=result.rows.find(r=>r.label==='Renew');
  assert.equal(old.unanswered,1);assert.equal(current.answered,1);assert.equal(current.answerTimeObservations,0);assert.equal(current.meanAnswerDays,null);assert.equal(current.answerStatusUnavailable,1);
});
test('Bartůšek contributions traverse all three groups without deduplicating people across a period',()=>{
  const stats=groupContributions(['2026-02-03','2026-02-04','2026-06-17'].map(date=>({id:'256852',date})),resolve);
  assert.deepEqual(stats.rows.map(r=>r.label).sort(),['ECR','NI','PfE']);assert.equal(stats.total,3);assert.equal(stats.unavailable,0);
});
test('missing, invalid, ambiguous, unknown and not-serving dates are excluded without roster substitution',()=>{
  const dates=[null,'','2026-02-30','2024-07-15'];
  assert.equal(groupContributions(dates.map(date=>({id:'124846',date})),resolve).unavailable,4);
  for(const reason of ['ambiguous','unavailable','not-serving'])assert.deepEqual(groupContributions([{id:'124846',date:'2026-06-16'}],()=>reason).rows,[]);
});
test('generation-bound contributions retain captured history after a new publication',()=>{
  const store={db:{prepare:()=>({get:g=>({body:JSON.stringify(g===1?snapshot:{members:{124846:person([interval('NI','2024-07-16')])}})})})}};
  const first=generationGroupOn(store,1),second=generationGroupOn(store,2),rows=[{id:'124846',date:'2026-06-16'}];
  assert.equal(groupContributions(rows,first).rows[0].label,'S&D');assert.equal(groupContributions(rows,second).rows[0].label,'NI');
});
test('named votes and final patterns split a switcher by vote date, with exact contribution totals',()=>{
  const roster=new Map([['124846',{name:'Pina Picierno',groupCode:'Renew'}]]),metadata=new Map();
  const make=(date,position)=>namedVote({activity_id:date,activity_date:date,referenceText:{en:'Motion for a resolution (as a whole)'},had_voter_favor:position==='for'?['person/124846']:[],had_voter_against:position==='against'?['person/124846']:[],had_voter_abstention:[]},{url:'https://data.europarl.europa.eu/api/v2/test'},roster,metadata,date,resolve);
  const before=make('2026-06-16','for'),after=make('2026-06-17','against');
  assert.equal(before.groups.for[0].contributionGroup,'S&D');assert.equal(before.politicalGroups[0].code,'S&D');assert.equal(after.groups.against[0].contributionGroup,'Renew');
  const patterns=finalVotePatterns([before,after],roster,metadata,resolve);
  assert.equal(patterns.uniqueNamedPeople,1);assert.equal(patterns.groupContributions.total,2);assert.equal(patterns.groups.mixed.length,0);
  assert.equal(patterns.groups.for[0].contributionGroup,'S&D');assert.equal(patterns.groups.against[0].contributionGroup,'Renew');
});
test('participation groups use actual speech dates rather than the agenda topic date',()=>{
  const topics=[{id:'topic',uri:'eli/dl/event/topic',date:'2026-06-20'}];
  const rows=participationRows(topics,null,null,new Map([['topic',[{mepId:'124846',speechKind:'PLENARY_DEBATE_SPEECH',date:'2026-06-16'},{mepId:'124846',speechKind:'PLENARY_DEBATE_SPEECH',date:'2026-06-17'}]]]),new Set(['124846']),resolve);
  assert.equal(rows[0].speakerIds.size,1);assert.equal(rows[0].groupContributions.speakers.total,2);assert.deepEqual(rows[0].groupContributions.speakers.rows.map(r=>r.label).sort(),['Renew','S&D']);
});
test('persisted answer activity uses the linked question tabling date on reads, including old item bodies',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {ActivityStore}=await import('./activity-index-store.mjs');const {documentRows}=await import('./activity-index-model.mjs');
  const directory=mkdtempSync(join(tmpdir(),'group-aggregation-')),store=new ActivityStore(directory,{clock:()=>Date.parse('2026-10-23T12:00:00Z')});
  try {
    store.acquire();const {generation}=store.beginCycle();store.setMembers([{id:'124846',name:'Pina Picierno',groupCode:'Renew'}]);
    const work={id:'eli/dl/doc/E-10-2026-000001',identifier:'E-10-2026-000001',parliamentary_term:'org/ep-10',work_type:'def/ep-document-types/QUESTION_WRITTEN',document_date:'2026-06-16',creator:['person/124846'],title_dcterms:{en:'Test question'},inverse_answers_to:[{id:'eli/dl/doc/E-10-2026-000001-ASW',identifier:'E-10-2026-000001-ASW',document_date:'2026-06-20'}]};
    const key='/parliamentary-questions/'+work.identifier,fetchedAt='2026-10-23T10:00:00Z';
    store.putSource(generation,key,'document',work,fetchedAt,documentRows(work,key,fetchedAt).rows);store.publish(generation);
    store.db.prepare('UPDATE group_history_snapshots SET body=? WHERE generation=?').run(JSON.stringify(snapshot),generation);
    const page=store.page('124846',{sourceId:work.identifier+'-ASW'}),answer=page.selectedItems[0];
    assert.equal(answer.date,'2026-06-20');assert.equal(answer.affiliationDate,'2026-06-16');assert.equal(answer.affiliationGroup,'S&D');assert.equal(answer.contributionGroup,'S&D');
    assert.equal(page.items[0].affiliationGroup,'S&D');assert.equal(page.member.groupCode,'Renew');
    store.db.prepare('UPDATE sources SET body=? WHERE generation=? AND key=?').run(JSON.stringify({...work,document_date:null}),generation,key);
    const missing=store.page('124846',{sourceId:work.identifier+'-ASW'}).selectedItems[0];
    assert.equal(missing.date,'2026-06-20');assert.equal(missing.affiliationGroup,'Renew');assert.equal(missing.contributionGroup,null);assert.equal(missing.affiliationDate,null);
    const {QuestionInsights,insightQuery}=await import('./insights-store.mjs');
    const service=new QuestionInsights(store,{clock:()=>Date.parse('2026-10-23T12:00:00Z'),loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()});
    const undated=await service.query(insightQuery(new URLSearchParams('days=term'),{now:Date.parse('2026-10-23T12:00:00Z')}));
    assert.equal(undated.coverage.undatedQuestions,1);assert.equal(undated.questions.length,0);assert.equal(undated.selectedStats.groupContributions.total,0);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
test('question country and dated-group filters must match the same coauthor, including facets and metrics',async()=>{
  const {QuestionInsights,insightQuery}=await import('./insights-store.mjs');
  const work={id:'eli/dl/doc/E-10-2026-000001',identifier:'E-10-2026-000001',document_date:'2026-06-16',work_type:'def/ep-document-types/QUESTION_WRITTEN',title_dcterms:{en:'Digital safeguards'},creator:['person/124846','person/256852'],inverse_answers_to:[{identifier:'E-10-2026-000001-ASW',document_date:'2026-06-20'}]};
  const roster=[['124846',{name:'Pina Picierno',groupCode:'Renew',countryCode:'FR'}],['256852',{name:'Other coauthor',groupCode:'ECR',countryCode:'DE'}]];
  const store={clock:()=>Date.parse('2026-10-23T12:00:00Z'),get:()=>null,readSnapshot:fn=>fn(),status:()=>({currentMeps:2,servingGeneration:1,complete:true,sourceCounts:{document:1}}),db:{prepare(sql){
    if(sql.includes('FROM refresh_gaps'))return {all:()=>[]};
    if(sql.startsWith("SELECT json_extract(body,'$.work_type')"))return {all:()=>[{subtype:work.work_type,date:work.document_date,fetchedAt:'2026-10-23T10:00:00Z'}]};
    if(sql.includes('group_history_snapshots'))return {get:()=>({body:JSON.stringify(snapshot)})};
    if(sql.startsWith('SELECT COUNT'))return {get:(...args)=>({n:args.length===1?0:1})};
    if(sql.startsWith('SELECT key,body'))return {all:()=>[{key:'/parliamentary-questions/'+work.identifier,body:JSON.stringify(work),fetched_at:'2026-10-23T10:00:00Z'}]};
    if(sql.startsWith('SELECT id,body'))return {all:()=>roster.map(([id,body])=>({id,body:JSON.stringify(body)}))};
    assert.fail(sql);
  }}};
  const clock=()=>Date.parse('2026-10-23T12:00:00Z'),service=new QuestionInsights(store,{clock,loadMetadata:async()=>new Map(),loadQuestionBodies:async()=>new Map()});
  const query=insightQuery(new URLSearchParams('days=term&group=S%26D&country=DE'),{now:clock()});
  const wrongCountry=await service.query(query);assert.equal(wrongCountry.counts.selectedQuestions,0);assert.equal(wrongCountry.selectedStats.groupContributions.total,0);
  const france=wrongCountry.facets.countries.find(r=>r.code==='FR'),germany=wrongCountry.facets.countries.find(r=>r.code==='DE');
  assert.deepEqual(france,{code:'FR',count:1,authors:1});assert.deepEqual(germany,{code:'DE',count:0,authors:0});
  assert.equal(wrongCountry.geography.countries.find(r=>r.code==='DE').questionCount,0);
  const match=await service.query({...query,country:'FR'});assert.equal(match.counts.selectedQuestions,1);assert.equal(match.selectedStats.groupContributions.total,1);assert.equal(match.selectedStats.groupContributions.rows[0].label,'S&D');assert.equal(match.selectedStats.groupContributions.rows[0].medianAnswerDays,4);
});
