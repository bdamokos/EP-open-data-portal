import {agendaTitle} from './topicPresentation.mjs';
import {reportUiError} from './errorDiagnostics.mjs';
import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {useEffect,useId,useImperativeHandle,useRef,useState,type RefObject,type ReactNode} from 'react';
import {sourcePageUrl} from './SourceLink';
import {API_ROOT} from './api';
import {PersonName,usePersonName} from './PersonName';
import {useData} from './data';
import {useTextSearchParam,useGlobalSearchMemory} from './globalSearchState';
import {findTextOffsets,parseTextReadKey,searchSnippetParts,searchRangeParts,textReadKey} from './textSearchModel.mjs';
import './TextSearch.css';
import {ParliamentSearchResults} from './ParliamentSearchResults';

type Kind='speech'|'question'|'answer';
type Person={id:number;name:string|null;role:string};
type Hit={sourceId:string;sourceKey:string;kind:Kind;parentId:string|null;date:string|null;language:string;translationType:string;sourceUrl:string;sha256:string;snippet:string;people?:Person[]};
type Result={sourceId:string;kind:Kind;parentId:string|null;date:string|null;questionDate?:string|null;answerDate?:string|null;title:string|null;reference:string|null;people?:Person[];hits:Hit[]};
type Response={total:number;offset:number;limit:number;nextOffset:number|null;truncated:boolean;responseLimited?:boolean;results:Result[];coverage:{complete?:boolean;backfillComplete?:boolean;note?:string;phase?:string}};
type StoredText=Hit&{body:string;highlightedBody?:string;highlightRanges?:{start:number;end:number}[];highlightsTruncated?:boolean;fetchedAt:string;checkedAt:string};
export interface TextSearchProps {
  prefix:string;label:string;language:string;kinds?:Kind[];member?:number|string;country?:string;addressee?:string;from?:string;to?:string;
  sourceIds?:string[];scopeIdentity?:string;group?:'document'|'question';dateBasis?:'document'|'question';scopeNote?:ReactNode;disabledReason?:string;
  className?:string;onActiveChange?:(active:boolean)=>void;global?:boolean;inline?:boolean;summary?:ReactNode;inputRef?:RefObject<HTMLInputElement|null>;resetRef?:RefObject<(()=>void)|null>;
}
const languages=['bg','cs','da','de','el','en','es','et','fi','fr','ga','hr','hu','it','lt','lv','mt','nl','pl','pt','ro','sk','sl','sv'];
const kindLabel=(kind:Kind, ui: import('./uiI18n.mjs').UiFormatter = defaultUi)=>(kind==='speech') ? ui.t("dossieractivity.speech") : ((kind==='answer') ? ui.t("textsearch.institutional_answer") : ui.t("textsearch.question"));
const languageName=(code:string,locale:string)=>{try{return new Intl.DisplayNames([locale],{type:'language'}).of(code)||code.toUpperCase();}catch{return code.toUpperCase();}};
const dateLabel=(value:string|null|undefined,language:string)=>(value && Number.isFinite(Date.parse(value))) ? new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date((value.length===10) ? (value+'T12:00:00Z') : value)) : '';
function Magnifier(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>;}
function CloseIcon(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>;}
function Excerpt({text}:{text:string}){return <>{searchSnippetParts(text).map((part,i)=>part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>)}</>;}
function Attribution({hit}:{hit:Hit}) {
  const displayName=usePersonName();
  const people=(hit.people||[]).filter(person=>Boolean(displayName(person.id,person.name)));
  return people.length ? <span><UiMessage id={hit.kind==='answer'?'textsearch.answer_to_a_question_by_people':hit.kind==='question'?'textsearch.question_by_people':'textsearch.speaker_people'} values={{people:<span lang="">{people.map((person,index)=><span key={person.id+':'+index}>{index ? ', ' : ''}<PersonName id={person.id} label={person.name}/></span>)}</span>}}/></span> : (hit.kind==='answer' ? <span><UiMessage id="textsearch.answer"/></span> : null);
}
function StoredReader({identity,query,expectedHash,sourceUrl,language}:{identity:{sourceId:string;sourceKey:string};query:string;expectedHash?:string;sourceUrl?:string;language:string}) {
  const ui = useUiI18n();
  const params=new URLSearchParams({'source-id':identity.sourceId,'source-key':identity.sourceKey});if(query.trim())params.set('q',query);
  const {data,error,loading,retry}=useData<StoredText>('corpus/text?'+params),body=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!data)return;const frame=window.requestAnimationFrame(()=>body.current?.querySelector('mark')?.scrollIntoView({block:'nearest'}));return()=>window.cancelAnimationFrame(frame);},[data]);
  return <section className="explorer-search-reader" lang={ui.language} aria-label={ui.t("textsearch.matching_text")}>
    {loading&&!data&&<p role="status"><UiMessage id="textsearch.opening"/></p>}
    {error&&<p role="alert">{error} <button type="button" className="explorer-search-link" onClick={retry}><UiMessage id="textsearch.retry.9f5cd8"/></button>{sourcePageUrl(sourceUrl)&&<> · <a href={sourcePageUrl(sourceUrl)!} target="_blank" rel="noreferrer"><UiMessage id="textsearch.parliament_page"/></a></>}</p>}
    {data&&<><div className="explorer-search-meta"><span><>{<span lang={language}>{languageName(data.language,language)}</span>} · {((data.translationType==='machine') ? ui.t("textsearch.parliament_machine_translation") : ((data.translationType==='original') ? ui.t("textsearch.original_text") : ui.t("textsearch.published_text")))}</></span></div>
      {expectedHash&&expectedHash!==data.sha256&&<p className="explorer-search-status"><UiMessage id="textsearch.text_changed_since_the_search_search_again_to_update_the_exc"/></p>}
      <div className="explorer-search-body" ref={body} lang={data.language||''}>{data.highlightRanges ? searchRangeParts(data.body,data.highlightRanges).map((part,i)=>part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>) : <Excerpt text={data.highlightedBody??data.body}/>}</div>
      {data.highlightsTruncated&&<p className="explorer-search-hint"><UiMessage id="textsearch.only_the_first_matches_are_highlighted"/></p>}
      {sourcePageUrl(data.sourceUrl,{language:data.language||language})&&<div className="explorer-search-source"><a href={sourcePageUrl(data.sourceUrl,{language:data.language||language})!} target="_blank" rel="noreferrer"><UiMessage id="textsearch.parliament_page"/></a></div>}</>}
  </section>;
}

