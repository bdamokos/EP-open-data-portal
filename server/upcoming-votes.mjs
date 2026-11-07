import {createHash} from 'node:crypto';
import {meetingsReader,missingSitting} from './meetings-reader.mjs';
import {ballotResponseCache} from './ballot-response-cache.mjs';
import {readSittingBallotBindings} from './ballot-bindings-store.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {ballotVotingLists} from './ballot-source-adapter.mjs';
import {HttpError} from './http-utils.mjs';
import {odp,odpLanguage,agendaCacheRevision} from './odp.mjs';
import {memberVotes,memberVotesQuery} from './member-votes.mjs';
import {amendmentsPage} from './amendments-store.mjs';
import {assembleBallot,ballotContext,groupMajorities} from './your-vote-ballot.mjs';
import {decisionVotesContext,projectDecisionVotes} from './decision-votes.mjs';
import {amendmentTarget} from './amendments.mjs';
import {legacyAmendmentDocument} from './upcoming-amendments.mjs';
import {documentProcedures,heldDocument,placeVotingLists} from './ballot-placement.mjs';
export const UPCOMING_VOTES_VERSION=6;
export const BALLOT_COMPARISON_VERSION=2;
const tail=x=>String(x?.id||x||'').split('/').at(-1);
const list=x=>x==null?[]:Array.isArray(x)?x:[x];
// Plenary amendments target reports and motions only. A Commission proposal
// listed on the same agenda item is not a separate ballot.
const ballotDocument=id=>amendmentTarget(id)||legacyAmendmentDocument(id);
export function upcomingVotesQuery(params) {
  for(const key of params.keys())if(!['sitting','lang'].includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated ballot parameter.');
  const sitting=params.get('sitting')||'';
  if(!/^MTG-PL-\d{4}-\d{2}-\d{2}$/.test(sitting)||!Number.isFinite(Date.parse(sitting.slice(7)))||new Date(sitting.slice(7)).toISOString().slice(0,10)!==sitting.slice(7))throw new HttpError(400,'invalid_sitting','Choose a plenary sitting.');
  return {sitting,language:odpLanguage(params.get('lang')||'en')};
}
// Only this adapter depends on the parallel source/scope packages.
export async function ballotInputs(query,{store,request=odp,reader=memberVotes,lists,meetings=meetingsReader,clock=Date.now}={}) {
  if(!store)throw new HttpError(503,'ballot_unavailable','Ballot unavailable.');
  let day,sourceRevision;
  if(query.sitting.slice(7)<=brusselsDay(clock())) {
    const snapshot=await reader.snapshot(memberVotesQuery(new URLSearchParams({sitting:query.sitting,lang:query.language})));
    day=snapshot.days.find(d=>d.sittingId===query.sitting);sourceRevision=snapshot.id;
  }else {
    // The retained/shared calendar is the admission boundary. An arbitrary
    // date must never probe the per-meeting ODP endpoint.
    const calendar=await meetings.catalogue();
    if(!calendar.nodes.some(n=>n.activity_id===query.sitting))missingSitting({complete:calendar.coverage.status==='complete'});
    const revisionBefore=await agendaCacheRevision(),records=[];
    const meeting=await request('/meetings/'+query.sitting,{}, {priority:'interactive'});
    if(!meeting.payload?.data?.some(n=>n.activity_id===query.sitting&&tail(n.had_activity_type)==='PLENARY_SITTING'))throw new HttpError(404,'sitting_not_found','Sitting unavailable.');
    records.push(meeting);
    const agenda=[];
    for(let page=0;page<4;page++){const response=await request('/meetings/'+query.sitting+'/foreseen-activities',{limit:50,offset:page*50},{priority:'interactive'});records.push(response);agenda.push(...response.payload.data);if(response.payload.data.length<50)break;}
    day={sittingId:query.sitting,agenda,decisions:[],results:[],requests:[]};
    const revisionAfter=await agendaCacheRevision();
    // Never pin a stale payload to a newly published source revision.
    sourceRevision=revisionBefore===revisionAfter&&!records.some(r=>r.stale||r.refreshInProgress||r.refreshError)?revisionAfter:null;
  }
  if(!day)throw new HttpError(503,'ballot_unavailable','Ballot unavailable.');
  const votingLists=placeVotingLists(lists?await lists(query.sitting):ballotVotingLists(store,query.sitting),day.agenda,id=>heldDocument(store,id));
  let amendmentData;
  const loadAmendments=()=>{
    if(amendmentData)return amendmentData;
    const documents=[...new Set([...day.agenda.filter(n=>tail(n.had_activity_type)==='PLENARY_VOTE').flatMap(n=>list(n.based_on_a_realization_of).map(tail).filter(ballotDocument)),...votingLists.filter(v=>v.agendaItemId).map(v=>v.documentId)])];
    const amendmentPages=documents.map(document=>({document,page:amendmentsPage(store,{document,limit:1000,language:query.language})}));
    const amendments=amendmentPages.flatMap(({page})=>page.items),partialDocuments=amendmentPages.filter(({page})=>page.items.length<page.total||page.scheduledLists===null||page.items.some(row=>row.scheduledVotes===null)||!page.items.length&&!page.coverage.observationComplete).map(({document})=>document);
    return amendmentData={amendments,partialDocuments};
  };
  const bindings=readSittingBallotBindings(store.db,query.sitting);
  const revision=sourceRevision?createHash('sha256').update(JSON.stringify([sourceRevision,store.status().servingGeneration,store.get('amendmentMutationRevision'),votingLists.map(v=>[v.documentId,v.agendaItemId,v.alsoOn,v.revision?.sha256]),bindings])).digest('hex'):null;
  return {day,loadAmendments,lists:votingLists,bindings,revision,documentOf:id=>heldDocument(store,id)};
}
// Bindings keep their exact vote item. They follow the report only from an item
// that is no longer a vote item, to the one vote item that now names it.
function retainedFor(bindings,agendaItemId,document,voteItems) {
  const pick=rows=>rows.map(({key,decisionId})=>({key,decisionId}));
  const exact=bindings.filter(b=>b.agenda===agendaItemId&&b.document===document);
  if(exact.length||!document)return pick(exact);
  const naming=[...voteItems.values()].filter(documents=>documents.includes(document)).length;
  return naming>1?[]:pick(bindings.filter(b=>b.document===document&&!voteItems.has(b.agenda)));
}
export async function upcomingVotes(query,{store=null,inputs=ballotInputs,cache=ballotResponseCache(store),makeContext=ballotContext,...options}={}) {
  const data=await inputs(query,{store,...options}),key=data.revision?JSON.stringify([UPCOMING_VOTES_VERSION,query.sitting,query.language,data.revision]):null;
  const old=key&&cache?.get(key);if(old)return old;
  const {amendments,partialDocuments}=data.loadAmendments?data.loadAmendments():data;
  const items=[],context=makeContext(data.day,amendments),bindings=data.bindings||[];
  const voteItems=new Map(data.day.agenda.filter(n=>tail(n.had_activity_type)==='PLENARY_VOTE').map(n=>[n.activity_id||tail(n.id),list(n.based_on_a_realization_of).map(tail)]));
  for(const agenda of data.day.agenda.filter(n=>tail(n.had_activity_type)==='PLENARY_VOTE')) {
    const agendaItemId=agenda.activity_id||tail(agenda.id);
    const named=list(agenda.based_on_a_realization_of).map(tail).filter(ballotDocument);
    const documents=named.length?named:data.lists.filter(v=>v.placement==='procedure'&&v.agendaItemId===agendaItemId).map(v=>v.documentId);
    for(const document of documents.length?documents:[null]) {
      const votingList=data.lists.find(v=>v.documentId===document&&v.agendaItemId===agendaItemId);
      const retained=retainedFor(bindings,agendaItemId,document,voteItems);
      const ballot=document?assembleBallot({document,agendaItemId,day:data.day,amendments,votingList,retained,context}):{rows:[],added:[],bindings:[]};
      items.push({id:agendaItemId,documentId:document,sittingId:query.sitting,title:agenda.activity_label?.[query.language]||agenda.activity_label?.en||'',titleLanguage:agenda.activity_label?.[query.language]?query.language:agenda.activity_label?.en?'en':null,procedureIds:list(agenda.inverse_was_scheduled_in).map(tail),source:votingList?'voting-list':retained.length?'retained':'tabled',partial:partialDocuments?.includes(document)||false,...ballot});
    }
  }
  for(const votingList of data.lists.filter(v=>v.placement==='debate')) {
    const document=votingList.documentId,retained=retainedFor(bindings,votingList.agendaItemId,document,voteItems);
    items.push({id:votingList.agendaItemId,alsoOn:votingList.alsoOn,documentId:document,sittingId:query.sitting,title:votingList.heading?.title||'',titleLanguage:votingList.heading?.title?'en':null,procedureIds:votingList.procedureIds,source:'voting-list',partial:partialDocuments?.includes(document)||false,...assembleBallot({document,agendaItemId:votingList.agendaItemId,day:data.day,amendments,votingList,retained,context})});
  }
  // After the purge a report that never got a vote item keeps its results.
  for(const binding of bindings) {
    if(!binding.document||items.some(item=>item.documentId===binding.document))continue;
    const work=data.documentOf?.(binding.document),titles=work?.title_dcterms||{},language=titles[query.language]?query.language:'en';
    const retained=bindings.filter(b=>b.document===binding.document).map(({key,decisionId})=>({key,decisionId}));
    items.push({id:binding.agenda,documentId:binding.document,sittingId:query.sitting,title:titles[language]||'',titleLanguage:titles[language]?language:null,procedureIds:documentProcedures(work),source:'retained',partial:false,...assembleBallot({document:binding.document,agendaItemId:binding.agenda,day:data.day,amendments,retained,context,withoutVoteItem:true})});
  }
  const result={version:UPCOMING_VOTES_VERSION,sittingId:query.sitting,items};if(key)cache?.set(key,result);return result;
}
// One sitting-wide read, independent of the presence or values of local choices.
export async function ballotComparisons(query,{store=null,reader=memberVotes,inputs=ballotInputs,...options}={}) {
  if(!store&&inputs===ballotInputs)throw new HttpError(503,'ballot_unavailable','Ballot unavailable.');
  const heldQuery=memberVotesQuery(new URLSearchParams({sitting:query.sitting,lang:query.language}));
  const snapshot=await reader.snapshot(heldQuery),day=snapshot.days.find(d=>d.sittingId===query.sitting);
  if(!day)throw new HttpError(503,'ballot_unavailable','Ballot unavailable.');
  const data=await inputs(query,{store,reader:{snapshot:async()=>snapshot},...options}),cache=ballotResponseCache(store),key=data.revision?JSON.stringify(['comparisons',query.sitting,query.language,snapshot.id,data.revision]):null;
  const old=key&&cache?.get(key);if(old)return old;
  const ballotEvidence=ballotContext(day,(data.loadAmendments?data.loadAmendments():data).amendments);
  const ballots=await upcomingVotes(query,{store,inputs:async()=>data,makeContext:()=>ballotEvidence,...options});
  const bound=new Set(ballots.items.flatMap(item=>item.rows.map(r=>r.decisionId).filter(Boolean)));
  const context=decisionVotesContext(day,store,{derived:ballotEvidence.derived}),items=[];
  for(const decisionId of bound){const data=projectDecisionVotes({...heldQuery,decision:decisionId},snapshot,{store,context});
    if(data.decision?.method!=='VOTE_ELECTRONIC_ROLLCALL')continue;
    items.push({decisionId,integrity:data.integrity,voters:data.voters.map(({personId,position,status})=>({personId,position,status})),majorities:data.integrity==='complete'?groupMajorities(data.voters):[]});
  }
  const result={version:BALLOT_COMPARISON_VERSION,sittingId:query.sitting,snapshotId:snapshot.id,items};if(key)cache?.set(key,result);return result;
}
