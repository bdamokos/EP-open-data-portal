import {personId} from './insights-model.mjs';

import {list,unique,term as tail,exactReference as reference,references,eventUri,identifier,labels,preferred,deriveVoteEvidence} from './vote-evidence.mjs';

const positions={for:'favor',against:'against',abstaining:'abstention'};

// Decision referenceText can contain escaped XML characters even when the
// adjacent activity_label is plain text. Decode one layer without parsing tags
// or treating percentages as URL escapes; source snapshots stay untouched.
function referenceText(value) {
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  return value.replace(/&(?:amp|lt|gt|quot|apos|#(?:[0-9]+|x[0-9a-fA-F]+));/g,whole=>{
    const entity=whole.slice(1,-1);
    if(Object.hasOwn(named,entity))return named[entity];
    const point=entity[1]==='x'?Number.parseInt(entity.slice(2),16):Number(entity.slice(1));
    if(!Number.isSafeInteger(point)||point<1||point>0x10ffff||point>=0xd800&&point<=0xdfff||point<0x20&&![9,10,13].includes(point)||point===0xfffe||point===0xffff)return whole;
    return String.fromCodePoint(point);
  });
}

function count(value) {
  // Null, missing, empty strings and booleans are not observations of zero.
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0?value:null;
  if(typeof value==='string'&&/^\d+$/.test(value)) {
    const parsed=Number(value);return Number.isSafeInteger(parsed)?parsed:null;
  }
  return null;
}
function voterGroups(raw,prefix) {
  const groups={},supplied={},byPerson=new Map();let malformedReferences=0;
  for(const [position,suffix] of Object.entries(positions)) {
    const field=prefix+suffix,values=raw[field];supplied[position]=Array.isArray(values);
    if(values!==undefined&&!Array.isArray(values))malformedReferences++;
    const ids=unique((Array.isArray(values)?values:[]).flatMap(value=>{
      const id=personId(value);if(!id){malformedReferences++;return [];}return [id];
    }));
    groups[position]=ids;
    for(const id of ids){const old=byPerson.get(id)||[];old.push(position);byPerson.set(id,old);}
  }
  return {groups,supplied,byPerson,malformedReferences};
}
function scope(raw,components) {
  if(list(raw.decided_on_a_realization_of).some(value=>!reference(value,'doc')))return {kind:'unclassified',basis:'invalid-component-reference'};
  if(components.some(id=>/-SPLIT-\d+-\d+$/.test(id)))return {kind:'split-part',basis:'exact-component-reference'};
  if(components.some(id=>/-AM-\d+(?:-\d+)?$/.test(id)))return {kind:'amendment',basis:'exact-component-reference'};
  const referenceLabel=raw.referenceText?.en?.trim()||'';
  if(/^(?:Motion for a resolution|Draft legislative resolution|Legislative resolution) \(as a whole\)$/i.test(referenceLabel))return {kind:'whole-text',basis:'english-reference-label'};
  if(/\b(?:Am(?:endment)?s?\s*\d|oral amendment|provisional agreement)\b/i.test(referenceLabel))return {kind:'amendment',basis:'english-reference-label'};
  if(/^(?:Request|Referral|Motion to refer|Postponement|Closure|Adjournment)\b/i.test(referenceLabel))return {kind:'procedural',basis:'english-reference-label'};
  return {kind:'unclassified',basis:'unclassified'};
}

