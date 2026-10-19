import type {MemberProfile} from './explorerTypes';
export function ParliamentaryService({profile,lang,date}:{profile:MemberProfile;lang:string;date:(value:string,lang:string)=>string}) {
  const service=profile.parliamentaryService;
  if(!service)return null;
  const earlier=service.periods.filter(period=>period.end&&period.end<service.day&&period.start!==service.currentSince);
  return <div className="explorer-parliamentary-service" lang="en">
    {service.currentSince?<p><strong>MEP since <span lang={lang}>{date(service.currentSince,lang)}</span></strong></p>:<p>Parliamentary service dates unavailable.</p>}
    {earlier.length>0&&<p className="explorer-service-previous">Previous service: {earlier.map((period,i)=><span key={i}>{i>0?'; ':''}<span lang={lang}>{date(period.start,lang)} — {date(period.end!,lang)}</span></span>)}</p>}
    {service.currentSince&&service.error&&<p className="explorer-service-previous">{service.error}</p>}
  </div>;
}
