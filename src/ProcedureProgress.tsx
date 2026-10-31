import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {useEffect,useId,useState} from 'react';
import {useInsightData} from './InsightData';
import {humanDate} from './InsightCharts';
import {progressSourceState} from './insightRefresh.mjs';

type Term={id:string;code:string;label:string|null;language:string|null};
type ProgressEvent={id:string;sequence?:number;date:string|null;dates:string[];types:Term[];statuses:Term[];status:'recorded'|'projected'|'cancelled'|'unknown';institutions:Term[];works:string[];label:string|null;labelLanguage:string|null;milestone:boolean;issues:string[]};
type Coverage={limited:boolean;invalidRows:number;incompleteEvents:number;timeline?:string};
type Source={fetchedAt:string;stale:boolean;refreshInProgress:boolean;refreshError:string|null};
type Progress={reference:string;language:string;state:'mapped'|'unmapped'|'ambiguous';dossier:string|null;status?:{label:string;language:string}|null;events:ProgressEvent[];coverage:Coverage;source:Source;fallback?:{status:string;retryAt:number|null}};
type Document={event:string;work:string;title:string|null;titleLanguage:string|null;celex:string[];url:string|null};
type Documents={reference:string;state:Progress['state'];dossier:string|null;documents:Document[];coverage:Coverage;source:Source};
const institutions:Record<string,string>={EP:'European Parliament',CONSIL:'Council of the EU',COM:'European Commission',EESC:'European Economic and Social Committee',COR:'Committee of the Regions'};
export const institutionsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof institutions => ({EP:ui.t("batch5.speechplayer.tsx.25.75"),CONSIL:ui.t("batch6.procedureprogress.council.of.the.eu.13"),COM:ui.t("batch6.procedureprogress.european.commission.13"),EESC:ui.t("batch6.procedureprogress.european.economic.and.social.committee.13"),COR:ui.t("batch6.procedureprogress.committee.of.the.regions.13")});

const institutionLabel=(term:Term, ui: import('./uiI18n.mjs').UiFormatter = defaultUi)=>term.label||institutionsUi(ui)[term.code]||ui.t("batch6.procedureprogress.institution.not.labelled.14");
const eventLabel=(event:ProgressEvent, ui: import('./uiI18n.mjs').UiFormatter = defaultUi)=>event.label||ui.t("outsidevoices.event.ad8919");
const dated=(a:ProgressEvent,b:ProgressEvent)=>(a.date||'9999').localeCompare(b.date||'9999')||(a.sequence??0)-(b.sequence??0)||a.id.localeCompare(b.id);
const partial=(coverage:Coverage)=>coverage.limited||coverage.invalidRows>0||coverage.incompleteEvents>0||coverage.timeline==='unavailable';
function EventName({event}:{event:ProgressEvent}){
  const ui = useUiI18n();return <span lang={event.labelLanguage||'en'}>{eventLabel(event, ui)}</span>;}
function EventDate({event,language}:{event:ProgressEvent;language:string}){return event.date ? <time dateTime={event.date} lang={language}>{humanDate(event.date,language)}</time> : null;}
function EventInstitutions({event}:{event:ProgressEvent}){
  const ui = useUiI18n();return <span className="procedure-progress-institutions">{event.institutions.length ? event.institutions.map(term=><span key={term.id} lang={term.language||'en'}>{institutionLabel(term, ui)}</span>) : <span className="procedure-progress-muted"><UiMessage id="batch6.procedureprogress.institution.unavailable.20"/></span>}</span>;}
function Status({event,today}:{event:ProgressEvent;today:string}) {
  const ui = useUiI18n();
  if(event.status==='projected')return <span className="procedure-progress-tag"><UiMessage id="dossierCard.event.7"/></span>;
  if(event.status==='cancelled')return <span className="procedure-progress-tag procedure-progress-tag-muted"><UiMessage id="membervotespresentation.cancelled"/></span>;
  if(event.status==='unknown')return <span className="procedure-progress-tag procedure-progress-tag-muted">{((event.statuses.length===1) && event.statuses[0].label) ? <span lang={event.statuses[0].language||'en'}>{event.statuses[0].label}</span> : ui.t("topictrends.status_unavailable.f261ff")}</span>;
  return (event.date && (event.date>today)) ? <span className="procedure-progress-tag procedure-progress-tag-muted"><UiMessage id="batch6.procedureprogress.upcoming.25"/></span> : null;
}

