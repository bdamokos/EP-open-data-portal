export const CURRENT_TERM_START='2024-07-16';
export const brusselsDay=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));

export function periodEndMinimum(period) {
  return period==='term'?CURRENT_TERM_START:new Date(Date.parse(CURRENT_TERM_START+'T12:00:00Z')+(period-1)*86400_000).toISOString().slice(0,10);
}
