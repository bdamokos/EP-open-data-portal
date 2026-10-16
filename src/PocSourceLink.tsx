import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {humanSourceUrl,sourceTarget,recordTitle} from '../server/source-links.mjs';
import {useData} from './pocData';
import './PocSourceLink.css';

type SourceRecord={sourceUrl:string;requestUrl:string;fetchedAt:string;stale:boolean;refreshError:string|null;collection:boolean;limited:boolean;
  records:{title:string;websiteUrl:string|null;value:Record<string,unknown>}[];payload:unknown};
const fieldName=(key:string)=>key.replace(/^@/,'').replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,letter=>letter.toUpperCase());
const safeHref=(value:string)=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};

function ExpandableValue({value,language,depth}:{value:object;language:string;depth:number}) {
  const [expanded,setExpanded]=useState(false);
  return <details onToggle={event=>setExpanded(event.currentTarget.open)}><summary>{Array.isArray(value)?`${value.length} items`:'Details'}</summary>{expanded&&<Value value={value} language={language} depth={depth}/>}</details>;
}

function Value({value,language,depth=0}:{value:unknown;language:string;depth?:number}) {
  if(value===null)return <span className="source-empty">Not supplied</span>;
  if(typeof value!=='object'){
    const text=String(value),relative=/^(?:person\/[1-9]\d*|eli\/dl\/(?:doc|proc|event)\/[A-Z0-9-]+)$/.test(text)?'https://data.europarl.europa.eu/'+text:null;
    const href=typeof value==='string'?relative||safeHref(value):null,website=href?humanSourceUrl(href,{language}):null;
    return website?<a href={website} target="_blank" rel="noreferrer">{text} ↗</a>:<span className={href?'source-uri':undefined}>{text.length>6000?text.slice(0,6000)+'… (full value in download)':text}</span>;
  }
  if(depth>=7)return <span className="source-empty">Further detail is available in the download.</span>;
  const entries=Object.entries(value);
  if(!entries.length)return <span className="source-empty">Empty {Array.isArray(value)?'list':'object'}</span>;
  if(entries.every(([key,child])=>/^[a-z]{2}$/.test(key)&&typeof child==='string')){
    const actual=entries.some(([key])=>key===language)?language:entries.some(([key])=>key==='en')?'en':entries[0][0];
    return <span lang={actual}>{String((value as Record<string,unknown>)[actual])}{actual!==language&&<small className="source-empty"> · Showing {actual.toUpperCase()}</small>}</span>;
  }
  return <dl className="source-fields">{entries.slice(0,80).map(([key,child])=><div key={key}><dt>{Array.isArray(value)?Number(key)+1:fieldName(key)}</dt><dd>{child!==null&&typeof child==='object'?<ExpandableValue value={child} language={language} depth={depth+1}/>:<Value value={child} language={language} depth={depth+1}/>}</dd></div>)}{entries.length>80&&<div><dt>More fields</dt><dd>Full detail is available in the download.</dd></div>}</dl>;
}

