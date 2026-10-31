import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemberVoteExplanations,memberVoteExplanationsQuery} from './member-vote-explanations.mjs';
import {explanationVoteContext,matchVoteExplanation} from './member-vote-explanations-model.mjs';
import {apiCachePolicy} from './response-cache.mjs';
import {MemberVotes,memberVotesQuery} from './member-votes.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/vote-explanations.json',import.meta.url)));
const rows=key=>structuredClone(fixture[key].rows.map(row=>row.record));
const SITTING='MTG-PL-2026-03-26',MEMBER='197655',FINAL=SITTING+'-DEC-189210',SNAPSHOT='a'.repeat(64);
const source=key=>({url:fixture[key].url,fetchedAt:fixture[key].fetchedAt,contentHash:fixture[key].originalResponseHash});
function dayFixture() {
  const named=new Map(rows('named').map(row=>[row.id,row]));
  return {sittingId:SITTING,date:'2026-03-26',decisions:rows('decisions').map(row=>({...row,...named.get(row.id)})),results:rows('results'),agenda:rows('agenda'),
    sources:{decisions:[source('decisions'),source('named')],results:[source('results')],agenda:[source('agenda')]},coverage:{decisions:{state:'complete'},agenda:{state:'complete'},results:{state:'complete'},completeness:{missingResultIds:[],unresolvedAgendaItemIds:[],invalidSourceIds:[]}}};
}
function setup({day=dayFixture(),speeches=rows('speeches').filter(row=>row.had_participation.had_participant_person.includes('person/'+MEMBER)),override,limits={}}={}) {
  const calls=[],snapshot={id:SNAPSHOT,days:[day]};let expired=false;
  const votes={snapshot:async query=>{assert.equal(query.snapshot,SNAPSHOT);if(expired)throw Object.assign(new Error('Expired'),{status:409,code:'vote_snapshot_unavailable'});return snapshot;}};
  const request=async(endpoint,params={})=>{
    calls.push({endpoint,params});const change=await override?.(endpoint,params);if(change)return change;
    let data,key;
    if(endpoint==='/speeches'){data=speeches.slice(params.offset,params.offset+params.limit);key='speeches';}
    else {key=['parent9-2','parent9-3','parent4'].find(key=>endpoint==='/events/'+rows(key)[0].activity_id);assert(key,endpoint);data=rows(key);}
    return {url:fixture[key].url,fetchedAt:fixture[key].fetchedAt,payload:{data,...(key==='speeches'?{meta:{total:speeches.length}}:{})}};
  };
  return {service:new MemberVoteExplanations({request,votes,limits}),calls,day,expire:()=>{expired=true;}};
}
const query=(decision=FINAL)=>({sitting:SITTING,week:null,decision,snapshot:SNAPSHOT,language:'en'});

test('real public report → agenda → result joins keep explanations subject-scoped and anchor the unique final',async()=>{
  const {service,day}=setup();const result=await service.query(MEMBER,query());
  assert.equal(result.items.length,1);assert.equal(result.items[0].id,SITTING+'-OTH-2017069542706');
  assert.equal(result.items[0].matchScope,'subject');assert.equal(result.presentationAnchorDecisionId,FINAL);
  assert.deepEqual(result.items[0].documentIds,['A-10-2026-0045']);
  assert(result.items[0].relationships.every(edge=>edge.from.startsWith('https://data.europarl.europa.eu/')&&edge.to.startsWith('https://data.europarl.europa.eu/')));
  assert(result.items[0].sources.every(source=>source.url&&source.fetchedAt&&/^[a-f0-9]{64}$/.test(source.contentHash)));
  assert.equal(result.items[0].classification.basis,'speech-header-and-explanation-chapter');
  assert.deepEqual(result.written,{status:'unsupported',count:null});
  const sibling=day.decisions.find(row=>row.activity_id!==FINAL&&row.inverse_consists_of.includes('eli/dl/event/'+result.subjectId));
  const other=await service.query(MEMBER,query(sibling.activity_id));
  assert.equal(other.items[0].id,result.items[0].id);assert.equal(other.presentationAnchorDecisionId,FINAL);
  const textAsWhole=day.decisions.find(row=>row.referenceText?.en==='Text as a whole');
  const textResult=await service.query(MEMBER,query(textAsWhole.activity_id));
  assert.equal(textResult.items[0].id,SITTING+'-OTH-2017069542700');assert.equal(textResult.presentationAnchorDecisionId,null,'the published whole-text ballot lapsed');
  textAsWhole.decision_outcome='def/ep-statuses/ADOPTED';textAsWhole.type='Vote';
  assert.equal(explanationVoteContext(day,MEMBER,textAsWhole.activity_id).anchor,textAsWhole.activity_id,'a conducted Text as a whole is supported');
});

