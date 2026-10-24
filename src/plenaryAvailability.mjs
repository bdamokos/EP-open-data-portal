// Calendar dates describe the schedule, not whether today's individual item has finished.
export const brusselsDate=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);

export function plenaryAvailability(detail,kind,today=brusselsDate()) {
  const speech=kind==='speech';
  const records=speech?detail.speeches:detail.votes;
  if(records.some(record=>record.date===detail.date))return null;
  const date=detail.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z')))return {state:'unknown',message:speech?'Speech availability is unknown.':'Vote availability is unknown.'};
  if(date>today)return {state:'scheduled',message:speech?'Debate scheduled.':'Vote scheduled.'};
  const availability=detail.availability?.[speech?'speech':'vote'];
  const sourceGap=availability?.gaps?.some(gap=>!gap.start||!gap.end||gap.start<=date&&gap.end>=date);
  const failed=sourceGap||(speech?detail.coverage.gaps.some(gap=>['procedure','document debate association','speech association','actual debate event'].includes(gap.source)):Boolean(detail.voteCoverage.error));
  if(failed)return {state:'error',message:speech?'Speech records could not be checked.':'Vote records could not be checked.'};
  if(date===today)return {state:'today',message:speech?'Debate scheduled today.':'Vote scheduled today.'};
  const frontier=availability?.latestObservedDate;
  if(frontier&&date>frontier)return {state:'awaiting',message:'Not yet available.'};
  return {state:'unknown',message:speech?'No linked speeches observed.':'No linked roll-call records observed. Not every vote is a roll call.'};
}
