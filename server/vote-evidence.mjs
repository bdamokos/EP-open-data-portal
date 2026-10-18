import {XMLParser,XMLValidator} from 'fast-xml-parser';

const origin='https://data.europarl.europa.eu/';
export const list=value=>Array.isArray(value)?value:value==null?[]:[value];
export const unique=values=>[...new Set(values)];
export const identifier=uri=>uri.slice(uri.lastIndexOf('/')+1);
export const labels=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter(([,text])=>typeof text==='string')):{};
export const term=value=>typeof value==='string'?value.split('/').at(-1):null;
export const comparable=value=>Array.isArray(value)?value.map(comparable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,comparable(value[key])])):value;
const equal=(a,b)=>JSON.stringify(comparable(a))===JSON.stringify(comparable(b));

// Validate the supplied authority and redundant identifiers before joining.
export function exactReference(value,kind='event') {
  const supplied=typeof value==='object'&&value?value:{};
  let id=typeof value==='string'?value:value?.id;
  if(typeof id!=='string')return null;
  if(id.includes('://')) {
    // URL normalizes explicit default ports, so inspect the authority first.
    if(!/^https?:\/\/data\.europarl\.europa\.eu\//.test(id))return null;
    try {const url=new URL(id);if(url.search||url.hash||url.username||url.password)return null;id=url.pathname.slice(1);}catch{return null;}
  }
  const pattern=kind==='org'?/^org\/([A-Za-z0-9][A-Za-z0-9._-]*)$/:new RegExp('^eli/dl/'+kind+'/([A-Za-z0-9][A-Za-z0-9._-]*)$');
  const match=id.match(pattern);
  if(!match||['activity_id','identifier'].some(key=>Object.hasOwn(supplied,key)&&supplied[key]!==match[1]))return null;
  return origin+id;
}
export const references=(value,kind='event')=>unique(list(value).map(value=>exactReference(value,kind)).filter(Boolean));
export const eventUri=node=>exactReference(node);
export function preferred(map,language) {
  const key=unique([language,'en',...Object.keys(map)]).find(key=>typeof map[key]==='string'&&map[key].trim());
  return key?{title:map[key],titleLanguage:key}:{title:null,titleLanguage:null};
}
export function mergeSourceNodes(a,b) {
  if(!a)return {node:b,fields:[]};
  const fields=Object.keys(a).filter(key=>!key.startsWith('_')&&Object.hasOwn(b,key)&&!equal(a[key],b[key]));
  return {node:{...a,...b},fields};
}
const invalid=(node,fields)=>Object.entries(fields).flatMap(([field,kind])=>list(node?.[field]).flatMap((value,index)=>exactReference(value,kind)?[]:[{code:'invalid-reference',field,index}]));
const requestTypes=new Set(['REQUEST_VOTE_SPLIT','REQUEST_VOTE_ROLLCALL','REQUEST_VOTE_SEPARATE']);
const parser=new XMLParser({preserveOrder:true,ignoreAttributes:true,trimValues:false,parseTagValue:false,processEntities:true});
function literalText(literal) {
  // Only supplied XML literals are decoded. No HTML or narrative scope parser.
  if(/<!DOCTYPE|<!ENTITY/i.test(literal)||/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/.test(literal)||XMLValidator.validate('<root>'+literal+'</root>')!==true)return null;
  try {const walk=nodes=>nodes.map(node=>Object.entries(node).map(([key,value])=>key==='#text'?String(value):key.startsWith('?')||key==='#comment'?'':Array.isArray(value)?walk(value):'').join('')).join('');return walk(parser.parse('<root>'+literal+'</root>'));}catch{return null;}
}
function sourcePaths(snapshot,node,kind) {
  const paths=snapshot[kind+'Evidence']?.[node.id?.replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'')];
  if(paths?.length)return paths;
  return (snapshot.sources?.[kind==='result'?'results':'decisions']||[]).map(source=>({sourceUrl:source.url,contentHash:source.contentHash,jsonPointer:null}));
}
const deduplicatePaths=paths=>[...new Map(paths.map(path=>[JSON.stringify(path),path])).values()];
function indexAdd(index,uri,node,paths) {
  if(!uri)return;
  const entry=index.get(uri)||{node,conflicting:false,paths:[],variants:[],occurrences:[]};
  const merged=mergeSourceNodes(entry.node,node);
  if(merged.fields.length)entry.conflicting=true;
  else entry.node=merged.node;
  entry.variants.push(node);entry.occurrences.push({node,paths});entry.paths.push(...paths);index.set(uri,entry);
}

