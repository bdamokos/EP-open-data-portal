import {defaultUi} from './uiDefault.mjs';
// Calendar dates describe the schedule, not whether today's individual item has finished.
export const brusselsDate=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);

/** What a debate shows while it has no speeches on its own date. */
export function speechAvailability(detail,today=brusselsDate(), ui = defaultUi) {
  if(detail.speeches.some(record=>record.date===detail.date))return null;
  const date=detail.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z')))return {state:'unknown',message:ui.t("plenaryavailability.speech.availability.is.unknown")};
  if(date>today)return {state:'scheduled',message:ui.t("plenaryavailability.debate.scheduled")};
  const availability=detail.availability?.speech;
  const sourceGap=availability?.gaps?.some(gap=>!gap.start||!gap.end||gap.start<=date&&gap.end>=date);
  const failed=sourceGap||detail.coverage.gaps.some(gap=>['procedure','document debate association','speech association','actual debate event'].includes(gap.source));
  if(failed)return {state:'error',message:ui.t("plenaryavailability.speeches.could.not.be.loaded")};
  if(date===today)return {state:'today',message:ui.t("plenaryavailability.debate.scheduled.today")};
  const frontier=availability?.latestObservedDate;
  if(frontier&&date>frontier)return {state:'awaiting',message:ui.t("plenaryavailability.not.yet.available")};
  return {state:'unknown',message:ui.t("plenaryavailability.no.speeches.available")};
}
