import {useState} from 'react';
import {FollowDossierButton,dossierStore} from './DossierControls';
import {dossierHref,followEntries,itemHasNew,type FollowedDossier,type DossierEntry} from './followDossiers.mjs';
import {LIST_LIMIT,NEW_WINDOW_MS,isNewEntry} from './followUpdates.mjs';
import {humanDate} from './InsightCharts';
import {ProcedureContext} from './ProcedureContext';
import {InsightQuestionReader} from './InsightReaders';
import {publicAmendmentsEnabled} from './publicFeatures';
import './DossierCard.css';
const labels:Record<string,string>={document:'Document',stage:'Procedure stage',vote:'Vote recorded','amendment-list':'Amendment list',summary:'Dossier summary',press:'Press release',scheduled:'Scheduled',cancelled:'Cancelled',date:'Date changed',status:'Status changed',event:'Legislative progress'};
const publicEntry=(entry:DossierEntry)=>publicAmendmentsEnabled||entry.eventKind!=='amendment-list';
const officialPress=(value:string|undefined)=>{try{const url=new URL(value||'');return url.protocol==='https:'&&url.hostname==='www.europarl.europa.eu'&&url.pathname.startsWith('/news/')?url.href:null;}catch{return null;}};
export function DossierCard({item,language,now}:{item:FollowedDossier;language:string;now:number}) {
  const [open,setOpen]=useState(new Set<string>()),[retained,setRetained]=useState<DossierEntry[]>([]),[dossierOpen,setDossierOpen]=useState(false);
  const {fresh,history,historyOmitted}=followEntries(item,now),freshEntries=(fresh as DossierEntry[]).filter(publicEntry),hasNew=itemHasNew(item,now);
  const listed=[...freshEntries,...retained.filter(entry=>!fresh.some(value=>value.id===entry.id))],pinned=new Set(retained.map(entry=>entry.id));
  const visibleHistory=(history as DossierEntry[]).filter(entry=>!pinned.has(entry.id)&&publicEntry(entry));
  const omitted=item.unreadOmittedAt!==undefined&&item.unreadOmittedAt+NEW_WINDOW_MS>now?item.unreadOmitted||0:0;
  const href=dossierHref(item.id,language),partial=Object.values(item.gaps).some(Boolean),pending=Object.keys(item.observations).length<4&&!item.lastAttempt;
  const row=(entry:DossierEntry)=>{
    const expanded=open.has(entry.id),current=item.entries.find(value=>value.id===entry.id)||entry,press=officialPress(entry.url);
    return <div className="explorer-saved-entry" key={entry.id}>
      <button className="explorer-saved-disclosure dossier-update-disclosure" aria-expanded={expanded} onClick={()=>{
        if(!expanded){if(isNewEntry(current,now))setRetained(previous=>previous.some(value=>value.id===entry.id)?previous:[...previous,{...entry,readAt:now}]);dossierStore.markEntryRead(item.id,entry.id);}
        setOpen(previous=>{const next=new Set(previous);if(expanded)next.delete(entry.id);else next.add(entry.id);return next;});
      }}><span aria-hidden="true">{expanded?'▾':'▸'}</span>{isNewEntry(current,now)&&<span className="explorer-saved-new">New</span>}<span lang={entry.titleLanguage||''}>{entry.title}</span><small>{labels[entry.change||entry.eventKind]||'Dossier update'}{entry.date&&<> · <span lang={language}>{entry.change==='date'&&entry.previousDate?<>{humanDate(entry.previousDate,language)} → </>:null}{humanDate(entry.date,language)}</span></>}</small></button>
      {expanded&&<div className="explorer-saved-detail">{entry.documentId&&/^[A-Z0-9-]{1,100}$/.test(entry.documentId)?<InsightQuestionReader id={entry.documentId} language={language} heading="Document"/>:entry.eventKind==='press'&&press?<a href={press} target="_blank" rel="noreferrer">Read press release ↗</a>:<><a href={href}>Open dossier</a><ProcedureContext reference={item.id} language={language} initialSummary={entry.summaryId}/></>}</div>}
    </div>;
  };
  return <article className="dossier-follow-card">
    <div className="explorer-saved-heading"><h3 title={item.title} lang={item.titleLanguage||''}>{item.title}</h3><FollowDossierButton reference={item.id} compact/></div>
    <p className="dossier-follow-reference" lang="">{item.id}</p>
    <div className="explorer-saved-state">{hasNew?<strong className="explorer-update-label">{freshEntries.length+omitted} new</strong>:pending?<p>Checking for updates…</p>:!partial&&<p>No new updates.</p>}</div>
    {partial&&<p className="dossier-follow-gap">Some sources couldn't be checked.</p>}
    <div className="explorer-saved-actions"><a href={href}>Open dossier</a><button aria-expanded={dossierOpen} onClick={()=>setDossierOpen(value=>!value)}>{dossierOpen?'Hide dossier':'Read here'}</button>{hasNew&&<button onClick={()=>dossierStore.markRead(item.id)}>Mark all read</button>}</div>
    {dossierOpen&&<ProcedureContext reference={item.id} language={language} showTitle/>}
    {freshEntries.length>LIST_LIMIT||omitted?<p>{freshEntries.length+omitted} dossier updates. <a href={href}>Open dossier</a></p>:listed.map(row)}
    {(visibleHistory.length>0||historyOmitted>0)&&<details className="explorer-saved-history"><summary>Earlier updates ({visibleHistory.length+historyOmitted})</summary>{visibleHistory.map(row)}{historyOmitted>0&&<a href={href}>Open dossier for more</a>}</details>}
  </article>;
}
