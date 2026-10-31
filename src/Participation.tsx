import {UiMessage, useUiI18n} from './UiI18nReact';
import {AvailabilityNote,PartialValue} from './AvailabilityNote';
import {availabilityValue,type SourceAvailability,type AvailabilityState} from '../server/source-availability.mjs';
import {PlenaryPeriodSelect,latestHeldSitting,weekPeriod,SittingCalendarNotice,type Sitting} from './PlenaryPeriodNavigation';
import {useExplorerParam} from './explorerUrl';
import {useInsightData} from './InsightData';
import {countryName} from './CountryMap';
import {CountryFilter} from './CountryFilter';
import {humanDate} from './InsightCharts';
import {Status} from './Status';
type Metric='speakers'|'voters'|'amendmentVotes';
type Row={availability?:Record<Metric,AvailabilityState>;kind?:string;id:string;title:string;titleLanguage?:string|null;date:string;sittingId:string;upcoming:boolean;speakers:number|null;voters:number|null;amendmentVotes:number|null;rollCalls:number};
type Response={countryMetadata?:Record<string,import('./InsightTypes').DemographicFieldEvidence>;availability?:Record<Metric,SourceAvailability>;topics:Row[];series:({date:string;availability?:Record<Metric,AvailabilityState>}&Record<Metric,number|null>)[];window:{start:string;end:string};coverage:{catalogueComplete?:boolean;topicsWithSpeechLinks:number;topics:number;gaps:{kind:string;sitting:string}[]}};
export function Participation({language,sittings,onTopic,latestAvailable=true}:{language:string;sittings:Sitting[];latestAvailable?:boolean;onTopic:(sitting:string,topic:string)=>void}) {
  const ui = useUiI18n();
  const [period,setPeriod]=useExplorerParam('hot-period',weekPeriod(latestHeldSitting(sittings,latestAvailable))),[metric,setMetric]=useExplorerParam<Metric>('hot-rank','speakers',['speakers','voters','amendmentVotes']),[country,setCountry]=useExplorerParam<string|null>('hot-country',null),[search,setSearch]=useExplorerParam<string>('hot-search','');
  const [kind,value]=[period.slice(0,period.indexOf(':')),period.slice(period.indexOf(':')+1)];
  const params=new URLSearchParams({lang:language,...(country ? ({country}) : ({})),[kind]:value});
  const state=useInsightData<Response>(value ? ('insights/participation?'+params) : null),data=state.data;
  const labels:Record<Metric,string>={speakers:ui.t("Participation.meps_speaking"),voters:ui.t("Participation.meps_voting"),amendmentVotes:ui.t("Participation.amendment_roll_calls")};
  const rows=data ? [...data.topics].filter(row=>row.title.toLocaleLowerCase(language).includes(search.toLocaleLowerCase(language))).sort((a,b)=>(b[metric]??-1)-(a[metric]??-1)||a.title.localeCompare(b.title)) : ([]);
  const bins=data?.series||[],hasActivity=data?.topics.some(row=>row[metric]!==null),future=kind==='sitting'&&sittings.find(s=>s.id===value)?.phase==='upcoming'||Boolean(data?.topics.length&&data.topics.every(row=>row.upcoming));
  const agendaUnavailable=Boolean(data?.coverage.gaps.some(gap=>gap.kind==='agenda-unavailable'));
  const unavailableAgendaStatus=(agendaUnavailable && data?.topics.length) ? ui.t("Participation.some_agendas_are_unavailable") : '';
  const unknownAgendaEmpty=agendaUnavailable ? (data?.topics.length ? ui.t("Participation.none_of_the_available_agenda_items_match_this_search") : ui.t("Participation.agenda_data_is_unavailable_for_this_selection")) : null;
  const activityUnavailable=(((!hasActivity) && agendaUnavailable) && Boolean(data?.topics.length)) ? ui.t("Participation.activity_unavailable") : '';
  const missingMetric=rows.filter(row=>row[metric]===null&&(metric==='speakers'?row.kind!=='PLENARY_VOTE':row.kind!=='PLENARY_DEBATE')).length;
  const gapLabel=(kind:string)=>{const id=({'agenda-unavailable':'coverage.agendaUnloaded','votes-unavailable':'coverage.votesUnloaded','roll-call-limit':'coverage.rollCallLimit','vote-result-page-limit':'coverage.voteResultLimit'} as Record<string,string>)[kind];return id?ui.t(id):null;};
  const max=Math.max(1,...bins.map(bin=>bin[metric]||0)),x=(i:number)=>20+i/Math.max(1,bins.length-1)*620,y=(count:number)=>135-count/max*115;
  const resultStatus=((data && (!state.loading)) && (!state.error)) ? [
    rows.length?ui.t(agendaUnavailable?'Participation.availableAgendaMany':'Participation.agendaMany',{count:rows.length}):(unknownAgendaEmpty||ui.t('Participation.no_agenda_items_match_this_selection')),
    future ? ui.t("Participation.this_period_has_not_taken_place") : ((!hasActivity) ? (agendaUnavailable ? activityUnavailable : ui.t("Participation.metricUnavailable", {metric: String(labels[metric])})) : (missingMetric?ui.t(metric==='speakers'?'coverage.linkedSpeechMissing':'coverage.linkedVotingMissing',{count:missingMetric}):'')),
    unavailableAgendaStatus,
  ].filter(Boolean).join(' ') : null;
  function chooseCountry(code:string|null){setCountry(code);if(code&&metric==='amendmentVotes')setMetric('speakers');}
  return <section className="insight-participation" lang={ui.language}>
    <Status scope={JSON.stringify([language,period,country,metric,search])} message={resultStatus} pending={state.loading} oncePerScope/>
    <div className="insight-controls insight-participation-controls">
      <PlenaryPeriodSelect value={period} sittings={sittings} language={language} onChange={setPeriod}/>
      <CountryFilter country={country} onChange={chooseCountry} language={language}/>
      <label><UiMessage id="Participation.rank_by"/><select value={metric} onChange={event=>setMetric(event.target.value as Metric)}>{Object.entries({speakers:ui.t("Participation.speakers"),voters:ui.t("Participation.voters"),amendmentVotes:ui.t("Participation.roll_calls")}).map(([key,label])=><option key={key} value={key} disabled={Boolean(country&&key==='amendmentVotes')}>{label}</option>)}</select></label>
      <label className="insight-participation-search"><UiMessage id="Participation.find_an_agenda_item"/><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder={ui.t("Participation.search_titles")}/></label>
    </div>
    {(country||search)&&<div className="insight-active-filters" aria-label={ui.t("Participation.active_participation_filters")}>{country&&<button onClick={()=>chooseCountry(null)}><UiMessage id="legislation.meps_elected_in_countryname.9c4b7d" values={{country: <span lang={language}>{countryName(country,language)}</span>}}/></button>}{search&&<button onClick={()=>setSearch('')}><UiMessage id="Participation.titleFilter" values={{search: <span lang="">{search}</span>}}/></button>}</div>}
    {!period&&!latestAvailable&&<p><UiMessage id="legislation.latest_week_unavailable_choose_a_period.103440"/></p>}
    {!data&&state.loading&&<p role="status"><UiMessage id="Participation.loading_participation"/></p>}{state.error&&<p role="alert"><UiMessage id="Participation.participation_temporarily_unavailable"/> <button onClick={state.retry}><UiMessage id="insightshared.reload.cce715"/></button></p>}
    {data&&<>
      <SittingCalendarNotice complete={data.coverage.catalogueComplete}/>
      <p className="insight-chart-caption"><span lang={language}>{humanDate(data.window.start,language)}{(data.window.end!==data.window.start) ? (' — '+humanDate(data.window.end,language)) : ''}</span> · {country ? <><UiMessage id="batch4.questiontopics.tsx.meps.elected.in.country" values={{country: <span lang={language}>{countryName(country,language)}</span>}}/></> : ui.t("Participation.all_current_meps")}</p>
      {!future&&<AvailabilityNote showGaps={false} sources={data.availability?.[metric]} kind={metric==='speakers'?'speech':'vote'} language={language} end={data.window.end} partial={bins.some(bin=>bin.availability?.[metric]==='partial')}/>}
      {future&&<p className="insight-empty-state"><UiMessage id="Participation.this_period_has_not_taken_place"/></p>}
      {!future&&!hasActivity&&!agendaUnavailable&&<p className="insight-empty-state"><UiMessage id="Participation.metricChoosePeriod" values={{metric: labels[metric]}}/></p>}
      {!future&&activityUnavailable&&<p className="insight-empty-state" lang={ui.language}>{activityUnavailable}</p>}
      {bins.length>1&&hasActivity&&<figure className="insight-participation-trend"><figcaption><UiMessage id="Participation.trendCaption" values={{metric: labels[metric]}}/></figcaption><svg lang={(language==='en') ? 'en' : ''} viewBox="0 0 660 155" role="img" aria-label={labels[metric]+': '+bins.map(bin=>humanDate(bin.date,language)+' '+availabilityValue(bin[metric],bin.availability?.[metric]||'observed')).join(', ')}><line x1="20" x2="640" y1="135" y2="135" style={{stroke:'var(--line-strong)'}}/>{bins.map((bin,i)=>(((i>0) && (bin[metric]!==null)) && (bins[i-1][metric]!==null)) ? <path key={'segment:'+bin.date} d={`M${x(i-1)} ${y(bins[i-1][metric]!)} L${x(i)} ${y(bin[metric]!)}`} fill="none" style={{stroke:'var(--accent)'}} strokeWidth="3" strokeDasharray={(bin.availability?.[metric]==='partial'||bins[i-1].availability?.[metric]==='partial') ? '6 4' : undefined}/> : null)}{bins.map((bin,i)=>(bin[metric]!==null) ? <circle key={bin.date} cx={x(i)} cy={y(bin[metric]!)} r="5" style={{fill:(bin.availability?.[metric]==='partial') ? 'var(--surface)' : 'var(--accent)',stroke:'var(--accent)'}} strokeWidth="2"><title lang={language}>{ui.t('Participation.trendValue',{date:humanDate(bin.date,language),count:bin[metric]??'—'})}</title></circle> : null)}</svg><ol>{bins.map(bin=><li key={bin.date}><strong>{bin[metric]??'—'}<PartialValue partial={bin.availability?.[metric]==='partial'}/></strong><span lang={language}>{new Intl.DateTimeFormat(language,{weekday:'short',day:'numeric',month:'short'}).format(new Date(bin.date+'T12:00:00Z'))}</span></li>)}</ol></figure>}
      <div className="insight-participation-table"><div className="insight-participation-table-header"><span>{future ? <UiMessage id="Participation.scheduled_agenda"/> : <UiMessage id="legislation.agenda_item.39cc14"/>}</span><span><UiMessage id="Participation.speaking"/></span><span><UiMessage id="Participation.voting"/></span><span><UiMessage id="Participation.amendment_roll_calls"/> <small><UiMessage id="Participation.all_meps"/></small></span></div>{rows.map((row,i)=><button key={row.id} className="insight-participation-row" onClick={()=>onTopic(row.sittingId,row.id)}><span><b>{(row[metric]===null) ? '' : (i+1)}</b><strong lang={row.titleLanguage??''}>{row.title}</strong><small><span lang={language}>{humanDate(row.date,language)}</span>{row.upcoming ? (' · '+ui.t('batch6.procedureprogress.upcoming.25')) : ''}</small></span>{(['speakers','voters','amendmentVotes'] as const).map(key=><span className={(metric===key) ? 'is-ranked' : undefined} key={key}><small>{(key==='amendmentVotes') ? ui.t("Participation.roll_calls_all_meps") : ((key==='speakers') ? ui.t("Participation.speaking") : ui.t("Participation.voting"))}</small>{row[key]??'—'}<PartialValue partial={row.availability?.[key]==='partial'}/></span>)}</button>)}</div>
      {!rows.length&&(unknownAgendaEmpty ? <p lang={ui.language}>{unknownAgendaEmpty}{unavailableAgendaStatus ? (' '+unavailableAgendaStatus) : ''}</p> : <p>{search ? <UiMessage id="Participation.no_agenda_titles_match_this_search"/> : <UiMessage id="Participation.no_agenda_items_available_in_this_view"/>}</p>)}
      <p className="insight-chart-caption"><UiMessage id="Participation.means_unavailable"/></p>{data.coverage.gaps.filter(gap=>gapLabel(gap.kind)).map((gap,index)=><p key={index} className="insight-secondary">{gapLabel(gap.kind)} · <span lang={language}>{humanDate(gap.sitting.slice(7),language)}</span></p>)}
    </>}
  </section>;
}
