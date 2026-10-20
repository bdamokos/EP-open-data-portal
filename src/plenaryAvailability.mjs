// Calendar dates describe the schedule, not whether today's individual item has finished.
export const brusselsDate=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);

export function plenaryAvailability(detail,kind,today=brusselsDate()) {
  const speech=kind==='speech';
  const records=speech?detail.speeches:detail.votes;
  if(records.some(record=>record.date===detail.date))return null;
  const date=detail.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z')))return {state:'unknown',message:speech?'Speech availability is unknown.':'Vote availability is unknown.'};
  if(date>today)return {state:'scheduled',message:speech?'This debate is in the future. Recorded speeches will follow after the debate.':'This vote is in the future. Results will follow after voting.'};
  const failed=speech?detail.coverage.gaps.some(gap=>['procedure','document debate association','speech association','actual debate event'].includes(gap.source)):Boolean(detail.voteCoverage.error);
  if(failed)return {state:'error',message:speech?'Speech records could not be loaded. Their availability is unknown.':'Voting records could not be loaded. Their availability is unknown.'};
  if(date===today)return {state:'today',message:speech?'Debate scheduled today. Recorded speeches will follow after the debate and transcript processing.':'Vote scheduled today. Results will follow after voting and publication by Parliament.'};
  const age=(Date.parse(today+'T12:00:00Z')-Date.parse(date+'T12:00:00Z'))/86400_000;
  // A short grace period is a display rule, not a completeness claim or publication deadline.
  if(age>0&&age<=3)return {state:'awaiting',message:speech?'Speeches are not available here yet. Allow a few days for transcript publication and indexing; timing varies.':'Results are not available here yet. Vote records can start appearing on the day of voting; publication and indexing may take longer.'};
  return {state:'unknown',message:speech?'No linked speech records for this agenda date are available here. Source coverage or debate links may be incomplete.':'No linked roll-call results are available here. Source coverage or vote links may be incomplete; not every vote is a roll call.'};
}