test('explanation chapters do not turn chair remarks, headerless unknowns or written debate statements into explanations',()=>{
  const day=dayFixture(),context=explanationVoteContext(day,MEMBER,FINAL),parent=rows('parent9-3')[0];
  const own=rows('speeches').find(row=>row.activity_id.endsWith('2706'));
  const chair=rows('speeches').find(row=>row.activity_id.endsWith('2699'));
  assert.equal(matchVoteExplanation(chair,rows('parent9-2')[0],day,explanationVoteContext(day,'257113',SITTING+'-DEC-189234'),'257113').item,null);
  const unknown=structuredClone(own);unknown.activity_id=SITTING+'-OTH-999';unknown.id='eli/dl/event/'+unknown.activity_id;unknown.recorded_in_a_realization_of=[];
  const amendedParent={...parent,consists_of:[unknown.id]};
  assert.equal(matchVoteExplanation(unknown,amendedParent,day,context,MEMBER).gap,'classification-unavailable');
  const written=rows('speeches').find(row=>row.had_activity_type.endsWith('WRITTEN_STATEMENT'));
  assert.equal(matchVoteExplanation(written,rows('parent4')[0],day,context,MEMBER).item,null);
});

test('titles and partial intersections cannot repair foreign, contradictory or multiple identities',()=>{
  const mutations=[
    (a,p,d)=>a.id='https://example.invalid/eli/dl/event/'+a.activity_id,
    a=>a.had_participation.had_participant_person=['person/42'],
    a=>a.inverse_consists_of.push('eli/dl/event/'+SITTING+'-PVCRE-ITM-9-2'),
    (a,p)=>p.consists_of=[],
    (a,p)=>p.based_on_a_realization_of.push('eli/dl/doc/A-10-2026-9999'),
    (a,p,d)=>d.agenda.push({...d.agenda.find(row=>row.had_activity_type.endsWith('PLENARY_VOTE')&&row.based_on_a_realization_of.includes('eli/dl/doc/A-10-2026-0045')),id:'eli/dl/event/'+SITTING+'-OJ-ITM-V-999',activity_id:SITTING+'-OJ-ITM-V-999'}),
    (a,p,d)=>d.results.find(row=>row.consists_of.includes('eli/dl/event/'+FINAL)).executed.push('eli/dl/event/'+SITTING+'-OJ-ITM-V-999'),
    (a,p,d)=>d.results.find(row=>row.consists_of.includes('eli/dl/event/'+FINAL)).based_on_a_realization_of=['eli/dl/doc/A-10-2026-9999'],
  ];
  for(const mutate of mutations){const day=dayFixture(),a=rows('speeches').find(row=>row.activity_id.endsWith('2706')),parent=rows('parent9-3')[0];mutate(a,parent,day);
    const result=matchVoteExplanation(a,parent,day,explanationVoteContext(day,MEMBER,FINAL),MEMBER);assert.equal(result.item,null,String(mutate));}
});

test('a final anchor needs all declared children and a unique conducted whole-text ballot',()=>{
  for(const mutate of [
    day=>day.coverage.decisions.state='partial',
    day=>day.decisions=day.decisions.filter(row=>!row.activity_id.endsWith('DEC-189209')),
    day=>{const final=day.decisions.find(row=>row.activity_id===FINAL);final.decision_outcome='def/ep-statuses/LAPSED';},
    day=>{const final=day.decisions.find(row=>row.activity_id===FINAL);final.decided_on_a_realization_of=['eli/dl/doc/A-10-2026-0045-AM-1'];},
    day=>{const final=day.decisions.find(row=>row.activity_id===FINAL);final.decided_on_a_realization_of=['https://example.invalid/eli/dl/doc/A-10-2026-0045-AM-1'];},
    day=>{const final=day.decisions.find(row=>row.activity_id===FINAL),copy={...structuredClone(final),id:'eli/dl/event/'+SITTING+'-DEC-999',activity_id:SITTING+'-DEC-999'};day.decisions.push(copy);day.results.find(row=>row.consists_of.includes(final.id)).consists_of.push(copy.id);},
  ]) {const day=dayFixture();mutate(day);assert.equal(explanationVoteContext(day,MEMBER,FINAL).anchor,null,String(mutate));}
  const day=dayFixture(),final=day.decisions.find(row=>row.activity_id===FINAL);
  final.decision_method='def/ep-vote-methods/VOTE_HAND';for(const key of Object.keys(final))if(key.startsWith('had_voter_'))delete final[key];
  assert.equal(explanationVoteContext(day,MEMBER,FINAL).anchor,FINAL,'non-named final remains an anchor without inventing a position');
});

