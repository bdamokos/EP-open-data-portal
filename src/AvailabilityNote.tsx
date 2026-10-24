import {availabilitySummary,type SourceAvailability} from '../server/source-availability.mjs';
import './AvailabilityNote.css';

const sourceNames:Record<string,string>={QUESTION_WRITTEN:'Written questions',QUESTION_WRITTEN_PRIORITY:'Priority questions',QUESTION_ORAL:'Oral questions','oral-speeches':'Oral speeches','outside-speeches':'Outside speakers','speech-metadata':'Speech records','speech-text':'Speech text','procedure-debates':'Dossier debates','procedure-votes':'Dossier votes','procedure-committee':'Committee events'};
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
    <p>{latest?<>Latest saved {label}: <time lang={language} dateTime={latest}>{date(latest,language)}</time>{qualifier?<> · {qualifier}</>:null}</>:selectedObserved?<>Records observed · Partial coverage</>:selectedChecked?'No matching records observed.':partial?'Partial coverage':'Records unavailable for this selection.'}</p>
    <details><summary>Coverage</summary><p>Counts describe saved records. Publication timing is unknown.</p><ul>{summary.sources.map((source,index)=><li key={source.sourceKey+':'+index}>
      <strong>{sourceNames[source.sourceKey]||source.sourceKey.replaceAll('-',' ')}</strong>{source.stage==='text'&&source.language?<> · <span lang={language}>{new Intl.DisplayNames([language],{type:'language'}).of(source.language)||source.language}</span> text</>:null}
      <span>{source.latestObservedDate?<>Latest record: <time lang={language} dateTime={source.latestObservedDate}>{date(source.latestObservedDate,language)}</time>.</>:'Collection date unavailable.'}{source.gaps.length?' Some records could not be checked.':source.limited?' Some records are outside this view.':''}</span>
      {source.retention&&typeof source.retention==='object'&&'reason' in source.retention&&source.retention.reason==='language-not-retained'?<span>Source language not retained locally.</span>:null}
      {source.checkedAt&&<span>Snapshot checked <time lang={language} dateTime={source.checkedAt}>{date(source.checkedAt,language)}</time>.</span>}
    </li>)}</ul></details>
  </div>;
}
