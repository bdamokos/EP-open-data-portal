import {retainedWeekVoteFacts} from './week-story-reader.mjs';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import path from 'node:path';
import {PressStore} from './press-releases.mjs';
import {sittingSnapshots} from './sitting-snapshot-store.mjs';
import {MEMBER_VOTE_SNAPSHOT_VERSION} from './member-votes.mjs';
import {projectMemberSitting} from './member-votes-model.mjs';
import {mainVote} from './main-vote.mjs';
import {decisionVotesContext,projectDecisionVotes} from './decision-votes.mjs';
import {groupMajorities} from './your-vote-ballot.mjs';
import {groupHistorySnapshot} from './group-history.mjs';
import {finishedWeekSittings} from './week-standouts.mjs';
import {weekResultsQuery} from './week-results.mjs';
import {votePeriods} from './vote-periods.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {odpLanguage} from './odp.mjs';
import {cachedEvent} from './insights-participation.mjs';
import {retainedWeekSpeechFacts} from './corpus-speeches.mjs';
import {storyLists,selectWeekStory,pressExcerpt} from './week-story-model.mjs';
import {list,identifier,references,labels} from './vote-evidence.mjs';

export const WEEK_STORY_VERSION=1;
export function weekStoryQuery(search) {return {...weekResultsQuery(search),language:odpLanguage(search.get('lang')||'en')};}
const procedure=id=>String(id).replace(/^(\d{4})-/,'$1/').replace(/\([A-Z]+\)$/,'');
const compactVote=v=>({id:v.id,agendaItemId:v.agendaItemId,outcome:v.outcome,totals:v.totals,differing:v.differing});
const finite=v=>Number.isSafeInteger(v)&&v>=0;
export function storySitting(day,{store,sharedHistory}={}) {
  const context=decisionVotesContext(day,store,{sharedHistory});
  const {items:decisions,subjects}=projectMemberSitting(day,'0');
  const agenda=new Map(list(day.agenda).map(raw=>[raw.activity_id,{agendaItemId:raw.activity_id,titles:labels(raw.activity_label),procedureIds:references(raw.inverse_was_scheduled_in,'proc').map(identifier),documentIds:references(raw.based_on_a_realization_of,'doc').map(identifier)}]));
  const votes=[];
  for(const subject of subjects) {
    const main=mainVote(decisions,subject);
    if(!main||main.sourceConflicts||main.ballotStatus!=='conducted'||!['ADOPTED','REJECTED'].includes(main.outcome)||!Object.values(main.totals).every(finite))continue;
    if(main.context.agendaItemIds.length!==1)continue;
    const item=agenda.get(main.context.agendaItemIds[0]);if(!item)continue;
    let differing=null;
    if(main.namedVoters.available&&context.history) {
      const projected=projectDecisionVotes({sitting:day.sittingId,decision:main.id,language:'en'},{days:[day],coverage:{status:'complete'}},{store,context});
      const verified=projected.voters.filter(v=>v.groupStatus==='verified');
      if(projected.integrity==='complete'&&verified.length)differing=groupMajorities(verified).reduce((n,g)=>n+(g.position?Object.values(g.counts).reduce((a,b)=>a+b,0)-g.counts[g.position]:0),0);
    }
    const keys=item.procedureIds.length?item.procedureIds.map(procedure):[item.agendaItemId];
    for(const key of keys)votes.push({...item,key,linked:true,id:main.id,date:main.date,outcome:main.outcome,totals:main.totals,differing});
  }
  return {votes,agenda:[...agenda.values()]};
}

export async function projectWeekVoteFacts(ids,{store=null,snapshots=sittingSnapshots}={}) {
  const generation=store?.status().servingGeneration,sharedHistory=generation?groupHistorySnapshot(store,generation):null;
  const votes=[],agenda=new Map();let completeVotes=true;
  for(const id of ids) {
    const saved=snapshots.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,id,{lastGood:true});
    if(!saved?.day||saved.day.sittingId!==id||saved.day.coverage?.state!=='complete'){completeVotes=false;continue;}
    const projected=storySitting(saved.day,{store,sharedHistory});votes.push(...projected.votes);
    for(const item of projected.agenda)agenda.set(item.agendaItemId,item);
    await yieldTurn();
  }
  return {votes,agenda:[...agenda.values()],completeVotes};
}