export function projectMemberDecision(raw,snapshot,memberId,language='en',derived=deriveVoteEvidence(snapshot)) {
  const uri=eventUri(raw),id=raw.activity_id||identifier(uri||''),method=tail(raw.decision_method),outcome=tail(raw.decision_outcome);
  const actual=voterGroups(raw,'had_voter_'),intended=voterGroups(raw,'had_voter_intended_');
  const arraysAvailable=Object.values(actual.supplied).every(Boolean);
  const notConducted=['LAPSED','WITHDRAWN','CANCELLED','CANCELED','NOT_HELD'].includes(outcome);
  const type=tail(typeof raw.type==='string'?raw.type:raw['@type']);
  const nonNamedMethod=method&&method.startsWith('VOTE_')&&method!=='VOTE_ELECTRONIC_ROLLCALL';
  const ballotStatus=notConducted?'not-conducted':type==='Vote'&&(arraysAvailable||nonNamedMethod)?'conducted':'unknown';
  const available=ballotStatus==='conducted'&&method==='VOTE_ELECTRONIC_ROLLCALL'&&arraysAvailable;
  const conflictingPersonIds=[...actual.byPerson].filter(([,values])=>values.length>1).map(([id])=>id).sort((a,b)=>Number(a)-Number(b));
  const conflicts=new Set(conflictingPersonIds);
  const counts=available?Object.fromEntries(Object.entries(actual.groups).map(([position,ids])=>[position,ids.filter(id=>!conflicts.has(id)).length])):null;
  const totals=Object.fromEntries(Object.entries(positions).map(([position,suffix])=>[position,count(raw['number_of_votes_'+suffix])]));
  const totalsMatch=!available||Object.values(totals).some(value=>value===null)?null:actual.malformedReferences>0||conflicts.size>0?false:Object.keys(positions).every(position=>counts[position]===totals[position]);
  const memberPositions=actual.byPerson.get(String(memberId))||[];
  let actualPosition={status:'unavailable',position:null};
  if(notConducted)actualPosition={status:'not-conducted',position:null};
  else if(memberPositions.length>1)actualPosition={status:'conflicting',position:null};
  else if(available&&memberPositions.length===1)actualPosition={status:'recorded',position:memberPositions[0]};
  else if(available&&actual.malformedReferences===0&&totalsMatch!==false)actualPosition={status:'no-record',position:null};
  const intendedPositions=intended.byPerson.get(String(memberId))||[];
  const intention={status:intended.malformedReferences>0?'unavailable':intendedPositions.length?'reported':'not-reported',positions:intendedPositions};

  const evidence=derived.decisions.get(uri)||{subjectId:null,resultRelationship:{inverseResultIds:[],forwardResultIds:[],binding:'unlinked'},parts:[],rollCallRequesters:[],evidenceGaps:[{code:'invalid-decision-identity'}],evidencePaths:[]};
  const conflicting=!!raw._conflictingSourceObservations;
  const relationships=[],relationKeys=new Set(),documentIds=[],procedureIds=[];
  function relation(from,field,to) {
    if(!from||!to)return;
    const key=[from,field,to].join('\n');if(relationKeys.has(key))return;
    relationKeys.add(key);relationships.push({from,field,to});
  }
  function contextReferences(node) {
    const from=eventUri(node);
    for(const field of ['based_on_a_realization_of','decided_on_a_realization_of','created_a_realization_of','documented_by_a_realization_of','recorded_in_a_realization_of'])
      for(const to of references(node[field],'doc')){documentIds.push(identifier(to));relation(from,field,to);}
    for(const field of ['inverse_consists_of','inverse_was_scheduled_in','was_scheduled_in'])
      for(const to of references(node[field],'proc')){procedureIds.push(identifier(to));relation(from,field,to);}
  }
  const inverseResultUris=references(raw.inverse_consists_of,'event');
  const resultMap=new Map(list(snapshot.results).map(node=>[eventUri(node),node]).filter(([uri])=>uri));
  const forwardResultUris=[...resultMap].filter(([,node])=>references(node.consists_of,'event').includes(uri)).map(([uri])=>uri);
  const resultUris=unique([...inverseResultUris,...forwardResultUris]);
  const agendaMap=new Map(list(snapshot.agenda).map(node=>[eventUri(node),node]).filter(([uri])=>uri));
  const agendaUris=[],missingResultIds=[],missingAgendaItemIds=[];
  if(!raw._conflictingSourceObservations)contextReferences(raw);
  for(const resultUri of resultUris) {
    if(!conflicting&&inverseResultUris.includes(resultUri))relation(uri,'inverse_consists_of',resultUri);
    const result=resultMap.get(resultUri);
    if(!result){missingResultIds.push(identifier(resultUri));continue;}
    if(evidence.subjectId!==identifier(resultUri))continue;
    if(references(result.consists_of,'event').includes(uri))relation(resultUri,'consists_of',uri);
    contextReferences(result);
    for(const agendaUri of references(result.executed,'event')) {
      agendaUris.push(agendaUri);relation(resultUri,'executed',agendaUri);
      const agenda=agendaMap.get(agendaUri);
      if(agenda)contextReferences(agenda);else missingAgendaItemIds.push(identifier(agendaUri));
    }
  }
  const decidedIds=conflicting?[]:references(raw.decided_on_a_realization_of,'doc').map(identifier);
  const titles=conflicting?{}:labels(raw.activity_label||raw.headingLabel),referenceTexts=conflicting?{}:Object.fromEntries(Object.entries(labels(raw.referenceText)).map(([language,text])=>[language,referenceText(text)]));
  return {
    id,uri,sittingId:snapshot.sittingId,date:raw.activity_date||snapshot.date,
    titles,referenceTexts,...preferred(Object.keys(titles).length?titles:referenceTexts,language),
    scope:conflicting?{kind:'unclassified',basis:'unclassified'}:scope(raw,decidedIds),method:conflicting?null:method,outcome:conflicting?null:outcome,ballotStatus:conflicting?'unknown':ballotStatus,actualPosition:conflicting?{status:'conflicting',position:null}:actualPosition,intention:conflicting?{status:'unavailable',positions:[]}:intention,sourceConflicts:raw._conflictingSourceObservations||null,
    ...evidence,
    namedVoters:{available:conflicting?false:available,counts:conflicting?null:counts,totalsMatch:conflicting?null:totalsMatch,conflictingPersonIds,malformedReferences:actual.malformedReferences},totals:conflicting?{for:null,against:null,abstaining:null}:totals,
    context:{resultIds:conflicting?[]:resultUris.map(identifier),agendaItemIds:unique(agendaUris.map(identifier)),documentIds:unique(documentIds),procedureIds:unique(procedureIds),amendmentIds:decidedIds.filter(id=>/-AM-\d+(?:-\d+)?$/.test(id)),componentIds:decidedIds.filter(id=>/-SPLIT-\d+-\d+$/.test(id)),missingResultIds:conflicting?[]:missingResultIds,missingAgendaItemIds:conflicting?[]:unique(missingAgendaItemIds),relationships},
    historicalGroup:null,sources:{decisions:snapshot.sources?.decisions||[],results:snapshot.sources?.results||[],agenda:snapshot.sources?.agenda||[]}
  };
}


export function projectMemberSitting(snapshot,memberId,language='en') {
  const derived=deriveVoteEvidence(snapshot);
  const items=list(snapshot.decisions).map(raw=>projectMemberDecision(raw,snapshot,memberId,language,derived));
  const subjects=derived.subjects.map(subject=>{
    const wholeTextDecisions=items.filter(item=>item.subjectId===subject.id&&item.scope.kind==='whole-text').map(item=>Object.fromEntries(['id','uri','date','scope','method','outcome','ballotStatus','actualPosition','intention','totals','evidencePaths','evidenceGaps'].map(key=>[key,item[key]])));
    return {...subject,...preferred(subject.titles,language),wholeTextDecisions,gaps:wholeTextDecisions.length?subject.gaps:[...subject.gaps,{code:'whole-text-outcome-not-established'}],sources:{results:snapshot.sources?.results||[],decisions:snapshot.sources?.decisions||[]}};
  });
  return {items,subjects};
}