test('bounded reads preserve successful explanations and expose source and parent limits',async()=>{
  for(const limits of [{pages:1,pageSize:1},{parents:1},{totalBytes:1}]){
    const {service}=setup({limits});const result=await service.query(MEMBER,query());assert.equal(result.coverage.status,'partial');assert.equal(result.coverage.searchComplete,false);
  }
  const {service}=setup({override:(endpoint)=>{if(endpoint.endsWith('9-2'))throw new Error('Unavailable');}});
  const result=await service.query(MEMBER,query());assert.equal(result.items.length,1);assert.equal(result.coverage.status,'partial');
  const empty=setup({speeches:[]});assert.equal((await empty.service.query(MEMBER,query())).coverage.searchComplete,true);
});

test('disjoint explanation chapters do not make this text partial, but unknown document scope does',async()=>{
  for(const fault of ['headerless','transcript-conflict','agenda-unresolved','missing-documents','conflicting-documents']) {
    const activity=rows('speeches').find(row=>row.activity_id.endsWith('2700')),parent=rows('parent9-2')[0];
    if(fault==='headerless')activity.recorded_in_a_realization_of=[];
    if(fault==='transcript-conflict')activity.recorded_in_a_realization_of[0].identifier='CRE-10-2026-03-26-OTH-999';
    if(fault==='agenda-unresolved')parent.based_on_a_realization_of=['eli/dl/doc/A-10-2026-9999'];
    if(fault==='missing-documents')parent.based_on_a_realization_of=[];
    if(fault==='conflicting-documents')parent.based_on_a_realization_of=[{id:'eli/dl/doc/A-10-2026-9999',identifier:'A-10-2026-0045'}];
    const response=await setup({speeches:[activity],override:endpoint=>endpoint.endsWith(parent.activity_id)?{url:fixture['parent9-2'].url,fetchedAt:fixture['parent9-2'].fetchedAt,payload:{data:[parent]}}:null}).service.query(MEMBER,query());
    const unknown=fault.endsWith('documents');
    assert.deepEqual(response.items,[],fault);
    assert.equal(response.coverage.searchComplete,!unknown,fault);
    assert.equal(response.coverage.status,unknown?'partial':'searched',fault);
    if(unknown)assert(response.coverage.gaps.some(gap=>gap.code==='explanation-document-unavailable'));
    else assert.deepEqual(response.coverage.gaps,[],fault);
  }
});

test('the default chapter budget reaches a 24th chapter and keeps an unread 25th explicit',async()=>{
  for(const count of [24,25]) {
    const own=rows('speeches').find(row=>row.activity_id.endsWith('2706')),parent=rows('parent9-3')[0],chapters=new Map();
    const speeches=Array.from({length:count-1},(_,index)=>{
      const chapterId=SITTING+'-PVCRE-ITM-'+(100+index),speechId=SITTING+'-OTH-'+(9000+index);
      const activity={...structuredClone(own),id:'eli/dl/event/'+speechId,activity_id:speechId,inverse_consists_of:['eli/dl/event/'+chapterId]};
      chapters.set(chapterId,{...structuredClone(parent),id:'eli/dl/event/'+chapterId,activity_id:chapterId,had_activity_type:'def/ep-activities/PLENARY_DEBATE',consists_of:[activity.id]});
      return activity;
    });
    speeches.push(own);chapters.set(parent.activity_id,parent);
    const {service,calls}=setup({speeches,override:endpoint=>{
      const chapter=chapters.get(endpoint.slice('/events/'.length));
      return chapter?{url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:fixture['parent9-3'].fetchedAt,payload:{data:[chapter]}}:null;
    }});
    const response=await service.query(MEMBER,query());
    assert.equal(calls.filter(call=>call.endpoint.startsWith('/events/')).length,24);
    assert.equal(response.items.length,count===24?1:0);
    assert.equal(response.coverage.searchComplete,count===24);
    assert.equal(response.coverage.gaps.some(gap=>gap.code==='parent-read-limit'),count===25);
  }
});