export function ProcedureProgress({reference,language}:{reference:string;language:string}) {
  const ui = useUiI18n();
  const params=new URLSearchParams({reference,lang:language}),timelineId=useId(),headingId=useId();
  const state=useInsightData<Progress>('insights/procedure-progress?'+params),data=(state.data?.reference===reference) ? state.data : null;
  const [expanded,setExpanded]=useState(false),[institution,setInstitution]=useState('all'),[allEvents,setAllEvents]=useState(false),[documentsNeeded,setDocumentsNeeded]=useState(false);
  useEffect(()=>{setExpanded(false);setInstitution('all');setAllEvents(false);setDocumentsNeeded(false);},[reference,language]);
  const documents=useInsightData<Documents>(documentsNeeded ? ('insights/procedure-progress?'+params+'&detail=documents') : null);
  // Date-only legislative dates retain their calendar day in every time zone.
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const events=(data?.state==='mapped') ? data.events : ([]);
  const recorded=events.filter(event=>event.status==='recorded'&&event.date&&event.date<=today).sort(dated);
  const latest=(recorded.filter(event=>event.milestone).at(-1)||recorded.at(-1));
  const scheduled=events.filter(event=>event.status==='projected').sort(dated),next=scheduled.find(event=>event.date&&event.date>=today);
  const options=[...new Map(events.flatMap(event=>event.institutions).map(term=>[term.id,term])).values()].sort((a,b)=>institutionLabel(a, ui).localeCompare(institutionLabel(b, ui)));
  const hasMilestones=events.some(event=>event.milestone||event.status==='projected');
  const hasOtherEvents=hasMilestones&&events.some(event=>!event.milestone&&event.status!=='projected');
  const visible=events.filter(event=>(institution==='all'||event.institutions.some(term=>term.id===institution))&&(allEvents||!hasMilestones||event.milestone||event.status==='projected')).sort(dated);
  const freshness=progressSourceState(data),docFreshness=progressSourceState(documents.data);
  const savedFailure=Boolean(data&&(state.error||freshness.failed));
  const available=Boolean(data?.state==='mapped'&&(events.length||data.status));
  const retryAt=Math.max(state.retryAt||0,freshness.retryAt),docRetryAt=Math.max(documents.retryAt||0,docFreshness.retryAt);
  const [retryClock,setRetryClock]=useState(0);
  useEffect(()=>{
    const future=[retryAt,docRetryAt].filter(at=>at>Date.now());
    if(!future.length)return;
    const at=Math.min(...future);
    const timer=setTimeout(()=>setRetryClock(value=>value+1),Math.min(at-Date.now()+1,2_147_483_647));
    return()=>clearTimeout(timer);
  },[retryAt,docRetryAt,retryClock]);
  const retryDisabled=state.loading||retryAt>Date.now();
  const title=/\((COD|CNS)\)$/.test(reference) ? ui.t("dossierCard.event.11") : ui.t("batch6.procedureprogress.procedure.progress.57");
  const docData=(documents.data?.reference===reference) ? documents.data : null;
  return <section className="procedure-progress" aria-labelledby={headingId} lang={ui.language}>
    <header><h3 id={headingId}>{title}</h3>
      {available&&data?.status&&<span className="procedure-progress-stage" lang={data.status.language}>{data.status.label}</span>}
      {!available&&<span className="procedure-progress-muted" role="status">{state.loading ? <UiMessage id="batch6.procedureprogress.checking.62"/> : <UiMessage id="grouplabels.ts.unavailable"/>}</span>}
      {available&&(state.loading||savedFailure||freshness.stale)&&<span className="procedure-progress-muted" role="status">{state.loading ? ui.t("batch6.procedureprogress.checking.62") : (savedFailure ? ui.t("batch6.procedureprogress.update.unavailable.63") : ui.t("batch6.procedureprogress.saved.progress.63"))}</span>}
      {(!available||savedFailure||freshness.stale)&&!state.loading&&<button type="button" onClick={state.retry} disabled={retryDisabled}>{(retryAt>Date.now()) ? <UiMessage id="batch6.procedureprogress.try.later.64"/> : <UiMessage id="batch6.procedureprogress.check.again.64"/>}</button>}
    </header>
    {data&&<>
      {data.state==='mapped'&&<>
        {partial(data.coverage)&&<p className="procedure-progress-status">{data.coverage.limited ? <UiMessage id="batch6.procedureprogress.timeline.incomplete.68"/> : <UiMessage id="membervotespresentation.partial_coverage"/>}</p>}
        {events.length>0&&<div className="procedure-progress-overview">
          {latest ? <p className="procedure-progress-latest">{latest.institutions.length>0&&<EventInstitutions event={latest}/>}<strong><EventName event={latest}/></strong><EventDate event={latest} language={language}/></p> : <p className="procedure-progress-muted"><UiMessage id="batch6.procedureprogress.no.dated.milestone.70"/></p>}
          <button className="procedure-progress-toggle" type="button" aria-expanded={expanded} aria-controls={timelineId} onClick={()=>setExpanded(value=>!value)}>{expanded ? <UiMessage id="batch6.procedureprogress.hide.timeline.71"/> : <UiMessage id="batch6.procedureprogress.show.timeline.71"/>}</button>
        </div>}
        {next&&<div className="procedure-progress-next"><span className="procedure-progress-tag"><UiMessage id="batch6.procedureprogress.next.scheduled.action.73"/></span><p>{next.institutions.length>0&&<EventInstitutions event={next}/>}<strong><EventName event={next}/></strong><EventDate event={next} language={language}/></p></div>}
        {scheduled.some(event=>!event.date)&&<p className="procedure-progress-muted"><UiMessage id="batch6.procedureprogress.scheduled.date.unavailable.74"/></p>}
        {scheduled.some(event=>event.date&&event.date<today)&&<p className="procedure-progress-muted"><UiMessage id="batch6.procedureprogress.past.scheduled.dates.75"/></p>}
        {events.length>0&&expanded&&<div id={timelineId} className="procedure-progress-expanded">
            {(options.length>0||hasOtherEvents)&&<div className="procedure-progress-filters">{options.length>0&&<label><UiMessage id="batch6.procedureprogress.institution.77"/><select value={institution} onChange={event=>setInstitution(event.target.value)}><option value="all"><UiMessage id="batch6.procedureprogress.all.institutions.77"/></option>{options.map(term=><option key={term.id} value={term.id} lang={term.language||'en'}>{institutionLabel(term, ui)}</option>)}</select></label>}{hasOtherEvents&&<button type="button" aria-pressed={allEvents} onClick={()=>setAllEvents(value=>!value)}>{allEvents ? <UiMessage id="batch6.procedureprogress.show.key.milestones.77"/> : <UiMessage id="batch6.procedureprogress.show.all.recorded.events.77"/>}</button>}</div>}
            <p className="procedure-progress-muted" role="status"><UiMessage id={data.coverage.limited?'batch6.procedureprogress.count.events.in.this.selection.incomplete.78':'batch6.procedureprogress.count.events.in.this.selection.78'} values={{count:visible.length}}/></p>
            <ol className="procedure-progress-timeline">{visible.map(event=><li key={event.id} className={(event.status==='projected') ? 'procedure-progress-scheduled' : undefined}>
              <div className="procedure-progress-event-date">{event.date ? <EventDate event={event} language={language}/> : <span><UiMessage id="dossieractivity.date_unavailable"/></span>}</div><EventInstitutions event={event}/><div className="procedure-progress-event-detail"><Status event={event} today={today}/><h4><EventName event={event}/></h4>
                {event.issues.length>0&&<p className="procedure-progress-muted"><UiMessage id="batch6.procedureprogress.partial.details.81"/></p>}
                {event.works.length>0&&<details className="procedure-progress-documents" onToggle={toggle=>{if(toggle.currentTarget.open){setDocumentsNeeded(true);if(docData&&(documents.error||docFreshness.stale||docFreshness.failed)&&!documents.loading&&docRetryAt<=Date.now())documents.retry();}}}><summary><UiMessage id="batch6.procedureprogress.documents.82"/></summary>
                  {documents.loading&&!docData&&<p role="status"><UiMessage id="batch6.procedureprogress.loading.document.links.83"/></p>}
                  {documents.error&&!docData&&<p role="status"><UiMessage id="batch6.procedureprogress.document.links.unavailable.84"/> <button type="button" onClick={documents.retry} disabled={docRetryAt>Date.now()}><UiMessage id="commissionfollowups.try_again"/></button></p>}
                  {docData&&<>
                    {(documents.loading||documents.error||docFreshness.failed||docFreshness.stale)&&<p className="procedure-progress-muted" role="status">{documents.loading ? ui.t("dossierCard.state.2") : ((documents.error||docFreshness.failed) ? ui.t("batch6.procedureprogress.couldn.t.check.for.updates.86") : ui.t("batch6.procedureprogress.not.checked.recently.86"))} <button type="button" onClick={documents.retry} disabled={documents.loading||docRetryAt>Date.now()}><UiMessage id="batch6.procedureprogress.check.again.64"/></button></p>}
                    {partial(docData.coverage)&&<p className="procedure-progress-muted"><UiMessage id="batch6.procedureprogress.some.document.details.unavailable.87"/></p>}
                    {((docData.state==='mapped') && (docData.dossier===data.dossier)) ? <>{(docData.documents.filter(document=>document.event===event.id&&event.works.includes(document.work)&&document.url).length>0) ? <ul>{docData.documents.filter(document=>document.event===event.id&&event.works.includes(document.work)&&document.url).map(document=><li key={document.work}><a href={document.url!} target="_blank" rel="noreferrer" lang={document.titleLanguage||'en'}>{document.title||document.celex[0] ? <>{document.title||document.celex[0]} ↗</> : ui.t('progress.readCouncilDocument')}</a>{document.titleLanguage&&document.titleLanguage!==language&&<small className="procedure-progress-muted"><UiMessage id="batch6.procedureprogress.showing.language.88" values={{language: document.titleLanguage.toUpperCase()}}/></small>}</li>)}</ul> : <p className="procedure-progress-muted"><UiMessage id="batch6.procedureprogress.no.document.link.88"/></p>}{docData.documents.some(document=>document.event===event.id&&event.works.includes(document.work)&&!document.url)&&<p className="procedure-progress-muted"><UiMessage id="batch6.procedureprogress.some.document.links.unavailable.88"/></p>}</> : <p className="procedure-progress-muted"><UiMessage id="batch6.procedureprogress.document.links.unavailable.84"/></p>}
                  </>}
                </details>}
              </div>
            </li>)}</ol>
          </div>}
      </>}
    </>}
  </section>;
}
