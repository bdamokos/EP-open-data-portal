import {memberVotesRoute} from './memberVotesPresentation.mjs';
import {decisionVoteBindingConflict} from '../server/decision-vote-binding.mjs';

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const person=value=>typeof value==='string'&&/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value));
const positions=['for','against','abstaining'];
const refs=value=>Array.isArray(value)&&value.every(id=>typeof id==='string');
const source=value=>{
  if(!object(value)||typeof value.fetchedAt!=='string'||!Number.isFinite(Date.parse(value.fetchedAt))||! /^[a-f0-9]{64}$/.test(value.contentHash))return false;
  try {const url=new URL(value.url);return url.origin==='https://data.europarl.europa.eu'&&url.pathname.startsWith('/api/v2/meetings/');}catch{return false;}
};
export function decisionVotesRoute(id,language) {
  if(typeof id!=='string'||!/^MTG-PL-\d{4}-\d{2}-\d{2}-DEC-\d+$/.test(id))return null;
  try {memberVotesRoute('1',{sittingId:id.slice(0,17),decisionId:id},language);}
  catch{return null;}
  return 'decision-votes/'+id+'?'+new URLSearchParams({lang:language});
}
export function validateDecisionVotes(data,id) {
  if(!object(data)||data.version!==5||data.decisionId!==id||data.sittingId!==id.slice(0,17)||! /^[a-f0-9]{64}$/.test(data.snapshotId)||!['complete','partial','unavailable'].includes(data.coverage)||!['found','unavailable'].includes(data.status)||!['complete','partial','conflicting','unavailable'].includes(data.integrity)||!Array.isArray(data.voters))return false;
  if(data.status==='unavailable')return data.decision===null&&data.voters.length===0&&data.integrity==='unavailable';
  const vote=data.decision;
  if(!object(vote)||vote.id!==id||vote.date!==id.slice(7,17)||!['method','outcome'].every(key=>vote[key]===null||typeof vote[key]==='string')||!['conducted','not-conducted','unknown'].includes(vote.ballotStatus)||typeof vote.referencesValid!=='boolean'||!refs(vote.amendmentIds)||!refs(vote.componentIds)||!object(vote.totals)||!positions.every(p=>vote.totals[p]===null||Number.isSafeInteger(vote.totals[p])&&vote.totals[p]>=0))return false;
  if(!refs(vote.decidedIds)||!object(vote.sources)||!['decisions','results','agenda'].every(key=>Array.isArray(vote.sources[key])&&vote.sources[key].every(source)))return false;
  if(!object(vote.resultRelationship)||!['consistent','single-direction','ambiguous','unlinked'].includes(vote.resultRelationship.binding)||!refs(vote.resultRelationship.inverseResultIds)||!refs(vote.resultRelationship.forwardResultIds)||!Array.isArray(vote.evidenceGaps)||!vote.evidenceGaps.every(gap=>object(gap)&&typeof gap.code==='string'&&(gap.details===undefined||Array.isArray(gap.details)&&gap.details.every(detail=>object(detail)&&typeof detail.code==='string'))))return false;
  if(!Array.isArray(vote.bindingConflicts)||!vote.bindingConflicts.every(gap=>object(gap)&&typeof gap.code==='string'))return false;
  if(decisionVoteBindingConflict(vote)&&(data.integrity!=='conflicting'||data.voters.length))return false;
  if(data.groupHistory!==null&&(!object(data.groupHistory)||typeof data.groupHistory.epoch!=='string'||!Number.isSafeInteger(data.groupHistory.generation)||data.groupHistory.generation<1||!object(data.groupHistory.catalogue)||(data.groupHistory.catalogue.retrievedAt!=null&&(typeof data.groupHistory.catalogue.retrievedAt!=='string'||!Number.isFinite(Date.parse(data.groupHistory.catalogue.retrievedAt))))))return false;
  const ids=new Set();
  for(const voter of data.voters) {
    if(!object(voter)||!person(voter.personId)||ids.has(voter.personId)||!['recorded','conflicting'].includes(voter.status)||!(voter.status==='conflicting'?voter.position===null:positions.includes(voter.position)))return false;
    ids.add(voter.personId);
    if(voter.group!==null&&(!data.groupHistory||voter.groupStatus!=='verified'||!object(voter.group)||!['code','orgId','groupId'].every(key=>typeof voter.group[key]==='string'&&voter.group[key])))return false;
  }
  if(data.integrity==='complete') {
    const named=vote.namedVoters;
    if(vote.sourceConflicts||vote.method!=='VOTE_ELECTRONIC_ROLLCALL'||vote.ballotStatus!=='conducted'||!named?.available||named.malformedReferences!==0||!Array.isArray(named.conflictingPersonIds)||named.conflictingPersonIds.length||named.totalsMatch===false||positions.some(p=>vote.totals[p]!==null&&vote.totals[p]!==named.counts?.[p])||data.voters.some(voter=>voter.status!=='recorded')||!positions.every(p=>named.counts?.[p]===data.voters.filter(voter=>voter.position===p).length))return false;
  }
  return true;
}
const docId=value=>typeof value==='string'?value.replace(/^(?:https?:\/\/data\.europarl\.europa\.eu\/)?(?:eli\/dl\/doc\/)?/,''):null;
export function amendmentVoteBinding(item,indexed,data) {
  const vote=data.decision;
  if(!vote||!vote.referencesValid||vote.sourceConflicts||data.integrity==='conflicting'||decisionVoteBindingConflict(vote)||['unverified','unresolved-collective'].includes(indexed.componentBinding))return false;
  if(vote.decidedIds.some(id=>!vote.amendmentIds.includes(id)&&!vote.componentIds.includes(id)))return false;
  const ids=new Set([item.id,...(item.officialIds||[])].map(docId));
  const expected=(indexed.amendmentIds?.length?indexed.amendmentIds:[item.id]).map(docId);
  if(!vote.amendmentIds.some(id=>ids.has(id))||vote.amendmentIds.length!==new Set(expected).size||vote.amendmentIds.some(id=>!expected.includes(id)))return false;
  if(indexed.partId) {
    if(indexed.componentBinding!=='single-amendment'||vote.componentIds.length!==1||vote.componentIds[0]!==docId(indexed.partId))return false;
  }else if(indexed.partNumber!=null||vote.componentIds.length)return false;
  if(['outcome','method'].some(key=>indexed[key]&&vote[key]&&indexed[key]!==vote[key]))return false;
  return !positions.some(p=>indexed.totals?.[p]!=null&&(vote.totals[p]!=null&&indexed.totals[p]!==vote.totals[p]||vote.namedVoters?.available&&vote.namedVoters.counts?.[p]!=null&&indexed.totals[p]!==vote.namedVoters.counts[p]));
}
export function authorVotePosition(id,data) {
  if(!person(String(id??'')))return 'MEP unresolved';
  const row=data.voters.find(voter=>voter.personId===String(id));
  if(row?.status==='conflicting')return 'Conflicting record';
  if(row?.status==='recorded')return {for:'For',against:'Against',abstaining:'Abstained'}[row.position];
  return data.integrity==='complete'?'No recorded vote':'Unavailable';
}
