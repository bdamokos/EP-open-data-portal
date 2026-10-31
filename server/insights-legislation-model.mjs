import {contributionGroup,groupContributions} from './group-aggregation.mjs';
import {datedPerson} from './group-attribution.mjs';
import {XMLParser} from 'fast-xml-parser';
import {readFileSync} from 'node:fs';
import { array,tail } from './activity-index-model.mjs';
import { canonical,personId,officialApi,memberPeople,demographicStats } from './insights-model.mjs';
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
    agendaCreatorIds:agendaCreatorIds(n.structuredContent),agendaDocumentIds:refs(n.documented_by_a_realization_of).map(documentId).filter(Boolean),
    evidence:{apiUrl:foreseen.url,fetchedAt:sourceDate(foreseen),relationship:'meeting.was_scheduled_in → MEETING_PART.consists_of → agenda item; item.based_on_a_realization_of → document; item.inverse_was_scheduled_in → procedure',containerId:children.get(canonical(n.id)).activity_id}
  })).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
}
export function classifyProcedure(work) {
  return procedureClassification(work);
}
export function voteScope(vote) {
  const reference=vote.referenceText?.en || '';
  if (/^(?:Motion for a resolution|Draft legislative resolution|Legislative resolution) \(as a whole\)$/i.test(reference.trim()))return 'final-text';
  if(vote.decisionAboutId || /\b(?:Am(?:endment)?s?\s*\d|oral amendment|provisional agreement)\b/i.test(reference))return 'amendment';
  if(/^(?:Request|Referral|Motion to refer|Postponement|Closure|Adjournment)\b/i.test(reference))return 'procedural';
  return 'unclassified';
}
export function namedVote(vote,record,members,metadata,referenceDate,groupOn=()=>'unavailable') {
  const fields={for:'had_voter_favor',against:'had_voter_against',abstaining:'had_voter_abstention'};
  const rawGroups=Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,[...new Set(array(vote[field]).map(personId).filter(Boolean))]]));
  const positions=new Map();for(const [position,ids] of Object.entries(rawGroups))for(const id of ids){const old=positions.get(id)||new Set();old.add(position);positions.set(id,old);}
  const conflicts=[...positions].filter(([,values])=>values.size>1).map(([id])=>id);
  const groups=Object.fromEntries(Object.entries(rawGroups).map(([position,ids])=>[position,memberPeople(ids.filter(id=>!conflicts.includes(id)),members,metadata).map(person=>({...datedPerson(person,vote.activity_date,groupOn),contributionGroup:contributionGroup(person.id,vote.activity_date,groupOn)}))]));
  const hasNamedData=Object.values(fields).every(field=>Array.isArray(vote[field]));
  const totals={for:vote.number_of_votes_favor??null,against:vote.number_of_votes_against??null,abstaining:vote.number_of_votes_abstention??null};
  const intendedFields={for:'had_voter_intended_favor',against:'had_voter_intended_against',abstaining:'had_voter_intended_abstention'};
  const intendedCorrections=Object.fromEntries(Object.entries(intendedFields).map(([position,field])=>[position,memberPeople(array(vote[field]).map(personId).filter(Boolean),members,metadata).map(person=>({...datedPerson(person,vote.activity_date,groupOn),contributionGroup:contributionGroup(person.id,vote.activity_date,groupOn)}))]));
  const malformedVoterReferences=Object.values(fields).reduce((count,field)=>count+array(vote[field]).filter(v=>!personId(v)).length,0);
  return {id:vote.activity_id||tail(vote.id),date:vote.activity_date||null,start:vote.activity_start_date||null,titles:vote.activity_label||{},subjects:vote.referenceText||{},scope:voteScope(vote),outcome:tail(vote.decision_outcome),method:tail(vote.decision_method),
    parentIds:refs(vote.inverse_consists_of),recordedDocumentIds:refs(vote.recorded_in_a_realization_of).map(documentId).filter(Boolean),
    aggregateTotals:totals,namedCounts:hasNamedData?Object.fromEntries(Object.entries(groups).map(([key,people])=>[key,people.length])):null,namedVotersAvailable:hasNamedData,groups:hasNamedData?groups:null,
    uniqueNamedVoters:hasNamedData?positions.size:null,currentRosterWithoutNamedRecord:hasNamedData?[...members.keys()].filter(id=>!positions.has(id)).length:null,conflictingVoterIds:conflicts,malformedVoterReferences,
    totalsMatchNamed:hasNamedData && !conflicts.length && !malformedVoterReferences && Object.keys(totals).every(k=>totals[k]===groups[k].length),
    politicalGroups:hasNamedData?[...new Set(Object.values(groups).flat().map(p=>p.contributionGroup||'unavailable'))].sort().map(code=>({code,positions:Object.fromEntries(Object.entries(groups).map(([position,people])=>[position,people.filter(p=>(p.contributionGroup||'unavailable')===code)]))})):null,
    groupContributions:groupContributions(Object.values(groups).flat().map(p=>({id:p.id,date:vote.activity_date})),groupOn),
    intendedCorrections,stats:demographicStats(hasNamedData?[...positions.keys()]:[],members,metadata,referenceDate),
    evidence:{apiUrl:record.url,fetchedAt:sourceDate(record),relationship:'decision.inverse_consists_of → vote-results; vote-results.executed → agenda item; actual had_voter_favor / against / abstention → person'},
    countBasis:'Actual named roll-call positions only. Intended corrections are shown separately. Members of the current roster without a named record are not classified as absent or abstaining. Vote counts and unique people are different denominators.'};
}
export function topicVotes(topic,results,decisions,members,metadata,referenceDate,groupOn=()=>'unavailable') {
  const parents=results.payload.data.filter(n=>tail(n.had_activity_type)==='PLENARY_VOTE_RESULTS'&&refs(n.executed).includes(topic.uri));
  const parentIds=new Set(parents.map(n=>canonical(n.id)));
  return decisions.payload.data.filter(n=>refs(n.inverse_consists_of).some(p=>parentIds.has(p))).map(n=>({...namedVote(n,decisions,members,metadata,referenceDate,groupOn),
    associations:parents.filter(p=>refs(n.inverse_consists_of).includes(canonical(p.id))).map(p=>({resultId:p.activity_id,documentIds:refs(p.based_on_a_realization_of).map(documentId).filter(Boolean),procedureIds:refs(p.inverse_consists_of).map(procedureId).filter(Boolean),agendaItemId:topic.id,resultApiUrl:results.url,resultFetchedAt:sourceDate(results)}))})).sort((a,b)=> (a.scope==='final-text'?0:1)-(b.scope==='final-text'?0:1)||a.id.localeCompare(b.id));
}
export function finalVotePatterns(votes,members,metadata,groupOn=()=>'unavailable') {
  const finals=votes.filter(v=>v.scope==='final-text'&&v.namedVotersAvailable),observations=new Map();
  for(const vote of finals)for(const [position,people] of Object.entries(vote.groups))for(const person of people){
    const group=contributionGroup(person.id,vote.date,groupOn),key=JSON.stringify([person.id,group]);
    const row=observations.get(key)||{id:person.id,contributionGroup:group,affiliationGroup:person.affiliationGroup,for:0,against:0,abstaining:0};row[position]++;observations.set(key,row);
  }
  const groups={for:[],against:[],abstaining:[],mixed:[]};
  for(const row of observations.values()){const positions=['for','against','abstaining'].filter(p=>row[p]);const pattern=positions.length===1?positions[0]:'mixed';groups[pattern].push({...memberPeople([row.id],members,metadata)[0],contributionGroup:row.contributionGroup,affiliationGroup:row.affiliationGroup,observations:{for:row.for,against:row.against,abstaining:row.abstaining,named:row.for+row.against+row.abstaining,selectedFinalTextVotes:finals.length}});}

  return {groupContributions:groupContributions(finals.flatMap(v=>Object.values(v.groups).flat().map(p=>({id:p.id,date:v.date}))),groupOn),finalTextVoteIds:finals.map(v=>v.id),voteCount:finals.length,groups,uniqueNamedPeople:new Set([...observations.values()].map(row=>row.id)).size,basis:'Descriptive patterns per person and dated political group over observed final-text roll-calls for this agenda topic only. A person who changes group can appear in multiple position lists; their combined lengths can exceed uniqueNamedPeople. A final resolution is not necessarily legislation. Missing records and intended corrections do not count as positions; this is not an inference of general political support.'};
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
