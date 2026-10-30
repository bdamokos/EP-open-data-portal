import {Suspense,useState} from 'react';
import {useData} from './data';
import {useTextSearchParam} from './globalSearchState';
import {publicUrl} from './publicUrl';
import {lazyView} from './lazyView';
import {AvailabilityNote} from './AvailabilityNote';
import type {SourceAvailability} from '../server/source-availability.mjs';
const InsightQuestionReader=lazyView(()=>import('./InsightReaders').then(module=>({default:module.InsightQuestionReader})));

type Result={id:string;type:string;title:string;titleLanguage:string|null;date:string|null;sittingId?:string;sourceUrl?:string};
type Section={type:string;total:number;results:Result[];nextOffset:number|null;truncated:boolean;coverage:{complete:boolean;available:boolean;limited:boolean;missingAgendas?:number;pageLimitedAgendas?:number;incompleteCalendarYears?:number[];conflicts?:{id:string}[];error?:boolean;availability?:SourceAvailability}};
type Response={offset:number;sections:Section[]};
const labels:Record<string,string>={mep:'MEPs',topic:'Plenary topics',question:'Questions'};
function resultUrl(result:Result,language:string) {
  const params=new URLSearchParams({lang:language});
  if(result.type==='mep')params.set('member',result.id);
  if(result.type==='topic'){params.set('view','legislation');params.set('pl-mode','agenda');params.set('pl-sitting',result.sittingId!);params.set('agenda-period','sitting:'+result.sittingId);params.set('agenda-topic',result.id);}
  return publicUrl('?'+params);
}
export function ParliamentSearchResults({query,type,language,from,to}:{query:string;type:string;language:string;from?:string;to?:string}) {
  const [offset,setOffset]=useTextSearchParam<number>('global-fts-catalog-offset',0);
  const [reading,setReading]=useState<string|null>(null);
  const params=new URLSearchParams({q:query,type,lang:language,offset:String(offset)});if(from)params.set('from',from);if(to)params.set('to',to);
  const route=(kind:string)=>{const selected=new URLSearchParams(params);selected.set('type',kind);return 'insights/search?'+selected;};
  const meps=useData<Response>(type==='all'||type==='mep'?route('mep'):null);
  const topics=useData<Response>(type==='all'||type==='topic'?route('topic'):null);
  const questions=useData<Response>(type==='all'||type==='question'?route('question'):null);
  const requests=[{type:'mep',state:meps},{type:'topic',state:topics},{type:'question',state:questions}].filter(request=>type==='all'||type===request.type);
  const loading=requests.some(request=>request.state.loading);
  const sections=requests.flatMap(request=>request.state.data?.sections.filter(section=>section.type===request.type)||[]);
  const data=requests.some(request=>request.state.data)?{sections,offset}:null;
  return <div className="explorer-catalog-results">
    {requests.filter(request=>request.state.loading&&!request.state.data).map(request=><p key={request.type} role="status">Searching {labels[request.type].toLowerCase()}…</p>)}
    {requests.filter(request=>request.state.error).map(request=><p key={request.type} role="alert">{labels[request.type]} search unavailable. <button type="button" className="explorer-search-link" onClick={request.state.retry}>Retry</button></p>)}
    {data?.sections.map(section=><section key={section.type} aria-label={labels[section.type]}>
      <h4>{labels[section.type]} {section.coverage.available&&<span lang={language}>({section.total.toLocaleString(language)})</span>}</h4>
      {!section.coverage.available&&<p className="explorer-search-hint">Unavailable</p>}
      {section.coverage.incompleteCalendarYears?.length? <p className="explorer-search-hint">Sitting calendar not fully loaded for {section.coverage.incompleteCalendarYears.join(', ')}.</p>:null}
      {section.coverage.missingAgendas? <p className="explorer-search-hint">{section.coverage.missingAgendas} sitting {section.coverage.missingAgendas===1?'agenda':'agendas'} not loaded.</p>:null}
      {section.coverage.conflicts?.length? <p className="explorer-search-hint">{new Set(section.coverage.conflicts.map(row=>row.id)).size} agenda records have conflicting details.</p>:null}
      {section.coverage.limited&&<p className="explorer-search-hint">{section.type==='question'?'Search limited to 50,000 question records.':section.coverage.pageLimitedAgendas?`Search reached 100 agenda records in ${section.coverage.pageLimitedAgendas} sittings.`:'Search reached its sitting limit.'}</p>}
      {section.coverage.error&&<p className="explorer-search-hint">Some agenda records could not be read.</p>}
      <AvailabilityNote sources={section.coverage.availability} label="question" language={language}/>
      {!section.results.length&&section.coverage.available&&<p>No matches.</p>}
      {section.results.map(result=><article className="explorer-search-result" key={result.id}>
        <div className="explorer-search-meta"><span>{section.type==='mep'?'MEP':section.type==='topic'?'Plenary topic':result.id}</span>{result.date&&<time dateTime={result.date} lang={language}>{new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(result.date+'T12:00:00Z'))}</time>}</div>
        <h4 lang={result.titleLanguage||''}>{result.type==='question'?<a href={result.sourceUrl} target="_blank" rel="noreferrer">{result.title} ↗</a>:<a href={resultUrl(result,language)}>{result.title}</a>}</h4>
        {result.type==='question'&&<><button type="button" className="explorer-search-link" aria-expanded={reading===result.id} onClick={()=>setReading(reading===result.id?null:result.id)}>{reading===result.id?'Close question':'Read question and answers'}</button>{reading===result.id&&<Suspense fallback={<p role="status">Opening question…</p>}><InsightQuestionReader id={result.id} language={language} includeAnswers/></Suspense>}</>}
      </article>)}
      {section.truncated&&<p className="explorer-search-hint">More matches. Narrow your search.</p>}
    </section>)}
    {data&&(offset>0||data.sections.some(section=>section.nextOffset!==null))&&<nav className="explorer-search-pages" aria-label="Name and title result pages"><button type="button" className="explorer-search-link" disabled={!offset||loading} onClick={()=>setOffset(Math.max(0,offset-10))}>Previous titles</button><span>{offset+1}–{offset+Math.max(0,...data.sections.map(section=>section.results.length))}</span><button type="button" className="explorer-search-link" disabled={loading||!data.sections.some(section=>section.nextOffset!==null)} onClick={()=>setOffset(offset+10)}>Next titles</button></nav>}
  </div>;
}
