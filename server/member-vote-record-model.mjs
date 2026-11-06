import {createHash} from 'node:crypto';
import {voterGroups,projectMemberDecision,memberVoteAlignment} from './member-votes-model.mjs';
import {groupMajorities} from './your-vote-ballot.mjs';
import {list,deriveVoteEvidence,identifier,eventUri,references} from './vote-evidence.mjs';

// One compact, member-indexed projection per sitting. The reader never parses
// sitting snapshots or decisions; this module is the only alignment definition.
const positions=['for','against','abstaining'];
const emptyAlignment=()=>({with:0,against:0,abstained:0,notComparable:0});
const resolver=groupOn=>typeof groupOn==='function'?groupOn:()=> 'unavailable';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const attachedGroup=group=>typeof group==='object'&&Boolean(group?.code)&&group.code!=='NI';

function resultDocumentMap(day) {
  const map=new Map();
  for(const result of list(day.results)) {
    const id=identifier(eventUri(result)||'');
    if(!id)continue;
    const docs=references(result.recorded_in_a_realization_of,'doc').map(identifier).filter(Boolean);
    if(docs.length===1)map.set(id,docs[0]);
  }
  return map;
}
function chairOwner(day,item,documents) {
  if(day.chairing?.status!=='observed'||!item.subjectId||!['consistent','single-direction'].includes(item.resultRelationship?.binding))return null;
  if((item.evidenceGaps||[]).some(gap=>['conflicting-result-source','missing-result','invalid-reference'].includes(gap.code)))return null;
  const document=documents.get(item.subjectId);
  return document?day.chairing.byResultDocument?.[document]||null:null;
}

// The group line is the largest recorded position within the member's own
// group; a top tie has no line. Non-attached and unverified members have none.
export function voteGroupLines(voters) {
  const lines=new Map();
  for(const majority of groupMajorities(voters))lines.set(majority.id,majority.position);
  return lines;
}

export function memberVoteRecordRevision(day,groupGeneration) {
  const derived=deriveVoteEvidence(day);
  return digest({
    sittingId:day.sittingId,date:day.date,groupGeneration,
    chairing:day.chairing?.status==='observed'?{status:'observed',byResultDocument:day.chairing.byResultDocument}:{status:day.chairing?.status||'unavailable'},
    records:Boolean(day.coverage?.completeness?.votingRecordsComplete),
    decisions:list(day.decisions).map(raw=>{
      const item=projectMemberDecision(raw,day,'0','en',derived),actual=voterGroups(raw,'had_voter_');
      return {id:item.id,outcome:item.outcome,method:item.method,ballotStatus:item.ballotStatus,scope:item.scope?.kind,subjectId:item.subjectId,binding:item.resultRelationship?.binding,
        totals:item.totals,voters:actual.groups,malformed:actual.malformedReferences,supplied:actual.supplied};
    })
  });
}

// The language-neutral label ('mul') is preferred over an arbitrary translation.
export function pickTitle(titles,referenceTexts,language) {
  const usable=text=>typeof text==='string'&&text.trim();
  for(const source of [titles,referenceTexts]) {
    for(const code of [language,'en','mul'])if(usable(source?.[code]))return {text:source[code],language:code};
    const first=Object.entries(source||{}).find(([,text])=>usable(text));
    if(first)return {text:first[1],language:first[0]};
  }
  return {text:null,language:null};
}

// A ballot does not depend on the agenda, so a sitting is projected when its voting
// records are complete. A sitting without any decision held no votes and is not counted;
// conflicting decisions, or records not yet read in full, keep a sitting out as missing.
export function voteSittingStatus(day) {
  const completeness=day.coverage?.completeness||{};
  if(!list(day.decisions).length&&!(completeness.declaredDecisionCount>0))return {status:'empty',reason:null};
  if(completeness.votingRecordsComplete===true)return {status:'projected',reason:null};
  return {status:'excluded',reason:list(completeness.conflictingDecisionIds).length?'conflicting-decisions':'records-incomplete'};
}

