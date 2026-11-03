import {brusselsDay} from './analysis-period.mjs';
import {ballotVotingLists} from './ballot-source-adapter.mjs';
import {HttpError} from './http-utils.mjs';
import {odp,odpLanguage} from './odp.mjs';
import {memberVotes,memberVotesQuery} from './member-votes.mjs';
import {amendmentsPage} from './amendments-store.mjs';
import {assembleBallot,readBallotBindings,groupMajorities} from './your-vote-ballot.mjs';
import {decisionVotes,decisionVotesQuery} from './decision-votes.mjs';
export const UPCOMING_VOTES_VERSION=3;
export const BALLOT_COMPARISON_VERSION=1;
const tail=x=>String(x?.id||x||'').split('/').at(-1);
const list=x=>x==null?[]:Array.isArray(x)?x:[x];
export function upcomingVotesQuery(params) {
  for(const key of params.keys())if(!['sitting','lang'].includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated ballot parameter.');
  const sitting=params.get('sitting')||'';
  if(!/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(sitting)||!Number.isFinite(Date.parse(sitting.slice(7)))||new Date(sitting.slice(7)).toISOString().slice(0,10)!==sitting.slice(7))throw new HttpError(400,'invalid_sitting','Choose a plenary sitting.');
  return {sitting,language:odpLanguage(params.get('lang')||'en')};
}
// Only this adapter depends on the parallel source/scope packages.
export async function ballotInputs(query,{store,request=odp,reader=memberVotes,lists}={}) {
  if(!store)throw new HttpError(503,'ballot_unavailable','Ballot unavailable.');
  let day;
  if(query.sitting.slice(7)<=brusselsDay(Date.now())) {
    const snapshot=await reader.snapshot(memberVotesQuery(new URLSearchParams({sitting:query.sitting,lang:query.language})));
    day=snapshot.days.find(d=>d.sittingId===query.sitting);
  }else {
    const meeting=await request('/meetings/'+query.sitting,{}, {priority:'interactive'});
    if(!meeting.payload?.data?.some(n=>n.activity_id===query.sitting&&tail(n.had_activity_type)==='PLENARY_SITTING'))throw new HttpError(404,'sitting_not_found','Sitting unavailable.');
    const agenda=[];
    for(let page=0;page<4;page++){const response=await request('/meetings/'+query.sitting+'/foreseen-activities',{limit:50,offset:page*50},{priority:'interactive'});agenda.push(...response.payload.data);if(response.payload.data.length<50)break;}
    day={sittingId:query.sitting,agenda,decisions:[],results:[],requests:[]};
  }
  if(!day)throw new HttpError(503,'ballot_unavailable','Ballot unavailable.');
  const documents=[...new Set(day.agenda.filter(n=>tail(n.had_activity_type)==='PLENARY_VOTE').flatMap(n=>list(n.based_on_a_realization_of).map(tail)))];
  const amendmentPages=documents.map(document=>({document,page:amendmentsPage(store,{document,limit:1000,language:query.language})}));
  const amendments=amendmentPages.flatMap(({page})=>page.items),partialDocuments=amendmentPages.filter(({page})=>page.items.length<page.total||page.scheduledLists===null||page.items.some(row=>row.scheduledVotes===null)||!page.items.length&&!page.coverage.observationComplete).map(({document})=>document);
  return {day,amendments,partialDocuments,lists:lists?await lists(query.sitting):ballotVotingLists(store,query.sitting)};
}
export async function upcomingVotes(query,{store=null,inputs=ballotInputs,...options}={}) {
  const data=await inputs(query,{store,...options}),items=[];
  for(const agenda of data.day.agenda.filter(n=>tail(n.had_activity_type)==='PLENARY_VOTE')) {
    const agendaItemId=agenda.activity_id||tail(agenda.id);
    const documents=list(agenda.based_on_a_realization_of).map(tail);
    for(const document of documents.length?documents:[null]) {
      const votingList=data.lists.find(v=>v.documentId===document&&v.agendaItemId===agendaItemId);
      const retained=store&&document?readBallotBindings(store.db,query.sitting,agendaItemId,document):[];
      const ballot=document?assembleBallot({document,agendaItemId,day:data.day,amendments:data.amendments,votingList,retained}):{rows:[],added:[],bindings:[]};
      items.push({id:agendaItemId,documentId:document,sittingId:query.sitting,title:agenda.activity_label?.[query.language]||agenda.activity_label?.en||'',titleLanguage:agenda.activity_label?.[query.language]?query.language:agenda.activity_label?.en?'en':null,procedureIds:list(agenda.inverse_was_scheduled_in).map(tail),source:votingList?'voting-list':retained.length?'retained':'tabled',partial:data.partialDocuments?.includes(document)||false,...ballot});
    }
  }
  return {version:UPCOMING_VOTES_VERSION,sittingId:query.sitting,items};
}
export async function ballotComparison(id,params,{store=null}={}) {const response=await decisionVotes(decisionVotesQuery(id,params),{store});return {...response,version:BALLOT_COMPARISON_VERSION,majorities:response.integrity==='complete'?groupMajorities(response.voters):[]};}
