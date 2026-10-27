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
const institutionLabel=(term:Term)=>term.label||institutions[term.code]||'Institution not labelled';
const eventLabel=(event:ProgressEvent)=>event.label||'Event';
const dated=(a:ProgressEvent,b:ProgressEvent)=>(a.date||'9999').localeCompare(b.date||'9999')||(a.sequence??0)-(b.sequence??0)||a.id.localeCompare(b.id);
const partial=(coverage:Coverage)=>coverage.limited||coverage.invalidRows>0||coverage.incompleteEvents>0||coverage.timeline==='unavailable';
function EventName({event}:{event:ProgressEvent}){return <span lang={event.labelLanguage||'en'}>{eventLabel(event)}</span>;}
function EventDate({event,language}:{event:ProgressEvent;language:string}){return event.date?<time dateTime={event.date} lang={language}>{humanDate(event.date,language)}</time>:null;}
function EventInstitutions({event}:{event:ProgressEvent}){return <span className="procedure-progress-institutions">{event.institutions.length?event.institutions.map(term=><span key={term.id} lang={term.language||'en'}>{institutionLabel(term)}</span>):<span className="procedure-progress-muted">Institution unavailable</span>}</span>;}
function Status({event,today}:{event:ProgressEvent;today:string}) {
  if(event.status==='projected')return <span className="procedure-progress-tag">Scheduled</span>;
  if(event.status==='cancelled')return <span className="procedure-progress-tag procedure-progress-tag-muted">Cancelled</span>;
  if(event.status==='unknown')return <span className="procedure-progress-tag procedure-progress-tag-muted">{event.statuses.length===1&&event.statuses[0].label?<span lang={event.statuses[0].language||'en'}>{event.statuses[0].label}</span>:'Status unavailable'}</span>;
  return event.date&&event.date>today?<span className="procedure-progress-tag procedure-progress-tag-muted">Upcoming</span>:null;
}

