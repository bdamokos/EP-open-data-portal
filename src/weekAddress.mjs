// Kept apart from the week page so the app shell can redirect old addresses without loading it.
export const weekHref=(week,language='en')=>'?'+new URLSearchParams({view:'legislation','agenda-period':'week:'+week,lang:language});
const monday=value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().startsWith(value)&&date.getUTCDay()===1;
};
/** Week links once read `pl-mode=week&pl-week=`; they open the agenda's week page now. */
export function weekModeRedirect(query) {
  if(query.get('view')!=='legislation'||query.get('pl-mode')!=='week')return null;
  const q=new URLSearchParams(query),week=q.get('pl-week')||'';
  q.delete('pl-mode');q.delete('pl-week');
  if(monday(week))q.set('agenda-period','week:'+week);
  return '?'+q;
}
