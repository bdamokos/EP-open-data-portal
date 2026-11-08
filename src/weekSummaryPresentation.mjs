import {defaultUi} from './uiDefault.mjs';

const isVote=topic=>topic.kind==='PLENARY_VOTE';
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;

export const weekResultsRoute=(week,language='en')=>'insights/week-results?'+new URLSearchParams({week,lang:language});
/** One day's rows. Votes lead the days still ahead. */
export function visibleTopics(topics,{upcoming=false}={}) {
  return upcoming?[...topics.filter(isVote),...topics.filter(topic=>!isVote(topic))]:topics;
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

export const procedureReferences=topic=>(topic.procedureIds||[]).filter(id=>/^\d{4}-\d{4}[A-Z]?$/.test(id)).map(id=>id.replace('-','/'));

const count=value=>Number.isSafeInteger(value)&&value>=0;
const totals=value=>value&&['for','against','abstaining'].every(key=>value[key]===null||count(value[key]));
/** The week-results contract. Anything else reads as unavailable. */
export const validWeekResults=data=>Boolean(data&&typeof data.week==='string'&&(data.location===null||typeof data.location==='string')
  &&Array.isArray(data.days)&&data.days.every(day=>typeof day?.sittingId==='string'&&typeof day.complete==='boolean'&&(day.complete?count(day.voteCount)&&count(day.rollCallCount)&&count(day.notConducted):day.voteCount===null&&day.rollCallCount===null&&day.notConducted===null))
  &&Array.isArray(data.items)&&data.items.every(item=>typeof item?.agendaItemId==='string'&&count(item.voteCount)&&(item.main===null||typeof item.main?.id==='string'&&totals(item.main.totals))));

