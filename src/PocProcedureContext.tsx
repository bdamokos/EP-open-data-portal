import {useEffect,useState} from 'react';
import {useInsightData} from './PocInsightData';
import {humanDate} from './PocInsightCharts';
import './PocTopicContext.css';
import {AmendmentTrailLink} from './AmendmentTrailLink';

export type OfficialTopic={id:string;label:string;language:string};
type Context={reference:string;title:string;language:string;summaries:{id:string;stage:string;date:string|null}[];summary:null|{id:string;stage:string;date:string;blocks:{kind:string;text:string}[];method:string|null;source:{url:string}};subjects:{code:string;label:string}[];topics:OfficialTopic[];source:{url:string}};
const stageName=(stage:string)=>({'first-reading':'First reading','parliament-decision':'Parliament’s decision','final-act':'Final act',proposal:'Commission proposal',document:'Summary'} as Record<string,string>)[stage]||'Summary';

export function PocProcedureContext({reference,language='en',onTopic,showTitle=false}:{reference:string;language?:string;onTopic?:(topic:OfficialTopic)=>void;showTitle?:boolean}) {
  const [summary,setSummary]=useState(''),[expanded,setExpanded]=useState(false);
  useEffect(()=>{setSummary('');setExpanded(false);},[reference]);
  const params=new URLSearchParams({reference,lang:language});if(summary)params.set('summary',summary);
  const {data,loading,error}=useInsightData<Context>('insights/procedure-context?'+params);
  if(!data&&!loading&&!showTitle)return null;
  if(!data)return <section className="insight-procedure-context insight-procedure-fallback">{loading?<p role="status">Loading summary…</p>:error?<p><a href={'https://oeil.europarl.europa.eu/oeil/en/procedure-file?'+new URLSearchParams({reference})} target="_blank" rel="noreferrer">Read on Legislative Observatory ↗</a></p>:null}</section>;
  const blocks=data.summary?.blocks||[],displayed=expanded?blocks:blocks.slice(0,2);
  return <section className="insight-procedure-context">
    <AmendmentTrailLink procedure={reference} language={language}>Amendments for this dossier</AmendmentTrailLink>
    {showTitle&&<div className="insight-dossier-title"><h2>{data.title}</h2><p>{data.reference}</p></div>}
    {data.summary&&<><header><h3>Summary</h3><div>{data.summaries.length>1?<label className="insight-summary-stage"><span className="poc-sr-only">Summary stage</span><select value={data.summary.id} onChange={event=>{setSummary(event.target.value);setExpanded(false);}}>{data.summaries.map(item=><option value={item.id} key={item.id}>{stageName(item.stage)}{item.date?' · '+humanDate(item.date,language):''}</option>)}</select></label>:<span>{stageName(data.summary.stage)}</span>}{data.summaries.length===1&&<time>{humanDate(data.summary.date,language)}</time>}</div></header>
      <div className="insight-official-summary">{displayed.map((block,index)=>block.kind==='heading'?<h4 key={index}>{block.text}</h4>:<p key={index}>{block.text}</p>)}</div>
      <div className="insight-summary-footer">{blocks.length>2&&<button onClick={()=>setExpanded(value=>!value)} aria-expanded={expanded}>{expanded?'Show less':'Continue reading'}</button>}<a href={data.summary.source.url} target="_blank" rel="noreferrer">Legislative Observatory ↗</a><small>{new Intl.DisplayNames([language],{type:'language'}).of(data.language)}{data.summary.method?' · '+data.summary.method:''}</small></div>
    </>}
    {data.topics.length>0&&<div className="insight-official-topics"><h4>Topics <small>EuroVoc</small></h4><div>{data.topics.map(topic=>onTopic?<button key={topic.id} onClick={()=>onTopic(topic)}>{topic.label} <span aria-hidden="true">↗</span></button>:<a key={topic.id} href={topic.id.replace('http:','https:')} target="_blank" rel="noreferrer">{topic.label}</a>)}</div></div>}
    {data.subjects.length>0&&<details><summary>Subject classification</summary><ul>{data.subjects.map(subject=><li key={subject.code}>{subject.label} <small>{subject.code}</small></li>)}</ul></details>}
    {!data.summary&&!data.topics.length&&!data.subjects.length&&<a href={data.source.url} target="_blank" rel="noreferrer">Open procedure file ↗</a>}
  </section>;
}