test('snapshot validation precedes every response, rejects unknown decisions and never collects a replacement',async()=>{
  const {service,calls,expire}=setup();await service.query(MEMBER,query());const count=calls.length;expire();
  await assert.rejects(service.query(MEMBER,query()),error=>error.code==='vote_snapshot_unavailable');assert.equal(calls.length,count);
  const missing=setup();await assert.rejects(missing.service.query(MEMBER,query(SITTING+'-DEC-999')),error=>error.status===404);assert.equal(missing.calls.length,0);
  await assert.rejects(service.query(MEMBER,{...query(),snapshot:null}),error=>error.status===400);
});

test('query validation requires an exact pinned vote and explanation responses are never publicly cached',()=>{
  const search=new URLSearchParams({sitting:SITTING,snapshot:SNAPSHOT,decision:FINAL});
  assert.equal(memberVoteExplanationsQuery(search).decision,FINAL);
  for(const patch of [{snapshot:''},{decision:''},{url:'https://example.invalid'},{limit:'1'}])assert.throws(()=>memberVoteExplanationsQuery(new URLSearchParams({...Object.fromEntries(search),...patch})),error=>error.status===400);
  const repeated=new URLSearchParams(search);repeated.append('decision',FINAL);assert.throws(()=>memberVoteExplanationsQuery(repeated));
  assert.deepEqual(apiCachePolicy({method:'GET',headers:{}},new URL('https://example.test/api/member-vote-explanations/'+MEMBER),{items:[]}),{cacheControl:'no-store',cdnCacheControl:'no-store'});
});

test('normal paging cannot erase missing-result or invalid-agenda graph uncertainty',async()=>{
  for(const [field,id] of [['missingResultIds',SITTING+'-VOT-ITM-999999'],['invalidSourceIds',SITTING+'-OJ-ITM-V-999']]) {
    const day=dayFixture();day.coverage.completeness[field]=[id];
    const {service,calls}=setup({day}),response=await service.query(MEMBER,query());
    assert.deepEqual(response.items,[]);assert.equal(response.presentationAnchorDecisionId,null);assert.equal(response.coverage.searchComplete,false);
    assert(response.coverage.gaps.some(gap=>gap.field===field));assert.equal(calls.length,0,'an incomplete pinned graph cannot be repaired by unrelated speech reads');
  }
});

test('missing, malformed and matching document identities cannot exclude a result whose agenda is unresolved',async()=>{
  for(const documents of [undefined,[],['eli/dl/doc/A-10-2026-0045'],[{id:'eli/dl/doc/A-10-2026-0045',identifier:'A-10-2026-9999'}]]) {
    const day=dayFixture(),result=day.results.find(row=>row.consists_of.includes('eli/dl/event/'+FINAL));
    const other={...structuredClone(result),id:'eli/dl/event/'+SITTING+'-VOT-ITM-999',activity_id:SITTING+'-VOT-ITM-999',consists_of:[],executed:['eli/dl/event/'+SITTING+'-OJ-ITM-V-999']};
    if(documents===undefined)delete other.based_on_a_realization_of;else other.based_on_a_realization_of=documents;
    day.results.push(other);day.coverage.completeness.unresolvedAgendaItemIds=other.executed;
    const response=await setup({day}).service.query(MEMBER,query());
    assert.deepEqual(response.items,[],JSON.stringify(documents));assert.equal(response.coverage.searchComplete,false);
    assert.equal(response.presentationAnchorDecisionId,null);
    assert.deepEqual(response.voteGraphGaps,day.coverage.completeness.unresolvedAgendaItemIds);
  }
  const day=dayFixture(),result=day.results.find(row=>row.consists_of.includes('eli/dl/event/'+FINAL));
  day.results.push({...structuredClone(result),id:'eli/dl/event/'+SITTING+'-VOT-ITM-999',activity_id:SITTING+'-VOT-ITM-999',consists_of:[],executed:['eli/dl/event/'+SITTING+'-OJ-ITM-V-999'],based_on_a_realization_of:['eli/dl/doc/A-10-2026-9999']});
  day.coverage.completeness.unresolvedAgendaItemIds=['eli/dl/event/'+SITTING+'-OJ-ITM-V-999'];
  assert.equal((await setup({day}).service.query(MEMBER,query())).items.length,1,'a verified other document can exclude an unrelated missing agenda');
});

