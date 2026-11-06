import {agendaTitle} from './topicPresentation.mjs';
import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {Suspense,useState} from 'react';
import {useData} from './data';
import {useTextSearchParam} from './globalSearchState';
import {publicUrl} from './publicUrl';
import {lazyView} from './lazyView';
import {AvailabilityNote} from './AvailabilityNote';
import {searchReference} from '../server/search-reference.mjs';
import {dossierHref} from './followDossiers.mjs';
import {fullDossierReference} from './dossierActivityModel.mjs';
import type {SourceAvailability} from '../server/source-availability.mjs';
const InsightQuestionReader=lazyView(()=>import('./InsightReaders').then(module=>({default:module.InsightQuestionReader})));

type Result={id:string;type:string;title:string|null;titleLanguage:string|null;date:string|null;sittingId?:string;sourceUrl?:string;kind?:string;reference?:string;dossier?:string|null;member?:string};
type Section={type:string;held?:boolean|null;lookup?:{key:string;reference:string};total:number;results:Result[];nextOffset:number|null;truncated:boolean;coverage:{complete:boolean;available:boolean;limited:boolean;missingAgendas?:number;missingAgendaPages?:{sittingId:string;offset:number}[];pageLimitedAgendas?:number;incompleteCalendarYears?:number[];conflicts?:{id:string}[];error?:boolean;availability?:SourceAvailability}};
type Response={offset:number;sections:Section[]};
const labels:Record<string,string>={mep:'MEPs',topic:'Plenary topics',question:'Questions'};
type CommissionReference={references:{status:string;procedure?:string|null;title?:string|null;titleLanguage?:string|null;date?:string|null}[]};
const referenceKinds:Record<string,string>={dossier:'searchreference.dossier',report:'searchreference.report',document:'searchreference.document',member:'insightshared.mep'};
const dayText=(day:string,language:string)=>new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(day+'T12:00:00Z'));
export const labelsUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof labels => ({mep:ui.t("textsearch.meps"),topic:ui.t("textsearch.plenary_topics"),question:ui.t("textsearch.questions")});

