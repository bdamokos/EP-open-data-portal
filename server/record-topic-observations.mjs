import {authorEvidence,suppliedTitles} from './insights-model.mjs';
import {outsideSpeech} from './outside-model.mjs';
import {classifyProcedure} from './insights-legislation-model.mjs';
const arr=x=>x==null?[]:Array.isArray(x)?x:[x],tail=x=>String(x?.id||x||'').split('/').at(-1);
const refs=x=>arr(x).map(tail),unique=x=>[...new Set(x)],at=s=>Date.parse(s?.fetchedAt||'')||0;
const person=x=>String(x?.id||x||'').match(/(?:^|\/)person\/(\d+)$/)?.[1];
const fields=['based_on_a_realization_of','inverse_consists_of','inverse_was_scheduled_in','executed'];
const topology=w=>JSON.stringify(Object.fromEntries(['is_about','isAboutSubjectMatter','inverse_created_a_realization_of','inverse_based_on_a_realization_of','inverse_decided_on_a_realization_of',...fields,'consists_of'].filter(k=>Object.hasOwn(w,k)).map(k=>[k,k==='consists_of'?arr(w[k]).map(c=>typeof c==='object'?{id:tail(c.id||c.activity_id),topology:topology(c)}:tail(c)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):refs(w[k]).sort()])));

