import {HttpError} from './http-utils.mjs';
import {CURRENT_TERM_START,brusselsDay} from './analysis-period.mjs';
import {memberVotes,memberVotesQuery} from './member-votes.mjs';
import {projectMemberSitting} from './member-votes-model.mjs';
import {itemVoteSummary} from './week-result-summary.mjs';
import {mainVote} from './main-vote.mjs';
import {votePeriods} from './vote-periods.mjs';

export const WEEK_RESULTS_VERSION=4;
// Nobody holds this identifier; the projection then never withholds a decision.
const NO_MEMBER='0';
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const monday=value=>{const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);return date.toISOString().slice(0,10);};

export function weekResultsQuery(search) {
  for(const key of search.keys())if(!['lang','week'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated week-results parameter.');
  const week=search.get('week');
  if(!validDate(week)||monday(week)!==week||week<monday(CURRENT_TERM_START))throw new HttpError(400,'invalid_week','Choose a Monday from the listed plenary weeks.');
  return {week};
}

// One place per week, or none when the week's sittings disagree or are unlisted.
function weekLocation(calendar,week) {
  const places=new Set((calendar.weeks.find(entry=>entry.week===week)?.sittings||[]).map(sitting=>sitting.location));
  return places.size===1&&!places.has(null)?[...places][0]:null;
}

// Totals and main vote per agenda item, from the bounded sitting snapshot the
// member records already read. Items join to subjects by exact identifier.
export function projectWeekResults(query,snapshot,location) {
  const days=[],items=new Map(),unlinked=[];
  for(const day of snapshot?.days||[]) {
    // A sitting whose records are partial or still pending gives no counts: a
    // surviving subset would read as the whole day.
    if(day.coverage?.state!=='complete'){days.push({sittingId:day.sittingId,complete:false,voteCount:null,rollCallCount:null,notConducted:null});continue;}
    const {items:decisions,subjects}=projectMemberSitting(day,NO_MEMBER);
    for(const decision of decisions)if(!decision.context.agendaItemIds.length)unlinked.push({id:decision.id,sittingId:day.sittingId,titles:Object.keys(decision.titles).length?decision.titles:decision.referenceTexts,outcome:decision.outcome,method:decision.method,totals:decision.totals});
    const status=value=>decisions.filter(decision=>decision.ballotStatus===value).length;
    days.push({sittingId:day.sittingId,complete:true,voteCount:status('conducted'),rollCallCount:decisions.filter(decision=>decision.namedVoters.available).length,notConducted:status('not-conducted')});
    for(const subject of subjects) {
      const own=decisions.filter(decision=>decision.subjectId===subject.id);
      const main=mainVote(decisions,subject);
      for(const agendaItemId of own.length?subject.agendaItemIds:[]) {
        const entry=items.get(agendaItemId)||{agendaItemId,voteCount:0,mains:new Map(),decisions:new Map()};
        entry.voteCount+=own.length;
        for(const decision of own)entry.decisions.set(decision.id,decision);
        if(main)entry.mains.set(main.id,main);
        items.set(agendaItemId,entry);
      }
    }
  }
  return {
    version:WEEK_RESULTS_VERSION,week:query.week,location,days,unlinked,
    // Several subjects with different main votes leave the item without one.
    items:[...items.values()].sort((a,b)=>a.agendaItemId.localeCompare(b.agendaItemId)).map(({agendaItemId,voteCount,mains,decisions})=>{
      const main=mains.size===1?[...mains.values()][0]:null;
      const rows=[...decisions.values()];
      const summary=itemVoteSummary(rows,main);
      return {agendaItemId,voteCount,summary,main:main&&{id:main.id,outcome:main.outcome,method:main.method,totals:main.totals}};
    }),
  };
}

export async function weekResults(query,{votes=memberVotes,periods=votePeriods,clock=Date.now}={}) {
  const calendar=await periods.collect(),location=weekLocation(calendar,query.week);
  // A week that has not started has no records to read.
  if(query.week>brusselsDay(clock()))return projectWeekResults(query,null,location);
  // The same query as the member records, so both share one period snapshot.
  const snapshot=await votes.snapshot(memberVotesQuery(new URLSearchParams({week:query.week,lang:'en'}),{now:clock()}));
  if(snapshot.coverage.status==='unavailable')throw new HttpError(503,'week_results_unavailable','Results for this week are unavailable.');
  return projectWeekResults(query,snapshot,location);
}
