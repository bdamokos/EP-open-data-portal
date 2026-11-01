import {countryIdentity} from './topic-country-identity.mjs';
import eurovocLabels from './topic-eurovoc-labels.json' with {type:'json'};
import {assignmentRole,countryConcepts,eurovocCountries,countryLabels} from './topic-roles.mjs';
import {titlePlaces} from './insights-places.mjs';

export const RECORD_TOPICS_VERSION=6;
const array=v=>v==null?[]:Array.isArray(v)?v:[v];
const canonical=v=>String(v?.id||v||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
const tail=v=>canonical(v).split('/').at(-1);
export const validTopicKey=value=>/^(?:place:[A-Z0-9_]{2,8}|eurovoc:(?:\d{1,8}|c_[A-Za-z0-9_]{1,40})|oeil:\d(?:\.\d{2}){1,3}|subject-matter:[A-Z0-9_-]{1,40})$/.test(value||'');
export const validTopicRecord=value=>/^(?:(?:A|B|C|RC|O|E|P|TA)-(?:9|10)-\d{4}-[A-Z0-9-]{1,40}|MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]{1,80}|\d{4}-\d{4}[A-Z]?)$/.test(value||'');
export function conceptIdentity(uri){
 const value=String(uri?.id||uri||'');
 const eurovoc=value.match(/^http:\/\/eurovoc\.europa\.eu\/(\d{1,8}|c_[A-Za-z0-9_]{1,40})$/);
 if(eurovoc)return {key:'eurovoc:'+eurovoc[1],uri:value,scheme:'eurovoc'};
 const subject=value.match(/^http:\/\/publications\.europa\.eu\/resource\/authority\/subject-matter\/([A-Z0-9_-]{1,40})$/);
 return subject?{key:'subject-matter:'+subject[1],uri:value,scheme:'subject-matter'}:null;
}
const unique=values=>[...new Set(values)];
const evidence=(node)=>node.source?[node.source]:[];
function add(record,key,path){
 if(!validTopicKey(key))return;
 let a=record.assignments.find(a=>a.key===key);if(!a){a={key,role:assignmentRole(key),paths:[]};record.assignments.push(a);}
 if(!a.paths.some(p=>JSON.stringify(p.steps)===JSON.stringify(path.steps)))a.paths.push(path);
}
function inherit(record,from,field,to,assignments,basis='context',extraSources=[]){
 for(const a of assignments)for(const path of a.paths)add(record,a.key,{basis,steps:[{from,field,to},...path.steps],sources:[...new Map([...evidence(record),...extraSources,...path.sources].map(s=>[s.url+'|'+s.fetchedAt,s])).values()]});
}

