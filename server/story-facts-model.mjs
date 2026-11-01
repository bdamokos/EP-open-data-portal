import {suppliedTitles} from './insights-model.mjs';
import {countryIdentity} from './topic-country-identity.mjs';
import {countryConcepts,eurovocCountries} from './topic-roles.mjs';
import {titlePlaces} from './insights-places.mjs';
import {GROUP_VOICE_GROUPS} from '../src/groupVoiceTerms.mjs';
export const STORY_FACTS_VERSION=7;
export const array=v=>v==null?[]:Array.isArray(v)?v:[v];
export const tail=v=>String(v?.id||v||'').split('/').at(-1);
export const unique=v=>[...new Set(v)];
export const titles=v=>typeof v==='string'?{en:v}:v&&typeof v==='object'?v:{};
export const refs=v=>unique(array(v).map(tail).filter(Boolean));
export const sourceTime=v=>typeof v==='number'||/^\d{13}$/.test(String(v))?new Date(Number(v)).toISOString():v;
export const storyReference=id=>{const m=id.match(/^(A|B|RC)-(\d+)-(\d{4})-(\d{4})$/);return m?(m[1]==='RC'?'RC-B':m[1])+m[2]+'-'+m[4]+'/'+m[3]:null;};
export function storyDocument(w,source){
 const type=tail(w.work_type),id=w.identifier;if(!['RESOLUTION_MOTION','RESOLUTION_MOTION_JOINT','REPORT_PLENARY','RECOMMENDATION_REPORT'].includes(type)||!id)return null;
 const groups=unique([...refs(w.creator),...array(w.workHadParticipation).filter(p=>tail(p.participation_role)==='AUTHOR').flatMap(p=>refs(p.participation_in_name_of))].filter(id=>Object.hasOwn(GROUP_VOICE_GROUPS,id)));
 const places=[],keywords=[];for(const raw of array(w.is_about)){const uri=String(raw?.id||raw),p=eurovocCountries.get(uri);if(p){const id=countryIdentity(p)?.id;if(id)places.push(id);}else if(!countryConcepts.has(uri)&&/^http:\/\/eurovoc\.europa\.eu\//.test(uri))keywords.push(tail(uri));}
 const events=refs(w.inverse_based_on_a_realization_of);
 return {id,reference:storyReference(id),type,date:w.document_date||null,titles:suppliedTitles(w),rule:unique(refs(w.based_on).map(id=>id.match(/ITM-A(\d+)$/)?.[1]).filter(Boolean)),groups,groupsAvailable:Object.hasOwn(w,'creator')||Object.hasOwn(w,'workHadParticipation'),places:unique(places),keywords:unique(keywords),procedures:refs(w.inverse_created_a_realization_of),derivedFrom:refs(w.is_derivative_of),events,source};
}
export function storyAgenda(w,source){
 const id=w.activity_id||tail(w.id);if(!/OJ-ITM-[DV]-/.test(id))return null;
 const formats={};for(const [lang,content] of Object.entries(titles(w.structuredContent)))formats[lang]=[...String(content).matchAll(/<type\b[^>]*>([\s\S]*?)<\/type>/g)].map(m=>m[1].replace(/<[^>]*>/g,' ').replaceAll('&amp;','&').replaceAll('&#39;',"'").replace(/\s+/g,' ').trim());
 return {id,date:w.activity_date||id.slice(7,17),titles:titles(w.activity_label),headings:titles(w.headingLabel),formats,procedures:refs(w.inverse_was_scheduled_in),type:tail(w.had_activity_type),relationships:Object.fromEntries(['executed','based_on_a_realization_of','inverse_consists_of','inverse_was_scheduled_in'].filter(f=>Object.hasOwn(w,f)).map(f=>[f,w[f]])),source};
}
export function storyDecision(w,source){
 const id=w.activity_id||tail(w.id);if(!id)return null;
 const code=value=>{const all=refs(value);return all.length===1?all[0]:null;};
 const count=v=>Number.isSafeInteger(Number(v))&&v!==null&&v!==undefined&&v!==''&&Number(v)>=0?Number(v):null;
 return {id,date:w.activity_date||null,outcome:code(w.decision_outcome),decisionMethod:code(w.decision_method),for:count(w.number_of_votes_favor),against:count(w.number_of_votes_against),abstentions:count(w.number_of_votes_abstention),labels:titles(w.activity_label),headings:titles(w.headingLabel),references:titles(w.referenceText),on:refs(w.decided_on_a_realization_of),results:refs(w.inverse_consists_of),source};
}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function wholeTextOutcome(doc,candidates){
 if(!doc.reference)return {outcome:null,outcomeStatus:'unknown'};
 const whole=new RegExp('^'+escape(doc.reference)+' [–—-] (?:.* [–—-] )?(Motion for a resolution(?: \\(as a whole\\))?|Single vote|Proposal for a decision|Draft legislative resolution|Provisional agreement [–—-] Am \\d+|Motion for a decision)$');
 const heading=new RegExp('^(Joint motion|Motion) for a resolution '+escape(doc.reference)+'(?:\\s|$)');
 const ranked=[];for(const d of new Map(candidates.map(d=>[d.id,d])).values()){
  if(d.conflicted||!['ADOPTED','REJECTED','LAPSED'].includes(d.outcome))continue;
  const label=d.labels?.en||'',ref=d.references?.en||'',head=d.headings?.en||'';
  if(!whole.test(label)&&!(label===''&&heading.test(head)&&/^(Motion for a resolution(?: \(as a whole\))?|Single vote)$/.test(ref)))continue;
  const stage=label||ref,am=stage.match(/Provisional agreement [–—-] Am (\d+)$/);
  if(am&&!d.on.includes(doc.id+'-AM-'+am[1]))continue;
  const priority=am?0:['Single vote','Draft legislative resolution','Proposal for a decision','Motion for a decision','Motion for a resolution'].findIndex(x=>stage.includes(x))+1;
  ranked.push({d,priority});
 }
 ranked.sort((a,b)=>a.priority-b.priority||a.d.id.localeCompare(b.d.id));
 if(!ranked.length)return {outcome:null,outcomeStatus:'unknown'};
 if(ranked[1]?.priority===ranked[0].priority)return {outcome:null,outcomeStatus:'ambiguous',outcomeCandidates:ranked.filter(x=>x.priority===ranked[0].priority).map(x=>x.d.id)};
 const d=ranked[0].d,hand=d.decisionMethod==='VOTE_HAND';
 return {outcome:{decisionId:d.id,id:d.id,date:d.date,outcome:d.outcome,for:hand?null:d.for,against:hand?null:d.against,abstentions:hand?null:d.abstentions,decisionMethod:d.decisionMethod,method:hand?'show-of-hands':d.decisionMethod,labels:d.labels,references:d.references,source:d.source},outcomeStatus:'known'};
}
export function debateAgenda(event,documents){
 if(event?.conflicted)return {agendaId:null,agendaVia:null,agendaConflict:true};
 const executed=unique((event?.executed||[]).filter(id=>id.includes('OJ-ITM-D-')));
 if(executed.length)return executed.length===1?{agendaId:executed[0],agendaVia:'executed'}:{agendaId:null,agendaVia:null,agendaConflict:true};
 const linked=unique(documents.flatMap(d=>d.events.filter(id=>id.includes('OJ-ITM-D-'))));
 return {agendaId:linked.length===1?linked[0]:null,agendaVia:linked.length===1?'document':null};
}
export function debateFormat(agenda,docs){
 if(docs.some(d=>d.rule.includes('150')))return 'urgency';
 const formats=agenda?.formats?.en||[];
 if(formats.some(f=>/breaches of human rights/i.test(f)))return 'urgency';
 if(formats.some(f=>/topical debate/i.test(f)))return 'topical';
 if(formats.some(f=>/European Council and Commission statements/.test(f)))return 'eucouncil';
 if(formats.some(f=>/^Council and Commission statements/.test(f)))return 'council-commission';
 if(formats.some(f=>/^Commission statement/.test(f)))return 'commission';
 if(formats.some(f=>/High Representative/.test(f)))return 'hrvp';
 if(formats.some(f=>/President of the Commission/.test(f)))return 'president';
 if(formats.some(f=>/^Oral question/.test(f)))return 'oral-question';
 if(formats.some(f=>/^(Report|Recommendation)/.test(f)))return 'report';
 if(formats.some(f=>/Parliament's statements/.test(f)))return 'statements';
 return null;
}
export function debatePlaces(title,official,format){
 const named=unique(titlePlaces(title||'').places.map(p=>countryIdentity(p.id)?.id).filter(Boolean)),indexed=unique(official),both=named.filter(id=>indexed.includes(id));
 const primaryPlace=named.length===1?named[0]:both.length===1?both[0]:format==='urgency'&&named.length===0&&indexed.length===1?indexed[0]:null;
 const ids=unique([...named,...(primaryPlace?[primaryPlace]:[])]);
 return {primaryPlace,places:ids.map(id=>({id,basis:named.includes(id)?'title':'official',bases:[...(named.includes(id)?['title']:[]),...(indexed.includes(id)?['official']:[])]})),placeKeywords:indexed};
}
export function speakerEligible(item,header){
 if(item.speechKind!=='PLENARY_DEBATE_SPEECH')return false;
 const role=tail(item.speechRole||item.intervention?.kind||item.role).toUpperCase();
 if(['CHAIR','CHAIRING','PRESIDENT'].includes(role))return false;
 return !header?.capacity||header.capacity==='member';
}

// Only published agenda classifications exclude procedural contributions.
// A debate heading is never evidence for this decision.
export function proceduralAgenda(agenda){
 if(!agenda||agenda.conflicted)return false;
 const type=tail(agenda.type);
 if(['PLENARY_VOTE','PLENARY_VOTE_RESULTS','PLENARY_OUTCOME','REQUEST_VOTE_URGENCY','EXPLANATIONS_OF_VOTES','EXPLANATION_OF_VOTE','PLENARY_EXPLANATION_OF_VOTE','PLENARY_EXPLANATIONS_OF_VOTES','OPENING_OF_SITTING','CLOSING_OF_SITTING','PLENARY_OPENING','PLENARY_CLOSING','MINUTES','APPROVAL_OF_MINUTES','ORDER_OF_BUSINESS'].includes(type))return true;
 return (agenda.formats?.en||[]).some(value=>/^(?:voting time|explanations? of votes?|opening(?: of (?:the )?(?:sitting|session))?|closing(?: of (?:the )?(?:sitting|session))?|closure of (?:the )?(?:sitting|session)|minutes|approval of (?:the )?minutes|order of business)\s*[:.]?$/i.test(value));
}
