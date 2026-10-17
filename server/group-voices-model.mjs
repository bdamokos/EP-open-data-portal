import {array,tail} from './activity-index-model.mjs';
import {GROUP_VOICE_GROUPS,GROUP_VOICE_SUBJECTS} from '../src/groupVoiceTerms.mjs';
import editorial from './group-voice-subjects.json' with {type:'json'};
import {HttpError} from './http-utils.mjs';

export const GROUP_VOICE_VERSION=editorial.version;
export const GROUP_VOICE_LIMITS=Object.freeze({rows:20000,contributions:50,offset:20000});
const relative=value=>String(value?.id||value||'').replace(/^https?:\/\/data\.europarl\.europa\.eu\//,'');
const personId=value=>relative(value).match(/^person\/([1-9]\d{0,12})$/)?.[1];
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

// A designation belongs to the exact participation node that supplies its
// person. Header wording, office and roster membership never create one.
export function groupVoiceProjection(activity,{fetchedAt,url}={}) {
  const id=activity?.activity_id,day=activity?.activity_date;
  if(tail(activity?.had_activity_type)!=='PLENARY_DEBATE_SPEECH'||!/^MTG-PL-\d{4}-\d{2}-\d{2}-OTH-\d+$/.test(id||'')||!date(day)||id.slice(7,17)!==day||day<'2024-07-16')return null;
  const parents=[...new Set(array(activity.inverse_consists_of).map(relative).flatMap(value=>value.match(/^eli\/dl\/event\/(MTG-PL-\d{4}-\d{2}-\d{2}-[A-Z0-9-]+)$/)?.[1]||[]))];
  const subjects=[...new Set(parents.map(id=>editorial.agendas[id]).filter(Boolean))];
  // Conflicting joint-parent classifications stay unclassified. No title joins.
  const subject=editorial.speeches[id]||(subjects.length===1?subjects[0]:'unclassified');
  const designations=new Map();
  for(const participation of array(activity.had_participation)){
    if(!participation||typeof participation!=='object'||tail(participation.participation_role)!=='SPEAKER')continue;
    const persons=[...new Set(array(participation.had_participant_person).map(personId).filter(Boolean))];
    const groups=[...new Set(array(participation.participation_in_name_of).map(relative).flatMap(value=>value.match(/^org\/([A-Z0-9_]+)$/)?.[1]||[]).filter(id=>Object.hasOwn(GROUP_VOICE_GROUPS,id)))];
    for(const person of persons)for(const group of groups){
      const key=person+'|'+group,entry=designations.get(key)||{person,group,participationIds:[]};
      if(typeof participation.id==='string'&&!entry.participationIds.includes(participation.id))entry.participationIds.push(participation.id);
      designations.set(key,entry);
    }
  }
  return {version:GROUP_VOICE_VERSION,id,date:day,subject,subjectBasis:subject==='unclassified'?'unclassified':'editorial',parentIds:parents,designations:[...designations.values()],source:{url:url||'https://data.europarl.europa.eu/api/v2/speeches/'+id+'?format=application%2Fld%2Bjson',fetchedAt:fetchedAt||null}};
}

export function groupVoicesQuery(params,{now=Date.now()}={}){
  for(const key of params.keys())if(!['lang','group','period','person','subject','offset','limit','part'].includes(key)||params.getAll(key).length!==1)throw new HttpError(400,'invalid_query','Unsupported or repeated group-voices parameter.');
  const group=params.get('group')||'PPE',period=params.get('period')||'term',person=params.get('person')||null,subject=params.get('subject')||null,part=params.get('part')||'summary';
  if(!Object.hasOwn(GROUP_VOICE_GROUPS,group))throw new HttpError(400,'invalid_group','Choose a recorded political group.');
  if(!['term','12m'].includes(period)&&!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period))throw new HttpError(400,'invalid_period','Choose the current term, last 12 months or a month.');
  if(person&&!/^[1-9]\d{0,12}$/.test(person))throw new HttpError(400,'invalid_person','Invalid person identifier.');
  if(subject&&!Object.hasOwn(GROUP_VOICE_SUBJECTS,subject))throw new HttpError(400,'invalid_subject','Choose a subject.');
  if(!['summary','contributions'].includes(part))throw new HttpError(400,'invalid_query','Invalid group-voices response.');
  const integer=(key,fallback,max)=>{const raw=params.get(key);if(raw===null)return fallback;if(!/^(0|[1-9]\d{0,5})$/.test(raw)||Number(raw)>max)throw new HttpError(400,'invalid_query','Invalid '+key+'.');return Number(raw);};
  const offset=integer('offset',0,GROUP_VOICE_LIMITS.offset),limit=integer('limit',20,GROUP_VOICE_LIMITS.contributions);
  if(limit<1)throw new HttpError(400,'invalid_query','Invalid limit.');
  const end=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  let from='2024-07-16',to=end;
  if(period==='12m')from=new Date(Date.parse(end+'T12:00Z')-365*86400_000).toISOString().slice(0,10);
  else if(period!=='term'){from=period+'-01';to=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).toISOString().slice(0,10);}
  if(from<'2024-07-16')from='2024-07-16';
  if(from>to||from>end)throw new HttpError(400,'invalid_period','Choose a month within the current term.');
  to=to>end?end:to;
  return {group,period,person,subject,part,offset,limit,from,to,language:params.get('lang')||'en'};
}
