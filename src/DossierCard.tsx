import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {useState} from 'react';
import {FollowDossierButton,checkDossiers,dossierStore,useDossierChecking} from './DossierControls';
import {dossierHref,followEntries,itemHasNew,type FollowedDossier,type DossierEntry} from './followDossiers.mjs';
import {LIST_LIMIT,NEW_WINDOW_MS,isNewEntry} from './followUpdates.mjs';
import {humanDate} from './InsightCharts';
import {ProcedureContext} from './ProcedureContext';
import {InsightQuestionReader} from './InsightReaders';
import {publicAmendmentsEnabled} from './publicFeatures';
import './DossierCard.css';
const labels:Record<string,string>={document:'Document',stage:'Procedure stage',vote:'Vote recorded','amendment-list':'Amendment list',summary:'Dossier summary',press:'Press release',scheduled:'Scheduled',cancelled:'Cancelled',date:'Date changed',status:'Status changed',event:'Procedure progress'};
export const labelsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof labels => ({document:ui.t("dossierCard.event.1"),stage:ui.t("dossierCard.event.2"),vote:ui.t("dossierCard.event.3"),'amendment-list':ui.t("dossierCard.event.4"),summary:ui.t("dossierCard.event.5"),press:ui.t("dossierCard.event.6"),scheduled:ui.t("dossierCard.event.7"),cancelled:ui.t("membervotespresentation.cancelled"),date:ui.t("dossierCard.event.9"),status:ui.t("dossierCard.event.10"),event:ui.t("batch6.procedureprogress.procedure.progress.57")});

const publicEntry=(entry:DossierEntry)=>publicAmendmentsEnabled||entry.eventKind!=='amendment-list';
const officialPress=(value:string|undefined)=>{try{const url=new URL(value||'');return (((url.protocol==='https:') && (url.hostname==='www.europarl.europa.eu')) && url.pathname.startsWith('/news/')) ? url.href : null;}catch{return null;}};
export function DossierCard({item,language,now}:{item:FollowedDossier;language:string;now:number}) {
  const ui = useUiI18n(),checking=useDossierChecking();
  const [open,setOpen]=useState(new Set<string>()),[retained,setRetained]=useState<DossierEntry[]>([]),[dossierOpen,setDossierOpen]=useState(false);
  const {fresh,history,historyOmitted}=followEntries(item,now),freshEntries=(fresh as DossierEntry[]).filter(publicEntry),hasNew=itemHasNew(item,now);
  const listed=[...freshEntries,...retained.filter(entry=>!fresh.some(value=>value.id===entry.id))],pinned=new Set(retained.map(entry=>entry.id));
  const visibleHistory=(history as DossierEntry[]).filter(entry=>!pinned.has(entry.id)&&publicEntry(entry));
  const omitted=((item.unreadOmittedAt!==undefined) && (item.unreadOmittedAt+NEW_WINDOW_MS>now)) ? (item.unreadOmitted||0) : 0;
  const href=dossierHref(item.id,language),partial=Object.values(item.gaps).some(Boolean),pending=Object.keys(item.observations).length<4&&!item.lastAttempt;
  const row=(entry:DossierEntry)=>{
    const expanded=open.has(entry.id),current=item.entries.find(value=>value.id===entry.id)||entry,press=officialPress(entry.url);
    return <div className="explorer-saved-entry" key={entry.id}>
      <button className="explorer-saved-disclosure dossier-update-disclosure" aria-expanded={expanded} onClick={()=>{
        if(!expanded){if(isNewEntry(current,now))setRetained(previous=>previous.some(value=>value.id===entry.id) ? previous : ([...previous,{...entry,readAt:now}]));dossierStore.markEntryRead(item.id,entry.id);}
        setOpen(previous=>{const next=new Set(previous);if(expanded)next.delete(entry.id);else next.add(entry.id);return next;});
      }}><span aria-hidden="true">{expanded ? '▾' : '▸'}</span>{isNewEntry(current,now)&&<span className="explorer-saved-new"><UiMessage id="groupupdates.tsx.new"/></span>}<span lang={entry.titleLanguage||''}>{entry.title}</span><small>{labelsUi(ui)[entry.change||entry.eventKind]||ui.t("dossierCard.row.2")}{entry.date&&<> · <span lang={language}>{((entry.change==='date') && entry.previousDate) ? <>{humanDate(entry.previousDate,language)} → </> : null}{humanDate(entry.date,language)}</span></>}</small></button>
      {expanded&&<div className="explorer-saved-detail">{(entry.documentId && /^[A-Z0-9-]{1,100}$/.test(entry.documentId)) ? <InsightQuestionReader id={entry.documentId} language={language} heading={ui.t("dossierCard.event.1")}/> : (((entry.eventKind==='press') && press) ? <a href={press} target="_blank" rel="noreferrer"><UiMessage id="dossierCard.detail.2"/></a> : <><a href={href}><UiMessage id="dossierCard.detail.3"/></a><ProcedureContext reference={item.id} language={language} showIdentity={false} initialSummary={entry.summaryId}/></>)}</div>}
    </div>;
  };
  return <article className="dossier-follow-card">
    <h3 className="dossier-follow-title" data-expanded={dossierOpen||undefined} title={item.title} lang={item.titleLanguage||''}>{item.title}</h3>
    <div className="dossier-identity-row dossier-follow-meta"><p lang="">{item.id}</p><FollowDossierButton reference={item.id}/></div>
    <div className="explorer-saved-state">{hasNew ? <strong className="explorer-update-label"><UiMessage id="dossierCard.state.1" values={{count: (freshEntries.length+omitted)}}/></strong> : (pending ? <p><UiMessage id="dossierCard.state.2"/></p> : (!partial&&<p><UiMessage id="dossierCard.state.3"/></p>))}</div>
    {partial&&<p className="dossier-follow-gap"><UiMessage id="dossierCard.partial"/> <button type="button" disabled={checking} onClick={()=>void checkDossiers({force:true,only:item.id}, ui)}><UiMessage id="textsearch.retry.9f5cd8"/></button></p>}
    <div className="explorer-saved-actions"><a href={href}><UiMessage id="dossierCard.detail.3"/></a><button aria-expanded={dossierOpen} onClick={()=>setDossierOpen(value=>!value)}>{dossierOpen ? <UiMessage id="dossierCard.actions.2"/> : <UiMessage id="dossierCard.actions.3"/>}</button>{hasNew&&<button onClick={()=>dossierStore.markRead(item.id)}><UiMessage id="dossierCard.actions.4"/></button>}</div>
    {dossierOpen&&<ProcedureContext reference={item.id} language={language} showTitle showIdentity={false}/>}
    {(freshEntries.length>LIST_LIMIT||omitted) ? <p><a href={href}><UiMessage id="dossierCard.updateCount" values={{count:freshEntries.length+omitted}} counts={{count: freshEntries.length+omitted}}/></a></p> : listed.map(row)}
    {(visibleHistory.length>0||historyOmitted>0)&&<details className="explorer-saved-history"><summary><UiMessage id="dossierCard.history.1" values={{count: (visibleHistory.length+historyOmitted)}}/></summary>{visibleHistory.map(row)}{historyOmitted>0&&<a href={href}><UiMessage id="dossierCard.history.2"/></a>}</details>}
  </article>;
}
