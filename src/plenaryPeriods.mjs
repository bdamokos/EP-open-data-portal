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
export function validateVotePeriods(data) {
  if(!object(data)||data.version!==1||!object(data.coverage)||!['complete','partial','unavailable'].includes(data.coverage.status)||!Array.isArray(data.weeks)||!Array.isArray(data.coverage.years))return false;
  if(!data.coverage.years.every(year=>object(year)&&Number.isInteger(year.year)&&['complete','partial','unavailable'].includes(year.state)&&Array.isArray(year.sources)))return false;
  let previous='9999';const seen=new Set();
  return data.weeks.every(entry=>{
    if(!object(entry))return false;
    const {week,sittings}=entry;
    if(typeof week!=='string'||plenaryMonday(week)!==week||week>=previous||!Array.isArray(sittings)||!sittings.length)return false;
    previous=week;let prior='';
    return sittings.every(sitting=>{
      if(!object(sitting)||typeof sitting.sittingId!=='string'||typeof sitting.date!=='string'||sitting.sittingId!=='MTG-PL-'+sitting.date||plenaryMonday(sitting.date)!==week||sitting.date<prior||seen.has(sitting.sittingId))return false;
      seen.add(sitting.sittingId);prior=sitting.date;return true;
    });
  });
}
