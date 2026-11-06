import {retainedWeekVoteFacts} from './week-story-reader.mjs';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {absolutePathFromEnvironment} from './config.mjs';
import {projectWeekVoteFacts,procedure} from './week-story-votes.mjs';
export {storySitting} from './week-story-votes.mjs';
import {PressStore} from './press-releases.mjs';
import {sittingSnapshots} from './sitting-snapshot-store.mjs';
import {finishedWeekSittings} from './week-standouts.mjs';
import {weekResultsQuery} from './week-results.mjs';
import {votePeriods} from './vote-periods.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {odpLanguage} from './odp.mjs';
import {cachedEvent} from './insights-participation.mjs';
import {retainedWeekSpeechFacts} from './corpus-speeches.mjs';
import {storyLists,selectWeekStory,projectStoryLanguage} from './week-story-model.mjs';
import {pressExcerpt} from './press-releases-model.mjs';
import {identifier,references,labels} from './vote-evidence.mjs';

export const WEEK_STORY_VERSION=1;
export function weekStoryQuery(search) {return {...weekResultsQuery(search),language:odpLanguage(search.get('lang')||'en')};}
export async function weekStory(query,{store=null,periods=votePeriods,snapshots=sittingSnapshots,readSpeechFacts=retainedWeekSpeechFacts,readEvent=cachedEvent,pressStore=null,clock=Date.now}={}) {
  const empty={version:WEEK_STORY_VERSION,week:query.week,status:'unavailable',stories:[],highlights:[],press:{}};
  const calendar=await periods.collect(),ids=finishedWeekSittings(calendar,query.week,brusselsDay(clock()));
  if(!ids.length)return empty;
  const projected=snapshots!==sittingSnapshots?await projectWeekVoteFacts(ids,{store,snapshots}):await retainedWeekVoteFacts({ids,directory:absolutePathFromEnvironment('ACTIVITY_INDEX_DIR'),generation:store?.status().servingGeneration});
  const {votes,storyVotes,completeVotes}=projected,agenda=new Map(projected.agenda.map(item=>[item.agendaItemId,item]));
  const facts=await readSpeechFacts({dates:ids.map(id=>id.slice(7,17))});
  const debates=new Map(),classified=Boolean(facts)&&facts.records.every(row=>row.type&&row.type!=='unclassified'&&row.type!=='blue-card');
  for(const row of facts?.records||[]) {
    if(['chair','written','procedure'].includes(row.type))continue;
    for(const id of row.parentIds) {
      const debate=debates.get(id)||{id,key:id,titles:row.parentTitles?.[id]||{},speeches:0,blueCards:0,people:new Set()};
      debate.speeches++;if(row.type?.startsWith('blue-card-'))debate.blueCards++;
      for(const personId of row.people)if(personId)debate.people.add(typeof personId==='string'?personId:personId.id);
      debates.set(id,debate);
    }
  }
  // Resolve only ranked candidates, serially, with a yield between held reads.
  const resolved=new Map();let missingLabels=false;
  const resolve=async row=>{
    if(resolved.has(row.id))return resolved.get(row.id);
    const saved=await readEvent(row.id),event=saved?.payload?.data?.find(node=>(node.activity_id||identifier(node.id))===row.id);
    const itemIds=references(event?.executed,'event').map(identifier),items=itemIds.map(id=>agenda.get(id)).filter(Boolean);
    const keys=[...new Set(items.flatMap(item=>item.procedureIds.map(procedure)))].sort();
    const observed=labels(event?.activity_label),titles=Object.keys(observed).length?observed:labels(row.titles);if(!Object.keys(titles).length)missingLabels=true;
    const entry={id:row.id,key:keys.join('|')||row.id,keys,linked:items.length>0,titles,labelStatus:Object.keys(titles).length?'available':'unavailable',agendaItemIds:itemIds,speeches:row.speeches,speakers:row.people.size,blueCards:row.blueCards};
    resolved.set(row.id,entry);await yieldTurn();return entry;
  };
  const ranked=async metric=>{
    const rows=[...debates.values()].filter(r=>metric!=='blueCards'||r.blueCards>0).sort((a,b)=>b[metric]-a[metric]||a.id.localeCompare(b.id)),out=[],seen=new Set();let boundary=null;
    for(const row of rows) {
      if(seen.size>=5&&row[metric]!==boundary)break;
      const entry=await resolve(row);
      if(!seen.has(entry.key)){seen.add(entry.key);out.push(entry);}
      if(seen.size>=5)boundary=row[metric];
    }
    return out;
  };
  const speeches=await ranked('speeches'),blueCards=classified?await ranked('blueCards'):[];
  const lists=storyLists({votes,speeches,blueCards,completeVotes}),pressByKey=new Map(),voteByKey=new Map(),press={};
  for(const vote of storyVotes||[])if(!voteByKey.has(vote.key))voteByKey.set(vote.key,vote);
  const directory=absolutePathFromEnvironment('ACTIVITY_INDEX_DIR');
  const ownedPress=!pressStore&&directory?new PressStore(directory,{readOnly:true}):null;
  const releases=pressStore||ownedPress;
  const to=new Date(Date.parse(query.week+'T12:00:00Z')+6*86400_000).toISOString().slice(0,10);
  try {
    for(const item of agenda.values()) {
      const release=releases?.forWeek({...item,from:query.week,to})?.[0];if(!release)continue;
      press[item.agendaItemId]={url:release.url};
      for(const key of (item.procedureIds.length?item.procedureIds.map(procedure):[item.agendaItemId])) {
        const previous=pressByKey.get(key);
        if(!previous||release.publishedAt>previous.publishedAt||release.publishedAt===previous.publishedAt&&release.id.localeCompare(previous.id)>0)
          pressByKey.set(key,{id:release.id,url:release.url,title:release.title,publishedAt:release.publishedAt,...pressExcerpt(release)});
      }
    }
  }finally{ownedPress?.close();}
  const result={...empty,status:facts&&completeVotes&&!missingLabels?'complete':'partial',...selectWeekStory(lists,{pressByKey,voteByKey,completeVotes}),press};
  return query.language?projectStoryLanguage(result,query.language):result;
}
