import {absolutePathFromEnvironment} from './config.mjs';
import {HttpError} from './http-utils.mjs';
import {odpLanguage} from './odp.mjs';
import {array,tail} from './activity-index-model.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {amendmentsPage} from './amendments-store.mjs';
import {committeeLabel,mainVoteEvents,statusIndexEvents} from './dossier-status.mjs';
import {dossierStatusLines,resolutionStage} from './dossier-status-model.mjs';
import {cachedAgendaRequest} from './parliament-search.mjs';
import {procedureSteps} from './procedure-steps.mjs';
import {procedureClassification} from './procedure-types.mjs';
import {PressStore} from './press-releases.mjs';
import {isLocalRequestFailure} from './request-budget.mjs';

export const WEEK_ITEM_VERSION=1;
const LIMITS=Object.freeze({procedures:2,documents:6,sittings:5});
const reportId=/^(?:A|B|RC)-\d{1,2}-\d{4}-\d{4,6}$/;
const sittingId=/^MTG-PL-\d{4}-\d{2}-\d{2}$/;
const procedureId=/^\d{4}-\d{4}[A-Z]?$/;
const roles=part=>array(part.participation_role).map(tail);
const rapporteur=part=>roles(part).some(role=>role==='RAPPORTEUR'||role==='RAPPORTEUR_CO');
const personIds=part=>array(part.had_participant_person).map(tail).filter(id=>/^[1-9]\d*$/.test(id));
const term=part=>Math.max(0,...array(part.parliamentary_term).map(value=>Number(/ep-(\d+)$/.exec(tail(value))?.[1])||0));

export function weekItemQuery(search) {
  for(const key of search.keys())if(!['procedures','documents','sittings','lang'].includes(key)||search.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated item parameter.');
  const ids=(key,pattern,limit)=>{
    const raw=search.get(key);if(!raw)return [];
    const values=raw.split(',');
    if(values.length>limit||new Set(values).size!==values.length||values.some(value=>!pattern.test(value)))throw new HttpError(400,'invalid_query','Use exact item identifiers.');
    return [...values].sort();
  };
  const query={procedures:ids('procedures',procedureId,LIMITS.procedures),documents:ids('documents',reportId,LIMITS.documents),sittings:ids('sittings',sittingId,LIMITS.sittings),language:odpLanguage(search.get('lang')||'en')};
  if(!query.procedures.length&&!query.documents.length)throw new HttpError(400,'invalid_query','Choose an agenda item.');
  return query;
}

/** The committees responsible, from the procedure's own participation rows. */
export function leadCommitteeCodes(work) {
  const lead=array(work?.had_participation).filter(part=>roles(part).includes('COMMITTEE_LEAD')).flatMap(part=>array(part.had_participant_organization).map(tail));
  const named=array(work?.had_participation).filter(rapporteur).map(part=>tail(part.participation_in_name_of));
  return [...new Set((lead.length?lead:named).filter(Boolean))];
}
/** Reports tabled for plenary on this procedure, newest first: event to document, never a title. */
export function tabledReports(work) {
  const dated=array(work?.consists_of).filter(event=>tail(event.had_activity_type)==='TABLING_PLENARY')
    .flatMap(event=>array(event.based_on_a_realization_of).map(tail).filter(id=>reportId.test(id)).map(id=>({id,date:event.activity_date||''})));
  return [...new Set(dated.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)).map(row=>row.id))];
}
/** The report's own rapporteurs; else the procedure's in its latest term, without an earlier term's. */
export function rapporteurIds(report,work,leadCodes=[]) {
  const named=array(report?.workHadParticipation).filter(rapporteur).flatMap(personIds);
  if(named.length)return [...new Set(named)];
  const rows=array(work?.had_participation).filter(part=>rapporteur(part)&&personIds(part).length&&(!leadCodes.length||!part.participation_in_name_of||leadCodes.includes(tail(part.participation_in_name_of))));
  const latest=Math.max(0,...rows.map(term));
  return [...new Set(rows.filter(part=>term(part)===latest).flatMap(personIds))];
}
/** Lines of the official list a reader votes on: its section headings are not votes. */
export const votingListRows=list=>array(list?.rows).filter(row=>row.kind!=='heading').length;

