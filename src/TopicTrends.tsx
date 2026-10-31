import {defaultUi} from './uiDefault.mjs';
import {UiMessage, useUiI18n} from './UiI18nReact';
import {AvailabilityNote,PartialValue} from './AvailabilityNote';
import {availabilityValue,periodAvailability,type SourceAvailability,type AvailabilityState} from '../server/source-availability.mjs';
import {AnalysisPeriodControl} from './AnalysisPeriod';
import {brusselsDay,periodEndMinimum,type AnalysisPeriod} from '../server/analysis-period.mjs';
import {useEffect,useRef,useState} from 'react';
import {useExplorerParam} from './explorerUrl';
import {createDataClient} from './client.mjs';
import {api} from './data';
import {humanDate} from './InsightCharts';
import {ProcedureContext,type OfficialTopic} from './ProcedureContext';
import './TopicContext.css';
import {SourceLink} from './SourceLink';
import {Status} from './Status';

type Metric='debates'|'votes'|'committee';
type Event={id:string;date:string;kind:Metric;procedures:{id:string;reference:string}[]};
type Trend=OfficialTopic&{dossiers:number;eventsTruncated?:boolean;series:{week:string;debates:number|null;votes:number|null;committee:number|null;availability?:Record<Metric,AvailabilityState>}[];events:Event[]};
type Dossier={reference:string;title:string|null;titleLanguage:string|null;status:{state:'published'|'signed'|'parliament-position'|'none';date:string|null};fetchedAt:string|null};
type Trends={availability?:Record<Metric,SourceAvailability>;dossiers?:Record<string,Dossier>;window:{start:string;end:string};weeks:string[];topics:Trend[];nextPage:number|null;coverage:{procedures:number;mapped:number;unmapped:number;pending:number;sourceError:boolean;truncated:boolean;indexComplete:boolean};computedAt:string};
const client=createDataClient(api,{maxEntries:24,maxAge:30*60_000,timeoutFor:()=>35_000});
const metricName={debates:'Debates',votes:'Votes',committee:'Committee events'};
export const metricNameUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof metricName => ({debates:ui.t("outsidevoices.debates.5e82f8"),votes:ui.t("dossieractivity.votes"),committee:ui.t("topictrends.committee_events.5d2558")});

const statusName={published:'Published in Official Journal',signed:'Final act signed','parliament-position':'Parliament position adopted',none:'Adoption not recorded',unavailable:'Status unavailable'};
export const statusNameUi = (ui: import('./uiI18n.mjs').UiFormatter = defaultUi) : typeof statusName => ({published:ui.t("topictrends.published_in_official_journal.548f3e"),signed:ui.t("topictrends.final_act_signed.15beeb"),'parliament-position':ui.t("topictrends.parliament_position_adopted.28ef10"),none:ui.t("topictrends.adoption_not_recorded.0f1765"),unavailable:ui.t("topictrends.status_unavailable.f261ff")});

