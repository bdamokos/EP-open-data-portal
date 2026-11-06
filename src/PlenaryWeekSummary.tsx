import {useSyncExternalStore,type ReactNode} from 'react';
import {UiMessage,useUiI18n} from './UiI18nReact';
import {useInsightData} from './InsightData';
import {agendaTitle} from './topicPresentation.mjs';
import {dossierLinkClick} from './dossierJourney';
import {
  agendaShows,dayChipText,deadlineParts,nextDeadlines,pastCount,procedureReferences,resultLine,resultText,resultsComplete,showCounts,sittingRange,upcomingCount,
  validWeekResults,visibleTopics,voteHref,weekMode,weekOfDate,weekResultsRoute,weekStandouts,type AgendaShow,
} from './weekSummaryPresentation.mjs';
import type {AgendaTopic,LegislationResponse,WeekResultsResponse} from './LegislationTypes';
import './PlenaryWeekSummary.css';

type Day=NonNullable<LegislationResponse['agendaSittings']>[number];
export type WeekResults={data:WeekResultsResponse|null;error:string|null};

export function useWeekResults(week:string|null,language:string):WeekResults {
  const {data,error}=useInsightData<WeekResultsResponse>(week?weekResultsRoute(week,language):null);
  return validWeekResults(data)?{data,error}:{data:null,error:error??(data?'invalid':null)};
}

const narrow=typeof window==='undefined'?undefined:window.matchMedia?.('(max-width: 680px)');
const subscribe=(notify:()=>void)=>{narrow?.addEventListener('change',notify);return()=>narrow?.removeEventListener('change',notify);};
/** A phone shows the list alone, so a finished week opens on its votes there. */
export function useAgendaShow(show:string,days:Day[]):[AgendaShow,AgendaShow] {
  const phone=useSyncExternalStore(subscribe,()=>Boolean(narrow?.matches),()=>false);
  const fallback=phone&&weekMode(days)==='past'?'votes':'all';
  return [agendaShows.includes(show as AgendaShow)?show as AgendaShow:fallback,fallback];
}

export function AgendaShowControl({topics,show,onChange}:{topics:AgendaTopic[];show:AgendaShow;onChange:(show:AgendaShow)=>void}) {
  const ui=useUiI18n(),counts=showCounts(topics);
  return <nav className="week-show insight-chart-switch" lang={ui.language} aria-label={ui.t('weekSummary.showLabel')}>
    {agendaShows.map(value=><button key={value} aria-pressed={show===value} onClick={()=>onChange(value)}>{ui.t(value==='all'?'weekSummary.showAll':value==='votes'?'weekSummary.showVotes':'weekSummary.showDebates',{count:counts[value]})}</button>)}
  </nav>;
}

/** The result under a vote's title in the agenda list. */
export function AgendaRowResult({topic,results,upcoming,language}:{topic:AgendaTopic;results:WeekResults;upcoming:boolean;language:string}) {
  const ui=useUiI18n();
  if(upcoming){
    const references=procedureReferences(topic);
    return references.length?<small className="week-row-result">{references.join(', ')}</small>:null;
  }
  const entry=results.data?.items.find(item=>item.agendaItemId===topic.id);
  if(topic.kind!=='PLENARY_VOTE'||!entry)return null;
  return <small className="week-row-result" lang={ui.language}>{resultText(resultLine(entry,ui))}</small>;
}

const scrollToDay=(id:string)=>document.querySelector(`[data-agenda-day="${id}"]`)?.scrollIntoView({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});

function Heading({data,results,language}:{data:LegislationResponse;results:WeekResults;language:string}) {
  const ui=useUiI18n(),days=data.agendaSittings||[],ahead=weekMode(days)==='upcoming';
  const range=ahead?sittingRange(days.map(day=>day.date),language):null,place=results.data?.location;
  return <h2 className="week-heading" lang={ui.language}>
    <UiMessage id="weekSummary.weekOf" values={{date:<span lang={language}>{weekOfDate(data.week!,language)}</span>}}/>
    {place&&<> · <span lang="en">{place}</span></>}
    {range&&<> · <span lang={language}>{range}</span></>}
  </h2>;
}

