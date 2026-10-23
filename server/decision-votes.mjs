import {memberVotes,memberVotesQuery} from './member-votes.mjs';
import {projectMemberDecision,voterGroups} from './member-votes-model.mjs';
import {createGroupOn} from './group-attribution.mjs';
import {groupHistorySnapshot} from './group-history.mjs';
import {HttpError} from './http-utils.mjs';
import {requestSignal} from './request-budget.mjs';
import {list,exactReference,references,identifier} from './vote-evidence.mjs';
import {decisionVoteBindingConflict} from './decision-vote-binding.mjs';

export const DECISION_VOTES_VERSION=2;

export function decisionVotesQuery(id,search,options) {
  if(!/^MTG-PL-\d{4}-\d{2}-\d{2}-DEC-\d+$/.test(id))throw new HttpError(400,'invalid_decision','Use an exact decision identifier.');
  for(const key of search.keys())if(!['lang','snapshot'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated decision-vote parameter.');
  const params=new URLSearchParams(search);
  params.set('sitting',id.slice(0,17));params.set('decision',id);params.set('positions','all');
  return memberVotesQuery(params,options);
}

// Uses the member reader's bounded, shared sitting snapshot; no source writer.
export async function decisionVotes(query,{reader=memberVotes,store=null}={}) {
  const snapshot=await reader.snapshot(query);requestSignal()?.throwIfAborted();
  const day=snapshot.days.find(day=>day.sittingId===query.sitting);
  const raw=day?.decisions.find(raw=>raw.activity_id===query.decision);
  const base={version:DECISION_VOTES_VERSION,decisionId:query.decision,sittingId:query.sitting,snapshotId:snapshot.id,coverage:snapshot.coverage.status};
  if(!raw)return {...base,status:'unavailable',decision:null,voters:[],integrity:'unavailable',groupHistory:null};
  const vote=projectMemberDecision(raw,day,'1',query.language),actual=voterGroups(raw,'had_voter_');
  const integrity=vote.sourceConflicts||decisionVoteBindingConflict(vote)?'conflicting':!vote.namedVoters.available?'unavailable':vote.namedVoters.malformedReferences||vote.namedVoters.conflictingPersonIds.length||vote.namedVoters.totalsMatch===false?'partial':'complete';
  // Capture one frozen generation after the asynchronous vote read. No later
  // publication can mix group identities within this response.
  const generation=store?.status().servingGeneration||null;
  const history=generation?groupHistorySnapshot(store,generation):null,groupOn=createGroupOn(history);
  const voters=vote.namedVoters.available&&integrity!=='conflicting'?[...actual.byPerson].sort(([a],[b])=>Number(a)-Number(b)).map(([personId,positions])=>{
    const group=groupOn(personId,vote.date),person=history?.members[personId];
    return {personId,position:positions.length===1?positions[0]:null,status:positions.length===1?'recorded':'conflicting',group:typeof group==='object'?group:null,
      groupStatus:typeof group==='object'?'verified':group,groupSource:person?{url:person.url??null,retrievedAt:person.retrievedAt??null,stale:person.stale??false,membershipIds:(person.groups||[]).filter(period=>period.start<=vote.date&&(!period.end||period.end>=vote.date)).flatMap(period=>period.membershipIds||[])}:null};
  }):[];
  return {...base,status:'found',integrity,voters,groupHistory:history?{epoch:store.get('marksEpoch'),generation,catalogue:history.catalogue}:null,
    decision:{id:vote.id,date:vote.date,method:vote.method,outcome:vote.outcome,ballotStatus:vote.ballotStatus,totals:vote.totals,amendmentIds:vote.context.amendmentIds,componentIds:vote.context.componentIds,
      decidedIds:references(raw.decided_on_a_realization_of,'doc').map(identifier),referencesValid:list(raw.decided_on_a_realization_of).length>0&&list(raw.decided_on_a_realization_of).every(value=>exactReference(value,'doc')),
      resultRelationship:vote.resultRelationship,evidenceGaps:vote.evidenceGaps,namedVoters:vote.namedVoters,sourceConflicts:vote.sourceConflicts,evidencePaths:vote.evidencePaths,sources:vote.sources}};
}