function DossierButton({id,reference,dossier,selected,language,onSelect}:{id:string;reference:string;dossier?:Dossier;selected:boolean;language:string;onSelect:()=>void}) {
  const ui = useUiI18n();
  const status=dossier?.status||{state:'unavailable' as const,date:null},source='https://data.europarl.europa.eu/api/v2/procedures/'+id;
  return <div className="insight-trend-dossier" lang={ui.language}><button onClick={onSelect} aria-expanded={selected} lang={dossier?.title ? (dossier.titleLanguage??'') : ''} title={dossier?.title||reference}><span className="insight-trend-dossier-title" lang={dossier?.title ? (dossier.titleLanguage??'') : ui.messageLocale("topictrends.title_unavailable.3b27bf")}>{dossier?.title||ui.t("topictrends.title_unavailable.3b27bf")}</span><span className="insight-trend-dossier-reference" lang="">{reference} <span aria-hidden="true">↗</span></span><span className="insight-trend-dossier-status" lang={ui.language} data-state={status.state}>{statusNameUi(ui)[status.state]}{status.date ? <> · <span lang={language}>{humanDate(status.date,language)}</span></> : ''}</span></button><div className="insight-trend-dossier-source"><SourceLink url={source} language={language} reference={reference}><UiMessage id="legislation.dossier.6a6fa3"/></SourceLink></div></div>;
}
const eventSummaryMessages={
  "debates": [
    [
      "topictrends.count_debate_dossiers_dossier.9ccb1d",
      "topictrends.count_debate_dossiers_dossiers.037108"
    ],
    [
      "topictrends.count_debates_dossiers_dossier.053b1e",
      "topictrends.count_debates_dossiers_dossiers.c28fd3"
    ]
  ],
  "votes": [
    [
      "topictrends.count_vote_dossiers_dossier.2e85eb",
      "topictrends.count_vote_dossiers_dossiers.9300ad"
    ],
    [
      "topictrends.count_votes_dossiers_dossier.e621bf",
      "topictrends.count_votes_dossiers_dossiers.9ec3e3"
    ]
  ],
  "committee": [
    [
      "topictrends.count_committee_event_dossiers_dossier.189461",
      "topictrends.count_committee_event_dossiers_dossiers.c003c0"
    ],
    [
      "topictrends.count_committee_events_dossiers_dossier.e7373b",
      "topictrends.count_committee_events_dossiers_dossiers.5b9fe4"
    ]
  ]
} as const;
export function TopicTrends({language='en',initialTopic}:{language?:string;initialTopic?:string|null}) {
  const ui = useUiI18n();
  const [days,setDays]=useExplorerParam<AnalysisPeriod>('trend-days',180,[90,180,365,'term']),[end,setEnd]=useExplorerParam<string>('trend-until',''),[metric,setMetric]=useExplorerParam<Metric>('trend-metric','debates',['debates','votes','committee']),[data,setData]=useState<Trends|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[attempt,setAttempt]=useState(0),[selection,setSelection]=useExplorerParam<string>('trend-topic',initialTopic||''),[search,setSearch]=useExplorerParam<string>('trend-search',''),[week,setWeek]=useExplorerParam<string>('trend-week',''),[reference,setReference]=useExplorerParam<string|null>('trend-dossier',null),[more,setMore]=useState(false);
  const [,setSource]=useExplorerParam<string|null>('trend-source',null);
  const heading=useRef<HTMLHeadingElement>(null),chart=useRef<SVGSVGElement>(null),[chartWidth,setChartWidth]=useState(960);
  useEffect(()=>{if(!chart.current)return;const observer=new ResizeObserver(entries=>setChartWidth(Math.max(260,Math.round(entries[0].contentRect.width))));observer.observe(chart.current);return()=>observer.disconnect();},[data,selection]);
  useEffect(()=>{
    let active=true;const controller=new AbortController();setLoading(true);setError(false);setData(null);
    void(async()=>{let page:number|null=0;try{while(active&&page!==null){const result:Trends=await client.get('insights/topic-trends?'+new URLSearchParams({lang:language,days:String(days),page:String(page),...(end ? ({end}) : ({})),...(initialTopic ? ({concept:initialTopic.split('/').at(-1)!}) : ({}))}),{force:attempt>0,signal:controller.signal});if(!active)return;setData(result);page=result.nextPage;}if(active)setLoading(false);}catch{if(active){setError(true);setLoading(false);}}})();
    return()=>{active=false;controller.abort();};
  },[language,days,end,attempt,initialTopic]);
  const total=(topic:Trend)=>topic.series.reduce((sum,row)=>sum+(row[metric]??0),0);
  const available=(data?.topics||[]).filter(topic=>total(topic)>0&&topic.label.toLocaleLowerCase(language).includes(search.toLocaleLowerCase(language))).sort((a,b)=>total(b)-total(a)||a.label.localeCompare(b.label,language));
  const selected=selection ? data?.topics.find(topic=>topic.id===selection) : available[0],series=selected?.series||[],maximum=Math.max(1,...series.map(row=>row[metric]??0)),x=(index:number)=>45+((series.length===1) ? 0 : (index/(series.length-1)))*(chartWidth-70),y=(count:number)=>190-count/maximum*155;
  const events=selected?.events.filter(event=>event.kind===metric&&(!week||event.date>=week&&event.date<new Date(Date.parse(week+'T12:00Z')+7*86400_000).toISOString().slice(0,10)))||[];
  const metricAvailability=data?.availability?.[metric];
  const selectionLimited=Boolean(data&&(data.coverage.truncated||data.coverage.unmapped>0||data.coverage.pending>0||metricAvailability&&periodAvailability(data.window,metricAvailability,0).observedCount===null));
  const resultStatus=((data && (!loading)) && (!error)) ? (data.coverage.sourceError ? ui.t("topictrends.topic_catalogue_temporarily_unavailable.c4a5c9") : [
    available.length ? (ui.t("topictrends.count_topics_with_metric_in_this_selection_showing_shown.c4ab5c", {count: available.length, metric: String(metricNameUi(ui)[metric].toLowerCase()), shown: String(Math.min(available.length,more ? 60 : 12).toLocaleString(ui.locale))})) : (selectionLimited ? ui.t("coverage.topicsUnloaded") : ui.t("topictrends.no_topics_with_metric_in_this_selection.2d74fb", {metric: String(metricNameUi(ui)[metric].toLowerCase())})),
    data.coverage.unmapped?ui.t('coverage.dossiersUnmapped',{count:data.coverage.unmapped}):'',
    data.coverage.pending?ui.t('coverage.dossiersUnloaded',{count:data.coverage.pending}):'',
    data.coverage.truncated ? ui.t("topictrends.showing_the_first_600_matching_dossiers.f8c31f") : '',
  ].filter(Boolean).join(' ')) : null;
  function choose(topic:Trend){setSelection(topic.id);setWeek('');setReference(null);requestAnimationFrame(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'nearest'});});}
  return <section className="insight-topic-trends" lang={ui.language}>
    <Status scope={JSON.stringify([language,days,end,initialTopic,metric,search,more,attempt])} message={resultStatus} pending={loading} oncePerScope/>
    <div className="insight-section-heading"><h2><UiMessage id="topictrends.topics_over_time.f2e876"/></h2>{initialTopic&&<button onClick={()=>{setSelection('');setSource(null);setSearch('');setWeek('');setReference(null);}}><UiMessage id="topictrends.all_topics.e0631c"/></button>}<AnalysisPeriodControl value={days} periods={[90,180,365]} onChange={period=>{setDays(period);if(end&&end<periodEndMinimum(period))setEnd('');setWeek('');setReference(null);}}/><label><UiMessage id="topictrends.until.96bdb6"/><input type="date" min={periodEndMinimum(days)} max={brusselsDay()} value={end||data?.window.end||''} onChange={event=>{setEnd(event.target.value);setWeek('');setReference(null);}}/></label></div>
    <div className="insight-chart-switch" role="group" aria-label={ui.t("topictrends.activity_measure.5043f4")}>{(['debates','votes','committee'] as const).map(value=><button key={value} aria-pressed={metric===value} onClick={()=>{setMetric(value);setWeek('');setReference(null);}}>{metricNameUi(ui)[value]}</button>)}</div>
    {data&&Number.isFinite(data.coverage.procedures)&&Number.isFinite(data.coverage.mapped)&&<p className="insight-secondary"><UiMessage id={loading?(data.coverage.truncated?'topictrends.eurovoc_topics_mapped_of_procedures_dossiers_loading_more_topics_first_600_matching_d.f8573d':'topictrends.eurovoc_topics_mapped_of_procedures_dossiers_loading_more_topics.95b98b'):(data.coverage.truncated?'topictrends.eurovoc_topics_mapped_of_procedures_dossiers_first_600_matching_dossiers.ccbb37':'topictrends.eurovoc_topics_mapped_of_procedures_dossiers.d20a0b')} values={{mapped:data.coverage.mapped,procedures:data.coverage.procedures}}/></p>}
    {loading&&!data&&<p role="status"><UiMessage id="topictrends.loading_topics.ff6c92"/></p>}
    {error&&<p role="alert"><UiMessage id="topictrends.more_topics_could_not_be_loaded.e67582"/> <button onClick={()=>setAttempt(value=>value+1)}><UiMessage id="commissionfollowups.try_again"/></button></p>}
    {data?.coverage.sourceError&&<p><UiMessage id="topictrends.topic_catalogue_temporarily_unavailable.c4a5c9"/> <button onClick={()=>setAttempt(value=>value+1)}><UiMessage id="commissionfollowups.try_again"/></button></p>}
    {data&&data.coverage.unmapped>0&&<p className="insight-secondary"><UiMessage id="coverage.dossiersUnmapped" values={{count:data.coverage.unmapped}}/></p>}
    {data&&data.coverage.pending>0&&<p className="insight-secondary"><UiMessage id="coverage.dossiersUnloaded" values={{count:data.coverage.pending}}/></p>}
    {data&&<AvailabilityNote showGaps={false} sources={data.availability?.[metric]} kind="event" language={language} end={data.window.end}/>}
    {data&&<div className="insight-trends-layout"><section className="insight-trend-picker"><label><UiMessage id="topictrends.find_a_topic.1d70a7"/><input type="search" value={search} placeholder={ui.t("topictrends.transport_migration_energy.420908")} onChange={event=>setSearch(event.target.value)}/></label><div className="insight-trend-list">{available.slice(0,more ? 60 : 12).map(topic=><button key={topic.id} aria-pressed={selected?.id===topic.id} onClick={()=>choose(topic)}><span lang={topic.language??''}>{topic.label}</span><svg viewBox="0 0 130 30" aria-hidden="true">{topic.series.map((row,index)=>(row[metric]===null) ? null : <rect key={row.week} x={index/topic.series.length*130} y={28-(row[metric]??0)/Math.max(1,...topic.series.map(s=>s[metric]??0))*26} width={Math.max(1,130/topic.series.length-1)} height={Math.max(1,(row[metric]??0)/Math.max(1,...topic.series.map(s=>s[metric]??0))*26)}/>)}</svg><strong>{total(topic)}</strong></button>)}</div>{available.length>12&&<button className="insight-text-button" onClick={()=>setMore(value=>!value)}>{more ? <UiMessage id="topictrends.fewer_topics.d9ddad"/> : <UiMessage id="topictrends.more_topics.2319b4"/>}</button>}{!available.length&&!loading&&!error&&!data.coverage.sourceError&&<p>{selectionLimited ? ui.t("coverage.topicsUnloaded") : ui.t("topictrends.no_metric_in_this_selection.06af5c", {metric: String(metricNameUi(ui)[metric].toLowerCase())})}</p>}</section>
    {selection&&!selected&&!loading&&!error&&!data.coverage.sourceError&&<p>{selectionLimited ? <UiMessage id="coverage.eventsUnloaded"/> : <UiMessage id="topictrends.no_events_for_this_topic_in_the_selected_period.faa533"/>}</p>}{selected&&<section className="insight-trend-detail"><h3 lang={selected.language??''} ref={heading} tabIndex={-1}>{selected.label}</h3><p><UiMessage id={eventSummaryMessages[metric][1][1]} values={{count:<strong>{total(selected)}<PartialValue partial={selected.series.some(row=>row.availability?.[metric]==='partial')}/></strong>,dossiers:selected.dossiers}}/></p><svg lang={(selected.language==='en') ? 'en' : ''} className="insight-trend-chart" ref={chart} viewBox={`0 0 ${chartWidth} 230`} role="img" aria-label={ui.t("topictrends.weekly_metric_about_label_weeklyvalues.6883c2", {metric: String(metricNameUi(ui)[metric].toLowerCase()), label: String(selected.label), weeklyValues: String(series.map(row=>row.week+' '+availabilityValue(row[metric],row.availability?.[metric]||'observed')).join(', '))})}>
      {[...new Set([0,Math.ceil(maximum/2),maximum])].map(tick=><g key={tick}><line x1="45" x2={chartWidth-25} y1={190-tick/maximum*155} y2={190-tick/maximum*155}/><text x="30" y={195-tick/maximum*155} textAnchor="end">{tick}</text></g>)}{series.map((row,index)=>(row[metric]===null) ? <g key={row.week}><rect className="availability-unknown" x={x(index)-5} y="35" width="10" height="155"/><title>{ui.t("topictrends.week_unavailable.3a01cc", {week: row.week})}</title></g> : <g key={row.week}>{index>0&&series[index-1][metric]!==null&&<path d={`M${x(index-1)},${y(series[index-1][metric]!)} L${x(index)},${y(row[metric]!)}`} fill="none" style={{stroke:'var(--accent)'}} strokeWidth="3" strokeDasharray={(row.availability?.[metric]==='partial'||series[index-1].availability?.[metric]==='partial') ? '6 4' : undefined}/>}<circle cx={x(index)} cy={y(row[metric]!)} r="4" style={{fill:(row.availability?.[metric]==='partial') ? 'var(--surface)' : 'var(--accent)',stroke:'var(--accent)'}} strokeWidth="2"><title>{row.week}: {availabilityValue(row[metric],row.availability?.[metric]||'observed')}</title></circle></g>)}<text lang={language} x="45" y="222">{humanDate(data.window.start,language)}</text><text lang={language} x={chartWidth-25} y="222" textAnchor="end">{humanDate(data.window.end,language)}</text>
    </svg><p className="insight-trend-chart-caption"><UiMessage id="topictrends.metric_per_week_in_mapped_dossiers.251171" values={{metric: metricNameUi(ui)[metric]}}/></p><label className="insight-trend-week"><UiMessage id="topictrends.week.f82be6"/><select value={week} onChange={event=>{setWeek(event.target.value);setReference(null);}}><option value=""><UiMessage id="topictrends.all_weeks.cf0e39"/></option>{series.filter(row=>(row[metric]??0)>0).map(row=><option lang={language} key={row.week} value={row.week}>{humanDate(row.week,language)} · {row[metric]}</option>)}</select></label><p className="insight-secondary"><UiMessage id="topictrends.latest_milestone.53dbca"/></p><ol className="insight-trend-events">{events.slice(0,30).map(event=><li key={event.id}><time lang={language}>{humanDate(event.date,language)}</time><div>{event.procedures.map(procedure=><DossierButton key={procedure.id} {...procedure} dossier={data.dossiers?.[procedure.id]} selected={reference===procedure.reference} language={language} onSelect={()=>setReference(previous=>(previous===procedure.reference) ? null : procedure.reference)}/>)}</div></li>)}</ol>{(events.length>30||selected.eventsTruncated)&&<p className="insight-secondary"><UiMessage id="topictrends.latest_events_shown_narrow_the_period_for_earlier_work.9ae26a"/></p>}{reference&&<ProcedureContext key={reference} reference={reference} language={language} showTitle/>}</section>}
    </div>}
  </section>;
}
