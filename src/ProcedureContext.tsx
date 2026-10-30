import {UiMessage, useUiI18n} from './UiI18nReact';
import {FollowDossierButton} from './DossierControls';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {FindInText} from './TextSearch';
import {useInsightData} from './InsightData';
import {humanDate} from './InsightCharts';
import './TopicContext.css';
import {AmendmentTrailLink} from './AmendmentTrailLink';
import {SourceLink} from './SourceLink';
import {ProcedureProgress} from './ProcedureProgress';
import {PressMentions} from './PressMentions';
import {summaryStage,compoundLanguage} from './terms.mjs';

export type OfficialTopic={id:string;label:string;language:string};
type Context={reference:string;title:string;language:string;summaries:{id:string;stage:string;date:string|null}[];summary:null|{id:string;stage:string;date:string;blocks:{kind:string;text:string}[];method:string|null;source:{url:string}};subjects:{code:string;label:string}[];topics:OfficialTopic[];source:{url:string}};

export function ProcedureContext({reference,language='en',onTopic,showTitle=false,showIdentity=true,initialSummary='',children,fallbackTitle}:{reference:string;language?:string;onTopic?:(topic:OfficialTopic)=>void;showTitle?:boolean;showIdentity?:boolean;initialSummary?:string;children?:ReactNode;fallbackTitle?:{title:string;titleLanguage:string|null}|null}) {
  const ui = useUiI18n();
  const [summary,setSummary]=useState(initialSummary),[expanded,setExpanded]=useState(false),summaryText=useRef<HTMLDivElement>(null);
  useEffect(()=>{setSummary(initialSummary);setExpanded(false);},[reference,initialSummary]);
  const params=new URLSearchParams({reference,lang:language});if(summary)params.set('summary',summary);
  const {data,loading,error}=useInsightData<Context>('insights/procedure-context?'+params);
  const title=data ? ({title:data.title,titleLanguage:data.language}) : fallbackTitle;
  const identity=showIdentity&&<div className="insight-dossier-title">
    {showTitle&&title&&<h2 lang={title.titleLanguage??''}>{title.title}</h2>}
    <div className="dossier-identity-row"><p lang="">{reference}</p>{(!showTitle||!loading)&&<FollowDossierButton reference={reference} title={title?.title} titleLanguage={title?.titleLanguage}/>}</div>
  </div>;
  const press=<PressMentions key={'press:'+reference+':'+language} reference={reference} language={language} limit={showTitle ? 5 : 3}/>;
  const amendmentLink=<AmendmentTrailLink procedure={reference} language={language}><UiMessage id="batch5.procedurecontext.tsx.27.68"/></AmendmentTrailLink>;
  if(!data)return <section lang={ui.language} className="insight-procedure-context insight-procedure-fallback" data-procedure-context-pending={(loading && (!fallbackTitle)) ? "true" : undefined}>{identity}{amendmentLink}{children}<ProcedureProgress key={reference+':'+language} reference={reference} language={language}/>{loading&&<p role="status"><UiMessage id="batch5.procedurecontext.tsx.28.69"/></p>}{press}{!loading&&error&&<p><a href={'https://oeil.europarl.europa.eu/oeil/en/procedure-file?'+new URLSearchParams({reference})} target="_blank" rel="noreferrer"><UiMessage id="batch5.procedurecontext.tsx.28.70"/></a></p>}</section>;
  const blocks=data.summary?.blocks||[],displayed=expanded ? blocks : blocks.slice(0,2);
  return <section lang={ui.language} className="insight-procedure-context">
    {identity}{amendmentLink}{children}
    <ProcedureProgress key={reference+':'+language} reference={reference} language={language}/>
    {data.summary&&<><header><div><h3><UiMessage id="batch5.procedurecontext.tsx.33.71"/></h3><FindInText key={data.summary.id} label={ui.t("batch5.procedurecontext.tsx.33.72")} target={summaryText} onOpen={()=>setExpanded(true)}/></div><div>{(data.summaries.length>1) ? <label className="insight-summary-stage"><span className="explorer-sr-only"><UiMessage id="batch5.procedurecontext.tsx.33.73"/></span><select value={data.summary.id} onChange={event=>{setSummary(event.target.value);setExpanded(false);}}>{data.summaries.map(item=>{const stage=summaryStage(item.stage,language, ui);return <option lang={compoundLanguage(stage.language,item.date ? language : stage.language)} value={item.id} key={item.id}>{stage.text}{item.date ? (' · '+humanDate(item.date,language)) : ''}</option>;})}</select></label> : <span lang={summaryStage(data.summary.stage,language, ui).language}>{summaryStage(data.summary.stage,language, ui).text}</span>}{data.summaries.length===1&&<time lang={language}>{humanDate(data.summary.date,language)}</time>}</div></header>
      <div className="insight-official-summary" ref={summaryText} lang={data.language??''}>{displayed.map((block,index)=>(block.kind==='heading') ? <h4 key={index}>{block.text}</h4> : <p key={index}>{block.text}</p>)}</div>
      <div className="insight-summary-footer">{blocks.length>2&&<button onClick={()=>setExpanded(value=>!value)} aria-expanded={expanded}>{expanded ? <UiMessage id="procedurecontext.show_less.4c852b"/> : <UiMessage id="procedurecontext.continue_reading.4f4840"/>}</button>}<a href={data.summary.source.url} target="_blank" rel="noreferrer"><UiMessage id="batch5.procedurecontext.tsx.35.74"/></a><small><span lang={language}>{new Intl.DisplayNames([language],{type:'language'}).of(data.language)}</span>{data.summary.method ? (' · '+data.summary.method) : ''}</small></div>
    </>}
    {showTitle&&!data.summary&&<p className="insight-secondary"><UiMessage id="procedurecontext.summary_unavailable.9f4198"/></p>}
    {press}
    {data.topics.length>0&&<div className="insight-official-topics"><h4><UiMessage id="batch4.questiontopics.tsx.topics"/> <small><UiMessage id="procedurecontext.eurovoc.dc7d06"/></small></h4><div>{data.topics.map(topic=>onTopic ? <button key={topic.id} lang={topic.language??''} onClick={()=>onTopic(topic)}>{topic.label} <span aria-hidden="true">↗</span></button> : <SourceLink key={topic.id} url={topic.id} language={language} contentLanguage={topic.language??''}>{topic.label}</SourceLink>)}</div></div>}
    {data.subjects.length>0&&<section className="insight-subject-classification" aria-label={ui.t("procedurecontext.subject_classification.eaa65a")}><h4><UiMessage id="procedurecontext.subject_classification.eaa65a"/></h4><ul>{data.subjects.map(subject=><li key={subject.code} lang={data.language??''}><span>{subject.label}</span> <small>{subject.code}</small></li>)}</ul></section>}
    {!data.summary&&!data.topics.length&&!data.subjects.length&&<a href={data.source.url} target="_blank" rel="noreferrer"><UiMessage id="procedurecontext.open_procedure_file.41bcb5"/></a>}
  </section>;
}
