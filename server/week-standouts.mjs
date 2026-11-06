import {sittingSnapshots} from './sitting-snapshot-store.mjs';
import {MEMBER_VOTE_SNAPSHOT_VERSION} from './member-votes.mjs';
import {projectMemberDecision} from './member-votes-model.mjs';
import {decisionVotesContext,projectDecisionVotes} from './decision-votes.mjs';
import {list} from './vote-evidence.mjs';
import {groupHistorySnapshot} from './group-history.mjs';
import {groupMajorities} from './your-vote-ballot.mjs';

const finite=value=>Number.isInteger(value)&&value>=0;

// Whole-text roll-call votes of one stored sitting day, each joined to its agenda
// item by the exact decision -> result -> executed item link (never by title).
// `differing` counts members who did not vote with their group's strict majority,
// abstentions included; groups without a strict majority (and NI) add nothing.
// It is null, not zero, when the group history cannot place any voter.
export function sittingVotes(day,{store=null,sharedHistory}={}) {
  const context=decisionVotesContext(day,store,{sharedHistory});
  const agenda=new Set(list(day.agenda).map(node=>node.activity_id));
  const snapshot={id:'week-standouts',days:[day],coverage:{status:'complete'}};
  const votes=[];
  for(const raw of list(day.decisions)) {
    const item=projectMemberDecision(raw,day,'1','en',context.derived);
    const {for:yes,against,abstaining}=item.totals;
    if(item.scope.kind!=='whole-text'||item.method!=='VOTE_ELECTRONIC_ROLLCALL'||item.ballotStatus!=='conducted'||item.sourceConflicts||!item.namedVoters.available)continue;
    if(!['ADOPTED','REJECTED'].includes(item.outcome)||![yes,against,abstaining].every(finite))continue;
    if(item.context.agendaItemIds.length!==1||!agenda.has(item.context.agendaItemIds[0]))continue;
    let differing=null;
    if(context.history) {
      const projected=projectDecisionVotes({sitting:day.sittingId,decision:item.id,language:'en'},snapshot,{store,context});
      const verified=projected.voters.filter(voter=>voter.groupStatus==='verified');
      if(projected.integrity==='complete'&&verified.length)differing=groupMajorities(verified).reduce((sum,group)=>group.position?sum+Object.values(group.counts).reduce((a,b)=>a+b,0)-group.counts[group.position]:sum,0);
    }
    votes.push({id:item.id,date:item.date,agendaItemId:item.context.agendaItemIds[0],outcome:item.outcome,totals:{for:yes,against,abstaining},differing});
  }
  return votes;
}

const margin=vote=>Math.abs(vote.totals.for-vote.totals.against);
// Equal values fall back to the later date, then the lower identifier.
const stable=(a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id);

// The two facts for a finished week, or none of them: every sitting day of the
// week must have a complete stored snapshot, or a winner could be named from
// partial data. Reads stored snapshots only; no upstream request.
export function weekStandouts(sittingIds,{snapshots=sittingSnapshots,store=null}={}) {
  const none={closest:null,split:null};
  if(!sittingIds.length)return none;
  const generation=store?.status().servingGeneration||null,sharedHistory=generation?groupHistorySnapshot(store,generation):null;
  const votes=[];
  for(const sittingId of sittingIds) {
    const saved=snapshots.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,sittingId,{lastGood:true});
    if(!saved?.day||saved.day.sittingId!==sittingId||saved.day.coverage?.state!=='complete')return none;
    votes.push(...sittingVotes(saved.day,{store,sharedHistory}));
  }
  const closest=votes.slice().sort((a,b)=>margin(a)-margin(b)||stable(a,b))[0];
  const split=votes.filter(vote=>Number.isInteger(vote.differing)&&vote.differing>0).sort((a,b)=>b.differing-a.differing||stable(a,b))[0];
  return {
    closest:closest?{voteId:closest.id,agendaItemId:closest.agendaItemId,outcome:closest.outcome,totals:closest.totals}:null,
    split:split?{voteId:split.id,agendaItemId:split.agendaItemId,differing:split.differing}:null,
  };
}