export function TextSearch({prefix,label,language,kinds,member,country,addressee,from,to,sourceIds,scopeIdentity,group='document',dateBasis='document',scopeNote,disabledReason,className='',onActiveChange,global=false,inline=false,summary,inputRef,resetRef}:TextSearchProps) {
  const ui = useUiI18n();
  useGlobalSearchMemory(prefix);
  const [query,setQuery]=useTextSearchParam<string>(prefix+'-search','');
  const [textLanguage,setTextLanguage]=useTextSearchParam<string>(prefix+'-text-lang','');
  const [page,setPage]=useTextSearchParam<number>(prefix+'-page',0);
  const [exactOffset,setExactOffset]=useTextSearchParam<number>(prefix+'-offset',-1);
  const offset=(exactOffset<0) ? (page*20) : exactOffset;
  const [read,setRead]=useTextSearchParam<string>(prefix+'-read','');
  const [field,setField]=useTextSearchParam<string>(prefix+'-kind','');
  const [,setCatalogOffset]=useTextSearchParam<number>('global-fts-catalog-offset',0);
  const [searchFrom,setSearchFrom]=useTextSearchParam<string>('global-fts-from','');
  const [searchTo,setSearchTo]=useTextSearchParam<string>('global-fts-to','');
  const [sort,setSort]=useTextSearchParam<string>(prefix+'-sort','relevance',['relevance','newest']);
  const [closed,setClosed]=useTextSearchParam<string>(prefix+'-closed','',['','1']);

  const [open,setOpen]=useState(closed!=='1'&&Boolean(query||read)),[draft,setDraft]=useState(query),[attempt,setAttempt]=useState(0);
  const [state,setState]=useState<{key:string;data:Response|null;loading:boolean;error:string|null}>({key:'',data:null,loading:false,error:null});
  const [variants,setVariants]=useState<Record<string,string>>({});
  const localInput=useRef<HTMLInputElement>(null),input=inputRef||localInput,toggle=useRef<HTMLButtonElement>(null),panel=useId();
  const debounceTimer=useRef<number|null>(null);
  const callback=useRef(onActiveChange);callback.current=onActiveChange;
  const allowedKinds=kinds?.length ? kinds : (['speech','question','answer']);
  const actualKinds=allowedKinds.includes(field as Kind) ? ([field]) : allowedKinds;
  const catalogType=['mep','topic','question'].includes(field) ? field : 'all';
  const showCatalog=global&&!['speech','answer'].includes(field);
  const showText=!global||!['mep','topic'].includes(field);
  const dateFrom=global ? (searchFrom||undefined) : from,dateTo=global ? (searchTo||undefined) : to;
  const searchedLanguage=textLanguage||(languages.includes(language) ? language : 'en');
  const scope=JSON.stringify({member,country,addressee,kinds:allowedKinds,group,dateBasis,...((scopeIdentity===undefined) ? ({from,to,sourceIds:(sourceIds===undefined) ? undefined : [...new Set(sourceIds)].sort()}) : ({identity:scopeIdentity}))});
  const navigationKey=()=>{const url=new URL(location.href);url.searchParams.sort();return url.pathname+url.search+url.hash;};
  const restoredHistory=useRef<string|null>(null),previousScope=useRef({key:scope,ready:!disabledReason});
  useEffect(()=>{const restored=()=>{restoredHistory.current=navigationKey();};window.addEventListener('popstate',restored);return()=>window.removeEventListener('popstate',restored);},[]);
  const scopeChanging=previousScope.current.ready&&previousScope.current.key!==scope&&restoredHistory.current!==navigationKey();
  useEffect(()=>{const previous=previousScope.current;previousScope.current={key:scope,ready:!disabledReason};if(previous.ready&&previous.key!==scope&&restoredHistory.current!==navigationKey()){setPage(0);setExactOffset(-1);setRead('');setVariants({});}},[scope,disabledReason,setPage,setExactOffset,setRead]);
  useEffect(()=>setDraft(query),[query]);
  const previousNavigation=useRef({query,read,closed});
  useEffect(()=>{const previous=previousNavigation.current;previousNavigation.current={query,read,closed};if(closed==='1')setOpen(false);else if(query&&query!==previous.query||read&&read!==previous.read||previous.closed==='1'&&(query||read))setOpen(true);},[query,read,closed]);
  const active=inline ? Boolean(query||read) : open,pendingDraft=inline&&draft.trim()!==query;
  useEffect(()=>{callback.current?.(active);return()=>callback.current?.(false);},[active]);
  useEffect(()=>{if(open&&!inline){const frame=window.requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));return()=>window.cancelAnimationFrame(frame);}},[open,inline]);
  useEffect(()=>{
    if(!pendingDraft)return;
    const timer=window.setTimeout(()=>{debounceTimer.current=null;setClosed('');setQuery(draft.trim());setPage(0);setExactOffset(-1);setRead('');setVariants({});},300);
    debounceTimer.current=timer;
    return()=>{window.clearTimeout(timer);if(debounceTimer.current===timer)debounceTimer.current=null;};
  },[pendingDraft,draft,setClosed,setQuery,setPage,setExactOffset,setRead]);
  const request=JSON.stringify({query,kinds:actualKinds,language:(searchedLanguage==='all') ? undefined : searchedLanguage,uiLanguage:language,member,country,addressee,from:dateFrom,to:dateTo,sourceIds,group,dateBasis,sort,limit:20,offset});
  const searchIdentity=JSON.stringify({...JSON.parse(request),offset:0});
  const predecessors=useRef<{key:string;offsets:Map<number,number>}>({key:searchIdentity,offsets:new Map()});
  if(predecessors.current.key!==searchIdentity)predecessors.current={key:searchIdentity,offsets:new Map()};
  const previousOffset=predecessors.current.offsets.get(offset)??0;
  const previousLabel=(!predecessors.current.offsets.has(offset)) ? ui.t("textsearch.first_page") : ui.t("textsearch.previous");
  function moveTo(next:number){setExactOffset(next);setPage(0);setRead('');}
  const activeRequest=(inline||open)&&Boolean(query)&&!pendingDraft&&!disabledReason&&!scopeChanging&&showText;
  useEffect(()=>{
    if(!activeRequest)return;
    const controller=new AbortController();let current=true;
    setState(old=>({key:request,data:(old.key===request) ? old.data : null,loading:true,error:null}));
    const timer=window.setTimeout(()=>controller.abort(),8000);
    fetch(API_ROOT+'/corpus/search',{method:'POST',credentials:'omit',headers:{Accept:'application/json','Content-Type':'application/json'},body:request,signal:controller.signal}).then(async response=>{
      const data=await response.json().catch(()=>null);
      if(!response.ok){const code=data?.error?.code;let message=data?.error?.message||ui.t("textsearch.text_search_is_temporarily_unavailable");
        if(response.status===404||response.status===403||code==='corpus_disabled')message=ui.t("textsearch.text_search_is_not_available_yet");
        else if(code==='corpus_busy')message=ui.t("textsearch.search_is_busy_please_retry_in_a_moment");
        else if(code==='corpus_query_timeout')message=ui.t("textsearch.this_search_took_too_long_narrow_the_period_or_text_language");
        throw new Error(message);}
      if(!data||!Array.isArray(data.results))throw new Error(ui.t("textsearch.search_failed_try_again"));
      if(current)setState({key:request,data,loading:false,error:null});
    }).catch(error=>{if(current){reportUiError(controller.signal.aborted?new Error():error,{request:API_ROOT+'/corpus/search',...(controller.signal.aborted?{code:'textsearch.this_search_took_too_long_please_retry'}:{})});setState(old=>({...old,loading:false,error:controller.signal.aborted ? ui.t("textsearch.this_search_took_too_long_please_retry") : error.message}));}}).finally(()=>clearTimeout(timer));
    return()=>{current=false;controller.abort();clearTimeout(timer);};
  },[request,activeRequest,attempt]);
  const data=(((((showText && (!disabledReason)) && (!scopeChanging)) && (!pendingDraft)) && (!inline||query)) && (state.key===request)) ? state.data : null,loading=activeRequest&&(state.key!==request||state.loading)||pendingDraft&&Boolean(draft.trim()),error=((((showText && (!disabledReason)) && (!pendingDraft)) && (!inline||query)) && (state.key===request)) ? state.error : null;
  const selected=(!showText||disabledReason||scopeChanging||pendingDraft) ? null : parseTextReadKey(read),allHits=data?.results.flatMap(r=>r.hits)||[],selectedHit=allHits.find(hit=>textReadKey(hit)===read);
  function clearSearch(){if(debounceTimer.current!==null)window.clearTimeout(debounceTimer.current);debounceTimer.current=null;setDraft('');setClosed('');setQuery('');reset();setVariants({});}
  useImperativeHandle(resetRef,()=>clearSearch);
  function close(){if(inline){clearSearch();input.current?.focus();return;}setOpen(false);setClosed((prefix==='global-fts'||query) ? '1' : '');setRead('');window.requestAnimationFrame(()=>toggle.current?.focus({preventScroll:true}));}
  function reset(){setPage(0);setExactOffset(-1);if(global)setCatalogOffset(0);setRead('');}
  function submit(event:React.FormEvent){event.preventDefault();const next=draft.trim();setClosed('');if(!textLanguage)setTextLanguage(searchedLanguage);setQuery(next);reset();setVariants({});if(next===query)setAttempt(v=>v+1);}

  return <div lang={ui.language} className={'explorer-text-search '+((inline||open) ? 'is-open ' : '')+(inline ? 'explorer-text-search-inline ' : '')+className} onKeyDown={event=>{if(event.key==='Escape'&&(inline||open)){event.stopPropagation();close();}}}>
    {!inline&&<button ref={toggle} type="button" className={"explorer-search-icon"+((!global) ? " explorer-search-launcher" : "")} aria-label={global ? label : ui.t("textsearch.search_text_label", {label: String(label.replace(/^Search\s+/i,''))})} title={label} aria-expanded={open} aria-controls={panel} onClick={()=>{if(open)close();else{setClosed('');setOpen(true);}}}><Magnifier/>{!global&&<span><UiMessage id="textsearch.search_text"/></span>}{query&&!open&&<span className="explorer-search-dot"/>}</button>}
    {(inline||open)&&<section className="explorer-search-panel" id={panel} aria-label={label}>
      {!inline&&<header className="explorer-search-heading"><h3>{label}</h3><button type="button" className="explorer-search-icon" aria-label={global ? ui.t("textsearch.close_search") : ui.t("textsearch.close_text_search")} title={global ? ui.t("textsearch.close_search") : ui.t("textsearch.close_text_search")} onClick={close}><CloseIcon/></button></header>}
      <form onSubmit={submit}><div className="explorer-search-inline-heading"><div className="explorer-search-input"><label className="explorer-search-field"><span className="explorer-search-sr">{inline ? label : (global ? ui.t("textsearch.names_topics_or_words") : ui.t("textsearch.words_or_exact_phrase_132"))}</span><input ref={input} type="search" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={200} placeholder={inline ? ui.t("textsearch.search_speech_text") : (global ? ui.t("textsearch.names_topics_or_words") : ui.t("textsearch.words_or_exact_phrase"))} aria-describedby={(!inline) ? (panel+'-hint') : undefined}/></label>{(inline && draft) ? <button type="button" className="explorer-search-icon" aria-label={ui.t("textsearch.clear_speech_search")} onClick={close}><CloseIcon/></button> : <button type="submit" className="explorer-search-icon" aria-label={ui.t("textsearch.run_text_search")} title={ui.t("textsearch.search")} disabled={Boolean(disabledReason)||loading}><Magnifier/></button>}</div>{inline&&summary&&<span className="explorer-search-summary">{summary}</span>}</div>
      {!inline&&<p id={panel+'-hint'} className="explorer-search-hint"><UiMessage id="textsearch.all_words_use_quotes_for_a_phrase"/></p>}
      {(!inline||active)&&<div className="explorer-search-facets">
      {global&&<label><UiMessage id="textsearch.result_type"/><select value={['mep','topic','question','speech','answer'].includes(field) ? field : ''} onChange={e=>{setField(e.target.value);reset();}}><option value=""><UiMessage id="textsearch.all_results"/></option><option value="mep"><UiMessage id="textsearch.meps"/></option><option value="topic"><UiMessage id="textsearch.plenary_topics"/></option><option value="question"><UiMessage id="textsearch.questions"/></option><option value="speech"><UiMessage id="dossieractivity.speeches"/></option><option value="answer"><UiMessage id="textsearch.institutional_answers"/></option></select></label>}
      {showText&&<label><UiMessage id="textsearch.text_language"/><select value={searchedLanguage} onChange={e=>{setTextLanguage(e.target.value);reset();}}>{languages.map(code=><option value={code} key={code} lang={language}>{languageName(code,language)}</option>)}<option value="all"><UiMessage id="textsearch.all_available_languages"/></option></select></label>}
      {!global&&allowedKinds.length>1&&<label><UiMessage id="textsearch.search_in"/><select value={(actualKinds.length===1) ? actualKinds[0] : ''} onChange={e=>{setField(e.target.value);reset();}}><option value="">{(group==='question') ? <UiMessage id="textsearch.questions_answers"/> : <UiMessage id="textsearch.all_text_types"/>}</option>{allowedKinds.map(kind=><option key={kind} value={kind}>{(kind==='answer') ? ui.t("textsearch.answer_text") : ((kind==='question') ? ui.t("textsearch.question_text") : ui.t("textsearch.speech_text"))}</option>)}</select></label>}
      {showText&&<label>{global ? ui.t("textsearch.text_order") : ui.t("textsearch.order")}<select value={sort} onChange={e=>{setSort(e.target.value);reset();}}><option value="relevance"><UiMessage id="textsearch.best_match"/></option><option value="newest"><UiMessage id="textsearch.newest_first"/></option></select></label>}
      {global&&field!=='mep'&&<><label><UiMessage id="textsearch.from"/><input type="date" value={searchFrom} max={searchTo||undefined} onChange={e=>{setSearchFrom(e.target.value);reset();}}/></label><label><UiMessage id="textsearch.to"/><input type="date" value={searchTo} min={searchFrom||undefined} onChange={e=>{setSearchTo(e.target.value);reset();}}/></label></>}
      </div>}</form>
      {showCatalog&&query&&<ParliamentSearchResults key={JSON.stringify([query,catalogType,language,dateFrom,dateTo,attempt])} query={query} type={catalogType} language={language} from={dateFrom} to={dateTo}/>}
      {global&&showText&&query&&<h4 className="explorer-search-text-heading"><UiMessage id="textsearch.matching_text"/></h4>}
      {scopeNote&&<p className="explorer-search-scope">{scopeNote}</p>}
      {!inline&&(from||to)&&<p className="explorer-search-hint">{(dateBasis==='question') ? <UiMessage id="textsearch.question_date_from_to" values={{from: <span lang={from ? language : ui.language}>{dateLabel(from,language)||ui.t('textsearch.start')}</span>, to: <span lang={to ? language : ui.language}>{dateLabel(to,language)||ui.t('textsearch.present')}</span>}}/> : <UiMessage id="textsearch.publication_date_from_to" values={{from: <span lang={from ? language : ui.language}>{dateLabel(from,language)||ui.t('textsearch.start')}</span>, to: <span lang={to ? language : ui.language}>{dateLabel(to,language)||ui.t('textsearch.present')}</span>}}/>}</p>}
      {disabledReason&&<p role="status" className="explorer-search-status">{disabledReason}</p>}
      {loading&&<p role="status" className="explorer-search-status"><UiMessage id="textsearch.searching"/></p>}
      {error&&<p role="alert" className="explorer-search-status">{error} <button className="explorer-search-link" type="button" onClick={()=>setAttempt(v=>v+1)}><UiMessage id="textsearch.retry.9f5cd8"/></button></p>}
      {data&&<div className="explorer-search-results" aria-busy={loading}>
        <p role="status" className="explorer-search-count"><UiMessage id={group==='question'?'coverage.matchingQuestions':'coverage.matchingDocuments'} values={{count:<span lang={language}>{data.total.toLocaleString(language)}</span>}} counts={{count:data.total}}/></p>
        {!data.total&&<p><UiMessage id="textsearch.no_matches_in_available_text_try_another_phrase_language_or_"/></p>}
        {data.results.map(result=>{
          const sources=[...new Set(result.hits.map(hit=>hit.sourceId))];
          return <article className="explorer-search-result" key={result.sourceId}><div className="explorer-search-meta"><span>{(group==='question') ? ui.t("textsearch.question") : kindLabel(result.kind, ui)}{result.reference ? (' · '+result.reference) : ''}</span><span lang={language}>{dateLabel((group==='question') ? (result.questionDate||result.date) : result.date,language)}</span></div><h4 lang="">{result.kind==='speech'?agendaTitle(result.title||result.sourceId):result.title||result.sourceId}</h4>
          {sources.map(id=>{const versions=result.hits.filter(hit=>hit.sourceId===id),hit=versions.find(h=>textReadKey(h)===read)||versions.find(h=>h.sourceKey===variants[id])||versions.find(h=>h.language===searchedLanguage)||versions.find(h=>h.language===language)||versions[0];if(!hit)return null;const key=textReadKey(hit);return <div className="explorer-search-match" key={id}>
            <div className="explorer-search-meta"><span>{(hit.kind==='answer') ? ui.t("textsearch.match_in_institutional_answer") : ((hit.kind==='question') ? ui.t("textsearch.match_in_question_text") : ui.t("textsearch.match_in_speech"))}{((hit.kind==='answer') && hit.date) ? <> · <span lang={language}>{dateLabel(hit.date,language)}</span></> : ''}</span><span>{hit.translationType==='machine' ? <UiMessage id="textsearch.language_machine_translation" values={{language:<span lang={language}>{languageName(hit.language,language)}</span>}}/> : <span lang={language}>{languageName(hit.language,language)}</span>}</span></div>
            <div className="explorer-search-attribution"><Attribution hit={hit}/></div><p className="explorer-search-excerpt" lang={hit.language||''}><Excerpt text={hit.snippet}/></p>
            <div className="explorer-search-actions"><button type="button" className="explorer-search-link" aria-expanded={read===key} onClick={()=>setRead((read===key) ? '' : key)}>{(read===key) ? ui.t("textsearch.close_text") : ((hit.kind==='speech') ? ui.t("dossieractivity.read_speech") : ((hit.kind==='answer') ? ui.t("textsearch.read_answer") : ui.t("textsearch.read_question")))}</button>
            {versions.length>1&&<label className="explorer-search-versions"><span><UiMessage id="textsearch.matching_versions"/></span><select value={hit.sourceKey} onChange={event=>{setVariants(previous=>({...previous,[id]:event.target.value}));if(read)setRead('');}}>{versions.map(version=><option value={version.sourceKey} key={version.sourceKey} lang={language}>{languageName(version.language,language)}{versions.some(v=>v.language===version.language&&v.sourceKey!==version.sourceKey) ? (' · '+version.sourceKey) : ''}</option>)}</select></label>}</div>
            {selected&&read===key&&<StoredReader identity={selected} query={query} expectedHash={hit.sha256} sourceUrl={hit.sourceUrl} language={language}/>}</div>;})}</article>;
        })}
        {(offset>0||data.nextOffset!==null)&&<nav className="explorer-search-pages" aria-label={ui.t("textsearch.search_result_pages")}><button type="button" className="explorer-search-link" disabled={!offset||loading} onClick={()=>moveTo(previousOffset)}>{previousLabel}</button><span><UiMessage id="textsearch.range_of_total" values={{range: (data.results.length ? (`${data.offset+1}–${data.offset+data.results.length}`) : '0'), total: data.total}}/></span><button type="button" className="explorer-search-link" disabled={data.nextOffset===null||loading} onClick={()=>{if(data.nextOffset!==null){predecessors.current.offsets.set(data.nextOffset,offset);moveTo(data.nextOffset);}}}><UiMessage id="textsearch.next"/></button></nav>}
        
        {data.truncated&&<p className="explorer-search-status"><UiMessage id="textsearch.more_matches_are_available_narrow_the_period_language_or_doc"/></p>}
      </div>}
      {selected&&!selectedHit&&!loading&&<><StoredReader identity={selected} query={query} language={language}/></>}
    </section>}
  </div>;
}

