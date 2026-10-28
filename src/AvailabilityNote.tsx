import {availabilitySummary,type SourceAvailability} from '../server/source-availability.mjs';
import './AvailabilityNote.css';

const date=(value:string,language:string)=>new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(value.slice(0,10)+'T12:00Z'));
export function PartialValue({partial}:{partial?:boolean}) {return partial?<small className="availability-partial" lang="en">Partial</small>:null;}
export function AvailabilityNote({sources,label='record',language='en',end,partial=false}:{sources?:SourceAvailability|SourceAvailability[]|null;label?:string;language?:string;end?:string|null;partial?:boolean}) {
  if(!sources)return null;
  const summary=availabilitySummary(sources),latest=summary.latestObservedDate;
  const hasGap=summary.sources.some(source=>source.gaps.length),limited=summary.partial||partial;
  const selectedObserved=summary.sources.some(source=>(source.observedRecords??0)>0);
  const selectedChecked=summary.sources.some(source=>source.route==='public-api'&&source.checkedAt);
  const frontierPeriod=Boolean(end&&summary.sources.some(source=>source.latestObservedDate&&end>=source.latestObservedDate));
  const qualifier=hasGap||limited?'Partial coverage':latest&&end&&end>latest?'Later dates unavailable':frontierPeriod?'Partial':null;
  return <div className="availability-note" lang="en">
    <p>{latest?<>Latest {label}: <time lang={language} dateTime={latest}>{date(latest,language)}</time>{qualifier?<> · {qualifier}</>:null}</>:selectedObserved?<>Partial coverage</>:selectedChecked?(hasGap||partial||summary.sources.some(source=>source.limited)?'Partial coverage':'No matching records.'):partial?'Partial coverage':'Unavailable.'}</p>
  </div>;
}