test('transcript IDs, speech notation and chapter containment must agree before classification or source linking',()=>{
  for(const mutate of [
    doc=>doc.identifier='CRE-10-2026-03-26-OTH-2017069542700',
    doc=>doc.id='https://example.invalid/eli/dl/doc/CRE-10-2026-03-26-OTH-2017069542706',
    doc=>doc.notation_speechId='2017069542700',
    doc=>doc.is_part_of='eli/dl/doc/CRE-10-2026-03-26-ITM-009-02',
    doc=>{doc.id='eli/dl/doc/CRE-9-2026-03-26-OTH-2017069542706';doc.identifier='CRE-9-2026-03-26-OTH-2017069542706';},
  ]) {
    const day=dayFixture(),activity=rows('speeches').find(row=>row.activity_id.endsWith('2706')),parent=rows('parent9-3')[0];
    mutate(activity.recorded_in_a_realization_of[0]);
    const match=matchVoteExplanation(activity,parent,day,explanationVoteContext(day,MEMBER,FINAL),MEMBER);
    assert.equal(match.item,null,String(mutate));assert.equal(match.gap,'explanation-transcript-conflict');
  }
});

test('the real vote collector propagates missing declared results and inconsistent competing agenda identities',async()=>{
  for(const fault of [null,'missing-result','invalid-agenda','identifier-conflict']) {
    const day=dayFixture(),result=day.results.find(row=>row.consists_of.includes('eli/dl/event/'+FINAL));
    const decisions=day.decisions.filter(row=>result.consists_of.includes(row.id));
    const agenda=day.agenda.filter(row=>result.executed.includes(row.id));
    const meeting={id:'eli/dl/event/'+SITTING,activity_id:SITTING,activity_date:day.date,had_activity_type:'def/ep-activities/PLENARY_SITTING',consists_of:[result.id]};
    for(const parent of result.inverse_consists_of||[])if(typeof parent==='object'&&parent.id===meeting.id)parent.consists_of=[result.id];
    if(fault==='missing-result')meeting.consists_of.push('eli/dl/event/'+SITTING+'-VOT-ITM-999999');
    if(fault==='invalid-agenda')agenda.push({...structuredClone(agenda[0]),id:'eli/dl/event/'+SITTING+'-OJ-ITM-V-999',activity_id:SITTING+'-OJ-ITM-V-998'});
    if(fault==='identifier-conflict')agenda.push({...structuredClone(agenda[0]),id:'eli/dl/event/'+SITTING+'-OJ-ITM-V-999',activity_id:SITTING+'-OJ-ITM-V-999',identifier:SITTING+'-OJ-ITM-V-998'});
    const request=async(endpoint,params={})=>({url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.now(),payload:{data:
      (endpoint==='/meetings/'+SITTING?[meeting]:endpoint.endsWith('/decisions')?decisions:endpoint.endsWith('/vote-results')?[result]:agenda).slice(params.offset||0,(params.offset||0)+(params.limit||10000))}});
    const votes=new MemberVotes({readChairs:async()=>null,request}),q=memberVotesQuery(new URLSearchParams({sitting:SITTING,decision:FINAL})),snapshot=await votes.snapshot(q);
    assert.equal(snapshot.days[0].coverage.state,fault==='missing-result'?'partial':'complete');
    assert.equal(snapshot.days[0].coverage.completeness.votingRecordsComplete,fault!=='missing-result');
    assert.equal(snapshot.days[0].coverage.completeness.complete,!['missing-result','invalid-agenda'].includes(fault));
    let speechReads=0;
    const explanations=new MemberVoteExplanations({votes,request:async endpoint=>{speechReads++;return {url:'https://data.europarl.europa.eu/api/v2'+endpoint,fetchedAt:Date.now(),payload:{data:endpoint==='/speeches'?[rows('speeches').find(row=>row.activity_id.endsWith('2706'))]:rows('parent9-3'),...(endpoint==='/speeches'?{meta:{total:1}}:{})}};}});
    const response=await explanations.query(MEMBER,{...q,snapshot:snapshot.id});
    assert.equal(response.items.length,fault?0:1);
    assert.equal(response.coverage.searchComplete,!fault);
    if(fault){assert.equal(speechReads,0);assert.equal(response.presentationAnchorDecisionId,null);assert(response.coverage.gaps.some(gap=>['vote-graph-incomplete','vote-identity-conflict'].includes(gap.code)));}
  }
});
