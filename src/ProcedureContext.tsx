import {useEffect,useRef,useState} from 'react';
import {FindInText} from './TextSearch';
import {useInsightData} from './InsightData';
import {humanDate} from './InsightCharts';
import './TopicContext.css';
import {AmendmentTrailLink} from './AmendmentTrailLink';
import {SourceLink} from './SourceLink';
import {ProcedureProgress} from './ProcedureProgress';
import {summaryStage,compoundLanguage} from './terms.mjs';

export type OfficialTopic={id:string;label:string;language:string};
type Context={reference:string;title:string;language:string;summaries:{id:string;stage:string;date:string|null}[];summary:null|{id:string;stage:string;date:string;blocks:{kind:string;text:string}[];method:string|null;source:{url:string}};subjects:{code:string;label:string}[];topics:OfficialTopic[];source:{url:string}};

export function ProcedureContext({reference,language='en',onTopic,showTitle=false}:{reference:string;language?:string;onTopic?:(topic:OfficialTopic)=>void;showTitle?:boolean}) {
  const [summary,setSummary]=useState(''),[expanded,setExpanded]=useState(false),summaryText=useRef<HTMLDivElement>(null);
  useEffect(()=>{setSummary('');setExpanded(false);},[reference]);
  const params=new URLSearchParams({reference,lang:language});if(summary)params.set('summary',summary);
  const {data,loading,error}=useInsightData<Context>('insights/procedure-context?'+params);
  const amendmentLink=<AmendmentTrailLink procedure={reference} language={language}>Amendments for this dossier</AmendmentTrailLink>;
  if(!data)return <section lang="en" className="insight-procedure-context insight-procedure-fallback">{amendmentLink}<ProcedureProgress key={reference+':'+language} reference={reference} language={language}/>{loading?<p role="status">Loading summary…</p>:error?<p><a href={'https://oeil.europarl.europa.eu/oeil/en/procedure-file?'+new URLSearchParams({reference})} target="_blank" rel="noreferrer">Read on Legislative Observatory ↗</a></p>:null}</section>;
  const blocks=data.summary?.blocks||[],displayed=expanded?blocks:blocks.slice(0,2);
  return <section lang="en" className="insight-procedure-context">
    {amendmentLink}
    {showTitle&&<div className="insight-dossier-title"><h2 lang={data.language??''}>{data.title}</h2><p>{data.reference}</p></div>}
    <ProcedureProgress key={reference+':'+language} reference={reference} language={language}/>
    {data.summary&&<><header><div><h3>Summary</h3><FindInText key={data.summary.id} label="Find in summary" target={summaryText} onOpen={()=>setExpanded(true)}/></div><div>{data.summaries.length>1?<label className="insight-summary-stage"><span className="explorer-sr-only">Summary stage</span><select value={data.summary.id} onChange={event=>{setSummary(event.target.value);setExpanded(false);}}>{data.summaries.map(item=>{const stage=summaryStage(item.stage,language);return <option lang={compoundLanguage(stage.language,item.date?language:stage.language)} value={item.id} key={item.id}>{stage.text}{item.date?' · '+humanDate(item.date,language):''}</option>;})}</select></label>:<span lang={summaryStage(data.summary.stage,language).language}>{summaryStage(data.summary.stage,language).text}</span>}{data.summaries.length===1&&<time lang={language}>{humanDate(data.summary.date,language)}</time>}</div></header>
      <div className="insight-official-summary" ref={summaryText} lang={data.language??''}>{displayed.map((block,index)=>block.kind==='heading'?<h4 key={index}>{block.text}</h4>:<p key={index}>{block.text}</p>)}</div>
      <div className="insight-summary-footer">{blocks.length>2&&<button onClick={()=>setExpanded(value=>!value)} aria-expanded={expanded}>{expanded?'Show less':'Continue reading'}</button>}<a href={data.summary.source.url} target="_blank" rel="noreferrer">Legislative Observatory ↗</a><small><span lang={language}>{new Intl.DisplayNames([language],{type:'language'}).of(data.language)}</span>{data.summary.method?' · '+data.summary.method:''}</small></div>
    </>}
    {data.topics.length>0&&<div className="insight-official-topics"><h4>Topics <small>EuroVoc</small></h4><div>{data.topics.map(topic=>onTopic?<button key={topic.id} lang={topic.language??''} onClick={()=>onTopic(topic)}>{topic.label} <span aria-hidden="true">↗</span></button>:<SourceLink key={topic.id} url={topic.id} language={language} contentLanguage={topic.language??''}>{topic.label}</SourceLink>)}</div></div>}
    {data.subjects.length>0&&<details><summary>Subject classification</summary><ul>{data.subjects.map(subject=><li key={subject.code} lang={data.language??''}>{subject.label} <small>{subject.code}</small></li>)}</ul></details>}
    {!data.summary&&!data.topics.length&&!data.subjects.length&&<a href={data.source.url} target="_blank" rel="noreferrer">Open procedure file ↗</a>}
  </section>;
}
