import type {MemberProfile} from './explorerTypes';
export function ParliamentaryService({profile,lang,date}:{profile:MemberProfile;lang:string;date:(value:string,lang:string)=>string}) {
  const service=profile.parliamentaryService;
  if(!service)return null;
  const currentSince=profile.currentAffiliation?.status==='matched'?service.currentSince:null;
  const earlier=service.periods.filter(period=>currentSince?period.end&&period.end<service.day&&period.start!==currentSince:true);
  return <div className="explorer-parliamentary-service" lang="en">
    {currentSince?<p><strong>MEP since <span lang={lang}>{date(currentSince,lang)}</span></strong></p>:service.periods.length>0?<p><strong>Parliamentary service</strong></p>:<p>Parliamentary service dates unavailable.</p>}
    {earlier.length>0&&<p className="explorer-service-previous">{currentSince?'Previous service: ':''}{earlier.map((period,i)=><span key={i}>{i>0?'; ':''}<span lang={lang}>{date(period.start,lang)}</span> — {period.end?<span lang={lang}>{date(period.end,lang)}</span>:<span lang="en">End date not supplied</span>}</span>)}</p>}
    {service.error&&<p className="explorer-service-previous">{service.error}</p>}
  </div>;
}
