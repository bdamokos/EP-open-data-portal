import {memberVotes,memberVotesQuery} from './member-votes.mjs';
import {inLanguage,projectMemberDecision,voteRowFields,voterGroups} from './member-votes-model.mjs';
import {createGroupOn} from './group-attribution.mjs';
import {groupHistorySnapshot} from './group-history.mjs';
import {HttpError} from './http-utils.mjs';
import {requestSignal} from './request-budget.mjs';
import {list,exactReference,references,identifier,decisionOnSubject,deriveVoteEvidence,eventUri,preferred} from './vote-evidence.mjs';
import {decisionVoteBindingConflict} from './decision-vote-binding.mjs';
import {mainVote} from './main-vote.mjs';
import {referredForTalksOn} from './procedure-referral.mjs';
import {odp} from './odp.mjs';
import {cachedEvent} from './insights-participation.mjs';

export const DECISION_VOTES_VERSION=8;

export function decisionVotesQuery(id,search,options) {
  if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-DEC-\d+$/.test(id))throw new HttpError(400,'invalid_decision','Use an exact decision identifier.');
  for(const key of search.keys())if(!['lang','snapshot'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated decision-vote parameter.');
  const params=new URLSearchParams(search);
  params.set('sitting',id.slice(0,17));params.set('decision',id);params.set('positions','all');
  return memberVotesQuery(params,options);
}

// Uses the member reader's bounded, shared sitting snapshot; no source writer.
export async function decisionVotes(query,{reader=memberVotes,store=null,readProcedure=retainedProcedure,readEvent=cachedEvent}={}) {
  const snapshot=await reader.snapshot(query),data=projectDecisionVotes(query,snapshot,{store,withSubject:true});
  // Not every voted procedure reaches the index. The retained source record is
  // the one the agenda reads; a miss stays unknown and never goes upstream.
  for(const id of data.subject?.procedureIds||[])if(!data.subject.procedures.some(row=>row.id===id)) {
    const node=await readProcedure(id);requestSignal()?.throwIfAborted();
    if(!node)continue;
    const reference=procedureLabel(node);if(reference)data.subject.procedures.push({id,reference});
    if(referredForTalksOn(node,data.decision.date))data.procedureReferral=true;
    data.subject.debates=mergedDebates([...data.subject.debates,...procedureDebates(node,data.decision.date)]);
  }
  if(data.subject)data.subject.debates=await Promise.all(data.subject.debates.map(debate=>heldDebate(debate,readEvent)));
  requestSignal()?.throwIfAborted();
  return data;
}
// The same test as the agenda's: a held verbatim-report debate of this procedure on or before the vote.
function procedureDebates(node,date) {
  return list(node?.consists_of).filter(event=>String(event?.had_activity_type||'').split('/').at(-1)==='PLENARY_DEBATE'&&typeof event.activity_date==='string'&&event.activity_date<=date&&/^MTG-PL-\d{4}-\d{2}-\d{2}-PVCRE-ITM-\d+$/.test(event.activity_id||'')).map(event=>({id:event.activity_id,date:event.activity_date,start:null,agendaItemId:null}));
}
const mergedDebates=debates=>[...new Map(debates.map(debate=>[debate.id,debate])).values()].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id,undefined,{numeric:true}));
// The procedure's nested event has no time or agenda link. The event's own held record
// has both, through its exact `executed` reference; a miss keeps the date and never goes upstream.
async function heldDebate(debate,readEvent) {
  const node=(await readEvent(debate.id).catch(()=>null))?.payload?.data?.[0];
  if(node?.activity_id!==debate.id)return debate;
  const start=typeof node.activity_start_date==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(node.activity_start_date)?node.activity_start_date:null;
  const items=list(node.executed).map(value=>/^eli\/dl\/event\/(MTG-PL-\d{4}-\d{2}-\d{2}-OJ-ITM-[A-Z0-9-]+)$/.exec(String(value))?.[1]).filter(Boolean);
  return {...debate,start,agendaItemId:items.length===1?items[0]:null};
}
async function retainedProcedure(id) {
  try {
    const record=await odp('/procedures/'+id,{},{cachedOnly:true,ttl:Infinity}),node=record.payload?.data?.[0];
    return node?.id==='eli/dl/proc/'+id?node:null;
  }catch(error){if(error instanceof HttpError&&error.status===404)return null;throw error;}
}
// Members whose dated group history covers the vote, minus its voters. A seat plan is a
// snapshot, so an old vote's count would be wrong from it.
function noRecordMembers(history,groupOn,date,voters) {
  if(!history?.members)return null;
  const voted=new Set(voters.map(voter=>voter.personId)),ids=[],groups=[];
  for(const id of Object.keys(history.members).sort((a,b)=>Number(a)-Number(b))) {
    const group=voted.has(id)?null:groupOn(id,date);
    if(group&&typeof group==='object'){ids.push(id);groups.push(group.code);}
  }
  return {ids,groups};
}
const procedureLabel=node=>typeof node?.label==='string'&&/^\d{4}\/\d{4}[A-Z]?\([A-Z]{2,8}\)$/.test(node.label)?node.label:null;
// Freeze one group-history generation and one evidence graph for the read.
export function decisionVotesContext(day,store,{derived=null,sharedHistory}={}) {
  const generation=store?.status().servingGeneration||null;
  // A caller projecting several days of one request reads the group history once and passes it back.
  const history=sharedHistory!==undefined?sharedHistory:generation?groupHistorySnapshot(store,generation):null;
  return {derived:derived||deriveVoteEvidence(day,{includeBindingEvidence:true}),generation,history,groupOn:createGroupOn(history),decisions:new Map(day.decisions.map(d=>[d.activity_id,d]))};
}
// A held, exact-key read; a procedure outside the index is simply unknown here.
function heldProcedure(store,generation,id) {
  const work=generation?store?.source?.(generation,'/procedures/'+id)?.work:null,node=Array.isArray(work?.data)?work.data[0]:work;
  return node&&typeof node==='object'?node:null;
}
function partFields(part,language) {
  const component=({componentId,number,requestUri,contentByLanguage})=>({componentId,number,requestUri,contentByLanguage:inLanguage(contentByLanguage,language)});
  return {...component(part),requestId:part.requestId,requestScopeByLanguage:inLanguage(part.requestScopeByLanguage,language),contextComponents:part.contextComponents.map(component)};
}
/** Same day, same subject, in source order. Joins by the exact decision-to-result
 * link only; the procedure is read from the held index and never fetched here. */
