import {UiMessage, useUiI18n} from './UiI18nReact';
import {plenaryMonday as calendarMonday,groupPlenaryWeeks} from './plenaryPeriods.mjs';
import {humanDate} from './InsightCharts';
export type Sitting={id:string;date:string;phase?:string};
export function plenaryMonday(date:string){return calendarMonday(date)||date;}
// Plenary views default to the whole week of the most recent held sitting; single sittings remain selectable.
export const latestHeldSitting=(sittings:Sitting[],available=true)=>available ? ([...sittings].filter(s=>s.phase!=='upcoming').sort((a,b)=>b.date.localeCompare(a.date))[0]||sittings[0]) : undefined;
export const weekPeriod=(sitting:Sitting|undefined)=>sitting ? ('week:'+plenaryMonday(sitting.date)) : '';
export function PlenaryPeriodSelect({value,sittings,language,onChange,includeLatest=false}:{value:string;sittings:Sitting[];language:string;onChange:(period:string)=>void;includeLatest?:boolean}) {
  const ui = useUiI18n();
  const weeks=groupPlenaryWeeks(sittings).map(item=>item.week),upcoming=(week:string)=>sittings.filter(s=>plenaryMonday(s.date)===week).every(s=>s.phase==='upcoming');
  const missing=value&&!weeks.some(week=>value==='week:'+week)&&!sittings.some(s=>value==='sitting:'+s.id)&&!(includeLatest&&value==='week:latest');
  const date=value.slice(5),missingLabel=((value.startsWith('week:') && /^\d{4}-\d{2}-\d{2}$/.test(date)) && Number.isFinite(Date.parse(date))) ? ui.t("membervotes.tsx.week.of.date", {date: String(humanDate(date,language))}) : (value.startsWith('sitting:') ? ui.t("plenaryPeriod.missing.2", {id: String(value.slice(8))}) : value);
  return <label lang={ui.language}><UiMessage id="plenaryPeriod.select.1"/><select value={value} onChange={event=>onChange(event.target.value)}>{!value&&<option value="" disabled><UiMessage id="plenaryPeriod.select.2"/></option>}{includeLatest&&<option value="week:latest"><UiMessage id="plenaryPeriod.select.3"/></option>}{missing&&<option value={value} lang={(language==='en') ? 'en' : ''}>{missingLabel}</option>}<optgroup lang={ui.language} label={ui.t("plenaryPeriod.select.4")}>{weeks.map(week=><option lang={(language==='en') ? 'en' : ''} key={week} value={'week:'+week}>{upcoming(week) ? <UiMessage id="plenaryPeriod.select.6" values={{date: humanDate(week,language)}}/> : <UiMessage id="membervotes.tsx.week.of.date" values={{date: humanDate(week,language)}}/>}</option>)}</optgroup><optgroup lang={ui.language} label={ui.t("plenaryPeriod.select.7")}>{sittings.map(s=><option lang={((s.phase==='upcoming') && (language!=='en')) ? '' : language} key={s.id} value={'sitting:'+s.id}>{humanDate(s.date,language)}{(s.phase==='upcoming') ? (' · '+ui.t('batch6.procedureprogress.upcoming.25')) : ''}</option>)}</optgroup></select></label>;
}
export function SittingCalendarNotice({complete}:{complete?:boolean}) {
  const ui = useUiI18n();return (complete===false) ? <p lang={ui.language} className="insight-secondary" role="status"><UiMessage id="coverage.calendarMissing"/></p> : null;}