function CountLine({data,results}:{data:LegislationResponse;results:WeekResults}) {
  const ui=useUiI18n(),days=data.agendaSittings||[];
  const idsOf=(ahead:boolean)=>new Set(days.filter(day=>(day.phase==='upcoming')===ahead).map(day=>day.id));
  const past=idsOf(false),ahead=idsOf(true);
  const pastTopics=data.topics.filter(topic=>past.has(topic.sittingId||'')),aheadTopics=data.topics.filter(topic=>ahead.has(topic.sittingId||''));
  // Only a fully read week with no vote on any day says there were none.
  const pastVoteDays=[...past].filter(id=>pastTopics.some(topic=>topic.sittingId===id&&topic.kind==='PLENARY_VOTE'));
  const noVotes=!ahead.size&&!data.topics.some(topic=>topic.kind==='PLENARY_VOTE')&&days.every(day=>day.agendaComplete&&!day.agendaError);
  const lines=[
    past.size?(noVotes?ui.t('weekSummary.noVotes'):!pastVoteDays.length?null:results.error?ui.t('weekSummary.resultsUnavailable'):results.data&&resultsComplete(results.data,pastVoteDays)?pastCount(results.data,ui):null):null,
    ahead.size?upcomingCount(aheadTopics,ui):null,
  ].filter(Boolean);
  return lines.length?<p className="week-count" lang={ui.language}>{lines.join(' ')}</p>:null;
}

function DayChips({data,results,language}:{data:LegislationResponse;results:WeekResults;language:string}) {
  const ui=useUiI18n(),days=(data.agendaSittings||[]).filter(day=>day.phase!=='upcoming');
  if(!days.length)return null;
  return <ul className="week-days" lang={ui.language}>{days.map(day=>{
    const count=results.data?.days.find(entry=>entry.sittingId===day.id)?.voteCount;
    return <li key={day.id}><button onClick={()=>scrollToDay(day.id)}><span lang={language}>{dayChipText(day.date,language)}</span>{count?<> · {ui.t('weekSummary.votes',{count})}</>:null}</button></li>;
  })}</ul>;
}

/** The closest vote and the biggest split from group, for a finished week. */
function Standouts({data,results,language}:{data:LegislationResponse;results:WeekResults;language:string}) {
  const ui=useUiI18n();
  if(weekMode(data.agendaSittings||[])!=='past')return null;
  const facts=weekStandouts(results.data,data.topics);
  if(!facts.length)return null;
  return <ul className="week-standouts" lang={ui.language}>{facts.map(fact=>{
    const vote=<a href={voteHref(fact.voteId,ui.language)} lang={fact.topic.titleLanguage??''} onClick={dossierLinkClick}>{agendaTitle(fact.topic.title)}</a>;
    return <li key={fact.kind}>{fact.kind==='closest'
      ?<UiMessage id="weekSummary.closest" values={{vote,for:fact.for,against:fact.against}}/>
      :<UiMessage id="weekSummary.split" values={{vote,count:ui.t('weekSummary.meps',{count:fact.count})}}/>}</li>;
  })}</ul>;
}

function Deadlines({data,language}:{data:LegislationResponse;language:string}) {
  const ui=useUiI18n(),rows=nextDeadlines(data.topics,Date.now());
  if(!rows.length)return null;
  return <section className="week-deadlines" lang={ui.language}><h3><UiMessage id="weekSummary.nextDeadlines"/></h3><ul>{rows.map(({id,end,topic})=>{
    const {date,time}=deadlineParts(end,language);
    return <li key={id}><UiMessage id="weekSummary.deadline" values={{date,time,item:<span lang={topic.titleLanguage??''}>{agendaTitle(topic.title)}</span>}}/></li>;
  })}</ul></section>;
}

