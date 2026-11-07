import {readFileSync} from 'node:fs';
import {HttpError} from './http-utils.mjs';
import {odpLanguage} from './odp.mjs';
import {procedureReference} from './official-context.mjs';
import {array,tail} from './activity-index-model.mjs';
import {agendaTopics} from './insights-legislation-model.mjs';
import {MemberVotes} from './member-votes.mjs';
import {projectMemberSitting} from './member-votes-model.mjs';
import {cachedAgendaRequest} from './parliament-search.mjs';
import {MeetingsReader} from './meetings-reader.mjs';
import {sittingSnapshots} from './sitting-snapshot-store.mjs';
import {mainVote} from './main-vote.mjs';
import {procedureSteps} from './procedure-steps.mjs';
import {resolutionStage} from './dossier-status-model.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {calendarMonday} from './plenary-calendar.mjs';
import {isLocalRequestFailure,requestSignal} from './request-budget.mjs';

export const DOSSIER_STATUS_VERSION=1;
// Held sittings only: a page view neither requests a source nor queues collection.
// Chairs are downloaded separately from the request client, and a main vote needs none.
export const heldVotes=new MemberVotes({request:cachedAgendaRequest,readChairs:async()=>null,limits:{cacheEntries:1},snapshots:{read:(kind,version,id)=>sittingSnapshots.read(kind,version,id,{retained:true}),enqueue(){}}});
const committeeNames=JSON.parse(readFileSync(new URL('./insights-committee-labels.json',import.meta.url),'utf8')).committees;
const AGENDA_PAGE_SIZE=50;
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}/.test(value)?value.slice(0,10):null;

/** The held procedure events that settle where a file stands, shared with the topic pages. */
export const statusIndexEvents=work=>array(work.consists_of).map(event=>({had_activity_type:tail(event.had_activity_type),activity_date:validDate(event.activity_date),activity_id:event.activity_id||tail(event.id)}));

