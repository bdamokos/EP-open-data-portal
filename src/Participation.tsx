import {PlenaryPeriodSelect,latestHeldSitting,weekPeriod,SittingCalendarNotice,type Sitting} from './PlenaryPeriodNavigation';
import {useExplorerParam} from './explorerUrl';
import {useInsightData} from './InsightData';
import {countryName} from './CountryMap';
import {CountryFilter} from './CountryFilter';
import {humanDate} from './InsightCharts';
import {Status} from './Status';
type Metric='speakers'|'voters'|'amendmentVotes';
type Row={id:string;title:string;titleLanguage?:string|null;date:string;sittingId:string;upcoming:boolean;speakers:number|null;voters:number|null;amendmentVotes:number|null;rollCalls:number};
type Response={topics:Row[];series:({date:string}&Record<Metric,number|null>)[];window:{start:string;end:string};coverage:{catalogueComplete?:boolean;topicsWithSpeechLinks:number;topics:number;gaps:{kind:string;sitting:string}[]}};
export function Participation({language,sittings,onTopic,latestAvailable=true}:{language:string;sittings:Sitting[];latestAvailable?:boolean;onTopic:(sitting:string,topic:string)=>void}) {
  const [period,setPeriod]=useExplorerParam('hot-period',weekPeriod(latestHeldSitting(sittings,latestAvailable))),[metric,setMetric]=useExplorerParam<Metric>('hot-rank','speakers',['speakers','voters','amendmentVotes']),[country,setCountry]=useExplorerParam<string|null>('hot-country',null),[search,setSearch]=useExplorerParam<string>('hot-search','');
  const [kind,value]=[period.slice(0,period.indexOf(':')),period.slice(period.indexOf(':')+1)];
  const params=new URLSearchParams({lang:language,...(country?{country}:{}),[kind]:value});
  const state=useInsightData<Response>(value?'insights/participation?'+params:null),data=state.data;
  const labels:Record<Metric,string>={speakers:'MEPs speaking',voters:'MEPs voting',amendmentVotes:'Amendment roll-calls'};
  const rows=data?[...data.topics].filter(row=>row.title.toLocaleLowerCase(language).includes(search.toLocaleLowerCase(language))).sort((a,b)=>(b[metric]??-1)-(a[metric]??-1)||a.title.localeCompare(b.title)):[];
  const bins=data?.series||[],hasActivity=data?.topics.some(row=>row[metric]!==null),future=kind==='sitting'&&sittings.find(s=>s.id===value)?.phase==='upcoming'||Boolean(data?.topics.length&&data.topics.every(row=>row.upcoming));
  const agendaUnavailable=Boolean(data?.coverage.gaps.some(gap=>gap.kind==='agenda-unavailable'));
  const unavailableAgendaStatus=agendaUnavailable&&data?.topics.length?'Some agendas are unavailable.':'';
  const unknownAgendaEmpty=agendaUnavailable?(data?.topics.length?'No saved agenda titles match this search.':'Agenda data is unavailable for this selection.'):null;
  const activityUnavailable=!hasActivity&&agendaUnavailable&&Boolean(data?.topics.length)?'Activity data is unavailable for the saved agenda items.':'';
  const max=Math.max(1,...bins.map(bin=>bin[metric]||0)),x=(i:number)=>20+i/Math.max(1,bins.length-1)*620,y=(count:number)=>135-count/max*115;
  const line=bins.map((bin,i)=>bin[metric]===null?'':`${i===0||bins[i-1][metric]===null?'M':'L'}${x(i)},${y(bin[metric]!)}`).join(' ');
  const resultStatus=data&&!state.loading&&!state.error?[
    rows.length?`${rows.length.toLocaleString('en')}${agendaUnavailable?' saved':''} agenda ${rows.length===1?'item':'items'} in this selection.`:unknownAgendaEmpty||'No agenda items match this selection.',
    future?'This period has not taken place; activity is unavailable.':!hasActivity?(agendaUnavailable?activityUnavailable:`No saved ${labels[metric].toLowerCase()} for this period.`):rows.some(row=>row[metric]===null)?`Some ${labels[metric].toLowerCase()} are unavailable.`:'',
    unavailableAgendaStatus,
    data.coverage.gaps.length?'Partial coverage: some source details are unavailable or exceed this view’s limit.':'',
  ].filter(Boolean).join(' '):null;
  function chooseCountry(code:string|null){setCountry(code);if(code&&metric==='amendmentVotes')setMetric('speakers');}
  return <section className="insight-participation" lang="en">
    <Status scope={JSON.stringify([language,period,country,metric,search])} message={resultStatus} pending={state.loading} oncePerScope/>
    <div className="insight-controls insight-participation-controls">
      <PlenaryPeriodSelect value={period} sittings={sittings} language={language} onChange={setPeriod}/>
      <CountryFilter country={country} onChange={chooseCountry} language={language}/>
      <label>Rank by<select value={metric} onChange={event=>setMetric(event.target.value as Metric)}>{Object.entries({speakers:'Speakers',voters:'Voters',amendmentVotes:'Roll-calls'}).map(([key,label])=><option key={key} value={key} disabled={Boolean(country&&key==='amendmentVotes')}>{label}</option>)}</select></label>
      <label className="insight-participation-search">Find an agenda item<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search titles"/></label>
    </div>
    {(country||search)&&<div className="insight-active-filters" aria-label="Active participation filters">{country&&<button onClick={()=>chooseCountry(null)}>MEPs elected in <span lang={language}>{countryName(country,language)}</span> ×</button>}{search&&<button onClick={()=>setSearch('')}>Title: <span lang="">{search}</span> ×</button>}</div>}
    {!period&&!latestAvailable&&<p>Latest week unavailable. Choose a period.</p>}
    {!data&&state.loading&&<p role="status">Loading participation…</p>}{state.error&&<p role="alert">Participation temporarily unavailable. <button onClick={state.retry}>Reload</button></p>}
    {data&&<>
      <SittingCalendarNotice complete={data.coverage.catalogueComplete}/>
      <p className="insight-chart-caption"><span lang={language}>{humanDate(data.window.start,language)}{data.window.end!==data.window.start?' — '+humanDate(data.window.end,language):''}</span> · {country?<>MEPs elected in <span lang={language}>{countryName(country,language)}</span></>:'All current MEPs'}</p>
      {future&&<p className="insight-empty-state">This period has not taken place. {rows.length?'Open a scheduled item to read its agenda and earlier linked debate.':'Activity will appear after the sitting.'}</p>}
      {!future&&!hasActivity&&!agendaUnavailable&&<p className="insight-empty-state">No saved {labels[metric].toLowerCase()} for this period. Choose another sitting or open an agenda item below.</p>}
      {!future&&activityUnavailable&&<p className="insight-empty-state" lang="en">{activityUnavailable}</p>}
      {bins.length>1&&hasActivity&&<figure className="insight-participation-trend"><figcaption>{labels[metric]} per sitting</figcaption><svg lang={language==='en'?'en':''} viewBox="0 0 660 155" role="img" aria-label={labels[metric]+': '+bins.map(bin=>humanDate(bin.date,language)+' '+(bin[metric]??'unavailable')).join(', ')}><line x1="20" x2="640" y1="135" y2="135" style={{stroke:'var(--line-strong)'}}/><path d={line} fill="none" style={{stroke:'var(--accent)'}} strokeWidth="3"/>{bins.map((bin,i)=>bin[metric]!==null?<circle key={bin.date} cx={x(i)} cy={y(bin[metric]!)} r="5" style={{fill:'var(--accent)'}}><title lang={language}>{humanDate(bin.date,language)}: {bin[metric]}</title></circle>:null)}</svg><ol>{bins.map(bin=><li key={bin.date}><strong>{bin[metric]??'—'}</strong><span lang={language}>{new Intl.DateTimeFormat(language,{weekday:'short',day:'numeric',month:'short'}).format(new Date(bin.date+'T12:00:00Z'))}</span></li>)}</ol></figure>}
      <div className="insight-participation-table"><div className="insight-participation-table-header"><span>{future?'Scheduled agenda':'Agenda item'}</span><span>Speaking</span><span>Voting</span><span>Amendment roll-calls <small>All MEPs</small></span></div>{rows.map((row,i)=><button key={row.id} className="insight-participation-row" onClick={()=>onTopic(row.sittingId,row.id)}><span><b>{row[metric]===null?'':i+1}</b><strong lang={row.titleLanguage??''}>{row.title}</strong><small><span lang={language}>{humanDate(row.date,language)}</span>{row.upcoming?' · upcoming':''}</small></span>{(['speakers','voters','amendmentVotes'] as const).map(key=><span className={metric===key?'is-ranked':undefined} key={key}><small>{key==='amendmentVotes'?'Roll-calls · all MEPs':key==='speakers'?'Speaking':'Voting'}</small>{row[key]??'—'}</span>)}</button>)}</div>
      {!rows.length&&(unknownAgendaEmpty?<p lang="en">{unknownAgendaEmpty}{unavailableAgendaStatus?' '+unavailableAgendaStatus:''}</p>:<p>{search?'No agenda titles match this search.':'No agenda items available in this view.'}</p>)}
      <p className="insight-chart-caption">Distinct current MEPs per item. Speaking counts use saved debate links; — means unavailable. Amendment roll-calls cover all MEPs and count votes, not amendments tabled.</p>{data.coverage.gaps.length>0&&<p className="insight-secondary">Partial coverage: some source details are unavailable or exceed this view’s limit.</p>}
    </>}
  </section>;
}