/** Where the item stands before this week. Only ordinary legislation has steps; other files have their committee report or adopted vote. */
export function standingLines({family,steps,stage,indexEvents,committees,vote,councilApproval=null}) {
  const slots={committees,mainVote:vote};
  const sentence=dossierStatusLines({stage,steps,councilApproval,indexEvents,slots}).sentence;
  const earlier=stage==='deal'?dossierStatusLines({stage:'position-talks',steps,indexEvents,slots}).sentence:null;
  const adopted=family==='COD'?null:indexEvents.filter(event=>event.had_activity_type==='COMMITTEE_ADOPTING_REPORT'&&event.activity_date).map(event=>event.activity_date).sort().at(-1);
  const reported=!sentence&&adopted?dossierStatusLines({stage:'reported',steps:[{key:'committee',date:adopted}],indexEvents,slots}).sentence:null;
  // Each of these sentences states a date, and one without it could not be written.
  return [earlier,sentence||reported].filter(line=>line?.values?.date);
}

async function heldProcedure(activity,id,request) {
  const held=activity.heldProcedure(id,'en');
  if(held)return held;
  try {return activity.identified(await request('/procedures/'+id,{},{}),id,'en');}
  catch(error){if(isLocalRequestFailure(error))throw error;return null;}
}
function person(store,activity,generation,groupOn,id,asOf) {
  const member=JSON.parse(store.db.prepare('SELECT body FROM members WHERE id=?').get(id)?.body??'null');
  const group=groupOn(id,asOf),name=member?.name||activity.personLabel(id,generation);
  if(!name)return null;
  return {id,name,currentMep:Boolean(member),group:typeof group==='object'?group.code:group==='not-serving'?null:member?.groupCode||null};
}

/**
 * What a reader wants to know about a coming agenda item, on one small reply.
 * Saved procedures, documents, amendments, voting lists and press releases only:
 * a read asks Parliament for nothing and writes nothing.
 */
export async function weekItem(query,{store,activity,status,groupOn=()=>'unavailable',request=cachedAgendaRequest,pressStore=null,clock=Date.now}) {
  const generation=store.status().servingGeneration,asOf=brusselsDay(clock());
  const works=[];
  for(const id of query.procedures){const held=await heldProcedure(activity,id,request);if(held)works.push(held);}
  const primary=works[0]?.work||null,reference=works[0]?.procedure.reference||null;
  const leadCodes=leadCommitteeCodes(primary),committees=leadCodes.map(code=>committeeLabel(code,query.language));
  const documents=query.documents.length?query.documents:tabledReports(primary).slice(0,1);
  const report=documents.map(id=>store.source?.(generation,'/plenary-documents/'+id)?.work).find(work=>array(work?.workHadParticipation).some(rapporteur));
  const rapporteurs=rapporteurIds(report,primary,leadCodes).map(id=>person(store,activity,generation,groupOn,id,asOf)).filter(Boolean);
  const lists=query.sittings.flatMap(sitting=>(store.votingListsForSitting?.(sitting)||[]).map(list=>({sitting,list})));
  const rows=documents.map(id=>{
    const found=lists.find(row=>row.list.documentId===id);
    let amendments=null;
    try {amendments=amendmentsPage(store,{document:id,limit:1,language:query.language}).total||null;}
    catch(error){if(isLocalRequestFailure(error))throw error;}
    return {id,amendments,votingList:found?{sittingId:found.sitting,rows:votingListRows(found.list)}:null};
  });
  let standing=[],debated=null;
  if(primary) {
    const indexEvents=statusIndexEvents(primary),{family,steps,stage:derived,councilApproval}=procedureSteps({reference,indexEvents,asOf});
    const vote=await status.voteOnDate(mainVoteEvents({indexEvents,family,steps,asOf}),query.language);
    standing=standingLines({family,steps,stage:family==='COD'?derived:resolutionStage(vote),indexEvents,committees,vote,councilApproval});
    debated=indexEvents.filter(event=>event.had_activity_type==='PLENARY_DEBATE'&&event.activity_date&&event.activity_date<=asOf).map(event=>event.activity_date).sort().at(-1)||null;
  }
  // The newest release that names this file by its exact reference.
  const directory=pressStore?null:absolutePathFromEnvironment('ACTIVITY_INDEX_DIR');
  const ownedPress=directory?new PressStore(directory,{readOnly:true}):null,releases=pressStore||ownedPress;
  let press=null;
  try {
    const newest=works.flatMap(({procedure})=>releases?.mentions(procedure.reference,{},1).items||[]).sort((a,b)=>String(b.body.publishedAt||'').localeCompare(String(a.body.publishedAt||'')))[0];
    if(newest)press={url:newest.body.url,title:newest.body.title,publishedAt:newest.body.publishedAt||null};
  }finally{ownedPress?.close();}
  return {
    version:WEEK_ITEM_VERSION,
    procedures:works.map(({work,procedure})=>{const type=procedureClassification(work);return {id:procedure.id,reference:procedure.reference,code:type.status==='known'?type.code:null};}),
    rapporteurs,committees,standing,debated,documents:rows,press,
  };
}
