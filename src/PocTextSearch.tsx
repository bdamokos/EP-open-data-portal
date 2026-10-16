import {useEffect,useId,useRef,useState,type RefObject} from 'react';
import {API_ROOT} from './api';
import {useData} from './pocData';
import {useExplorerParam} from './pocExplorerUrl';
import {findTextOffsets,parseTextReadKey,searchSnippetParts,searchRangeParts,textReadKey} from './pocTextSearchModel.mjs';
import './PocTextSearch.css';

type Kind='speech'|'question'|'answer';
type Person={id:number;name:string|null;role:string};
type Hit={sourceId:string;sourceKey:string;kind:Kind;parentId:string|null;date:string|null;language:string;translationType:string;sourceUrl:string;sha256:string;snippet:string;people?:Person[]};
type Result={sourceId:string;kind:Kind;parentId:string|null;date:string|null;questionDate?:string|null;answerDate?:string|null;title:string|null;reference:string|null;people?:Person[];hits:Hit[]};
type Response={total:number;offset:number;limit:number;nextOffset:number|null;truncated:boolean;results:Result[];coverage:{complete?:boolean;backfillComplete?:boolean;note?:string;phase?:string}};
type StoredText=Hit&{body:string;highlightedBody?:string;highlightRanges?:{start:number;end:number}[];highlightsTruncated?:boolean;fetchedAt:string;checkedAt:string};
export interface TextSearchProps {
  prefix:string;label:string;language:string;kinds?:Kind[];member?:number|string;country?:string;from?:string;to?:string;
  sourceIds?:string[];group?:'document'|'question';dateBasis?:'document'|'question';scopeNote?:string;disabledReason?:string;
  className?:string;onActiveChange?:(active:boolean)=>void;
}
const languages=['bg','cs','da','de','el','en','es','et','fi','fr','ga','hr','hu','it','lt','lv','mt','nl','pl','pt','ro','sk','sl','sv'];
const kindLabel=(kind:Kind)=>kind==='speech'?'Speech':kind==='answer'?'Institutional answer':'Question';
const languageName=(code:string,locale:string)=>{try{return new Intl.DisplayNames([locale],{type:'language'}).of(code)||code.toUpperCase();}catch{return code.toUpperCase();}};
const dateLabel=(value:string|null|undefined,language:string)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(value.length===10?value+'T12:00:00Z':value)):'';
function Magnifier(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>;}
function CloseIcon(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>;}
function Excerpt({text}:{text:string}){return <>{searchSnippetParts(text).map((part,i)=>part.match?<mark key={i}>{part.text}</mark>:<span key={i}>{part.text}</span>)}</>;}
function Attribution({hit}:{hit:Hit}) {
  const names=hit.people?.map(p=>p.name).filter(Boolean).join(', ');
  return names?<span>{hit.kind==='answer'?'Answer to a question by ':hit.kind==='question'?'Question by ':'Speaker: '}{names}</span>:hit.kind==='answer'?<span>Answering institution’s text · linked question authorship</span>:null;
}
function StoredReader({identity,query,expectedHash,sourceUrl,language}:{identity:{sourceId:string;sourceKey:string};query:string;expectedHash?:string;sourceUrl?:string;language:string}) {
  const params=new URLSearchParams({'source-id':identity.sourceId,'source-key':identity.sourceKey});if(query.trim())params.set('q',query);
  const {data,error,loading,retry}=useData<StoredText>('corpus/text?'+params),body=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!data)return;const frame=window.requestAnimationFrame(()=>body.current?.querySelector('mark')?.scrollIntoView({block:'nearest'}));return()=>window.cancelAnimationFrame(frame);},[data]);
  return <section className="poc-search-reader" aria-label="Indexed matching text">
    {loading&&!data&&<p role="status">Opening saved text…</p>}
    {error&&<p role="alert">{error} <button type="button" className="poc-search-link" onClick={retry}>Retry</button>{sourceUrl&&<> · <a href={sourceUrl} target="_blank" rel="noreferrer">Open Parliament source ↗</a></>}</p>}
    {data&&<><div className="poc-search-meta"><span>{languageName(data.language,language)} · {data.translationType==='machine'?'Parliament machine translation':data.translationType==='original'?'Original text':'Published text'}</span><span>{identity.sourceId}</span></div>
      {expectedHash&&expectedHash!==data.sha256&&<p className="poc-search-status">This text changed after the search. Run the search again for updated excerpts.</p>}
      <div className="poc-search-body" ref={body} lang={data.language}>{data.highlightRanges?searchRangeParts(data.body,data.highlightRanges).map((part,i)=>part.match?<mark key={i}>{part.text}</mark>:<span key={i}>{part.text}</span>):<Excerpt text={data.highlightedBody??data.body}/>}</div>
      {data.highlightsTruncated&&<p className="poc-search-hint">Only the first matching passages are highlighted in this long text.</p>}
      <div className="poc-search-source"><a href={data.sourceUrl} target="_blank" rel="noreferrer">Parliament source ↗</a><span>Retrieved {dateLabel(data.fetchedAt,language)}</span></div></>}
  </section>;
}

