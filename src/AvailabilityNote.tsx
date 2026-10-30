import {availabilitySummary,type SourceAvailability} from '../server/source-availability.mjs';
import {coverageNotices,type CoverageNotice} from './coverageNotices.mjs';
import {SourceLink} from './SourceLink';
import './AvailabilityNote.css';

const date=(value:string,language:string)=>new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(value.slice(0,10)+'T12:00Z'));
export function PartialValue({partial}:{partial?:boolean}) {return partial?<small className="availability-partial" lang="en">Partial</small>:null;}
function GapNotice({notice,language}:{notice:CoverageNotice;language:string}) {
  if(notice.kind==='gap-overflow')return <>At least {notice.count} {notice.family==='questions'?'question':'source'} reads failed.</>;
  if(notice.kind==='record-reads')return <>{notice.count} {notice.family==='questions'?'question':'source'} {notice.count===1?'read failed':'reads failed'} · {!notice.start?'through ':!notice.end?'from ':''}<span lang={language}>{notice.start&&date(notice.start,language)}{notice.start&&notice.end&&notice.start!==notice.end?' – ':''}{notice.end&&notice.start!==notice.end&&date(notice.end,language)}</span></>;
  if(notice.kind==='speech-records')return <>Speech archive: {notice.count} {notice.count===1?'failed read':'failed reads'}{notice.dates.length>0&&<> · <span lang={language}>{notice.dates.map(day=>date(day,language)).join(', ')}</span></>}</>;
  if('sourceUrl' in notice)return <><SourceLink url={notice.sourceUrl} language={language}>{notice.kind==='question'?'Question':'Document'} {notice.id} ↗</SourceLink> {notice.retained===true?'could not be updated':notice.retained===false?'not loaded':'last read failed'}</>;
  const name=({'speaker-list':'Speaker list','question-list':'Question list','speech-list':'Speech list','dossier-list':'Dossier list',records:'Records'} as Record<string,string>)[notice.kind];
  return <>{name} not loaded · {!notice.start?'through ':!notice.end?'from ':''}<span lang={language}>{notice.start&&date(notice.start,language)}{notice.start&&notice.end&&notice.start!==notice.end?' – ':''}{notice.end&&notice.start!==notice.end&&date(notice.end,language)}</span></>;
}
export function AvailabilityNote({sources,label='record',language='en',start,end,showGaps=true,sourceIds,archive=false}:{sources?:SourceAvailability|SourceAvailability[]|null;label?:string;language?:string;start?:string|null;end?:string|null;partial?:boolean;showGaps?:boolean;sourceIds?:string[];archive?:boolean}) {
  if(!sources)return null;
  const latest=availabilitySummary(sources).latestObservedDate,notices=showGaps?coverageNotices(sources,{start,end,onlyRelevant:!archive,sourceIds}):[];
  if(!latest&&!notices.length)return null;
  return <div className="availability-note" lang="en">
    {latest&&<p>Latest {label}: <time lang={language} dateTime={latest}>{date(latest,language)}</time></p>}
    {notices.length>0&&<ul className="availability-gaps">{notices.map((notice,index)=><li key={index}><GapNotice notice={notice} language={language}/></li>)}</ul>}
  </div>;
}