function dayLabel(day:Day,language:string):ReactNode {return <span lang={language}>{weekOfDate(day.date,language)}</span>;}

function Results({data,results,language,onOpen}:{data:LegislationResponse;results:WeekResults;language:string;onOpen:(id:string)=>void}) {
  const ui=useUiI18n(),days=(data.agendaSittings||[]).filter(day=>day.phase!=='upcoming');
  const votes=days.map(day=>({day,topics:data.topics.filter(topic=>topic.sittingId===day.id&&topic.kind==='PLENARY_VOTE')})).filter(entry=>entry.topics.length);
  if(!votes.length||!results.data)return null;
  const held=new Set(results.data.items.map(item=>item.agendaItemId));
  return <section className="week-results" lang={ui.language}><h3><UiMessage id="weekSummary.results"/></h3>
    {votes.map(({day,topics})=>{
      const pending=!topics.some(topic=>held.has(topic.id));
      return <div key={day.id}><h4>{dayLabel(day,language)}</h4>
        {pending?<p><UiMessage id="weekSummary.resultsPending"/></p>:<ul>{topics.map(topic=>{
          const entry=results.data!.items.find(item=>item.agendaItemId===topic.id),line=entry&&resultLine(entry,ui);
          return <li key={topic.id}><button className="week-result-title" lang={topic.titleLanguage??''} onClick={()=>onOpen(topic.id)}>{agendaTitle(topic.title)}</button>
            {line&&<span className="week-result-line">{[line.outcome&&<span key="outcome">{line.outcome}</span>,(line.tally||line.hands)&&(line.voteId?<a key="tally" href={voteHref(line.voteId,ui.language)} aria-label={line.tallyLabel??undefined} onClick={dossierLinkClick}>{line.tally??line.hands}</a>:<span key="tally">{line.tally??line.hands}</span>),<span key="votes">{line.votes}</span>].filter(Boolean).flatMap((part,index)=>index?[' · ',part]:[part])}</span>}
          </li>;
        })}</ul>}
      </div>;
    })}
  </section>;
}

function Upcoming({data,language,onOpen}:{data:LegislationResponse;language:string;onOpen:(id:string)=>void}) {
  const ui=useUiI18n(),days=(data.agendaSittings||[]).filter(day=>day.phase==='upcoming');
  const filled=days.map(day=>({day,topics:visibleTopics(data.topics.filter(topic=>topic.sittingId===day.id),{upcoming:true})})).filter(entry=>entry.topics.length);
  if(!filled.length)return null;
  return <section className="week-upcoming" lang={ui.language}>{filled.map(({day,topics})=><div key={day.id}><h4>{dayLabel(day,language)}</h4>
    <ul>{topics.map(topic=><li key={topic.id}><button className="week-result-title" lang={topic.titleLanguage??''} onClick={()=>onOpen(topic.id)}>{agendaTitle(topic.title)}</button>
      {procedureReferences(topic).length>0&&<span className="week-result-line">{procedureReferences(topic).join(', ')}</span>}</li>)}</ul></div>)}</section>;
}

/** Week summary: above the list on phones, in the right pane while no item is open. */
export function PlenaryWeekSummary({data,results,language,onOpen,list=false}:{data:LegislationResponse;results:WeekResults;language:string;onOpen:(id:string)=>void;list?:boolean}) {
  return <div className={list?'week-summary week-summary-list':'week-summary'}>
    <Heading data={data} results={results} language={language}/>
    <CountLine data={data} results={results}/>
    <DayChips data={data} results={results} language={language}/>
    <Standouts data={data} results={results} language={language}/>
    <Deadlines data={data} language={language}/>
    {!list&&<>{results.error?null:<Results data={data} results={results} language={language} onOpen={onOpen}/>}<Upcoming data={data} language={language} onOpen={onOpen}/></>}
  </div>;
}