// CSS Custom Highlights leave React-managed text, links and footnotes intact.
// Where unsupported, select only the active match using the native Selection.
const findExcluded='button:not(.legal-ref),script,style,[hidden]';
function matchDetails(range:Range,target:HTMLElement) {
  const details=new Set<HTMLDetailsElement>();
  if(!target.contains(range.commonAncestorContainer))return details;
  const collect=(node:Node)=>{
    if(!node.textContent||!range.intersectsNode(node)||node===range.startContainer&&range.startOffset===node.textContent.length||node===range.endContainer&&range.endOffset===0)return;
    const parent=node.parentElement;if(!parent||parent.closest(findExcluded))return;
    for(let ancestor:HTMLElement|null=parent;ancestor&&target.contains(ancestor);ancestor=ancestor.parentElement){
      if(ancestor.tagName!=='DETAILS')continue;
      const summary=[...ancestor.children].find(child=>child.tagName==='SUMMARY');
      if(!summary?.contains(node))details.add(ancestor as HTMLDetailsElement);
    }
  };
  const common=range.commonAncestorContainer;
  if(common.nodeType===window.Node.TEXT_NODE)collect(common);
  else {const walker=document.createTreeWalker(common,window.NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))collect(node);}
  return details;
}
export function FindInText({target,label: labelProp,onOpen}:{target:RefObject<HTMLElement|null>;label?:string;onOpen?:()=>void}) {
  const ui = useUiI18n();
const label = labelProp ?? ui.t("textsearch.find_in_this_text");

  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[index,setIndex]=useState(0),[ranges,setRanges]=useState<Range[]>([]),[revealRequest,setRevealRequest]=useState(0);
  const input=useRef<HTMLInputElement>(null),toggle=useRef<HTMLButtonElement>(null),id=useId(),highlightId='find'+id.replace(/\W/g,''),lastSelection=useRef<Range|null>(null);
  const active=ranges[index%Math.max(1,ranges.length)];
  const highlightApi=()=>({registry:(globalThis.CSS as unknown as {highlights?:Map<string,unknown>})?.highlights,Highlight:(globalThis as unknown as {Highlight?:new(...ranges:Range[])=>unknown}).Highlight});
  useEffect(()=>{
    if(!open||!query.trim()||!target.current){setRanges([]);return;}
    let frame=0;const update=()=>{window.cancelAnimationFrame(frame);frame=window.requestAnimationFrame(()=>{const element=target.current;if(!element)return;const walker=document.createTreeWalker(element,window.NodeFilter.SHOW_TEXT|window.NodeFilter.SHOW_ELEMENT),nodes:{node:Text;start:number;end:number}[]=[];let node,text='',lastBlock:Element|null=null;
      while((node=walker.nextNode())){
        if(node.nodeType===window.Node.ELEMENT_NODE){if((node as Element).tagName==='BR'&&!(node as Element).closest('[hidden]'))text+=' ';continue;}
        // Inline reference buttons contain searchable source text.
        const parent=node.parentElement;if(!parent||parent.closest(findExcluded))continue;
        const block=parent.closest('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,section,article,td,th,pre,dt,dd,figcaption');
        if(lastBlock&&block!==lastBlock&&text&&!/\s$/.test(text))text+=' ';
        lastBlock=block;const value=node.textContent||'';nodes.push({node:node as Text,start:text.length,end:text.length+value.length});text+=value;
      }
      const found=findTextOffsets(text,query).flatMap(hit=>{const start=nodes.find(n=>n.end>hit.start),end=nodes.find(n=>n.end>=hit.end);if(!start||!end)return [];const range=document.createRange();range.setStart(start.node,hit.start-start.start);range.setEnd(end.node,hit.end-end.start);return [range];});setRanges(found);setIndex(0);
    });};update();const observer=new window.MutationObserver(update);observer.observe(target.current,{childList:true,characterData:true,subtree:true});return()=>{window.cancelAnimationFrame(frame);observer.disconnect();};
  },[open,query,target]);
  useEffect(()=>{if(open){const frame=window.requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));return()=>window.cancelAnimationFrame(frame);}},[open]);
  useEffect(()=>{const {registry,Highlight}=highlightApi();if(registry&&Highlight&&open){registry.set(highlightId,new Highlight(...ranges));if(active)registry.set(highlightId+'active',new Highlight(active));}
    let observer:MutationObserver|undefined;
    const element=target.current,contained=()=>Boolean(element&&active&&target.current===element&&element.isConnected&&element.contains(active.startContainer)&&element.contains(active.endContainer));
    if(active&&open&&element&&contained()){
      const details=matchDetails(active,element),reveal=()=>{if(!contained())return false;let changed=false;for(const detail of details)if(!detail.open){detail.open=true;changed=true;}return changed;};
      reveal();
      if(!registry||!Highlight){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(active);lastSelection.current=active;}
      const scroll=()=>{if(contained())active.startContainer.parentElement?.scrollIntoView({block:'nearest'});};scroll();
      // Only active-match ancestors need open-attribute observation. Revealing or
      // manually toggling Notes must not rebuild ranges and reset the match index.
      observer=new window.MutationObserver(()=>{if(reveal())scroll();});
      for(const detail of details)observer.observe(detail,{attributes:true,attributeFilter:['open']});
    }
    return()=>{observer?.disconnect();registry?.delete(highlightId);registry?.delete(highlightId+'active');const selection=window.getSelection();if(lastSelection.current&&selection?.rangeCount&&selection.getRangeAt(0).compareBoundaryPoints(window.Range.START_TO_START,lastSelection.current)===0)selection.removeAllRanges();lastSelection.current=null;};
  },[ranges,active,open,highlightId,target,revealRequest]);
  function navigate(direction:number){
    if(!ranges.length)return;
    setIndex(value=>(value+direction+ranges.length)%ranges.length);
    // Wrapping to the same match still needs to reveal it after scrolling away.
    setRevealRequest(value=>value+1);
  }
  function close(){setOpen(false);setQuery('');setRanges([]);window.requestAnimationFrame(()=>toggle.current?.focus({preventScroll:true}));}
  return <div className="explorer-find-text" lang={ui.language} onKeyDown={event=>{if(event.key==='Escape'&&open){event.stopPropagation();close();}}}>
    <button ref={toggle} type="button" className="explorer-search-icon" aria-label={label} title={label} aria-expanded={open} aria-controls={id} onClick={()=>{if(open)close();else{onOpen?.();setOpen(true);}}}><Magnifier/></button>
    {open&&<><style>{'::highlight('+highlightId+'){background:var(--mark);color:var(--mark-ink)}::highlight('+highlightId+'active){background:var(--mark-active);color:var(--mark-ink)}'}</style><div className="explorer-find-controls" id={id}>
      <label><span className="explorer-search-sr">{label}</span><input ref={input} type="search" aria-label={label} value={query} maxLength={200} placeholder={label} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();navigate(event.shiftKey ? (-1) : 1);}}}/></label>
      <span role="status">{query ? (ranges.length ? ui.t("textsearch.index_count_more", {index: String((index%ranges.length+1)), count: String(ranges.length), more: String(((ranges.length===1000) ? '+' : ''))}) : ui.t("textsearch.no_matches")) : ''}</span>
      <button className="explorer-search-icon" type="button" aria-label={ui.t("textsearch.previous_match")} title={ui.t("textsearch.previous_match")} disabled={!ranges.length} onClick={()=>navigate(-1)}>↑</button><button className="explorer-search-icon" type="button" aria-label={ui.t("textsearch.next_match")} title={ui.t("textsearch.next_match")} disabled={!ranges.length} onClick={()=>navigate(1)}>↓</button><button className="explorer-search-icon" type="button" aria-label={ui.t("textsearch.close_find")} title={ui.t("textsearch.close_find")} onClick={close}><CloseIcon/></button>
    </div></>}
  </div>;
}
