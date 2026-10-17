import {personId} from './insights-model.mjs';

const origin='https://data.europarl.europa.eu/';
const positions={for:'favor',against:'against',abstaining:'abstention'};
const list=value=>Array.isArray(value)?value:value==null?[]:[value];
const unique=values=>[...new Set(values)];
const tail=value=>typeof value==='string'?value.split('/').at(-1):null;

// Only official exact references can participate in a join. Similar labels,
// identifiers on another host, and nested sibling records are not evidence.
function reference(value,kind) {
  let id=typeof value==='string'?value:value?.id;
  if(typeof id!=='string')return null;
  if(id.includes('://')) {
    try {
      const url=new URL(id);
      if(!['https:','http:'].includes(url.protocol)||url.hostname!=='data.europarl.europa.eu'||url.port||url.username||url.password||url.search||url.hash)return null;
      id=url.pathname.slice(1);
    }catch{return null;}
  }
  return new RegExp('^eli/dl/'+kind+'/[A-Za-z0-9][A-Za-z0-9._-]*$').test(id)?origin+id:null;
}
const references=(value,kind)=>unique(list(value).map(value=>reference(value,kind)).filter(Boolean));
function eventUri(node) {
  if(node?.id!=null)return reference(node.id,'event');
  return reference('eli/dl/event/'+(node?.activity_id||''),'event');
}
const identifier=uri=>uri.slice(uri.lastIndexOf('/')+1);
const labels=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter(([,text])=>typeof text==='string')):{};
function preferred(map,language) {
  const key=unique([language,'en',...Object.keys(map)]).find(key=>typeof map[key]==='string'&&map[key].trim());
  return key?{title:map[key],titleLanguage:key}:{title:null,titleLanguage:null};
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
  if(components.some(id=>/-SPLIT-\d+-\d+$/.test(id)))return {kind:'split-part',basis:'exact-component-reference'};
  if(components.some(id=>/-AM-\d+(?:-\d+)?$/.test(id)))return {kind:'amendment',basis:'exact-component-reference'};
  const reference=raw.referenceText?.en?.trim()||'';
  if(/^(?:Motion for a resolution|Draft legislative resolution|Legislative resolution) \(as a whole\)$/i.test(reference))return {kind:'whole-text',basis:'english-reference-label'};
  if(/\b(?:Am(?:endment)?s?\s*\d|oral amendment|provisional agreement)\b/i.test(reference))return {kind:'amendment',basis:'english-reference-label'};
  if(/^(?:Request|Referral|Motion to refer|Postponement|Closure|Adjournment)\b/i.test(reference))return {kind:'procedural',basis:'english-reference-label'};
  return {kind:'unclassified',basis:'unclassified'};
}

export function projectMemberDecision(raw,snapshot,memberId,language='en') {
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
  const resultUris=references(raw.inverse_consists_of,'event');
  const resultMap=new Map(list(snapshot.results).map(node=>[eventUri(node),node]).filter(([uri])=>uri));
  const agendaMap=new Map(list(snapshot.agenda).map(node=>[eventUri(node),node]).filter(([uri])=>uri));
  const agendaUris=[],missingResultIds=[],missingAgendaItemIds=[];
  contextReferences(raw);
  for(const resultUri of resultUris) {
    relation(uri,'inverse_consists_of',resultUri);
    const result=resultMap.get(resultUri);
    if(!result){missingResultIds.push(identifier(resultUri));continue;}
    contextReferences(result);
    for(const agendaUri of references(result.executed,'event')) {
      agendaUris.push(agendaUri);relation(resultUri,'executed',agendaUri);
      const agenda=agendaMap.get(agendaUri);
      if(agenda)contextReferences(agenda);else missingAgendaItemIds.push(identifier(agendaUri));
    }
  }
  const decidedIds=references(raw.decided_on_a_realization_of,'doc').map(identifier);
  const titles=labels(raw.activity_label||raw.headingLabel),referenceTexts=labels(raw.referenceText);
  return {
    id,uri,sittingId:snapshot.sittingId,date:raw.activity_date||snapshot.date,
    titles,referenceTexts,...preferred(Object.keys(titles).length?titles:referenceTexts,language),
    scope:scope(raw,decidedIds),method,outcome,ballotStatus,actualPosition,intention,sourceConflicts:raw._conflictingSourceObservations||null,
    namedVoters:{available,counts,totalsMatch,conflictingPersonIds,malformedReferences:actual.malformedReferences},totals,
    context:{resultIds:resultUris.map(identifier),agendaItemIds:unique(agendaUris.map(identifier)),documentIds:unique(documentIds),procedureIds:unique(procedureIds),amendmentIds:decidedIds.filter(id=>/-AM-\d+(?:-\d+)?$/.test(id)),componentIds:decidedIds.filter(id=>/-SPLIT-\d+-\d+$/.test(id)),missingResultIds,missingAgendaItemIds:unique(missingAgendaItemIds),relationships},
    historicalGroup:null,sources:{decisions:snapshot.sources?.decisions||[],results:snapshot.sources?.results||[],agenda:snapshot.sources?.agenda||[]}
  };
}