export async function weekStory(query,{store=null,periods=votePeriods,snapshots=sittingSnapshots,readSpeechFacts=retainedWeekSpeechFacts,readEvent=cachedEvent,pressStore=null,clock=Date.now}={}) {
  const empty={version:WEEK_STORY_VERSION,week:query.week,status:'unavailable',stories:[],highlights:[],press:{}};
  const calendar=await periods.collect(),ids=finishedWeekSittings(calendar,query.week,brusselsDay(clock()));
  if(!ids.length)return empty;
  const projected=snapshots!==sittingSnapshots?await projectWeekVoteFacts(ids,{store,snapshots}):await retainedWeekVoteFacts({ids,directory:store?.directory||process.env.ACTIVITY_INDEX_DIR,generation:store?.status().servingGeneration});
  const {votes,completeVotes}=projected,agenda=new Map(projected.agenda.map(item=>[item.agendaItemId,item]));
  const facts=await readSpeechFacts({dates:ids.map(id=>id.slice(7,17))});
  const debates=new Map(),classified=Boolean(facts)&&facts.records.every(row=>row.type&&row.type!=='unclassified');
  for(const row of facts?.records||[]) {
    if(!['speech','unclassified'].includes(row.type)&&!row.type?.startsWith('blue-card-')&&row.type)continue;
    for(const id of row.parentIds) {
      const debate=debates.get(id)||{id,key:id,speeches:0,blueCards:0,people:new Set()};
      debate.speeches++;if(row.type?.startsWith('blue-card-'))debate.blueCards++;
      for(const person of row.people)if(person.id)debate.people.add(person.id);
      debates.set(id,debate);
    }
  }
  // Resolve only ranked candidates, serially, with a yield between held reads.
  const resolved=new Map();
  const resolve=async row=>{
    if(resolved.has(row.id))return resolved.get(row.id);
    const saved=await readEvent(row.id),event=saved?.payload?.data?.find(node=>(node.activity_id||identifier(node.id))===row.id);
    const itemIds=references(event?.executed,'event').map(identifier),items=itemIds.map(id=>agenda.get(id)).filter(Boolean);
    const keys=[...new Set(items.flatMap(item=>item.procedureIds.map(procedure)))];
    const entry={id:row.id,key:keys[0]||row.id,keys,linked:items.length>0,titles:labels(event?.activity_label),agendaItemIds:itemIds,speeches:row.speeches,speakers:row.people.size,blueCards:row.blueCards};
    resolved.set(row.id,entry);await yieldTurn();return entry;
  };
  const ranked=async metric=>{
    const rows=[...debates.values()].filter(r=>metric!=='blueCards'||r.blueCards>0).sort((a,b)=>b[metric]-a[metric]||a.id.localeCompare(b.id)),out=[],seen=new Set();let boundary=null;
    for(const row of rows) {
      if(seen.size>=5&&row[metric]!==boundary)break;
      const entry=await resolve(row);
      for(const key of entry.keys.length?entry.keys:[entry.key])if(!seen.has(key)){seen.add(key);out.push({...entry,key});}
      if(seen.size>=5)boundary=row[metric];
    }
    return out;
  };
  const speeches=await ranked('speeches'),blueCards=classified?await ranked('blueCards'):[];
  const lists=storyLists({votes,speeches,blueCards,completeVotes}),pressByKey=new Map(),voteByKey=new Map(votes.map(v=>[v.key,compactVote(v)])),press={};
  const ownedPress=!pressStore&&process.env.ACTIVITY_INDEX_DIR?new PressStore(path.resolve(process.env.ACTIVITY_INDEX_DIR),{readOnly:true}):null;
  const releases=pressStore||ownedPress;
  const to=new Date(Date.parse(query.week+'T12:00:00Z')+6*86400_000).toISOString().slice(0,10);
  try {
    for(const item of agenda.values()) {
      const release=releases?.forWeek({...item,from:query.week,to})?.[0];if(!release)continue;
      press[item.agendaItemId]={url:release.url};
      for(const key of (item.procedureIds.length?item.procedureIds.map(procedure):[item.agendaItemId]))if(!pressByKey.has(key))pressByKey.set(key,{id:release.id,url:release.url,title:release.title,publishedAt:release.publishedAt,...pressExcerpt(release)});
    }
  }finally{ownedPress?.db?.close();}
  return {...empty,status:facts?'complete':'partial',...selectWeekStory(lists,{pressByKey,voteByKey,completeVotes}),press};
}
