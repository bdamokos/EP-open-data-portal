import {plenaryMonday as calendarMonday,groupPlenaryWeeks} from './plenaryPeriods.mjs';
import {humanDate} from './InsightCharts';
export type Sitting={id:string;date:string;phase?:string};
export function plenaryMonday(date:string){return calendarMonday(date)||date;}
// Plenary views default to the whole week of the most recent held sitting; single sittings remain selectable.
export const latestHeldSitting=(sittings:Sitting[],available=true)=>available?[...sittings].filter(s=>s.phase!=='upcoming').sort((a,b)=>b.date.localeCompare(a.date))[0]||sittings[0]:undefined;
export const weekPeriod=(sitting:Sitting|undefined)=>sitting?'week:'+plenaryMonday(sitting.date):'';
export function PlenaryPeriodSelect({value,sittings,language,onChange,includeLatest=false}:{value:string;sittings:Sitting[];language:string;onChange:(period:string)=>void;includeLatest?:boolean}) {
  const weeks=groupPlenaryWeeks(sittings).map(item=>item.week),upcoming=(week:string)=>sittings.filter(s=>plenaryMonday(s.date)===week).every(s=>s.phase==='upcoming');
  const missing=value&&!weeks.some(week=>value==='week:'+week)&&!sittings.some(s=>value==='sitting:'+s.id)&&!(includeLatest&&value==='week:latest');
  const date=value.slice(5),missingLabel=value.startsWith('week:')&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))?'Week of '+humanDate(date,language):value.startsWith('sitting:')?'Sitting '+value.slice(8):value;
  return <label lang="en">Period<select value={value} onChange={event=>onChange(event.target.value)}>{!value&&<option value="" disabled>Choose a period</option>}{includeLatest&&<option value="week:latest">Latest plenary week</option>}{missing&&<option value={value} lang={language==='en'?'en':''}>{missingLabel}</option>}<optgroup lang="en" label="Plenary weeks">{weeks.map(week=><option lang={language==='en'?'en':''} key={week} value={'week:'+week}>Week of {humanDate(week,language)}{upcoming(week)?' · upcoming':''}</option>)}</optgroup><optgroup lang="en" label="Single sittings">{sittings.map(s=><option lang={s.phase==='upcoming'&&language!=='en'?'':language} key={s.id} value={'sitting:'+s.id}>{humanDate(s.date,language)}{s.phase==='upcoming'?' · upcoming':''}</option>)}</optgroup></select></label>;
}
export function SittingCalendarNotice({complete}:{complete?:boolean}) {return complete===false?<p lang="en" className="insight-secondary" role="status">Some sitting dates unavailable.</p>:null;}
