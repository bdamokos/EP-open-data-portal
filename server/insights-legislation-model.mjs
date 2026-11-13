import {englishVoteLabel} from './vote-labels.mjs';
import {mainVote} from './main-vote.mjs';
import {projectMemberDecision,voteRowFields} from './member-votes-model.mjs';
import {referredForTalksOn} from './procedure-referral.mjs';
import {datedPerson} from './group-attribution.mjs';
import {XMLParser} from 'fast-xml-parser';
import {readFileSync} from 'node:fs';
import { array,tail } from './activity-index-model.mjs';
import { canonical,personId,officialApi,memberPeople } from './insights-model.mjs';
import {decisionSubjectId,deriveVoteEvidence,eventUri} from './vote-evidence.mjs';
import {explicitVoteScope,isWholeProposalVote} from './vote-scope.mjs';
import {procedureClassification} from './procedure-types.mjs';

export const refs = value => array(value).map(canonical).filter(Boolean);
const committeeLabels=JSON.parse(readFileSync(new URL('./insights-committee-labels.json',import.meta.url),'utf8')).committees;
export function committeeEvent(event,procedureId,record,language) {
  const documentIds=[...new Set(['based_on_a_realization_of','decided_on_a_realization_of','created_a_realization_of','involved_work'].flatMap(key=>refs(event[key]).map(documentId).filter(Boolean)))];
  const codes=[...new Set(documentIds.flatMap(id=>id.match(/^([A-Z]{3,5})-(?:PR|PA|AD|AM|AL)-/)?.[1]||[]))];
  const committees=codes.map(code=>{const known=committeeLabels.find(c=>c.code===code);return {code,name:known?.names[language]||known?.names.en||code,websiteUrl:known?'https://www.europarl.europa.eu/committees/en/'+code.toLowerCase()+'/home/highlights':null};});
  return {id:event.activity_id,date:event.activity_date,kind:tail(event.had_activity_type),documentIds,committees,procedureId,apiUrl:record.url,fetchedAt:sourceDate(record)};
}
const documentId = value => canonical(value).match(/^eli\/dl\/doc\/([A-Z0-9-]{1,100})$/)?.[1];
const procedureId = value => canonical(value).match(/^eli\/dl\/proc\/(\d{4}-\d{4}[A-Z]?)$/)?.[1];
const sourceDate = record => typeof record?.fetchedAt==='number'?new Date(record.fetchedAt).toISOString():record?.fetchedAt||null;
const agendaParser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',parseTagValue:false,processEntities:true});
export function agendaCreatorIds(structuredContent) {
  const content=structuredContent?.en||Object.values(structuredContent||{}).find(v=>typeof v==='string');
  if(typeof content!=='string'||content.length>64*1024||/<!DOCTYPE|<!ENTITY/i.test(content))return [];
  try {
    const items=array(agendaParser.parse('<agenda>'+content+'</agenda>').agenda?.item);
    return [...new Set(items.flatMap(item=>array(item.creators).flatMap(creators=>array(creators.label).filter(label=>label?.['@typeof']==='person').map(label=>personId(label['@resource'])).filter(Boolean))))].slice(0,30);
  }catch{return [];}
}
export function agendaTopics(meeting,foreseen) {
  const sitting=meeting.payload.data[0],scheduled=new Set(refs(sitting.was_scheduled_in));
  const containers=foreseen.payload.data.filter(n=>tail(n.had_activity_type)==='MEETING_PART' && scheduled.has(canonical(n.id)));
  const children=new Map();for(const c of containers)for(const child of refs(c.consists_of))children.set(child,c);
  return foreseen.payload.data.filter(n=>['PLENARY_DEBATE','PLENARY_VOTE'].includes(tail(n.had_activity_type)) && children.has(canonical(n.id))).map(n=>({
    id:n.activity_id||tail(n.id),uri:canonical(n.id),titles:n.activity_label||{},date:n.activity_date,kind:tail(n.had_activity_type),order:Number(n.activity_order)||0,
    documentIds:[...new Set(refs(n.based_on_a_realization_of).map(documentId).filter(Boolean))],procedureIds:[...new Set(refs(n.inverse_was_scheduled_in).map(procedureId).filter(Boolean))],
    deadlines:array(n.was_purpose_of).map(value=>typeof value==='object'?value:foreseen.payload.data.find(node=>canonical(node.id)===canonical(value))).filter(value=>array(value?.type).some(type=>['Deadline','eli-dl:Deadline'].includes(tail(type)))).map(value=>({id:value.activity_id||tail(value.id),end:value.activity_end_date||null,type:value.had_activity_type||null,labels:value.activity_label||{}})),
    agendaCreatorIds:agendaCreatorIds(n.structuredContent),agendaDocumentIds:refs(n.documented_by_a_realization_of).map(documentId).filter(Boolean),
    evidence:{apiUrl:foreseen.url,fetchedAt:sourceDate(foreseen),relationship:'meeting.was_scheduled_in → MEETING_PART.consists_of → agenda item; item.based_on_a_realization_of → document; item.inverse_was_scheduled_in → procedure',containerId:children.get(canonical(n.id)).activity_id}
  })).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
}
export function classifyProcedure(work) {
  return procedureClassification(work);
}
export function voteScope(vote,derived) {
  const explicit=explicitVoteScope(vote);
  if(explicit)return explicit.kind==='unclassified'?'unclassified':'amendment';
  const reference=englishVoteLabel(vote.referenceText)||'';
  if(isWholeProposalVote(vote,derived))return 'final-text';
  if (/^(?:Motion for a resolution|Draft legislative resolution|Legislative resolution) \(as a whole\)$/i.test(reference.trim()))return 'final-text';
  if(vote.decisionAboutId || /\b(?:Am(?:endment)?s?\s*\d|oral amendment|provisional agreement)\b/i.test(reference))return 'amendment';
  if(/^(?:Request|Referral|Motion to refer|Postponement|Closure|Adjournment)\b/i.test(reference))return 'procedural';
  return 'unclassified';
}
// The item's main vote from the same held sitting and projection the vote page
// uses, one result at a time. A partial sitting could hide the deciding vote, and
// two results naming different main votes leave the item without one.
export function agendaMainVote(topic,day,procedures=[]) {
  return agendaVotes(topic,day,procedures).mainVote;
}
// The item's main vote and its full row list, method included, from one projection of the
// same held sitting. Without a complete sitting there is no list, never a short one.
export function agendaVotes(topic,day,procedures=[],language='en') {
  if(day?.coverage?.state!=='complete')return {mainVote:null,itemVotes:null};
  const derived=deriveVoteEvidence(day);
  const subjects=array(day.results).filter(n=>tail(n.had_activity_type)==='PLENARY_VOTE_RESULTS'&&refs(n.executed).includes(topic.uri)).map(n=>n.activity_id);
  const bound=row=>['consistent','single-direction'].includes(row.resultRelationship.binding);
  // A conflicting record can't be the main vote, but it stays in the list with no result, so the count holds.
  const listed=array(day.decisions).filter(raw=>subjects.includes(decisionSubjectId(raw,derived.decisions.get(eventUri(raw))))).map(raw=>projectMemberDecision(raw,day,'1',language,derived)).filter(row=>bound(row)||row.sourceConflicts);
  const rows=listed.filter(row=>bound(row)&&!row.sourceConflicts);
  const mains=subjects.map(id=>mainVote(rows,{id,wholeTextDecisions:rows.filter(row=>row.subjectId===id&&row.scope.kind==='whole-text')})).filter(Boolean);
  const vote=new Set(mains.map(row=>row.id)).size===1?mains[0]:null;
  return {
    mainVote:vote&&{id:vote.id,date:vote.date,outcome:vote.outcome,method:vote.method,ballotStatus:vote.ballotStatus,totals:vote.totals,procedureReferral:procedures.some(work=>referredForTalksOn(work,vote.date))},
    // Only what a row shows: its label, result and numbers.
    itemVotes:(vote?[vote,...listed.filter(row=>row.id!==vote.id)]:listed).map(row=>{const {namedVotersAvailable,parts,...fields}=voteRowFields(row,language);return {...fields,parts:parts.map(({number})=>({number}))};}),
  };
}
export function topicRoles(topic,rows,documents,members,metadata,groupOn=()=>'unavailable') {
  const docIds=new Set(topic.documentIds),evidence=[];
  for(const row of rows.filter(r=>docIds.has(r.sourceId))) evidence.push({id:String(row.mepId),role:row.provenance.role,sourceId:row.sourceId,date:row.date,dateBasis:'document date',apiUrl:row.provenance.apiUrl,fetchedAt:row.provenance.sourceFetchedAt,relationships:[row.provenance.relationship],participationId:row.provenance.participationId||null,stage:row.provenance.stage||null,procedureId:row.provenance.procedureId||null});
  for(const source of documents.filter(s=>docIds.has(s.work.identifier||tail(s.work.id))))for(const p of array(source.work.workHadParticipation))for(const value of array(p.had_participant_person)) {
    const id=personId(value);if(!id)continue;
    evidence.push({id,role:tail(p.participation_role)||'UNSPECIFIED',sourceId:source.work.identifier||tail(source.work.id),date:p.activity_date||source.work.document_date||null,dateBasis:p.activity_date?'participation date':'document date',apiUrl:officialApi(source.key),fetchedAt:source.fetchedAt,relationships:['agenda item.based_on_a_realization_of → document.workHadParticipation → person'],participationId:p.id||null,stage:tail(p.occured_at_stage)||null,procedureId:null});
  }
  const unique=[...new Map(evidence.map(e=>[[e.id,e.role,e.sourceId,e.stage].join('|'),e])).values()];
  return unique.map(e=>({...datedPerson(memberPeople([e.id],members,metadata)[0],e.date,groupOn),...e}));
}