// One pure transform per sitting. All joins use exact public source identities;
// member, language, page and selected-decision projections are separate.
export function deriveVoteEvidence(snapshot) {
  const results=new Map(),requests=new Map(),components=new Map(),parents=new Map(),decisions=new Map(),globalGaps=[];
  for(const node of [...list(snapshot.results),...list(snapshot.requests),...list(snapshot.conflictingResults)]) {
    if(!node||typeof node!=='object'||Array.isArray(node)){globalGaps.push({code:'invalid-source-node'});continue;}
    const uri=eventUri(node),type=term(node.had_activity_type),paths=sourcePaths(snapshot,node,'result');
    if(!uri){globalGaps.push({code:'invalid-source-identity'});continue;}
    if(type==='PLENARY_VOTE_RESULTS') {
      indexAdd(results,uri,node,paths);
      list(node.was_motivated_by).forEach((request,index)=>{
        const ruri=exactReference(request);
        if(!ruri){globalGaps.push({code:'invalid-request-identity',id:identifier(uri)});return;}
        const owners=parents.get(ruri)||new Set();owners.add(uri);parents.set(ruri,owners);
        if(typeof request==='object')indexAdd(requests,ruri,request,paths.map(path=>({...path,jsonPointer:path.jsonPointer===null?null:path.jsonPointer+'/was_motivated_by/'+index})));
      });
    } else if(requestTypes.has(type))indexAdd(requests,uri,node,paths);
  }
  for(const [uri,entry] of requests) {
    for(const occurrence of entry.occurrences)list(occurrence.node.created_a_realization_of).forEach((component,index)=>{
      const curi=exactReference(component,'doc');
      if(!curi||typeof component!=='object'){globalGaps.push({code:'invalid-component-identity',id:identifier(uri)});return;}
      const paths=occurrence.paths.map(path=>({...path,jsonPointer:path.jsonPointer===null?null:path.jsonPointer+'/created_a_realization_of/'+index}));
      indexAdd(components,curi,component,paths);
      const target=components.get(curi);target.owners=unique([...(target.owners||[]),uri]);
      if(entry.conflicting)target.conflicting=true;
    });
  }
  for(const [uri,entry] of components) {
    const contentByLanguage=Object.fromEntries(Object.entries(labels(entry.node.expressionContent)).map(([language,literal])=>[language,{sourceLiteral:literal,text:literalText(literal)}]));
    const gaps=entry.conflicting||entry.owners.length!==1?[{code:'conflicting-component-definition'}]:!Object.keys(contentByLanguage).length?[{code:'missing-component-wording'}]:Object.entries(contentByLanguage).filter(([,value])=>value.text===null).map(([language])=>({code:'unsupported-expression-content',language}));
    entry.component={componentId:identifier(uri),uri,requestUri:entry.owners.length===1?entry.owners[0]:null,number:entry.node.number??entry.node.numbering??null,contentByLanguage:gaps.some(gap=>gap.code==='conflicting-component-definition')?{}:contentByLanguage,gaps,evidencePaths:deduplicatePaths(entry.paths)};
  }
  const requestRecord=(uri,entry)=>({id:identifier(uri),uri,type:term(entry.node.had_activity_type),scopeByLanguage:labels(entry.node.activity_label),organizationLabels:labels(entry.node.responsible_organization_label),organizationReferences:references(entry.node.had_responsible_organization,'org'),organizationAliasReferences:references(entry.node.hadResponsibleOrganization,'org'),evidencePaths:deduplicatePaths(entry.paths)});
  for(const raw of list(snapshot.decisions)) {
    const uri=eventUri(raw);if(!uri){globalGaps.push({code:'invalid-decision-identity'});continue;}
    const inverse=references(raw.inverse_consists_of),forward=[...results].filter(([,entry])=>entry.variants.some(node=>references(node.consists_of).includes(uri))).map(([uri])=>uri);
    const resultUris=unique([...inverse,...forward]);
    const ambiguous=resultUris.length>1;
    const resultRelationship={inverseResultIds:inverse.map(identifier),forwardResultIds:forward.map(identifier),binding:ambiguous?'ambiguous':inverse.length&&forward.length?'consistent':resultUris.length?'single-direction':'unlinked'};
    const gaps=invalid(raw,{inverse_consists_of:'event',decided_on_a_realization_of:'doc',was_motivated_by:'event'}),parts=[],requesters=[];
    if(raw._conflictingSourceObservations)gaps.push({code:'conflicting-decision-source'});
    if(ambiguous)gaps.push({code:'ambiguous-result-binding'});
    for(const ruri of resultUris)if(!results.has(ruri)||results.get(ruri).conflicting)gaps.push({code:results.has(ruri)?'conflicting-result-source':'missing-result',id:identifier(ruri)});
    const eligible=!raw._conflictingSourceObservations&&!ambiguous&&!gaps.some(gap=>['invalid-reference','missing-result','conflicting-result-source'].includes(gap.code)&&gap.field!=='decided_on_a_realization_of'&&gap.field!=='was_motivated_by');
    const subjectUri=eligible&&resultUris.length===1?resultUris[0]:null;
    for(const target of references(raw.decided_on_a_realization_of,'doc')) {
      const entry=components.get(target);
      if(!entry){if(/-SPLIT-\d+-\d+$/.test(target))gaps.push({code:'missing-component',id:identifier(target)});continue;}
      if(!subjectUri)continue;
      const component=entry.component,request=requests.get(component.requestUri),owners=parents.get(component.requestUri)||new Set();
      if(!owners.has(subjectUri)){gaps.push({code:'component-outside-result',id:identifier(target)});continue;}
      if(component.gaps.length||owners.size!==1){gaps.push({code:'ambiguous-component',id:identifier(target),details:component.gaps});continue;}
      if(!request||request.conflicting||term(request.node.had_activity_type)!=='REQUEST_VOTE_SPLIT'){gaps.push({code:'unsupported-component-request',id:identifier(target)});continue;}
      const contextComponents=[...components.values()].filter(other=>other.component.requestUri===component.requestUri).map(other=>other.component).sort((a,b)=>String(a.number).localeCompare(String(b.number),undefined,{numeric:true}));
      parts.push({...component,requestId:identifier(component.requestUri),resultId:identifier(subjectUri),requestScopeByLanguage:labels(request.node.activity_label),contextComponents});
    }
    for(const ruri of references(raw.was_motivated_by)) {
      const entry=requests.get(ruri);
      if(!entry||entry.conflicting){gaps.push({code:entry?'conflicting-request-source':'missing-request',id:identifier(ruri)});continue;}
      if(!subjectUri)continue;
      const owners=parents.get(ruri)||new Set();
      if(!owners.has(subjectUri)){gaps.push({code:'request-outside-result',id:identifier(ruri)});continue;}
      if(owners.size!==1){gaps.push({code:'ambiguous-request-binding',id:identifier(ruri)});continue;}
      if(term(entry.node.had_activity_type)==='REQUEST_VOTE_ROLLCALL')requesters.push({...requestRecord(ruri,entry),binding:'exact-decision-was_motivated_by'});
    }
    if(!resultUris.length)gaps.push({code:'unlinked-result'});
    if(term(raw.decision_method)==='VOTE_ELECTRONIC_ROLLCALL'&&!requesters.length)gaps.push({code:'roll-call-requester-not-established'});
    decisions.set(uri,{subjectId:subjectUri?identifier(subjectUri):null,resultRelationship,parts,rollCallRequesters:requesters,evidenceGaps:gaps,evidencePaths:sourcePaths(snapshot,raw,'decision')});
  }
  const subjects=[];
  for(const [uri,entry] of results) {
    const raw=entry.node,declared=references(raw.consists_of),observed=[...decisions].filter(([,evidence])=>evidence.subjectId===identifier(uri)).map(([uri])=>identifier(uri));
    const gaps=[...invalid(raw,{consists_of:'event',based_on_a_realization_of:'doc',executed:'event'}),...globalGaps];
    for(const duri of declared)if(!decisions.has(duri))gaps.push({code:'missing-declared-decision',id:identifier(duri)});else if(decisions.get(duri).evidenceGaps.some(gap=>gap.code==='conflicting-decision-source'))gaps.push({code:'conflicting-declared-decision',id:identifier(duri)});
    for(const [duri,evidence] of decisions)if(evidence.resultRelationship.binding==='ambiguous'&&[...evidence.resultRelationship.inverseResultIds,...evidence.resultRelationship.forwardResultIds].includes(identifier(uri)))gaps.push({code:'ambiguous-decision-result-binding',id:identifier(duri)});
    if(entry.conflicting)gaps.push({code:'conflicting-result-source'});
    if(!references(raw.executed).length)gaps.push({code:'agenda-context-not-established'});
    if(!references(raw.based_on_a_realization_of,'doc').length)gaps.push({code:'document-context-not-established'});
    subjects.push({id:identifier(uri),uri,titles:entry.conflicting?{}:labels(raw.activity_label),documentIds:entry.conflicting?[]:references(raw.based_on_a_realization_of,'doc').map(identifier),agendaItemIds:entry.conflicting?[]:references(raw.executed).map(identifier),declaredDecisionIds:declared.map(identifier),observedDecisionIds:observed,gaps,evidencePaths:deduplicatePaths(entry.paths)});
  }
  return {decisions,subjects,gaps:globalGaps};
}
