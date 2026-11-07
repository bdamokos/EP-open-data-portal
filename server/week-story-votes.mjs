import {setImmediate as yieldTurn} from 'node:timers/promises';
import {sittingSnapshots} from './sitting-snapshot-store.mjs';
import {MEMBER_VOTE_SNAPSHOT_VERSION} from './member-votes.mjs';
import {projectMemberSitting} from './member-votes-model.mjs';
import {mainVote} from './main-vote.mjs';
import {decisionVotesContext,projectDecisionVotes} from './decision-votes.mjs';
import {groupMajorities} from './your-vote-ballot.mjs';
import {groupHistorySnapshot} from './group-history.mjs';
import {list,identifier,references,labels} from './vote-evidence.mjs';
import {itemVoteSummary,countedTotals} from './week-result-summary.mjs';
export const procedure=id=>String(id).replace(/^(\d{4})-/,'$1/').replace(/\([A-Z]+\)$/,'');
const compactVote=v=>({id:v.id,agendaItemId:v.agendaItemId,outcome:v.outcome,method:v.method,label:v.title||v.label||null,totals:v.totals,differing:v.differing});
export function storySitting(day,{store,sharedHistory}={}) {
  const context=decisionVotesContext(day,store,{sharedHistory});
  const {items:decisions,subjects}=projectMemberSitting(day,'0');
  const agenda=new Map(list(day.agenda).map(raw=>[raw.activity_id,{agendaItemId:raw.activity_id,titles:labels(raw.activity_label),procedureIds:references(raw.inverse_was_scheduled_in,'proc').map(identifier),documentIds:references(raw.based_on_a_realization_of,'doc').map(identifier)}]));
  const votes=[],storyVotes=[],byItem=new Map();
  for(const subject of subjects) {
    const own=decisions.filter(decision=>decision.subjectId===subject.id),main=mainVote(decisions,subject);
    for(const id of subject.agendaItemIds) {
      const entry=byItem.get(id)||{mains:new Map(),decisions:new Map()};
      if(main)entry.mains.set(main.id,main);
      for(const decision of own)entry.decisions.set(decision.id,decision);
      byItem.set(id,entry);
    }
  }
  for(const [id,entry] of byItem) {
    const item=agenda.get(id);if(!item)continue;
    const main=entry.mains.size===1?[...entry.mains.values()][0]:null;
    const summary=itemVoteSummary([...entry.decisions.values()],main);
    const displayed=main||summary?.vote;
    const keys=item.procedureIds.length?item.procedureIds.map(procedure):[item.agendaItemId];
    if(displayed&&!entry.decisions.get(displayed.id)?.sourceConflicts)for(const key of keys)storyVotes.push({...compactVote({...displayed,agendaItemId:id}),key});
    if(!main||main.sourceConflicts||main.ballotStatus!=='conducted'||!['ADOPTED','REJECTED'].includes(main.outcome)||!countedTotals(main.totals))continue;
    let differing=null;
    if(main.namedVoters.available&&context.history) {
      const projected=projectDecisionVotes({sitting:day.sittingId,decision:main.id,language:'en'},{days:[day],coverage:{status:'complete'}},{store,context});
      const verified=projected.voters.filter(v=>v.groupStatus==='verified');
      if(projected.integrity==='complete'&&verified.length)differing=groupMajorities(verified).reduce((n,g)=>n+(g.position?Object.values(g.counts).reduce((a,b)=>a+b,0)-g.counts[g.position]:0),0);
    }
    for(const key of keys)votes.push({...item,key,linked:true,id:main.id,date:main.date,outcome:main.outcome,method:main.method,label:main.title,totals:main.totals,differing});
  }
  return {votes,storyVotes,agenda:[...agenda.values()]};
}

export async function projectWeekVoteFacts(ids,{store=null,snapshots=sittingSnapshots}={}) {
  const generation=store?.status().servingGeneration,sharedHistory=generation?groupHistorySnapshot(store,generation):null;
  const votes=[],storyVotes=[],agenda=new Map();let completeVotes=true;
  for(const id of ids) {
    const saved=snapshots.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,id,{lastGood:true});
    if(!saved?.day||saved.day.sittingId!==id||saved.day.coverage?.state!=='complete'){completeVotes=false;continue;}
    const projected=storySitting(saved.day,{store,sharedHistory});votes.push(...projected.votes);storyVotes.push(...projected.storyVotes);
    for(const item of projected.agenda)agenda.set(item.agendaItemId,item);
    await yieldTurn();
  }
  return {votes,storyVotes,agenda:[...agenda.values()],completeVotes};
}

