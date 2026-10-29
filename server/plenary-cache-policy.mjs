import {brusselsDay} from './analysis-period.mjs';
import {calendarMonday} from './plenary-calendar.mjs';

export const PLENARY_REFRESH_MS=60*60_000;
const brusselsHour=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',hour:'2-digit',hourCycle:'h23'});
const pastWeek=(date,now)=>date<calendarMonday(brusselsDay(now));
const agendaDate=endpoint=>endpoint.match(/^\/meetings\/MTG-PL-(\d{4}-\d{2}-\d{2})\/foreseen-activities$/)?.[1];
const brusselsMidnight=date=>{
  const utc=Date.parse(date+'T00:00:00Z');
  return utc-Number(brusselsHour.format(utc))*PLENARY_REFRESH_MS;
};

// A completed week's retained agenda is an observation, not a live feed.
// Missing records still load normally, and source provenance is never renewed.
export function agendaFreshMs(endpoint,now=Date.now()) {
  const date=agendaDate(endpoint);
  return date?(pastWeek(date,now)?Infinity:PLENARY_REFRESH_MS):null;
}

// A preliminary observation needs one final read after its plenary week ends.
export function agendaSettledAfter(endpoint,now=Date.now()) {
  const date=agendaDate(endpoint);
  if(!date||!pastWeek(date,now))return -Infinity;
  const end=new Date(Date.parse(calendarMonday(date)+'T12:00:00Z')+7*86400_000).toISOString().slice(0,10);
  return brusselsMidnight(end);
}

export function agendaViewFreshMs(value,now=Date.now()) {
  if(value.detail||value.selectionUnavailable)return 5*60_000;
  if(!value.coverage?.agendaComplete||value.coverage?.sources?.some(source=>source.stale||source.refreshInProgress||source.refreshError))return 60_000;
  if(value.coverage?.sources?.some(source=>{
    if(!source.apiUrl)return false;
    const endpoint=new URL(source.apiUrl).pathname.replace(/^\/api\/v2/,'');
    return Date.parse(source.fetchedAt)<agendaSettledAfter(endpoint,now);
  }))return 60_000;
  const dates=(value.agendaSittings||[value.sitting]).map(sitting=>sitting?.date);
  return dates.length&&dates.every(date=>date&&pastWeek(date,now))?Infinity:PLENARY_REFRESH_MS;
}

export function nextPlenaryWarmup(catalogue,values,now=Date.now()) {
  if(!catalogue.complete||!values.length||values.some(value=>!value.coverage.agendaComplete||agendaViewFreshMs(value,now)<=60_000))return PLENARY_REFRESH_MS;
  const week=calendarMonday(brusselsDay(now));
  if(catalogue.sittings.some(sitting=>calendarMonday(sitting.activity_date)===week))return PLENARY_REFRESH_MS;
  const next=catalogue.sittings.map(sitting=>calendarMonday(sitting.activity_date)).filter(date=>date>week).sort()[0];
  // Known future sitting weeks supply the wake date; no timer scans saved weeks.
  if(!next)return null;
  return brusselsMidnight(next)-now;
}
