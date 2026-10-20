import {useId,useState} from 'react';
import {useInsightData} from './InsightData';
import {humanDate} from './InsightCharts';

type Term={id:string;code:string;label:string|null;language:string|null};
type ProgressEvent={id:string;date:string|null;dates:string[];types:Term[];statuses:Term[];status:'recorded'|'projected'|'cancelled'|'unknown';institutions:Term[];works:string[];label:string|null;labelLanguage:string|null;milestone:boolean;issues:string[]};
type Coverage={limited:boolean;invalidRows:number;incompleteEvents:number};
type Source={fetchedAt:string;stale:boolean;refreshInProgress:boolean;refreshError:string|null};
type Progress={reference:string;state:'mapped'|'unmapped'|'ambiguous';dossier:string|null;events:ProgressEvent[];coverage:Coverage;source:Source};
type Document={event:string;work:string;title:string|null;titleLanguage:string|null;celex:string[];url:string|null};
type Documents={reference:string;state:Progress['state'];dossier:string|null;documents:Document[];coverage:Coverage;source:Source};
const institutions:Record<string,string>={EP:'European Parliament',CONSIL:'Council of the EU',COM:'European Commission',EESC:'European Economic and Social Committee',COR:'Committee of the Regions'};
const institutionLabel=(term:Term)=>term.label||institutions[term.code]||'Institution not labelled';
const eventLabel=(event:ProgressEvent)=>event.label||'Event label unavailable';
const dated=(a:ProgressEvent,b:ProgressEvent)=>(a.date||'9999').localeCompare(b.date||'9999')||a.id.localeCompare(b.id);
const partial=(coverage:Coverage)=>coverage.limited||coverage.invalidRows>0||coverage.incompleteEvents>0;
function EventName({event}:{event:ProgressEvent}){return <span lang={event.labelLanguage||'en'}>{eventLabel(event)}</span>;}
function EventDate({event,language}:{event:ProgressEvent;language:string}){return event.date?<time dateTime={event.date} lang={language}>{humanDate(event.date,language)}</time>:<span className="procedure-progress-muted">Date unavailable</span>;}
function Status({event,today}:{event:ProgressEvent;today:string}) {
  if(event.status==='projected')return <span className="procedure-progress-tag">Scheduled</span>;
  if(event.status==='cancelled')return <span className="procedure-progress-tag procedure-progress-tag-muted">Cancelled</span>;
  if(event.status==='unknown')return <span className="procedure-progress-tag procedure-progress-tag-muted">{event.statuses.length===1&&event.statuses[0].label?<span lang={event.statuses[0].language||'en'}>{event.statuses[0].label}</span>:'Status unavailable'}</span>;
  return event.date&&event.date>today?<span className="procedure-progress-tag procedure-progress-tag-muted">Future date · status not supplied</span>:null;
}