function resultUrl(result:Result,language:string) {
  const params=new URLSearchParams({lang:language});
  if(result.type==='mep')params.set('member',result.id);
  if(result.type==='topic'){params.set('view','legislation');params.set('pl-mode','agenda');params.set('pl-sitting',result.sittingId!);params.set('agenda-period','sitting:'+result.sittingId);params.set('agenda-topic',result.id);}
  return publicUrl('?'+params);
}
function referenceUrl(result:Result,language:string) {
  if(result.kind==='member')return resultUrl({...result,type:'mep'},language);
  return result.dossier?publicUrl(dossierHref(result.dossier,language)):null;
}
export function ParliamentSearchResults({query,type,language,from,to}:{query:string;type:string;language:string;from?:string;to?:string}) {
  const ui = useUiI18n();
  const [offset,setOffset]=useTextSearchParam<number>('global-fts-catalog-offset',0);
  const [reading,setReading]=useState<string|null>(null);
  const params=new URLSearchParams({q:query,type,lang:language,offset:String(offset)});if(from)params.set('from',from);if(to)params.set('to',to);
  const route=(kind:string)=>{const selected=new URLSearchParams(params);selected.set('type',kind);return 'insights/search?'+selected;};
  const meps=useData<Response>(type==='all'||type==='mep'?route('mep'):null);
  const topics=useData<Response>(type==='all'||type==='topic'?route('topic'):null);
  const questions=useData<Response>(type==='all'||type==='question'?route('question'):null);
  const reference=useData<Response>(type==='all'&&searchReference(query)?route('reference'):null);
  const lookup=reference.data?.sections.find(section=>section.type==='reference')?.lookup;
  const commission=useData<CommissionReference>(lookup?'references?'+new URLSearchParams({keys:lookup.key,lang:language}):null);
  const requests=[{type:'mep',state:meps},{type:'topic',state:topics},{type:'question',state:questions}].filter(request=>type==='all'||type===request.type);
  const loading=requests.some(request=>request.state.loading);
  const sections=requests.flatMap(request=>request.state.data?.sections.filter(section=>section.type===request.type)||[]);
  const data=requests.some(request=>request.state.data)?{sections,offset}:null;
  const referenceSection=reference.data?.sections.find(section=>section.type==='reference');
  const found=commission.data?.references[0];
  // A failed or ambiguous lookup says nothing about the reference, so the sections below stand as they are.
  const block:{results:Result[];missing:boolean}|null=!referenceSection?null
    :referenceSection.lookup?(!found||!['found','not-found'].includes(found.status)?null
      :found.status==='found'&&found.procedure&&fullDossierReference(found.procedure)?{missing:false,results:[{id:found.procedure,type:'reference',kind:'dossier',reference:found.procedure,title:found.title||null,titleLanguage:found.titleLanguage||null,date:found.date||null,dossier:found.procedure}]}:{missing:true,results:[]})
    :{missing:referenceSection.held===false,results:referenceSection.results};
  // The other sections were never going to match a pasted reference, so their empty states stay out of the way.
  const hideEmpty=Boolean(block&&(block.missing||block.results.length));
  return <div className="explorer-catalog-results">
    {block&&(block.results.length>0||block.missing)&&<div className="explorer-search-reference">
      {block.results.map(result=>{const href=referenceUrl(result,language),text=result.title||result.reference;return <article className="explorer-search-result" key={result.id}>
        <div className="explorer-search-meta"><span><UiMessage id={referenceKinds[result.kind!]}/> · <span lang="">{result.reference}</span></span>{result.date&&<time dateTime={result.date} lang={language}>{dayText(result.date,language)}</time>}</div>
        <h4 lang={result.titleLanguage||''}>{href?<a href={href}>{text}</a>:text}</h4>
      </article>;})}
      {block.missing&&<p><UiMessage id="searchreference.no_document"/></p>}
    </div>}
    {requests.filter(request=>request.state.loading&&!request.state.data).map(request=><p key={request.type} role="status">{ui.t(({mep:'coverage.searchingMeps',topic:'coverage.searchingTopics',question:'coverage.searchingQuestions'} as Record<string,string>)[request.type])}</p>)}
    {requests.filter(request=>request.state.error).map(request=><p key={request.type} role="alert">{ui.t(({mep:'coverage.searchMepsUnavailable',topic:'coverage.searchTopicsUnavailable',question:'coverage.searchQuestionsUnavailable'} as Record<string,string>)[request.type])} </p>)}
    {data?.sections.filter(section=>!hideEmpty||section.results.length).map(section=><section key={section.type} aria-label={labelsUi(ui)[section.type]}>
      <h4>{labelsUi(ui)[section.type]} {section.coverage.available&&<span lang={language}>({section.total.toLocaleString(language)})</span>}</h4>
      {!section.coverage.available&&<p className="explorer-search-hint"><UiMessage id="grouplabels.ts.unavailable"/></p>}
      {!!section.coverage.incompleteCalendarYears?.length&&<p className="explorer-search-hint"><UiMessage id="coverage.calendarYears" values={{years:section.coverage.incompleteCalendarYears.map(year=>year.toLocaleString(ui.locale,{useGrouping:false})).join(', ')}}/></p>}
      {section.coverage.missingAgendaPages?.map(page=><p key={page.sittingId+':'+page.offset} className="explorer-search-hint"><UiMessage id="coverage.agendaIncomplete" values={{date:<time lang={language} dateTime={page.sittingId.slice(7)}>{new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(page.sittingId.slice(7)+'T12:00Z'))}</time>}}/></p>)}
      {!!section.coverage.conflicts?.length&&<p className="explorer-search-hint"><UiMessage id="coverage.agendaConflicts" values={{count:new Set(section.coverage.conflicts.map(row=>row.id)).size}}/></p>}
      {section.coverage.limited&&<p className="explorer-search-hint">{section.type==='question'?ui.t('coverage.questionSearchLimit'):section.coverage.pageLimitedAgendas?ui.t('coverage.agendaSearchLimit',{count:section.coverage.pageLimitedAgendas}):ui.t('coverage.sittingSearchLimit')}</p>}
      {section.coverage.error&&<p className="explorer-search-hint"><UiMessage id="coverage.agendaUnreadable"/></p>}
      <AvailabilityNote sources={section.coverage.availability} kind="question" language={language} showLatest={false}/>
      {!section.results.length&&section.coverage.available&&<p>{ui.t('batch5.parliamentsearchresults.tsx.29.62')}</p>}
      {section.results.map(result=><article className="explorer-search-result" key={result.id}>
        <div className="explorer-search-meta"><span>{(section.type==='mep') ? ui.t("insightshared.mep") : ((section.type==='topic') ? ui.t("parliamentsearchresults.plenary_topic.6e8e8f") : result.id)}</span>{result.date&&<time dateTime={result.date} lang={language}>{new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'}).format(new Date(result.date+'T12:00:00Z'))}</time>}</div>
        <h4 lang={result.titleLanguage||''}>{(result.type==='question') ? <a href={result.sourceUrl} target="_blank" rel="noreferrer">{result.title} ↗</a> : <a href={resultUrl(result,language)}>{result.type==='topic'?agendaTitle(result.title||''):result.title}</a>}</h4>
        {result.type==='question'&&<><button type="button" className="explorer-search-link" aria-expanded={reading===result.id} onClick={()=>setReading((reading===result.id) ? null : result.id)}>{(reading===result.id) ? <UiMessage id="batch4.questiontopics.tsx.close.question"/> : <UiMessage id="parliamentsearchresults.read_question_and_answers.d9f136"/>}</button>{reading===result.id&&<Suspense fallback={<p role="status"><UiMessage id="batch5.parliamentsearchresults.tsx.33.63"/></p>}><InsightQuestionReader id={result.id} language={language} includeAnswers/></Suspense>}</>}
      </article>)}
      {section.truncated&&<p className="explorer-search-hint"><UiMessage id="batch5.parliamentsearchresults.tsx.35.64"/></p>}
      {!!section.coverage.missingAgendas&&<p className="explorer-search-hint"><UiMessage id="searchreference.agendas_not_searched" values={{count:section.coverage.missingAgendas}}/></p>}
    </section>)}
    {data&&(offset>0||data.sections.some(section=>section.nextOffset!==null))&&<nav className="explorer-search-pages" aria-label={ui.t("batch5.parliamentsearchresults.tsx.37.67")}><button type="button" className="explorer-search-link" disabled={!offset||loading} onClick={()=>setOffset(Math.max(0,offset-10))}><UiMessage id="batch5.parliamentsearchresults.tsx.37.66"/></button><span><>{(offset+1)}–{(offset+Math.max(0,...data.sections.map(section=>section.results.length)))}</></span><button type="button" className="explorer-search-link" disabled={loading||!data.sections.some(section=>section.nextOffset!==null)} onClick={()=>setOffset(offset+10)}><UiMessage id="batch5.parliamentsearchresults.tsx.37.65"/></button></nav>}
  </div>;
}