export function dossierStatusQuery(search) {
  for(const key of search.keys())if(!['reference','lang'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated dossier parameter.');
  return {reference:procedureReference(search.get('reference')),language:odpLanguage(search.get('lang')||'en')};
}

/** A committee's name in the language asked for, or its code when none is held. */
export function committeeLabel(code,language) {
  const names=committeeNames.find(row=>row.code===code)?.names||{},lang=names[language]?language:names.en?'en':null;
  return {code,name:lang?names[lang]:code,language:lang};
}
export function leadCommittees(work,language) {
  const codes=[...new Set(array(work.had_participation).filter(row=>tail(row.participation_role)==='RAPPORTEUR').map(row=>tail(row.participation_in_name_of)).filter(Boolean))];
  return codes.map(code=>committeeLabel(code,language));
}

/** The plenary votes that settle a file: after a deal, only the vote on Parliament's own date. */
export function mainVoteEvents({indexEvents,family,steps,asOf}) {
  const voteEvents=indexEvents.filter(event=>event.had_activity_type==='PLENARY_VOTE_RESULTS'&&/^MTG-PL-\d{4}-\d{2}-\d{2}-VOT-ITM-\d+$/.test(event.activity_id)&&event.activity_date&&event.activity_date<=asOf);
  // A legislative sentence states Parliament's own vote, after a deal the final one. Other files state their latest main vote.
  const parliament=steps.find(step=>step.key==='final')?.date||steps.find(step=>step.key==='parliament')?.date;
  return family==='COD'&&parliament?voteEvents.filter(event=>event.activity_date===parliament):voteEvents;
}

/** Where a file stands, from held sources. The tally comes through the bounded
 * held sitting and the plenary date only from retained agendas. A failed
 * read leaves its slot empty and the sentence drops it.
 */
export class DossierStatus {
  constructor({activity,calendar,votes=heldVotes,readAgenda=cachedAgendaRequest,clock=Date.now}) {
    // Held calendars and agendas only: a page view never starts a source read for this date.
    Object.assign(this,{activity,calendar:calendar||new MeetingsReader({request:cachedAgendaRequest,clock,snapshots:sittingSnapshots}),votes,readAgenda,clock});
  }
  async voteOnDate(events,language) {
    const sittings=[...new Set(events.map(event=>event.activity_id.slice(0,17)))].sort().reverse();
    for(const sitting of sittings) {
      let snapshot;
      try{snapshot=await this.votes.snapshot({sitting,week:null,language,snapshot:null});}
      catch(error){if(isLocalRequestFailure(error))throw error;return null;}
      requestSignal()?.throwIfAborted();
      // A partial sitting could hide the last decision, so it establishes no main vote.
      const day=snapshot.days.find(row=>row.sittingId===sitting);if(day?.coverage?.state!=='complete')continue;
      const {items,subjects}=projectMemberSitting(day,'1',language);
      for(const event of events.filter(row=>row.activity_id.startsWith(sitting)).reverse()) {
        const subject=subjects.find(row=>row.id===event.activity_id),decision=mainVote(items.filter(item=>item.subjectId===event.activity_id),subject);
        if(decision&&!decision.sourceConflicts)return {id:decision.id,date:decision.date,outcome:decision.outcome??null,method:decision.method??null,ballotStatus:decision.ballotStatus??null,totals:decision.totals??null};
      }
    }
    return null;
  }
  async plenaryDate(id,asOf) {
    try {
      const catalogue=await this.calendar.catalogue();
      const upcoming=catalogue.nodes.filter(sitting=>sitting.activity_date>=asOf).sort((a,b)=>a.activity_date.localeCompare(b.activity_date));
      const weeks=new Set([...new Set(upcoming.map(sitting=>calendarMonday(sitting.activity_date)))].slice(0,2));
      for(const sitting of upcoming.filter(row=>weeks.has(calendarMonday(row.activity_date)))) {
        // Every held page counts. A page that is not held, or adds nothing new, ends the read.
        const nodes=new Map();let first=null;
        for(let offset=0;;offset+=AGENDA_PAGE_SIZE) {
          const record=await this.readAgenda('/meetings/'+sitting.activity_id+'/foreseen-activities',{limit:AGENDA_PAGE_SIZE,offset},{}).catch(error=>{if(isLocalRequestFailure(error))throw error;return null;});
          if(!record)break;
          first||=record;
          const before=nodes.size;for(const node of record.payload.data)nodes.set(node.id,node);
          if(record.payload.data.length<AGENDA_PAGE_SIZE||nodes.size===before)break;
        }
        if(!first)continue;
        const topic=agendaTopics({payload:{data:[sitting]}},{...first,payload:{data:[...nodes.values()]}}).find(item=>item.kind==='PLENARY_VOTE'&&item.procedureIds.includes(id));
        if(topic)return validDate(topic.date)||sitting.activity_date;
      }
    }catch(error){if(isLocalRequestFailure(error))throw error;}
    return null;
  }
  async query({reference,language}) {
    const id=reference.split('(')[0].replace('/','-'),asOf=brusselsDay(this.clock());
    const {work}=await this.activity.procedure(id,language,reference);
    const indexEvents=statusIndexEvents(work);
    const {family,steps,stage:derived}=procedureSteps({reference,indexEvents,asOf});
    const relevant=mainVoteEvents({indexEvents,family,steps,asOf});
    const vote=relevant.length?await this.voteOnDate(relevant,language):null;
    const stage=family==='COD'?derived:resolutionStage(vote);
    const plenaryDate=stage==='reported'?await this.plenaryDate(id,asOf):null;
    requestSignal()?.throwIfAborted();
    return {version:DOSSIER_STATUS_VERSION,reference,family,steps,stage,indexEvents,slots:{committees:leadCommittees(work,language),mainVote:vote,plenaryDate}};
  }
}