export function ProcedureProgress({reference,language}:{reference:string;language:string}) {
  const params=new URLSearchParams({reference,lang:language}),timelineId=useId(),headingId=useId();
  const state=useInsightData<Progress>('insights/procedure-progress?'+params),data=state.data?.reference===reference?state.data:null;
  const [expanded,setExpanded]=useState(false),[institution,setInstitution]=useState('all'),[allEvents,setAllEvents]=useState(false),[documentsNeeded,setDocumentsNeeded]=useState(false);
  useEffect(()=>{setExpanded(false);setInstitution('all');setAllEvents(false);setDocumentsNeeded(false);},[reference,language]);
  const documents=useInsightData<Documents>(documentsNeeded?'insights/procedure-progress?'+params+'&detail=documents':null);
  // Date-only legislative dates retain their calendar day in every time zone.
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const events=data?.state==='mapped'?data.events:[];
  const recorded=events.filter(event=>event.status==='recorded'&&event.date&&event.date<=today).sort(dated);
  const latest=(recorded.filter(event=>event.milestone).at(-1)||recorded.at(-1));
  const scheduled=events.filter(event=>event.status==='projected').sort(dated),next=scheduled.find(event=>event.date&&event.date>=today);
  const options=[...new Map(events.flatMap(event=>event.institutions).map(term=>[term.id,term])).values()].sort((a,b)=>institutionLabel(a).localeCompare(institutionLabel(b)));
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
  const title=/\((COD|CNS)\)$/.test(reference)?'Legislative progress':'Procedure progress';
  const docData=documents.data?.reference===reference?documents.data:null;
  return <section className="procedure-progress" aria-labelledby={headingId} lang="en">
    <header><h3 id={headingId}>{title}</h3>
      {available&&data?.status&&<span className="procedure-progress-stage" lang={data.status.language}>{data.status.label}</span>}
      {!available&&<span className="procedure-progress-muted" role="status">{state.loading?'Checking…':'Unavailable'}</span>}
      {available&&(state.loading||savedFailure||freshness.stale)&&<span className="procedure-progress-muted" role="status">{state.loading?'Checking…':savedFailure?'Update unavailable':'Saved progress'}</span>}
      {(!available||savedFailure||freshness.stale)&&!state.loading&&<button type="button" onClick={state.retry} disabled={retryDisabled}>{retryAt>Date.now()?'Try later':'Check again'}</button>}
    </header>
    {data&&<>
      {data.state==='mapped'&&<>
        {partial(data.coverage)&&<p className="procedure-progress-status">{data.coverage.limited?'Timeline incomplete':'Partial coverage'}</p>}
        {events.length>0&&<div className="procedure-progress-overview">
          {latest?<p className="procedure-progress-latest">{latest.institutions.length>0&&<EventInstitutions event={latest}/>}<strong><EventName event={latest}/></strong><EventDate event={latest} language={language}/></p>:<p className="procedure-progress-muted">No dated milestone.</p>}
          <button className="procedure-progress-toggle" type="button" aria-expanded={expanded} aria-controls={timelineId} onClick={()=>setExpanded(value=>!value)}>{expanded?'Hide timeline':'Show timeline'}</button>
        </div>}
        {next&&<div className="procedure-progress-next"><span className="procedure-progress-tag">Next scheduled action</span><p>{next.institutions.length>0&&<EventInstitutions event={next}/>}<strong><EventName event={next}/></strong><EventDate event={next} language={language}/></p></div>}
        {scheduled.some(event=>!event.date)&&<p className="procedure-progress-muted">Scheduled date unavailable.</p>}
        {scheduled.some(event=>event.date&&event.date<today)&&<p className="procedure-progress-muted">Past scheduled dates.</p>}
        {events.length>0&&expanded&&<div id={timelineId} className="procedure-progress-expanded">
            {(options.length>0||hasOtherEvents)&&<div className="procedure-progress-filters">{options.length>0&&<label>Institution<select value={institution} onChange={event=>setInstitution(event.target.value)}><option value="all">All institutions</option>{options.map(term=><option key={term.id} value={term.id} lang={term.language||'en'}>{institutionLabel(term)}</option>)}</select></label>}{hasOtherEvents&&<button type="button" aria-pressed={allEvents} onClick={()=>setAllEvents(value=>!value)}>{allEvents?'Show key milestones':'Show all recorded events'}</button>}</div>}
            <p className="procedure-progress-muted" role="status">{visible.length} {visible.length===1?'event':'events'} in this selection{data.coverage.limited?' · incomplete':''}</p>
            <ol className="procedure-progress-timeline">{visible.map(event=><li key={event.id} className={event.status==='projected'?'procedure-progress-scheduled':undefined}>
              <div className="procedure-progress-event-date">{event.date?<EventDate event={event} language={language}/>:<span>Date unavailable</span>}</div><EventInstitutions event={event}/><div className="procedure-progress-event-detail"><Status event={event} today={today}/><h4><EventName event={event}/></h4>
                {event.issues.length>0&&<p className="procedure-progress-muted">Partial details</p>}
                {event.works.length>0&&<details className="procedure-progress-documents" onToggle={toggle=>{if(toggle.currentTarget.open){setDocumentsNeeded(true);if(docData&&(documents.error||docFreshness.stale||docFreshness.failed)&&!documents.loading&&docRetryAt<=Date.now())documents.retry();}}}><summary>Documents</summary>
                  {documents.loading&&!docData&&<p role="status">Loading document links…</p>}
                  {documents.error&&!docData&&<p role="status">Document links unavailable. <button type="button" onClick={documents.retry} disabled={docRetryAt>Date.now()}>Try again</button></p>}
                  {docData&&<>
                    {(documents.loading||documents.error||docFreshness.failed||docFreshness.stale)&&<p className="procedure-progress-muted" role="status">{documents.loading?'Checking for updates…':documents.error||docFreshness.failed?'Couldn’t check for updates.':'Not checked recently.'} <button type="button" onClick={documents.retry} disabled={documents.loading||docRetryAt>Date.now()}>Check again</button></p>}
                    {partial(docData.coverage)&&<p className="procedure-progress-muted">Some document details unavailable.</p>}
                    {docData.state==='mapped'&&docData.dossier===data.dossier?<>{docData.documents.filter(document=>document.event===event.id&&event.works.includes(document.work)&&document.url).length>0?<ul>{docData.documents.filter(document=>document.event===event.id&&event.works.includes(document.work)&&document.url).map(document=><li key={document.work}><a href={document.url!} target="_blank" rel="noreferrer" lang={document.titleLanguage||'en'}>{document.title||document.celex[0]||'Read Council document'} ↗</a>{document.titleLanguage&&document.titleLanguage!==language&&<small className="procedure-progress-muted"> · Showing {document.titleLanguage.toUpperCase()}</small>}</li>)}</ul>:<p className="procedure-progress-muted">No document link.</p>}{docData.documents.some(document=>document.event===event.id&&event.works.includes(document.work)&&!document.url)&&<p className="procedure-progress-muted">Some document links unavailable.</p>}</>:<p className="procedure-progress-muted">Document links unavailable.</p>}
                  </>}
                </details>}
              </div>
            </li>)}</ol>
          </div>}
      </>}
    </>}
  </section>;
}