// Inputs are retained official observations. This function performs no I/O.
// Parent conflicts withhold context even when candidate classifications agree.
export function projectRecordTopics(nodes,options={}){
 const work=projectTopicSteps(nodes,options);let step;do{step=work.next();}while(!step.done);return step.value;
}
export function* projectTopicSteps(nodes,{concepts=new Map(),procedureTopics=new Map(),map=()=>new Map(),stream=false}={}){
 for(const [key,c] of concepts){const identity=conceptIdentity(c.uri);if(identity?.key===key)concepts.set(key,{...c,...identity,labels:{...(eurovocLabels.labels[c.uri]?{en:eurovocLabels.labels[c.uri]}:{}),...c.labels}});}
 const records=map("records"),documents=map("documents"),procedures=map("procedures"),events=map("events"),documentEvents=map("document_events");
 for(const node of nodes){yield;
  if(!validTopicRecord(node.id))continue;
  const r={id:node.id,kind:node.kind,activityType:node.activityType,reference:node.reference||null,date:node.date||null,titles:node.titles||{},members:node.members||[],parentIds:node.parentIds||[],procedureIds:node.procedureIds||[],agendaIds:node.conflicted?[]:node.executed||[],source:node.source,titleSource:node.titleSource,assignments:[],status:node.conflicted?'ambiguous':'not-classified'};
  records.set(r.id,r);
  if(node.kind==='document'||node.kind==='question')documents.set(r.id,node);
  else if(node.kind==='procedure')procedures.set(r.id,node);
  else if(node.kind==='event'){events.set(r.id,node);for(const docId of node.documentIds||[])documentEvents.set(docId,unique([...(documentEvents.get(docId)||[]),r.id]));}
 }
 for(const [id,node] of documents){yield;
  const r=records.get(id);if(node.conflicted||node.kind==='question')continue;
  for(const [field,uris] of [['is_about',node.eurovoc],['isAboutSubjectMatter',node.subjectMatter]])for(const uri of uris||[]){const c=conceptIdentity(uri);if(!c)continue;if(!concepts.has(c.key))concepts.set(c.key,{...c,labels:eurovocLabels.labels[c.uri]?{en:eurovocLabels.labels[c.uri]}:{},labelSource:{url:eurovocLabels.sourceUrl,fetchedAt:eurovocLabels.fetchedAt}});add(r,c.key,{basis:'direct',steps:[{from:id,field,to:c.uri}],sources:evidence(r)});}
  records.set(id,r);
 }
 for(const [id,node] of procedures){yield;
  const r=records.get(id),official=procedureTopics.get(id);if(node.conflicted)continue;
  if(official?.reference&&node.reference===official.reference)for(const a of official.assignments||[]){
   if(!concepts.has(a.concept.key))concepts.set(a.concept.key,a.concept);
   add(r,a.concept.key,{basis:a.basis||'direct',steps:a.steps,sources:[...evidence(r),...a.sources]});
  }
  records.set(id,r);
 }
 for(const [id,node] of documents){yield;if(node.kind==='document'&&!node.conflicted){const r=records.get(id);for(const pid of node.procedureIds||[]){const p=records.get(pid);if(p)inherit(r,id,'inverse_created_a_realization_of',pid,p.assignments.map(a=>({...a,paths:a.paths.filter(p=>!p.steps.some(s=>s.to===id))})).filter(a=>a.paths.length),'procedure');}records.set(id,r);}}
 // An actual event may carry explicit procedure/document links without a
 // scheduled counterpart. Never manufacture an OJ/PVCRE ID from its number.
 for(const [id,node] of events){yield;
  const r=records.get(id);if(node.conflicted)continue;
  r.procedureIds=(node.procedureEdges||[]).map(e=>e.id);
  if(!r.procedureIds.length&&!r.assignments.length)r.status='not-linked';
  for(const docId of node.documentIds||[]){const doc=records.get(docId),edge=node.documentEdges?.find(e=>e.id===docId);if(doc){if(!/\/(?:PLENARY_VOTE|PLENARY_VOTE_RESULTS|PLENARY_OUTCOME)$/.test(node.activityType||''))doc.eventIds=unique([...(doc.eventIds||[]),id]);records.set(docId,doc);inherit(r,id,edge?.field||'based_on_a_realization_of',docId,doc.assignments,'debate',edge?.source?[edge.source]:[]);}}
  for(const edge of node.procedureEdges||[]){const p=records.get(edge.id);if(p)inherit(r,id,edge.field,edge.id,p.assignments,'debate',edge.source?[edge.source]:[]);}
  records.set(id,r);
 }
 for(const [id,node] of events){yield;if(!node.conflicted){const r=records.get(id);for(const scheduled of node.executed||[]){const agenda=records.get(scheduled);if(agenda)inherit(r,id,'executed',scheduled,agenda.assignments,'debate',node.executedSource?[node.executedSource]:[]);}records.set(id,r);}}
 for(const [id,node] of documents){yield;
  const r=records.get(id);if(node.conflicted)continue;
  if(node.kind==='question'&&id.startsWith('O-')){for(const eventId of documentEvents.get(id)||[]){const event=events.get(eventId);const edge=event.documentEdges?.find(e=>e.id===id);inherit(r,id,edge?.field?.endsWith(' (inverse)')?edge.field.slice(0,-10):'based_on_a_realization_of (inverse)',eventId,records.get(eventId).assignments,'debate',edge?.source?[edge.source]:[]);}}
  records.set(id,r);
 }
 for(const node of nodes){yield;if(node.kind!=='speech')continue;
  const r=records.get(node.id);if(!r)continue;
  if(node.conflicted)continue;const parents=unique(node.parentIds||[]);
  if(parents.length!==1){r.status=parents.length?'ambiguous':'not-linked';records.set(r.id,r);continue;}
  const parent=records.get(parents[0]);if(parent?.status==='ambiguous'){r.status='ambiguous';records.set(r.id,r);continue;}if(parent)inherit(r,node.id,'inverse_consists_of',parent.id,parent.assignments,'debate');
  else r.status='parent-not-retained';
  records.set(r.id,r);
 }
 for(const r of records.values()){yield;
  r.assignments=r.assignments.flatMap(a=>{const uri='http://eurovoc.europa.eu/'+a.key.slice(8),country=eurovocCountries.get(uri);if(a.key.startsWith('eurovoc:')&&countryConcepts.has(uri)&&!country)return [{...a,role:'hidden'}];if(!a.key.startsWith('eurovoc:')||!country)return [a];if(!countryIdentity(country))return [{...a,role:'hidden'}];const key='place:'+country;if(!concepts.has(key))concepts.set(key,{key,role:'place',uri:'http://publications.europa.eu/resource/authority/country/'+country,labels:{en:countryLabels.get(country)||country}});return [{...a,key,role:'place'}];});
  if(r.kind==='question'){
   if(!r.id.startsWith('O-'))r.assignments=[];
   r.assignments=r.assignments.filter(a=>a.role!=='place');
   for(const rawPlace of titlePlaces(r.titles.en||Object.values(r.titles)[0]||'').places){const identity=countryIdentity(rawPlace.id);if(!identity)continue;const p={...rawPlace,...identity,label:countryLabels.get(identity.id)||rawPlace.label},key='place:'+p.id;concepts.set(key,{key,role:'place',uri:'http://publications.europa.eu/resource/authority/country/'+p.id,labels:{en:p.label}});add(r,key,{basis:'title',steps:[],sources:r.titleSource?[r.titleSource]:evidence(r)});}
  }
  r.assignments=[...new Map(r.assignments.map(a=>[a.key,a])).values()];
  if(r.assignments.some(a=>a.role==='topic'||a.role==='keyword'))r.status='classified';
  records.set(r.id,r);
 }
 for(const c of concepts.values()){c.role=countryConcepts.has(c.uri)?'hidden':assignmentRole(c.key);concepts.set(c.key,c);}
 return {records:stream?records:[...records.values()],concepts:stream?concepts:[...concepts.values()]};
}
