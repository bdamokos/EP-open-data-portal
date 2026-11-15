import {absolutePathFromEnvironment} from './config.mjs';
import {HttpError} from './http-utils.mjs';
import {odpLanguage} from './odp.mjs';
import {array,tail} from './activity-index-model.mjs';
import {brusselsDay} from './analysis-period.mjs';
import {amendmentsPage} from './amendments-store.mjs';
import {committeeLabel,isRapporteur,leadCommitteeCodes,mainVoteEvents,rapporteurIds,rapporteurPerson,statusIndexEvents,tabledReports} from './dossier-status.mjs';
export {leadCommitteeCodes,rapporteurIds} from './dossier-status.mjs';
import {dossierStatusLines,resolutionStage} from './dossier-status-model.mjs';
import {cachedAgendaRequest} from './parliament-search.mjs';
import {procedureSteps} from './procedure-steps.mjs';
import {procedureClassification} from './procedure-types.mjs';
import {PressStore} from './press-releases.mjs';
import {pressExcerpt} from './press-releases-model.mjs';
import {isLocalRequestFailure} from './request-budget.mjs';

export const WEEK_ITEM_VERSION=2;
const LIMITS=Object.freeze({procedures:2,documents:6,sittings:5});
const reportId=/^(?:A|B|RC)-\d{1,2}-\d{4}-\d{4,6}$/;
const sittingId=/^MTG-PL-\d{4}-\d{2}-\d{2}$/;
const procedureId=/^\d{4}-\d{4}[A-Z]?$/;

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

/**
 * What a reader wants to know about a coming agenda item, on one small reply.
 * Saved procedures, documents, amendments, voting lists and press releases only:
 * a read asks Parliament for nothing. The route's view cache keeps the reply as a small derived file.
 */
export async function weekItem(query,{store,activity,status,groupOn=()=>'unavailable',request=cachedAgendaRequest,pressStore=null,clock=Date.now}) {
  const generation=store.status().servingGeneration,asOf=brusselsDay(clock());
  const works=[];
  for(const id of query.procedures){const held=await heldProcedure(activity,id,request);if(held)works.push(held);}
  const primary=works[0]?.work||null,reference=works[0]?.procedure.reference||null;
  const leadCodes=leadCommitteeCodes(primary),committees=leadCodes.map(code=>committeeLabel(code,query.language));
  const documents=query.documents.length?query.documents:tabledReports(primary).slice(0,1);
  const report=documents.map(id=>store.source?.(generation,'/plenary-documents/'+id)?.work).find(work=>array(work?.workHadParticipation).some(isRapporteur));
  const rapporteurs=rapporteurIds(report,primary,leadCodes).map(id=>rapporteurPerson(store,activity,generation,groupOn,id,asOf)).filter(Boolean);
  const lists=query.sittings.flatMap(sitting=>(store.votingListsForSitting?.(sitting)||[]).map(list=>({sitting,list})));
  const rows=documents.map(id=>{
    const found=lists.find(row=>row.list.documentId===id);
    let amendments=null;
    try {amendments=amendmentsPage(store,{document:id,limit:1,language:query.language}).total||null;}
    catch(error){if(isLocalRequestFailure(error))throw error;}
    return {id,amendments,voteSitting:found?.sitting||null};
  });
  let standing=[],debated=null;
  if(primary) {
    const indexEvents=statusIndexEvents(primary),{family,steps,stage:derived,councilApproval}=procedureSteps({reference,indexEvents,asOf});
    const vote=await status.voteOnDate(mainVoteEvents({indexEvents,family,steps,asOf}),query.language);
    standing=standingLines({family,steps,stage:family==='COD'?derived:resolutionStage(vote),indexEvents,committees,vote,councilApproval});
    debated=indexEvents.filter(event=>event.had_activity_type==='PLENARY_DEBATE'&&event.activity_date&&event.activity_date<=asOf).map(event=>event.activity_date).sort().at(-1)||null;
  }
  // The newest release that names this file by its exact reference, in its own words. With no lead held there is nothing to show.
  const directory=pressStore?null:absolutePathFromEnvironment('ACTIVITY_INDEX_DIR');
  const ownedPress=directory?new PressStore(directory,{readOnly:true}):null,releases=pressStore||ownedPress;
  let press=null;
  try {
    const newest=works.flatMap(({procedure})=>releases?.mentions(procedure.reference,{},1).items||[]).sort((a,b)=>String(b.body.publishedAt||'').localeCompare(String(a.body.publishedAt||'')))[0];
    const {lead,second}=pressExcerpt(newest?.body);
    if(lead)press={url:newest.body.url,publishedAt:newest.body.publishedAt||null,lead,second};
  }finally{ownedPress?.close();}
  return {
    version:WEEK_ITEM_VERSION,
    procedures:works.map(({work,procedure})=>{const type=procedureClassification(work);return {id:procedure.id,code:type.status==='known'?type.code:null};}),
    rapporteurs,standing,debated,documents:rows,press,
  };
}
