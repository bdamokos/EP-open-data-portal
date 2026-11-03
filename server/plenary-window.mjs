import {calendarDate} from './plenary-calendar.mjs';
const DAY=86400000;
const brusselsHour=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',hour:'2-digit',hourCycle:'h23'});
export function plenaryWindowEnd(lastDay) {
  const utc=Date.parse(lastDay+'T23:00:00Z');
  const offset=(Number(brusselsHour.format(new Date(utc)))-23+24)%24;
  return utc-offset*3600000;
}
export function plenaryWindows(sittings) {
  const dates=[...new Set(sittings.map(s=>s.date||s.activity_date).filter(calendarDate))].sort(),sessions=[];
  for(const date of dates){const last=sessions.at(-1);if(last&&Date.parse(date)-Date.parse(last.at(-1))===DAY)last.push(date);else sessions.push([date]);}
  return sessions.map(dates=>({first:dates[0],last:dates.at(-1),sittingIds:dates.map(date=>'MTG-PL-'+date)}));
}
export function activePlenaryWindow(sittings,now=Date.now()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  const local=`${parts.year}-${parts.month}-${parts.day}T${parts.hour}`;
  return plenaryWindows(sittings).find(s=>local>=new Date(Date.parse(s.first)-4*DAY).toISOString().slice(0,10)+'T07'&&local<s.last+'T23')||null;
}
