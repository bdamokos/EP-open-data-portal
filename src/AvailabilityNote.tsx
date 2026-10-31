import {UiMessage, useUiI18n} from './UiI18nReact';
import {availabilitySummary,type SourceAvailability} from '../server/source-availability.mjs';
import {coverageNotices,type CoverageNotice} from './coverageNotices.mjs';
import {SourceLink} from './SourceLink';
import './AvailabilityNote.css';

const date=(value:string,language:string)=>new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(value.slice(0,10)+'T12:00Z'));
export function PartialValue({partial}:{partial?:boolean}) {const ui=useUiI18n();return partial ? <small className="availability-partial" lang={ui.language}><UiMessage id="availabilitynote.partial"/></small> : null;}
type AvailabilityKind='record'|'event'|'question'|'speech'|'speech.record'|'text'|'vote';
function GapNotice({notice,language}:{notice:CoverageNotice;language:string}) {
  const ui=useUiI18n();
  if(notice.kind==='gap-overflow')return <UiMessage id={notice.family==='questions'?'coverage.questionOverflow':'coverage.sourceOverflow'} values={{count:notice.count}}/>;
  const dateNode=(day:string)=><span lang={language}>{date(day,language)}</span>;
  if(notice.kind==='speech-records')return <UiMessage id={notice.dates.length?'coverage.speechReadsDates':'coverage.speechReads'} values={{count:notice.count,dates:<span lang={language}>{notice.dates.map(day=>date(day,language)).join(', ')}</span>}}/>;
  if('sourceUrl' in notice){
    const state=notice.retained===true?'updateFailed':notice.retained===false?'unloaded':'readFailed';
    return <UiMessage id={`coverage.${notice.kind}.${state}`} values={{record:<SourceLink url={notice.sourceUrl} language={language} contentLanguage={ui.language}><UiMessage id={notice.kind==='question'?'coverage.questionReference':'coverage.documentReference'} values={{id:<span lang="">{notice.id}</span>}}/> ↗</SourceLink>}}/>;
  }
  const period=notice.start&&notice.end?<>{dateNode(notice.start)}{notice.start!==notice.end?<> – {dateNode(notice.end)}</>:null}</>:<UiMessage id={notice.start?'coverage.periodFrom':'coverage.periodThrough'} values={{date:dateNode((notice.start||notice.end)!)}}/>;
  if(notice.kind==='record-reads')return <UiMessage id={notice.family==='questions'?'coverage.questionReads':'coverage.sourceReads'} values={{count:notice.count,period}}/>;
  const ids={'speaker-list':'coverage.speakerList','question-list':'coverage.questionList','speech-list':'coverage.speechList','dossier-list':'coverage.dossierList',records:'coverage.records'};
  return <UiMessage id={ids[notice.kind]} values={{period}}/>;
}
export function AvailabilityNote({sources,label='record',kind,language='en',start,end,showGaps=true,sourceIds,archive=false}:{sources?:SourceAvailability|SourceAvailability[]|null;label?:string;kind?:AvailabilityKind;language?:string;start?:string|null;end?:string|null;partial?:boolean;showGaps?:boolean;sourceIds?:string[];archive?:boolean}) {
  const ui=useUiI18n();
  if(!sources)return null;
  const latest=availabilitySummary(sources).latestObservedDate,notices=showGaps?coverageNotices(sources,{start,end,onlyRelevant:!archive,sourceIds}):[];
  if(!latest&&!notices.length)return null;
  const knownKinds:Record<string,AvailabilityKind>={record:'record',event:'event',question:'question',speech:'speech','speech record':'speech.record',text:'text',vote:'vote'};
  const messageKind=kind||knownKinds[label]||'record';
  return <div className="availability-note" lang={ui.language}>
    {latest&&<p><UiMessage id={`availabilitynote.latest.${messageKind}`} values={{date:<time lang={language} dateTime={latest}>{date(latest,language)}</time>}}/></p>}
    {notices.length>0&&<ul className="availability-gaps">{notices.map((notice,index)=><li key={index}><GapNotice notice={notice} language={language}/></li>)}</ul>}
  </div>;
}
