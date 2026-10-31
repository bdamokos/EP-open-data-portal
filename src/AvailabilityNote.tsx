import {UiMessage, useUiI18n} from './UiI18nReact';
import {availabilitySummary,type SourceAvailability} from '../server/source-availability.mjs';
import './AvailabilityNote.css';

const date=(value:string,language:string)=>new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(value.slice(0,10)+'T12:00Z'));
export function PartialValue({partial}:{partial?:boolean}) {const ui=useUiI18n();return partial ? <small className="availability-partial" lang={ui.language}><UiMessage id="availabilitynote.partial"/></small> : null;}
type AvailabilityKind='record'|'event'|'question'|'speech'|'speech.record'|'text'|'vote';
export function AvailabilityNote({sources,label='record',kind,language='en',end,partial=false}:{sources?:SourceAvailability|SourceAvailability[]|null;label?:string;kind?:AvailabilityKind;language?:string;end?:string|null;partial?:boolean}) {
  const ui=useUiI18n();
  if(!sources)return null;
  const summary=availabilitySummary(sources),latest=summary.latestObservedDate;
  const hasGap=summary.sources.some(source=>source.gaps.length),limited=summary.partial||partial;
  const selectedObserved=summary.sources.some(source=>(source.observedRecords??0)>0);
  const selectedChecked=summary.sources.some(source=>source.route==='public-api'&&source.checkedAt);
  const frontierPeriod=Boolean(end&&summary.sources.some(source=>source.latestObservedDate&&end>=source.latestObservedDate));
  const suffix=(hasGap||limited) ? '.partial.coverage' : (((latest && end) && (end>latest)) ? '.later.dates.unavailable' : (frontierPeriod ? '.partial' : ''));
  // `label` remains an English compatibility input for existing standalone callers.
  const knownKinds:Record<string,AvailabilityKind>={record:'record',event:'event',question:'question',speech:'speech','speech record':'speech.record',text:'text',vote:'vote'};
  const messageKind=kind||knownKinds[label]||'record';
  return <div className="availability-note" lang={ui.language}><p>{latest ? <UiMessage id={`availabilitynote.latest.${messageKind}${suffix}`} values={{date:<time lang={language} dateTime={latest}>{date(latest,language)}</time>}}/> : ((selectedObserved||selectedChecked&&(hasGap||partial||summary.sources.some(source=>source.limited))||partial) ? ui.t('membervotespresentation.partial_coverage') : (selectedChecked ? ui.t('availabilitynote.no.matching.records') : ui.t('batch5.amendments.tsx.126.14')))}</p></div>;
}