export function PocTextSearch({prefix,label,language,kinds,member,country,from,to,sourceIds,group='document',dateBasis='document',scopeNote,disabledReason,className='',onActiveChange}:TextSearchProps) {
  const [query,setQuery]=useExplorerParam<string>(prefix+'-search','');
  const [textLanguage,setTextLanguage]=useExplorerParam<string>(prefix+'-text-lang','');
  const [page,setPage]=useExplorerParam<number>(prefix+'-page',0);
  const [read,setRead]=useExplorerParam<string>(prefix+'-read','');
  const [field,setField]=useExplorerParam<string>(prefix+'-kind','');
  const [sort,setSort]=useExplorerParam<string>(prefix+'-sort','relevance',['relevance','newest']);
  const [open,setOpen]=useState(Boolean(query||read)),[draft,setDraft]=useState(query),[attempt,setAttempt]=useState(0);
  const [state,setState]=useState<{key:string;data:Response|null;loading:boolean;error:string|null}>({key:'',data:null,loading:false,error:null});
  const [variants,setVariants]=useState<Record<string,string>>({});
  const input=useRef<HTMLInputElement>(null),toggle=useRef<HTMLButtonElement>(null),panel=useId();
  const callback=useRef(onActiveChange);callback.current=onActiveChange;
  const allowedKinds=kinds?.length?kinds:['speech','question','answer'];
  const actualKinds=allowedKinds.includes(field as Kind)?[field]:allowedKinds;
  const searchedLanguage=textLanguage||(languages.includes(language)?language:'en');
  const scope=JSON.stringify({member,country,from,to,sourceIds:sourceIds===undefined?undefined:[...new Set(sourceIds)].sort(),kinds:allowedKinds,group,dateBasis});
  const previousScope=useRef(scope),previousLanguage=useRef(searchedLanguage);
  useEffect(()=>{if(previousScope.current!==scope){previousScope.current=scope;setPage(0);setRead('');setVariants({});}},[scope,setPage,setRead]);
  useEffect(()=>{if(previousLanguage.current!==searchedLanguage){previousLanguage.current=searchedLanguage;setPage(0);setRead('');}},[searchedLanguage,setPage,setRead]);
  useEffect(()=>setDraft(query),[query]);
  useEffect(()=>{if(query)setOpen(true);},[query]);
  useEffect(()=>{callback.current?.(open);return()=>callback.current?.(false);},[open]);
  useEffect(()=>{if(open){const frame=window.requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));return()=>window.cancelAnimationFrame(frame);}},[open]);
  const request=JSON.stringify({query,kinds:actualKinds,language:searchedLanguage==='all'?undefined:searchedLanguage,uiLanguage:language,member,country,from,to,sourceIds,group,dateBasis,sort,limit:20,offset:page*20});
  const activeRequest=open&&Boolean(query)&&!disabledReason&&previousScope.current===scope;
  useEffect(()=>{
    if(!activeRequest)return;
    const controller=new AbortController();let current=true;
    setState(old=>({key:request,data:old.key===request?old.data:null,loading:true,error:null}));
    const timer=window.setTimeout(()=>controller.abort(),8000);
    fetch(API_ROOT+'/poc/corpus/search',{method:'POST',credentials:'omit',headers:{Accept:'application/json','Content-Type':'application/json'},body:request,signal:controller.signal}).then(async response=>{
      const data=await response.json().catch(()=>null);
      if(!response.ok){const code=data?.error?.code;let message=data?.error?.message||'Text search is temporarily unavailable.';
        if(response.status===404||response.status===403||code==='corpus_disabled')message='Text search is not available on this site yet. You can still browse the documents.';
        else if(code==='corpus_busy')message='Search is busy. Please retry in a moment.';
        else if(code==='corpus_query_timeout')message='This search took too long. Narrow the period or text language, then retry.';
        throw new Error(message);}
      if(!data||!Array.isArray(data.results))throw new Error('Text search returned an unreadable response. Please retry.');
      if(current)setState({key:request,data,loading:false,error:null});
    }).catch(error=>{if(current)setState(old=>({...old,loading:false,error:controller.signal.aborted?'This search took too long. Please retry.':error.message}));}).finally(()=>clearTimeout(timer));
    return()=>{current=false;controller.abort();clearTimeout(timer);};
  },[request,activeRequest,attempt]);
  const data=state.key===request?state.data:null,loading=activeRequest&&(state.key!==request||state.loading),error=state.key===request?state.error:null;
  const selected=parseTextReadKey(read),allHits=data?.results.flatMap(r=>r.hits)||[],selectedHit=allHits.find(hit=>textReadKey(hit)===read);
  function close(){setOpen(false);setRead('');window.requestAnimationFrame(()=>toggle.current?.focus({preventScroll:true}));}
  function submit(event:React.FormEvent){event.preventDefault();const next=draft.trim();if(!textLanguage)setTextLanguage(searchedLanguage);setQuery(next);setPage(0);setRead('');setVariants({});if(next===query)setAttempt(v=>v+1);}
  return <div className={'poc-text-search '+(open?'is-open ':'')+className} onKeyDown={event=>{if(event.key==='Escape'&&open){event.stopPropagation();close();}}}>
    <button ref={toggle} type="button" className="poc-search-icon" aria-label={label} title={label} aria-expanded={open} aria-controls={panel} onClick={()=>open?close():setOpen(true)}><Magnifier/>{query&&!open&&<span className="poc-search-dot"/>}</button>
    {open&&<section className="poc-search-panel" id={panel} aria-label={label}>
      <header className="poc-search-heading"><h3>{label}</h3><button type="button" className="poc-search-icon" aria-label="Close text search" title="Close text search" onClick={close}><CloseIcon/></button></header>
      <form onSubmit={submit}><div className="poc-search-input"><label className="poc-search-field"><span className="poc-search-sr">Words or exact phrase</span><input ref={input} type="search" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={200} placeholder="Words or “exact phrase”" aria-describedby={panel+'-hint'}/></label><button type="submit" className="poc-search-icon" aria-label="Run text search" title="Search" disabled={Boolean(disabledReason)||loading}><Magnifier/></button></div>
      <p id={panel+'-hint'} className="poc-search-hint">All words · Use quotes for a phrase</p>
      <div className="poc-search-facets"><label>Text language<select value={searchedLanguage} onChange={e=>{setTextLanguage(e.target.value);setPage(0);setRead('');}}>{languages.map(code=><option value={code} key={code}>{languageName(code,language)}</option>)}<option value="all">All available languages</option></select></label>
      {allowedKinds.length>1&&<label>Search in<select value={actualKinds.length===1?actualKinds[0]:''} onChange={e=>{setField(e.target.value);setPage(0);setRead('');}}><option value="">{group==='question'?'Questions and answers':'Speeches, questions and answers'}</option>{allowedKinds.map(kind=><option key={kind} value={kind}>{kind==='answer'?'Answer text':kind==='question'?'Question text':'Speech text'}</option>)}</select></label>}
      <label>Order<select value={sort} onChange={e=>{setSort(e.target.value);setPage(0);setRead('');}}><option value="relevance">Best match</option><option value="newest">Newest first</option></select></label></div></form>
      {scopeNote&&<p className="poc-search-scope">{scopeNote}</p>}
      {(from||to)&&<p className="poc-search-hint">{dateBasis==='question'?'Question date':'Publication date'}: {dateLabel(from,language)||'start'} — {dateLabel(to,language)||'present'}</p>}
      {disabledReason&&<p role="status" className="poc-search-status">{disabledReason}</p>}
      {loading&&<p role="status" className="poc-search-status">Searching saved text…</p>}
      {error&&<p role="alert" className="poc-search-status">{error} <button className="poc-search-link" type="button" onClick={()=>setAttempt(v=>v+1)}>Retry</button></p>}
      {data&&<div className="poc-search-results" aria-busy={loading}>
        <p role="status" className="poc-search-count">{data.total.toLocaleString(language)} {group==='question'?(data.total===1?'matching question':'matching questions'):(data.total===1?'matching document':'matching documents')} · {data.coverage.backfillComplete||data.coverage.complete?'Indexed texts only':'Partial text coverage'}</p>
        {!data.total&&<p>No matches in indexed text. Try another phrase, language or period.</p>}
        {data.results.map(result=>{
          const sources=[...new Set(result.hits.map(hit=>hit.sourceId))];
          return <article className="poc-search-result" key={result.sourceId}><div className="poc-search-meta"><span>{group==='question'?'Question':kindLabel(result.kind)}{result.reference?' · '+result.reference:''}</span><span>{dateLabel(result.questionDate||result.date,language)}</span></div><h4>{result.title||result.sourceId}</h4>
          {sources.map(id=>{const versions=result.hits.filter(hit=>hit.sourceId===id),hit=versions.find(h=>textReadKey(h)===read)||versions.find(h=>h.sourceKey===variants[id])||versions.find(h=>h.language===searchedLanguage)||versions.find(h=>h.language===language)||versions[0];if(!hit)return null;const key=textReadKey(hit);return <div className="poc-search-match" key={id}>
            <div className="poc-search-meta"><span>{hit.kind==='answer'?'Match in institutional answer':hit.kind==='question'?'Match in question text':'Match in speech'}{hit.kind==='answer'&&hit.date?' · '+dateLabel(hit.date,language):''}</span><span>{languageName(hit.language,language)}{hit.translationType==='machine'?' · machine translation':''}</span></div>
            <div className="poc-search-attribution"><Attribution hit={hit}/></div><p className="poc-search-excerpt"><Excerpt text={hit.snippet}/></p>
            <div className="poc-search-actions"><button type="button" className="poc-search-link" aria-expanded={read===key} onClick={()=>setRead(read===key?'':key)}>{read===key?'Close text':hit.kind==='speech'?'Read speech':hit.kind==='answer'?'Read answer':'Read question'}</button>
            {versions.length>1&&<label className="poc-search-versions"><span>Matching versions</span><select value={hit.sourceKey} onChange={event=>{setVariants(previous=>({...previous,[id]:event.target.value}));if(read)setRead('');}}>{versions.map(version=><option value={version.sourceKey} key={version.sourceKey}>{languageName(version.language,language)}{versions.some(v=>v.language===version.language&&v.sourceKey!==version.sourceKey)?' · '+version.sourceKey:''}</option>)}</select></label>}</div>
            {selected&&read===key&&<StoredReader identity={selected} query={query} expectedHash={hit.sha256} sourceUrl={hit.sourceUrl} language={language}/>}</div>;})}</article>;
        })}
        {(page>0||data.nextOffset!==null)&&<nav className="poc-search-pages" aria-label="Search result pages"><button type="button" className="poc-search-link" disabled={!page||loading} onClick={()=>{setPage(Math.max(0,page-1));setRead('');}}>Previous</button><span>Page {page+1}</span><button type="button" className="poc-search-link" disabled={data.nextOffset===null||loading} onClick={()=>{setPage((data.nextOffset||0)/20);setRead('');}}>Next</button></nav>}
        {data.truncated&&<p className="poc-search-status">More matches are available. Narrow the period, language or document type to see them.</p>}
      </div>}
      {selected&&!selectedHit&&!loading&&<><p className="poc-search-status">Opening the linked saved text independently of this results page.</p><StoredReader identity={selected} query={query} language={language}/></>}
    </section>}
  </div>;
}