function subjectContext(vote,day,context,query,store) {
  const bound=row=>['consistent','single-direction'].includes(row.resultRelationship.binding);
  const subject=vote.subjectId&&bound(vote)?context.derived.subjects.find(row=>row.id===vote.subjectId):null;
  if(!subject)return {subject:null,siblings:[],mainVoteId:null,procedureReferral:false};
  const projected=day.decisions.filter(raw=>decisionOnSubject(raw,context.derived.decisions.get(eventUri(raw)),[subject.id])).map(raw=>projectMemberDecision(raw,day,'1',query.language,context.derived));
  const votes=projected.filter(bound);
  // A conflicting record stays among the rows with no result, as on the agenda item, so the count holds.
  const rows=projected.filter(row=>bound(row)||row.sourceConflicts);
  // A partial sitting could hide the deciding vote, so it establishes no main vote.
  const main=day.coverage&&day.coverage.state!=='complete'?null:mainVote(votes,{id:subject.id,wholeTextDecisions:votes.filter(row=>row.scope.kind==='whole-text')});
  const siblings=main?[main,...rows.filter(row=>row!==main)]:rows;
  const procedureIds=[...new Set(votes.flatMap(row=>row.context.procedureIds))].sort();
  const procedures=procedureIds.map(id=>({id,node:heldProcedure(store,context.generation,id)}));
  const procedureReferral=procedures.some(({node})=>referredForTalksOn(node,vote.date));
  return {subject:{id:subject.id,...preferred(subject.titles,query.language),titles:subject.titles,agendaItemIds:subject.agendaItemIds,documentIds:subject.documentIds,procedureIds,procedures:procedures.flatMap(({id,node})=>procedureLabel(node)?[{id,reference:procedureLabel(node)}]:[]),debates:mergedDebates(procedures.flatMap(({node})=>procedureDebates(node,vote.date)))},siblings:siblings.map(row=>voteRowFields(row,query.language)),mainVoteId:main?.id??null,procedureReferral};
}
// Voters and corrections outside the current roster are absent from the client
// directory. Read their held records by exact key; a missing name stays null.
function outsideRoster(store,generation,ids) {
  if(!store?.source||!generation||!ids.length)return {};
  const roster=new Set(store.db.prepare('SELECT id FROM members').all().map(row=>String(row.id))),people={};
  for(const id of ids)if(!roster.has(id)) {
    const member=store.source(generation,'amendment:member:'+id)?.work,profile=store.source(generation,'demographic:profile:'+id)?.work;
    const parts=[member?.givenName,member?.familyName].filter(value=>typeof value==='string'&&value.trim());
    const country=profile?.fields?.['api:country-of-representation']?.[0];
    people[id]={name:parts.length?parts.join(' '):typeof profile?.label==='string'?profile.label:null,country:typeof country==='string'?country:null};
  }
  return people;
}
export function projectDecisionVotes(query,snapshot,{store=null,context=null,withSubject=false}={}) {
  requestSignal()?.throwIfAborted();
  const day=snapshot.days.find(day=>day.sittingId===query.sitting);
  const raw=context?context.decisions.get(query.decision):day?.decisions.find(raw=>raw.activity_id===query.decision);
  const base={version:DECISION_VOTES_VERSION,decisionId:query.decision,sittingId:query.sitting,snapshotId:snapshot.id,coverage:snapshot.coverage.status};
  const noSubject=withSubject?{subject:null,siblings:[],mainVoteId:null,procedureReferral:false,corrections:null,noRecord:null,people:{}}:{};
  if(!raw)return {...base,...noSubject,status:'unavailable',decision:null,voters:[],integrity:'unavailable',groupHistory:null};
  // The shared projection requires a person ID; only its decision-wide fields
  // are used below. Named positions come from voterGroups, not this placeholder.
  context ||= decisionVotesContext(day,store);
  const {generation,history,groupOn}=context;
  const vote=projectMemberDecision(raw,day,'1',query.language,context.derived),actual=voterGroups(raw,'had_voter_');
  const tallyMismatch=vote.namedVoters.available&&['for','against','abstaining'].some(position=>vote.totals[position]!==null&&vote.totals[position]!==vote.namedVoters.counts?.[position]);
  const integrity=vote.sourceConflicts||decisionVoteBindingConflict(vote)?'conflicting':!vote.namedVoters.available?'unavailable':vote.namedVoters.malformedReferences||vote.namedVoters.conflictingPersonIds.length||(tallyMismatch||vote.namedVoters.totalsMatch===false)?'partial':'complete';
  const voters=vote.namedVoters.available&&integrity!=='conflicting'?[...actual.byPerson].sort(([a],[b])=>Number(a)-Number(b)).map(([personId,positions])=>{
    const group=groupOn(personId,vote.date),person=history?.members[personId];
    return {personId,position:positions.length===1?positions[0]:null,status:positions.length===1?'recorded':'conflicting',group:typeof group==='object'?group:null,
      groupStatus:typeof group==='object'?'verified':group,groupSource:person?{url:person.url??null,retrievedAt:person.retrievedAt??null,stale:person.stale??false,membershipIds:(person.groups||[]).filter(period=>period.start<=vote.date&&(!period.end||period.end>=vote.date)).flatMap(period=>period.membershipIds||[])}:null};
  }):[];
  const intended=withSubject?voterGroups(raw,'had_voter_intended_'):null;
  const corrections=intended&&!vote.sourceConflicts?Object.fromEntries(['for','against','abstaining'].map(position=>[position,[...new Set(intended.groups[position])]])):null;
  const noRecord=withSubject&&voters.length?noRecordMembers(history,groupOn,vote.date,voters):null;
  const extra=withSubject?{...subjectContext(vote,day,context,query,store),corrections,noRecord,people:outsideRoster(store,generation,[...new Set([...voters.map(voter=>voter.personId),...Object.values(corrections||{}).flat(),...(noRecord?.ids||[])])])}:{};
  return {...base,...extra,status:'found',integrity,voters,groupHistory:history?{epoch:store.get('marksEpoch'),generation,catalogue:history.catalogue}:null,
    decision:{...(withSubject?{subjectId:vote.subjectId,scope:vote.scope,title:vote.title,titleLanguage:vote.titleLanguage,referenceTexts:inLanguage(vote.referenceTexts,query.language),parts:vote.parts.map(part=>partFields(part,query.language)),context:{documentIds:vote.context.documentIds,amendmentIds:vote.context.amendmentIds}}:{}),id:vote.id,date:vote.date,method:vote.method,outcome:vote.outcome,ballotStatus:vote.ballotStatus,totals:vote.totals,amendmentIds:vote.context.amendmentIds,componentIds:vote.context.componentIds,
      decidedIds:references(raw.decided_on_a_realization_of,'doc').map(identifier),referencesValid:list(raw.decided_on_a_part_of_a_realization_of).length===0&&list(raw.decided_on_a_realization_of).length>0&&list(raw.decided_on_a_realization_of).every(value=>exactReference(value,'doc')),
      resultRelationship:vote.resultRelationship,evidenceGaps:vote.evidenceGaps,bindingConflicts:vote.bindingConflicts,namedVoters:{...vote.namedVoters,totalsMatch:tallyMismatch?false:vote.namedVoters.totalsMatch},sourceConflicts:vote.sourceConflicts,evidencePaths:vote.evidencePaths,sources:vote.sources}};
}