function SourceDialog({url,language,close}:{url:string;language:string;close:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),heading=useId(),[selected,setSelected]=useState(0),[download,setDownload]=useState<string|null>(null),[textLanguage,setTextLanguage]=useState(language);
  const state=useData<SourceRecord>('source-record?'+new URLSearchParams({url,lang:language})),data=state.data;
  useEffect(()=>{dialog.current?.showModal();const element=dialog.current;return()=>element?.close();},[]);
  useEffect(()=>{
    if(!data)return;
    const href=URL.createObjectURL(new Blob([JSON.stringify(data.payload,null,2)+'\n'],{type:'application/ld+json'}));setDownload(href);
    return()=>URL.revokeObjectURL(href);
  },[data]);
  const record=data?.records[selected],website=record?.websiteUrl;
  const titleLanguages=record?Object.values(record.value).flatMap(value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).filter(key=>/^[a-z]{2}$/.test(key)):[]):[];
  const availableLanguages=[...new Set([language,textLanguage,...titleLanguages])].sort();
  const titles=record?.value.process_title||record?.value.title_dcterms||record?.value.activity_label;
  const localizedTitles=titles&&typeof titles==='object'?titles as Record<string,unknown>:null;
  const titleLanguage=localizedTitles?(typeof localizedTitles[textLanguage]==='string'?textLanguage:typeof localizedTitles.en==='string'?'en':null):null;
  return createPortal(<dialog ref={dialog} className="source-dialog" aria-labelledby={heading} onCancel={event=>{event.preventDefault();close();}} onClick={event=>{if(event.target===dialog.current){const box=dialog.current.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close();}}}>
    <header><div><p className="source-eyebrow">European Parliament · source data</p><h2 id={heading}>Source record</h2></div><button type="button" className="source-close" onClick={close} aria-label="Close source reader">×</button></header>
    <div className="source-actions">{website&&<a href={website} target="_blank" rel="noreferrer">Official website ↗</a>}<a href={url} target="_blank" rel="noreferrer">Open original source ↗</a>{download&&<a href={download} download="parliament-source.jsonld">Download JSON-LD</a>}</div>
    {state.loading&&!data&&<p role="status">Loading source record…</p>}
    {state.error&&<p role="alert">{state.error} <button type="button" onClick={state.retry}>Try again</button></p>}
    {data&&<><p className="source-retrieved">Retrieved {new Date(data.fetchedAt).toLocaleString(language)}{data.stale?' · Saved copy; refresh pending':''}</p>{data.refreshError&&<p>Refresh unavailable. The saved source remains available.</p>}
      {data.collection&&<p className="source-scope">{data.records.length} records in this source response.{data.limited?' The reader and download are limited to 25 records; open the original source for the requested result.':''}</p>}
      <details className="source-request"><summary>Exact source request</summary><a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.sourceUrl}</a>{data.requestUrl!==data.sourceUrl&&<p>Reader request: <span>{data.requestUrl}</span></p>}</details>
      {data.records.length>1&&<label className="source-record-picker">Record<select value={selected} onChange={event=>setSelected(Number(event.target.value))}>{data.records.map((record,index)=><option key={index} value={index}>{index+1}. {record.title.slice(0,160)}</option>)}</select></label>}
      {availableLanguages.length>1&&<label className="source-record-picker">Source language<select value={textLanguage} onChange={event=>setTextLanguage(event.target.value)}>{availableLanguages.map(code=><option key={code} value={code}>{code.toUpperCase()}</option>)}</select></label>}
      {record?<section className="source-record-content"><h3 lang={titleLanguage||undefined}>{recordTitle(record.value,textLanguage)}</h3>{titleLanguage&&titleLanguage!==textLanguage&&<p className="source-retrieved">{textLanguage.toUpperCase()} title unavailable · showing {titleLanguage.toUpperCase()}</p>}<Value value={record.value} language={textLanguage}/></section>:<p>No records were returned.</p>}
    </>}
  </dialog>,document.body);
}

export function PocSourceLink({url,language='en',reference,websiteUrl,children,compact=false}:{url:string;language?:string;reference?:string;websiteUrl?:string|null;children:ReactNode;compact?:boolean}) {
  const suppliedWebsite=websiteUrl&&/^https:\/\/www\.europarl\.europa\.eu\/doceo\/document\/[A-Z0-9-]+_[A-Z]{2}\.html$/.test(websiteUrl)?websiteUrl:null;
  const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null),target=sourceTarget(url),website=suppliedWebsite||humanSourceUrl(url,{language,reference});
  const close=()=>{setOpen(false);trigger.current?.focus();};
  const href=website||safeHref(url);
  if(!target)return href?<span className={'source-link'+(compact?' source-link-compact':'')}><a href={href} target="_blank" rel="noreferrer">{children}</a>{website&&!compact&&<a className="source-raw" href={url} target="_blank" rel="noreferrer">Open original source ↗</a>}</span>:<>{children}</>;
  return <span className={'source-link'+(compact?' source-link-compact':'')}>
    {website?<><a href={website} target="_blank" rel="noreferrer">{children}</a><button ref={trigger} type="button" className="source-read" onClick={()=>setOpen(true)} aria-label={'Read source data for '+(reference||target.id||target.family)} aria-haspopup="dialog" aria-expanded={open}>Read data</button></>:<button ref={trigger} type="button" className="source-read source-primary" onClick={()=>setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>{children}</button>}
    {!compact&&<a className="source-raw" href={url} target="_blank" rel="noreferrer">Open original source ↗</a>}
    {open&&<SourceDialog key={url} url={url} language={language} close={close}/>}
  </span>;
}
