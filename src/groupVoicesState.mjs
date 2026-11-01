import {withBoundaryTies} from './topicPresentation.mjs';
import {GROUP_VOICE_GROUPS,GROUP_VOICE_SUBJECTS} from './groupVoiceTerms.mjs';
export const GROUP_VOICE_DEFAULTS=Object.freeze({group:'PPE',period:'term',person:null,subject:null,tab:'people',q:'',peopleLimit:15,offset:0});
const keys={group:'group',period:'period',person:'person',subject:'subject',tab:'tab',q:'q',peopleLimit:'people-limit',offset:'offset'};
// Links written before PPE/People became the defaults omitted S&D and
// Subjects. Any gv- parameter therefore keeps those legacy fallbacks, and the
// serializer always writes group and tab alongside other state.
const LEGACY_DEFAULTS=Object.freeze({group:'S_D',tab:'subjects'});
export function readGroupVoicesState(params,{now=Date.now()}={}){
  const value=key=>params.get('gv-'+key),legacy=[...params.keys()].some(key=>key.startsWith('gv-')),d={...GROUP_VOICE_DEFAULTS,...(legacy?LEGACY_DEFAULTS:{})};
  const integer=(key,fallback,min,max)=>{const n=value(key);return /^(0|[1-9]\d*)$/.test(n||'')&&Number(n)>=min&&Number(n)<=max?Number(n):fallback;};
  const month=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now)).slice(0,7);
  const rawPeriod=value('period'),period=['term','12m'].includes(rawPeriod)||/^20\d\d-(0[1-9]|1[0-2])$/.test(rawPeriod||'')&&rawPeriod>='2024-07'&&rawPeriod<=month?rawPeriod:d.period;
  return {group:Object.hasOwn(GROUP_VOICE_GROUPS,value('group'))?value('group'):d.group,
    period,
    person:/^[1-9]\d{0,12}$/.test(value('person')||'')?value('person'):null,
    subject:(Object.hasOwn(GROUP_VOICE_SUBJECTS,value('subject'))||/^oeil:\d(?:\.\d{2}){1,3}$/.test(value('subject')||''))?value('subject'):null,
    tab:['people','subjects'].includes(value('tab'))?value('tab'):d.tab,q:(value('q')||'').slice(0,200),
    peopleLimit:integer('people-limit',15,15,Number.MAX_SAFE_INTEGER),offset:integer('offset',0,0,20000)};
}
export function groupVoicesUrl(input,state){
  const url=new URL(input);
  for(const key of [...url.searchParams.keys()])if(key.startsWith('gv-'))url.searchParams.delete(key);
  const changed=Object.keys(keys).some(key=>state[key]!==GROUP_VOICE_DEFAULTS[key]);
  for(const [key,suffix] of Object.entries(keys))if(changed&&(key==='group'||key==='tab')||state[key]!==GROUP_VOICE_DEFAULTS[key]&&state[key]!==null&&state[key]!=='')url.searchParams.set('gv-'+suffix,String(state[key]));
  return url;
}
export function changeGroupVoicesState(state,patch){
  const next={...state,...patch};
  if(['group','period','subject','q'].some(key=>Object.hasOwn(patch,key)&&patch[key]!==state[key]))next.peopleLimit=15;
  if(['group','period','person','subject'].some(key=>Object.hasOwn(patch,key)&&patch[key]!==state[key]))next.offset=0;
  if(Object.hasOwn(patch,'group')&&patch.group!==state.group)next.person=null;
  return next;
}
export function visibleGroupPeople(people,state){
  const q=state.q.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().trim();
  const rows=people.map(person=>({...person,count:state.subject?person.subjects[state.subject]||0:person.total})).filter(person=>person.count>0&&(!q||[person.id,person.name,...(person.nameVariants||[]).map(n=>n.value)].filter(Boolean).join(' ').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().includes(q))).sort((a,b)=>b.count-a.count||(a.name||a.id).localeCompare(b.name||b.id));
  const selected=rows.findIndex(person=>person.id===state.person),limit=Math.max(state.peopleLimit,selected+1);
  const visible=withBoundaryTies(rows,limit,p=>p.count);
  return {rows,visible,hasMore:rows.length>visible.length};
}
