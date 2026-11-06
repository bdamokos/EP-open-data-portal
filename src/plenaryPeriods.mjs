export function plenaryMonday(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const day=new Date(value+'T12:00:00Z');
  if(!Number.isFinite(day.valueOf())||day.toISOString().slice(0,10)!==value)return null;
  day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.toISOString().slice(0,10);
}
export function groupPlenaryWeeks(sittings) {
  const weeks=new Map();
  for(const sitting of sittings){const week=plenaryMonday(sitting.date);if(!week)continue;if(!weeks.has(week))weeks.set(week,[]);if(!weeks.get(week).some(s=>s.id===sitting.id))weeks.get(week).push(sitting);}
  return [...weeks].sort(([a],[b])=>b.localeCompare(a)).map(([week,days])=>({week,sittings:days.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))}));
}
export function votePeriodWeek(state,resolvedWeek,weeks=[]) {return state.sittingId?(plenaryMonday(state.sittingId.slice(7))||'latest'):state.week==='latest'?resolvedWeek||weeks[0]?.week||'latest':state.week;}
export function voteWeekNeighbours(weeks,week) {return {previous:weeks.find(item=>item.week<week)?.week||null,next:[...weeks].reverse().find(item=>item.week>week)?.week||null};}
export function votePeriodTransition(state,week,sittingId=null) {return {...state,week,sittingId,snapshotId:null,offset:0,decisionId:null,context:null,expandedSubjectIds:[]};}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
// Newest-first weeks of exact sitting identities; the shared `seen` set keeps
// held and upcoming sittings distinct across both lists.
const validWeekList=(list,seen,previous)=>Array.isArray(list)&&list.every(entry=>{
  if(!object(entry)||typeof entry.week!=='string'||plenaryMonday(entry.week)!==entry.week||entry.week>=previous.value)return false;
  previous.value=entry.week;let prior='';
  return Array.isArray(entry.sittings)&&entry.sittings.length&&entry.sittings.every(sitting=>{
    if(!object(sitting)||typeof sitting.sittingId!=='string'||typeof sitting.date!=='string'||sitting.sittingId!=='MTG-PL-'+sitting.date||plenaryMonday(sitting.date)!==entry.week||sitting.date<prior||seen.has(sitting.sittingId))return false;
    seen.add(sitting.sittingId);prior=sitting.date;return true;
  });
});
// Upcoming weeks (version 4) share the held weeks' shape and ordering.
export function validateVotePeriods(data) {
  if(!object(data)||![2,3,4].includes(data.version)||!object(data.coverage)||!['complete','partial','unavailable'].includes(data.coverage.status)||!Array.isArray(data.weeks)||!Array.isArray(data.coverage.years))return false;
  if(data.version>=4&&!Array.isArray(data.upcoming))return false;
  if(!data.coverage.years.every(year=>object(year)&&Number.isInteger(year.year)&&['complete','partial','unavailable'].includes(year.state)&&Array.isArray(year.sources)))return false;
  const seen=new Set();
  return validWeekList(data.weeks,seen,{value:'9999'})&&(!Array.isArray(data.upcoming)||validWeekList(data.upcoming,seen,{value:'9999'}));
}
// With no agenda period chosen, the agenda opens on the week containing today
// when it has sittings, else the next sitting week, else the latest held week.
// `weeks` and `upcoming` are newest-first, as in the vote-periods response.
export function defaultAgendaWeek(today,weeks=[],upcoming=[]) {
  const thisMonday=plenaryMonday(today);
  if(!thisMonday)return null;
  if([...weeks,...upcoming].some(week=>week.week===thisMonday))return thisMonday;
  const next=[...upcoming].reverse().find(week=>week.week>thisMonday);
  return next?.week||weeks[0]?.week||null;
}