export function ProcedureProgress({reference,language}:{reference:string;language:string}) {
  const params=new URLSearchParams({reference,lang:language}),timelineId=useId(),headingId=useId();
  const state=useInsightData<Progress>('insights/procedure-progress?'+params),data=state.data?.reference===reference?state.data:null;
  const [expanded,setExpanded]=useState(false),[institution,setInstitution]=useState('all'),[allEvents,setAllEvents]=useState(false),[documentsNeeded,setDocumentsNeeded]=useState(false);
  const documents=useInsightData<Documents>(documentsNeeded?'insights/procedure-progress?'+params+'&detail=documents':null);
  // Date-only legislative dates retain their calendar day in every time zone.
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const events=data?.state==='mapped'?data.events:[];
  const recorded=events.filter(event=>event.status==='recorded'&&event.date&&event.date<=today).sort(dated);
  const latest=(recorded.filter(event=>event.milestone).at(-1)||recorded.at(-1));
  const scheduled=events.filter(event=>event.status==='projected').sort(dated),next=scheduled.find(event=>event.date&&event.date>=today);
  const options=[...new Map(events.flatMap(event=>event.institutions).map(term=>[term.id,term])).values()].sort((a,b)=>institutionLabel(a).localeCompare(institutionLabel(b)));
  const hasMilestones=events.some(event=>event.milestone||event.status==='projected');
  const visible=events.filter(event=>(institution==='all'||event.institutions.some(term=>term.id===institution))&&(allEvents||!hasMilestones||event.milestone||event.status==='projected')).sort(dated);
  const savedFailure=Boolean(data&&(state.error||data.source.refreshError));
  const docData=documents.data?.reference===reference?documents.data:null;
  return <section className="procedure-progress" aria-labelledby={headingId} lang="en">
    <header><h3 id={headingId}>Legislative progress</h3>{data&&<small className="procedure-progress-muted">Checked <time dateTime={data.source.fetchedAt} lang={language}>{new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(data.source.fetchedAt))}</time></small>}</header>
    {!data&&state.loading&&<p role="status">Loading legislative progress…</p>}
    {!data&&state.error&&<p className="procedure-progress-status" role="status">Legislative progress is temporarily unavailable. <button type="button" onClick={state.retry}>Try again</button></p>}
    {data&&<>
      {(savedFailure||data.source.stale)&&<p className="procedure-progress-status" role="status">Saved progress · {state.loading?'Checking for updates…':savedFailure?'Refresh unavailable.':'Updates may be available.'} <button type="button" onClick={state.retry} disabled={state.loading}>Check again</button></p>}
      {data.state==='unmapped'&&<p className="procedure-progress-muted">No exact match was returned by the EU legislative source. Parliament information remains available below.</p>}
      {data.state==='ambiguous'&&<p className="procedure-progress-muted">The EU legislative source returned more than one procedure match. Progress is unavailable for this selection.</p>}
      {data.state==='mapped'&&<>
        {partial(data.coverage)&&<p className="procedure-progress-status">{data.coverage.limited?'The returned timeline is limited. ':''}{data.coverage.invalidRows||data.coverage.incompleteEvents?'Some source details are unavailable or inconsistent. ':''}The latest recorded event and scheduled action may be incomplete.</p>}
        {latest?<p className="procedure-progress-latest"><span className="procedure-progress-muted">Latest recorded milestone</span><strong><EventName event={latest}/></strong><EventDate event={latest} language={language}/></p>:events.length?<p className="procedure-progress-muted">No dated past milestone can be identified from the returned records.</p>:<p className="procedure-progress-muted">The procedure was found, but no timeline events were returned.</p>}
        {next&&<div className="procedure-progress-next"><span className="procedure-progress-tag">Next scheduled action</span><p><strong><EventName event={next}/></strong><EventDate event={next} language={language}/></p></div>}
        {scheduled.some(event=>!event.date||event.date<today)&&<p className="procedure-progress-muted">Some events are still marked scheduled without an upcoming date. They remain scheduled in the timeline.</p>}
        {events.length>0&&<><button className="procedure-progress-toggle" type="button" aria-expanded={expanded} aria-controls={timelineId} onClick={()=>setExpanded(value=>!value)}>{expanded?'Hide timeline':'Show timeline'}</button>
          {expanded&&<div id={timelineId} className="procedure-progress-expanded">
            <div className="procedure-progress-filters"><label>Institution<select value={institution} onChange={event=>setInstitution(event.target.value)}><option value="all">All institutions</option>{options.map(term=><option key={term.id} value={term.id} lang={term.language||'en'}>{institutionLabel(term)}</option>)}</select></label><button type="button" aria-pressed={allEvents} onClick={()=>setAllEvents(value=>!value)}>{allEvents?'Show key milestones':'Show all recorded events'}</button></div>
            <p className="procedure-progress-muted" role="status">{visible.length} {visible.length===1?'event':'events'} in this selection{data.coverage.limited?' · limited source response':''}</p>
            <ol className="procedure-progress-timeline">{visible.map(event=><li key={event.id} className={event.status==='projected'?'procedure-progress-scheduled':undefined}>
              <EventDate event={event} language={language}/><div><Status event={event} today={today}/><h4><EventName event={event}/></h4><p className="procedure-progress-muted">{event.institutions.length?event.institutions.map((term,index)=><span key={term.id} lang={term.language||'en'}>{index>0?' · ':''}{institutionLabel(term)}</span>):'Institution not supplied'}</p>
                {event.issues.length>0&&<p className="procedure-progress-muted">Some event details are unavailable or inconsistent in the source.</p>}
                {event.works.length>0&&<details className="procedure-progress-documents" onToggle={toggle=>{if(toggle.currentTarget.open){setDocumentsNeeded(true);if(docData&&(documents.error||docData.source.stale||docData.source.refreshError)&&!documents.loading)documents.retry();}}}><summary>Documents</summary>
                  {documents.loading&&!docData&&<p role="status">Loading document links…</p>}
                  {documents.error&&!docData&&<p role="status">Document links are temporarily unavailable. <button type="button" onClick={documents.retry}>Try again</button></p>}
                  {docData&&<>
                    {(documents.error||docData.source.refreshError||docData.source.stale)&&<p className="procedure-progress-muted" role="status">Saved document details · {documents.loading?'Checking for updates…':documents.error||docData.source.refreshError?'Refresh unavailable.':'Updates may be available.'} <button type="button" onClick={documents.retry} disabled={documents.loading}>Check again</button></p>}
                    {partial(docData.coverage)&&<p className="procedure-progress-muted">The returned document details are incomplete.</p>}
                    {docData.state==='mapped'&&docData.dossier===data.dossier?<>{docData.documents.filter(document=>document.event===event.id&&event.works.includes(document.work)&&document.url).length>0?<ul>{docData.documents.filter(document=>document.event===event.id&&event.works.includes(document.work)&&document.url).map(document=><li key={document.work}><a href={document.url!} target="_blank" rel="noreferrer" lang={document.titleLanguage||'en'}>{document.title||document.celex[0]||'Read Council document'} ↗</a>{document.titleLanguage&&document.titleLanguage!==language&&<small className="procedure-progress-muted"> · Showing {document.titleLanguage.toUpperCase()}</small>}</li>)}</ul>:<p className="procedure-progress-muted">No readable document link was returned for this event.</p>}{docData.documents.some(document=>document.event===event.id&&event.works.includes(document.work)&&!document.url)&&<p className="procedure-progress-muted">Some linked documents have no verified readable identifier.</p>}</>:<p className="procedure-progress-muted">Document links could not be matched to this procedure.</p>}
                  </>}
                </details>}
              </div>
            </li>)}</ol>
          </div>}
        </>}
      </>}
    </>}
  </section>;
}