// Every observation is computed once for the sitting. Member rows only carry
// counts, ballots and departures; decision wording stays on the sitting row.
export function summariseVoteSitting(day,groupOn,{groupGeneration=null}={}) {
  const derived=deriveVoteEvidence(day),resolve=resolver(groupOn),date=day.date,sittingId=day.sittingId;
  const documents=resultDocumentMap(day);
  const decisions={},members=new Map(),named={count:0},subjects={};
  const subjectTitles=new Map(derived.subjects.map(subject=>[subject.id,subject.titles]));
  function member(id) {
    let value=members.get(id);
    if(!value){value={memberId:id,sittingId,date,groupCode:null,alignment:emptyAlignment(),wholeText:emptyAlignment(),ballots:{recorded:0,named:0,chaired:0},departures:[]};members.set(id,value);}
    return value;
  }
  for(const raw of list(day.decisions)) {
    const item=projectMemberDecision(raw,day,'0','en',derived),actual=voterGroups(raw,'had_voter_');
    const available=item.ballotStatus==='conducted'&&item.method==='VOTE_ELECTRONIC_ROLLCALL'&&Object.values(actual.supplied).every(Boolean);
    if(!available)continue;
    const conflicts=new Set([...actual.byPerson].filter(([,values])=>values.length>1).map(([id])=>id));
    const wholeText=item.scope?.kind==='whole-text';
    const voters=[];
    for(const position of positions)for(const id of actual.groups[position]) {
      if(conflicts.has(id))continue;
      const group=resolve(id,date);
      voters.push({position,status:'recorded',group:attachedGroup(group)?group:{code:null}});
    }
    const lines=voteGroupLines(voters);
    const chair=chairOwner(day,item,documents);
    named.count++;
    // The result a decision belongs to, only when the link is exact.
    const subjectId=item.subjectId&&['consistent','single-direction'].includes(item.resultRelationship?.binding)&&Object.keys(subjectTitles.get(item.subjectId)||{}).length?item.subjectId:null;
    if(subjectId)subjects[subjectId]=subjectTitles.get(subjectId);
    decisions[item.id]={subjectId,titles:item.titles||{},referenceTexts:item.referenceTexts||{},outcome:item.outcome,scope:wholeText?'whole-text':item.scope?.kind||'unclassified',wholeText,method:item.method};
    for(const position of positions)for(const id of actual.groups[position]) {
      if(conflicts.has(id))continue;
      const group=resolve(id,date),attached=attachedGroup(group);
      const record=member(id),linePosition=attached?lines.get(group.code)??null:null;
      record.ballots.recorded++;
      if(attached)record.groupCode=group.code;
      const classified=!attached?'unclassified':memberVoteAlignment({ballotStatus:'conducted',actualPosition:{status:'recorded',position}},linePosition);
      const alignment=classified==='unclassified'?'notComparable':classified;
      record.alignment[alignment]++;
      if(wholeText)record.wholeText[alignment]++;
      if(alignment==='against')record.departures.push({decisionId:item.id,date,wholeText,position,line:linePosition});
    }
    // A chairing member's own ballot is omitted rather than counted as absence.
    if(chair&&!actual.byPerson.has(String(chair))&&!conflicts.has(String(chair)))member(chair).ballots.chaired++;
  }
  const sitting={sittingId,date,named:named.count,decisions,subjects,complete:Boolean(day.coverage?.completeness?.votingRecordsComplete)};
  for(const record of members.values()) {
    record.ballots.named=sitting.named;
    const attached=attachedGroup(resolve(record.memberId,date));
    const comparable=record.alignment.with+record.alignment.against,finalComparable=record.wholeText.with+record.wholeText.against;
    record.bySitting={sittingId,date,
      withGroup:attached&&comparable>0?record.alignment.with:null,comparable:attached&&comparable>0?comparable:null,
      finalWithGroup:attached&&finalComparable>0?record.wholeText.with:null,finalComparable:attached&&finalComparable>0?finalComparable:null};
  }
  return {sittingId,date,revision:memberVoteRecordRevision(day,groupGeneration),sitting,members};
}
