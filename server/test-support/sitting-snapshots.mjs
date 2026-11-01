import {readFileSync} from 'node:fs';
import {MemberVotes,memberVotesQuery} from '../member-votes.mjs';
import {MemberAttendance} from '../member-attendance.mjs';

const fixture=JSON.parse(readFileSync(new URL('../fixtures/insights-live-20261014.json',import.meta.url)));
export const SNAPSHOT_SITTING='MTG-PL-2026-10-07',SNAPSHOT_MEMBER='197591',SNAPSHOT_NOW=Date.parse('2026-10-17T19:10:00Z');
export function snapshotFixture({clock=()=>SNAPSHOT_NOW,partial=false,notPublished=false,full=false,decisionCount=1,namedConflict=false,fail}={}) {
  const calls=[],id=SNAPSHOT_SITTING,documentId='PV-10-'+id.slice(7)+'-ATT';
  const decision={...fixture.decisions.payload.data.find(row=>row.activity_id===id+'-DEC-197457'),type:'Vote'};
  const decisions=decisionCount===1?[decision]:Array.from({length:decisionCount},(_,index)=>({...decision,id:'eli/dl/event/'+id+'-DEC-'+(index+1),activity_id:id+'-DEC-'+(index+1)}));
  const result={...fixture.results.payload.data.find(row=>row.consists_of?.includes(decision.id)),consists_of:decisions.map(node=>node.id)};
  const meeting={...fixture.meetings.payload.data.find(row=>row.activity_id===id),...(!full?{consists_of:[result.id]}:{}),
    ...(!notPublished?{had_participant_person:['person/'+SNAPSHOT_MEMBER],had_excused_person:[],recorded_in_a_realization_of:['eli/dl/doc/'+documentId]}:{recorded_in_a_realization_of:[]})};
  if(notPublished)delete meeting.had_participant_person;
  const metadata={id:'eli/dl/doc/'+documentId,identifier:documentId,document_date:id.slice(7),work_type:'def/ep-document-types/LIST_ATTEND_PLENARY',inverse_recorded_in_a_realization_of:[meeting.id],
    is_realized_by:['en','fr'].map(language=>({id:'eli/dl/doc/'+documentId+'/'+language,is_embodied_by:[{id:'eli/dl/doc/'+documentId+'/'+language+'/pdf',format:'PDF',is_exemplified_by:'distribution/'+documentId+'_'+language+'.pdf',issued:'2026-10-08T12:00:00Z'}]}))};
  const request=async(endpoint,params={},options={})=>{
    calls.push({endpoint,params,options});
    if(fail)await fail(endpoint,params);
    let data;
    if(endpoint==='/meetings')data=Number(params.year)===2026?[meeting]:[];
    else if(endpoint==='/meetings/'+id)data=[meeting];
    else if(endpoint.endsWith('/decisions')){
      data=full?fixture.decisions.payload.data.map(row=>({...row,type:'Vote'})):decisions;
      if(namedConflict&&params['vote-method']==='ROLL_CALL_EV')data=data.map(row=>({...row,decision_outcome:'def/ep-statuses/REJECTED'}));
      if(params['vote-method']!=='ROLL_CALL_EV')data=data.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('had_voter'))));
    }else if(endpoint.endsWith('/vote-results'))data=partial?[]:full?fixture.results.payload.data:[result];
    else if(endpoint.endsWith('/foreseen-activities'))data=fixture.foreseen.payload.data;
    else if(endpoint==='/plenary-session-documents/'+documentId)data=[metadata];
    else throw new Error('Unexpected fixture endpoint: '+endpoint);
    const offset=Number(params.offset||0),limit=Number(params.limit||Number.MAX_SAFE_INTEGER);
    const url=new URL('https://data.europarl.europa.eu/api/v2'+endpoint);
    for(const [key,value] of Object.entries({...params,format:'application/ld+json'}))url.searchParams.set(key,String(value));
    return {url:url.href,fetchedAt:new Date(clock()).toISOString(),payload:{data:structuredClone(data.slice(offset,offset+limit))}};
  };
  return {request,calls,meeting};
}
export async function snapshotResponses({request,snapshots=null,clock=()=>SNAPSHOT_NOW,language='en',week=false,member=SNAPSHOT_MEMBER}={}) {
  const votes=await new MemberVotes({request,clock,snapshots,readChairs:async()=>null}).query(member,memberVotesQuery(new URLSearchParams(week?{week:'2026-10-05',lang:language,limit:'50'}:{sitting:SNAPSHOT_SITTING,lang:language,limit:'50'}),{now:clock()}));
  const attendance=await new MemberAttendance({request,snapshots}).query(member,{sittings:[SNAPSHOT_SITTING],language});
  return {votes,attendance};
}
