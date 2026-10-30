import {UiMessage, useUiI18n} from './UiI18nReact';
import type {MemberProfile} from './explorerTypes';
import {Period} from './Period';
export function ParliamentaryService({profile,lang,date}:{profile:MemberProfile;lang:string;date:(value:string,lang:string)=>string}) {
  const ui = useUiI18n();
  const service=profile.parliamentaryService;
  if(!service)return null;
  const currentSince=(profile.currentAffiliation?.status==='matched') ? service.currentSince : null;
  const earlier=service.periods.filter(period=>currentSince ? (period.end&&period.end<service.day&&period.start!==currentSince) : true);
  return <div className="explorer-parliamentary-service" lang={ui.language}>
    {currentSince ? <p><strong><UiMessage id="batch6.parliamentaryservice.mep.since.date.9" values={{date: <span lang={lang}>{date(currentSince,lang)}</span>}}/></strong></p> : ((service.periods.length>0) ? <p><strong><UiMessage id="batch6.parliamentaryservice.parliamentary.service.9"/></strong></p> : null)}
    {earlier.length>0&&<p className="explorer-service-previous">{currentSince ? 'Previous service: ' : ''}{earlier.map((period,i)=><span key={i}>{(i>0) ? '; ' : ''}{Period({start:period.start,end:period.end,ongoing:false,lang,date})}</span>)}</p>}
    {service.error&&<p className="explorer-service-previous">{service.error}</p>}
  </div>;
}