// Embedded event shapes publish a subset of fields. Resolve each supplied
// relationship observation separately; an omitted embedded field is not a
// retraction of a field supplied by the full event endpoint.
export function topicObservationNodes(observations){const steps=topicObservationSteps(observations);let step;do{step=steps.next();}while(!step.done);return step.value;}
export function* topicObservationSteps(observations,{map=()=>new Map(),stream=false}={}){
 const latest=map('latest'),compact=map('compact'),eventFields=map('event_fields');
 const saveField=(values,key,value)=>{values[key]=value;};
 function* expand(){for(const o of observations){yield o;for(const child of arr(o.work?.consists_of)){const id=tail(child?.id||child?.activity_id);if(typeof child==='object'&&id.startsWith('MTG-PL-')&&fields.some(k=>Object.hasOwn(child,k)))yield {work:{...child,activity_id:id},source:o.source,projection:'embedded-event'};}}}
 const expanded=expand();
 for(const o of expanded){yield;
  const {work:w,source:s,projection}=o;if(!w)continue;const outside=w.outside||w,id=outside.identifier||outside.activity_id||tail(outside.id);if(!id)continue;
  const speech=projection==='speech'||projection==='outside-speech'||/\/(?:PLENARY_DEBATE_SPEECH|PLENARY_DEBATE_WRITTEN_STATEMENT)$/.test(w.had_activity_type||'');
  const event=Boolean(w.activity_id&&!speech);
  if(event){
   const values=eventFields.get(id)||{};
   for(const field of fields){if(projection==='embedded-event'&&!Object.hasOwn(w,field))continue;const value=refs(w[field]).sort(),old=values[field];if(!old||at(s)>at(old.source))saveField(values,field,{value,source:s,procedureIds:arr(w[field]).filter(v=>/(?:^|\/)eli\/dl\/proc\//.test(String(v?.id||v))).map(tail)});else if(at(s)===at(old.source)&&JSON.stringify(value)!==JSON.stringify(old.value))saveField(values,field,{...old,conflicted:true});}
   eventFields.set(id,values);
  }
  const map=projection==='outside-agenda'?compact:latest,old=map.get(id);
  if(!old||at(s)>at(old.source))map.set(id,{...o,id});
  else if(at(s)===at(old.source)&&!event){
   if(speech){
    const parents=o=>{const v=o.work.outside||o.work;if(['speech','outside-speech'].includes(o.projection))return refs(v.parentIds).sort();return (outsideSpeech(o.work,o.source?.fetchedAt,o.source?.url)?.parentIds||refs(o.work.inverse_consists_of)).sort();};
    if(JSON.stringify(parents(o))!==JSON.stringify(parents(old)))map.set(id,{...old,conflicted:true});
    else if(['speech','outside-speech'].includes(projection)&&old.projection==='raw')map.set(id,{...o,id,conflicted:old.conflicted});
   }else if(topology(w)!==topology(old.work))map.set(id,{...old,conflicted:true});
  }
 }
 const nodes=map('nodes');
 for(const [id,o] of compact){yield;const w=o.work;nodes.set(id,{id,kind:'event',date:w.date,titles:w.titles||{},source:w.source||o.source});}
 for(const [id,o] of latest){yield;
  const {work:w,source:s,projection,conflicted}=o;
  if(projection==='speech'||projection==='outside-speech'){
   const v=w.outside||w;nodes.set(id,{id,kind:'speech',date:v.date,titles:v.titles||{},members:v.participants||[],parentIds:conflicted?[]:v.parentIds||[],conflicted,source:v.source||s});
  }else if(w.work_type&&w.identifier){nodes.set(id,{id,kind:/\/QUESTION_/.test(w.work_type)?'question':'document',date:w.document_date,titles:suppliedTitles(w),members:/\/QUESTION_/.test(w.work_type)?authorEvidence(w,'',s?.fetchedAt).map(a=>a.id):unique([...arr(w.creator),...arr(w.workHadParticipation).flatMap(p=>arr(p.had_participant_person))].map(person).filter(Boolean)),eurovoc:conflicted?[]:arr(w.is_about),subjectMatter:conflicted?[]:arr(w.isAboutSubjectMatter),procedureIds:conflicted?[]:refs(w.inverse_created_a_realization_of),source:s,conflicted});
  }else if(String(w.id).includes('/proc/')){
   const code=classifyProcedure(w).code,reference=typeof w.label==='string'&&/^\d{4}\/\d{4}[A-Z]?\([A-Z]+\)$/.test(w.label)?w.label:code?id.replace('-','/')+'('+code+')':null;
   nodes.set(id,{id,kind:'procedure',reference:conflicted?null:reference,titles:typeof w.process_title==='string'?{en:w.process_title}:w.process_title||{},source:s,conflicted});
  }else if(w.activity_id){
   const speech=/\/(?:PLENARY_DEBATE_SPEECH|PLENARY_DEBATE_WRITTEN_STATEMENT)$/.test(w.had_activity_type||'');
   if(speech){const v=outsideSpeech(w,s.fetchedAt,s.url);if(v)nodes.set(id,{id,kind:'speech',date:v.date,titles:v.titles,members:v.participants,parentIds:conflicted?[]:v.parentIds,source:s,conflicted});}
   else{const metadata=nodes.get(id);nodes.set(id,{...metadata,id,kind:'event',activityType:w.had_activity_type,date:w.activity_date||metadata?.date,titles:w.activity_label||metadata?.titles||{},source:s});}
  }
 }
 function event(id,s){if(!nodes.has(id))nodes.set(id,{id,kind:'event',titles:{},source:s});return nodes.get(id);}
 for(const [id,values] of eventFields){yield;const e=event(id,Object.values(values)[0]?.source);e.conflicted=Object.values(values).some(v=>v.conflicted);const executed=values.executed;e.executed=e.conflicted?[]:executed?.value||[];e.executedSource=executed?.source;nodes.set(id,e);}
 function documentEdge(eventId,docId,field,s){
  const e=event(eventId,s),own=eventFields.get(eventId)?.based_on_a_realization_of,doc=latest.get(docId);if(e.conflicted||doc?.conflicted)return;
  if(own&&at(own.source)>=at(s)&&!own.value.includes(docId))return;
  if(doc&&at(doc.source)>=at(s)&&Object.hasOwn(doc.work,'inverse_based_on_a_realization_of')&&!refs(doc.work.inverse_based_on_a_realization_of).includes(eventId)&&field==='based_on_a_realization_of')return;
  e.documentIds=unique([...(e.documentIds||[]),docId]);e.documentEdges=[...(e.documentEdges||[]),{id:docId,field,source:s}];nodes.set(eventId,e);
 }
 function procedureEdge(eventId,procId,field,s){
  const e=event(eventId,s),proc=latest.get(procId);if(e.conflicted||proc?.conflicted)return;
  const reverse=field==='inverse_was_scheduled_in'?'was_scheduled_in':'consists_of';
  if(proc&&at(proc.source)>=at(s)&&Object.hasOwn(proc.work,reverse)&&!refs(proc.work[reverse]).includes(eventId))return;
  const own=eventFields.get(eventId)?.inverse_consists_of;if(own&&at(own.source)>=at(s)&&field==='consists_of (inverse)'&&!own.value.includes(procId))return;
  e.procedureIds=unique([...(e.procedureIds||[]),procId]);e.procedureEdges=[...(e.procedureEdges||[]),{id:procId,field,source:s}];nodes.set(eventId,e);
 }
 for(const [id,o] of latest){yield;
  if(o.conflicted)continue;const {work:w,source:s}=o;
  if(w.work_type){for(const field of ['inverse_based_on_a_realization_of','inverse_decided_on_a_realization_of'])for(const eventId of refs(w[field]))if(eventId.startsWith('MTG-PL-'))documentEdge(eventId,id,field+' (inverse)',s);}
  else if(String(w.id).includes('/proc/'))for(const child of arr(w.consists_of)){const eventId=child.activity_id||tail(child.id);if(eventId?.startsWith('MTG-PL-'))procedureEdge(eventId,id,'consists_of (inverse)',s);}
 }
 for(const [id,values] of eventFields){yield;
  const docs=values.based_on_a_realization_of;for(const doc of docs?.value||[])documentEdge(id,doc,'based_on_a_realization_of',docs.source);
  for(const field of ['inverse_consists_of','inverse_was_scheduled_in']){const relationship=values[field];for(const procId of relationship?.value||[])if(relationship.procedureIds?.includes(procId)||latest.get(procId)?.work.id?.includes('/proc/'))procedureEdge(id,procId,field,relationship.source);}
 }
 return stream?nodes:[...nodes.values()];
}
