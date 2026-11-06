import {defaultUi} from './uiDefault.mjs';

const isVote=topic=>topic.kind==='PLENARY_VOTE';
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const dayFormat=(language,options)=>new Intl.DateTimeFormat(language,{...options,timeZone:'Europe/Brussels'});
const noon=date=>new Date(date.slice(0,10)+'T12:00:00Z');

export const agendaShows=['all','votes','debates'];
export const weekResultsRoute=(week,language='en')=>'insights/week-results?'+new URLSearchParams({week,lang:language});
export const voteHref=(id,language='en')=>'?'+new URLSearchParams({view:'legislation','pl-mode':'vote','pl-vote':id,lang:language});

/** `past` when no day is ahead, `upcoming` when all are, `mixed` while the week is running. */
export function weekMode(days) {
  const ahead=days.filter(day=>day.phase==='upcoming').length;
  return ahead===0?'past':ahead===days.length?'upcoming':'mixed';
}

/** Counts for the segmented control. A debate is any item that is not a vote. */
export function showCounts(topics) {
  const votes=topics.filter(isVote).length;
  return {all:topics.length,votes,debates:topics.length-votes};
}

/** One day's rows for the chosen filter. Votes lead the days still ahead. */
export function visibleTopics(topics,{show='all',upcoming=false}={}) {
  const shown=topics.filter(topic=>show==='all'||(show==='votes')===isVote(topic));
  return upcoming?[...shown.filter(isVote),...shown.filter(topic=>!isVote(topic))]:shown;
}

export const tallyText=totals=>totals&&['for','against','abstaining'].every(key=>finite(totals[key]))?totals.for+'–'+totals.against+'–'+totals.abstaining:null;

/** Result line parts for an agenda item: outcome, tally or show of hands, and vote count. */
export function resultLine(entry,ui=defaultUi) {
  const main=entry.main,outcome=main?.outcome==='ADOPTED'?ui.t('membervotespresentation.adopted'):main?.outcome==='REJECTED'?ui.t('membervotespresentation.rejected'):null;
  const tally=main?tallyText(main.totals):null;
  const hands=main&&!tally&&main.method==='VOTE_HAND'?ui.t('weekSummary.byHands'):null;
  return {
    outcome,tally,hands,voteId:main?.id??null,
    tallyLabel:tally?ui.t('weekSummary.tallyLabel',{for:main.totals.for,against:main.totals.against,abstaining:main.totals.abstaining}):null,
    votes:ui.t('weekSummary.votes',{count:entry.voteCount}),
  };
}
export const resultText=line=>[line.outcome,line.tally??line.hands,line.votes].filter(Boolean).join(' · ');

/** Past count line: exact totals over the sittings read. */
export function pastCount(results,ui=defaultUi) {
  const sum=key=>results.days.reduce((total,day)=>total+day[key],0);
  const votes=ui.t('weekSummary.votes',{count:sum('voteCount')}),items=ui.t('weekSummary.agendaItems',{count:results.items.length});
  const named=sum('rollCallCount'),notPut=sum('notConducted');
  return [
    named?ui.t('weekSummary.countPastNamed',{votes,items,named}):ui.t('weekSummary.countPast',{votes,items}),
    notPut?ui.t('weekSummary.countNotPut',{count:notPut}):null,
  ].filter(Boolean).join(' ');
}

/** Count line for days that are still ahead. */
export function upcomingCount(topics,ui=defaultUi) {
  const {votes,debates}=showCounts(topics);
  if(votes&&debates)return ui.t('weekSummary.countUpcoming',{votes:ui.t('weekSummary.votes',{count:votes}),debates:ui.t('weekSummary.debates',{count:debates})});
  if(votes)return ui.t('weekSummary.countUpcomingVotes',{votes:ui.t('weekSummary.votes',{count:votes})});
  return debates?ui.t('weekSummary.countUpcomingDebates',{debates:ui.t('weekSummary.debates',{count:debates})}):null;
}

const deadlineType=type=>String(typeof type==='object'?type?.id:type??'').split('/').pop();

/** The next tabling deadlines still ahead of `now`, earliest first. */
export function nextDeadlines(topics,now,limit=3) {
  return topics.flatMap(topic=>(topic.deadlines||[]).filter(deadline=>deadlineType(deadline.type)==='TABLING_PLENARY'&&deadline.end&&Date.parse(deadline.end)>now).map(deadline=>({id:deadline.id,end:deadline.end,topic})))
    .sort((a,b)=>Date.parse(a.end)-Date.parse(b.end)||a.id.localeCompare(b.id)).slice(0,limit);
}
export function deadlineParts(end,language='en') {
  const locale=language==='en'?'en-GB':language,date=new Date(end);
  return {
    date:dayFormat(locale,{day:'numeric',month:'short'}).format(date),
    time:dayFormat(locale,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date),
  };
}

export const weekOfDate=(date,language='en')=>dayFormat(language,{day:'numeric',month:'short',year:'numeric'}).format(noon(date));
export function dayChipText(date,language='en') {
  if(language!=='en')return dayFormat(language,{weekday:'short',day:'numeric'}).format(noon(date));
  return dayFormat('en',{weekday:'short'}).format(noon(date))+' '+dayFormat('en',{day:'numeric'}).format(noon(date));
}
/** "Nov 11–12" for the sitting days of a week; one day reads as that day. */
export function sittingRange(dates,language='en') {
  const sorted=[...dates].sort();
  if(!sorted.length)return null;
  const format=dayFormat(language,{month:'short',day:'numeric'}),first=noon(sorted[0]),last=noon(sorted.at(-1));
  return sorted.length===1||sorted[0]===sorted.at(-1)?format.format(first):format.formatRange(first,last).replace(/\s*–\s*/,'–');
}

export const procedureReferences=topic=>(topic.procedureIds||[]).filter(id=>/^\d{4}-\d{4}[A-Z]?$/.test(id)).map(id=>id.replace('-','/'));

const count=value=>Number.isSafeInteger(value)&&value>=0;
const totals=value=>value&&['for','against','abstaining'].every(key=>value[key]===null||count(value[key]));
/** The week-results contract. Anything else reads as unavailable. */
export const validWeekResults=data=>Boolean(data&&typeof data.week==='string'&&(data.location===null||typeof data.location==='string')
  &&Array.isArray(data.days)&&data.days.every(day=>typeof day?.sittingId==='string'&&count(day.voteCount)&&count(day.rollCallCount)&&count(day.notConducted))
  &&Array.isArray(data.items)&&data.items.every(item=>typeof item?.agendaItemId==='string'&&count(item.voteCount)&&(item.main===null||typeof item.main?.id==='string'&&totals(item.main.totals))));
