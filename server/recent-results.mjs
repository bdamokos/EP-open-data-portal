import {createHash} from 'node:crypto';
import {sittingSnapshots,SITTING_CALENDAR_VERSION} from './sitting-snapshot-store.mjs';
import {MEMBER_VOTE_SNAPSHOT_VERSION,memberVotesQuery} from './member-votes.mjs';
import {projectMemberDecision} from './member-votes-model.mjs';
import {decisionVotesContext,projectDecisionVotes} from './decision-votes.mjs';
import {calendarYears,currentTermSittings,calendarMonday} from './plenary-calendar.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {list,labels,preferred} from './vote-evidence.mjs';
import {HttpError} from './http-utils.mjs';
import {requestSignal} from './request-budget.mjs';
import {groupMajorities} from './your-vote-ballot.mjs';

export const LATEST_RESULTS_VERSION=1;
const MAX_SITTINGS_SCANNED=12,MAX_VOTES=24,CACHE_MS=60_000;

export function latestResultsQuery(search) {
  for(const key of search.keys())if(key!=='lang'||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated latest-results parameter.');
  return {language:memberVotesQuery(search).language};
}

// 'A-10-2026-0123' -> 'A10-0123/2026'; 'proc/2025-0385' -> '2025/0385'. Only exact single ids qualify.
export function referenceLine(procedureIds,documentIds) {
  const procedures=[...new Set(procedureIds)].filter(id=>/^\d{4}-\d{4}$/.test(id));
  if(procedures.length===1&&new Set(procedureIds).size===1)return procedures[0].replace('-','/');
  const documents=[...new Set(documentIds)].map(id=>/^([A-Z])-(\d+)-(\d{4})-(\d{4})$/.exec(id)).filter(Boolean);
  return documents.length===1?`${documents[0][1]}${documents[0][2]}-${documents[0][4]}/${documents[0][3]}`:null;
}

const finite=value=>Number.isInteger(value)&&value>=0;

// Pure projection of one stored sitting day. No source request, no writer.
export function sittingResults(day,{language,store=null,context=null}={}) {
  context??=decisionVotesContext(day,store);
  const agenda=new Map(list(day.agenda).map(node=>[node.activity_id,node]));
  const snapshot={id:'latest-results',days:[day],coverage:{status:'complete'}};
  const votes=[];
  for(const raw of list(day.decisions)) {
    const item=projectMemberDecision(raw,day,'1',language,context.derived);
    const {for:yes,against,abstaining}=item.totals;
    if(item.scope.kind!=='whole-text'||item.method!=='VOTE_ELECTRONIC_ROLLCALL'||item.ballotStatus!=='conducted'||item.sourceConflicts||!item.namedVoters.available)continue;
    if(!['ADOPTED','REJECTED'].includes(item.outcome)||![yes,against,abstaining].every(finite))continue;
    // The existing exact link: decision -> result -> executed agenda item. No title match.
    if(item.context.agendaItemIds.length!==1)continue;
    const topicId=item.context.agendaItemIds[0],node=agenda.get(topicId);
    const {title,titleLanguage}=node?preferred(labels(node.activity_label),language):{title:null};
    if(!title)continue;
    let differing=null;
    if(context.history) {
      const projected=projectDecisionVotes({sitting:day.sittingId,decision:item.id,language},snapshot,{store,context});
      if(projected.integrity==='complete')differing=groupMajorities(projected.voters.filter(voter=>voter.groupStatus==='verified')).reduce((sum,g)=>g.position?sum+Object.values(g.counts).reduce((a,b)=>a+b,0)-g.counts[g.position]:sum,0);
    }
    votes.push({id:item.id,date:item.date,sittingId:day.sittingId,topicId,title,titleLanguage,reference:referenceLine(item.context.procedureIds,item.context.documentIds),outcome:item.outcome,totals:{for:yes,against,abstaining},differing});
  }
  return votes;
}

export async function latestResults(query,{snapshots=sittingSnapshots,store=null,clock=Date.now}={}) {
  const today=brusselsDay(clock());
  const base={version:LATEST_RESULTS_VERSION,language:query.language,attribution:'European Parliament Open Data API v2, CC BY 4.0'};
  const nodes=[];
  for(const year of calendarYears(today).reverse()) {
    const calendar=snapshots.read('calendar',SITTING_CALENDAR_VERSION,String(year),{lastGood:true});
    if(calendar?.nodes)nodes.push(...calendar.nodes);
    if(nodes.length>=MAX_SITTINGS_SCANNED)break;
  }
  const sittings=currentTermSittings(nodes,today).sort((a,b)=>b.activity_date.localeCompare(a.activity_date)).slice(0,MAX_SITTINGS_SCANNED);
  let week=null;const days=[];
  for(const sitting of sittings) {
    requestSignal()?.throwIfAborted();
    const monday=calendarMonday(sitting.activity_date);
    if(week&&monday!==week)break;
    const saved=snapshots.read('votes',MEMBER_VOTE_SNAPSHOT_VERSION,sitting.activity_id,{lastGood:true});
    if(!saved?.day)continue;
    days.push({day:saved.day,bytes:saved.bytes||0});week=monday;
  }
  if(!days.length)return {...base,week:null,sittingIds:[],votes:[]};
  const votes=days.flatMap(({day})=>sittingResults(day,{language:query.language,store})).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)).slice(0,MAX_VOTES);
  return {...base,week,sittingIds:days.map(({day})=>day.sittingId),votes};
}

// One bounded memo per language; snapshots change at most when the index writer publishes.
const memo=new Map();
export async function latestResultsCached(query,options={}) {
  const key=query.language+':'+(options.store?.status?.().servingGeneration??'none'),clock=options.clock||Date.now,hit=memo.get(key);
  if(hit&&clock()-hit.at<CACHE_MS)return hit.value;
  const value=await latestResults(query,options);
  memo.set(key,{at:clock(),value,revision:createHash('sha256').update(JSON.stringify([value.week,value.sittingIds,value.votes.map(vote=>vote.id)])).digest('hex')});
  while(memo.size>8)memo.delete(memo.keys().next().value);
  return value;
}