// CSS Custom Highlights leave React-managed text, links and footnotes intact.
// Where unsupported, select only the active match using the native Selection.
export function PocFindInText({target,label='Find in this text',onOpen}:{target:RefObject<HTMLElement|null>;label?:string;onOpen?:()=>void}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[index,setIndex]=useState(0),[ranges,setRanges]=useState<Range[]>([]);
  const input=useRef<HTMLInputElement>(null),toggle=useRef<HTMLButtonElement>(null),id=useId(),highlightId='find'+id.replace(/\W/g,''),lastSelection=useRef<Range|null>(null);
  const active=ranges[index%Math.max(1,ranges.length)];
  const highlightApi=()=>({registry:(globalThis.CSS as unknown as {highlights?:Map<string,unknown>})?.highlights,Highlight:(globalThis as unknown as {Highlight?:new(...ranges:Range[])=>unknown}).Highlight});
  useEffect(()=>{
    if(!open||!query.trim()||!target.current){setRanges([]);return;}
    const frame=window.requestAnimationFrame(()=>{const element=target.current;if(!element)return;const walker=document.createTreeWalker(element,window.NodeFilter.SHOW_TEXT),nodes:{node:Text;start:number;end:number}[]=[];let node,text='';
      while((node=walker.nextNode())){const parent=node.parentElement;if(!parent||parent.closest('button,script,style,[hidden]'))continue;const value=node.textContent||'';nodes.push({node:node as Text,start:text.length,end:text.length+value.length});text+=value;}
      const found=findTextOffsets(text,query).flatMap(hit=>{const start=nodes.find(n=>n.end>hit.start),end=nodes.find(n=>n.end>=hit.end);if(!start||!end)return [];const range=document.createRange();range.setStart(start.node,hit.start-start.start);range.setEnd(end.node,hit.end-end.start);return [range];});setRanges(found);setIndex(0);
    });return()=>window.cancelAnimationFrame(frame);
  },[open,query,target]);
  useEffect(()=>{if(open){const frame=window.requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));return()=>window.cancelAnimationFrame(frame);}},[open]);
  useEffect(()=>{const {registry,Highlight}=highlightApi();if(registry&&Highlight&&open){registry.set(highlightId,new Highlight(...ranges));if(active)registry.set(highlightId+'active',new Highlight(active));}
    if(active&&open){if(!registry||!Highlight){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(active);lastSelection.current=active;}active.startContainer.parentElement?.scrollIntoView({block:'nearest'});}
    return()=>{registry?.delete(highlightId);registry?.delete(highlightId+'active');const selection=window.getSelection();if(lastSelection.current&&selection?.rangeCount&&selection.getRangeAt(0).compareBoundaryPoints(window.Range.START_TO_START,lastSelection.current)===0)selection.removeAllRanges();lastSelection.current=null;};
  },[ranges,active,open,highlightId]);
  function close(){setOpen(false);setQuery('');setRanges([]);window.requestAnimationFrame(()=>toggle.current?.focus({preventScroll:true}));}
  return <div className="poc-find-text" onKeyDown={event=>{if(event.key==='Escape'&&open){event.stopPropagation();close();}}}>
    <button ref={toggle} type="button" className="poc-search-icon" aria-label={label} title={label} aria-expanded={open} aria-controls={id} onClick={()=>{if(open)close();else{onOpen?.();setOpen(true);}}}><Magnifier/></button>
    {open&&<><style>{'::highlight('+highlightId+'){background:#fff2a3;color:#012b5d}::highlight('+highlightId+'active){background:#ffcc33;color:#012b5d}'}</style><div className="poc-find-controls" id={id}>
      <label><span className="poc-search-sr">{label}</span><input ref={input} type="search" aria-label={label} value={query} maxLength={200} placeholder={label} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();setIndex(value=>(value+(event.shiftKey?-1:1)+Math.max(1,ranges.length))%Math.max(1,ranges.length));}}}/></label>
      <span role="status">{query?(ranges.length?`${index%ranges.length+1} / ${ranges.length}${ranges.length===1000?'+':''}`:'No matches'):''}</span>
      <button className="poc-search-icon" type="button" aria-label="Previous match" title="Previous match" disabled={!ranges.length} onClick={()=>setIndex(value=>(value-1+ranges.length)%ranges.length)}>↑</button><button className="poc-search-icon" type="button" aria-label="Next match" title="Next match" disabled={!ranges.length} onClick={()=>setIndex(value=>(value+1)%ranges.length)}>↓</button><button className="poc-search-icon" type="button" aria-label="Close find" title="Close find" onClick={close}><CloseIcon/></button>
    </div></>}
  </div>;
}
