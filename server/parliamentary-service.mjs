export const PARLIAMENTARY_SERVICE_VERSION = 1;
const reference=value=>typeof value==='string'?value:value?.id || '';
const local=value=>reference(value).replace(/^https:\/\/data\.europarl\.europa\.eu\//,'');
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const number=value=>Date.parse(value+'T12:00:00Z')/86400_000;

export function parliamentaryService(person,day) {
  const observations=[],periods=[];
  let invalid=false;
  for(const membership of person.hasMembership || []) {
    if(local(membership.role)!=='def/ep-roles/MEMBER_PARLIAMENT')continue;
    const parliamentId=local(membership.organization),start=membership.memberDuring?.startDate,end=membership.memberDuring?.endDate ?? null;
    if(!/^org\/ep-[1-9]\d*$/.test(parliamentId)||!validDay(start)||end!==null&&(!validDay(end)||end<start)){invalid=true;continue;}
    observations.push({membershipId:reference(membership.id)||null,parliamentId,start,end});
  }
  for(const observation of observations.sort((a,b)=>a.start.localeCompare(b.start)||(a.end||'9999').localeCompare(b.end||'9999'))) {
    const prior=periods.at(-1);
    if(prior?.end&&number(observation.start)===number(prior.end)+1){prior.end=observation.end;prior.observations.push(observation);}
    else periods.push({start:observation.start,end:observation.end,observations:[observation]});
  }
  const active=periods.filter(period=>period.start<=day&&(!period.end||period.end>=day));
  const ambiguous=active.length!==1;
  return {version:PARLIAMENTARY_SERVICE_VERSION,day,periods,currentSince:ambiguous?null:active[0].start,
    complete:!invalid&&!ambiguous,error:invalid||ambiguous?'Some parliamentary service dates are unavailable or inconsistent.':null};
}
